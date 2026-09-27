import { CatbusError } from '../../../core/errors.js'
import type { HttpClient, HttpResponse } from '../../../core/http.js'
import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { genFingerprintReport, genKwfv1, genKwscode } from './oracle.js'
import {
  GDFP,
  HREF_CP,
  HREF_WWW,
  PRODUCT_CP,
  PRODUCT_LIVE,
  PRODUCT_WWW,
  RAW_VALUE_PROFILES,
  SEQUENCES,
  siteDefaults,
  STALE_PAIR_PROFILES,
  UA,
} from './profile.js'
import { weaponDecrypt, weaponEncrypt } from './sign.js'

/**
 * 会话状态（上游 builder/auth.py 的 KuaishouAuth + utils/sign/kww_pure.py 的 KwwSigner + webweapon_boot.py）。
 *
 * - `cookies` 是上游的 `_cookie`：一个名字一个值、按插入顺序的映射，www / cp / live 三个站点共用；
 *   发请求时由 {@link Session.cookieHeader} 按各页面实抓的线序序列化（含同名重复字段）。
 * - webweapon：`kwfv1` 与 `kwfcv1` 是持久的浏览器状态；`kwscode` / `kwssectoken` 只有 6 分钟有效期，
 *   每条命令开始时经 gdfp `/s/w/c` + 官方 kws 脚本现算，不落盘。
 * - 页面 `kww` 是新页面冻结的 kwfv1 快照，之后 Cookie 里的 kwfv1 轮换不影响它。
 */

const QUARTET = ['kwpsecproductname', 'kwfv1', 'kwssectoken', 'kwscode'] as const
type Quartet = [string, string, string, string]
const COOKIE_TTL = 6 * 60 * 1000

export interface Transport {
  http: HttpClient
  log: { debug(m: string, d?: unknown): void }
}

// ================================================================ gdfp（webweapon_boot.py）

export interface WeaponConfig {
  fpUrl: string
  signUrl: string
  secToken: string
  raw: Record<string, unknown>
}

const preflightDone = new WeakMap<HttpClient, Set<string>>()

/**
 * 浏览器对跨站 `POST /s/w/c` 的 CORS 预检（Chrome 缓存 1800 秒）。按 (origin, referer, url) 在本次会话内只做一次。
 */
async function corsPreflight(t: Transport, url: string, origin: string, referer: string): Promise<void> {
  let done = preflightDone.get(t.http)
  if (!done) preflightDone.set(t.http, (done = new Set()))
  const key = `${origin}|${referer}|${url}`
  if (done.has(key)) return
  const res = await t.http.request({
    method: 'OPTIONS',
    url,
    cookies: false,
    headers: [
      ['accept', '*/*'],
      ['access-control-request-headers', 'content-type'],
      ['access-control-request-method', 'POST'],
      ['origin', origin],
      ['sec-fetch-mode', 'cors'],
      ['user-agent', UA],
      ['accept-encoding', 'gzip, deflate, br, zstd'],
      ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
      ['priority', 'u=1, i'],
      ['referer', referer],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-site', 'cross-site'],
    ],
  })
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `gdfp /s/w/c 预检失败：HTTP ${res.status}`, { detail: { kind: 'webweapon' } })
  done.add(key)
}

/** fetch_config：`POST gdfp /s/w/c` 换票，拿到 kwf / kws 脚本地址与 secToken。 */
export async function fetchConfig(t: Transport, did: string, product: string, referer: string): Promise<WeaponConfig> {
  const url = `${GDFP}/s/w/c`
  const u = new URL(referer)
  const origin = `${u.protocol}//${u.host}`
  await corsPreflight(t, url, origin, referer)
  const plain = compactJson({ productName: product, ts: rand.now(), did })
  const res = await t.http.request({
    method: 'POST',
    url,
    cookies: false,
    body: compactJson({ data: weaponEncrypt(plain) }),
    headers: [
      ['user-agent', UA],
      ['content-type', 'application/json'],
      ['referer', referer],
      ['accept', '*/*'],
      ['accept-encoding', 'gzip, deflate, br, zstd'],
      ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
      ['origin', origin],
      ['priority', 'u=1, i'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'cross-site'],
    ],
  })
  const text = await res.text()
  let envelope: any
  try {
    envelope = JSON.parse(text)
  } catch {
    throw new CatbusError('UPSTREAM', `gdfp /s/w/c 返回的不是 JSON（HTTP ${res.status}）`, { detail: { kind: 'webweapon', body: text.slice(0, 200) } })
  }
  if (envelope?.result !== 1) {
    throw new CatbusError('UPSTREAM', `gdfp 换票失败：result=${envelope?.result} ${envelope?.error_msg ?? ''}`, { detail: { kind: 'webweapon', result: envelope?.result } })
  }
  const data = JSON.parse(weaponDecrypt(String(envelope.dataRsp)))
  return { fpUrl: String(data.fpUrl ?? ''), signUrl: String(data.signUrl ?? ''), secToken: String(data.secToken ?? ''), raw: data }
}

/** report_fingerprint：官方 kwf 的 getData(1) → `POST gdfp /s/w/p`，换回服务端下发的 17 位 wid。 */
export async function reportFingerprint(
  t: Transport,
  o: { did: string; product: string; referer: string; href: string; cookie: string; kwfcv1: string; currentKwfv1: string },
): Promise<string> {
  const report = genFingerprintReport({ did: o.did, href: o.href, cookie: o.cookie, kwfcv1: o.kwfcv1, currentKwfv1: o.currentKwfv1 })
  if (!report) throw new CatbusError('UPSTREAM', '官方 kwf 脚本没有产出指纹上报数据', { detail: { kind: 'webweapon' } })
  const body = compactJson(new Map<string, unknown>([['1', o.did], ['2', o.product], ['9', rand.now()], ['data', report], ['p', 'w']]))
  const res = await t.http.request({
    method: 'POST',
    url: `${GDFP}/s/w/p`,
    cookies: false,
    body,
    headers: [
      ['user-agent', UA],
      ['content-type', 'application/json'],
      ['referer', o.referer],
      ['accept', '*/*'],
      ['accept-encoding', 'gzip, deflate, br, zstd'],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['origin', o.referer.replace(/\/+$/, '')],
      ['priority', 'u=1, i'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'cross-site'],
    ],
  })
  const data: any = await res.json().catch(() => ({}))
  const wid = data?.c === 200 ? String(data.r ?? '') : ''
  if (!/^\d{17}$/.test(wid)) throw new CatbusError('UPSTREAM', '快手设备指纹上报被拒绝', { detail: { kind: 'webweapon', response: data } })
  return wid
}

// ================================================================ KwwSigner（kww_pure.py）

/** 页面级 kww 快照与当前 webweapon Cookie 的独立持有者。 */
export class KwwSigner {
  kwfv1: string
  kwfcv1: string
  private snapshot: string
  kwscode: string
  secToken: string
  fromCookie: boolean
  issuedAt: number
  config: WeaponConfig | null = null

  constructor(
    private readonly t: Transport,
    kwfv1: string,
    public href: string,
    public did: string,
    public product: string,
    kwscode: string,
    kwssectoken: string,
    kwwSnapshot: string | null,
    kwfcv1: string,
  ) {
    this.kwfv1 = kwfv1 || ''
    this.snapshot = kwwSnapshot == null ? this.kwfv1 : kwwSnapshot || ''
    this.kwfcv1 = kwfcv1 || ''
    this.kwscode = kwscode || ''
    this.secToken = kwssectoken || ''
    this.fromCookie = Boolean(kwscode && kwssectoken)
    this.issuedAt = this.fromCookie ? rand.now() : 0
  }

  get kwwSnapshot(): string {
    return this.snapshot
  }

  /** 当前页面冻结的 kww；还没有快照时先完成 exact bootstrap。 */
  async sign(): Promise<string> {
    if (!this.snapshot) {
      if (!this.kwfv1) await this.refreshIfNeeded()
      if (!this.kwfv1) throw new CatbusError('UPSTREAM', 'webweapon 没有产出 kwfv1', { detail: { kind: 'webweapon' } })
      this.snapshot = this.kwfv1
    }
    return this.snapshot
  }

  /** 源码 `if (!r || !o)`：有值就一直用，缺失或超过 6 分钟才重新引导。 */
  async refreshIfNeeded(): Promise<void> {
    if (this.kwfv1 && this.kwscode && this.secToken && rand.now() - this.issuedAt < COOKIE_TTL) return
    await this.bootstrap()
  }

  /** `/s/w/c` 换票 → 官方 kwf 脚本算 kwfv1 → 官方 kws 脚本算 kwscode。 */
  async bootstrap(): Promise<void> {
    if (!this.did) throw new CatbusError('ERROR', 'webweapon 引导缺少 did')
    const cfg = await fetchConfig(this.t, this.did, this.product || PRODUCT_WWW, this.href || 'https://www.kuaishou.com/')
    if (!(cfg.fpUrl && cfg.signUrl && cfg.secToken)) throw new CatbusError('UPSTREAM', 'gdfp /s/w/c 缺少 fpUrl / signUrl / secToken', { detail: { kind: 'webweapon' } })
    if (cfg.secToken.length !== 88) throw new CatbusError('UPSTREAM', 'gdfp secToken 长度异常', { detail: { kind: 'webweapon' } })
    const href = this.href || HREF_WWW
    const state = genKwfv1({ did: this.did, href, kwfcv1: this.kwfcv1, currentKwfv1: this.kwfv1, scriptPath: cfg.fpUrl })
    this.kwfcv1 = state.kwfcv1 || this.kwfcv1
    if (!state.value) throw new CatbusError('UPSTREAM', '官方 kwf 脚本没有产出 kwfv1', { detail: { kind: 'webweapon' } })
    this.kwfv1 = state.value
    const kwscode = await genKwscode({ secToken: cfg.secToken, did: this.did, href, signUrl: cfg.signUrl, http: this.t.http })
    this.secToken = cfg.secToken
    this.kwscode = kwscode
    this.config = cfg
    this.fromCookie = false
    this.issuedAt = rand.now()
    this.t.log.debug(`webweapon 已引导：${this.product}`)
  }

  async cookies(): Promise<Record<(typeof QUARTET)[number], string>> {
    await this.refreshIfNeeded()
    if (!this.kwfv1) throw new CatbusError('UPSTREAM', 'webweapon 没有产出 kwfv1', { detail: { kind: 'webweapon' } })
    return { kwfv1: this.kwfv1, kwscode: this.kwscode, kwssectoken: this.secToken, kwpsecproductname: this.product }
  }
}

// ================================================================ Session（KuaishouAuth）

export type LiveContext = 'home' | 'room' | 'profile'

/** passToken / Set-Cookie / 正文里下发的票据：按顺序合并进 cookie。 */
export type Issued = [string, string][]

export class Session {
  /** 上游 `_cookie`。 */
  readonly cookies = new Map<string, string>()
  kwfv1 = ''
  kwfcv1 = ''
  kwwSnapshot = ''
  did = ''
  didv = ''
  userId: string | null = null
  cpApiPh = ''
  history: Quartet[] = []
  wwwPhase: 'initial' | 'refreshed' | 'security_refreshed' | 'relogin' = 'initial'
  cpPhase: 'initial' | 'warmed' | 'refreshed' = 'initial'
  livePhase: Record<LiveContext, string> = { home: 'initial', room: 'initial', profile: 'initial' }
  liveHomeLoginPayCount = 0
  liveRoomLoginPayCount = 0
  private readonly liveSentry = new Map<string, { trace: string; spans: Set<string> }>()
  liveBootstrapEnabled = false
  selfEid = ''
  signer!: KwwSigner

  constructor(private readonly t: Transport) {}

  private cookie(name: string): string {
    return this.cookies.get(name) ?? ''
  }

  private newSigner(kwfv1: string, href: string, product: string, snapshot: string | null): KwwSigner {
    return new KwwSigner(this.t, kwfv1, href, this.did, product, this.cookie('kwscode'), this.cookie('kwssectoken'), snapshot, this.kwfcv1)
  }

  /** prepare_auth：解析 cookie，补齐 did / didv / product，配置 webweapon。只解析、不出网。 */
  prepare(cookies: Iterable<[string, string]>): this {
    this.cookies.clear()
    for (const [k, v] of cookies) if (k) this.cookies.set(k, v)
    this.wwwPhase = 'initial'
    this.cpPhase = 'initial'
    this.livePhase = { home: 'initial', room: 'initial', profile: 'initial' }
    this.liveHomeLoginPayCount = 0
    this.liveRoomLoginPayCount = 0
    this.liveSentry.clear()
    if (!this.cookie('did')) this.cookies.set('did', 'web_' + rand.hex(16))
    const [href, product] = siteDefaults(this.cookie('kwpsecproductname') || PRODUCT_WWW)
    this.cookies.set('kwpsecproductname', product)
    this.kwfv1 = this.cookie('kwfv1')
    this.kwfcv1 = ''
    this.did = this.cookie('did')
    this.didv = this.cookie('didv') || String(rand.now())
    this.cookies.set('didv', this.didv)
    this.userId = this.cookie('userId') || this.cookie('userid') || null
    this.cpApiPh = this.cookie('kuaishou.web.cp.api_ph')
    this.signer = this.newSigner(this.kwfv1, href, product, this.kwfv1)
    this.kwwSnapshot = this.kwfv1
    return this
  }

  /** 恢复持久化的 localStorage 计数器（prepare_state 的 webweapon.kwfcv1）。 */
  restoreCounter(kwfcv1: string): void {
    this.kwfcv1 = kwfcv1
    this.signer.kwfcv1 = kwfcv1
  }

  /** _ensure_browser_defaults：只补用户 CK 里没有的稳定默认值。 */
  ensureBrowserDefaults(): void {
    const product = this.cookie('kwpsecproductname') || PRODUCT_WWW
    if (!this.cookies.has('kpf')) this.cookies.set('kpf', 'PC_WEB')
    if (!this.cookies.has('clientid')) this.cookies.set('clientid', '3')
    if (!this.cookies.has('kpn')) this.cookies.set('kpn', product === PRODUCT_LIVE ? 'GAME_ZONE' : 'KUAISHOU_VISION')
  }

  /**
   * 上游的 `auth.cookie` 属性：必要时完成 webweapon 引导，把当前 quartet 写回 cookie，
   * 返回非 quartet 字段在前、quartet 在后的合并映射。
   */
  async current(): Promise<Map<string, string>> {
    const generated = await this.signer.cookies()
    const previous = QUARTET.map((k) => this.cookie(k)) as Quartet
    const now = QUARTET.map((k) => generated[k] ?? '') as Quartet
    if (previous.every(Boolean) && previous.join('\0') !== now.join('\0')) {
      if (!this.history.some((h) => h.join('\0') === previous.join('\0'))) this.history.push(previous)
      if (this.wwwPhase === 'refreshed' && previous.slice(2).join('\0') !== now.slice(2).join('\0')) this.wwwPhase = 'security_refreshed'
    }
    for (const k of QUARTET) if (generated[k]) this.cookies.set(k, generated[k])
    if (generated.kwfv1) this.kwfv1 = generated.kwfv1
    this.kwfcv1 = this.signer.kwfcv1 || ''
    const merged = new Map<string, string>()
    for (const [k, v] of this.cookies) if (k && !(QUARTET as readonly string[]).includes(k)) merged.set(k, v)
    const product = this.cookie('kwpsecproductname') || generated.kwpsecproductname
    if (product) merged.set('kwpsecproductname', product)
    for (const k of ['kwfv1', 'kwssectoken', 'kwscode'] as const) {
      const v = generated[k] || this.cookie(k)
      if (v) merged.set(k, v)
    }
    return merged
  }

  /** `k=v; k=v` 形式（上游把 `auth.cookie` 交给 curl_cffi 时的顺序）。 */
  async currentLine(): Promise<string> {
    return [...(await this.current())].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** 请求头 kww：页面冻结的快照，Cookie 轮换不影响它。 */
  async kww(): Promise<string> {
    this.kwwSnapshot = await this.signer.sign()
    this.kwfcv1 = this.signer.kwfcv1 || ''
    return this.kwwSnapshot
  }

  /** cookie_header：按页面、阶段选择 Chrome 实抓的 Cookie 线序并序列化（保留同名重复字段）。 */
  async cookieHeader(site = 'www'): Promise<string> {
    let profile = site.toLowerCase()
    if (profile === 'www') profile = this.wwwPhase === 'security_refreshed' ? 'www_security_refreshed' : this.wwwPhase === 'refreshed' ? 'www_refreshed' : 'www_initial'
    else if (profile === 'www_graphql_detail') profile = 'www_graphql_detail_initial'
    else if (profile === 'cp_creator') profile = this.cpPhase === 'refreshed' ? 'cp_creator_refreshed' : this.cpPhase === 'warmed' ? 'cp_creator_warmed' : 'cp_creator_initial'
    else if (profile === 'www_graphql') profile = this.wwwPhase !== 'initial' && this.wwwPhase !== 'relogin' ? 'www_graphql_refreshed' : 'www_graphql_initial'

    const values = RAW_VALUE_PROFILES.has(profile) ? new Map(this.cookies) : await this.current()
    const sequence = SEQUENCES[profile] ?? SEQUENCES.www_initial!
    const stale = this.history.at(-1)
    const occurrences = new Map<string, number>()
    const out: string[] = []
    for (const key of sequence) {
      let value = values.get(key)
      if (value == null || value === '') continue
      const n = (occurrences.get(key) ?? 0) + 1
      occurrences.set(key, n)
      if (stale && STALE_PAIR_PROFILES.has(profile) && (key === 'kwssectoken' || key === 'kwscode') && n % 2 === 1) {
        value = key === 'kwssectoken' ? stale[2] : stale[3]
      }
      if (stale && (profile.startsWith('www_graphql_') || profile.startsWith('www_relogin_')) && key === 'kwpsecproductname' && n === 2 && stale[0]) value = stale[0]
      out.push(`${key}=${value}`)
    }
    return out.join('; ')
  }

  /** update_cookies：并入服务端新下发的 cookie；页面已冻结的 kww 保留。 */
  update(issued: Issued | Record<string, string>): this {
    const pairs = Array.isArray(issued) ? issued : Object.entries(issued)
    if (!pairs.length) return this
    for (const [k, v] of pairs) if (v != null) this.cookies.set(k, String(v))
    this.userId = this.cookie('userId') || this.cookie('userid') || this.userId
    this.did = this.cookie('did') || this.did
    this.cpApiPh = this.cookie('kuaishou.web.cp.api_ph') || this.cpApiPh
    const previousKww = this.signer?.kwwSnapshot ?? ''
    const kwfv1 = pairs.find(([k]) => k === 'kwfv1')?.[1]
    if (kwfv1) this.kwfv1 = kwfv1
    const [href, product] = siteDefaults(this.cookie('kwpsecproductname') || PRODUCT_WWW)
    this.signer = this.newSigner(this.kwfv1, href, product, previousKww)
    this.kwwSnapshot = previousKww
    return this
  }

  /** use_site：切到某个站点的 webweapon 页面（www / cp / live 的 product 与 href 不同）。 */
  useSite(site: string): this {
    const value = site.toLowerCase()
    const previous = this.cookie('kwpsecproductname')
    let product: string
    if (value.includes('cp.kuaishou.com') || value === 'cp' || value === PRODUCT_CP) {
      product = PRODUCT_CP
      this.cpPhase = 'initial'
    } else if (value.includes('live.kuaishou.com') || value === 'live' || value === PRODUCT_LIVE.toLowerCase()) {
      product = PRODUCT_LIVE
    } else {
      product = PRODUCT_WWW
      this.wwwPhase = 'initial'
    }
    if (previous && previous !== product) this.history = []
    this.cookies.set('kwpsecproductname', product)
    if (product === PRODUCT_LIVE) {
      this.livePhase = { home: 'initial', room: 'initial', profile: 'initial' }
      this.liveHomeLoginPayCount = 0
      this.liveRoomLoginPayCount = 0
    }
    const [href] = siteDefaults(product)
    const snapshot = this.kwfv1 || this.cookie('kwfv1')
    this.signer = this.newSigner(this.kwfv1, href, product, snapshot)
    this.kwwSnapshot = snapshot
    return this
  }

  private rememberQuartet(): void {
    const current = QUARTET.map((k) => this.cookie(k)) as Quartet
    if (current.every(Boolean) && !this.history.some((h) => h.join('\0') === current.join('\0'))) this.history.push(current)
  }

  /**
   * use_cp_upload：选择视频后的 CP 上传上下文。product 回到 kuaishou-vision；
   * 页面 kww 保持 174 字符，而上传 Cookie 的 kwfv1 要换成 CP 0.1.1 kwf 的 218 字符（kwfcv1=999 的那一代）。
   */
  async useCpUpload(): Promise<void> {
    const product = PRODUCT_WWW
    const previous = this.signer
    if (this.cookie('kwpsecproductname') !== product) this.rememberQuartet()
    this.cookies.set('kwpsecproductname', product)
    const snapshot = previous.href === HREF_CP ? previous.kwwSnapshot : this.kwfv1 || this.cookie('kwfv1')
    if (this.liveBootstrapEnabled && this.kwfv1.length !== 218) {
      const upload = new KwwSigner(this.t, '', HREF_CP, this.did, PRODUCT_CP, '', '', snapshot, '999')
      await upload.bootstrap()
      upload.product = product
      this.signer = upload
      const generated = await upload.cookies()
      this.kwfv1 = upload.kwfv1
      this.kwfcv1 = upload.kwfcv1
      for (const k of ['kwfv1', 'kwssectoken', 'kwscode'] as const) if (generated[k]) this.cookies.set(k, generated[k])
    } else {
      this.signer = new KwwSigner(this.t, this.kwfv1, HREF_CP, this.did, product, this.cookie('kwscode'), this.cookie('kwssectoken'), snapshot, this.kwfcv1)
    }
    this.kwwSnapshot = snapshot
  }

  /** use_cp_atlas：图文编辑 / 上传上下文，product 保持 onvideo-cp。 */
  useCpAtlas(): void {
    const product = PRODUCT_CP
    const previous = this.signer
    if (this.cookie('kwpsecproductname') !== product) this.rememberQuartet()
    this.cookies.set('kwpsecproductname', product)
    const snapshot = previous.href === HREF_CP ? previous.kwwSnapshot : this.kwfv1 || this.cookie('kwfv1')
    this.signer = new KwwSigner(this.t, this.kwfv1, HREF_CP, this.did, product, this.cookie('kwscode'), this.cookie('kwssectoken'), snapshot, this.kwfcv1)
    this.kwwSnapshot = snapshot
  }

  advanceLive(context: LiveContext, phase: string): void {
    this.livePhase[context] = phase
  }

  private static nonzeroHex(bytes: number): string {
    for (;;) {
      const v = rand.hex(bytes)
      if (/[^0]/.test(v)) return v
    }
  }

  /** 一次直播页导航的 Sentry transaction：同页请求共用 32 位 trace id。 */
  beginLiveTransaction(referer: string): string {
    const trace = Session.nonzeroHex(16)
    this.liveSentry.set(referer, { trace, spans: new Set() })
    return trace
  }

  /** (页面 trace id, 新的 16 位 span id)。 */
  nextLiveSentry(referer: string): [string, string] {
    let state = this.liveSentry.get(referer)
    if (!state) {
      this.beginLiveTransaction(referer)
      state = this.liveSentry.get(referer)!
    }
    for (;;) {
      const span = Session.nonzeroHex(8)
      if (!state.spans.has(span)) {
        state.spans.add(span)
        return [state.trace, span]
      }
    }
  }

  /** 是否只有直播站票据、没有创作者中心票据（直接打开直播页的会话形态）。 */
  get liveOnly(): boolean {
    return !(this.cookie('kuaishou.web.cp.api_st') || this.cookie('kuaishou.web.cp.api_ph'))
  }
}

// ================================================================ 响应工具

/** response_cookies：Set-Cookie 下发的 名字 → 值（删除用的过期 cookie 不算）。 */
export function responseCookies(res: HttpResponse): Issued {
  const out: Issued = []
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';')
    const i = pair!.indexOf('=')
    if (i <= 0) continue
    const name = pair!.slice(0, i).trim()
    const value = pair!.slice(i + 1).trim()
    const expired = attrs.some((a) => {
      const [k, v = ''] = a.split('=').map((s) => s.trim())
      if (k!.toLowerCase() === 'max-age') return Number(v) <= 0
      if (k!.toLowerCase() === 'expires') return Date.parse(v) <= rand.now()
      return false
    })
    if (expired) continue
    const j = out.findIndex(([k]) => k === name)
    if (j >= 0) out[j] = [name, value]
    else out.push([name, value])
  }
  return out
}

/** 按顺序合并：已有的键原位覆盖，新键追加（Python dict.update）。 */
export function mergeIssued(into: Issued, more: Issued | Record<string, string>): Issued {
  for (const [k, v] of Array.isArray(more) ? more : Object.entries(more)) {
    const i = into.findIndex(([n]) => n === k)
    if (i >= 0) into[i] = [k, v]
    else into.push([k, v])
  }
  return into
}
