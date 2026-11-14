import { CatbusError } from '../../../core/errors.js'
import { HttpClient, type HttpRequest, type HttpResponse } from '../../../core/http.js'
import { jsonLoads } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Cookie } from '../../../core/schemas.js'
import { authError, isGuest, scope } from '../../../core/toolkit.js'
import * as api from './api.js'
import { type DtraitMaterial, ecdhKey, reeKey, sessionDtrait, ticketClientData, ticketGuardVersion } from './crypto.js'
import { buildBlob, DTRAIT_BROKEN, DTRAIT_HINT, defaultProfile } from './dtrait.js'
import { BROWSER, BROWSER_COOKIE_ORDER, PROFILE, type Headers, WWW, WWW_ONLY } from './profile.js'
import { ABogus, fakeWebid, md5Hex, randomMsToken, svWebId, XBogus } from './sign.js'

/**
 * 抖音 web 端的会话（上游 builder/auth.py 的 DouyinAuth）：cookie、msToken / webid 的生命周期、
 * bd-ticket-guard 与 dtrait 安全头。
 *
 * cookie 按上游 `auth.cookie` 的语义保存成一张按名字去重的有序表（凭证 main 分区）：
 * www-only 的名字挂在 www.douyin.com，其余挂在 .douyin.com；响应的 Set-Cookie 按名字合并，空值表示删除。
 * 创作者中心页面写的 host-only cookie 单独放在 creator 分区。
 */

/** msToken 缓存 600 秒（上游 _MS_TTL）。 */
const MS_TTL = 600_000
const ROOT_DOMAIN = '.douyin.com'
const CREATOR_HOST = 'creator.douyin.com'

export interface DyJson {
  status_code?: number
  status_msg?: string
  [key: string]: any
}

export class Douyin {
  readonly http: HttpClient
  readonly ab = new ABogus()
  readonly xb = new XBogus()
  /** 扫码轮询期间 msToken 只由 /web/common 轮换（上游 _ms_pinned）。 */
  msPinned = false
  private resolvingWebid = false
  private memWebid = ''
  private readonly ecdh = new Map<string, Buffer | null>()
  private readonly dtrait = new Map<string, DtraitMaterial>()
  identity: { token: string; deviceId: string; at: number } | null = null

  constructor(readonly ctx: HandlerContext) {
    this.http = new HttpClient({ browser: BROWSER, os: 'windows', proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
  }

  get credential() {
    return this.ctx.credential
  }

  get tokens(): Record<string, any> {
    return scope(this.credential).tokens
  }

  get device(): Record<string, any> {
    return this.credential.device
  }

  // ---------------------------------------------------------------- cookie

  get jar(): Cookie[] {
    return scope(this.credential).cookies
  }

  get creatorJar(): Cookie[] {
    return scope(this.credential, 'creator').cookies
  }

  cookie(name: string): string | undefined {
    return this.jar.find((c) => c.name === name)?.value
  }

  setCookie(name: string, value: string): void {
    const c = this.jar.find((x) => x.name === name)
    if (c) c.value = value
    else this.jar.push({ name, value, domain: WWW_ONLY.has(name) ? 'www.douyin.com' : ROOT_DOMAIN, path: '/', expires: null })
  }

  setDefault(name: string, value: () => string): string {
    const v = this.cookie(name)
    if (v != null && v !== '') return v
    const nv = value()
    this.setCookie(name, nv)
    return nv
  }

  deleteCookie(name: string): void {
    for (let i = this.jar.length - 1; i >= 0; i--) if (this.jar[i]!.name === name) this.jar.splice(i, 1)
  }

  /** 名字 → 值，按存入顺序（上游 auth.cookie）。 */
  cookies(): [string, string][] {
    return this.jar.map((c) => [c.name, c.value])
  }

  /** 上游 cookie_str：全部 cookie，不分域。 */
  /** Cookie 头：按浏览器 wire 顺序（BROWSER_COOKIE_ORDER）排列，其余按 jar 插入序。 */
  get cookieStr(): string {
    const pairs = this.cookies()
    const rank = new Map(BROWSER_COOKIE_ORDER.map((n, i) => [n, i] as const))
    const known = pairs
      .filter(([k]) => rank.has(k))
      .sort((a, b) => rank.get(a[0])! - rank.get(b[0])!)
    const rest = pairs.filter(([k]) => !rank.has(k))
    return [...known, ...rest].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  creatorCookieStr(): string {
    type Entry = { name: string; value: string; domain: string }
    const all: Entry[] = [
      ...this.jar.filter((c) => !WWW_ONLY.has(c.name)).map((c) => ({ name: c.name, value: c.value, domain: ROOT_DOMAIN })),
      ...this.creatorJar.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
    ]
    const used = new Set<number>()
    const out: Entry[] = []
    const take = (name: string, pred: (c: Entry) => boolean) => {
      const i = all.findIndex((c, k) => !used.has(k) && c.name === name && pred(c))
      if (i >= 0) {
        used.add(i)
        out.push(all[i]!)
      }
    }
    const hostOnly = (c: Entry) => c.domain === CREATOR_HOST
    const creatorDomain = (c: Entry) => c.domain.replace(/^\./, '') === CREATOR_HOST
    const shared = (c: Entry) => c.domain === ROOT_DOMAIN
    take('gd_random', hostOnly)
    take('x-web-secsdk-uid', hostOnly)
    take('gfkadpd', creatorDomain)
    take('_tea_utm_cache_2906', creatorDomain)
    take('csrf_session_id', hostOnly)
    take('bd_ticket_guard_client_web_domain', shared)
    take('s_v_web_id', hostOnly)
    take('s_v_web_id', shared)
    take('bd_ticket_guard_client_data', shared)
    for (const [name] of this.cookies()) take(name, shared)
    all.forEach((c, k) => {
      if (!used.has(k)) out.push(c)
    })
    return out.map((c) => `${c.name}=${c.value}`).join('; ')
  }

  /**
   * 发往某个 URL 的 cookie：www-only 的名字只发给 www.douyin.com；创作者中心再加上 creator 分区。
   * 顺序与上游的 curl cookie 罐相同：按 domain 首次出现的先后分组，组内按存入顺序。
   */
  cookiesFor(url: string): Record<string, string> {
    const host = new URL(url).hostname
    const main = this.jar.map((c) => ({ name: c.name, value: c.value, domain: WWW_ONLY.has(c.name) ? 'www.douyin.com' : ROOT_DOMAIN }))
    const all = host === CREATOR_HOST ? [...main, ...this.creatorJar] : main
    const domains = [...new Set(all.map((c) => c.domain))]
    const out: Record<string, string> = {}
    for (const domain of domains) {
      if (!domainMatch(host, domain)) continue
      for (const c of all) if (c.domain === domain && !(c.name in out)) out[c.name] = c.value
    }
    return out
  }

  /** 上游 merge_set_cookies：按名字合并，空值表示删除。创作者中心的 host-only cookie 进 creator 分区。 */
  mergeSetCookies(url: string, res: HttpResponse): void {
    const host = new URL(url).hostname
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0]!
      const i = pair.indexOf('=')
      if (i <= 0) continue
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      const domain = /;\s*domain=\.?([^;]+)/i.exec(line)?.[1]?.toLowerCase()
      if (host === CREATOR_HOST && (!domain || domain.endsWith(CREATOR_HOST))) {
        const jar = this.creatorJar
        const at = jar.findIndex((c) => c.name === name)
        if (at >= 0) jar.splice(at, 1)
        if (value) jar.push({ name, value, domain: domain ? '.' + domain : CREATOR_HOST, path: '/', expires: null })
        continue
      }
      if (value === '') this.deleteCookie(name)
      else this.setCookie(name, value)
    }
  }

  // ---------------------------------------------------------------- 请求

  /** 发给抖音的请求：没有显式 cookie 头时带上会话 cookie，响应的 Set-Cookie 合并回来。 */
  async request(req: HttpRequest, options: { merge?: boolean } = {}): Promise<HttpResponse> {
    const explicit = headerList(req.headers).some(([k]) => k.toLowerCase() === 'cookie')
    const cookies = req.cookies === false || explicit ? req.cookies : this.cookiesFor(req.url)
    const res = await this.http.request({ ...req, cookies })
    if (options.merge !== false && new URL(res.url || req.url).hostname.endsWith('douyin.com')) this.mergeSetCookies(req.url, res)
    return res
  }

  /** 不带会话 cookie 的请求（mssdk、ttwid 注册、上传网关等跨站请求）。 */
  plain(req: HttpRequest): Promise<HttpResponse> {
    return this.http.request({ ...req, cookies: req.cookies ?? false })
  }

  // ---------------------------------------------------------------- 设备与游客态

  /**
   * 每条命令开始时调用（上游 perepare_auth）：去掉 cookie 里的旧 msToken，补 s_v_web_id；
   * 游客没有 ttwid 时去注册一个（upstream-map 1.2），结果缓存在游客凭证里。
   */
  async init(): Promise<void> {
    this.deleteCookie('msToken')
    this.setDefault('s_v_web_id', svWebId)
    // 上游 2834d77：perepare_auth 会把导入的 cookie jar 按 BROWSER_COOKIE_ORDER
    // 重排（已知键按序在前，其余保持相对顺序续后）。TS 的 jar 同样是插入序，
    // 在合成新 cookie 之前先重排，保证后续追加的合成键落在末尾——与 golden 一致。
    const rank = new Map(BROWSER_COOKIE_ORDER.map((n, i) => [n, i] as const))
    const jar = this.jar
    const known = jar.filter((c) => rank.has(c.name)).sort((a, b) => rank.get(a.name)! - rank.get(b.name)!)
    const rest = jar.filter((c) => !rank.has(c.name))
    jar.splice(0, jar.length, ...known, ...rest)
    // 上游 0b96881/0a39462（2026-10-18）：安全 SDK / UI 状态 cookie 补齐，
    // 与 perepare_auth 对齐——服务端只校验存在性，缺则合成默认值（追加在末尾）。
    // cookie 导入路径（golden 的 logged 会话）不跑 passport bootstrap，在此补齐。
    const sync = (name: string, value: () => string): void => {
      const v = this.cookie(name)
      if (v == null || v === '') this.setCookie(name, value())
    }
    // 随机消耗顺序与上游 perepare_auth 对齐：server_data_status → cert_key →
    // sign_data_key → _bd_ticket_crypt_doamin → csrf_session_id → UI 状态。
    sync('__security_server_data_status', () => '1')
    sync('__security_mc_1_s_sdk_cert_key', () => rand.uuid4().replaceAll('-', '').slice(0, 18))
    sync('__security_mc_1_s_sdk_sign_data_key_web_protect', () => rand.uuid4().replaceAll('-', '').slice(0, 18))
    sync('_bd_ticket_crypt_doamin', () => '2')
    sync('csrf_session_id', () => rand.hex(16))
    sync('SEARCH_RESULT_LIST_TYPE', () => '"single"')
    sync('live_use_vvc', () => '"false"')
    sync('publish_badge_show_info', () => '0,0,0,0')
    // 上游 2ecf6d4：ts_sign 同步进 bd_ticket_guard_ts_sign_id（cookie 里可能只有短值）
    const tsSign = this.tokens.ts_sign as string | undefined
    if (tsSign) this.setCookie('bd_ticket_guard_ts_sign_id', tsSign)
    // 上游 3bbf9a7：仅 from_cookie（cookie 导入）路径收集——带完整 jar 访问
    // /jingxuan 拿 web_sign_token 与完整 UIFID。游客 bootstrap 不发这个请求。
    if (this.credential.method === 'cookie' && (!this.cookie('web_sign_token') || !this.cookie('UIFID'))) {
      try {
        const res = await this.plain({
          method: 'GET',
          url: 'https://www.douyin.com/jingxuan',
          headers: [
            ['user-agent', PROFILE.ua],
            ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
            ['accept-language', 'zh-CN,zh;q=0.9'],
            ['cookie', this.cookieStr],
            ['referer', 'https://www.douyin.com/?recommend=1'],
          ],
          timeout: 20,
        })
        await res.arrayBuffer().catch(() => {})
      } catch {
        /* 离线 / 风控：与上游一致静默跳过 */
      }
    }
    if (isGuest(this.ctx) && !this.cookie('ttwid')) {
      const ttwid = await api.registerTtwid(this).catch((err) => {
        this.ctx.log.debug(`注册 ttwid 失败：${(err as Error).message}`)
        return ''
      })
      if (ttwid) this.setCookie('ttwid', ttwid)
    }
  }

  /** 惰性 msToken：缓存 600 秒，过期后向 mssdk 换新，失败时用随机值（上游 DouyinAuth.msToken）。 */
  async msToken(): Promise<string> {
    const cached = this.tokens.msToken as { value: string; at: number } | undefined
    if (cached?.value && (this.msPinned || rand.now() - cached.at < MS_TTL)) return cached.value
    const token = await api.mstoken(this, cached?.value ?? '').catch(() => '')
    if (token) {
      this.tokens.msToken = { value: token, at: rand.now() }
      return token
    }
    return cached?.value || randomMsToken()
  }

  setMsToken(value: string): void {
    if (value) this.tokens.msToken = { value, at: rand.now() }
  }

  /**
   * creator.douyin.com 域的 msToken（ms_appid=2906 独立轮换，上游 DouyinAuth.creator_msToken，
   * commit 1ac437c）。浏览器 creator 页的 mssdk 轮换与主站 6383 分开；create_v2 等
   * creator 域接口必须带这个版本。
   */
  async creatorMsToken(): Promise<string> {
    const cached = this.tokens.creatorMsToken as { value: string, at: number } | undefined
    if (cached?.value && rand.now() - cached.at < MS_TTL) return cached.value
    const token = await api.mstoken(this, cached?.value ?? '', true).catch(() => '')
    if (token) {
      this.tokens.creatorMsToken = { value: token, at: rand.now() }
      return token
    }
    return cached?.value || this.msToken()
  }

  /** 真实设备号：query/user 的 id，退而求其次抓页面里的 user_unique_id（上游 DouyinAuth.webid）。 */
  async webid(): Promise<string> {
    const saved = (this.tokens.webid as string | undefined) || this.memWebid
    if (saved) return saved
    if (this.resolvingWebid) return fakeWebid()
    this.resolvingWebid = true
    let wid = ''
    try {
      wid = String((await api.deviceId(this)) ?? '')
    } catch (err) {
      this.ctx.log.debug(`取设备号失败：${(err as Error).message}`)
    } finally {
      this.resolvingWebid = false
    }
    if (wid) this.tokens.webid = wid
    else {
      wid = await api.pageWebid(this, `${WWW}/discover`)
      if (wid) this.tokens.webid = wid
      else this.memWebid = wid = fakeWebid()
    }
    return wid
  }

  /** 登录用户的数字 uid（上游 get_uid），缓存在凭证里。 */
  async uid(): Promise<string> {
    if (this.tokens.uid) return String(this.tokens.uid)
    const uid = await api.myUid(this)
    this.tokens.uid = uid
    return uid
  }

  /** 评论 / 点赞 / 收藏接口 query 里的 uid = md5(数字 uid)，失败时为空（上游 _comment_uid）。 */
  async commentUid(): Promise<string> {
    try {
      return md5Hex(await this.uid())
    } catch {
      return ''
    }
  }

  get isLogin(): boolean {
    return Boolean(this.cookie('sessionid') || this.cookie('sessionid_ss'))
  }

  // ---------------------------------------------------------------- bd-ticket-guard 与 dtrait

  get privateKey(): string | undefined {
    return (this.device.private_key as string | undefined) || undefined
  }

  /** ts_sign 与 cookie 里的 bd_ticket_guard_ts_sign_id 是否同属一次登录。 */
  ticketMatchesSession(): boolean {
    const tsSign = this.tokens.ts_sign as string | undefined
    if (!tsSign) return false
    const id = this.cookie('bd_ticket_guard_ts_sign_id')
    return !id || tsSign.startsWith(id)
  }

  /** ECDH 会话密钥，按 (aid, origin) 缓存；拿不到服务端证书时为 null，调用方回退 ECDSA。 */
  async ecdhKey(aid: number | string, origin: string): Promise<Buffer | null> {
    const prv = this.privateKey
    if (!prv) return null
    const key = `${aid}|${origin}`
    if (this.ecdh.has(key)) return this.ecdh.get(key)!
    let out: Buffer | null = null
    try {
      const cert = await api.serverCert(this, aid, origin === CREATOR_HOST ? this.creatorCookieStr() : this.cookieStr, origin)
      out = ecdhKey(prv, cert)
    } catch (err) {
      this.ctx.log.debug(`取服务端证书失败，回退 ECDSA：${(err as Error).message}`)
    }
    this.ecdh.set(key, out)
    return out
  }

  /**
   * x-tt-session-dtrait 的内层设备特征 blob（上游 session_dtrait_header 的取法）：导入的 dtrait_blob 优先，
   * 其次按凭证里的 dtrait_profile 现算，都没有时按随包的默认档案现算。档案无效时为 null。
   */
  dtraitBlob(): string | null {
    const blob = this.device.dtrait_blob as string | undefined
    if (blob) return blob
    try {
      return buildBlob(this.device.dtrait_profile ?? defaultProfile())
    } catch (err) {
      this.ctx.log.debug(`dtrait 设备档案不可用：${(err as Error).message}`)
      return null
    }
  }

  /**
   * 按 path 生成 x-tt-session-dtrait；算不出 blob 时为 null（strict 时报错）。
   * 导入的成品头 session_dtrait 绑定了抓取时的 path 和时间，只给非严格、allowStatic 的请求用。
   */
  dtraitHeader(path: string, options: { aid?: number | string; origin?: string; strict?: boolean; allowStatic?: boolean } = {}): string | null {
    const { aid = 6383, origin = WWW, strict = false, allowStatic = true } = options
    const blob = this.dtraitBlob()
    const staticHeader = this.device.session_dtrait as string | undefined
    if (!blob && staticHeader && allowStatic && !strict) return staticHeader
    if (!blob) {
      if (strict) throw new CatbusError('AUTH_REQUIRED', `缺少可按 path 重算的 dtrait 设备素材（${DTRAIT_BROKEN}），这个操作不能省略 x-tt-session-dtrait`, { hint: DTRAIT_HINT })
      return null
    }
    const cacheKey = `${aid}|${origin}`
    const { header, material } = sessionDtrait(path, blob, this.dtrait.get(cacheKey) ?? null)
    this.dtrait.set(cacheKey, material)
    return header
  }

  /** 写接口的 x-tt-session-dtrait（上游 Header.with_session_dtrait）：必须按 path 重算，不接受成品头，算不出时报错。 */
  withSessionDtrait(h: Headers, api: string, options: { aid?: number | string; origin?: string } = {}): void {
    h.set('x-tt-session-dtrait', this.dtraitHeader(api, { ...options, strict: true, allowStatic: false })!)
  }

  /** 写接口的 bd-ticket-guard 头（上游 Header.with_bd）。 */
  async withBd(h: Headers, api: string, options: { aid?: number | string; origin?: string; requireDtrait?: boolean } = {}): Promise<void> {
    const { aid = 6383, origin = WWW, requireDtrait = false } = options
    if (!this.ticketMatchesSession()) {
      throw authError(this.ctx, '当前账号缺少与 cookie 同一次登录的 ticket / ts_sign，写操作会被拒绝；请用扫码登录，或导入带 ticket 的凭证')
    }
    const prv = this.privateKey
    if (!prv) throw authError(this.ctx, '当前账号缺少 bd-ticket-guard 私钥，请重新扫码登录')
    const key = await this.ecdhKey(aid, origin)
    const trust = this.cookie('_bd_ticket_crypt_cookie')
    const tsSign = String(this.tokens.ts_sign)
    const { data, algo } = ticketClientData(api, String(this.tokens.ticket ?? ''), tsSign, prv, key, rand.nowSeconds(), trust ? 1 : undefined)
    h.set('bd-ticket-guard-client-data', data)
    h.set('bd-ticket-guard-ree-public-key', reeKey(prv))
    h.set('bd-ticket-guard-version', '2')
    h.set('bd-ticket-guard-web-version', String(ticketGuardVersion(tsSign)))
    h.set('bd-ticket-guard-web-sign-type', algo === 'hmac' ? '1' : '0')
    const dtrait = this.dtraitHeader(api, { aid, origin, strict: requireDtrait, allowStatic: !requireDtrait })
    if (dtrait) h.set('x-tt-session-dtrait', dtrait)
  }

  /** 只读接口的 4 个 bd-ticket-guard 头，不含 client-data（上游 with_bd_readonly）。 */
  withBdReadonly(h: Headers): void {
    const prv = this.privateKey
    if (!prv) return
    try {
      h.set('bd-ticket-guard-ree-public-key', reeKey(prv))
      h.set('bd-ticket-guard-version', '2')
      h.set('bd-ticket-guard-web-version', String(ticketGuardVersion(String(this.tokens.ts_sign ?? ''))))
      h.set('bd-ticket-guard-web-sign-type', String(this.tokens.client_cert ?? '').startsWith('pub.') ? '1' : '0')
    } catch {}
  }

  /** 写操作前检查登录态（registry 已保证不是游客，这里防 cookie 不全）。 */
  requireLogin(): void {
    if (!this.isLogin) throw authError(this.ctx, '当前账号的 cookie 里没有 sessionid，请重新登录')
  }
}

function domainMatch(host: string, domain: string): boolean {
  return domain.startsWith('.') ? host === domain.slice(1) || host.endsWith(domain) : host === domain
}

function headerList(init: HttpRequest['headers']): [string, unknown][] {
  if (!init) return []
  return Array.isArray(init) ? init : Object.entries(init)
}

/**
 * 抖音风控拒绝时返回 HTTP 200 + 空 body 或 HTML 挑战页，原因只在响应头里（上游 check_risk_response）。
 */
export async function riskJson<T = DyJson>(res: HttpResponse): Promise<T> {
  const text = await res.text()
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return jsonLoads(text) as T
  const logid = res.headers.get('x-tt-logid')
  const bd = res.headers.get('x-vc-bdturing-parameters')
  if (bd) {
    let subtype = ''
    try {
      subtype = jsonLoads(Buffer.from(bd, 'base64').toString('utf8')).subtype ?? ''
    } catch {}
    throw new CatbusError('RISK_CONTROL', `触发人机验证（bdturing ${subtype || '未知类型'}），请在浏览器完成验证或更换 IP、降低频率后重试`, {
      detail: { kind: 'captcha', subtype, logid },
    })
  }
  const pp = res.headers.get('x-tt-verify-passport-decision')
  // 安全网关要求二次验证时，决策头的值里有中文（UTF-8 字节），wreq-js 会丢掉值不是纯 ASCII 的响应头，pp 读出来是 null（#17）。
  // 同一个响应里的 bd_passport_security_gateway 与 access-control-expose-headers 还在，据此认出来。
  const gateway = !trimmed && res.headers.get('bd_passport_security_gateway') === '1' && /x-tt-verify-passport-decision/i.test(res.headers.get('access-control-expose-headers') ?? '')
  if (pp || gateway) {
    let scene = ''
    let reason = ''
    try {
      const ev = jsonLoads(pp ?? '').event_params ?? {}
      scene = ev.verify_scene ?? ''
      reason = ev.verify_reason ?? ''
    } catch {}
    throw new CatbusError('RISK_CONTROL', `抖音的安全网关要求先完成二次身份验证（短信、人脸或密码，scene=${scene || '未知'}），catbus 还不能代为完成`, {
      hint: '在浏览器里用同一个账号做一次同样的操作（发布在 creator.douyin.com）会弹出这个验证；在浏览器里验证后 catbus 这边是否放行还没有验证过',
      detail: { kind: 'blocked', reason: 'passport_verify', scene: scene || null, verify_reason: reason || null, decision_header: pp ? 'present' : 'dropped', logid },
    })
  }
  if (!trimmed) {
    throw new CatbusError('RISK_CONTROL', `接口返回空响应（HTTP ${res.status}），通常是签名参数不对或被风控拦截`, { detail: { kind: 'blocked', status: res.status, logid } })
  }
  if (text.includes('__ac_nonce') || text.includes('_$jsvmprt')) {
    throw new CatbusError('RISK_CONTROL', `命中 acrawler 挑战页（HTTP ${res.status}）`, { detail: { kind: 'blocked', status: res.status, logid } })
  }
  if (/Uifid Not Found/i.test(text)) {
    throw new CatbusError('RISK_CONTROL', '这个接口要求页面脚本写入的 UIFID cookie，游客态和缺 UIFID 的 cookie 都会被拦截', {
      hint: '用浏览器登录后导出 cookie：catbus douyin auth login --method cookie --cookie @<文件>',
      detail: { kind: 'blocked', reason: 'uifid', status: res.status, body: text.slice(0, 120), logid },
    })
  }
  throw new CatbusError('UPSTREAM', `接口返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, body: text.slice(0, 120), logid } })
}

/**
 * 业务码检查：status_code（主站、直播）或 code / msg（电商接口）非 0 时映射成 catbus 的错误。
 * 登录墙：8、2483，以及直播 webcast 的 20003（User doesn't login，上游 get_live_thousand_ticket_rank 的说明），
 * webcast 的错误说明在 data.message 里。
 */
export function check<T extends DyJson>(ctx: HandlerContext, body: T): T {
  const code = body?.status_code ?? (body?.code != null && body.code !== 0 && body.code !== '0' && body.msg != null ? body.code : undefined)
  if (code == null || code === 0) return body
  const message = String(body.status_msg ?? body.msg ?? body.message ?? (typeof body.data?.message === 'string' ? body.data.message : ''))
  if (code === 8 || code === 2483 || code === 20003 || /未登录|登录/.test(message)) throw authError(ctx, message || undefined)
  throw new CatbusError('UPSTREAM', message || `抖音返回错误 ${code}`, { detail: { code, message } })
}

/** 建立会话并完成设备初始化。 */
export async function douyin(ctx: HandlerContext): Promise<Douyin> {
  const d = new Douyin(ctx)
  await d.init()
  return d
}
