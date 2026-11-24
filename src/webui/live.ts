import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { BodyTooLargeError, readJson } from './body.js'
import { resolveCli } from './cli.js'
import { itemRef } from './download.js'
import { ACCOUNT } from './login.js'

/**
 * 直播弹幕（AGENTS.md 7.9「直播弹幕」）：`POST /api/live/start` 起一个 `catbus <p> live listen -o jsonl` 子进程，
 * `GET /api/live/<id>/events` 用 SSE 把每行 Event 转给页面，`POST /api/live/<id>/stop` 结束它。
 *
 * - 不占 `/api/catbus` 的并发名额（runner.ts）；同时最多 MAX_SESSIONS 个会话。
 * - SSE 断开 DETACH_GRACE_MS 内没有重新连上就结束子进程；不限时长的会话最长 MAX_LIFETIME_MS。
 * - 事件只经过内存，不落盘、不写日志。重新连上时补发断开期间收到的（最多 BACKLOG 条）。
 */
export const MAX_SESSIONS = 2
const DETACH_GRACE_MS = 15_000
const MAX_LIFETIME_MS = 6 * 3600_000
const KILL_GRACE_MS = 3_000
const BACKLOG = 500
const DURATIONS = ['600', '1800', '3600']
const PLATFORM = /^[a-z0-9-]{1,16}$/

export class LiveError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

type EndReason = 'done' | 'stopped' | 'error'
interface End {
  reason: EndReason
  error: unknown
}

interface Session {
  id: string
  child: ChildProcess
  /** 还没有客户端接收时攒着的事件（每条是一行 JSON） */
  backlog: string[]
  client: ServerResponse | null
  end: End | null
  stopped: boolean
  /** stderr 上的摘要信封（jsonl 出错时写在那里） */
  stderr: string
  detachTimer: NodeJS.Timeout | null
  lifeTimer: NodeJS.Timeout
}

const sessions = new Map<string, Session>()

/** 测试用：换掉起子进程的方式 */
let spawner: (file: string, args: string[]) => ChildProcess = (file, args) => spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
export function setLiveSpawner(fn: typeof spawner | null) {
  spawner = fn ?? ((file, args) => spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }))
}
export const liveSessions = () => sessions.size

/** 校验请求体并拼 argv（不含 CLI 前缀） */
export function buildListen(body: unknown): string[] {
  const b = (body ?? {}) as Record<string, unknown>
  const platform = b.platform
  if (typeof platform !== 'string' || !PLATFORM.test(platform)) throw new LiveError('未知平台')
  let room: string
  try {
    room = itemRef(b.room)
  } catch {
    throw new LiveError('直播间只能是 http(s) 链接或 ID')
  }
  const argv = [platform, 'live', 'listen']
  if (b.account != null && b.account !== '') {
    if (typeof b.account !== 'string' || !ACCOUNT.test(b.account) || b.account === 'guest') throw new LiveError('账号名不合法')
    argv.push('-a', b.account)
  }
  if (b.duration != null && b.duration !== '') {
    const d = String(b.duration)
    if (!DURATIONS.includes(d)) throw new LiveError('时长不合法')
    argv.push('--duration', d)
  }
  return [...argv, '--', room]
}

function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

function write(s: Session, line: string) {
  if (s.client && !s.client.writableEnded) s.client.write(`data: ${line}\n\n`)
  else {
    s.backlog.push(line)
    if (s.backlog.length > BACKLOG) s.backlog.shift()
  }
}

function sendEnd(s: Session) {
  if (!s.end || !s.client || s.client.writableEnded) return
  s.client.write(`event: end\ndata: ${JSON.stringify(s.end)}\n\n`)
  s.client.end()
}

function finish(s: Session, code: number | null) {
  clearTimeout(s.lifeTimer)
  if (s.detachTimer) clearTimeout(s.detachTimer)
  let error: unknown = null
  // jsonl 的摘要信封写在 stderr 的最后一行 JSON 上
  for (const line of s.stderr.split('\n').reverse()) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const env = JSON.parse(t) as { error?: unknown }
      error = env.error ?? null
      break
    } catch {
      // 不是信封
    }
  }
  const reason: EndReason = s.stopped ? 'stopped' : error || (code !== 0 && code !== null) ? 'error' : 'done'
  s.end = { reason, error: reason === 'error' ? (error ?? { code: 'ERROR', message: '监听意外结束', hint: null, detail: null }) : null }
  sendEnd(s)
  // 没有客户端时留一会儿，让重新连上的页面还能收到结束原因
  setTimeout(() => sessions.delete(s.id), DETACH_GRACE_MS).unref()
}

export function startLive(body: unknown): string {
  const argv = buildListen(body)
  const active = [...sessions.values()].filter((s) => !s.end).length
  if (active >= MAX_SESSIONS) throw new LiveError(`同时最多监听 ${MAX_SESSIONS} 个直播间`, 429)
  const { file, prefix } = resolveCli()
  const child = spawner(file, [...prefix, '-o', 'jsonl', '-q', ...argv])
  const id = randomBytes(12).toString('hex')
  const s: Session = {
    id,
    child,
    backlog: [],
    client: null,
    end: null,
    stopped: false,
    stderr: '',
    detachTimer: null,
    lifeTimer: setTimeout(() => stopLive(id), MAX_LIFETIME_MS),
  }
  s.lifeTimer.unref()
  sessions.set(id, s)
  let buf = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) write(s, line)
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    s.stderr = (s.stderr + chunk).slice(-16 * 1024)
  })
  child.on('error', () => {
    if (!s.end) finish(s, 1)
  })
  child.on('close', (code) => {
    if (s.end) return
    if (buf.trim()) write(s, buf.trim())
    finish(s, code)
  })
  // 一直没有页面来接：同样按断开处理
  detach(s)
  return id
}

function detach(s: Session) {
  if (s.detachTimer) clearTimeout(s.detachTimer)
  s.detachTimer = setTimeout(() => {
    if (!s.client && !s.end) {
      s.stopped = true
      terminate(s.child)
    }
  }, DETACH_GRACE_MS)
  s.detachTimer.unref()
}

export function stopLive(id: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  if (!s.end) {
    s.stopped = true
    terminate(s.child)
  }
  return true
}

function attach(id: string, res: ServerResponse) {
  const s = sessions.get(id)
  if (!s) throw new LiveError('监听会话不存在或已结束', 404)
  if (s.client && !s.client.writableEnded) s.client.end()
  res.statusCode = 200
  res.setHeader('content-type', 'text/event-stream; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-accel-buffering', 'no')
  res.write(': ok\n\n')
  s.client = res
  if (s.detachTimer) clearTimeout(s.detachTimer)
  for (const line of s.backlog.splice(0)) res.write(`data: ${line}\n\n`)
  if (s.end) return sendEnd(s)
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000)
  ping.unref()
  res.on('close', () => {
    clearInterval(ping)
    if (s.client !== res) return
    s.client = null
    if (!s.end) detach(s)
  })
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  try {
    return await readJson(req, 16 * 1024)
  } catch (e) {
    throw e instanceof BodyTooLargeError ? new LiveError(e.message, e.status) : e
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}
const err = (message: string) => ({ ok: false, data: null, page: null, error: { code: 'BRIDGE', message, hint: null, detail: null } })

/** `/api/live/*`（前缀已去掉）：POST start、GET <id>/events、POST <id>/stop */
export async function handleLive(req: IncomingMessage, res: ServerResponse) {
  const parts = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').slice(1)
  try {
    if (req.method === 'POST' && parts.length === 1 && parts[0] === 'start') {
      return sendJson(res, 200, { ok: true, id: startLive(await readBody(req)) })
    }
    const [id, action] = parts
    if (id && /^[0-9a-f]{24}$/.test(id)) {
      if (req.method === 'GET' && action === 'events') return attach(id, res)
      if (req.method === 'POST' && action === 'stop') return sendJson(res, 200, { ok: stopLive(id) })
    }
    sendJson(res, 404, err('未知的直播接口'))
  } catch (e) {
    const status = e instanceof LiveError ? e.status : e instanceof SyntaxError ? 400 : 500
    sendJson(res, status, err((e as Error).message))
  }
}
