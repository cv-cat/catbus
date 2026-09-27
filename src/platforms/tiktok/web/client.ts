import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import type { HttpClient, HttpRequest, HttpResponse } from '../../../core/http.js'
import { unquote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, isGuest } from '../../../core/toolkit.js'
import { type Browser, BROWSER, buildHeaders, COOKIE_DOMAIN, type Headers, type HeaderType, ORIGIN, Params, PROFILE, WEBCAST } from './profile.js'
import { type Metrics, SignerError, signRequest, type TicketGuardState, ticketGuardHeaders } from './sign.js'

/**
 * TikTok web 端的会话（上游 builder/auth.py 的 TiktokAuth + api/tiktok_web.py 的请求骨架）。
 *
 * 凭证文件的 `device` 保存浏览器会话数据，字段名与上游 `.tiktok-runtime.json` 相同（device_id、odin_id、
 * local_storage、session_storage、browser_metrics、ticket_guard_*、secsdk_csrf_token 等），
 * 用 `auth login --cookie @会话.json` 导入。只导入 cookie 字符串时，缺的设备数据在本地补齐（见 {@link TikTok.prepare}）。
 */

export interface Device {
  device_id?: string
  odin_id?: string
  web_id_last_time?: string
  region?: string
  priority_region?: string
  user_agent?: string
  sec_ch_ua?: string
  sec_ch_ua_platform?: string
  accept_language?: string
  client_ab_versions?: string
  document_cookie?: string
  local_storage?: Record<string, string>
  session_storage?: Record<string, string>
  browser_metrics?: Metrics
  shared_cache?: Record<string, unknown>
  ticket_guard_private_key?: string
  ticket_guard_encrypt_ticket?: string
  ticket_guard_ts_sign?: string
  ticket_guard_version?: string
  ticket_guard_iteration_version?: string
  tt_csrf_token?: string
  secsdk_csrf_token?: string
  [key: string]: unknown
}

export interface RequestOptions {
  method: string
  path: string
  params: Params
  referer: string
  signed?: boolean
  body?: string | Uint8Array | null
  origin?: string
  form?: boolean
  accept?: string
  extraHeaders?: Record<string, string>
  ticketGuard?: boolean
  ticketGuardSecCsrf?: boolean
  ticketGuardTtCsrfHeader?: boolean
  contentTypeBeforeMobile?: boolean
  headerOrder?: readonly string[]
  allowEmpty?: boolean
}

const CONTENT_TYPE_BEFORE_MOBILE = [
  'sec-ch-ua-platform', 'referer', 'content-encoding', 'user-agent', 'sec-ch-ua', 'content-type', 'sec-ch-ua-mobile', 'accept',
  'accept-encoding', 'accept-language', 'content-length', 'cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]

function ticketGuardOrder(ttCsrf: boolean): string[] {
  return [
    'tt-ticket-guard-client-data', 'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'tt-ticket-guard-web-version',
    ttCsrf ? 'tt-csrf-token' : '__no_tt_csrf__', 'tt-ticket-guard-version', 'user-agent', 'tt-ticket-guard-public-key', 'x-secsdk-csrf-token',
    'content-type', 'tt-ticket-guard-iteration-version', 'accept', 'accept-encoding', 'accept-language', 'content-length', 'cookie',
    'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
  ]
}

const SV_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const MSTOKEN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function byteLength(body: string | Uint8Array): number {
  return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length
}

export class TikTok {
  readonly http: HttpClient
  readonly jar: CookieJar
  readonly device: Device
  readonly browser: Browser
  /** device_id / odin_id 来自浏览器证据（Tea cache、multi_sids、会话 JSON 或首页引导），不是本地随机的。 */
  private deviceExplicit = false
  private odinExplicit = false
  private deviceAmbiguous = false

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
    this.device = ctx.credential.device as Device
    this.browser = {
      ua: this.device.user_agent || PROFILE.ua,
      secChUa: this.device.sec_ch_ua || PROFILE.secChUa,
      secChUaPlatform: this.device.sec_ch_ua_platform || PROFILE.secChUaPlatform,
      acceptLanguage: this.device.accept_language || PROFILE.acceptLanguage,
    }
    this.syncIds()
  }

  // ---------------------------------------------------------------- 浏览器状态

  get ua(): string {
    return this.browser.ua
  }

  get clientAbVersions(): string {
    return this.device.client_ab_versions || PROFILE.clientAbVersions
  }

  get deviceId(): string {
    return this.device.device_id ?? ''
  }

  get odinId(): string {
    return this.device.odin_id || this.deviceId
  }

  get region(): string {
    return this.device.region || 'SG'
  }

  get priorityRegion(): string {
    return this.device.priority_region ?? 'SG'
  }

  get metrics(): Metrics {
    return this.device.browser_metrics ?? {}
  }

  cookie(name: string): string {
    return this.jar.get(name) ?? ''
  }

  /** 发给所有 tiktok.com 子域的 cookie 串（上游 cookie_str），签名 JS 也读它。 */
  get cookieStr(): string {
    return this.jar.forUrl(ORIGIN + '/').map((c) => `${c.name}=${c.value}`).join('; ')
  }

  /** WebIdLastTime：会话里给出的值，其次是浏览器存储的 g_exp，最后是首次使用的时间（之后固定）。 */
  get webIdLastTime(): string {
    if (this.device.web_id_last_time) return String(this.device.web_id_last_time)
    const gExp = this.device.local_storage?.g_exp ?? this.device.session_storage?.g_exp
    if (gExp != null && /^\d+$/.test(String(gExp))) {
      const v = Number(gExp)
      return String(v > 1e11 ? Math.floor(v / 1000) : v)
    }
    return (this.device.web_id_last_time = String(rand.nowSeconds()))
  }

  /** 查询签名用的 msToken：sessionStorage > localStorage > cookie。 */
  get msToken(): string {
    return this.device.session_storage?.msToken || this.device.local_storage?.msToken || this.cookie('msToken')
  }

  get ttwid(): string {
    return unquote(String(this.metrics.im_ttwid || this.cookie('ttwid') || ''))
  }

  get verifyFp(): string {
    return this.cookie('s_v_web_id')
  }

  get loggedIn(): boolean {
    return Boolean(this.cookie('sessionid') || this.cookie('sid_tt') || this.cookie('multi_sids'))
  }

  /** 当前登录用户的 uid（multi_sids 的第一段）。 */
  get uid(): string {
    const multi = this.cookie('multi_sids')
    return multi ? multi.split('%3A')[0]!.split(':')[0]! : ''
  }

  get ttCsrfToken(): string {
    return this.device.tt_csrf_token || this.cookie('tt_csrf_token')
  }

  get secsdkCsrfToken(): string {
    return this.device.secsdk_csrf_token ?? ''
  }

  /** 上游 _sync_ids_from_cookies：device_id 取会话 > 唯一的 Tea cache > multi_sids。 */
  private syncIds(): void {
    const d = this.device
    if (d.device_id) this.deviceExplicit = true
    if (d.odin_id) this.odinExplicit = true
    if (!d.device_id) {
      const candidates: string[] = []
      for (const storage of [d.local_storage ?? {}, d.session_storage ?? {}]) {
        for (const [key, value] of Object.entries(storage)) {
          if (!key.startsWith('__tea_cache_tokens_')) continue
          try {
            const id = String(JSON.parse(String(value)).web_id ?? '')
            if (/^\d{16,20}$/.test(id) && !candidates.includes(id)) candidates.push(id)
          } catch {}
        }
      }
      if (candidates.length === 1) {
        d.device_id = candidates[0]
        this.deviceExplicit = true
      } else if (candidates.length > 1) this.deviceAmbiguous = true
    }
    const uid = this.uid
    if (!d.device_id && uid) {
      d.device_id = uid
      this.deviceExplicit = true
    }
    if (!d.odin_id && uid) {
      d.odin_id = uid
      this.odinExplicit = true
    }
  }

  /**
   * 签名请求需要的浏览器状态（上游 require_browser_profile）。上游缺什么就报错；catbus 按下面的方式补齐并保存：
   * - device_id / odin_id / WebIdLastTime：请求一次首页，取 hydration 里的 wid / odinId / webIdCreatedTime；
   * - s_v_web_id（verifyFp）：按浏览器格式本地生成；
   * - msToken：本地生成（浏览器里由 mssdk 下发，服务端对只读接口不校验来源）。
   */
  async prepare(): Promise<void> {
    if (this.deviceAmbiguous) {
      throw new CatbusError('USAGE', '会话里的 Tea cache 有多个 device_id', { hint: '在会话 JSON 里显式给出 device_id 后重新登录' })
    }
    if (!this.deviceExplicit || !this.odinExplicit) await this.bootstrap()
    if (!this.verifyFp) this.jar.set('s_v_web_id', svWebId(), COOKIE_DOMAIN)
    if (!this.msToken) this.jar.set('msToken', rand.string(148, MSTOKEN_CHARSET), COOKIE_DOMAIN)
  }

  /** 首页 hydration 的 webapp.app-context：服务端分配的 wid（device_id）与 odinId。 */
  private async bootstrap(): Promise<void> {
    const html = await this.document(ORIGIN + '/', ORIGIN + '/')
    const context = hydration(html)?.['webapp.app-context'] ?? {}
    const d = this.device
    if (!this.deviceExplicit && context.wid) {
      d.device_id = String(context.wid)
      this.deviceExplicit = true
    }
    if (!this.odinExplicit && context.odinId) {
      d.odin_id = String(context.odinId)
      this.odinExplicit = true
    }
    if (!d.web_id_last_time && context.webIdCreatedTime) d.web_id_last_time = String(context.webIdCreatedTime)
    if (!this.deviceExplicit) throw new CatbusError('UPSTREAM', 'TikTok 首页没有返回设备 ID（wid）', { detail: { keys: Object.keys(context) } })
    if (!this.odinExplicit) {
      d.odin_id = d.device_id
      this.odinExplicit = true
    }
  }

  /** tt-ticket-guard：需要浏览器 security-sdk 的私钥与票据，只能从会话 JSON 导入。 */
  ticketGuard(path: string): Record<string, string> {
    const d = this.device
    const state: TicketGuardState = {
      privateKey: d.ticket_guard_private_key ?? '',
      encryptTicket: d.ticket_guard_encrypt_ticket ?? '',
      tsSign: d.ticket_guard_ts_sign ?? '',
      version: d.ticket_guard_version,
      iterationVersion: d.ticket_guard_iteration_version,
    }
    const missing = Object.entries({ ticket_guard_private_key: state.privateKey, ticket_guard_encrypt_ticket: state.encryptTicket, ticket_guard_ts_sign: state.tsSign })
      .filter(([, v]) => !v)
      .map(([k]) => k)
    if (missing.length) throw missingSession(this.ctx, `这个操作需要浏览器 security-sdk 的 ticket-guard 数据（缺少 ${missing.join('、')}）`)
    return ticketGuardHeaders(state, path)
  }

  requireLogin(): void {
    if (!this.loggedIn) throw authError(this.ctx, isGuest(this.ctx) ? undefined : '当前账号缺少 sessionid / sid_tt / multi_sids，请重新登录')
  }

  // ---------------------------------------------------------------- 请求

  headers(type: HeaderType, o: { referer: string; origin?: string; contentLength?: string | null; secFetchSite?: string }): Headers {
    return buildHeaders(type, this.browser, o)
  }

  /** 发送；带 Set-Cookie 的响应由 cookie 罐合并回凭证。 */
  send(req: HttpRequest): Promise<HttpResponse> {
    return this.http.request(req)
  }

  /** 上游 _request_response：组请求头 → 可选 ticket-guard → 签名 → 发送。 */
  async requestResponse(o: RequestOptions): Promise<HttpResponse> {
    const method = o.method.toUpperCase()
    const isWebcast = o.path.startsWith('/webcast/') || o.path.startsWith('/tiktok/event/')
    const requestOrigin = isWebcast ? WEBCAST : ORIGIN
    const body = o.body ?? null
    const type: HeaderType = method === 'POST' && body != null ? (o.form ? 'FORM' : 'POST') : 'GET'
    const h = this.headers(type, {
      referer: o.referer,
      origin: o.origin || (isWebcast ? ORIGIN : ''),
      contentLength: body != null && ['POST', 'PUT', 'PATCH'].includes(method) ? String(byteLength(body)) : null,
      secFetchSite: isWebcast ? 'same-site' : 'same-origin',
    })
    if (o.accept != null) h.set('accept', o.accept)
    if (o.extraHeaders) h.update(o.extraHeaders)
    if (o.headerOrder) h.reorder(o.headerOrder)
    if (o.contentTypeBeforeMobile && !o.ticketGuard) h.reorder(CONTENT_TYPE_BEFORE_MOBILE, true)
    if (o.ticketGuard) {
      const secCsrf = o.ticketGuardSecCsrf ?? true
      const ttCsrf = o.ticketGuardTtCsrfHeader ?? true
      const guard = this.ticketGuard(o.path)
      if (ttCsrf && !this.ttCsrfToken) throw missingSession(this.ctx, '这个写操作需要 tt-csrf-token（cookie tt_csrf_token）')
      if (secCsrf && !this.secsdkCsrfToken) throw missingSession(this.ctx, '这个写操作需要 x-secsdk-csrf-token（会话 JSON 的 secsdk_csrf_token）')
      h.update(guard)
      if (ttCsrf) h.set('tt-csrf-token', this.ttCsrfToken)
      if (secCsrf) h.set('x-secsdk-csrf-token', this.secsdkCsrfToken)
      h.reorder(ticketGuardOrder(ttCsrf), true)
    }
    // 在副本上签名：重试时 o.params 仍是未签名的
    const params = o.params.clone()
    if (o.signed ?? true) {
      let unsigned = params.toQuery()
      if (!unsigned.includes('msToken=')) unsigned += `&msToken=${this.msToken}`
      const url = `${requestOrigin}${o.path}?${unsigned}`
      try {
        params.update(signRequest({ url, method, body, userAgent: this.ua, referer: o.referer, metrics: this.metrics }))
      } catch (err) {
        if (err instanceof SignerError) throw new CatbusError('ERROR', `${o.path} 纯计算签名失败：${err.message}`)
        throw err
      }
    }
    return this.send({ method, url: `${requestOrigin}${o.path}?${params.toQuery()}`, headers: h.pairs(), body: body ?? undefined })
  }

  /** 上游 _request_json：HTTP 错误、空响应、业务错误码映射成 catbus 的错误。 */
  async requestJson<T = any>(o: RequestOptions): Promise<T> {
    const res = await this.requestResponse(o)
    try {
      return await this.json<T>(res, { allowEmpty: o.allowEmpty, path: o.path })
    } catch (err) {
      // 新设备的头几次请求偶尔拿到空响应；只读请求重签一次
      if (!(err instanceof CatbusError && err.code === 'RISK_CONTROL' && (err.detail as { kind?: string })?.kind === 'blocked' && o.method.toUpperCase() === 'GET')) throw err
      this.ctx.log.debug(`${o.path} 返回空响应，重试一次`)
      await rand.sleep(1500)
      return this.json<T>(await this.requestResponse(o), { allowEmpty: o.allowEmpty, path: o.path })
    }
  }

  async json<T = any>(res: HttpResponse, o: { allowEmpty?: boolean; path?: string } = {}): Promise<T> {
    const text = await res.text()
    if (res.status === 429) throw new CatbusError('RISK_CONTROL', 'TikTok 限流（HTTP 429），请稍后再试', { detail: { kind: 'rate_limit', status: 429 } })
    if (!text) {
      if (res.status >= 400) throw new CatbusError('UPSTREAM', `TikTok 返回 HTTP ${res.status}`, { detail: { status: res.status, path: o.path } })
      if (o.allowEmpty) return { http_status: res.status, status_code: null, empty_response: true } as T
      throw new CatbusError('RISK_CONTROL', 'TikTok 返回了空响应（签名或设备环境被拒绝）', { detail: { kind: 'blocked', path: o.path } })
    }
    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      throw new CatbusError('UPSTREAM', `TikTok 返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, path: o.path, body: text.slice(0, 300) } })
    }
    check(this.ctx, body)
    if (res.status >= 400) throw new CatbusError('UPSTREAM', `TikTok 返回 HTTP ${res.status}`, { detail: { status: res.status, path: o.path, body: text.slice(0, 300) } })
    return body as T
  }

  /** 页面 HTML（上游 get_user_html）。 */
  async document(url: string, referer = url): Promise<string> {
    const res = await this.send({ url, headers: this.headers('DOC', { referer }).pairs() })
    if (res.status >= 400) throw new CatbusError('UPSTREAM', `TikTok 页面返回 HTTP ${res.status}`, { detail: { status: res.status, url } })
    return res.text()
  }

}

/** 业务状态码：status_code / statusCode 非 0 时报错。 */
export function check(ctx: HandlerContext, body: any): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return
  const code = body.status_code ?? body.statusCode
  // privacy config 这类接口用 statusCode: 200 表示成功
  if (code == null || code === 0 || code === '0' || code === 200) return
  const message = String(body.status_msg ?? body.statusMsg ?? body.message ?? '')
  const c = Number(code)
  // 8：Login expired；20003：webcast 的 User doesn't login
  if (c === 8 || c === 20003) throw authError(ctx, isGuest(ctx) ? undefined : message || undefined)
  if (c === 10000) {
    throw new CatbusError('RISK_CONTROL', `TikTok 风控拦截：${message || code}`, { detail: { kind: 'captcha', code, message } })
  }
  throw new CatbusError('UPSTREAM', message || `TikTok 返回错误 ${code}`, { detail: { code, message } })
}

function missingSession(ctx: HandlerContext, message: string): CatbusError {
  const account = isGuest(ctx) ? '' : ` -a ${ctx.account}`
  return new CatbusError('AUTH_REQUIRED', message, { hint: `用浏览器会话 JSON 重新登录：catbus tiktok auth login${account} --cookie @tiktok-session.json` })
}

/** s_v_web_id：`verify_<base36 毫秒>_<8>_<4>_4<3>_[89ab]<3>_<12>`。 */
export function svWebId(): string {
  const ts = rand.now().toString(36)
  const r = (n: number) => rand.string(n, SV_CHARSET)
  return `verify_${ts}_${r(8)}_${r(4)}_4${r(3)}_${rand.choice('89ab')}${r(3)}_${r(12)}`
}

/** 页面里的 `__UNIVERSAL_DATA_FOR_REHYDRATION__`，返回 `__DEFAULT_SCOPE__`。 */
export function hydration(html: string): Record<string, any> | null {
  const m = /<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) return null
  try {
    return JSON.parse(m[1]!).__DEFAULT_SCOPE__ ?? null
  } catch {
    return null
  }
}

/** 建立会话，补齐签名请求需要的设备数据（见 {@link TikTok.prepare}）。 */
export async function tiktok(ctx: HandlerContext): Promise<TikTok> {
  const t = new TikTok(ctx)
  await t.prepare()
  return t
}

