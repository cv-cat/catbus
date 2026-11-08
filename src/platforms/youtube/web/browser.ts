import { openChromium, type Page } from '../../../core/chromium.js'
import { CatbusError } from '../../../core/errors.js'
import type { Logger } from '../../../core/log.js'
import * as rand from '../../../core/rand.js'
import type { Cookie } from '../../../core/schemas.js'
import { type BgChallenge, runBotGuard } from './botguard.js'

export { findChrome, chromeProxyArg } from '../../../core/chromium.js'

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
async function openBrowser(o: OpenOptions): Promise<BrowserSession> {
  const { page, close: stop } = await openChromium(o)
  try {
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
