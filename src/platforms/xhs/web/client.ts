import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HttpClient, type HttpRequest, type HttpResponse, parseJson } from '../../../core/http.js'
import { compactJson, pyStr, type Scalar, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Credential } from '../../../core/schemas.js'
import { authError, httpClient, isGuest, scope } from '../../../core/toolkit.js'
import { checkSign, rapParam, signFull } from './js.js'
import {
  AS,
  BROWSER,
  BUSINESS_LANG,
  COOKIE_DOMAIN,
  EDITH,
  type Headers,
  LOGIN_LANG,
  orderedHeaders,
  PC_ORDER,
  SEC_CH_UA,
  UA,
  WEB,
  XHR_ACCEPT,
} from './profile.js'
import { PcState, type Storage } from './state.js'

/**
 * PC 主站的会话（上游 xhs_utils/xhs_pc：XHSPcAuth + PcDeviceProfile + params.generate_request_params）。
 *
 * cookie：凭证 scope 里的 cookie 就是上游的 cookie_map，除 `acw_tc` 外都放在 `.xiaohongshu.com`；
 * `acw_tc` 与上游 HostCookieStore 一样只对下发它的主机生效。发往各主机的 cookie 按存入顺序排列。
 */

const HOST_ONLY = new Set(['acw_tc'])
const PC_TIERS = { '0101': [205], '0201': [208], '0301': [200] } as Record<string, number[]>

/** 带 RAP 的接口（浏览器实抓：需要 x-rap-param）与带 xy-direction 的接口。 */
const RAP_PATHS = ['api/sns/web/v1/homefeed', 'api/sns/web/v1/search/notes', 'api/sns/web/v2/search/notes', 'api/sns/web/v1/user_posted', 'api/sns/web/v1/feed', 'api/sns/web/v1/comment/post']
const XY_PATHS = ['api/sns/web/v1/homefeed', 'api/sns/web/v1/feed']
const CACHE_PATHS = ['/api/sns/web/v1/config', '/api/sns/web/v1/system/config', '/api/sns/web/v2/user/me']

const pathOf = (api: string) => api.split('?', 1)[0]!.replace(/\/+$/, '').replace(/^\/+/, '')
export const needsRap = (api: string) => RAP_PATHS.some((m) => (m.includes('user_posted') ? pathOf(api).includes(m) : pathOf(api) === m))
export const needsXy = (api: string) => XY_PATHS.includes(pathOf(api))

/** 上游 splice_str：`api?urlencode(params)`，None 写成空串。 */
export function splice(api: string, params: Record<string, Scalar>, safe = ''): string {
  return `${api}?${urlencode(Object.entries(params).map(([k, v]) => [k, v == null ? '' : v] as [string, Scalar]), { safe })}`
}

// ---------------------------------------------------------------- trace id

let pcXraySeq = Math.floor(rand.random() * 0x7fffff)
let coreXraySeq = Math.floor(rand.random() * 0x7fffff)

/** 对拍用：上游两份模块级自增序号（xhs_pc/params.py、xhs_core/params.py）。 */
export function resetXraySeq(n: number): void {
  pcXraySeq = coreXraySeq = n
}

/** x-xray-traceid：hex16((now<<23)|seq) + hex16(random64)。 */
export function xrayTraceId(which: 'pc' | 'core' = 'pc'): string {
  const seq = which === 'pc' ? (pcXraySeq = (pcXraySeq + 1) & 0x7fffff) : (coreXraySeq = (coreXraySeq + 1) & 0x7fffff)
  const part1 = ((BigInt(rand.now()) << 23n) | BigInt(seq)) & 0xffffffffffffffffn
  const hi = BigInt(Math.floor(rand.random() * 2 ** 32))
  const lo = BigInt(Math.floor(rand.random() * 2 ** 32))
  return part1.toString(16).padStart(16, '0') + ((hi << 32n) | lo).toString(16).padStart(16, '0')
}

export const b3TraceId = () => rand.string(16, 'abcdef0123456789')

/** PC 端 xy-direction = murmurHash3_32(userId, 151488) % 100 + 1。 */
export function xyDirection(userId: string): number {
  if (!userId) return 0
  const data = Buffer.from(userId, 'utf8')
  let h = 151488
  const mul = Math.imul
  const nblocks = data.length >> 2
  for (let i = 0; i < nblocks; i++) {
    let k = data.readUInt32LE(i * 4)
    k = mul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = mul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (mul(h, 5) + 0xe6546b64) | 0
  }
  let k = 0
  const t = nblocks * 4
  const rem = data.length & 3
  if (rem === 3) k ^= data[t + 2]! << 16
  if (rem >= 2) k ^= data[t + 1]! << 8
  if (rem >= 1) {
    k ^= data[t]!
    k = mul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = mul(k, 0x1b873593)
    h ^= k
  }
  h ^= data.length
  h ^= h >>> 16
  h = mul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = mul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return ((h >>> 0) % 100) + 1
}

// ---------------------------------------------------------------- 签名头（上游 generate_request_params）

export interface SignedHeaders {
  headers: Headers
  body: string
}

/** 上游 get_request_headers_template。 */
function template(context: Record<string, any>, hasBody: boolean, clientHints: boolean, trace: boolean): Headers {
  const h: Headers = {
    referer: `${WEB}/`,
    'x-t': '',
    'x-s-common': '',
    'user-agent': context.userAgent ?? UA,
    accept: XHR_ACCEPT,
    'x-s': '',
    'accept-language': BUSINESS_LANG,
    origin: WEB,
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  }
  if (trace) {
    h['x-xray-traceid'] = xrayTraceId('pc')
    h['x-b3-traceid'] = ''
  }
  if (clientHints) {
    h['sec-ch-ua-platform'] = '"Windows"'
    h['sec-ch-ua'] = context.secChUa ?? SEC_CH_UA
    h['sec-ch-ua-mobile'] = '?0'
  }
  if (hasBody) h['content-type'] = 'application/json;charset=UTF-8'
  return h
}

/**
 * X-s / X-t / X-S-Common + 请求头模板（上游 generate_headers）。data 为对象时按 JSON 签名，
 * 返回的 body 是紧凑 JSON（ensure_ascii=False）。
 */
export function pcSignedHeaders(
  state: PcState,
  api: string,
  data: unknown,
  o: { b1: string; dslPair: string; context: Record<string, any>; userId?: string; xy?: boolean; clientHints?: boolean; trace?: boolean },
): SignedHeaders {
  const a1 = state.cookies.a1
  if (!a1) throw new CatbusError('ERROR', '小红书 cookie 缺少 a1')
  const tier = o.context.tier as string
  const input: Record<string, unknown> = { api, data: data ?? '', cookie: state.documentCookie, a1, b1: o.b1, dslPair: o.dslPair, tier }
  for (const k of ['now', 'version', 'loadts', 'seq', 'envConst', 'envFpTail', 'webBuild', 'signVersion', 'appId', 'platform', 'deviceTag', 'webSsk']) {
    if (k in o.context) input[k] = o.context[k]
  }
  const r = checkSign(signFull(input), tier, PC_TIERS[tier]!)
  if (!r.xs_common) throw new CatbusError('ERROR', '小红书 X-S-Common 生成失败')
  const b3 = b3TraceId()
  const hasBody = data !== '' && data != null
  const headers = template(o.context, hasBody, o.clientHints ?? true, o.trace ?? true)
  headers['x-s'] = r.xs
  headers['x-t'] = String(r.xt)
  headers['x-s-common'] = r.xs_common
  headers['x-b3-traceid'] = b3
  if (o.xy) {
    if (!o.userId) throw new CatbusError('ERROR', '该接口需要 xy-direction，缺少 user_id')
    headers['xy-direction'] = String(xyDirection(o.userId))
  }
  const body = !hasBody ? '' : typeof data === 'string' ? data : compactJson(data)
  return { headers, body }
}

/** 上游 build_pc_business_headers：按有无 client hints / RAP / xy-direction / c_device_id 选实抓顺序。 */
export function businessOrder(headers: Headers, method: string): string[] {
  const has = (k: string) => Object.keys(headers).some((x) => x.toLowerCase() === k)
  const get = method.toUpperCase() === 'GET'
  const hints = has('sec-ch-ua-platform')
  let order: string[]
  if (!hints && has('c_device_id')) order = PC_ORDER.cdeviceGet
  else if (has('xy-direction')) order = PC_ORDER.xyRapPost
  else if (has('x-rap-param')) order = get ? PC_ORDER.rapGet : PC_ORDER.rapPost
  else if (!hints) order = get ? PC_ORDER.businessGet : PC_ORDER.businessPost
  else order = get ? PC_ORDER.signedGet : PC_ORDER.signedPost
  if (!has('content-type')) order = order.filter((k) => k !== 'content-type')
  order = [...order]
  if (has('cache-control') && !order.includes('cache-control')) order.splice(order.indexOf(order.includes('cookie') ? 'cookie' : 'origin'), 0, 'cache-control')
  if (has('pragma') && !order.includes('pragma')) order.splice(order.includes('priority') ? order.indexOf('priority') : order.length, 0, 'pragma')
  return order
}

// ---------------------------------------------------------------- 会话

export interface XhsJson<T = any> {
  success?: boolean
  code?: number
  msg?: string
  data: T
  [key: string]: unknown
}

const DSL_TTL = 300_000
const GETDSS = /function\s+getdss\s*\(\s*\)\s*\{\s*return\s+'(\d+)'/

/** 发请求并按上游规则合并响应 cookie 的基类（PC、Creator 共用）。 */
export class Session {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(
    readonly ctx: HandlerContext,
    readonly scopeName = 'main',
    browser: string = BROWSER,
    apiOrigin: string = EDITH,
  ) {
    this.http = httpClient(ctx, { browser: browser as any, os: 'windows', scope: scopeName })
    this.jar = this.http.jar!
    // 导入的整串 cookie 都落在默认域上；acw_tc 按上游归到 api 源（cookie_source_url 默认值）
    for (const c of this.jar.cookies) if (HOST_ONLY.has(c.name) && c.domain.startsWith('.')) c.domain = new URL(apiOrigin).hostname
  }

  /** 换掉整组共享 cookie（上游用新的 cookie dict 重建 profile）：已有的名字留在原位，host-only 的保留，其余追加。 */
  replaceShared(values: Record<string, string>): void {
    const kept = this.jar.cookies.filter((c) => HOST_ONLY.has(c.name) || c.name in values)
    for (const c of kept) if (!HOST_ONLY.has(c.name)) c.value = values[c.name]!
    const names = new Set(kept.map((c) => c.name))
    this.jar.cookies.splice(0, this.jar.cookies.length, ...kept)
    for (const [k, v] of Object.entries(values)) if (!names.has(k)) this.jar.set(k, v, COOKIE_DOMAIN)
  }

  get credential(): Credential {
    return this.ctx.credential
  }

  /** 共享 cookie（上游 cookie_map），按存入顺序。 */
  shared(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const c of this.jar.cookies) if (!HOST_ONLY.has(c.name) && !(c.name in out)) out[c.name] = c.value
    return out
  }

  /** 发往某个 URL 的 cookie（上游 cookies_for_url）。 */
  wire(url: string): Record<string, string> {
    return this.jar.toObject(url)
  }

  setCookie(name: string, value: string): void {
    const existing = this.jar.cookies.find((c) => c.name === name && !HOST_ONLY.has(name))
    if (existing) existing.value = value
    else this.jar.set(name, value, COOKIE_DOMAIN)
  }

  /** 发送；响应的 Set-Cookie 除 acw_tc 外一律归到 `.xiaohongshu.com`（上游 merge_response）。 */
  /**
   * 发送。bare 为 true 时去掉 core/http 自动补的 `Content-Type: application/octet-stream`
   * （上游 requests 发 `data=str` 且头里没有 content-type 时不补）。
   */
  async send(req: HttpRequest, appendShared: string[] = [], bare = false): Promise<HttpResponse> {
    const before = this.jar.cookies.length
    // 请求头里的 cookie 由调用方按上游规则组好；没有 cookie 头时也不从罐子里补
    const res = bare ? await this.bareRequest({ cookies: false, ...req }) : await this.http.request({ cookies: false, ...req })
    const host = new URL(res.url || req.url).hostname
    const added = this.jar.cookies.splice(before)
    // 已有 cookie 被 Set-Cookie 原地更新的情况：jar 已处理；新增的按上游规则归域
    for (const c of added) {
      if (HOST_ONLY.has(c.name)) {
        c.domain = host
        const i = this.jar.cookies.findIndex((x) => x.name === c.name && x.domain === host)
        if (i >= 0) this.jar.cookies[i] = c
        else this.jar.cookies.push(c)
        continue
      }
      const i = this.jar.cookies.findIndex((x) => x.name === c.name && !HOST_ONLY.has(x.name))
      if (i >= 0) {
        if (appendShared.includes(c.name)) {
          this.jar.cookies.splice(i, 1)
          this.jar.cookies.push({ ...c, domain: COOKIE_DOMAIN })
        } else this.jar.cookies[i]!.value = c.value
      } else this.jar.cookies.push({ ...c, domain: COOKIE_DOMAIN })
    }
    this.afterResponse()
    return res
  }

  private async bareRequest(req: HttpRequest): Promise<HttpResponse> {
    const http = this.http as unknown as { prepare: HttpClient['prepare'] }
    const prepare = http.prepare
    http.prepare = (r: HttpRequest) => {
      const p = prepare.call(this.http, r)
      p.headers = p.headers.filter(([k, v]) => !(k === 'Content-Type' && v === 'application/octet-stream'))
      return p
    }
    try {
      return await this.http.request(req)
    } finally {
      http.prepare = prepare
    }
  }

  /** 子类在响应 cookie 合并后同步状态。 */
  protected afterResponse(): void {}

  async json<T = any>(req: HttpRequest, appendShared: string[] = [], bare = false): Promise<XhsJson<T>> {
    const res = await this.send(req, appendShared, bare)
    checkStatus(res)
    return parseJson<XhsJson<T>>(res)
  }

  /** 业务码检查（AGENTS 6.4），返回 data。 */
  check<T>(body: XhsJson<T>): T {
    if (body?.success !== false && (body?.code === undefined || body.code === 0 || body.code === 1000)) return body?.data
    const code = body.code
    const message = String(body.msg ?? (body as any).message ?? '')
    if (code === -100 || code === -101 || code === -104 || /登录|未登录|login/i.test(message)) throw authError(this.ctx, message || undefined)
    if (code === 300012 || code === 300013 || code === 300015 || code === 461 || code === 471 || /验证|captcha/i.test(message)) {
      throw new CatbusError('RISK_CONTROL', `小红书风控：${message || code}`, { detail: { kind: 'captcha', code, message } })
    }
    if (code === 300011 || /频繁|异常/.test(message)) {
      throw new CatbusError('RISK_CONTROL', `小红书风控：${message || code}`, { detail: { kind: 'blocked', code, message } })
    }
    throw new CatbusError('UPSTREAM', message || `小红书返回错误 ${code}`, { detail: { code, message } })
  }
}

/**
 * 风控状态码（AGENTS 6.4）：461 / 471 要求人机验证（响应体照样是 success，data 为空），406 / 429 是限流。
 * 响应头里的 verifytype / verifyuuid 放进 detail。
 */
export function checkStatus(res: HttpResponse, hint?: string): void {
  if (res.status === 461 || res.status === 471) {
    const verify = Object.fromEntries(
      [['verify_type', 'verifytype'], ['verify_uuid', 'verifyuuid']].flatMap(([key, header]) => {
        const v = res.headers.get(header!)
        return v ? [[key, v]] : []
      }),
    )
    throw new CatbusError('RISK_CONTROL', `小红书要求人机验证（HTTP ${res.status}）`, { hint, detail: { kind: 'captcha', status: res.status, ...verify } })
  }
  if (res.status === 406 || res.status === 429) {
    throw new CatbusError('RISK_CONTROL', `小红书拒绝了请求（HTTP ${res.status}），请稍后再试`, { hint, detail: { kind: 'rate_limit', status: res.status } })
  }
}

export class Pc extends Session {
  state: PcState

  constructor(ctx: HandlerContext) {
    super(ctx, 'main')
    const device = (ctx.credential.device.pc ?? {}) as { local?: Storage; session?: Storage }
    this.state = new PcState(this.shared(), device.local, device.session)
  }

  /** 用当前共享 cookie 重建签名状态（上游 _new_profile），不带已保存的 storage。 */
  resetState(): void {
    this.state = new PcState(this.shared())
  }

  get isLogin(): boolean {
    return Boolean(this.state.cookies.a1 && this.state.cookies.web_session)
  }

  /** 当前用户 id：登录账号取凭证里的 user，游客取游客初始化时 user/me 的结果。 */
  get userId(): string {
    return this.credential.user?.id ?? String(this.credential.extra.user_id ?? '')
  }

  set userId(id: string) {
    this.credential.extra.user_id = id
  }

  /** 共享 cookie 变化同步到签名状态（上游 update_cookies 的副作用：loadts / ets / websectiga / gid）。 */
  sync(): void {
    const updates: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.shared())) if (this.state.cookies[k] !== v) updates[k] = v
    this.state.updateCookies(updates)
  }

  protected override afterResponse(): void {
    this.sync()
  }

  /** 持久化签名状态（localStorage / sessionStorage 的等价物）。 */
  save(): void {
    this.credential.device.pc = this.state.storage()
  }

  // ---------------------------------------------------------------- _dsl

  /** window._dsl：as.xiaohongshu.com/api/sec/v1/ds 的 getdss()，5 分钟缓存（上游 xhs_pc/dsl.py）。 */
  async dsl(force = false): Promise<string> {
    const cached = this.credential.extra.pc_dsl as { value: string; at: number } | undefined
    if (!force && cached?.value && rand.now() - cached.at < DSL_TTL) return cached.value
    const res = await this.send({
      url: `${AS}/api/sec/v1/ds?appId=xhs-pc-web`,
      headers: [
        ['User-Agent', UA],
        ['Referer', `${WEB}/`],
        ['Accept', '*/*'],
        ['accept-encoding', 'gzip, deflate, br, zstd'],
      ],
      cookies: false,
    })
    const value = GETDSS.exec(await res.text())?.[1]
    if (!value) {
      if (cached?.value) return cached.value
      throw new CatbusError('UPSTREAM', '小红书 ds 接口没有返回 getdss()，无法签名')
    }
    this.credential.extra.pc_dsl = { value, at: rand.now() }
    return value
  }

  // ---------------------------------------------------------------- 业务请求（上游 XHS_Apis._request_params）

  /** 登录态检查（上游 validate）：没有 a1 / web_session 时，游客去做初始化，账号报登录失效。 */
  requireSession(): void {
    if (!this.state.cookies.a1 || !this.state.cookies.web_session) throw authError(this.ctx, '小红书 cookie 缺少 a1 或 web_session')
    // 签名把 a1 打进定长的 mns 包里，长度不对的 a1 必然签不出来（上游同样卡在 mns 长度门禁）
    if (this.state.cookies.a1.length !== 52) throw authError(this.ctx, `小红书 cookie 里的 a1 长度不对（${this.state.cookies.a1.length}，应为 52）`)
  }

  async signedRequest(
    api: string,
    data: unknown,
    method: 'GET' | 'POST',
    o: { origin?: string; extra?: Record<string, string>; contentType?: string } = {},
  ): Promise<{ url: string; headers: [string, string][]; body: string }> {
    this.sync()
    this.requireSession()
    const xy = needsXy(api)
    if (xy && !this.userId) await this.bootstrap()
    const context = this.state.nextSignContext(api)
    const b1 = this.state.currentB1(context.now)
    const dslPair = this.state.dslPair(await this.dsl(), rand.now())
    const signed = pcSignedHeaders(this.state, api, data, { b1, dslPair, context, userId: this.userId, xy, clientHints: false })
    let headers = signed.headers
    if (CACHE_PATHS.includes(api.split('?', 1)[0]!)) {
      headers['cache-control'] = 'no-cache'
      headers.pragma = 'no-cache'
    }
    if (needsRap(api)) headers['x-rap-param'] = rapParam(api, signed.body)
    for (const [k, v] of Object.entries(o.extra ?? {})) headers[k] = v
    if (o.contentType) headers['content-type'] = o.contentType
    const url = (o.origin ?? EDITH) + api
    const cookies = this.wire(url)
    const pairs = orderedHeaders(headers, businessOrder(headers, method), cookies)
    const ua = pairs.findIndex(([k]) => k === 'user-agent')
    pairs[ua] = ['user-agent', context.userAgent ?? UA]
    return { url, headers: pairs, body: signed.body }
  }

  /** 签名、发送、解析 JSON（不检查业务码）。 */
  async request<T = any>(api: string, data: unknown = '', method: 'GET' | 'POST' = 'GET', o: Parameters<Pc['signedRequest']>[3] = {}): Promise<XhsJson<T>> {
    const r = await this.signedRequest(api, data, method, o)
    return this.json<T>({ method, url: r.url, headers: r.headers, ...(method === 'POST' ? { body: r.body } : {}) })
  }

  /** 签名、发送并检查业务码，返回 data。 */
  async call<T = any>(api: string, data: unknown = '', method: 'GET' | 'POST' = 'GET', o: Parameters<Pc['signedRequest']>[3] = {}): Promise<T> {
    return this.check(await this.request<T>(api, data, method, o))
  }

  /** 上游 bootstrap：user/me 写入 user_id（算 xy-direction 用）。 */
  async bootstrap(): Promise<string> {
    const me = await this.call<any>('/api/sns/web/v2/user/me')
    const id = String(me?.user_id ?? '')
    if (!id) throw new CatbusError('UPSTREAM', 'user/me 没有返回 user_id')
    if (!this.credential.user) this.userId = id
    return id
  }

  // ---------------------------------------------------------------- 登录链路的签名（上游 XHSLoginApi._signed_request_params）

  loginB1 = ''
  webprofileReported = false
  private loginDsl = ''

  async loginSigned(
    api: string,
    data: unknown = '',
    method: 'GET' | 'POST' = 'POST',
    o: { secDomain?: boolean; tier?: string; trace?: boolean; includeB1?: boolean; mnsProfile?: string } = {},
  ): Promise<SignedHeaders> {
    this.sync()
    const context = this.state.nextSignContext(api, { tier: o.tier, mnsProfile: o.mnsProfile })
    const includeB1 = o.includeB1 ?? Boolean(this.loginB1 || this.webprofileReported)
    if (includeB1 && !this.loginB1) this.loginB1 = this.state.currentB1(context.now, 'login')
    const b1 = includeB1 ? this.loginB1 : ''
    if (!this.loginDsl) this.loginDsl = await this.dsl()
    const dslPair = this.state.lastTiga ? this.state.dslPair(this.loginDsl, context.now) : `null;${this.loginDsl}`
    const signed = pcSignedHeaders(this.state, api, data, { b1, dslPair, context })
    signed.headers['accept-language'] = LOGIN_LANG
    if (o.secDomain) {
      const names = ['x-s', 'x-t', 'x-s-common', ...((o.trace ?? true) ? ['x-b3-traceid', 'x-xray-traceid'] : [])]
      const keep = Object.fromEntries(names.map((k) => [k, signed.headers[k]!]))
      signed.headers = { ...secHeaders(context, method), ...keep }
    }
    return signed
  }

  setLoginDsl(value: string): void {
    this.loginDsl = value
  }
}

/** 上游 XHSLoginApi._get_sec_headers。 */
export function secHeaders(context: Record<string, any>, method: string): Headers {
  const h: Headers = {
    'sec-ch-ua-platform': '"Windows"',
    referer: `${WEB}/`,
    'sec-ch-ua': context.secChUa ?? SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'user-agent': context.userAgent ?? UA,
    accept: XHR_ACCEPT,
    'accept-language': LOGIN_LANG,
    origin: WEB,
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  }
  if (method.toUpperCase() !== 'GET') h['content-type'] = 'application/json;charset=UTF-8'
  return h
}

/** 上游 build_pc_login_headers。 */
export function loginOrder(headers: Headers, kind: 'post' | 'get' | 'get-login-mode' | 'security' | 'sem' | 'honeypot'): string[] {
  let order =
    kind === 'honeypot'
      ? PC_ORDER.honeypot
      : kind === 'security'
        ? PC_ORDER.security
        : kind === 'sem'
          ? PC_ORDER.sem
          : kind === 'get'
            ? PC_ORDER.signedGet
            : kind === 'get-login-mode'
              ? ['sec-ch-ua-platform', 'x-login-mode', ...PC_ORDER.signedGet.slice(1)]
              : PC_ORDER.signedPost
  if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) order = order.filter((k) => k !== 'content-type')
  return order
}

/** 当前命令是否以游客身份访问（凭证 method 为 guest）。 */
export const guestOf = (ctx: HandlerContext) => isGuest(ctx)

/** 凭证某个 scope 是否有 cookie。 */
export const hasScope = (credential: Credential, name: string) => (credential.scopes[name]?.cookies.length ?? 0) > 0

export { pyStr, scope }
