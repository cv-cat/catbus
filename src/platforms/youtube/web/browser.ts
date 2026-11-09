import { type ChildProcess, spawn } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { CatbusError } from '../../../core/errors.js'
import type { Logger } from '../../../core/log.js'
import * as rand from '../../../core/rand.js'
import type { Cookie } from '../../../core/schemas.js'
import { type BgChallenge, runBotGuard } from './botguard.js'

/**
 * 无头 Chromium，只用来在 Studio 页面里计算 BotGuard（见 botguard.ts）。
 * 只用 Node 内置模块：Chromium 自己不随 catbus 安装，用户指定或 Playwright 装好的（AGENTS 5.7）。
 * CDP 走 --remote-debugging-pipe（fd 3 写入、fd 4 读出，消息以 \0 分隔），不开调试端口，同机其他进程拿不到会话。
 */

// ================================================================ 找浏览器

/** Playwright 装好的 Chromium 在缓存目录里的相对路径（Chrome for Testing 与旧的 Chromium 两种）。 */
const BINARIES: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['chrome-mac-arm64', 'chrome-mac-x64', 'chrome-mac'].flatMap((d) => [
    `${d}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${d}/Chromium.app/Contents/MacOS/Chromium`,
  ]),
  linux: ['chrome-linux64/chrome', 'chrome-linux/chrome'],
  win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
}

export interface ChromeLookup {
  /** `catbus config set youtube.browser <路径>` 的值。 */
  configured?: string | null
  platform?: NodeJS.Platform
  home?: string
  env?: NodeJS.ProcessEnv
}

/**
 * 浏览器路径的发现顺序：config.toml 的 youtube.browser → 环境变量 CATBUS_YOUTUBE_BROWSER → Playwright 缓存里最新的 chromium-<版本>。
 * 指定的路径必须是绝对路径，并且是可以执行的文件。
 * 不扫描系统里的 Google Chrome：它是用户日常在用的浏览器，catbus 不占用它。
 */
export function findChrome(opts: ChromeLookup = {}): string {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const home = opts.home ?? homedir()
  const explicit = opts.configured || env.CATBUS_YOUTUBE_BROWSER
  if (explicit) {
    const source = opts.configured ? 'youtube.browser' : 'CATBUS_YOUTUBE_BROWSER'
    if (!isAbsolute(explicit)) throw new CatbusError('ERROR', `${source} 必须是绝对路径：${explicit}`, { hint: '检查 catbus config get youtube.browser，或重新设置' })
    if (!isRunnable(explicit)) {
      throw new CatbusError('ERROR', `${source} 指向的文件不存在或不能执行：${explicit}`, { hint: '检查路径，或重新设置 youtube.browser' })
    }
    return explicit
  }
  for (const root of playwrightRoots(platform, home, env)) {
    for (const dir of chromiumDirs(root)) {
      for (const rel of BINARIES[platform] ?? []) {
        const p = join(root, dir, rel)
        if (isRunnable(p)) return p
      }
    }
  }
  throw new CatbusError('ERROR', '找不到 Chromium：YouTube 的 item publish / delete 需要它计算 Studio 的 BotGuard 校验', {
    hint: '安装：npx playwright install chromium；或指定已有的 Chromium：catbus config set youtube.browser <路径>',
  })
}

/** 是普通文件且当前用户可以执行。 */
function isRunnable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function playwrightRoots(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = []
  if (env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== '0') roots.push(env.PLAYWRIGHT_BROWSERS_PATH)
  if (platform === 'darwin') roots.push(join(home, 'Library', 'Caches', 'ms-playwright'))
  else if (platform === 'win32') roots.push(join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ms-playwright'))
  else roots.push(join(home, '.cache', 'ms-playwright'))
  return roots
}

/** 缓存里的 chromium-<版本> 目录，新版本在前（不含 chromium_headless_shell-*：它过不了 Studio 的浏览器检查）。 */
function chromiumDirs(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)))
  } catch {
    return []
  }
}

// ================================================================ 会话

export interface OpenOptions {
  executable: string
  /** 打开后先访问的地址（Studio 页面）。 */
  url: string
  /** 与 Node 侧请求相同的代理；没有时浏览器直连，不读系统代理。 */
  proxy: string | null
  /** 浏览器的 User-Agent：与 Node 侧请求一致，不带 HeadlessChrome。 */
  ua: string
  /** 注入的 cookie：凭证里的全部 cookie。 */
  cookies: Cookie[]
  log: Logger
  /** 临时 profile 所在的目录，默认系统临时目录（测试用）。 */
  tmpRoot?: string
  /** 等浏览器完成 CDP 握手的时间，默认 20 秒（测试用）。 */
  launchTimeoutMs?: number
}

export interface AttestRequest {
  bg: BgChallenge
  binding: unknown
  /** interpreter 的 JS 源码，已由 Node 取回；页面里还没有时求值一次。 */
  interpreter: string
  fallbackGlobal: string
}

export interface BrowserSession {
  /** 打开 Studio 后的地址；跳到 accounts.google.com 说明登录态已失效。 */
  readonly url: string
  attest(req: AttestRequest): Promise<string>
  /** 浏览器里的全部 cookie（包括 Google 轮换后的值）。 */
  cookies(): Promise<Cookie[]>
  close(): Promise<void>
}

/** 测试时替换这个对象的 open。 */
export const browser = {
  open: openBrowser,
}

/** Google 的 HttpOnly cookie 名单：凭证里不记录这个标记，注入时按名字还原。 */
const HTTP_ONLY = new Set([
  'SID', 'HSID', 'SSID', 'LOGIN_INFO', 'YSC',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Secure-YNID',
  '__Secure-ROLLOUT_TOKEN', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
])

const PAGE_WAIT_MS = 30_000
const LAUNCH_WAIT_MS = 20_000
const STOP_WAIT_MS = 3_000
const KILL_WAIT_MS = 2_000

/**
 * Chromium 的 --proxy-server 参数。没配代理时写 direct://，不读系统代理（AGENTS 5.5）。
 * 带账号密码的代理 Chromium 放不下认证信息，报 USAGE。
 */
export function chromeProxyArg(proxy: string | null): string {
  if (!proxy) return 'direct://'
  const u = new URL(proxy)
  if (u.username || u.password) {
    throw new CatbusError('USAGE', 'YouTube 的 item publish / delete 用的浏览器不支持带账号密码的代理', {
      hint: '换成不需要认证的代理（如 http://127.0.0.1:7890），或去掉代理里的账号密码',
    })
  }
  // Chromium 不认 socks5h，按 socks5 处理（DNS 在本机解析）
  const scheme = u.protocol === 'socks5h:' ? 'socks5' : u.protocol.slice(0, -1)
  return `${scheme}://${u.host}`
}

async function openBrowser(o: OpenOptions): Promise<BrowserSession> {
  const proxyArg = chromeProxyArg(o.proxy)
  const dir = await mkdtemp(join(o.tmpRoot ?? tmpdir(), 'catbus-chromium-'))
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${dir}`,
    `--user-agent=${o.ua}`,
    `--proxy-server=${proxyArg}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
  ]
  // 以 root 运行（如 Docker）时 Chromium 必须关掉沙箱
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox')
  args.push('about:blank')
  // 不把环境里的代理传给浏览器：代理只由 config 与 --proxy 决定
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/_proxy$/i.test(k)) env[k] = v

  let proc: ChildProcess
  try {
    // 非 Windows 上放进独立的进程组，结束时整组一起结束（Chromium 还有 zygote、renderer 等子进程）
    proc = spawn(o.executable, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env, detached: process.platform !== 'win32' })
  } catch (err) {
    await removeProfile(dir, o.log)
    throw spawnFailure(o.executable, err as Error)
  }

  let stderr = ''
  let exited = false
  const cdp = new Cdp((msg) => pipeIn.write(`${msg}\0`))
  const pipeIn = proc.stdio[3] as Writable
  const pipeOut = proc.stdio[4] as Readable
  // 写已经关闭的管道会报 EPIPE；错误由 cdp.fail 处理，这里只防止未处理的 error 事件让 Node 退出
  pipeIn.on('error', () => {})
  pipeOut.on('error', () => {})
  pipeOut.on('data', (chunk: Buffer) => cdp.feed(chunk))
  proc.stderr?.on('data', (d) => {
    if (stderr.length < 2000) stderr += String(d)
  })
  proc.on('error', (err) => cdp.fail(spawnFailure(o.executable, err)))
  proc.on('exit', (code, signal) => {
    exited = true
    cdp.fail(
      new CatbusError('ERROR', `浏览器退出了（${code != null ? `退出码 ${code}` : `信号 ${signal}`}）`, {
        hint: stderr.trim().slice(-300) || '确认 youtube.browser 指向的是可以运行的 Chromium',
      }),
    )
  })

  const stop = async () => {
    if (!cdp.closed) await cdp.send('Browser.close', {}, { timeout: STOP_WAIT_MS }).catch(() => {})
    cdp.fail(new CatbusError('ERROR', '浏览器已关闭'))
    await stopProcess(proc, () => exited)
    await removeProfile(dir, o.log)
  }

  try {
    await cdp.send('Browser.getVersion', {}, { timeout: o.launchTimeoutMs ?? LAUNCH_WAIT_MS }).catch((err: Error) => {
      if (err instanceof CatbusError && err.message.startsWith('浏览器没有响应')) throw new CatbusError('ERROR', `浏览器没有在 ${Math.round((o.launchTimeoutMs ?? LAUNCH_WAIT_MS) / 1000)} 秒内完成启动`, { hint: '确认 youtube.browser 指向的是可以运行的 Chromium' })
      throw err
    })
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = pageOf(cdp, sessionId)

    await page.send('Page.enable')
    await page.send('Network.enable')
    let rejected = 0
    for (const c of o.cookies) {
      const r = await page.send('Network.setCookie', cookieParams(c)).catch(() => ({ success: false }))
      if (!r?.success) rejected++
    }
    if (rejected) o.log.warn(`${rejected} 个 cookie 没有注入浏览器，这些 cookie 在浏览器里不可用`)
    const url = await navigate(page, o.url)
    return {
      url,
      attest: (req) => attest(page, req),
      cookies: async () => {
        // Network 域的命令要在页面会话上发（browser 级会话没有这个方法）
        const { cookies } = await page.send('Network.getAllCookies')
        return cookies.map((c: any) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires > 0 ? c.expires : null }))
      },
      close: stop,
    }
  } catch (err) {
    await stop()
    throw err
  }
}

/** 启动或运行失败：只能是 spawn 报错（不存在、不可执行），统一转成 ERROR。 */
function spawnFailure(executable: string, err: Error): CatbusError {
  const code = (err as NodeJS.ErrnoException).code
  return new CatbusError('ERROR', `无法执行浏览器 ${executable}：${code ?? err.message}`, {
    hint: '确认这个文件是可以运行的 Chromium（有执行权限），或重新设置 youtube.browser',
  })
}

/** 先请求退出，再 SIGTERM，超时后 SIGKILL；进程退出后才返回，profile 才能删除。 */
async function stopProcess(proc: ChildProcess, hasExited: () => boolean): Promise<void> {
  if (proc.pid === undefined) return
  // 主进程已经退出时，子进程仍可能在（例如 sh -c 的 sleep）：仍然向整组发信号
  const signal = (sig: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32') process.kill(-proc.pid!, sig)
      else proc.kill(sig)
    } catch {
      // 进程组已经不存在
    }
  }
  if (!hasExited()) {
    signal('SIGTERM')
    if (await waitExit(proc, STOP_WAIT_MS, hasExited)) return groupGone(proc, signal)
    signal('SIGKILL')
    await waitExit(proc, KILL_WAIT_MS, hasExited)
  }
  await groupGone(proc, signal)
}

/** 等进程组里的子进程都结束（用 kill(-pid, 0) 探测），最多等 KILL_WAIT_MS，之后仍在就 SIGKILL。 */
async function groupGone(proc: ChildProcess, signal: (sig: NodeJS.Signals) => void): Promise<void> {
  if (process.platform === 'win32' || proc.pid === undefined) return
  const alive = () => {
    try {
      process.kill(-proc.pid!, 0)
      return true
    } catch {
      return false
    }
  }
  const deadline = rand.now() + KILL_WAIT_MS
  while (alive() && rand.now() < deadline) await rand.sleep(50)
  if (alive()) signal('SIGKILL')
}

function waitExit(proc: ChildProcess, ms: number, hasExited: () => boolean): Promise<boolean> {
  if (hasExited()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      proc.off('exit', done)
      resolve(hasExited())
    }, ms)
    proc.once('exit', done)
  })
}

/** 删除临时 profile。失败时打 warn 并给出路径，让用户手动删。 */
async function removeProfile(dir: string, log: Logger): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (err) {
    log.warn(`删除浏览器临时目录失败，请手动删除：${dir}（${(err as Error).message}）`)
  }
}

function cookieParams(c: Cookie): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: c.name,
    value: c.value,
    path: c.path || '/',
    secure: true,
    sameSite: 'None',
    httpOnly: HTTP_ONLY.has(c.name),
  }
  // __Host- 前缀的 cookie 不能带 domain，只能用 url
  if (c.name.startsWith('__Host-')) p.url = 'https://www.youtube.com/'
  else p.domain = c.domain
  if (c.expires) p.expires = c.expires
  return p
}

/** 等页面跳转完成：有 body 且地址已是 https。返回最终地址（跳到登录页时也在这里）。 */
async function navigate(page: Page, url: string): Promise<string> {
  // 打开页面是只读的，经代理偶发 TLS 断开时可以再试
  let errorText: string | undefined
  for (let attempt = 1; ; attempt++) {
    errorText = (await page.send('Page.navigate', { url })).errorText
    if (!errorText || attempt >= 3) break
    await rand.sleep(1000 * attempt)
  }
  if (errorText) throw new CatbusError('NETWORK', `浏览器打开 YouTube Studio 失败：${errorText}`, { hint: '检查代理：catbus config get proxy' })
  // 不等 readyState 为 complete：Studio 一直在加载资源，原型实测时 readyState 长时间停在 loading，但页面已经可用
  const deadline = rand.now() + PAGE_WAIT_MS
  while (rand.now() < deadline) {
    try {
      const st = await page.evaluate(`({ href: location.href, hasBody: !!document.body })`)
      if (st.hasBody && /^https:\/\//.test(st.href)) return st.href
    } catch {
      // 页面还在跳转时执行上下文会被销毁，继续等
    }
    await rand.sleep(300)
  }
  throw new CatbusError('UPSTREAM', 'YouTube Studio 页面加载超时', { hint: '检查代理，或稍后重试' })
}

async function attest(page: Page, req: AttestRequest): Promise<string> {
  const name = req.bg.globalName || req.fallbackGlobal
  const loaded = `!!(globalThis[${JSON.stringify(name)}] && typeof globalThis[${JSON.stringify(name)}].a === 'function')`
  if (!(await page.evaluate(loaded))) {
    // Studio 页面开了 Trusted Types，<script src> 注入不了，所以用 Runtime.evaluate 在页面全局求值
    const res = await page.send('Runtime.evaluate', { expression: req.interpreter, returnByValue: true }, 120_000)
    if (res.exceptionDetails) {
      throw new CatbusError('UPSTREAM', `BotGuard interpreter 求值失败：${String(res.exceptionDetails.exception?.description ?? '').split('\n')[0]}`)
    }
    if (!(await page.evaluate(loaded))) throw new CatbusError('UPSTREAM', `BotGuard interpreter 没有定义全局对象 ${name}`)
  }
  const expression = `(${runBotGuard.toString()})(${JSON.stringify(req.bg)}, ${JSON.stringify(req.binding)}, ${PAGE_WAIT_MS}, ${JSON.stringify(req.fallbackGlobal)})`
  let web: unknown
  try {
    web = await page.evaluate(expression, PAGE_WAIT_MS + 30_000)
  } catch (err) {
    throw new CatbusError('UPSTREAM', `BotGuard 在浏览器里失败：${(err as Error).message}`, { hint: '稍后重试；反复失败时换一个代理出口' })
  }
  if (typeof web !== 'string' || !web) throw new CatbusError('UPSTREAM', 'BotGuard 没有返回校验结果')
  return web
}

// ================================================================ CDP（pipe 传输）

interface Page {
  send(method: string, params?: Record<string, unknown>, timeout?: number): Promise<any>
  evaluate(expression: string, timeout?: number): Promise<any>
}

function pageOf(cdp: Cdp, sessionId: string): Page {
  const send = (method: string, params: Record<string, unknown> = {}, timeout?: number) => cdp.send(method, params, { sessionId, timeout })
  return {
    send,
    /** 在页面里求值，返回值按 JSON 取回；页面抛出的异常转成 Error。 */
    async evaluate(expression: string, timeout = 60_000): Promise<any> {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout)
      if (r.exceptionDetails) {
        throw new Error(String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'page exception').split('\n')[0])
      }
      return r.result.value
    },
  }
}

/**
 * CDP 连接：请求用自增 id 对应回包；传输断开（进程退出、管道关闭）时，所有未完成的请求立即以同一个错误 reject。
 */
class Cdp {
  private nextId = 0
  private buffered: Buffer = Buffer.alloc(0)
  private failure: Error | null = null
  private readonly pending = new Map<number, { method: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  constructor(private readonly write: (msg: string) => void) {}

  get closed(): boolean {
    return this.failure !== null
  }

  /** 收到的字节流；0 字节不会出现在 UTF-8 多字节序列里，可以直接按它切分。 */
  feed(chunk: Buffer): void {
    this.buffered = Buffer.concat([this.buffered, chunk])
    let i = this.buffered.indexOf(0)
    while (i >= 0) {
      const raw = this.buffered.subarray(0, i).toString('utf8')
      this.buffered = this.buffered.subarray(i + 1)
      i = this.buffered.indexOf(0)
      if (!raw) continue
      let m: any
      try {
        m = JSON.parse(raw)
      } catch {
        continue
      }
      const p = m.id === undefined ? undefined : this.pending.get(m.id)
      if (!p) continue
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      if (m.error) p.reject(new CatbusError('ERROR', `${p.method}：${m.error.message}`))
      else p.resolve(m.result)
    }
  }

  /** 传输断开：之后的请求直接失败，未完成的请求立即失败。 */
  fail(err: Error): void {
    if (this.failure) return
    this.failure = err
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  send(method: string, params: Record<string, unknown> = {}, opts: { sessionId?: string; timeout?: number } = {}): Promise<any> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CatbusError('ERROR', `浏览器没有响应 ${method}（超时）`))
      }, opts.timeout ?? 60_000)
      this.pending.set(id, { method, resolve, reject, timer })
      const msg: Record<string, unknown> = { id, method, params }
      if (opts.sessionId) msg.sessionId = opts.sessionId
      this.write(JSON.stringify(msg))
    })
  }
}
