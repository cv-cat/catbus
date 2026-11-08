import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger } from '../core/log.js'
import { qrcodeFile } from '../core/login.js'
import { closeLoopback, isOwnHost, listenLoopback, openInBrowser, securityHeaders } from '../core/loopback.js'
import { JobConflictError, JobRunner } from './jobs.js'
import { panelMeta } from './meta.js'
import type { JobEvent } from './shared/types.js'
import { UploadDir } from './uploads.js'
import { checkCreateJob, RequestError } from './validate.js'

/**
 * `catbus ui` 的本机 HTTP 服务（AGENTS 4.13）：页面、注册表元数据、任务、上传。
 * 只监听 127.0.0.1，所有地址都在一段随机路径下；写请求另外校验 Origin 和请求头里的令牌。
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}
/** 平台的封面与媒体来自各家 CDN，图片和媒体允许 http(s)；脚本、样式只允许面板自己的。 */
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: http: data: blob:; media-src https: http: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
/** JSON 请求体上限：浏览器导出的 cookie JSON 可能较大。 */
const MAX_JSON_BODY = 4 * 1024 * 1024
const CSRF_HEADER = 'x-catbus-csrf'
const CSRF_PLACEHOLDER = '__CATBUS_CSRF__'
/** 可以作为静态文件直接提供的目录（相对于面板根目录）。 */
const STATIC_DIRS = ['app', 'shared']
const HTTP = { ok: 200, created: 201, found: 302, badRequest: 400, forbidden: 403, notFound: 404, conflict: 409, tooLarge: 413, unsupportedType: 415, internal: 500 } as const

export interface PanelOptions {
  /** 面板静态文件的根目录（dist/ui）。 */
  root: string
  /** catbus 的入口脚本，任务用它起子进程。 */
  cliEntry: string
  /** 子进程的工作目录，也是下载的默认目录。 */
  cwd: string
}

export interface Panel {
  url: string
  close(): Promise<void>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * 编译后的默认位置：本文件在 dist/ui/，入口在 dist/cli/main.js。
 */
export function defaultPanelOptions(): PanelOptions {
  return {
    root: dirname(fileURLToPath(import.meta.url)),
    cliEntry: fileURLToPath(new URL('../cli/main.js', import.meta.url)),
    cwd: process.cwd(),
  }
}

/**
 * 写一个带安全响应头的响应。
 */
function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, { ...securityHeaders(CSP), 'Content-Type': type })
  res.end(body)
}

/**
 * 写 JSON 响应。
 */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8')
}

/**
 * 读取 JSON 请求体，超过上限或不是 JSON 时报错。
 */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new HttpError(HTTP.unsupportedType, '请求体必须是 application/json')
  }
  const parts: Buffer[] = []
  let size = 0
  for await (const part of req as AsyncIterable<Buffer>) {
    size += part.length
    if (size > MAX_JSON_BODY) throw new HttpError(HTTP.tooLarge, '请求体太大')
    parts.push(part)
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown
  } catch {
    throw new HttpError(HTTP.badRequest, '请求体不是合法的 JSON')
  }
}

/**
 * 静态文件：只在允许的目录里，只提供已知类型，不允许跳出根目录。
 */
async function serveStatic(res: ServerResponse, root: string, rest: string): Promise<void> {
  const type = CONTENT_TYPES[extname(rest)]
  const dir = rest.split('/')[0]!
  const file = resolve(root, rest)
  if (!type || !STATIC_DIRS.includes(dir) || rest.includes('\\') || !file.startsWith(resolve(root, dir) + sep)) {
    throw new HttpError(HTTP.notFound, '没有这个文件')
  }
  const body = await readFile(file).catch(() => {
    throw new HttpError(HTTP.notFound, '没有这个文件')
  })
  send(res, HTTP.ok, body, type)
}

/**
 * 把任务事件以 NDJSON 推给页面：先重放已有的，任务结束时关闭响应。
 */
function streamEvents(res: ServerResponse, jobs: JobRunner, id: string): void {
  res.writeHead(HTTP.ok, { ...securityHeaders(CSP), 'Content-Type': 'application/x-ndjson; charset=utf-8' })
  res.flushHeaders()
  const write = (event: JobEvent) => {
    res.write(JSON.stringify(event) + '\n')
    if (event.type === 'end') res.end()
  }
  const unsubscribe = jobs.subscribe(id, write)
  if (!unsubscribe) {
    res.end()
    return
  }
  res.on('close', unsubscribe)
}

/**
 * 启动面板服务，返回带随机路径的地址。
 */
export async function startPanel(options: PanelOptions): Promise<Panel> {
  const token = randomBytes(24).toString('hex')
  const csrf = randomBytes(24).toString('hex')
  const prefix = `/${token}/`
  const jobs = new JobRunner({ cliEntry: options.cliEntry, cwd: options.cwd })
  const uploads = new UploadDir()
  const meta = panelMeta(options.cwd)
  let origin = ''

  /**
   * 写请求：同源且带页面里的令牌。
   */
  const checkWrite = (req: IncomingMessage) => {
    if (req.headers.origin !== origin || req.headers[CSRF_HEADER] !== csrf) throw new HttpError(HTTP.forbidden, '拒绝跨站请求')
  }

  /**
   * 路由：rest 是随机路径之后的部分。
   */
  const route = async (req: IncomingMessage, res: ServerResponse, rest: string, query: URLSearchParams) => {
    const method = req.method ?? 'GET'
    const parts = rest.split('/')
    if (method === 'GET' && rest === '') {
      const html = await readFile(join(options.root, 'app', 'index.html'), 'utf8')
      return send(res, HTTP.ok, html.replace(CSRF_PLACEHOLDER, csrf), CONTENT_TYPES['.html']!)
    }
    if (method === 'GET' && STATIC_DIRS.includes(parts[0]!)) return serveStatic(res, options.root, rest)
    if (parts[0] !== 'api') throw new HttpError(HTTP.notFound, '没有这个地址')

    const [, resource, id, sub] = parts
    if (method === 'GET' && resource === 'meta' && id == null) return sendJson(res, HTTP.ok, meta)
    if (resource === 'jobs' && id == null) {
      if (method === 'GET') return sendJson(res, HTTP.ok, jobs.list())
      if (method === 'POST') {
        checkWrite(req)
        return sendJson(res, HTTP.created, jobs.start(checkCreateJob(await readJson(req))))
      }
    }
    if (resource === 'jobs' && id != null) {
      if (method === 'GET' && sub == null) {
        const job = jobs.get(id)
        return job ? sendJson(res, HTTP.ok, job) : sendJson(res, HTTP.notFound, { error: '没有这个任务' })
      }
      if (method === 'GET' && sub === 'events') return streamEvents(res, jobs, id)
      if (method === 'GET' && sub === 'qrcode') {
        const qr = jobs.qrcode(id)
        if (!qr) throw new HttpError(HTTP.notFound, '这个任务还没有二维码')
        return send(res, HTTP.ok, await readFile(qrcodeFile(qr.platform)), CONTENT_TYPES['.png']!)
      }
      if (method === 'POST' && sub === 'stop') {
        checkWrite(req)
        const job = jobs.stop(id)
        return job ? sendJson(res, HTTP.ok, job) : sendJson(res, HTTP.notFound, { error: '没有这个任务' })
      }
    }
    if (method === 'POST' && resource === 'uploads' && id == null) {
      checkWrite(req)
      const name = query.get('name')
      if (!name) throw new HttpError(HTTP.badRequest, '缺少文件名')
      return sendJson(res, HTTP.created, await uploads.save(name, req))
    }
    throw new HttpError(HTTP.notFound, '没有这个地址')
  }

  const server = createServer((req, res) => {
    const handle = async () => {
      if (!isOwnHost(req.headers.host, origin)) throw new HttpError(HTTP.forbidden, 'Host 不对')
      const url = new URL(req.url ?? '/', origin)
      if (url.pathname === prefix.slice(0, -1)) {
        res.writeHead(HTTP.found, { ...securityHeaders(CSP), Location: prefix })
        return void res.end()
      }
      if (!url.pathname.startsWith(prefix)) throw new HttpError(HTTP.notFound, '没有这个地址')
      await route(req, res, url.pathname.slice(prefix.length), url.searchParams)
    }
    handle().catch((err: unknown) => {
      if (res.headersSent) return void res.end()
      const status = err instanceof HttpError ? err.status : err instanceof RequestError ? HTTP.badRequest : err instanceof JobConflictError ? HTTP.conflict : HTTP.internal
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) })
    })
  })

  origin = await listenLoopback(server)
  return {
    url: `${origin}${prefix}`,
    async close() {
      jobs.shutdown()
      await closeLoopback(server)
      await uploads.remove()
    },
  }
}

/**
 * `catbus ui`：启动面板、输出地址、打开浏览器，等到 Ctrl-C 再关闭。
 */
export async function runPanel(onReady: (url: string) => void, log: Logger): Promise<void> {
  const panel = await startPanel(defaultPanelOptions())
  onReady(panel.url)
  log.info(`面板已启动：${panel.url}（Ctrl-C 退出）`)
  openInBrowser(panel.url)
  await new Promise<void>((done) => {
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })
  log.info('面板已关闭')
  await panel.close()
}
