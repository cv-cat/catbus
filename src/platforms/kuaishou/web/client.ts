import { CatbusError } from '../../../core/errors.js'
import { type HeaderPairs, HttpClient, type HttpResponse } from '../../../core/http.js'
import { compactJson, jsonLoads, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Cookie, Credential } from '../../../core/schemas.js'
import { authError, scope } from '../../../core/toolkit.js'
import {
  BROWSER,
  buildHeaders,
  CP,
  ID_HOST,
  LIVE,
  LIVE_SENTRY_BAGGAGE,
  PRODUCT_CP,
  PRODUCT_LIVE,
  PRODUCT_WWW,
  PUBLISH_REFERER,
  RECO_REFERER,
  WWW,
} from './profile.js'
import { graphqlRiskAsRest, isRisk, passCaptcha } from './captcha.js'
import { type LiveContext, reportFingerprint, Session } from './session.js'
import {
  axiosQuery,
  buildSignInput,
  CAVER,
  CP_PROJECT_INFO,
  cpNeedSign,
  HxFalconSigner,
  liveNeedSign,
  liveSignUrl,
  loginNeedSign,
  needSig3,
  needSign,
  SDK_VERSION_LIVE,
  Sig3Signer,
} from './sign.js'

/**
 * 快手 web 端的一次会话（一条命令一个）：凭证 ↔ 上游的 KuaishouAuth 状态，四个站点的请求器，
 * 以及进程级签名器（上游 utils/ks_util.py 的单例；这里一条命令一个页面会话）。
 */

export type Json = any

const WEAPON_EPHEMERAL = new Set(['kwscode', 'kwssectoken'])
const COOKIE_DOMAIN = '.kuaishou.com'

/** 子站点分区：创作者中心（cp）、直播（live），其余（www、passport、设备）在 main。 */
function scopeOf(name: string): 'main' | 'cp' | 'live' {
  if (name.startsWith('kuaishou.web.cp.') || name === 'ks_onvideo_token') return 'cp'
  if (name.startsWith('kuaishou.live.') || name === 'client_key') return 'live'
  return 'main'
}

/** 凭证里的 cookie（main → cp → live），不含 6 分钟票据。 */
export function credentialCookies(credential: Credential): [string, string][] {
  const out: [string, string][] = []
  for (const name of ['main', 'cp', 'live']) {
    for (const c of credential.scopes[name]?.cookies ?? []) if (!WEAPON_EPHEMERAL.has(c.name)) out.push([c.name, c.value])
  }
  return out
}

export class Ks {
  readonly http: HttpClient
  readonly log: HandlerContext['log']
  readonly s: Session
  /** www 与 cp 共用的 sig4 引擎（上游 _hxfalcon_signer）。 */
  readonly falcon = new HxFalconSigner()
  readonly falconLive = new HxFalconSigner(SDK_VERSION_LIVE)
  readonly falconLogin = new HxFalconSigner()
  readonly sig3 = new Sig3Signer()
  /** 最近一次自动过滑块没通过时服务端的回复（报 RISK_CONTROL 时放进 detail.verify）。 */
  lastCaptcha: Json = null
  /** CP 发布权限预检的缓存（_cp_publish_authority_response）。 */
  cpAuthority: Json = null
  cpLastVideoFinish: Json = null

  constructor(readonly ctx: HandlerContext) {
    this.http = new HttpClient({ browser: BROWSER, os: 'windows', proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
    this.log = ctx.log
    this.s = new Session(this)
  }

  // ---------------------------------------------------------------- 会话

  /**
   * 相当于上游的 `KuaishouAuth.initialize(cookie_str)`：解析凭证 cookie → 物化 webweapon 票据
   * → 没有 wid 时做一次设备指纹上报 → 回到原来的站点。游客第一次运行时 cookie 为空，这一步同时生成设备身份。
   */
  async init(cookies: [string, string][] = credentialCookies(this.ctx.credential)): Promise<this> {
    const s = this.s
    s.prepare(cookies)
    s.restoreCounter(String(this.ctx.credential.device.kwfcv1 ?? ''))
    s.liveBootstrapEnabled = true
    s.ensureBrowserDefaults()
    await s.current()
    const previous = s.cookies.get('kwpsecproductname') ?? PRODUCT_WWW
    await bootstrapDeviceFingerprint(this)
    s.useSite(previous === PRODUCT_CP ? CP : previous === PRODUCT_LIVE ? LIVE : WWW)
    return this
  }

  /** 会话状态写回凭证（由 core 落盘）：kwscode / kwssectoken 不落盘；product 归位到 www。 */
  save(credential: Credential = this.ctx.credential): void {
    const parts: Record<string, Cookie[]> = { main: [], cp: [], live: [] }
    for (const [name, value] of this.s.cookies) {
      if (WEAPON_EPHEMERAL.has(name) || !name) continue
      const v = name === 'kwpsecproductname' ? PRODUCT_WWW : value
      parts[scopeOf(name)]!.push({ name, value: v, domain: COOKIE_DOMAIN, path: '/', expires: null })
    }
    for (const [name, cookies] of Object.entries(parts)) {
      if (name !== 'main' && !cookies.length && !credential.scopes[name]) continue
      scope(credential, name).cookies = cookies
    }
    credential.device.kwfcv1 = this.s.kwfcv1
  }

  // ---------------------------------------------------------------- 发送

  async send(req: {
    method: string
    url: string
    headers: HeaderPairs
    cookie?: string
    body?: string | Uint8Array
    query?: [string, string | number][]
    redirect?: 'follow' | 'manual'
    timeout?: number
  }): Promise<HttpResponse> {
    const headers: HeaderPairs = req.cookie ? [...req.headers, ['cookie', req.cookie]] : req.headers
    return this.http.request({
      method: req.method,
      url: req.url,
      query: req.query,
      headers,
      body: req.body,
      cookies: req.cookie ? undefined : false,
      redirect: req.redirect,
      timeout: req.timeout,
    })
  }

  async json(res: HttpResponse): Promise<Json> {
    const text = await res.text()
    try {
      return jsonLoads(text)
    } catch {
      throw new CatbusError('UPSTREAM', `快手返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, body: text.slice(0, 300) } })
    }
  }

  // ---------------------------------------------------------------- www REST / GraphQL（kuaishou_api.py）

  /** KuaishouAPI._post：JSON body，kww 头，白名单接口带 __NS_hxfalcon。 */
  async wwwPost(api: string, body: unknown, o: { referer?: string; extraHeaders?: [string, string][]; cookieProfile?: string } = {}): Promise<Json> {
    const referer = o.referer ?? RECO_REFERER
    const h = buildHeaders('POST')
    h.set('referer', referer)
    h.set('origin', WWW)
    const kww = await this.s.kww()
    if (kww) h.set('kww', kww)
    for (const [k, v] of o.extraHeaders ?? []) h.set(k.toLowerCase(), v)
    if (body == null) h.remove('content-type')
    const params: [string, unknown][] = []
    if (needSign(api)) {
      params.push(['__NS_hxfalcon', this.falcon.sign(buildSignInput(api, {}, body, 'application/json', { omitEmptyBody: true }))], ['caver', CAVER])
    }
    const data = body == null ? undefined : compactJson(body)
    const site = o.cookieProfile ?? 'www'
    const query = axiosQuery(params)
    const url = `${WWW}${api}${query ? '?' + query : ''}`
    const post = async () => this.json(await this.send({ method: 'POST', url, headers: h.get(), cookie: await this.s.cookieHeader(site), body: data }))
    let result = await post()
    // 撞上滑块风控就过一次验证码；验证可能轮换短期票据，重发前重新序列化同一条 Cookie 线序
    if (isRisk(result) && (await passCaptcha(this, result, referer))) result = await post()
    if (api === '/rest/v/profile/feed' && this.s.wwwPhase !== 'relogin') this.s.wwwPhase = 'refreshed'
    return result
  }

  /** KuaishouAPI._get：只有 profile/get。撞上滑块同 wwwPost。 */
  async wwwGet(api: string, o: { referer?: string } = {}): Promise<Json> {
    const referer = o.referer ?? RECO_REFERER
    const h = buildHeaders('GET')
    h.set('referer', referer)
    const kww = await this.s.kww()
    if (kww) h.set('kww', kww)
    const params: [string, unknown][] = []
    if (needSign(api)) params.push(['__NS_hxfalcon', this.falcon.sign(buildSignInput(api, {}, null, 'application/json', { omitEmptyBody: true }))], ['caver', CAVER])
    const query = axiosQuery(params)
    const url = `${WWW}${api}${query ? '?' + query : ''}`
    const get = async () => this.json(await this.send({ method: 'GET', url, headers: h.get(), cookie: await this.s.cookieHeader('www') }))
    let result = await get()
    if (isRisk(result) && (await passCaptcha(this, result, referer))) result = await get()
    return result
  }

  /** KuaishouAPI.graphql：POST /graphql，不签名；短视频详情页按 operation 选 Cookie 线序。 */
  async graphql(operation: string, variables: Record<string, unknown>, query: string, referer: string, cookieSite = 'www_graphql'): Promise<Json> {
    const h = buildHeaders('POST', 'www', '*/*')
    h.set('referer', referer)
    h.set('origin', WWW)
    const kww = await this.s.kww()
    if (kww) h.set('kww', kww)
    const data = compactJson({ operationName: operation, variables, query })
    let site = cookieSite
    const path = new URL(referer).pathname
    if ((cookieSite === 'www_graphql' || cookieSite === 'www_graphql_detail') && path.startsWith('/short-video/')) {
      const shape = `${operation}(${Object.keys(variables).join(',')})`
      const bootstrap = ['visionLoginConfig(key)', 'checkLoginQuery()', 'visionShortVideoReco(page,photoId)', 'commentListQuery(photoId,pcursor)', 'visionBaseEmoticons()']
      if (shape === 'visionVideoDetail(photoId,page)') site = 'www_graphql_detail_video_success'
      else if (operation === 'commentListQuery' && this.s.history.length) site = 'www_graphql_comment_initial'
      else if (bootstrap.includes(shape)) site = 'www_graphql_detail_bootstrap'
      else if (operation === 'visionSubCommentList') site = 'www_graphql_subcomment_initial'
      else if (shape === 'visionConfigQuery()') site = 'www_graphql_detail_refreshed'
      else site = 'www_graphql_detail_initial'
    }
    const post = async () => this.json(await this.send({ method: 'POST', url: `${WWW}/graphql`, headers: h.get(), cookie: await this.s.cookieHeader(site), body: data }))
    let result = await post()
    // GraphQL 侧（评论、详情）同样会撞风控：挑战改成 REST 的形状交给同一个求解器
    if (isRisk(result) && (await passCaptcha(this, graphqlRiskAsRest(result), referer))) result = await post()
    checkGraphql(this.ctx, result, this.lastCaptcha)
    return result
  }

  // ---------------------------------------------------------------- 登录站（login_api.py）

  /**
   * KuaishouLoginAPI._post_form：form-urlencoded，按传入顺序；名单内接口带 __NS_hxfalcon（form 参与签名）；
   * cookie 为整份 `auth.cookie`。
   */
  async loginForm(api: string, fields: [string, string][], pageOrigin: string, timeout?: number): Promise<[Json, HttpResponse]> {
    const body = fields.map(([k, v]) => `${k}=${quote(v, '')}`).join('&')
    let url = `${ID_HOST}${api}`
    if (loginNeedSign(api)) {
      const sig = this.falconLogin.sign(buildSignInput(api, {}, Object.fromEntries(fields), 'application/x-www-form-urlencoded'))
      url = `${url}?__NS_hxfalcon=${sig}&caver=${CAVER}`
    }
    const h = buildHeaders('POST', 'login')
    h.set('referer', `${pageOrigin}/`)
    h.set('origin', pageOrigin)
    h.set('sec-fetch-site', 'same-site')
    const kww = await this.s.kww()
    if (kww) h.set('kww', kww)
    const cookie = await this.s.currentLine()
    const res = await this.send({ method: 'POST', url, headers: h.get(), cookie, body, timeout })
    const data = await res
      .clone()
      .json()
      .catch(() => ({}))
    return [data, res]
  }

  // ---------------------------------------------------------------- 直播站（live_api.py）

  /** 房间 / 首页 / 主播页对应的当前 Cookie 线序（_current_live_profile）。 */
  liveProfile(referer: string): string {
    const context = liveContext(referer)
    const phase = this.s.livePhase[context] ?? 'initial'
    if (context === 'room') return this.roomProfile(phase)
    if (context === 'home') return this.homeProfile(phase)
    return `live_${context}_${phase}`
  }

  roomProfile(phase: string): string {
    return this.s.liveOnly && ['initial', 'login', 'authenticated'].includes(phase) ? `live_room_current_${phase}` : `live_room_${phase}`
  }

  homeProfile(phase: string): string {
    const current = ['initial', 'login', 'login_bootstrap', 'authenticated_1', 'authenticated_2', 'authenticated_3']
    return this.s.liveOnly && current.includes(phase) ? `live_home_current_${phase}` : `live_home_${phase}`
  }

  /** KuaishouLiveAPI._get / _post：axios 头、Sentry 头、kww；名单内接口按 realUrl 签 sig4（query 排序、body 不参与）。 */
  async live(method: 'GET' | 'POST', api: string, o: { query?: [string, unknown][]; body?: unknown; referer: string; sentry?: boolean; cookieProfile?: string }): Promise<[Json, HttpResponse]> {
    const sentry = o.sentry ?? PAGE_LOAD_SENTRY.has(api)
    const h = buildHeaders(method, 'live')
    h.set('referer', o.referer)
    if (method === 'POST') h.set('origin', LIVE)
    if (sentry) {
      const [trace, span] = this.s.nextLiveSentry(o.referer)
      h.set('sentry-trace', `${trace}-${span}-0`)
      h.set('baggage', LIVE_SENTRY_BAGGAGE)
    }
    const kww = await this.s.kww()
    if (kww) h.set('kww', kww)
    const profile = o.cookieProfile ?? this.liveProfile(o.referer)
    const cookie = await this.s.cookieHeader(profile)
    const signed = liveNeedSign(api)
    let query = o.query ?? []
    if (signed && query.length) query = [...query].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const params: [string, unknown][] = []
    if (signed) {
      const sig = this.falconLive.sign(buildSignInput(liveSignUrl(api), Object.fromEntries(query), null))
      params.push(['__NS_hxfalcon', sig], ['caver', CAVER])
    }
    params.push(...query)
    const qs = axiosQuery(params)
    const data = method === 'POST' && o.body != null ? compactJson(o.body) : undefined
    const res = await this.send({ method, url: `${LIVE}${api}${qs ? '?' + qs : ''}`, headers: h.get(), cookie, body: data })
    const result = await res
      .clone()
      .json()
      .catch(() => ({}))
    return [result, res]
  }

  // ---------------------------------------------------------------- 创作者中心（publish_api.py）

  /**
   * KuaishouPublishAPI._post：body 末尾追加 api_ph；cp 大多数接口走 sig3，少数走 sig4（带 projectInfo）；
   * 上传链路先切到对应的 webweapon 上下文。
   */
  async cpPost(
    api: string,
    body: Record<string, unknown> = {},
    o: { referer?: string; style?: 'cp' | 'cp_creator_json' | 'cp_creator_axios'; withKww?: boolean; creator?: boolean; upload?: 'video' | 'atlas'; wireSite?: string } = {},
  ): Promise<Json> {
    let upload = o.upload
    if (!upload) upload = CP_ATLAS_PATHS.has(api) ? 'atlas' : CP_VIDEO_PATHS.has(api) ? 'video' : undefined
    if (upload === 'atlas') this.s.useCpAtlas()
    else if (upload === 'video') await this.s.useCpUpload()
    const merged: Record<string, unknown> = { ...body }
    if (this.s.cpApiPh) merged['kuaishou.web.cp.api_ph'] = this.s.cpApiPh
    const withKww = o.withKww ?? true
    const http11 = CP_HTTP11_PATHS.has(api)
    const style = http11 ? 'cp_submit' : (o.style ?? 'cp')
    const h = buildHeaders('POST', style)
    h.set('referer', o.referer ?? PUBLISH_REFERER)
    h.set('origin', CP)
    if (withKww) {
      const kww = await this.s.kww()
      if (kww) h.set('kww', kww)
    }
    if (o.creator) {
      h.set('returnsetrootdomainloginurl', 'true')
      if (style === 'cp_creator_axios') h.set('x-requested-with', 'XMLHttpRequest')
    }
    const params: [string, unknown][] = []
    if (cpNeedSign(api)) {
      const sig = this.falcon.sign(buildSignInput(api, {}, merged, 'application/json', { projectInfo: CP_PROJECT_INFO, omitEmptyBody: true }))
      params.push(['__NS_hxfalcon', sig], ['caver', CAVER])
    } else if (needSig3(api)) {
      params.push(['__NS_sig3', this.sig3.sign({}, merged, 'json')])
    }
    const data = compactJson(merged)
    // 上游在这两个接口上还显式带 connection / content-length / host：它们是传输层字段，交给 HTTP 库生成
    const site = o.wireSite ?? (http11 ? 'cp_video_submit' : upload === 'atlas' ? 'cp_atlas' : upload === 'video' ? 'cp_upload' : withKww ? 'cp' : 'cp_creator')
    const cookie = await this.s.cookieHeader(site)
    const qs = axiosQuery(params)
    const res = await this.send({ method: 'POST', url: `${CP}${api}${qs ? '?' + qs : ''}`, headers: h.get(), cookie, body: data })
    const result = await this.json(res)
    if (o.creator && !withKww) {
      if (api === '/rest/bamboo/pc/hotspot/show') this.s.cpPhase = 'warmed'
      else if (api === '/rest/cp/works/v2/collection/tab') this.s.cpPhase = 'refreshed'
    }
    return result
  }

  // ---------------------------------------------------------------- 结果检查

  /** www REST / cp 的 `result`；1 以外映射成 catbus 错误。 */
  check(body: Json, what = '快手'): Json {
    const risk = riskOf(body, this.lastCaptcha)
    if (risk) throw risk
    const code = body?.result
    if (code === 1 || code === undefined) return body
    if (code === 109) throw authError(this.ctx, `${what}需要登录（result=${code}）`)
    // result=2：上游没有定义。实测（2026-09-28）登录态正常、其他接口可用时，用户搜索在频繁触发滑块后返回 2，按风控处理
    if (code === 2) {
      throw new CatbusError('RISK_CONTROL', `${what}被快手限制（result=2），多为风控，稍后再试`, {
        hint: `catbus ${this.ctx.platform.id} auth status 可确认登录态是否正常`,
        detail: { kind: 'blocked', result: code },
      })
    }
    throw new CatbusError('UPSTREAM', String(body?.error_msg ?? body?.message ?? `${what}返回错误 ${code}`), { detail: { result: code } })
  }

  /** 直播站 `{data: {result}}`。 */
  checkLive(body: Json): Json {
    const risk = riskOf(body)
    if (risk) throw risk
    const code = body?.data?.result
    if (code === undefined || code === 1) return body?.data ?? {}
    if (code === 2) throw new CatbusError('RISK_CONTROL', '快手直播风控拦截（result=2），浏览器打开同一直播间也需要先过滑块验证', { detail: { kind: 'blocked', result: code } })
    if (code === 109) throw authError(this.ctx, '直播站需要登录')
    throw new CatbusError('UPSTREAM', String(body?.data?.error_msg ?? `快手直播返回错误 ${code}`), { detail: { result: code } })
  }
}

/** 页面加载期间带 Sentry 头的直播接口（page_load_sentry_paths）。 */
const PAGE_LOAD_SENTRY = new Set([
  '/live_api/baseuser/userinfo',
  '/live_api/category/classify',
  '/live_api/web/pay/get-pay',
  '/live_api/baseuser/userFollowCount',
  '/live_api/category/simple',
  '/live_api/interestMask/list',
  '/live_api/emoji/gift-list',
  '/live_api/emoji/icon',
  '/live_api/emoji/allgifts',
  '/live_api/liveroom/reco',
  '/live_api/baseuser/userLogin',
  '/live_api/liveroom/recall',
  '/live_api/liveroom/websocketinfo',
  '/live_api/home/list',
  '/live_api/home/category',
  '/live_api/profile/public',
  '/live_api/baseuser/userinfo/byid',
  '/live_api/baseuser/userinfo/sensitive',
  '/live_api/profileInterestMask/list',
  '/live_api/profile/interestlist',
])

const CP_VIDEO_PATHS = new Set([
  '/rest/wd/relation/isFollow',
  '/rest/cp/works/v2/video/pc/realize/entrance',
  '/rest/cp/works/v2/video/pc/upload/pre',
  '/rest/cp/works/v2/video/pc/realize/banner/entrance',
  '/rest/cp/works/v2/video/pc/publish/time',
  '/rest/v2/creator/activity/pc/list',
  '/rest/cp/works/v2/collection/canAdd',
  '/rest/v2/creator/activity/pc/tab',
  '/rest/v2/creator/activity/pc/filter',
  '/rest/cp/works/v2/video/pc/upload/finish',
  '/rest/cp/works/v4/video/pc/upload/material/specified',
  '/rest/cp/works/v4/video/pc/cover/edit/recommend/submit',
  '/rest/cp/works/v4/video/pc/cover/edit/recommend/query',
  '/rest/cp/works/v2/video/pc/publishInfo/snapshot/save',
  '/rest/cp/works/v4/video/pc/upload/cover/extract',
  '/rest/cp/works/v4/video/pc/upload/cover/extract/query',
  '/rest/cp/works/v2/video/pc/submit',
  '/rest/cp/works/v2/common/pc/report',
])

const CP_ATLAS_PATHS = new Set([
  '/rest/cp/works/atlas/pc/publishInfo/snapshot/info',
  '/rest/cp/works/v2/collection/canAddAtlas',
  '/rest/cp/works/atlas/pc/upload/pre',
  '/rest/cp/works/atlas/pc/upload/single/finish',
  '/rest/cp/works/atlas/pc/publishInfo/snapshot/save',
  '/rest/cp/works/atlas/pc/upload/finish',
  '/rest/cp/works/atlas/pc/publish/submit',
])

const CP_HTTP11_PATHS = new Set(['/rest/cp/works/v2/common/pc/report', '/rest/cp/works/v2/video/pc/submit'])

/** 直播页的上下文：首页、房间页 /u/<eid>、主播页 /profile/<eid>。 */
export function liveContext(referer: string): LiveContext {
  if (referer === `${LIVE}/`) return 'home'
  const u = new URL(referer)
  if (/^\/u\/[^/?#]+$/.test(u.pathname)) return 'room'
  return 'profile'
}

/**
 * 滑块风控：REST `data.result == 400002`，GraphQL `errors` + `data.captcha.url`。
 * www 的 REST / GraphQL 已经自动过过一次（见 captcha.ts），走到这里说明没过，或者是不自动过的站点（直播、创作者中心）。
 */
function riskOf(body: Json, verify: Json = null): CatbusError | null {
  if (!isRisk(body)) return null
  const data = body?.data ?? {}
  const url = data.result === 400002 ? data.url : data.captcha?.url
  return new CatbusError('RISK_CONTROL', '快手要求滑块验证（风控）：自动验证没有通过（直播、创作者中心的接口不自动验证），稍后再试', {
    detail: { kind: 'captcha', url, ...(verify ? { verify } : {}) },
  })
}

function checkGraphql(ctx: HandlerContext, body: Json, verify: Json = null): void {
  const risk = riskOf(body, verify)
  if (risk) throw risk
  const errors = body?.errors
  if (Array.isArray(errors) && errors.length) {
    const message = String(errors[0]?.message ?? 'GraphQL 错误')
    if (/login|登录/i.test(message)) throw authError(ctx, message)
    throw new CatbusError('UPSTREAM', `快手 GraphQL 错误：${message}`, { detail: { errors } })
  }
}

// ================================================================ 设备指纹（login_api.bootstrap_device_fingerprint）

/**
 * CP 页的官方 `kwf getData(1) → /s/w/p` 链，换回服务端下发的 wid。已有合法 wid 时不重复上报。
 */
export async function bootstrapDeviceFingerprint(ks: Ks, force = false): Promise<{ wid: string; didv: string; reused: boolean }> {
  const s = ks.s
  const validDidv = (v: string) => /^\d{13}$/.test(v)
  let didv = s.didv
  if (!validDidv(didv)) didv = s.cookies.get('didv') ?? ''
  if (!validDidv(didv)) {
    didv = String(rand.now())
    s.update({ didv })
  } else s.didv = didv
  const existing = s.cookies.get('wid') ?? ''
  if (/^\d{17}$/.test(existing) && !force) return { wid: existing, didv, reused: true }
  if (!s.did) throw new CatbusError('ERROR', '设备指纹上报缺少 did')
  s.useSite(CP)
  const cookie = await s.currentLine()
  const wid = await reportFingerprint(ks, {
    did: s.did,
    product: PRODUCT_CP,
    referer: `${CP}/`,
    href: PUBLISH_REFERER,
    cookie,
    kwfcv1: s.kwfcv1,
    currentKwfv1: s.kwfv1,
  })
  s.update([
    ['wid', wid],
    ['didv', didv],
  ])
  return { wid, didv, reused: false }
}

