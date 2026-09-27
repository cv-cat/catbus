import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HttpClient, type HttpRequest, type HttpResponse, parseJson } from '../../../core/http.js'
import { compactJson, type Pairs } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, isGuest, scope } from '../../../core/toolkit.js'
import * as api from './api.js'
import { fingerCore, fingerPayload } from './gaia.js'
import { API, BROWSER, COOKIE_DOMAIN, COOKIE_ORDER, headers, PROFILE } from './profile.js'
import { bLsid, correspondPath, dmImgParams, encWbi, liveBuvid, mixinKey, murmur3Hex, sid, TICKET_KEY_ID, ticketHexSign, uuidInfoc } from './sign.js'

/**
 * B 站 web 端的会话（上游 builder/auth.py 的 BiliAuth + utils/http_util.py）：
 * 设备 cookie、bili_ticket、WBI 密钥的生命周期，以及带风控退避重试的请求。
 */

/** 触发重试的业务错误码与 HTTP 状态（上游 RETRYABLE_CODES / RETRYABLE_STATUS）。 */
const RETRYABLE_CODES = new Set([-352, -799, -509, -412])
const RETRYABLE_STATUS = new Set([412, 429, 502, 503, 504])

/** WBI 密钥缓存半小时。 */
const MIXIN_TTL = 1800_000
/** bili_ticket 提前 1 小时换新。 */
const TICKET_SKEW = 3600

export interface BiliJson<T = any> {
  code: number
  message?: string
  msg?: string
  data: T
  [key: string]: unknown
}

export class Bili {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows', cookieOrder: COOKIE_ORDER })
    this.jar = this.http.jar!
  }

  get csrf(): string {
    return this.jar.get('bili_jct') ?? ''
  }

  get mid(): string {
    return this.jar.get('DedeUserID') ?? ''
  }

  get isLogin(): boolean {
    return Boolean(this.jar.get('SESSDATA'))
  }

  private setCookie(name: string, value: string): void {
    this.jar.set(name, value, COOKIE_DOMAIN)
  }

  private setDefault(name: string, value: () => string): void {
    if (!this.jar.has(name)) this.setCookie(name, value())
  }

  // ---------------------------------------------------------------- 设备初始化

  /**
   * 每条命令开始时调用，相当于上游的 `from_cookie()` / `anonymous()`：
   * - 没有设备 cookie 的游客：完整跑一遍匿名设备初始化（spi → bili_ticket → 指纹上报），结果缓存在 guest.json；
   * - 登录用户缺设备 cookie 时补齐；
   * - 会话级的 sid / PVID / b_lsid 每次重新生成（b_lsid）或补齐。
   */
  async init(): Promise<void> {
    if (isGuest(this.ctx) && !this.jar.has('buvid3')) {
      await this.anonymous()
      return
    }
    if (!this.jar.has('buvid3')) {
      for (const [name, value] of await this.deviceCookies()) this.setDefault(name, () => value)
    }
    // 上游 `cookie.setdefault('sid', gen_sid())` 总会先算出 gen_sid()，随机数照样消耗
    const newSid = sid()
    this.setDefault('sid', () => newSid)
    this.setDefault('PVID', () => '1')
    this.setCookie('b_lsid', bLsid())
    if (isGuest(this.ctx) && Number(this.jar.get('bili_ticket_expires') ?? 0) - TICKET_SKEW < rand.nowSeconds()) {
      await this.refreshTicket()
    }
  }

  private async anonymous(): Promise<void> {
    this.jar.cookies.splice(0)
    for (const [name, value] of await this.deviceCookies()) this.setCookie(name, value)
    await this.refreshTicket()
    await this.reportFinger()
  }

  /** 服务端只下发 buvid3 / buvid4，其余由浏览器 JS 本地生成（上游 build_device_cookies）。 */
  private async deviceCookies(): Promise<[string, string][]> {
    const spi = await this.get<{ b_3: string; b_4: string }>(`${API}/x/frontend/finger/spi`, { headers: headers('GET').get() })
    return [
      ['buvid3', spi.b_3],
      ['b_nut', String(rand.nowSeconds())],
      ['_uuid', uuidInfoc()],
      ['home_feed_column', '5'],
      ['buvid4', spi.b_4],
      ['browser_resolution', PROFILE.browserResolution],
      ['buvid_fp', murmur3Hex(compactJson(fingerCore()))],
      ['LIVE_BUVID', liveBuvid()],
      ['theme-tip-show', 'SHOWED'],
      ['CURRENT_FNVAL', '4048'],
      ['sid', sid()],
      ['PVID', '1'],
      ['ogv_device_support_dolby', '0'],
      ['ogv_device_support_hdr', '0'],
      ['b_lsid', bLsid()],
    ]
  }

  /** 换取 bili_ticket，响应里顺带的 WBI 密钥一并缓存（上游 refresh_ticket）。 */
  async refreshTicket(): Promise<void> {
    const ts = rand.nowSeconds()
    const data = await this.post<{ ticket: string; created_at?: number; ttl?: number; nav?: { img?: string; sub?: string } }>(
      `${API}/bapis/bilibili.api.ticket.v1.Ticket/GenWebTicket`,
      {
        headers: headers('POST').get(),
        query: [
          ['key_id', TICKET_KEY_ID],
          ['hexsign', ticketHexSign(ts)],
          ['context[ts]', ts],
          ['csrf', this.csrf],
        ],
      },
    )
    const expires = Number(data.created_at ?? rand.nowSeconds()) + Number(data.ttl ?? 259200)
    this.setCookie('bili_ticket', data.ticket)
    this.setCookie('bili_ticket_expires', String(expires))
    if (data.nav?.img && data.nav.sub) this.saveMixin(mixinKey(data.nav.img, data.nav.sub))
  }

  /** 明文指纹上报 ExClimbWuzhi。失败只记日志：它只影响风控评分，不影响功能。 */
  async reportFinger(referer = 'https://www.bilibili.com/'): Promise<void> {
    const h = headers('POST', { accept: '*/*' }).referer(referer).set('content-type', 'application/json;charset=UTF-8')
    try {
      const payload = compactJson(fingerPayload(this.jar.get('_uuid') ?? '', referer))
      await this.post(`${API}/x/internal/gaia-gateway/ExClimbWuzhi`, { headers: h.get(), json: { payload } }, { raw: true })
    } catch (err) {
      this.ctx.log.debug(`ExClimbWuzhi 上报失败：${(err as Error).message}`)
    }
  }

  // ---------------------------------------------------------------- WBI

  private saveMixin(key: string): void {
    this.ctx.credential.extra.wbi = { key, at: rand.now() }
  }

  /** 当前的 mixin_key：缓存半小时，过期后从 nav 重新派生。 */
  async mixinKey(): Promise<string> {
    const cached = this.ctx.credential.extra.wbi as { key: string; at: number } | undefined
    if (cached?.key && rand.now() - cached.at < MIXIN_TTL) return cached.key
    const nav = await this.json<{ wbi_img?: { img_url: string; sub_url: string } }>({ url: `${API}/x/web-interface/nav`, headers: headers('GET').get() })
    const img = nav.data?.wbi_img
    if (!img?.img_url) throw new CatbusError('UPSTREAM', 'nav 没有返回 wbi_img，无法签名', { detail: { code: nav.code } })
    const key = mixinKey(img.img_url, img.sub_url)
    this.saveMixin(key)
    return key
  }

  /** 签名后的 query：原参数顺序 + w_rid + wts。 */
  async wbi(params: Pairs): Promise<Pairs> {
    return encWbi(params, await this.mixinKey())
  }

  /** 带 dm_img_* 指纹再签名，空间类接口需要。 */
  async wbiDm(params: Pairs, sampleCount = 0): Promise<Pairs> {
    return this.wbi([...params, ...dmImgParams(sampleCount)])
  }

  // ---------------------------------------------------------------- 请求

  /** 带风控退避重试的原始请求（上游 http_util.request）。 */
  async request(req: HttpRequest, retries = 3): Promise<HttpResponse> {
    let res!: HttpResponse
    for (let attempt = 0; attempt <= retries; attempt++) {
      res = await this.http.request(req)
      if (res.status === 200) {
        const code = await peekCode(res)
        if (code === undefined || !RETRYABLE_CODES.has(code)) return res
      } else if (!RETRYABLE_STATUS.has(res.status)) return res
      if (attempt < retries) await rand.sleep(1000 * 2 ** attempt)
    }
    return res
  }

  /** 请求并解析 JSON，不检查业务码。 */
  async json<T = any>(req: HttpRequest): Promise<BiliJson<T>> {
    const res = await this.request(req)
    if (res.status === 412 || res.status === 429) {
      throw new CatbusError('RISK_CONTROL', `B 站拒绝了请求（HTTP ${res.status}），请稍后再试`, { detail: { kind: 'rate_limit', status: res.status } })
    }
    return parseJson<BiliJson<T>>(res)
  }

  /** 请求并检查业务码，返回 data。raw 为 true 时返回整个 JSON。 */
  async call<T = any>(req: HttpRequest, options: { raw?: boolean } = {}): Promise<T> {
    const body = await this.json<T>(req)
    check(this.ctx, body)
    return (options.raw ? body : body.data) as T
  }

  get<T = any>(url: string, req: Omit<HttpRequest, 'url' | 'method'> = {}, options?: { raw?: boolean }): Promise<T> {
    return this.call<T>({ ...req, url, method: 'GET' }, options)
  }

  post<T = any>(url: string, req: Omit<HttpRequest, 'url' | 'method'> = {}, options?: { raw?: boolean }): Promise<T> {
    return this.call<T>({ ...req, url, method: 'POST' }, options)
  }

  /** 写操作前检查登录态（registry 已保证不是游客，这里防 cookie 不全）。 */
  requireLogin(): void {
    if (!this.isLogin || !this.csrf) throw authError(this.ctx, '当前账号缺少 SESSDATA / bili_jct，请重新登录')
  }
}

async function peekCode(res: HttpResponse): Promise<number | undefined> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return undefined
  try {
    const body = JSON.parse(await res.clone().text())
    return typeof body?.code === 'number' ? body.code : undefined
  } catch {
    return undefined
  }
}

/** 业务码映射成 catbus 的错误（AGENTS 6.4）。 */
export function check(ctx: HandlerContext, body: BiliJson): void {
  const code = body?.code
  if (code === 0 || code === undefined) return
  const message = String(body.message ?? body.msg ?? '')
  if (code === -101 || code === -111 || code === 86095) throw authError(ctx, message || undefined)
  if (RETRYABLE_CODES.has(code) || code === -412) {
    throw new CatbusError('RISK_CONTROL', `B 站风控拦截：${message || code}`, { detail: { kind: 'blocked', code, message } })
  }
  if (code === 340022 || code === 10031 || code === -625) {
    throw new CatbusError('RISK_CONTROL', `需要人机验证：${message || code}`, { detail: { kind: 'captcha', code, message } })
  }
  throw new CatbusError('UPSTREAM', message || `B 站返回错误 ${code}`, { detail: { code, message } })
}

/**
 * Cookie 续期（上游 refresh_cookies）：每天最多检查一次 cookie/info，需要时换新的 SESSDATA 并确认。
 * 失败只记警告，当前 cookie 往往还能用一阵。
 */
async function refreshCookies(b: Bili): Promise<void> {
  const tokens = scope(b.ctx.credential).tokens
  const old = tokens.refresh_token as string | undefined
  if (!old || !b.isLogin) return
  const checked = Number(b.ctx.credential.extra.refresh_checked_at ?? 0)
  if (rand.now() - checked < 86_400_000) return
  b.ctx.credential.extra.refresh_checked_at = rand.now()
  try {
    const info = await api.cookieInfo(b)
    if (info.code !== 0 || !info.data?.refresh) return
    const csrf = await api.refreshCsrf(b, correspondPath(info.data.timestamp || rand.now()))
    if (!csrf) throw new Error('correspond 页面没有返回 refresh_csrf')
    const r = await api.cookieRefresh(b, csrf, old)
    if (r.code !== 0) throw new Error(`cookie/refresh 返回 ${r.code} ${r.message ?? ''}`)
    tokens.refresh_token = r.data?.refresh_token ?? ''
    await api.confirmRefresh(b, old)
    b.ctx.log.info('登录态已自动续期')
  } catch (err) {
    b.ctx.log.warn(`登录态续期失败：${(err as Error).message}`)
  }
}

/** 建立会话，完成设备初始化；登录用户顺带做每日一次的续期检查。 */
export async function bili(ctx: HandlerContext): Promise<Bili> {
  const b = new Bili(ctx)
  await b.init()
  await refreshCookies(b)
  return b
}
