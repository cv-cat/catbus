import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { catbusHome } from '../core/paths.js'
import { itemRef } from './download.js'
import { platformFilters } from './filters.js'
import { ACCOUNT } from './login.js'
import { runCatbus } from './runner.js'

/**
 * 订阅（AGENTS.md 7.9「订阅」）：关键词和作者，服务端定时检查有没有新内容。
 *
 * - 只读：新内容只记进 `unread`，不下载、不推送 qBittorrent。
 * - 每分钟扫一遍到期的订阅，一次只检查一条，经 runner 的同一个队列。
 * - 遇到 RISK_CONTROL 时整个平台暂停，直到用户恢复。
 */
export const MAX_SUBS = 50
export const SEEN_MAX = 500
export const UNREAD_MAX = 100
export const INTERVAL_MS = 30 * 60_000
const JITTER_MS = 5 * 60_000
const FIRST_MS = 60_000
const TICK_MS = 60_000
const LIMIT = '20'
const PLATFORM = /^[a-z0-9-]{1,16}$/

export class SubsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export type SubKind = 'keyword' | 'author'
export interface Sub {
  id: string
  platform: string
  kind: SubKind
  query: string
  label: string
  account: string | null
  created_at: string
  /** 上次检查成功的时间；null 表示还没有基线 */
  last_check: string | null
  /** 下次检查的毫秒时间戳 */
  next_check: number
  error: unknown
  seen: string[]
  unread: Record<string, unknown>[]
}
export interface Paused {
  at: string
  verify_url: string | null
}
interface Store {
  version: 1
  subs: Sub[]
  paused: Record<string, Paused>
}

// ---------- 可替换的依赖（测试用） ----------
type Runner = (argv: string[]) => Promise<string>
let runner: Runner = (argv) => runCatbus(argv)
let now = () => Date.now()
let random = () => Math.random()
let caps: () => Promise<Record<string, { search: boolean; sort: string[] | null; author: boolean }>> = platformFilters
export function setSubsDeps(d: { runner?: Runner | null; now?: (() => number) | null; random?: (() => number) | null; caps?: typeof caps | null }) {
  if (d.runner !== undefined) runner = d.runner ?? ((argv) => runCatbus(argv))
  if (d.now !== undefined) now = d.now ?? (() => Date.now())
  if (d.random !== undefined) random = d.random ?? (() => Math.random())
  if (d.caps !== undefined) caps = d.caps ?? platformFilters
}

// ---------- 存储 ----------
const dir = () => join(catbusHome(), 'webui')
const file = () => join(dir(), 'subscriptions.json')
let store: Store | null = null
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | null = null

function load(): Store {
  if (store) return store
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Store>
    const subs = Array.isArray(raw.subs) ? raw.subs.filter((s) => s && typeof s.id === 'string' && PLATFORM.test(s.platform)) : []
    store = { version: 1, subs, paused: raw.paused && typeof raw.paused === 'object' ? raw.paused : {} }
  } catch {
    store = { version: 1, subs: [], paused: {} }
  }
  return store
}
function save() {
  const s = load()
  mkdirSync(dir(), { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir(), 0o700)
  } catch {
    // Windows 依赖用户目录的 ACL
  }
  const tmp = `${file()}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
  renameSync(tmp, file())
}

/** 服务启动时调用：读订阅并开始定时检查 */
export function initSubs() {
  load()
  timer ??= setInterval(() => void tick().catch(() => {}), TICK_MS)
  timer.unref?.()
}
/** 测试用：丢掉内存里的状态 */
export function resetSubsForTest() {
  store = null
  running = null
  if (timer) clearInterval(timer)
  timer = undefined
}

// ---------- 校验 ----------
function str(v: unknown, max: number, what: string): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw new SubsError(`${what}不合法`)
  return v.trim()
}
function account(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || !ACCOUNT.test(v) || v === 'guest') throw new SubsError('账号名不合法')
  return v
}

// ---------- 对外 ----------
export function listSubs() {
  const s = load()
  return { subs: s.subs, paused: s.paused }
}

export async function addSub(body: unknown): Promise<Sub> {
  const b = (body ?? {}) as Record<string, unknown>
  const platform = b.platform
  if (typeof platform !== 'string' || !PLATFORM.test(platform)) throw new SubsError('未知平台')
  const kind = b.kind
  if (kind !== 'keyword' && kind !== 'author') throw new SubsError('订阅类型只能是 keyword 或 author')
  let query: string
  if (kind === 'keyword') query = str(b.query, 100, '关键词')
  else {
    try {
      query = itemRef(b.query)
    } catch {
      throw new SubsError('作者只能是 http(s) 链接或 ID')
    }
  }
  const label = b.label == null || b.label === '' ? query : str(b.label, 100, '名称')
  const acc = account(b.account)
  const cap = (await caps())[platform]
  if (!cap || !(kind === 'keyword' ? cap.search : cap.author)) throw new SubsError('这个平台不支持这种订阅')
  const s = load()
  const dup = s.subs.find((x) => x.platform === platform && x.kind === kind && x.query === query)
  if (dup) return dup
  if (s.subs.length >= MAX_SUBS) throw new SubsError(`最多 ${MAX_SUBS} 条订阅`, 409)
  const sub: Sub = {
    id: randomUUID(),
    platform,
    kind,
    query,
    label,
    account: acc,
    created_at: new Date(now()).toISOString(),
    last_check: null,
    next_check: now() + Math.floor(random() * FIRST_MS),
    error: null,
    seen: [],
    unread: [],
  }
  s.subs.push(sub)
  save()
  return sub
}

export function removeSub(id: unknown): boolean {
  const s = load()
  const i = s.subs.findIndex((x) => x.id === id)
  if (i < 0) return false
  s.subs.splice(i, 1)
  save()
  return true
}

export function markRead(id: unknown): Sub {
  const sub = load().subs.find((x) => x.id === id)
  if (!sub) throw new SubsError('订阅不存在', 404)
  sub.unread = []
  save()
  return sub
}

export function resume(platform: unknown): boolean {
  const s = load()
  if (typeof platform !== 'string' || !s.paused[platform]) return false
  delete s.paused[platform]
  // 恢复后马上检查这个平台到期的订阅
  save()
  void tick().catch(() => {})
  return true
}

/** 拼检查用的 argv（不含 CLI 前缀） */
export async function checkArgv(sub: Sub): Promise<string[]> {
  const argv = [sub.platform, sub.kind === 'keyword' ? 'item' : 'user', sub.kind === 'keyword' ? 'search' : 'items']
  if (sub.account) argv.push('-a', sub.account)
  if (sub.kind === 'keyword' && (await caps())[sub.platform]?.sort?.includes('latest')) argv.push('--sort', 'latest')
  argv.push('--limit', LIMIT, '--', sub.query)
  return argv
}

const schedule = (sub: Sub) => (sub.next_check = now() + INTERVAL_MS + Math.floor(random() * JITTER_MS))

/** 检查一条；返回检查后的订阅 */
export async function checkSub(sub: Sub): Promise<Sub> {
  const s = load()
  if (s.paused[sub.platform]) throw new SubsError('这个平台遇到风控，订阅已暂停', 409)
  let env: { ok?: boolean; data?: unknown; error?: { code?: string; detail?: { verify_url?: unknown } | null } | null }
  try {
    env = JSON.parse(await runner(await checkArgv(sub)))
  } catch (e) {
    env = { ok: false, error: { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null } as never }
  }
  // 检查期间被取消了
  if (!s.subs.includes(sub)) return sub
  schedule(sub)
  if (!env.ok) {
    if (env.error?.code === 'RISK_CONTROL') {
      const url = env.error.detail?.verify_url
      s.paused[sub.platform] = { at: new Date(now()).toISOString(), verify_url: typeof url === 'string' && url.startsWith('https://') ? url : null }
    }
    sub.error = env.error ?? { code: 'ERROR', message: '检查失败', hint: null, detail: null }
    save()
    return sub
  }
  // last_check 是上次检查成功的时间；从没成功过时这一次只记基线
  const first = sub.last_check === null
  sub.last_check = new Date(now()).toISOString()
  sub.error = null
  const items = (Array.isArray(env.data) ? env.data : []) as Record<string, unknown>[]
  const seen = new Set(sub.seen)
  const fresh: Record<string, unknown>[] = []
  for (const it of items) {
    const id = typeof it?.id === 'string' ? it.id : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    if (!first) {
      const { raw: _raw, ...rest } = it
      fresh.push(rest)
    }
  }
  sub.seen = [...seen].slice(-SEEN_MAX)
  if (fresh.length) sub.unread = fresh.concat(sub.unread).slice(0, UNREAD_MAX)
  save()
  return sub
}

export async function checkNow(id: unknown): Promise<Sub> {
  const sub = load().subs.find((x) => x.id === id)
  if (!sub) throw new SubsError('订阅不存在', 404)
  return checkSub(sub)
}

/** 扫一遍到期的订阅，一次一条；已经在扫时返回同一个 Promise */
export function tick(): Promise<void> {
  if (running) return running
  const p = (async () => {
    for (;;) {
      const s = load()
      const due = s.subs.filter((x) => x.next_check <= now() && !s.paused[x.platform]).sort((a, b) => a.next_check - b.next_check)[0]
      if (!due) break
      await checkSub(due)
    }
  })().finally(() => {
    if (running === p) running = null
  })
  running = p
  return p
}

// ---------- HTTP ----------
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 16 * 1024) throw new SubsError('请求体过大')
  }
  const v = raw ? JSON.parse(raw) : {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new SubsError('请求体必须是对象')
  return v as Record<string, unknown>
}
function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}
const fail = (message: string) => ({ ok: false, data: null, page: null, error: { code: 'BRIDGE', message, hint: null, detail: null } })
const ok = (data: unknown) => ({ ok: true, data, page: null, error: null })

/** `/api/subs/*`（前缀已去掉） */
export async function handleSubs(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  try {
    if (path === '/' || path === '') {
      if (req.method !== 'GET') return sendJson(res, 405, fail('只接受 GET'))
      return sendJson(res, 200, ok(listSubs()))
    }
    if (req.method !== 'POST') return sendJson(res, 405, fail('只接受 POST'))
    const body = await readBody(req)
    switch (path) {
      case '/add':
        return sendJson(res, 200, ok(await addSub(body)))
      case '/remove':
        return sendJson(res, 200, ok({ removed: removeSub(body.id) }))
      case '/read':
        return sendJson(res, 200, ok(markRead(body.id)))
      case '/check':
        return sendJson(res, 200, ok(await checkNow(body.id)))
      case '/resume':
        return sendJson(res, 200, ok({ resumed: resume(body.platform) }))
    }
    sendJson(res, 404, fail('未知的订阅接口'))
  } catch (e) {
    const status = e instanceof SubsError ? e.status : e instanceof SyntaxError ? 400 : 500
    sendJson(res, status, fail((e as Error).message))
  }
}
