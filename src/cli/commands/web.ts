import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { CatbusError } from '../../core/errors.js'
import type { Logger } from '../../core/log.js'

/**
 * `catbus web [stop|status]`（AGENTS.md 4.10、7.9）：启动 / 停止 / 查看本地 WebUI 服务。
 * 服务端代码在 src/webui/，只在执行这个命令时加载。
 */

export const WEB_OPTIONS: Record<string, z.ZodType> = {
  port: z.number().optional().describe('端口，默认 5174；0 表示随机端口'),
  host: z.string().optional().describe('监听地址，默认 127.0.0.1；不是回环地址时启用访问令牌（--demo 时不需要）'),
  demo: z.boolean().optional().describe('演示模式：只用演示数据，不碰任何真实账号'),
  headless: z.boolean().optional().describe('只启动服务，不打开浏览器'),
  detach: z.boolean().optional().describe('后台运行：服务就绪后立即返回，关掉终端也继续运行'),
}

export interface WebOptions {
  port?: number
  host?: string
  demo?: boolean
  headless?: boolean
  detach?: boolean
}

export interface WebInfo {
  running: boolean
  url: string | null
  host: string | null
  port: number | null
  pid: number | null
  demo: boolean | null
  detached: boolean | null
  reused: boolean | null
  log: string | null
  started_at: string | null
}

/** 后台子进程的标记：父进程等它通过 IPC 报告就绪 */
const CHILD_ENV = 'CATBUS_WEBUI_CHILD'
const CLI_MAIN = fileURLToPath(new URL('../main.js', import.meta.url))
const HOST = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/

const NOT_RUNNING: WebInfo = {
  running: false, url: null, host: null, port: null, pid: null, demo: null, detached: null, reused: null, log: null, started_at: null,
}

function validate(opts: WebOptions): { host: string; port: number } {
  return { host: checkHost(opts.host), port: checkPort(opts.port) }
}

function checkPort(port: number | undefined): number {
  if (port == null) return 5174
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new CatbusError('USAGE', `端口不合法：${port}`, { hint: '--port 取 0–65535 的整数，0 表示随机端口' })
  }
  return port
}

function checkHost(host: string | undefined): string {
  if (host == null) return '127.0.0.1'
  const h = host.replace(/^\[|\]$/g, '')
  if (!h || !(HOST.test(h) || /^[0-9a-fA-F:.]+$/.test(h)) || h.length > 253) {
    throw new CatbusError('USAGE', `监听地址不合法：${host}`, { hint: '例如 --host 127.0.0.1 或 --host 0.0.0.0' })
  }
  return h
}

/**
 * 执行 `catbus web [stop|status]`。结果交给 emit，恰好一次：前台运行时在服务就绪时调用，
 * 之后一直等到 Ctrl-C 才返回；其余情况在返回前调用。
 */
export async function web(action: string | null, opts: WebOptions, log: Logger, emit: Emit): Promise<void> {
  if (action === 'stop' || action === 'status') {
    const given = Object.keys(opts).filter((k) => opts[k as keyof WebOptions] !== undefined)
    if (given.length) throw new CatbusError('USAGE', `catbus web ${action} 不接受选项 --${given[0]}`, { hint: 'catbus web --help' })
    return emit(action === 'stop' ? await stop(log) : await status())
  }
  if (action != null) throw new CatbusError('USAGE', `未知的子命令：web ${action}`, { hint: 'catbus web | catbus web stop | catbus web status' })
  return start(opts, log, emit)
}

export type Emit = (info: WebInfo) => void

async function status(): Promise<WebInfo> {
  const s = await import('../../webui/server.js')
  const state = await s.readState()
  if (!state) return NOT_RUNNING
  if ((await s.probe(state)) !== state.pid) {
    await s.clearState(state.pid)
    return NOT_RUNNING
  }
  return info(state, null)
}

function info(state: import('../../webui/server.js').ServerState, reused: boolean | null): WebInfo {
  return {
    running: true,
    url: state.url,
    host: state.host,
    port: state.port,
    pid: state.pid,
    demo: state.demo,
    detached: state.detached,
    reused,
    log: state.log,
    started_at: state.started_at,
  }
}

async function stop(log: Logger): Promise<WebInfo> {
  const s = await import('../../webui/server.js')
  const state = await s.readState()
  if (!state) return { ...NOT_RUNNING }
  if ((await s.probe(state)) !== state.pid) {
    // 记录里的进程已经不在（或者 pid 被别的进程复用了）：只清掉记录，不发信号
    await s.clearState(state.pid)
    return { ...NOT_RUNNING }
  }
  kill(state.pid, state.detached, 'SIGTERM')
  const deadline = Date.now() + 5000
  while (alive(state.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
  if (alive(state.pid)) {
    log.warn(`WebUI 服务（pid ${state.pid}）5 秒内没有退出，强制结束`)
    kill(state.pid, state.detached, 'SIGKILL')
  }
  await s.clearState(state.pid)
  return { ...info(state, null), running: true }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** 后台服务是进程组长：整组发信号，连带它正在跑的下载、扫码登录子进程 */
function kill(pid: number, group: boolean, signal: NodeJS.Signals) {
  try {
    if (group && process.platform !== 'win32') process.kill(-pid, signal)
    else process.kill(pid, signal)
  } catch {}
}

async function start(opts: WebOptions, log: Logger, emit: Emit): Promise<void> {
  const { host, port } = validate(opts)
  const demo = opts.demo ?? false
  const s = await import('../../webui/server.js')
  if (!s.appBuilt()) {
    throw new CatbusError('ERROR', `找不到 WebUI 资源：${s.APP_DIR}`, { hint: '在仓库根目录执行 npm run build:web' })
  }

  // 已有服务在运行：复用，只打开浏览器
  if (!process.env[CHILD_ENV]) {
    const state = await s.readState()
    if (state && (await s.probe(state)) === state.pid) {
      const conflict =
        (opts.port != null && opts.port !== 0 && opts.port !== state.port) ? `--port ${opts.port}（运行中的是 ${state.port}）`
        : (opts.host != null && opts.host !== state.host) ? `--host ${opts.host}（运行中的是 ${state.host}）`
        : (opts.demo != null && opts.demo !== state.demo) ? `--demo（运行中的服务${state.demo ? '是' : '不是'}演示模式）`
        : null
      if (conflict) {
        throw new CatbusError('USAGE', `WebUI 服务已经在运行（pid ${state.pid}，${state.url.split('?')[0]}），与 ${conflict} 不一致`, { hint: 'catbus web stop' })
      }
      log.info(`WebUI 服务已经在运行（pid ${state.pid}），直接使用`)
      if (!opts.headless) openBrowser(state.url, log)
      return emit(info(state, true))
    }
    if (state) await s.clearState(state.pid)
  }

  const o = { host, port, demo, headless: opts.headless ?? false }
  if (opts.detach && !process.env[CHILD_ENV]) return emit(await detach(o, log))
  return foreground(o, log, emit)
}

function listenError(e: unknown, host: string, port: number): CatbusError {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') {
    return new CatbusError('ERROR', `端口 ${port} 已被占用`, { hint: `换一个端口：catbus web --port ${port + 1}，或 --port 0 随机端口` })
  }
  if (code === 'EADDRNOTAVAIL' || code === 'ENOTFOUND') return new CatbusError('USAGE', `无法监听地址 ${host}`, { hint: '例如 --host 127.0.0.1 或 --host 0.0.0.0' })
  if (code === 'EACCES') return new CatbusError('ERROR', `没有权限监听 ${host}:${port}`, { hint: '换一个大于 1024 的端口' })
  return new CatbusError('ERROR', `WebUI 服务启动失败：${(e as Error).message}`)
}

interface Resolved {
  host: string
  port: number
  demo: boolean
  headless: boolean
}

/** 前台运行（后台子进程也走这里）：就绪后 emit，然后等 Ctrl-C / SIGTERM */
async function foreground(o: Resolved, log: Logger, emit: Emit): Promise<void> {
  const s = await import('../../webui/server.js')
  const child = Boolean(process.env[CHILD_ENV])
  let started
  try {
    started = await s.startServer({ host: o.host, port: o.port, demo: o.demo })
  } catch (e) {
    throw listenError(e, o.host, o.port)
  }
  const state: import('../../webui/server.js').ServerState = {
    pid: process.pid,
    host: o.host,
    port: started.port,
    url: s.buildUrl(o.host, started.port, { demo: o.demo, token: started.token }),
    demo: o.demo,
    detached: child,
    token: started.token,
    started_at: new Date().toISOString(),
    log: child ? s.logFile() : null,
  }
  await s.writeState(state)
  const result = info(state, false)

  if (child) {
    // 后台子进程的 stdout / stderr 是日志文件：不写带令牌的地址，提示由父进程输出
    log.info(`WebUI 已启动：${state.url.split('?')[0]}（pid ${process.pid}）`)
    process.send?.({ type: 'ready', info: result })
    process.disconnect?.()
  } else {
    announce(result, log)
    log.info(`WebUI 已启动：${state.url}（Ctrl-C 退出）`)
    if (!o.headless) openBrowser(state.url, log)
    emit(result)
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve()
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
    process.once('SIGHUP', done)
  })
  started.server.closeAllConnections()
  await new Promise<void>((resolve) => started.server.close(() => resolve()))
  await s.clearState(process.pid)
  log.info('WebUI 已停止')
}

/** 后台运行：起一个脱离终端的子进程（进程组长），等它报告就绪 */
async function detach(o: Resolved, log: Logger): Promise<WebInfo> {
  const s = await import('../../webui/server.js')
  const logPath = s.logFile()
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 })
  const fd = openSync(logPath, 'a', 0o600)
  const args = [CLI_MAIN, 'web', '--headless', '--port', String(o.port), '--host', o.host]
  if (o.demo) args.push('--demo')
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', fd, fd, 'ipc'],
    env: { ...process.env, [CHILD_ENV]: '1' },
    windowsHide: true,
  })
  closeSync(fd)
  const result = await new Promise<WebInfo>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new CatbusError('ERROR', 'WebUI 服务 15 秒内没有就绪', { hint: `查看日志：${logPath}` }))
    }, 15_000)
    child.once('message', (m: { type?: string; info?: WebInfo }) => {
      clearTimeout(timer)
      if (m?.type === 'ready' && m.info) resolve(m.info)
      else reject(new CatbusError('ERROR', 'WebUI 服务启动失败', { hint: `查看日志：${logPath}` }))
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new CatbusError('ERROR', `WebUI 服务启动失败（退出码 ${code}）`, { hint: `查看日志：${logPath}` }))
    })
    child.once('error', (e) => {
      clearTimeout(timer)
      reject(new CatbusError('ERROR', `WebUI 服务启动失败：${e.message}`))
    })
  })
  child.removeAllListeners()
  if (child.connected) child.disconnect()
  child.unref()
  announce(result, log)
  log.info(`WebUI 在后台运行（pid ${result.pid}）：${result.url}；日志：${logPath}；停止：catbus web stop`)
  if (!o.headless) openBrowser(result.url!, log)
  return result
}

/** 非回环地址的警告、局域网地址、演示模式提示（写 stderr，不进日志文件） */
function announce(r: WebInfo, log: Logger): void {
  const token = r.url ? new URL(r.url).searchParams.get('token') : null
  const lan = r.host ? lanAddresses(r.host) : []
  const link = (addr: string, query: string) => `http://${addr.includes(':') ? `[${addr}]` : addr}:${r.port}/${query}`
  if (token && r.host) {
    log.warn(`WebUI 监听在 ${r.host}，同一网络里的其他设备也能访问；已启用访问令牌，只有带令牌的地址能打开`)
    for (const addr of lan) log.info(`其他设备：${link(addr, `?token=${token}`)}`)
  } else if (r.demo && r.host && lan.length) {
    log.info(`演示模式监听在 ${r.host}，同一网络里的其他设备不需要令牌就能打开`)
    for (const addr of lan) log.info(`其他设备：${link(addr, '?demo')}`)
  }
  if (r.demo) log.info('演示模式：只使用演示数据，不会用到任何真实账号')
}

function lanAddresses(host: string): string[] {
  if (host !== '0.0.0.0' && host !== '::') return []
  const v6 = host === '::'
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && !a.internal && (a.family === 'IPv4' || (v6 && a.family === 'IPv6' && !a.address.startsWith('fe80'))))
    .map((a) => a!.address)
}

/** 打开浏览器：打不开时只提示地址，不算失败 */
export function openBrowser(url: string, log: Logger): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args as string[], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => log.warn(`无法打开浏览器，请手动打开：${url}`))
    child.unref()
  } catch {
    log.warn(`无法打开浏览器，请手动打开：${url}`)
  }
}
