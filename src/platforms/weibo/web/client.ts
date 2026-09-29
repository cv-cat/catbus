import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import type { HttpClient, HttpRequest, HttpResponse } from '../../../core/http.js'
import { quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient } from '../../../core/toolkit.js'
import { MOBILE, visitorHeaders, WEB } from './profile.js'

/**
 * 微博 web 端的会话。上游每个方法直接接收 cookie 字符串，没有会话对象；这里统一管理 cookie。
 *
 * weibo.com 用登录 cookie（web 端不支持游客态，AGENTS 5.2）。m.weibo.cn 用访客身份：上游的 WeiboMobileApis
 * 不带 cookie 访问 m.weibo.cn，现在会被 302 到访客页、搜索直接要求登录，所以这里用新浪访客系统 genvisitor2
 * 下发的访客 SUB / SUBP（上游没有），缓存在凭证里。登录 cookie 属于 .weibo.com，本来就不发往 m.weibo.cn。
 */

export type Site = 'com' | 'cn'

const SITE_URL: Record<Site, string> = { com: `${WEB}/`, cn: `${MOBILE}/` }

/** m.weibo.cn 的访客页。 */
const VISITOR = { host: 'visitor.passport.weibo.cn', entry: 'sinawap', domain: '.weibo.cn' }

export interface WeiboJson {
  ok?: number
  msg?: string
  message?: string
  url?: string
  [key: string]: any
}

export class Weibo {
  readonly http: HttpClient
  readonly jar: CookieJar
  /** 本次命令里刚生成过访客 cookie：再遇到登录墙就不再重试。 */
  private fresh = false

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx)
    this.jar = this.http.jar!
  }

  /** weibo.com 的 XSRF-TOKEN，没有时为空串（上游缺它会直接报错）。 */
  get xsrf(): string {
    return this.jar.forUrl(SITE_URL.com).find((c) => c.name === 'XSRF-TOKEN')?.value ?? ''
  }

  /** 是否带着登录 cookie（weibo.com 的 SUB）。 */
  get isLogin(): boolean {
    return this.hasSub('com')
  }

  /** 上游的 `cookies=` 会把整串 cookie 发给任何域名（包括 weibocdn.com），这里按 weibo.com 取。 */
  webCookies(): Record<string, string> {
    return this.jar.toObject(SITE_URL.com)
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    return this.http.request(req)
  }

  // ---------------------------------------------------------------- 访客

  private hasSub(site: Site): boolean {
    return this.jar.forUrl(SITE_URL[site]).some((c) => c.name === 'SUB')
  }

  /** m.weibo.cn 还没有访客 cookie 时先生成。 */
  async ensure(site: Site): Promise<void> {
    if (site === 'cn' && !this.hasSub('cn')) await this.visitor()
  }

  /** 生成 m.weibo.cn 的访客身份：与访客页里 ufp.util.postData 发出的 genvisitor2 请求一致，SUB / SUBP 由 Set-Cookie 写进 cookie 罐。 */
  async visitor(): Promise<void> {
    const v = VISITOR
    const origin = `https://${v.host}`
    const referer = `${origin}/visitor/visitor?entry=${v.entry}&a=enter&url=${quote(SITE_URL.cn, '')}&domain=${v.domain}`
    for (const c of this.jar.forUrl(SITE_URL.cn).filter((x) => x.name === 'SUB' || x.name === 'SUBP')) this.jar.delete(c.name, c.domain)
    const res = await this.request({
      method: 'POST',
      url: `${origin}/visitor/genvisitor2`,
      headers: visitorHeaders(origin, referer),
      form: [
        ['cb', 'visitor_gray_callback'],
        ['ver', '20250916'],
        ['request_id', ''],
        ['tid', ''],
        ['from', 'weibo'],
        ['webdriver', 'false'],
        ['rid', String(rand.now())],
        ['return_url', SITE_URL.cn],
      ],
    })
    riskCheck(res.status)
    const text = await res.text()
    let body: { retcode?: number; msg?: string } | null = null
    try {
      body = JSON.parse(/\((\{[\s\S]*\})\)/.exec(text)?.[1] ?? 'null')
    } catch {}
    if (body?.retcode !== 20000000 || !this.hasSub('cn')) {
      throw new CatbusError('RISK_CONTROL', `生成微博访客身份失败：${body?.msg ?? `HTTP ${res.status}`}`, {
        detail: { kind: 'blocked', status: res.status, retcode: body?.retcode ?? null },
      })
    }
    this.fresh = true
    this.ctx.log.debug(`已生成微博访客身份（${v.host}）`)
  }

  /** m.weibo.cn 的访客 cookie 可能已失效：本次还没重新生成过时，重新生成并返回 true。 */
  private async renewVisitor(site: Site): Promise<boolean> {
    if (site !== 'cn' || this.fresh) return false
    await this.visitor()
    return true
  }

  // ---------------------------------------------------------------- 请求

  /**
   * 请求 JSON 接口，检查登录墙与业务错误，返回整个 JSON。
   * m.weibo.cn 的访客身份遇到登录墙（ok=-100）时，重新生成一次访客身份再试。
   */
  async json<T extends WeiboJson = WeiboJson>(site: Site, req: HttpRequest): Promise<T> {
    await this.ensure(site)
    let body = await this.parse<T>(await this.request(req))
    if (body.ok === -100 && (await this.renewVisitor(site))) body = await this.parse<T>(await this.request(req))
    check(this.ctx, body, site)
    return body
  }

  /**
   * 请求 HTML 页面，默认不跟随跳转。访客身份被 302 到访客页时，重新生成一次访客身份再试。
   */
  async html(site: Site, req: HttpRequest): Promise<{ status: number; location: string | null; text: string }> {
    await this.ensure(site)
    let res = await this.request({ redirect: 'manual', ...req })
    if (isVisitorRedirect(res) && (await this.renewVisitor(site))) res = await this.request({ redirect: 'manual', ...req })
    riskCheck(res.status)
    return { status: res.status, location: res.headers.get('location'), text: await res.text() }
  }

  private async parse<T>(res: HttpResponse): Promise<T> {
    const text = await res.text()
    try {
      return JSON.parse(text) as T
    } catch {
      riskCheck(res.status)
      throw new CatbusError('UPSTREAM', `微博返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, body: text.slice(0, 300) } })
    }
  }

  /** 写操作前检查登录态（registry 已保证有账号，这里防 cookie 不全）。 */
  requireLogin(): void {
    if (!this.isLogin) throw authError(this.ctx, '当前账号缺少登录 cookie（SUB），请重新登录')
  }
}

function isVisitorRedirect(res: HttpResponse): boolean {
  return res.status >= 300 && res.status < 400 && /\/visitor\/visitor/.test(res.headers.get('location') ?? '')
}

/** 没有正文的拦截状态码：432 是微博的反爬拦截。 */
export function riskCheck(status: number): void {
  if (status === 432 || status === 418 || status === 429) {
    throw new CatbusError('RISK_CONTROL', `微博拒绝了请求（HTTP ${status}），请稍后再试`, {
      detail: { kind: status === 429 ? 'rate_limit' : 'blocked', status },
    })
  }
}

/** 登录墙与业务错误映射成 catbus 的错误（AGENTS 6.4）。 */
export function check(ctx: HandlerContext, body: WeiboJson, site: Site = 'com'): void {
  const ok = body?.ok
  if (ok === undefined || ok === 1) return
  const message = String(body.message ?? body.msg ?? '')
  if (ok === -100 || /登录/.test(message)) {
    // m.weibo.cn 只用访客身份访问，登录 weibo.com 也解决不了
    if (site === 'cn') throw new CatbusError('AUTH_REQUIRED', `m.weibo.cn 要求登录后查看${message ? `：${message}` : ''}`)
    throw authError(ctx, message ? `微博要求登录：${message}` : undefined)
  }
  if (/拥堵|频繁|稍后/.test(message)) {
    throw new CatbusError('RISK_CONTROL', `微博限流：${message}`, { detail: { kind: 'rate_limit', ok, message } })
  }
  throw new CatbusError('UPSTREAM', message || `微博返回错误 ok=${ok}`, { detail: { ok, errno: body.errno ?? null, message } })
}
