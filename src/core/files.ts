import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { CatbusError } from './errors.js'
import { exportItem, exportSettings } from './export.js'
import type { HeaderInit, HttpClient } from './http.js'
import type { HandlerContext } from './registry.js'
import type { File, Media } from './schemas.js'

/** `item download` 与发布时的本地文件（AGENTS 4.9「下载」「发布」）。 */

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]))
Object.assign(TYPE_BY_EXT, { jpeg: 'image/jpeg', m4s: 'video/mp4', flv: 'video/x-flv', mkv: 'video/x-matroska' })

function extFromUrl(url: string): string | null {
  try {
    const ext = extname(new URL(url).pathname).slice(1).toLowerCase()
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : null
  } catch {
    return null
  }
}

export function contentTypeOf(name: string): string {
  return TYPE_BY_EXT[extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

// ---------- --subdir（AGENTS 4.9「下载」） ----------

// emoji：图形符号、零宽连接符、变体选择符、键帽、区域旗帜、肤色、标签字符
const EMOJI = /[\p{Extended_Pictographic}\u200d\ufe0e\ufe0f\u20e3\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu
// 平台表情码与话题标签，如小红书的 [笑哭R]、#话题[话题]#
const STICKER = /#[^#\s]{1,30}\[话题\]#|\[[^[\]\s]{1,8}R\]|\[话题\]/g
// Windows / macOS / Linux 不允许或会出问题的字符
const ILLEGAL = /[<>:"/\\|?*\p{Cc}\p{Cf}]/gu
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i
const NAME_MAX = 60

/** 把标题清洗成三大系统都能用的目录名；清洗后为空时返回 null。 */
export function folderName(title: string | null | undefined): string | null {
  if (!title) return null
  let s = title.normalize('NFC').replace(STICKER, ' ').replace(EMOJI, ' ').replace(ILLEGAL, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = [...s].slice(0, NAME_MAX).join('') // 按码点截，不截断汉字
  s = s.replace(/^[\s.]+|[\s.]+$/g, '')
  if (!s) return null
  return RESERVED.test(s) ? `_${s}` : s
}

/**
 * 这个 item 的下载目录：`--dir`，加上 `--subdir` 给出的子目录。
 * `title` 模式下同名目录里已有别的 item 的文件时，目录名加上 ID 后 6 位区分。
 */
export async function itemDir(ctx: HandlerContext, itemId: string, title?: string | null): Promise<string> {
  const base = resolve((ctx.options.dir as string | undefined) ?? '.')
  const mode = (ctx.options.subdir as string | undefined) ?? 'none'
  if (mode === 'none') return base
  const safeId = folderName(itemId) ?? 'item'
  if (mode === 'id') return join(base, safeId)
  const name = folderName(title) ?? safeId
  const dir = join(base, name)
  const prefix = `${ctx.platform.id}_`
  const mine = `${ctx.platform.id}_${itemId}_`
  const names = await readdir(dir).catch(() => [] as string[])
  const taken = names.some((f) => f.startsWith(prefix) && !f.startsWith(mine))
  return taken ? join(base, `${name} (${itemId.slice(-6)})`) : dir
}

export interface DownloadOptions {
  /** `--subdir title` 用的标题；没有标题时传正文。 */
  title?: string | null
  /** 请求头；函数形式按每个媒体计算（例如 YouTube 的直链按来源客户端选 UA）。 */
  headers?: HeaderInit | ((media: Media, index: number) => HeaderInit)
  /** 指定扩展名，例如 B 站 DASH 的音视频分轨。 */
  ext?: (media: Media, index: number) => string | undefined
  /**
   * 分段下载：返回总字节数和每段的地址时，按段（每段 `bytes` 字节）依次请求再拼起来。
   * 用于不接受整文件请求的服务器（YouTube 的 googlevideo 整文件 GET 回 403，且不分段会被限速）。返回 undefined 时整文件下载。
   */
  chunked?: (media: Media) => { total: number; bytes: number; url: (start: number, end: number) => string } | undefined
}

/**
 * 把一组媒体下载到 `--dir`（`--subdir` 时放进 item 自己的子目录），文件名 `<platform>_<id>_<序号>.<ext>`；
 * 已有文件默认跳过，`--overwrite` 时覆盖。
 *
 * 各平台的 item download 都经这里落盘，所以 `--meta` / `--comments` / `--replies` / `--no-media`（AGENTS 4.9）也在这里处理：
 * `--no-media` 时不下载媒体，目录规则不变；需要导出时媒体之后写 `<platform>_<id>.json`（core/export.ts）。
 */
export async function downloadMedia(ctx: HandlerContext, http: HttpClient, itemId: string, media: Media[], options: DownloadOptions = {}): Promise<File[]> {
  const settings = exportSettings(ctx.options, ctx.log)
  const dir = await itemDir(ctx, itemId, options.title)
  await mkdir(dir, { recursive: true })
  const files = settings.media ? await saveMedia(ctx, http, dir, itemId, media, options) : []
  if (settings.meta) files.push(await exportItem(ctx, itemId, dir, settings))
  return files
}

async function saveMedia(ctx: HandlerContext, http: HttpClient, dir: string, itemId: string, media: Media[], options: DownloadOptions): Promise<File[]> {
  const overwrite = Boolean(ctx.options.overwrite)
  const files: File[] = []
  for (const [i, m] of media.entries()) {
    if (!m.url) {
      ctx.log.warn(`第 ${i + 1} 个媒体没有可下载的地址，跳过`)
      continue
    }
    const ext = options.ext?.(m, i) ?? extFromUrl(m.url) ?? (m.type === 'image' ? 'jpg' : m.type === 'audio' ? 'm4a' : 'mp4')
    const path = join(dir, `${ctx.platform.id}_${itemId}_${i + 1}.${ext}`)
    const existing = await stat(path).catch(() => null)
    if (existing && !overwrite) {
      ctx.log.info(`已存在，跳过：${path}`)
      files.push({ path, type: m.type, url: m.url, size: existing.size })
      continue
    }
    ctx.log.info(`下载 ${i + 1}/${media.length}：${basename(path)}`)
    const tmp = `${path}.part`
    const chunks = options.chunked?.(m)
    const headers = typeof options.headers === 'function' ? options.headers(m, i) : options.headers
    try {
      if (chunks) {
        // 分段：依次请求 [start, end]，追加写入同一个临时文件
        await rm(tmp, { force: true })
        for (let start = 0; start < chunks.total; start += chunks.bytes) {
          const end = Math.min(start + chunks.bytes, chunks.total) - 1
          const url = chunks.url(start, end)
          const res = await http.request({ url, headers })
          if (!res.ok) throw new CatbusError('UPSTREAM', `下载失败：HTTP ${res.status}`, { detail: { status: res.status, url, range: [start, end] } })
          await pipeline(res.body ? Readable.fromWeb(res.body as unknown as WebReadableStream) : Readable.from([Buffer.from(await res.arrayBuffer())]), createWriteStream(tmp, { flags: 'a' }))
        }
      } else {
        const res = await http.request({ url: m.url, headers })
        if (!res.ok) throw new CatbusError('UPSTREAM', `下载失败：HTTP ${res.status}`, { detail: { status: res.status, url: m.url } })
        if (res.body) await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(tmp))
        else await pipeline(Readable.from([Buffer.from(await res.arrayBuffer())]), createWriteStream(tmp))
      }
      await rename(tmp, path)
    } catch (err) {
      await rm(tmp, { force: true })
      throw err
    }
    files.push({ path, type: m.type, url: m.url, size: (await stat(path)).size })
  }
  return files
}

export interface LocalMedia {
  data: Uint8Array
  filename: string
  contentType: string
}

/** 发布时的 `--image` / `--video` / `--cover`：本地路径直接读，URL 先下载。 */
export async function readMedia(http: HttpClient, input: string, headers?: HeaderInit): Promise<LocalMedia> {
  if (/^https?:\/\//i.test(input)) {
    const res = await http.request({ url: input, headers, cookies: false })
    if (!res.ok) throw new CatbusError('USAGE', `下载失败：HTTP ${res.status} ${input}`)
    const filename = basename(new URL(input).pathname) || 'file'
    return { data: new Uint8Array(await res.arrayBuffer()), filename, contentType: res.headers.get('content-type')?.split(';')[0] ?? contentTypeOf(filename) }
  }
  const data = await readFile(input).catch(() => {
    throw new CatbusError('USAGE', `读取文件失败：${input}`)
  })
  return { data: new Uint8Array(data), filename: basename(input), contentType: contentTypeOf(input) }
}
