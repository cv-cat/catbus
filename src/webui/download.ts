import { execFile } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { catbusHome } from '../core/paths.js'
import { resolveCli } from './cli.js'
import { exportFileName, parseExportDoc, toText, toXlsx, type ExportDoc, type ExportFormat } from './export-format.js'

/**
 * 批量下载（AGENTS.md 7.9「批量选择与下载」）。分两段：
 *
 * 1. 服务端下载：每次点下载是一批，逐条运行
 *    `catbus <p> item download [-a <账号>] --dir <目录> -- <item>`，同一时间只跑一条，
 *    下到这一批的临时目录 ~/.catbus/cache/webui/downloads/<批次 id>/<p>/<标题>/。
 * 2. 交给浏览器：页面按批次 / 条目 ID 取文件（prepareDelivery），一个文件直接下载，多个文件打成 zip。
 *
 * 临时文件在删除记录时删、最后一条完成超过 1 小时删、服务启动时清理过期的。
 * 下载记录存在 ~/.catbus/cache/webui/downloads.json（可随时删除）。
 */

export class DownloadError extends Error {}

/** 取文件接口的错误：带 HTTP 状态码（404 未知、403 越界、410 已清理） */
export class DeliveryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export type ItemStatus = 'queued' | 'running' | 'done' | 'failed'

export interface DownloadItem {
  id: string
  url: string
  title: string | null
  cover: string | null
  kind: string | null
  /** 这一条的临时文件夹：<批次临时目录>/<p>/<清洗后的标题> */
  dir: string
  status: ItemStatus
  files: string[]
  error: string | null
  /** 失败时 catbus 的错误码，如 RISK_CONTROL */
  code?: string | null
  /** 平台要求人机验证时的网页验证链接（error.detail.verify_url） */
  verify_url?: string | null
  /** 下载完成的文件已被清理（过期或被删），要重新下载 */
  expired?: boolean
  /** CLI 写的帖子信息 `<platform>_<id>.json`（File.type 为 data）；没有导出信息时为 null */
  data?: string | null
  /** 这一条取到了什么：下载完成后从 File[] 和 ExportDoc 得出，下载记录据此显示 */
  got?: ItemGot | null
}

/** 一条下载的结果：媒体文件数、是否写了信息、评论条数（含楼中楼）、是否遇到风控提前停止 */
export interface ItemGot {
  media: number
  meta: boolean
  /** 一级评论条数；没取评论时为 null */
  comments: number | null
  /** 楼中楼总条数 */
  replies: number
  truncated: boolean
}

/** 一批下载的内容与格式（AGENTS.md 7.9「批量选择与下载」）；重试时沿用 */
export interface DownloadOptions {
  media: boolean
  meta: boolean
  comments: number | 'all'
  replies: number | 'all'
  format: ExportFormat
}

export const DEFAULT_OPTIONS: Readonly<DownloadOptions> = Object.freeze({ media: true, meta: false, comments: 0, replies: 0, format: 'json' })
const COMMENT_LIMITS: readonly (number | 'all')[] = [0, 5, 10, 20, 50, 100, 1000, 'all']
const REPLY_LIMITS: readonly (number | 'all')[] = [0, 3, 10, 20, 50, 100, 'all']
const FORMATS: readonly ExportFormat[] = ['json', 'txt', 'xlsx']

/** 逐个校验下载选项（白名单），缺省取默认值；什么都不下载时报错 */
export function parseOptions(b: Record<string, unknown>): DownloadOptions {
  const pick = <T>(key: string, list: readonly T[], fallback: T): T => {
    const v = b[key]
    if (v === undefined || v === null) return fallback
    if (!list.includes(v as T)) throw new DownloadError(`下载选项 ${key} 不合法`)
    return v as T
  }
  const opts: DownloadOptions = {
    media: pick('media', [true, false], DEFAULT_OPTIONS.media),
    meta: pick('meta', [true, false], DEFAULT_OPTIONS.meta),
    comments: pick('comments', COMMENT_LIMITS, DEFAULT_OPTIONS.comments),
    replies: pick('replies', REPLY_LIMITS, DEFAULT_OPTIONS.replies),
    format: pick('format', FORMATS, DEFAULT_OPTIONS.format),
  }
  if (!opts.media && !opts.meta && opts.comments === 0) throw new DownloadError('没有要下载的内容：媒体、信息、评论至少选一项')
  return opts
}

/** 旧记录没有 opts，或记录文件被改过：不合法时按默认值 */
function optionsOf(batch: Batch): DownloadOptions {
  try {
    return batch.opts ? parseOptions(batch.opts as unknown as Record<string, unknown>) : { ...DEFAULT_OPTIONS }
  } catch {
    return { ...DEFAULT_OPTIONS }
  }
}

/** 下载选项 → `item download` 的选项（约定见 AGENTS.md 7.9） */
export function optionArgs(o: DownloadOptions): string[] {
  const out: string[] = []
  if (o.meta) out.push('--meta')
  if (o.comments !== 0) out.push('--comments', String(o.comments))
  if (o.comments !== 0 && o.replies !== 0) out.push('--replies', String(o.replies))
  if (!o.media) out.push('--no-media')
  return out
}

class CliError extends Error {
  constructor(message: string, readonly code: string | null, readonly verifyUrl: string | null) {
    super(message)
  }
}

const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) && v.length <= 4096 ? v : null)

export interface Batch {
  /** 记录格式版本：2 起文件在临时目录里、交给浏览器保存 */
  v?: 2
  id: string
  platform: string
  account: string | null
  /** 这一批的临时目录 */
  dir: string
  created_at: string
  /** 最近一条结束（完成或失败）的时间，过期清理按它算 */
  finished_at?: string | null
  /** 下载的内容与格式；旧记录没有，按默认值（只下媒体） */
  opts?: DownloadOptions
  items: DownloadItem[]
}

const PLATFORM = /^[a-z0-9-]{1,16}$/
const ACCOUNT = /^[a-z0-9][a-z0-9_-]{0,31}$/
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
/** 批次 ID 是 randomUUID；记录文件可能被改过，拼路径前先校验 */
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const MAX_ITEMS = 200
const MAX_BATCHES = 100
/** 临时文件保留时长：最后一条完成后 1 小时 */
export const DOWNLOAD_TTL_MS = 60 * 60_000
const SWEEP_MS = 10 * 60_000

const store = () => join(catbusHome(), 'cache', 'webui', 'downloads.json')
/** 全部批次临时目录的根 */
export const downloadsRoot = () => join(catbusHome(), 'cache', 'webui', 'downloads')
export const batchDir = (id: string) => join(downloadsRoot(), id)

// 第一次用到时才读记录（CATBUS_HOME 可能在加载后才设置）
let loaded = false
let batches: Batch[] = []
let sweeper: ReturnType<typeof setInterval> | undefined

function ensureLoaded() {
  if (loaded) return
  loaded = true
  batches = load()
  cleanupDownloads()
  sweeper ??= setInterval(() => cleanupDownloads(), SWEEP_MS)
  sweeper.unref?.()
}

/** 服务启动时调用：读记录并清理过期的临时文件 */
export function initDownloads() {
  ensureLoaded()
}

/** 测试用：丢掉内存里的记录，下次用到时按当前 CATBUS_HOME 重新读 */
export function resetDownloadsForTest() {
  loaded = false
  batches = []
  if (sweeper) clearInterval(sweeper)
  sweeper = undefined
}

function load(): Batch[] {
  try {
    const list = JSON.parse(readFileSync(store(), 'utf8')) as Batch[]
    if (!Array.isArray(list)) return []
    const out: Batch[] = []
    for (const b of list) {
      if (!b || typeof b.id !== 'string' || !BATCH_ID.test(b.id) || !Array.isArray(b.items)) continue
      // 上次服务退出时没跑完的，标为中断
      for (const it of b.items) {
        if (it.status === 'queued' || it.status === 'running') Object.assign(it, { status: 'failed', error: '已中断' })
      }
      if (b.v !== 2) migrate(b)
      out.push(b)
    }
    return out
  } catch {
    return []
  }
}

/** 旧版本的记录：文件在服务端的下载目录里，不能交给浏览器；改到临时目录，完成的标为已过期，可以重新下载 */
function migrate(b: Batch) {
  b.v = 2
  b.dir = batchDir(b.id)
  const taken = new Map<string, string>()
  for (const it of b.items) {
    it.dir = itemDir(join(b.dir, b.platform), it.id, it.title, taken)
    if (it.status === 'done') Object.assign(it, { files: [], expired: true })
  }
}

function save() {
  try {
    const file = store()
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(batches), { mode: 0o600 })
    renameSync(tmp, file)
  } catch {
    // 记录写不进去不影响下载本身
  }
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
}

// emoji：图形符号、零宽连接符、变体选择符、键帽、区域旗帜、肤色、标签字符
const EMOJI = /[\p{Extended_Pictographic}\u200d\ufe0e\ufe0f\u20e3\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu
// 平台表情码与话题标签，如小红书的 [笑哭R]、#话题[话题]#
const STICKER = /#[^#\s]{1,30}\[话题\]#|\[[^\[\]\s]{1,8}R\]|\[话题\]/g
// Windows / macOS / Linux 都不允许或会出问题的字符
const ILLEGAL = /[<>:"/\\|?*\p{Cc}\p{Cf}]/gu
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
const NAME_MAX = 60

/** 把标题清洗成三大系统都能用的文件夹名；清洗后为空时返回 null */
export function folderName(title: string | null): string | null {
  if (!title) return null
  let s = title.normalize('NFC').replace(STICKER, ' ').replace(EMOJI, ' ').replace(ILLEGAL, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = [...s].slice(0, NAME_MAX).join('') // 按码点截，不截断汉字
  s = s.replace(/^[\s.]+|[\s.]+$/g, '')
  if (!s) return null
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

/** 同一批里已被别的条目占用的文件夹名，加上 ID 后 6 位区分 */
function itemDir(base: string, id: string, title: string | null, taken: Map<string, string>): string {
  const name = folderName(title) ?? folderName(id) ?? 'item'
  let dir = join(base, name)
  const owner = taken.get(dir)
  if (owner && owner !== id) dir = join(base, `${name} (${id.slice(-6)})`)
  taken.set(dir, id)
  return dir
}

/** item 只接受 http(s) 链接或 ID，不会被当成选项 */
export function itemRef(v: unknown): string {
  if (typeof v !== 'string') throw new DownloadError('缺少条目')
  if (ITEM_ID.test(v)) return v
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new DownloadError('条目只能是链接或 ID')
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || v.length > 2048 || /[\0\r\n]/.test(v)) {
    throw new DownloadError('条目只能是 http(s) 链接或 ID')
  }
  return v
}

const busy = (b: Batch) => b.items.some((it) => it.status === 'queued' || it.status === 'running')

/** 路径（按字面）是否在目录里面 */
const within = (p: string, dir: string) => resolve(p).startsWith(resolve(dir) + sep)

/** 删掉一批的临时目录；只按批次 ID 拼路径，不信任记录里的路径 */
function removeBatchFiles(id: string) {
  if (!BATCH_ID.test(id)) return
  try {
    rmSync(batchDir(id), { recursive: true, force: true })
  } catch {
    // 删不掉的留给下次清理
  }
}

/** 删掉一条的临时文件夹（必须在这一批的临时目录里） */
function removeItemFiles(batch: Batch, it: DownloadItem) {
  if (!it.dir || !BATCH_ID.test(batch.id) || !within(it.dir, batchDir(batch.id))) return
  try {
    rmSync(it.dir, { recursive: true, force: true })
  } catch {
    // 同上
  }
}

export function startBatch(body: unknown): Batch {
  ensureLoaded()
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.platform !== 'string' || !PLATFORM.test(b.platform)) throw new DownloadError('未知平台')
  let account: string | null = null
  if (b.account != null) {
    if (typeof b.account !== 'string' || !ACCOUNT.test(b.account) || b.account === 'guest') throw new DownloadError('账号名不合法')
    account = b.account
  }
  if (!Array.isArray(b.items) || !b.items.length) throw new DownloadError('没有要下载的条目')
  if (b.items.length > MAX_ITEMS) throw new DownloadError(`一次最多下载 ${MAX_ITEMS} 条`)
  const opts = parseOptions(b)
  const id = randomUUID()
  const dir = batchDir(id)
  const base = join(dir, b.platform)
  const taken = new Map<string, string>()
  const items: DownloadItem[] = b.items.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>
    const url = itemRef(it.url ?? it.id)
    const itemId = str(it.id, 128) ?? url
    const title = str(it.title, 200)
    return {
      id: itemId,
      url,
      title,
      cover: str(it.cover, 2048),
      kind: str(it.kind, 16),
      dir: itemDir(base, itemId, title, taken),
      status: 'queued',
      files: [],
      error: null,
    }
  })
  const batch: Batch = { v: 2, id, platform: b.platform, account, dir, created_at: new Date().toISOString(), finished_at: null, opts, items }
  batches.unshift(batch)
  if (batches.length > MAX_BATCHES) {
    for (const old of batches.slice(MAX_BATCHES)) removeBatchFiles(old.id)
    batches = batches.slice(0, MAX_BATCHES)
  }
  save()
  void pump()
  return batch
}

export function listBatches(): Batch[] {
  ensureLoaded()
  return batches
}

/**
 * 删一条记录，不给 item 时删整批，连同临时文件一起删；
 * 正在下载的不能删，排队中的删掉即取消。批次删空后整批移除。
 */
export function removeRecord(body: unknown): Batch[] {
  ensureLoaded()
  const b = (body ?? {}) as Record<string, unknown>
  const batch = batches.find((x) => x.id === b.batch)
  if (!batch) throw new DownloadError('下载记录不存在')
  const targets = b.item == null ? batch.items : batch.items.filter((it) => it.id === b.item)
  if (!targets.length) throw new DownloadError('下载记录里没有这一条')
  if (targets.some((it) => it.status === 'running')) throw new DownloadError('正在下载，完成后再删除')
  batch.items = batch.items.filter((it) => !targets.includes(it))
  if (!batch.items.length) {
    batches = batches.filter((x) => x !== batch)
    removeBatchFiles(batch.id)
  } else for (const it of targets) removeItemFiles(batch, it)
  save()
  return batches
}

/** 失败的、以及文件已过期的重新排队，不给 item 时重试整批 */
export function retryFailed(body: unknown): Batch[] {
  ensureLoaded()
  const b = (body ?? {}) as Record<string, unknown>
  const batch = batches.find((x) => x.id === b.batch)
  if (!batch) throw new DownloadError('下载记录不存在')
  const targets = batch.items.filter((it) => (it.status === 'failed' || (it.status === 'done' && it.expired)) && (b.item == null || it.id === b.item))
  if (!targets.length) throw new DownloadError('没有可以重试的条目')
  for (const it of targets) Object.assign(it, { status: 'queued', files: it.status === 'done' ? [] : it.files, data: null, got: null, error: null, code: null, verify_url: null, expired: false })
  save()
  void pump()
  return batches
}

/** 清掉已经结束的批次（还在跑的保留），连同临时文件 */
export function clearFinished(): Batch[] {
  ensureLoaded()
  for (const b of batches) if (!busy(b)) removeBatchFiles(b.id)
  batches = batches.filter(busy)
  save()
  return batches
}

/**
 * 清理临时文件：最后一条结束超过 TTL 的批次删掉整个临时目录、完成的条目标为已过期；
 * 没有记录的残留目录直接删掉。服务启动时和运行中定期调用。
 */
export function cleanupDownloads(now = Date.now()) {
  if (!loaded) return ensureLoaded()
  let changed = false
  const known = new Set<string>()
  for (const b of batches) {
    known.add(b.id)
    if (busy(b)) continue
    const at = Date.parse(b.finished_at ?? b.created_at)
    if (!Number.isFinite(at) || now - at <= DOWNLOAD_TTL_MS) continue
    if (existsSync(batchDir(b.id))) removeBatchFiles(b.id)
    for (const it of b.items) {
      if (it.status === 'done' && !it.expired) {
        it.expired = true
        changed = true
      }
    }
  }
  try {
    for (const name of readdirSync(downloadsRoot())) if (!known.has(name)) rmSync(join(downloadsRoot(), name), { recursive: true, force: true })
  } catch {
    // 还没有临时目录
  }
  if (changed) save()
}

// ---------- 交给浏览器 ----------

export interface DeliveryFile {
  /** 真实路径（realpath）；按格式生成的文件（info.txt、xlsx）没有路径，内容在 data 里 */
  path?: string
  data?: Buffer
  /** zip 里的条目名：<p>/<标题>/<文件名>，汇总的 xlsx 在根目录 */
  entry: string
  /** 只有这一个文件、直接交给浏览器时用的文件名；不给时取 entry 的文件名 */
  name?: string
}

export interface Delivery {
  /** 浏览器保存时的文件名 */
  name: string
  type: string
  zip: boolean
  files: DeliveryFile[]
}

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.heic': 'image/heic', '.avif': 'image/avif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.torrent': 'application/x-bittorrent', '.pdf': 'application/pdf', '.zip': 'application/zip',
}
export const contentType = (name: string) => TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'

/** 本地时间的 YYYYMMDD-HHmmss */
function stamp(iso: string): string {
  const d = new Date(Number.isFinite(Date.parse(iso)) ? iso : Date.now())
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 按批次 / 条目 ID 找出要交给浏览器的文件。不接受路径：路径只取自下载记录，
 * 并用 realpath 校验每个文件仍在这一批的临时目录里（防穿越、防软链接逃逸）。
 *
 * - `item`：只要这一条；`only`：这一批里的这几条（重试后单独交付）；都不给时整批。
 * - 只交付已完成的条目；一个文件直接给，多个文件打 zip。
 * - 帖子信息（CLI 写的 `<platform>_<id>.json`）按这一批的格式交付：json 原样；txt 换成这条目录里的 info.txt；
 *   xlsx 整批汇总成一个 `catbus-<p>-<日期时间>.xlsx`，放在 zip 根目录。读不出来的信息文件原样交付。
 */
export async function prepareDelivery(batchId: string, item: string | null, only: string[] = []): Promise<Delivery> {
  ensureLoaded()
  const batch = batches.find((x) => x.id === batchId)
  if (!batch || !BATCH_ID.test(batch.id)) throw new DeliveryError(404, '下载记录不存在')
  let picked: DownloadItem[]
  if (item != null) {
    const it = batch.items.find((x) => x.id === item)
    if (!it) throw new DeliveryError(404, '下载记录里没有这一条')
    picked = [it]
  } else if (only.length) {
    picked = only.map((id) => batch.items.find((x) => x.id === id)).filter((x): x is DownloadItem => !!x)
    if (picked.length !== new Set(only).size) throw new DeliveryError(404, '下载记录里没有这一条')
  } else picked = batch.items
  const done = picked.filter((it) => it.status === 'done')
  if (done.some((it) => it.expired)) throw new DeliveryError(410, '文件已过期，请重新下载')
  if (!done.length || !done.some((it) => it.files.length)) throw new DeliveryError(404, '没有可以交给浏览器的文件')

  const dir = batchDir(batch.id)
  let root: string
  try {
    root = realpathSync(dir)
  } catch {
    expire(done)
    throw new DeliveryError(410, '文件已过期，请重新下载')
  }
  const format = optionsOf(batch).format
  const files: DeliveryFile[] = []
  const docs: ExportDoc[] = []
  for (const it of done) {
    for (const f of it.files) {
      if (typeof f !== 'string' || !within(f, dir)) throw new DeliveryError(403, '文件不在这一批的临时目录里')
      let real: string
      try {
        real = realpathSync(f)
      } catch {
        expire([it])
        throw new DeliveryError(410, '文件已过期，请重新下载')
      }
      if (!real.startsWith(root + sep) || !lstatSync(real).isFile()) throw new DeliveryError(403, '文件不在这一批的临时目录里')
      const entry = relative(root, real).split(sep).join('/')
      if (format !== 'json' && f === it.data) {
        let doc: ExportDoc | null = null
        try {
          doc = parseExportDoc(readFileSync(real, 'utf8'))
        } catch {
          // 不是合法的 ExportDoc：原样交付
        }
        if (doc && format === 'txt') {
          const name = `${folderName(it.title) ?? folderName(it.id) ?? 'info'}.txt`
          files.push({ data: Buffer.from(toText(doc), 'utf8'), entry: posix.join(posix.dirname(entry), exportFileName(doc, 'txt')), name })
          continue
        }
        if (doc) {
          docs.push(doc)
          continue
        }
      }
      files.push({ path: real, entry })
    }
  }
  if (docs.length) {
    const name = `catbus-${batch.platform}-${stamp(batch.created_at)}.xlsx`
    files.push({ data: await toXlsx(docs), entry: name, name })
  }
  if (!files.length) throw new DeliveryError(404, '没有可以交给浏览器的文件')
  if (files.length === 1) {
    const f = files[0]!
    const name = f.name ?? posix.basename(f.entry)
    return { name, type: contentType(name), zip: false, files }
  }
  const title = done.length === 1 ? (folderName(done[0]!.title) ?? folderName(done[0]!.id)) : null
  const name = title ? `${title}.zip` : `catbus-${batch.platform}-${stamp(batch.created_at)}.zip`
  return { name, type: 'application/zip', zip: true, files }
}

function expire(items: DownloadItem[]) {
  for (const it of items) it.expired = true
  save()
}

/** 下载完成后收紧权限：目录 0700、文件 0600 */
function tighten(dir: string) {
  try {
    chmodSync(dir, 0o700)
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) tighten(p)
      else if (e.isFile()) chmodSync(p, 0o600)
    }
  } catch {
    // Windows 等不支持时忽略
  }
}

let running = false

async function pump() {
  if (running) return
  running = true
  try {
    for (;;) {
      // 先进先出：最早的批次在数组末尾
      const batch = [...batches].reverse().find((b) => b.items.some((it) => it.status === 'queued'))
      const item = batch?.items.find((it) => it.status === 'queued')
      if (!batch || !item) break
      item.status = 'running'
      Object.assign(item, { error: null, code: null, verify_url: null })
      save()
      const dir = item.dir || join(batch.dir, batch.platform)
      try {
        mkdirSync(batch.dir, { recursive: true, mode: 0o700 })
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        const out = await download(batch, item, dir)
        item.files = out.map((f) => f.path)
        item.data = out.find((f) => f.type === 'data')?.path ?? null
        item.got = summarize(out, item.data)
        tighten(batch.dir)
        item.status = 'done'
        item.expired = false
      } catch (e) {
        item.status = 'failed'
        item.error = (e as Error).message
        if (e instanceof CliError) Object.assign(item, { code: e.code, verify_url: e.verifyUrl })
      }
      batch.finished_at = new Date().toISOString()
      save()
    }
  } finally {
    running = false
  }
}

/** 下载结果里取到了什么：帖子信息文件读出评论条数和是否被风控截断 */
function summarize(out: { path: string; type: string | null }[], data: string | null): ItemGot {
  const got: ItemGot = { media: out.filter((f) => f.type !== 'data').length, meta: !!data, comments: null, replies: 0, truncated: false }
  if (!data) return got
  try {
    const doc = JSON.parse(readFileSync(data, 'utf8')) as { comments?: unknown; comments_truncated?: unknown }
    if (Array.isArray(doc.comments)) {
      got.comments = doc.comments.length
      got.replies = doc.comments.reduce((n: number, c: { replies?: unknown }) => n + (Array.isArray(c?.replies) ? c.replies.length : 0), 0)
    }
    got.truncated = doc.comments_truncated === true
  } catch {
    // 读不出来时只记有信息文件
  }
  return got
}

function download(batch: Batch, item: DownloadItem, dir: string): Promise<{ path: string; type: string | null }[]> {
  const { file, prefix } = resolveCli()
  const opts = optionsOf(batch)
  const argv = [...prefix, '-o', 'json', '-q', batch.platform, 'item', 'download']
  if (batch.account) argv.push('-a', batch.account)
  argv.push('--dir', dir, ...optionArgs(opts), '--', item.url)
  return new Promise((resolve, reject) => {
    execFile(file, argv, { timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      let env: {
        ok?: boolean
        data?: { path?: string; type?: string }[]
        error?: { code?: string; message?: string; hint?: string | null; detail?: { verify_url?: unknown } | null }
      } | null = null
      try {
        env = JSON.parse(stdout)
      } catch {
        return reject(err ?? new Error('catbus 没有输出'))
      }
      if (!env?.ok) {
        const e = env?.error
        return reject(new CliError(e?.message ?? '下载失败', e?.code ?? null, httpsUrl(e?.detail?.verify_url)))
      }
      resolve(
        (env.data ?? [])
          .filter((f): f is { path: string; type?: string } => typeof f?.path === 'string')
          .map((f) => ({ path: f.path, type: typeof f.type === 'string' ? f.type : null })),
      )
    })
  })
}
