import { createReadStream, statSync } from 'node:fs'
import { ZipFile } from 'yazl'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AbortedError, runCatbus } from './runner.js'
import { proxyMedia } from './media.js'
import { platformFilters } from './filters.js'
import { DeliveryError, DownloadError, clearFinished, initDownloads, itemRef, listBatches, prepareDelivery, removeRecord, retryFailed, startBatch, type Delivery } from './download.js'
import { SettingsError, getSettings, putSettings } from './settings.js'
import { ACCOUNT, LoginError, buildLogin, buildLogout, buildUse, cancel, getSession, loginInfo, publicSession, runOnce, startQrcode, type LoginRequest } from './login.js'

/**
 * WebUI 的 bridge（AGENTS.md 7.9）：浏览器 POST /api/catbus {argv}，这里用子进程跑 catbus 并原样返回信封。
 *
 * - 只放行白名单里的只读命令，参数不经过 shell（execFile）；并发上限、排队和取消在 runner.ts。
 * - 不依赖 Vite：`catbus web` 的服务（server.ts）和开发时的 Vite 插件（web/server/bridge.ts）共用这个 handler。
 * - Host 校验与访问令牌在 server.ts；这里只拒绝跨站请求。
 */

/** `resource action` → 允许的选项（每个选项都带一个值） */
const READ_COMMANDS: Record<string, readonly string[]> = {
  // --order-by / --asc：平台私有的字段排序（目前只有 mteam，AGENTS.md 7.9「筛选」）；别的平台带了由 CLI 报 USAGE
  // --mode / --category / --free：M-Team 的分区、分类、只看免费（AGENTS.md 7.9「M-Team「我的」页与筛选」），取值见 MTEAM_FILTER_VALUES
  'item search': ['--limit', '--cursor', '--sort', '--type', '--time', '--order-by', '--mode', '--category'],
  'feed list': ['--limit', '--cursor', '--kind', '--order-by', '--mode', '--category'],
  // 详情卡片（AGENTS.md 7.9）：<item> 放在 `--` 之后
  'item get': [],
  'comment list': ['--limit', '--cursor'],
  'comment replies': ['--limit', '--cursor'],
  // 作者页（AGENTS.md 7.9「作者页」）：<user> 放在 `--` 之后
  'user get': [],
  'user items': ['--limit', '--cursor'],
  // 搜索联想与热搜（AGENTS.md 7.9）：前缀放在 `--` 之后
  'keyword suggest': [],
  'keyword hot': [],
  // 详情卡片的相关推荐（AGENTS.md 7.9「相关推荐」）：只取一页
  'item related': ['--limit'],
  // 猫眼演出的城市搜索（AGENTS.md 7.9「猫眼演出的 bridge 命令」）：只认 maoyan，关键词放在 `--` 之后
  'poi search': [],
}
/** 不带值的开关选项：`item get` 的 `--raw`（详情卡片的原始 JSON，设置「实验性」里打开），以及字段排序的升序开关 `--asc` */
const READ_FLAGS: Record<string, readonly string[]> = {
  'item search': ['--asc', '--free'],
  'feed list': ['--asc', '--free'],
  'item get': ['--raw'],
}
const COMMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SAFE_VALUE = /^[^\0\r\n]{1,512}$/
const PLATFORM = /^[a-z0-9-]{1,16}$/
/**
 * 猫眼演出（AGENTS.md 7.9「猫眼演出的城市」「猫眼演出的场次与票档」）：只有平台是 maoyan 时才放行的选项和开关。
 * `feed list --city <城市名或 ID>`、`item get --tickets`，以及 `poi search -- <关键词>`。
 */
const MAOYAN = 'maoyan'
/** 城市名、演出城市 ID 或城市搜索的关键词 */
const CITY = /^[\p{L}\p{N}][\p{L}\p{N} ·-]{0,31}$/u
const MAOYAN_OPTIONS: Record<string, Record<string, (v: string) => boolean>> = {
  'feed list': { '--city': (v) => CITY.test(v) },
}
const MAOYAN_FLAGS: Record<string, readonly string[]> = {
  'item get': ['--tickets'],
}
/** 联想前缀的长度上限（按字符计） */
const PREFIX_MAX = 100

/**
 * 12306 查询页（AGENTS.md 7.9「12306 查询页」）的免登录只读命令：`<resource action>` → 位置参数的个数和各选项的取值规则。
 * 只认平台 12306、不接受 -a；`true` 表示不带值的开关。
 */
const RAIL_PLATFORM = '12306'
/** 车站：站名、电报码、拼音或城市 */
const STATION = /^[\p{L}\p{N}][\p{L}\p{N} ·-]{0,31}$/u
/** 车型：逗号分隔的单个字母或数字（如 G,D） */
const TRAIN_TYPES = /^[A-Za-z0-9](,[A-Za-z0-9]){0,15}$/
const TRAIN_NO = /^[A-Za-z0-9]{1,16}$/
const RAIL_LIMIT_MAX = 50

function railDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!))
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!
}
const railLimit = (v: string) => /^[1-9]\d{0,1}$/.test(v) && Number(v) <= RAIL_LIMIT_MAX

const RAIL_COMMANDS: Record<string, { args: ((v: string) => boolean)[]; options: Record<string, ((v: string) => boolean) | true> }> = {
  'station search': { args: [(v) => STATION.test(v)], options: {} },
  'ticket search': {
    args: [(v) => STATION.test(v), (v) => STATION.test(v)],
    options: { '--date': railDate, '--type': (v) => TRAIN_TYPES.test(v), '--available': true },
  },
  'route get': {
    args: [(v) => TRAIN_NO.test(v), (v) => STATION.test(v), (v) => STATION.test(v)],
    options: { '--date': railDate },
  },
  'transfer search': {
    args: [(v) => STATION.test(v), (v) => STATION.test(v)],
    options: { '--date': railDate, '--via': (v) => STATION.test(v), '--limit': railLimit },
  },
}

/** 12306 的命令：位置参数逐个校验后放到 `--` 之后，选项按白名单和取值规则校验 */
function validateRail(resource: string | undefined, action: string | undefined, rest: string[]): string[] {
  const spec = RAIL_COMMANDS[`${resource} ${action}`]
  if (!spec) throw new Error(`WebUI 暂不开放命令：${RAIL_PLATFORM} ${resource} ${action}`)
  const positional = rest.splice(0, spec.args.length)
  if (positional.length !== spec.args.length) throw new Error('缺少参数')
  positional.forEach((v, i) => {
    if (!spec.args[i]!(v)) throw new Error(`参数不合法：${v}`)
  })
  const options: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const opt = rest[i]!
    const rule = Object.hasOwn(spec.options, opt) ? spec.options[opt] : undefined
    if (!rule || options.includes(opt)) throw new Error(`不允许的选项：${opt}`)
    if (rule === true) {
      options.push(opt)
      continue
    }
    const val = rest[++i]
    if (val === undefined || !rule(val)) throw new Error(`选项取值不合法：${opt}`)
    options.push(opt, val)
  }
  return [RAIL_PLATFORM, resource!, action!, ...options, '--', ...positional]
}

/**
 * M-Team「我的」页与分类菜单（AGENTS.md 7.9「M-Team「我的」页与筛选」）：只认平台 mteam 的只读命令，
 * 没有位置参数，可带 -a；`true` 表示不带值的开关。
 */
const MTEAM_PLATFORM = 'mteam'
const MTEAM_MODES = ['normal', 'movie', 'tvshow', 'music', 'anime', 'adult']
const MTEAM_STATUS = ['seeding', 'leeching', 'completed', 'incomplete', 'uploaded']
/** 分类：1–16 个逗号分隔的数字 ID */
const MTEAM_CATEGORY = /^\d{1,6}(,\d{1,6}){0,15}$/
const pageLimit = (v: string) => /^[1-9]\d{0,2}$/.test(v) && Number(v) <= 100
const pageCursor = (v: string) => !v.startsWith('-')
const MTEAM_COMMANDS: Record<string, Record<string, ((v: string) => boolean) | true>> = {
  'seed stats': {},
  'bonus get': {},
  'exam get': {},
  'item categories': {},
  'seed list': { '--status': (v) => MTEAM_STATUS.includes(v), '--limit': pageLimit, '--cursor': pageCursor },
  'bonus history': { '--limit': pageLimit, '--cursor': pageCursor },
  'user collects': { '--mode': (v) => MTEAM_MODES.includes(v), '--limit': pageLimit, '--cursor': pageCursor },
}
/** M-Team 浏览筛选（`item search` / `feed list`）的取值规则；别的平台带了由 CLI 报 USAGE */
const MTEAM_FILTER_VALUES: Record<string, (v: string) => boolean> = {
  '--mode': (v) => MTEAM_MODES.includes(v),
  '--category': (v) => MTEAM_CATEGORY.test(v),
}

/** mteam 的「我的」页命令：-a 之后只有白名单里的选项 */
function validateMteam(resource: string | undefined, action: string | undefined, rest: string[]): string[] {
  const spec = MTEAM_COMMANDS[`${resource} ${action}`]!
  const options: string[] = []
  if (rest[0] === '-a') {
    const acc = rest[1]
    if (!acc || !ACCOUNT.test(acc) || acc === 'guest') throw new Error('账号名不合法')
    options.push('-a', acc)
    rest = rest.slice(2)
  }
  const seen = new Set<string>()
  for (let i = 0; i < rest.length; i++) {
    const opt = rest[i]!
    const rule = Object.hasOwn(spec, opt) ? spec[opt] : undefined
    if (!rule || seen.has(opt)) throw new Error(`不允许的选项：${opt}`)
    seen.add(opt)
    if (rule === true) {
      options.push(opt)
      continue
    }
    const val = rest[++i]
    if (val === undefined || !rule(val)) throw new Error(`选项取值不合法：${opt}`)
    options.push(opt, val)
  }
  return [MTEAM_PLATFORM, resource!, action!, ...options]
}

export function validateArgv(argv: unknown): string[] {
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string' && SAFE_VALUE.test(a))) {
    throw new Error('argv 必须是非空字符串数组')
  }
  const args = argv as string[]
  const head = args.slice(0, 2).join(' ')
  if (args.length === 1 && (args[0] === 'platforms' || args[0] === 'version')) return args
  if (args.length === 2 && head === 'auth list') return args

  const [platform, resource, action, ...rest] = args
  if (!PLATFORM.test(platform)) throw new Error('未知平台')
  if (platform === RAIL_PLATFORM) return validateRail(resource, action, rest)
  if (platform === MTEAM_PLATFORM && Object.hasOwn(MTEAM_COMMANDS, `${resource} ${action}`)) return validateMteam(resource, action, rest)
  const cmd = `${resource} ${action}`
  const allowed = READ_COMMANDS[cmd]
  if (!allowed) throw new Error(`WebUI 暂不开放命令：${resource} ${action}`)
  const rules = platform === MAOYAN ? (MAOYAN_OPTIONS[cmd] ?? {}) : {}
  const flags = [...(READ_FLAGS[cmd] ?? []), ...(platform === MAOYAN ? (MAOYAN_FLAGS[cmd] ?? []) : [])]

  const positional: string[] = []
  if (resource === 'item' && action === 'search') {
    const kw = rest.shift()
    if (!kw) throw new Error('缺少搜索关键词')
    positional.push(kw)
  } else if ((resource === 'item' && (action === 'get' || action === 'related')) || (resource === 'comment' && action === 'list')) {
    positional.push(itemRef(rest.shift()))
  } else if (resource === 'user' && (action === 'get' || action === 'items')) {
    // <user> 与 <item> 同样只接受 http(s) 链接或 ID
    positional.push(itemRef(rest.shift()))
  } else if (resource === 'comment' && action === 'replies') {
    const item = itemRef(rest.shift())
    const comment = rest.shift()
    if (!comment || !COMMENT_ID.test(comment)) throw new Error('评论 ID 不合法')
    positional.push(item, comment)
  } else if (resource === 'keyword' && action === 'suggest') {
    const prefix = rest.shift()
    if (!prefix?.trim()) throw new Error('缺少联想前缀')
    if ([...prefix].length > PREFIX_MAX) throw new Error(`联想前缀不能超过 ${PREFIX_MAX} 个字符`)
    positional.push(prefix)
  } else if (resource === 'poi' && action === 'search') {
    if (platform !== MAOYAN) throw new Error(`WebUI 暂不开放命令：${resource} ${action}`)
    const kw = rest.shift()
    if (!kw || !CITY.test(kw)) throw new Error('城市关键词不合法')
    positional.push(kw)
  }
  const options: string[] = []
  // 全局选项 -a：只改本次浏览用的账号，不改 _current
  if (rest[0] === '-a') {
    const acc = rest[1]
    if (!acc || !ACCOUNT.test(acc) || acc === 'guest') throw new Error('账号名不合法')
    options.push('-a', acc)
    rest.splice(0, 2)
  }
  for (let i = 0; i < rest.length; i += 2) {
    const opt = rest[i]!
    if (flags.includes(opt)) {
      if (!options.includes(opt)) options.push(opt)
      i -= 1
      continue
    }
    const val = rest[i + 1]
    const rule = (Object.hasOwn(rules, opt) ? rules[opt] : undefined) ?? MTEAM_FILTER_VALUES[opt]
    if ((!allowed.includes(opt) && !rule) || val === undefined || val.startsWith('-')) {
      throw new Error(`不允许的选项：${opt}`)
    }
    if (rule && !rule(val)) throw new Error(`选项取值不合法：${opt}`)
    options.push(opt, val)
  }
  // 关键词放在 `--` 之后，以 - 开头的文本也不会被当成选项
  return [platform, resource, action, ...options, ...(positional.length ? ['--', ...positional] : [])]
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64 * 1024) throw new Error('请求体过大')
  }
  return raw ? JSON.parse(raw) : {}
}

function send(res: ServerResponse, status: number, body: string) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(body)
}

function bridgeError(message: string): string {
  return JSON.stringify({
    ok: false,
    data: null,
    page: null,
    error: { code: 'BRIDGE', message, hint: null, detail: null },
  })
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/** 登录接口：GET methods、POST start、GET session、POST cancel、POST use（AGENTS.md 7.9） */
async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const [, action, id] = url.pathname.split('/')
  try {
    if (req.method === 'GET' && action === 'methods') {
      return send(res, 200, JSON.stringify(await loginInfo(url.searchParams.get('platform') ?? '')))
    }
    if (req.method === 'POST' && action === 'start') {
      const body = (await readBody(req)) as LoginRequest
      const { argv, stdin } = await buildLogin(body)
      if (body.method === 'qrcode') return send(res, 200, JSON.stringify(publicSession(startQrcode(body.platform, argv))))
      return send(res, 200, JSON.stringify({ envelope: await runOnce(argv, stdin) }))
    }
    if (req.method === 'GET' && action === 'session' && id) {
      const s = getSession(id)
      return s ? send(res, 200, JSON.stringify(publicSession(s))) : send(res, 404, bridgeError('登录会话不存在或已过期'))
    }
    if (req.method === 'POST' && action === 'use') {
      return send(res, 200, JSON.stringify({ envelope: await runOnce(buildUse((await readBody(req)) as Record<string, unknown>), null) }))
    }
    if (req.method === 'POST' && action === 'logout') {
      return send(res, 200, JSON.stringify({ envelope: await runOnce(buildLogout((await readBody(req)) as Record<string, unknown>), null) }))
    }
    if (req.method === 'POST' && action === 'cancel' && id) {
      cancel(id)
      return send(res, 200, JSON.stringify({ ok: true }))
    }
    send(res, 404, bridgeError('未知的登录接口'))
  } catch (e) {
    const status = e instanceof LoginError || e instanceof SyntaxError ? 400 : 500
    send(res, status, bridgeError((e as Error).message))
  }
}

/**
 * 下载接口（AGENTS.md 7.9「批量选择与下载」）：POST start、GET list、POST retry / remove / clear，
 * 以及交给浏览器的 GET / HEAD `/<batch>/file[?item=<id>...]`、`/<batch>/<item>/file`。
 */
async function handleDownload(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/').slice(1)
  if (parts.at(-1) === 'file' && (parts.length === 2 || parts.length === 3)) return void serveDelivery(req, res, parts, url.searchParams.getAll('item'))
  const action = parts[0]
  try {
    if (req.method === 'POST' && action === 'start') return send(res, 200, JSON.stringify({ batch: startBatch(await readBody(req)) }))
    if (req.method === 'GET' && action === 'list') return send(res, 200, JSON.stringify({ batches: listBatches() }))
    if (req.method === 'POST' && action === 'retry') return send(res, 200, JSON.stringify({ batches: retryFailed(await readBody(req)) }))
    if (req.method === 'POST' && action === 'remove') return send(res, 200, JSON.stringify({ batches: removeRecord(await readBody(req)) }))
    if (req.method === 'POST' && action === 'clear') return send(res, 200, JSON.stringify({ batches: clearFinished() }))
    send(res, 404, bridgeError('未知的下载接口'))
  } catch (e) {
    const status = e instanceof DownloadError || e instanceof SyntaxError ? 400 : 500
    send(res, status, bridgeError((e as Error).message))
  }
}

/** `attachment; filename="<ASCII 回退>"; filename*=UTF-8''<百分号编码>` */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_')
  const star = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`
}

/** 把一批（或其中几条）的文件交给浏览器：一个文件直接给，多个文件流式打成 zip（只存不压缩） */
async function serveDelivery(req: IncomingMessage, res: ServerResponse, parts: string[], only: string[]) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, bridgeError('只接受 GET、HEAD'))
  // 跨站页面不能让浏览器来取这里的文件
  if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, bridgeError('拒绝跨站请求'))
  let delivery: Delivery
  try {
    const [batch, item] = parts.slice(0, -1).map((p) => decodeURIComponent(p))
    delivery = await prepareDelivery(batch!, parts.length === 3 ? item! : null, only)
  } catch (e) {
    if (e instanceof DeliveryError) return send(res, e.status, bridgeError(e.message))
    if (e instanceof URIError) return send(res, 400, bridgeError('地址不合法'))
    return send(res, 500, bridgeError((e as Error).message))
  }
  res.statusCode = 200
  res.setHeader('content-type', delivery.type)
  res.setHeader('content-disposition', contentDisposition(delivery.name))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  if (!delivery.zip) {
    const file = delivery.files[0]!
    if (file.data) {
      res.setHeader('content-length', String(file.data.length))
      return void res.end(req.method === 'HEAD' ? undefined : file.data)
    }
    try {
      res.setHeader('content-length', String(statSync(file.path!).size))
    } catch {
      return send(res, 410, bridgeError('文件已过期，请重新下载'))
    }
    if (req.method === 'HEAD') return void res.end()
    const stream = createReadStream(file.path!)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }
  if (req.method === 'HEAD') return void res.end()
  const zip = new ZipFile()
  for (const f of delivery.files) {
    if (f.data) zip.addBuffer(f.data, f.entry, { compress: false })
    else zip.addFile(f.path!, f.entry, { compress: false })
  }
  // 打包途中文件被删等：响应已经开始，只能断开
  zip.on('error', () => res.destroy())
  zip.outputStream.on('error', () => res.destroy())
  zip.outputStream.pipe(res)
  zip.end()
}

/**
 * 服务端设置（AGENTS.md 7.9）：GET 读、PUT 改，只认 proxy 一个键。
 * PUT 是写操作：要求 JSON 请求体（content-type: application/json，跨站时浏览器必须先预检，而 bridge 不应答预检）。
 */
async function handleSettings(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === 'GET') return send(res, 200, JSON.stringify({ ok: true, data: await getSettings() }))
    if (req.method === 'PUT') {
      const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      if (type !== 'application/json') return send(res, 415, bridgeError('只接受 application/json'))
      return send(res, 200, JSON.stringify({ ok: true, data: await putSettings(await readBody(req)) }))
    }
    send(res, 405, bridgeError('只接受 GET、PUT'))
  } catch (e) {
    const status = e instanceof SettingsError || e instanceof SyntaxError ? 400 : 500
    send(res, status, bridgeError((e as Error).message))
  }
}

export interface BridgeOptions {
  /** 演示模式：拒绝全部 /api/*，页面只用演示数据 */
  demo?: boolean
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => boolean

/** 返回一个 handler：处理 /api/* 并返回 true，其余路径返回 false 交给调用方 */
export function createBridge(options: BridgeOptions = {}): Handler {
  // 读下载记录、清理过期的临时文件（AGENTS.md 7.9）
  if (!options.demo) initDownloads()
  return (req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    if (path !== '/api' && !path.startsWith('/api/')) return false
    // 筛选能力只是注册表里的公开信息，演示模式下也放行（页面同样要据此置灰）
    if (path === '/api/filters') {
      if (req.method !== 'GET') {
        send(res, 405, bridgeError('只接受 GET'))
        return true
      }
      platformFilters().then(
        (data) => send(res, 200, JSON.stringify({ ok: true, data })),
        (e) => send(res, 500, bridgeError(`读不到注册表：${(e as Error).message}`)),
      )
      return true
    }
    if (options.demo) {
      send(res, 503, bridgeError('演示模式（catbus web --demo）：WebUI 只使用演示数据'))
      return true
    }
    if (!sameOrigin(req)) {
      send(res, 403, bridgeError('拒绝跨站请求'))
      return true
    }
    // 子路由：去掉前缀，与原来挂在 Vite middlewares 上时一致
    const sub = (prefix: string) => {
      req.url = (req.url ?? '/').slice(prefix.length) || '/'
    }
    if (path === '/api/login' || path.startsWith('/api/login/')) {
      sub('/api/login')
      void handleLogin(req, res)
    } else if (path === '/api/download' || path.startsWith('/api/download/')) {
      sub('/api/download')
      void handleDownload(req, res)
    } else if (path === '/api/settings') {
      void handleSettings(req, res)
    } else if (path === '/api/media') {
      sub('/api/media')
      void proxyMedia(req, res)
    } else if (path === '/api/catbus') {
      void handleCatbus(req, res)
    } else {
      send(res, 404, bridgeError('未知的接口'))
    }
    return true
  }
}

async function handleCatbus(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return send(res, 405, bridgeError('只接受 POST'))
  // 客户端在响应前断开（页面取消了过期的请求、关了标签页）：排队中的直接出队，运行中的结束子进程（runner.ts）
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) ac.abort()
  })
  let argv: string[]
  try {
    argv = validateArgv(((await readBody(req)) as { argv?: unknown }).argv)
  } catch (e) {
    return send(res, 400, bridgeError((e as Error).message))
  }
  try {
    send(res, 200, await runCatbus(argv, ac.signal))
  } catch (e) {
    // 连接已经断了，没有人收响应
    if (e instanceof AbortedError) return
    send(res, 502, bridgeError(`无法运行 catbus：${(e as Error).message}`))
  }
}
