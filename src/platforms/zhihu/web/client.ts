import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { buildUrl, type HttpClient, type HttpResponse } from '../../../core/http.js'
import { jsonLoads, type PairsInit } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient } from '../../../core/toolkit.js'
import { apiHeaders, BROWSER, navigationHeaders, udidHeaders, WWW } from './profile.js'
import { zse96 } from './sign.js'

/**
 * 知乎 web 端的会话。登录态是 cookie 里的 z_c0；`/api` 下的请求都带 x-zse-96 签名，签名用到 cookie d_c0，
 * 写操作另带 `_xsrf` cookie 的值（x-xsrftoken）。d_c0、_xsrf 缺了就按前端的做法补一个，Set-Cookie 写回凭证。
 */

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: PairsInit
  json?: unknown
  /** 默认是首页。 */
  referer?: string
}

export interface Paging {
  is_end?: boolean
  next?: string
  totals?: number
}

export class Zhihu {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
  }

  /** 是否带着登录 cookie z_c0。 */
  get isLogin(): boolean {
    return this.cookie('z_c0') != null
  }

  /** 发往 www.zhihu.com 时会带上的 cookie 值。jar.get 不看过期时间：用过期的 d_c0 签名、请求里却不带它，服务端会判签名不对。 */
  private cookie(name: string): string | undefined {
    return this.jar.forUrl(`${WWW}/`).find((c) => c.name === name)?.value
  }

  /** d_c0 参与签名。只导入了 z_c0 等少数 cookie 时，用 `POST /udid` 换一个。 */
  async dc0(): Promise<string> {
    let value = this.cookie('d_c0')
    if (value) return value
    const res = await this.http.request({ method: 'POST', url: `${WWW}/udid`, headers: udidHeaders() })
    riskCheck(res.status)
    // 带着失效的 z_c0 时 /udid 返回 401
    if (res.status === 401) throw authError(this.ctx)
    value = this.cookie('d_c0')
    if (!value) throw new CatbusError('UPSTREAM', `没有拿到知乎的设备标识 d_c0（HTTP ${res.status}）`, { detail: { status: res.status } })
    return value
  }

  /** 写操作要带 `_xsrf`；cookie 里没有时打开一次首页，由 Set-Cookie 下发。 */
  async xsrf(): Promise<string> {
    let value = this.cookie('_xsrf')
    if (value) return value
    const res = await this.http.request({ url: `${WWW}/`, headers: navigationHeaders() })
    riskCheck(res.status)
    value = this.cookie('_xsrf')
    if (!value) throw new CatbusError('UPSTREAM', '没有拿到知乎的 _xsrf', { detail: { status: res.status } })
    return value
  }

  /**
   * 请求 `/api` 下的 JSON 接口：签名、检查登录墙与业务错误，返回整个 JSON。`path` 可以带 query（翻页的 cursor）。
   * 没有 z_c0 时不发请求：匿名请求在机房 IP 上常被要求人机验证，报出来的就不是真正的原因（没登录）了。
   */
  async api<T = any>(path: string, req: ApiRequest = {}): Promise<T> {
    this.requireLogin()
    const method = req.method ?? 'GET'
    const url = buildUrl(`${WWW}${path}`, req.query)
    const u = new URL(url)
    // 请求体参与签名，发出去的必须和签名用的是同一串字节：自己序列化，不交给 HttpClient 的 json
    const body = req.json === undefined ? undefined : JSON.stringify(req.json)
    const dc0 = await this.dc0()
    const xsrf = method === 'GET' ? null : await this.xsrf()
    const headers = apiHeaders({ zse96: zse96(u.pathname + u.search, dc0, body), referer: req.referer ?? `${WWW}/`, xsrf, json: body !== undefined })
    const res = await this.http.request({ method, url, headers, body })
    return this.parse<T>(res)
  }

  private async parse<T>(res: HttpResponse): Promise<T> {
    const text = await res.text()
    let body: any = {}
    if (text.trim()) {
      try {
        body = jsonLoads(text)
      } catch {
        riskCheck(res.status)
        throw new CatbusError('UPSTREAM', `知乎返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, body: text.slice(0, 300) } })
      }
    }
    check(this.ctx, res.status, body)
    return body as T
  }

  /** 检查登录 cookie（registry 已保证有账号，这里防 cookie 不全或已被服务端清掉）。 */
  private requireLogin(): void {
    if (!this.isLogin) throw authError(this.ctx, '当前账号缺少登录 cookie（z_c0），请重新登录')
  }
}

/** 没有 JSON 正文的拦截。 */
export function riskCheck(status: number): void {
  if (status === 429) {
    throw new CatbusError('RISK_CONTROL', '知乎限流（HTTP 429），请稍后再试', { detail: { kind: 'rate_limit', status } })
  }
}

/** 知乎要求验证码 / 判定异常请求时的业务码。 */
const CAPTCHA = new Set([40352])
const BLOCKED = new Set([40362])
/** 签名校验失败（前端把 10001、10002 记为 VerifyFailed）。 */
const BAD_SIGNATURE = new Set([10001, 10002, 10003])

/** 登录墙、风控与业务错误映射成 catbus 的错误（AGENTS 6.4）。 */
export function check(ctx: HandlerContext, status: number, body: any): void {
  const e = body?.error
  if (status < 400 && !e) return
  const code = typeof e?.code === 'number' ? e.code : null
  const message = String(e?.message ?? '')
  const detail = { status, code, message }
  if (code != null && CAPTCHA.has(code)) {
    const verify = typeof e.redirect === 'string' ? e.redirect : null
    throw new CatbusError('RISK_CONTROL', `知乎要求人机验证：${message}`, {
      hint: verify ? `在登录了同一账号的浏览器里打开 ${verify} 完成验证后重试` : '在浏览器里打开知乎完成验证后重试',
      detail: { kind: 'captcha', ...detail, verify_url: verify },
    })
  }
  if (code != null && BLOCKED.has(code)) {
    throw new CatbusError('RISK_CONTROL', `知乎拒绝了请求：${message}`, { hint: '降低请求频率，过一段时间再试', detail: { kind: 'blocked', ...detail } })
  }
  if (status === 429) throw new CatbusError('RISK_CONTROL', `知乎限流：${message || 'HTTP 429'}`, { detail: { kind: 'rate_limit', ...detail } })
  if (status === 401 || e?.need_login === true || code === 100 || code === 101) {
    throw authError(ctx, message ? `知乎要求登录：${message}` : undefined)
  }
  if (code != null && BAD_SIGNATURE.has(code)) {
    throw new CatbusError('UPSTREAM', `知乎拒绝了请求签名：${message}`, { hint: '知乎可能更新了签名算法，请升级 catbus', detail })
  }
  if (status === 404) throw new CatbusError('UPSTREAM', message || '内容不存在或已删除', { detail })
  throw new CatbusError('UPSTREAM', message || `知乎返回错误（HTTP ${status}）`, { detail })
}

/**
 * 翻页：知乎的列表都带 `paging.next`（完整的下一页地址）。cursor 用它的路径和 query，原样请求即可。
 * 搜索的 next 指向 App 接口 `api.zhihu.com/search_v3`，换成网页接口 `www.zhihu.com/api/v4/search_v3`；
 * 其他不在 `/api` 下的地址当作没有下一页。
 */
export function nextCursor(paging: Paging | undefined): string | null {
  if (!paging || paging.is_end !== false || !paging.next) return null
  try {
    const u = new URL(paging.next, WWW)
    const path = u.hostname === 'api.zhihu.com' && !u.pathname.startsWith('/api/') ? `/api/v4${u.pathname}` : u.pathname
    return path.startsWith('/api/') ? path + u.search : null
  } catch {
    return null
  }
}

/** `--cursor` 只接受本命令接口下的路径（由 nextCursor 生成），防止把请求发到别的接口。 */
export function cursorPath(cursor: string, prefix: string): string {
  const u = new URL(cursor, WWW)
  if (u.origin !== WWW || !u.pathname.startsWith(prefix)) {
    throw new CatbusError('USAGE', '--cursor 不是这个命令返回的 page.cursor')
  }
  return u.pathname + u.search
}
