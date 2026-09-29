import { createCipheriv } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import { HttpClient, type HttpRequest, type HttpResponse, parseJsonp } from '../../../core/http.js'
import { compactJson, jsonDumps, type Pairs, quote, type Scalar, unquote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Cookie } from '../../../core/schemas.js'
import { authError, scope } from '../../../core/toolkit.js'
import { DEVICE_PROFILE, DeviceToken, H5st, type JsHost, type TokenCache } from './js.js'
import {
  API_URL,
  APPID_PC_ITEM,
  AXIOS_ORDER,
  BROWSER,
  CLIENT_WH5,
  type ClientPreset,
  COOKIE_DOMAIN,
  FETCH_ORDER,
  H5ST_SIGN_KEYS,
  type Header,
  ITEM_ORIGIN,
  ITEM_REFERER,
  PROFILE,
  SEARCH_REFERER,
  xhr,
} from './profile.js'
import { bootstrapCookies, sha256Hex } from './util.js'

/**
 * 京东 web 端的会话（上游 builder/auth.py 的 JdAuth + jd_apis/jd_api.py 的 call_api）。
 *
 * 上游的 cookie 是一张不分域的有序表，发往所有京东站点，响应里的 Set-Cookie 按名字合并（空值即删除）；
 * 这里照搬：凭证里的 cookie 统一记在 `.jd.com` 下，请求时显式带上整张表。
 * 按 origin 保存的 localStorage 放在凭证的 device.local_storage，咚咚会话参数放在 extra.chat。
 */

/** SimpleCookie 认得的属性（其余 key=value 会被它当作新 cookie）。 */
const RESERVED = new Set(['expires', 'path', 'comment', 'domain', 'max-age', 'secure', 'httponly', 'version', 'samesite'])
const FLAGS = new Set(['secure', 'httponly'])

/** `http.cookies.SimpleCookie().load(line)` 的结果：解析失败时为空。 */
export function simpleCookie(line: string): [string, string][] {
  const patt =
    /\s*(?<key>[\w\d!#%&'~_`><@,:/$*+\-.^|)(?}{=]+?)(\s*=\s*(?<val>"(?:[^\\"]|\\.)*"|\w{3},\s[\w\d\s-]{9,11}\s[\d:]{8}\sGMT|[\w\d!#%&'~_`><@,:/$*+\-.^|)(?}{=\[\]]*))?\s*(\s+|;|$)/y
  const items: [string, string][] = []
  let seen = false
  let i = 0
  while (i < line.length) {
    patt.lastIndex = i
    const m = patt.exec(line)
    if (!m || m[0].length === 0) break
    i = patt.lastIndex
    const key = m.groups!.key!
    const value = m.groups!.val
    if (key[0] === '$') continue
    const lower = key.toLowerCase()
    if (RESERVED.has(lower)) {
      if (!seen) return []
      if (value == null && !FLAGS.has(lower)) return []
    } else if (value != null) {
      items.push([key, cookieUnquote(value)])
      seen = true
    } else return []
  }
  return items
}

function cookieUnquote(v: string): string {
  if (v.length < 2 || v[0] !== '"' || v[v.length - 1] !== '"') return v
  return v.slice(1, -1).replace(/\\(?:([0-3][0-7][0-7])|(.))/g, (_, oct: string, ch: string) => (oct ? String.fromCharCode(parseInt(oct, 8)) : ch))
}

export interface CallOptions {
  body?: unknown
  client?: ClientPreset
  extra?: Pairs
  appId?: string
  path?: string
  jsonp?: string
  referer?: string
  origin?: string
  refererPage?: string
  rpClient?: string
  method?: 'GET' | 'POST'
  withTime?: boolean
  sign?: boolean
  bodyInQuery?: boolean
  retry?: number
  order?: readonly string[]
  withUuid?: boolean
  drop?: readonly string[]
  appendTime?: boolean
  contentType?: string
  accept?: string
  uuid?: string
  axios?: boolean
}

export interface ChatInfo {
  aid: string | null
  app_id: string
  dvc: string | null
  client_type: string
}

export class Jd {
  readonly http: HttpClient
  readonly h5st: H5st
  readonly device: DeviceToken
  /** 与凭证同步的有序 cookie 表。 */
  readonly cookies: Map<string, string>
  /** searchWare 记下的关键词，后续同页请求用同一个 Referer。 */
  searchKeyword = ''

  constructor(readonly ctx: HandlerContext) {
    this.http = new HttpClient({ browser: BROWSER, os: 'windows', proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
    this.cookies = new Map(scope(ctx.credential).cookies.map((c) => [c.name, c.value]))
    const host: JsHost = { http: this.http, log: ctx.log }
    this.h5st = new H5st(host, {
      load: () => {
        const c = ctx.credential.device.h5st as TokenCache | undefined
        return c?.profile === PROFILE.profileId ? c : null
      },
      save: (cache) => {
        ctx.credential.device.h5st = cache
      },
    })
    this.device = new DeviceToken(host)
  }

  // ---------------------------------------------------------------- cookie

  get cookieStr(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name)
  }

  /** 合并 cookie；空值按服务端删除指令处理（update_cookies）。 */
  update(values: Iterable<[string, string | null | undefined]> | Record<string, string | null | undefined>): void {
    const entries = Symbol.iterator in Object(values) ? (values as Iterable<[string, string | null | undefined]>) : Object.entries(values)
    let changed = false
    for (const [key, value] of entries) {
      if (value == null || value === '') {
        if (this.cookies.delete(key)) changed = true
      } else if (this.cookies.get(key) !== String(value)) {
        this.cookies.set(key, String(value))
        changed = true
      }
    }
    if (changed) this.persist()
  }

  private persist(): void {
    const old = new Map(scope(this.ctx.credential).cookies.map((c) => [c.name, c]))
    const list: Cookie[] = []
    for (const [name, value] of this.cookies) {
      const prev = old.get(name)
      list.push({ name, value, domain: COOKIE_DOMAIN, path: '/', expires: prev?.value === value ? (prev.expires ?? null) : null })
    }
    scope(this.ctx.credential).cookies.splice(0, Infinity, ...list)
  }

  /** 吸收响应的 Set-Cookie 与 `x-rp-sdtoken`（absorb_response + _absorb_response）。 */
  absorb(res: HttpResponse): void {
    const lines = res.headers.getSetCookie()
    for (const line of lines) this.update(simpleCookie(line))
    const jar = new Map<string, string>()
    for (const line of lines) {
      const i = line.indexOf('=')
      if (i < 0) continue
      jar.set(line.slice(0, i).trim(), line.slice(i + 1).split(';', 1)[0]!.trim())
    }
    this.update([...jar].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    const raw = res.headers.get('x-rp-sdtoken')
    if (raw?.startsWith('set;')) {
      const parts = splitN(raw, ';', 2)
      if (parts.length === 3) this.update([['sdtoken', parts[2]!]])
    }
  }

  /** 登录态（thor 或 pt_key，加 pin）。 */
  get pin(): string | null {
    const raw = this.cookie('pin') || this.cookie('pt_pin') || this.cookie('_pst')
    return raw ? unquote(raw) : null
  }

  get isLogin(): boolean {
    return Boolean((this.cookie('thor') || this.cookie('pt_key')) && this.pin)
  }

  // ---------------------------------------------------------------- localStorage 与咚咚会话

  private get storage(): Record<string, Record<string, string>> {
    return ((this.ctx.credential.device.local_storage as Record<string, Record<string, string>>) ??= {})
  }

  static storageOrigin(pageUrl: string): string {
    try {
      const u = new URL(pageUrl)
      if (u.protocol && u.host) return `${u.protocol}//${u.host}`.toLowerCase()
    } catch {}
    return String(pageUrl ?? '')
  }

  localStorageFor(pageUrl: string): Record<string, string> {
    return { ...(this.storage[Jd.storageOrigin(pageUrl)] ?? {}) }
  }

  replaceLocalStorage(pageUrl: string, values: Record<string, unknown>): void {
    const origin = Jd.storageOrigin(pageUrl)
    if (!origin || !values || typeof values !== 'object') return
    this.storage[origin] = Object.fromEntries(Object.entries(values).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
  }

  get chat(): ChatInfo {
    return ((this.ctx.credential.extra.chat as ChatInfo) ??= { aid: null, app_id: 'im.customer', dvc: null, client_type: 'comet' })
  }

  setChatInfo(values: Partial<ChatInfo>): void {
    for (const [k, v] of Object.entries(values)) if (v) (this.chat as unknown as Record<string, unknown>)[k] = v
  }

  get deviceProfile(): string | null {
    return (this.ctx.credential.device.profile as string | undefined) ?? null
  }

  setDeviceProfile(value: string): void {
    if (value) this.ctx.credential.device.profile = value
  }

  // ---------------------------------------------------------------- 游客态

  /**
   * 游客态（上游 utils/jd_cookie.bootstrap + utils/device_token.get_device_fields）：
   * 埋点 cookie 与收货地区本地生成；eid / jsToken 由 pc-tk.js 换取，结果留在游客凭证里复用。
   */
  async ensureGuest(): Promise<void> {
    if (!this.cookie('__jdu')) this.update(bootstrapCookies('www'))
    if (this.cookie('3AB9D23F7A4B3CSS')) return
    try {
      await this.refreshDevice()
    } catch (err) {
      this.ctx.log.debug(`游客设备参数生成失败：${(err as Error).message}`)
    }
  }

  /** 用 pc-tk.js 换设备票据写进 cookie；画像版本变化时强制换新。 */
  async refreshDevice(page?: string, origin?: string, referer?: string) {
    this.device.configure(this.cookieStr, page, origin, referer)
    const force = this.deviceProfile !== DEVICE_PROFILE
    const d = await this.device.get(force)
    this.update([
      ['3AB9D23F7A4B3C9B', d.eid],
      ['3AB9D23F7A4B3CSS', d.eid2],
      ...(d.giaD ? ([['_gia_d', d.giaD]] as [string, string][]) : []),
    ])
    this.setDeviceProfile(DEVICE_PROFILE)
    return d
  }

  // ---------------------------------------------------------------- 请求

  /** 发请求并吸收 cookie。默认显式带整张 cookie 表。 */
  async send(req: HttpRequest): Promise<HttpResponse> {
    const res = await this.http.request({ cookies: Object.fromEntries(this.cookies), ...req })
    this.absorb(res)
    return res
  }

  /** 签 h5st（builder/params.py with_h5st）：body 先取 SHA-256。 */
  async signH5st(params: Map<string, Scalar>, appId: string): Promise<string> {
    const sign: Record<string, Scalar> = {}
    for (const k of H5ST_SIGN_KEYS) if (params.has(k)) sign[k] = params.get(k)
    if ('body' in sign) sign.body = sha256Hex(String(sign.body))
    return String((await this.h5st.sign(sign, appId)).h5st ?? '')
  }

  /**
   * api.m.jd.com 通用调用（JdAPI.call_api）：装配 query → 算 h5st → 发请求；403 空 body 时重签重试。
   * 返回平台原始 JSON（或 jsonp 解开后的对象）；风控处置（x-rp-content）命中时照样返回原始结果。
   */
  async call(functionId: string, o: CallOptions = {}): Promise<any> {
    const method = o.method ?? 'POST'
    const sign = o.sign ?? true
    const withTime = o.withTime ?? true
    const retry = o.retry ?? 2
    const params = new Map<string, Scalar>()
    for (const [k, v] of Object.entries(o.client ?? CLIENT_WH5)) if (!params.has(k)) params.set(k, v)
    params.set('functionId', functionId)
    if (o.withUuid ?? true) {
      const uuid = o.uuid ?? this.cookie('__jdu')
      if (uuid) params.set('uuid', uuid)
    }
    if (o.body !== undefined) params.set('body', typeof o.body === 'string' ? o.body : compactJson(o.body))
    if (o.jsonp) params.set('jsonp', o.jsonp)
    for (const [k, v] of o.extra ?? []) params.set(k, v)
    if (sign) this.h5st.configure(this.cookieStr, o.origin || ITEM_ORIGIN, o.referer || ITEM_REFERER)
    const eid = this.cookie('3AB9D23F7A4B3CSS')
    if (eid) params.set('x-api-eid-token', eid)
    for (const k of o.drop ?? []) params.delete(k)

    const axios = o.axios ?? Boolean(o.rpClient)
    let h: Header
    if (o.jsonp) throw new Error('jsonp 调用未移植')
    else if (method !== 'POST' || o.bodyInQuery) h = xhr({ axios, accept: o.accept })
    else h = xhr({ axios, form: true, accept: o.accept })
    if (o.contentType != null) h.set('content-type', o.contentType)
    h.referer(o.referer || ITEM_REFERER)
    if (o.origin) h.origin(o.origin)
    if (o.rpClient) {
      h.set('x-referer-page', o.refererPage || (o.origin ?? '') + '/')
      h.set('x-rp-client', o.rpClient)
    }
    h.reorder(axios ? AXIOS_ORDER : FETCH_ORDER)

    const url = `${API_URL}${o.path ?? '/client.action'}`
    let current = params
    for (let attempt = 0; attempt <= retry; attempt++) {
      if (withTime) current.set('t', String(rand.now()))
      if (sign) current.set('h5st', await this.signH5st(current, o.appId ?? APPID_PC_ITEM))
      if (o.order) current = reorder(current, o.order)
      let query: Pairs = [...current]
      if (o.appendTime) query.push(['t', String(rand.now())])
      let res: HttpResponse
      if (method === 'POST') {
        let formBody = ''
        if (!o.bodyInQuery) {
          formBody = String(query.find(([k]) => k === 'body')?.[1] ?? '')
          query = query.filter(([k]) => k !== 'body')
        }
        res = await this.send({ method: 'POST', url, headers: h.get(), query, form: o.bodyInQuery ? undefined : [['body', formBody]] })
      } else {
        res = await this.send({ method: 'GET', url, headers: h.get(), query })
      }
      const raw = new Uint8Array(await res.clone().arrayBuffer())
      const rejected = res.status === 403 && raw.length === 0
      const risk = readDisposal(res)
      if (risk) {
        this.ctx.log.warn(`${functionId} 被风控拦下：${risk}`)
        return parse(res)
      }
      if (!rejected || attempt === retry) {
        if (rejected) this.ctx.log.warn(`${functionId} 连续 ${retry + 1} 次 403 空 body：被限流、风控或登录态失效`)
        return parse(res)
      }
      await rand.sleep(600 * (attempt + 1))
    }
  }

  /** risk_h5 信封（_risk_post）：内层 JSON 经 AES-CBC 加密。 */
  async riskPost(referer: string, functionId: string, inner: Record<string, unknown>): Promise<any> {
    const raw = Buffer.from(jsonDumps(inner, { separators: [',', ':'], ensureAscii: false }), 'utf8')
    const cipher = createCipheriv('aes-128-cbc', Buffer.from('rhiasnkdhandrisk'), Buffer.from('r-s-h-n_r_isnkdk'))
    const encrypted = Buffer.concat([cipher.update(raw), cipher.final()])
    const outer = { sdkClient: 'pc', sdkVersion: 'pc_2.1.0', enbody: encrypted.toString('base64url') }
    const form: Pairs = [
      ['appid', 'risk_h5'],
      ['functionId', functionId],
      ['body', jsonDumps(outer, { separators: [',', ':'], ensureAscii: false })],
    ]
    const eid = this.cookie('3AB9D23F7A4B3CSS')
    if (eid) form.push(['x-api-eid-token', eid])
    const h = xhr({ form: true, accept: 'application/json' }).referer(referer).origin('https://cfe.m.jd.com')
    const res = await this.send({ method: 'POST', url: `${API_URL}/api`, headers: h.get(), form })
    return res.json()
  }

  /** 写操作 / 需要登录的接口前检查登录态。 */
  requireLogin(): void {
    if (!this.isLogin) throw authError(this.ctx, '当前账号缺少 thor / pin，请重新登录')
  }
}

/** 按浏览器实抓的顺序重排；不在 order 里的键按原顺序垫在后面。 */
function reorder(params: Map<string, Scalar>, order: readonly string[]): Map<string, Scalar> {
  const out = new Map<string, Scalar>()
  for (const k of order) if (params.has(k)) out.set(k, params.get(k))
  for (const [k, v] of params) if (!out.has(k)) out.set(k, v)
  return out
}

function splitN(s: string, sep: string, n: number): string[] {
  const out: string[] = []
  let rest = s
  while (out.length < n) {
    const i = rest.indexOf(sep)
    if (i < 0) break
    out.push(rest.slice(0, i))
    rest = rest.slice(i + sep.length)
  }
  out.push(rest)
  return out
}

/** 响应体：JSON，其次 jsonp，都不是时给出状态与片段（_parse）。 */
export async function parse(res: HttpResponse): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const p = parseJsonp(text)
    if (p != null) return p
    return { _status: res.status, _raw: text.slice(0, 1000) }
  }
}

/** 解 `x-rp-content` 头里的风控处置（_read_disposal）。 */
export function decodeDisposal(raw: string | null): any {
  if (!raw) return null
  for (let cut = 0; cut < 4; cut++) {
    const chunk = cut ? raw.slice(0, raw.length - cut) : raw
    try {
      const b = Buffer.from(chunk.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      return JSON.parse(b.toString('utf8'))
    } catch {}
  }
  return undefined
}

function readDisposal(res: HttpResponse): string | null {
  const raw = res.headers.get('x-rp-content')
  if (!raw) return null
  const info = decodeDisposal(raw)
  if (info === undefined) return `x-rp-content 解不开：${raw.slice(0, 60)}`
  let ev: any = {}
  try {
    ev = JSON.parse(info?.disposal?.evContent || '{}')
  } catch {}
  return `code=${info?.code} ${ev.title ?? ''} ${ev.evTypeTip ?? ''}（接口 ${ev.evApi ?? ''}）`
}

/** 搜索页 Referer：searchWare 记下的关键词优先（_search_page_referer）。 */
export function searchReferer(jd: Jd, keyword = ''): string {
  const kw = keyword || jd.searchKeyword
  if (kw) return `https://search.jd.com/Search?keyword=${quote(kw)}&enc=utf-8`
  return SEARCH_REFERER
}

/**
 * 业务响应里的风控处置 / 登录墙映射成 catbus 的错误。
 * 403 空 body 要先探测登录态才能分清是登录失效还是限流（见 commands.ts 的 check），这里只处理能直接判定的情况。
 */
export function checkRisk(jd: Jd, res: any): void {
  if (res?.disposal || String(res?.code) === '605') {
    throw new CatbusError('RISK_CONTROL', '京东要求人机验证（605），纯程序验证未通过', { detail: { kind: 'captcha', code: res?.code ?? null } })
  }
  if (res?._status === 401 || res?.code === 3 || res?.code === '3') throw authError(jd.ctx)
}

