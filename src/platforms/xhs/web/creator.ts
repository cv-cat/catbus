import { CatbusError } from '../../../core/errors.js'
import { compactJson, type Scalar, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { endpointFlag } from '../../../core/auth-store.js'
import { b3TraceId, Session, xrayTraceId, type XhsJson } from './client.js'
import { checkSign, signFull } from './js.js'
import { AS, CREATOR, CREATOR_BROWSER, CREATOR_ORDER, type Headers, LOGIN_LANG, orderedHeaders, UA, XHR_ACCEPT } from './profile.js'
import { CreatorState, DS_REFRESH_MS, type Storage } from './state.js'

/**
 * 创作者中心的会话（上游 xhs_utils/xhs_creator：XHSCreatorAuth + CreatorDeviceProfile + params）。
 * 凭证在 `creator` scope（AGENTS 5.3）；签名状态存在凭证的 `device.creator`。
 */

const CREATOR_TIERS: Record<string, number[]> = { '0201': [200], '0101': [196, 197, 198] }
const GETDSS = /function\s+getdss\s*\(\s*\)\s*\{\s*return\s+'(\d+)'/
const DS_TTL = 300_000
const AUTH_COOKIES = ['customer-sso-sid', 'access-token-creator.xiaohongshu.com', 'galaxy_creator_session_id', 'web_session']

/** 发布页请求的 cookie 顺序（Chrome 152）。 */
export const PUBLISH_COOKIE_ORDER = [
  'abRequestId', 'ets', 'a1', 'webId', 'gid', 'x-rednote-datactry', 'x-rednote-holderctry', '_gray_did', 'id_token',
  'customer-sso-sid', 'x-user-id-creator.xiaohongshu.com', 'customerClientId', 'access-token-creator.xiaohongshu.com',
  'galaxy_creator_session_id', 'galaxy.creator.beaker.session.id', 'web_session', 'unread', 'webBuild', 'xsecappid', 'acw_tc',
  'websectiga', 'sec_poison_id', 'loadts',
]

/** Creator 的 splice_str：query 值里的 `:` 不转义。 */
export const cspl = (api: string, params: Record<string, Scalar>) => `${api}?${urlencode(Object.entries(params).map(([k, v]) => [k, v ?? ''] as [string, Scalar]), { safe: ':' })}`

export interface CreatorSignOptions {
  tier?: string
  b1Profile?: string
  mnsProfile?: string
  origin?: string
  referer?: string
  site?: string
  clientHints?: boolean
  trace?: boolean
  authorization?: boolean
  includeOrigin?: boolean
  b1Value?: string
  dslPairValue?: string
}

/** 上游 get_request_headers_template（Creator）。 */
function template(method: string, o: CreatorSignOptions): Headers {
  const h: Headers = {
    'user-agent': UA,
    accept: XHR_ACCEPT,
    'accept-language': LOGIN_LANG,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': o.site ?? 'same-site',
    referer: o.referer ?? `${CREATOR}/`,
    priority: 'u=1, i',
  }
  if (o.authorization ?? true) h.authorization = ''
  if (o.trace ?? true) {
    h['x-b3-traceid'] = b3TraceId()
    h['x-xray-traceid'] = xrayTraceId('core')
  }
  if (o.includeOrigin ?? method.toUpperCase() !== 'GET') h.origin = o.origin ?? CREATOR
  if (method.toUpperCase() !== 'GET') h['content-type'] = 'application/json'
  if (o.clientHints) {
    h['sec-ch-ua'] = '"Not;A=Brand";v="8", "Chromium";v="152", "Google Chrome";v="152"'
    h['sec-ch-ua-mobile'] = '?0'
    h['sec-ch-ua-platform'] = '"Windows"'
  }
  return h
}

export class Creator extends Session {
  state: CreatorState

  constructor(ctx: HandlerContext) {
    super(ctx, 'creator', CREATOR_BROWSER, CREATOR)
    const device = (ctx.credential.device.creator ?? {}) as { local?: Storage }
    this.state = new CreatorState(this.shared(), device.local)
  }

  resetState(): void {
    this.state = new CreatorState(this.shared())
  }

  sync(): void {
    const updates: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.shared())) if (this.state.cookies[k] !== v) updates[k] = v
    this.state.updateCookies(updates)
  }

  protected override afterResponse(): void {
    this.sync()
  }

  save(): void {
    this.credential.device.creator = { local: this.state.storage() }
  }

  /** 缺 creator scope 时报 AUTH_REQUIRED，hint 带 --scope creator（AGENTS 5.3）。 */
  requireScope(): void {
    const c = this.state.cookies
    if (c.a1 && AUTH_COOKIES.some((k) => c[k])) return
    const account = this.ctx.account && this.ctx.account !== 'guest' ? ` -a ${this.ctx.account}` : ''
    throw new CatbusError('AUTH_REQUIRED', '需要登录小红书创作者中心', { hint: `catbus xhs auth login --scope creator${account}${endpointFlag(this.ctx.endpoint)}` })
  }

  /** 服务端 DS 程序与 _dsl（appId=ugc），5 分钟缓存（上游 xhs_creator/dsl.py）。 */
  async dsBundle(force = false): Promise<{ dsl: string; program: string }> {
    const cached = this.credential.extra.creator_ds as { dsl: string; program: string; at: number } | undefined
    if (!force && cached?.dsl && cached.program && rand.now() - cached.at < DS_TTL) return cached
    const res = await this.send({
      url: `${AS}/api/sec/v1/ds?appId=ugc`,
      headers: [
        ['User-Agent', UA],
        ['Referer', `${CREATOR}/`],
        ['Accept', '*/*'],
        ['accept-encoding', 'gzip, deflate, br, zstd'],
      ],
    })
    const text = await res.text()
    const dsl = GETDSS.exec(text)?.[1]
    if (!dsl || !(text.includes('_dsf') || text.includes('__$c'))) {
      if (cached?.dsl) return cached
      throw new CatbusError('UPSTREAM', '小红书 ds 接口（ugc）没有返回 DS 程序，无法签名')
    }
    const bundle = { dsl, program: text, at: rand.now() }
    this.credential.extra.creator_ds = bundle
    return bundle
  }

  /** 上游 ensure_ds_material：安全就绪后保证 _dsl 与 _dsf 程序都在。 */
  async ensureDs(force = false): Promise<void> {
    if (!this.state.securityReady) return
    const stale = rand.now() - this.state.dsllt >= DS_REFRESH_MS
    if (!force && !stale && this.state.dsl && this.state.dsProgram) return
    const refresh = force || stale
    const b = await this.dsBundle(refresh)
    if (refresh || !this.state.dsl) this.state.dsl = b.dsl
    this.state.dsProgram = b.program
    if (refresh) this.state.dsllt = rand.now()
  }

  /** 上游 generate_profile_request_params：签名 + 头模板，返回 headers 与紧凑 body。 */
  async sign(api: string, data: unknown, method: string, o: CreatorSignOptions = {}, ensure = true): Promise<{ headers: Headers; body: string }> {
    this.sync()
    if (!this.state.cookies.a1) throw new CatbusError('ERROR', '创作者中心 cookie 缺少 a1')
    if (ensure && this.state.resolveMaterial(o.tier, o.mnsProfile).material.deviceTag !== 'nop') await this.ensureDs()
    const context = this.state.nextSignContext(o.tier, o.mnsProfile)
    const b1 = o.b1Value ?? this.state.currentB1(context.now, o.b1Profile)
    const dslPair = o.dslPairValue ?? this.state.dslPair(context.now)
    if (context.tier === '0101' && context.deviceTag !== 'nop' && !context.dsProgram) throw new CatbusError('ERROR', 'Creator mns0101 需要服务端下发的 DS 程序')
    const input: Record<string, unknown> = { api, data: data ?? '', cookie: Object.entries(this.state.cookies).map(([k, v]) => `${k}=${v}`).join('; '), b1, dslPair, tier: context.tier }
    for (const k of ['now', 'version', 'loadts', 'seq', 'envConst', 'envFpTail', 'deviceTag', 'b1b1', 'signCount', 'webBuild', 'signVersion', 'appId', 'platform', 'dsProgram', 'xt']) {
      if (k in context) input[k] = context[k]
    }
    if (context.dsProgram) input.dsfProgram = context.dsProgram
    const r = checkSign(signFull(input), context.tier, CREATOR_TIERS[context.tier]!, 'Creator X-s')
    if (!r.xs_common) throw new CatbusError('ERROR', 'Creator X-S-Common 生成失败')
    const headers = template(method, o)
    headers['x-s'] = r.xs
    headers['x-t'] = String(r.xt)
    headers['x-s-common'] = r.xs_common
    const body = data === '' || data == null ? '' : typeof data === 'string' ? data : compactJson(data)
    return { headers, body }
  }

  /** 发往 creator.xiaohongshu.com 的 cookie 按发布页顺序重排。 */
  wireFor(url: string): Record<string, string> {
    const cookies = this.wire(url)
    if (!url.startsWith(CREATOR)) return cookies
    const out: Record<string, string> = {}
    for (const k of PUBLISH_COOKIE_ORDER) if (k in cookies) out[k] = cookies[k]!
    for (const [k, v] of Object.entries(cookies)) if (!(k in out)) out[k] = v
    return out
  }

  /**
   * 上游 XHS_Creator_Apis._request_params：b1 默认用 login 快照、XHR 不带 sec-ch-ua*，UA 固定 Chrome 152。
   * order 为 null 时不排序（post_note 带 x-rap-param，上游没有核实过它的头顺序）。
   */
  async business(
    api: string,
    data: unknown,
    method: 'GET' | 'POST',
    o: CreatorSignOptions & { target?: string; order?: string[] | null; extra?: Headers; storeOrder?: boolean } = {},
  ): Promise<{ url: string; headers: [string, string][]; body: string }> {
    this.requireScope()
    const signed = await this.sign(api, data, method, { b1Profile: 'login', origin: CREATOR, referer: `${CREATOR}/`, site: 'same-site', ...o, clientHints: false })
    signed.headers['accept-language'] = LOGIN_LANG
    const url = (o.target ?? CREATOR) + api
    // 笔记管理页的请求再经 cookies_for_url 一次，回到存入顺序
    const cookies = o.storeOrder ? this.wire(url) : this.wireFor(url)
    let headers = { ...signed.headers, ...(o.extra ?? {}) }
    headers['user-agent'] = UA
    let pairs: [string, string][]
    if (o.order === null) {
      // 不排序：dict 顺序，cookie 由 curl_cffi 的 cookies= 附上（accept-encoding 由调用方补在最后）
      const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
      pairs = Object.entries(headers).filter((p): p is [string, string] => p[1] != null)
      if (cookie) pairs.push(['cookie', cookie])
    } else pairs = orderedHeaders(headers, o.order ?? (method === 'GET' ? CREATOR_ORDER.get : CREATOR_ORDER.post), cookies)
    const ua = pairs.findIndex(([k]) => k === 'user-agent')
    if (ua >= 0) pairs[ua] = ['user-agent', UA]
    return { url, headers: pairs, body: signed.body }
  }

  async request<T = any>(api: string, data: unknown = '', method: 'GET' | 'POST' = 'GET', o: Parameters<Creator['business']>[3] = {}): Promise<XhsJson<T>> {
    const r = await this.business(api, data, method, o)
    return this.json<T>({ method, url: r.url, headers: r.headers, ...(method === 'POST' ? { body: r.body } : {}) })
  }
}
