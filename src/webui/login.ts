import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Platform } from '../core/registry.js'
import { resolveCli } from './cli.js'

/**
 * WebUI 的登录（AGENTS.md 7.9）：按表单字段拼 `catbus <p> auth login` 的 argv。
 * cookie / 密码 / API Key 只经 stdin 传给子进程，不进 argv，也不回传给页面。
 */

export type Method = 'qrcode' | 'sms' | 'password' | 'cookie' | 'apikey'
const WEB_METHODS = new Set<Method>(['qrcode', 'sms', 'password', 'cookie', 'apikey'])

export interface LoginInfo {
  methods: Method[]
  default: Method | null
  note: string | null
}

export interface LoginRequest {
  platform: string
  method: Method
  account?: string
  /** 第几步：短信 / 两步验证的第二步为 verify；短信验证后一个手机号有多个用户时，第三步选号为 select */
  step?: 'start' | 'verify' | 'select'
  fields?: Record<string, string>
}

export interface Session {
  id: string
  platform: string
  state: 'running' | 'qrcode' | 'done' | 'error'
  qrcode: string | null
  message: string | null
  envelope: unknown
  child: ChildProcess | null
  updatedAt: number
}

const PLATFORM = /^[a-z0-9-]{1,16}$/
export const ACCOUNT = /^[a-z0-9][a-z0-9_-]{0,31}$/
const PHONE = /^\+?[0-9]{5,20}$/
const CODE = /^[A-Za-z0-9]{3,12}$/
/** 短信登录第三步选定的用户 id（快手 userId） */
const USER_ID = /^[0-9]{1,16}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/
const LINE = /^[^\0\r\n]{1,256}$/

class LoginError extends Error {}

// ---------- 登录方式：直接读本包的注册表，与 CLI 一致 ----------

let registry: Promise<Platform[]> | null = null

function loadRegistry(): Promise<Platform[]> {
  registry ??= import('../platforms/index.js').then((m) => m.PLATFORMS)
  return registry
}

export async function loginInfo(platform: string): Promise<LoginInfo> {
  if (!PLATFORM.test(platform)) throw new LoginError('未知平台')
  const p = (await loadRegistry()).find((x) => x.id === platform)
  const web = p?.endpoints.web
  if (!p || !web || web === 'planned') throw new LoginError('未知平台')
  const login: { methods: readonly string[]; default?: string } = web.login ?? { methods: [] }
  const methods = login.methods.filter((m): m is Method => WEB_METHODS.has(m as Method))
  const cmd = web.commands.get('auth login')
  return {
    methods,
    default: methods.includes(login.default as Method) ? (login.default as Method) : (methods[0] ?? null),
    note: cmd?.note ?? null,
  }
}

// ---------- argv ----------

function field(fields: Record<string, string>, key: string, re: RegExp, label: string): string {
  const v = fields[key]?.trim()
  if (!v || !re.test(v)) throw new LoginError(`${label}格式不对`)
  return v
}

function secret(fields: Record<string, string>, key: string, label: string): string {
  const v = fields[key]
  if (!v || !v.trim()) throw new LoginError(`请填写${label}`)
  if (v.length > 256 * 1024) throw new LoginError(`${label}过长`)
  return v
}

/** 返回 argv（不含全局选项）和要写进 stdin 的内容 */
export async function buildLogin(req: LoginRequest): Promise<{ argv: string[]; stdin: string | null }> {
  const info = await loginInfo(req.platform)
  if (!info.methods.includes(req.method)) throw new LoginError(`该渠道不支持 ${req.method} 登录`)
  const argv = [req.platform, 'auth', 'login', '--method', req.method]
  // 没指定账号名时用 --auto-bind：同一用户刷新原账号，新用户新增账号，不会覆盖已有账号（AGENTS 5.3）
  argv.push(...(req.account ? ['-a', accountName(req.account)] : ['--auto-bind']))
  const f = req.fields ?? {}
  const verify = req.step === 'verify'
  switch (req.method) {
    case 'qrcode':
      return { argv, stdin: null }
    case 'cookie':
      return { argv: [...argv, '--cookie', '-'], stdin: secret(f, 'cookie', 'Cookie') }
    case 'apikey':
      return { argv: [...argv, '--api-key-stdin'], stdin: secret(f, 'apiKey', 'API Key') }
    case 'sms':
      // 第三步：CLI 已保存待选中间态，只带 --user，不再带 --code
      if (req.step === 'select') return { argv: [...argv, '--user', field(f, 'user', USER_ID, '用户 ID')], stdin: null }
      return verify
        ? { argv: [...argv, '--code', field(f, 'code', CODE, '验证码')], stdin: null }
        : { argv: [...argv, '--phone', field(f, 'phone', PHONE, '手机号')], stdin: null }
    case 'password': {
      argv.push('--username', field(f, 'username', LINE, '用户名'), '--password-stdin')
      if (f.email?.trim()) argv.push('--email', field(f, 'email', EMAIL, '邮箱'))
      if (verify || f.code?.trim()) argv.push('--code', field(f, 'code', CODE, '验证码'))
      return { argv, stdin: secret(f, 'password', '密码') }
    }
  }
}

function accountName(name: string): string {
  if (!ACCOUNT.test(name) || name === 'guest') throw new LoginError('账号名只能用小写字母、数字、- 和 _，且不能是 guest')
  return name
}

/** `catbus <p> auth use <account>`：登录后把新账号设为当前（默认）账号 */
export function buildUse(req: { platform?: unknown; account?: unknown }): string[] {
  if (typeof req.platform !== 'string' || !PLATFORM.test(req.platform)) throw new LoginError('未知平台')
  if (typeof req.account !== 'string') throw new LoginError('缺少账号名')
  return [req.platform, 'auth', 'use', accountName(req.account)]
}

/** `catbus <p> auth logout -a <account>`：删除账号（本地凭证；B 站、快手同时服务端登出） */
export function buildLogout(req: { platform?: unknown; account?: unknown }): string[] {
  if (typeof req.platform !== 'string' || !PLATFORM.test(req.platform)) throw new LoginError('未知平台')
  if (typeof req.account !== 'string') throw new LoginError('缺少账号名')
  return [req.platform, 'auth', 'logout', '-a', accountName(req.account)]
}

// ---------- 运行 ----------

const sessions = new Map<string, Session>()
const QR_LINE = /二维码图片：(.+\.png)\s*$/
const QR_TIMEOUT = 240_000

function spawnCli(argv: string[], stdin: string | null): ChildProcess {
  const { file, prefix } = resolveCli()
  // 登录不加 -q：二维码图片路径和提示都在 stderr 的 info 行里
  const child = spawn(file, [...prefix, '-o', 'json', ...argv], { stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
  if (stdin != null) child.stdin!.end(stdin)
  return child
}

function parseEnvelope(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return { ok: false, data: null, page: null, error: { code: 'BRIDGE', message: 'catbus 的输出无法解析', hint: null, detail: null } }
  }
}

/** 一次性完成的登录（cookie、API Key、短信、密码）：等子进程结束，返回信封 */
export function runOnce(argv: string[], stdin: string | null): Promise<unknown> {
  return new Promise((resolve) => {
    const child = spawnCli(argv, stdin)
    let out = ''
    child.stdout!.on('data', (c) => (out += c))
    child.stderr!.resume()
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000)
    child.on('close', () => {
      clearTimeout(timer)
      resolve(parseEnvelope(out))
    })
  })
}

/** 扫码登录：子进程在后台等待扫码，页面轮询 session */
export function startQrcode(platform: string, argv: string[]): Session {
  // 同一平台同时只保留一个扫码会话
  for (const s of sessions.values()) if (s.platform === platform) cancel(s.id)
  const s: Session = { id: randomUUID(), platform, state: 'running', qrcode: null, message: '正在获取二维码…', envelope: null, child: null, updatedAt: Date.now() }
  sessions.set(s.id, s)
  const child = spawnCli(argv, null)
  s.child = child
  let out = ''
  let buf = ''
  child.stdout!.on('data', (c) => (out += c))
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => {
    buf += chunk
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('[catbus]')) continue // 终端字符画二维码等
      const qr = QR_LINE.exec(line)
      if (qr) {
        void readFile(qr[1]!).then((png) => {
          s.qrcode = `data:image/png;base64,${png.toString('base64')}`
          s.state = 'qrcode'
          s.updatedAt = Date.now()
        })
        s.message = line.replace(/^\[catbus\]\s*/, '').replace(/。?二维码图片：.*$/, '')
      } else {
        s.message = line.replace(/^\[catbus\]\s*/, '')
      }
      s.updatedAt = Date.now()
    }
  })
  const timer = setTimeout(() => child.kill('SIGTERM'), QR_TIMEOUT)
  child.on('close', () => {
    clearTimeout(timer)
    s.child = null
    if (s.state === 'error' && s.envelope) return // 已取消
    s.envelope = parseEnvelope(out)
    s.state = (s.envelope as { ok?: boolean }).ok ? 'done' : 'error'
    s.qrcode = null
    s.updatedAt = Date.now()
  })
  return s
}

export function getSession(id: string): Session | undefined {
  sweep()
  return sessions.get(id)
}

export function cancel(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  if (s.child) {
    s.state = 'error'
    s.envelope = { ok: false, data: null, page: null, error: { code: 'CANCELLED', message: '已取消登录', hint: null, detail: null } }
    s.child.kill('SIGTERM')
  }
  sessions.delete(id)
}

/** 结束超过 5 分钟的会话 */
function sweep() {
  const now = Date.now()
  for (const s of sessions.values()) if (now - s.updatedAt > 5 * 60_000 && !s.child) sessions.delete(s.id)
}

export function publicSession(s: Session) {
  return { id: s.id, state: s.state, qrcode: s.qrcode, message: s.message, envelope: s.envelope }
}

export { LoginError }
