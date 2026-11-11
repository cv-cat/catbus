import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileAtomic } from '../core/fsutil.js'
import { catbusHome, packageJson } from '../core/paths.js'
import { createBridge } from './bridge.js'

/**
 * `catbus web` 的服务（AGENTS.md 4.10、7.9）：bridge + 构建好的前端（dist/webui/app/）。
 * 访问控制：Host 校验防 DNS rebinding；监听地址不是回环地址时启用访问令牌。
 */

/** 构建好的前端：dist/webui/server.js → dist/webui/app/ */
export const APP_DIR = fileURLToPath(new URL('./app/', import.meta.url))

export const DEFAULT_PORT = 5174
export const DEFAULT_HOST = '127.0.0.1'

export interface ServerState {
  pid: number
  host: string
  port: number
  /** 本机打开用的地址；启用令牌时带 ?token= */
  url: string
  demo: boolean
  detached: boolean
  token: string | null
  started_at: string
  log: string | null
}

export interface ServeOptions {
  host: string
  port: number
  demo: boolean
}

export function stateFile(): string {
  return join(catbusHome(), 'cache', 'webui', 'server.json')
}

export function logFile(): string {
  return join(catbusHome(), 'cache', 'webui', 'server.log')
}

export async function readState(): Promise<ServerState | null> {
  try {
    const s = JSON.parse(await readFile(stateFile(), 'utf8')) as ServerState
    return typeof s.pid === 'number' && typeof s.port === 'number' ? s : null
  } catch {
    return null
  }
}

export async function writeState(state: ServerState): Promise<void> {
  await writeFileAtomic(stateFile(), JSON.stringify(state, null, 2))
}

/** 只删属于这个进程的记录，避免误删后来启动的服务的记录 */
export async function clearState(pid?: number): Promise<void> {
  if (pid != null && (await readState())?.pid !== pid) return
  await rm(stateFile(), { force: true })
}

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h)
}

/** 本机连这个服务用的地址：监听全部地址时走回环 */
export function localHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '::1'
  return host
}

export function hostForUrl(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

/** 本机打开用的地址 */
export function buildUrl(host: string, port: number, opts: { demo: boolean; token: string | null }): string {
  const q = new URLSearchParams()
  if (opts.demo) q.set('demo', '')
  if (opts.token) q.set('token', opts.token)
  const qs = q.toString().replace(/^demo=(&|$)/, 'demo$1')
  return `http://${hostForUrl(localHost(host))}:${port}/${qs ? `?${qs}` : ''}`
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function text(res: ServerResponse, status: number, body: string) {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(body)
}

/** 静态文件：规范化后必须仍在 APP_DIR 里；找不到的路径回退到 index.html（单页应用） */
export function serveStatic(req: IncomingMessage, res: ServerResponse, dir = APP_DIR): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, '只接受 GET')
  let path: string
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0]!)
  } catch {
    return text(res, 400, '路径不合法')
  }
  if (path.includes('\0')) return text(res, 400, '路径不合法')
  const root = resolve(dir)
  let file = resolve(root, `.${path}`)
  if (file !== root && !file.startsWith(root + sep)) return text(res, 403, '禁止访问')
  let st = existsSync(file) ? statSync(file) : null
  if (!st?.isFile()) {
    // 带扩展名的资源找不到就是 404，其余回退到 index.html
    if (extname(path)) return text(res, 404, '找不到文件')
    file = join(root, 'index.html')
    st = existsSync(file) ? statSync(file) : null
    if (!st?.isFile()) return text(res, 404, '找不到 WebUI 资源')
  }
  res.statusCode = 200
  res.setHeader('content-type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('content-length', st.size)
  res.setHeader('x-content-type-options', 'nosniff')
  // vite 产物的 assets/ 带内容哈希，可以长缓存；index.html 每次重新取
  const hashed = file.startsWith(join(root, 'assets') + sep)
  res.setHeader('cache-control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (req.method === 'HEAD') return void res.end()
  createReadStream(file).on('error', () => res.destroy()).pipe(res)
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

function requestHostname(req: IncomingMessage): string | null {
  const host = req.headers.host
  if (!host) return null
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return null
  }
}

export interface Access {
  /** 不为 null 时启用访问令牌 */
  token: string | null
  port: number
  /** 演示模式：没有可保护的数据（/api/* 全部拒绝），不校验 Host、不要令牌 */
  demo?: boolean
}

/**
 * 访问控制。返回 true 表示已经回复（拒绝或重定向）。
 * - 演示模式：一律放行；
 * - 没有令牌（回环地址）：Host 必须是回环名，防 DNS rebinding；
 * - 有令牌：?token= 正确时写 cookie 并重定向到去掉令牌的地址，之后只认 cookie。
 */
export function guard(req: IncomingMessage, res: ServerResponse, access: Access): boolean {
  if (access.demo) return false
  const hostname = requestHostname(req)
  if (!access.token) {
    if (!hostname || !isLoopback(hostname)) {
      text(res, 421, 'Host 不合法')
      return true
    }
    return false
  }
  const name = `catbus_webui_${access.port}`
  const url = new URL(req.url ?? '/', 'http://localhost')
  const given = url.searchParams.get('token')
  if (given != null) {
    if (!safeEqual(given, access.token)) {
      text(res, 401, '访问令牌不对')
      return true
    }
    url.searchParams.delete('token')
    res.statusCode = 302
    res.setHeader('set-cookie', `${name}=${access.token}; Path=/; HttpOnly; SameSite=Strict`)
    res.setHeader('location', `${url.pathname}${url.search.replace(/=(&|$)/g, '$1')}`)
    res.end()
    return true
  }
  const c = cookie(req, name)
  if (!c || !safeEqual(c, access.token)) {
    text(res, 401, '需要访问令牌：请用 catbus web 输出的完整地址打开（catbus web status 可以再次查看）')
    return true
  }
  return false
}

/**
 * 演示模式（catbus web --demo）：页面一律以 ?demo 打开，前端据此只用演示数据并显示「仅供演示」标记。
 * 只重定向页面（没有扩展名的路径），静态资源照常返回。返回 true 表示已经重定向。
 */
export function demoRedirect(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (extname(url.pathname) || url.searchParams.has('demo')) return false
  const rest = url.search.replace(/^\?/, '')
  res.statusCode = 302
  res.setHeader('location', `${url.pathname}?demo${rest ? `&${rest}` : ''}`)
  res.end()
  return true
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 健康检查：catbus web status / 复用时确认记录里的进程确实是这个服务 */
export const HEALTH = '/api/webui/health'

export interface Started {
  server: Server
  port: number
  token: string | null
}

/** 启动服务；端口被占用等错误原样抛出（code 为 EADDRINUSE 等） */
export function startServer(opts: ServeOptions): Promise<Started> {
  // 演示模式不需要令牌：bridge 拒绝全部 /api/*，碰不到任何账号
  const token = opts.demo || isLoopback(opts.host) ? null : newToken()
  const bridge = createBridge({ demo: opts.demo })
  const access: Access = { token, port: opts.port, demo: opts.demo }
  const server = createServer((req, res) => {
    res.setHeader('referrer-policy', 'no-referrer')
    if ((req.url ?? '').split('?')[0] === HEALTH) {
      // 只给本机看：不需要令牌，但只回复 pid 和版本
      res.setHeader('content-type', 'application/json; charset=utf-8')
      return void res.end(JSON.stringify({ ok: true, pid: process.pid, version: packageJson().version }))
    }
    if (guard(req, res, access)) return
    if (bridge(req, res)) return
    if (opts.demo && demoRedirect(req, res)) return
    serveStatic(req, res)
  })
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject)
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : opts.port
      access.port = port
      resolvePromise({ server, port, token })
    })
  })
}

/** 探测记录里的服务是否还活着：返回服务自报的 pid，探测失败为 null */
export async function probe(state: Pick<ServerState, 'host' | 'port'>, timeoutMs = 1500): Promise<number | null> {
  try {
    const res = await fetch(`http://${hostForUrl(localHost(state.host))}:${state.port}${HEALTH}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await res.json()) as { ok?: boolean; pid?: unknown }
    return body.ok && typeof body.pid === 'number' ? body.pid : null
  } catch {
    return null
  }
}

export function appBuilt(dir = APP_DIR): boolean {
  return existsSync(join(dir, 'index.html'))
}
