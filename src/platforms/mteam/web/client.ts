import { createHmac, randomBytes } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import { HttpClient, type HttpResponse } from '../../../core/http.js'
import { redact } from '../../../core/log.js'
import { jsonLoads, toPairs, type PairsInit } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Credential } from '../../../core/schemas.js'
import { authError, httpClient, scope } from '../../../core/toolkit.js'
import { isMteamDownloadHost, isMteamHost } from './resolve.js'

export const API = 'https://api.m-team.cc/api'
export const SITE = 'https://kp.m-team.cc'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * 网页前端的请求签名（站点前端 main.js 的 axios 拦截器）：
 * `_sgin = base64(HMAC-SHA1("POST&/api<path>&<毫秒时间戳>", 密钥))`，与 `_timestamp` 一起放进请求体；
 * 请求头另带 ts（秒）、visitorId、version、webVersion。密钥与版本号写死在前端代码里，前端改版时随之更新。
 */
const WEB_SECRET = 'HLkPcWmycL57mfJt'
const WEB_VERSION = '2.0.0'
const WEB_VERSION_CODE = '2000'

/** 登录接口的业务结果，由 auth login 判定（0 成功 / 1001 需要两步验证 / 1002 需要验证邮箱）。 */
export interface LoginResult { code: number; message: string; data: unknown }

interface Envelope<T> { code?: string | number; message?: string; data?: T }

export function webSign(path: string, timestamp: number): string {
  return createHmac('sha1', WEB_SECRET).update(`POST&/api${path}&${timestamp}`).digest('base64')
}

/** 网页会话的设备标识：visitorId 由客户端生成后一直沿用，did 由服务端在登录时下发。 */
export function ensureVisitorId(credential: Credential): string {
  const tokens = scope(credential).tokens
  if (typeof tokens.visitor_id !== 'string' || !/^[0-9a-f]{32}$/.test(tokens.visitor_id)) tokens.visitor_id = randomBytes(16).toString('hex')
  return tokens.visitor_id as string
}

/**
 * 两种身份：
 * - `apikey`：官方 API Key，放在 x-api-key 头里；
 * - `password`：网页登录拿到的 JWT（authorization 头），请求带网页签名。站内信等接口只认这种身份。
 * 凭证只发送到固定 API 地址；不跟随 API 重定向，不自动重试业务操作。
 */
export class Client {
  private readonly http: HttpClient
  private readonly key: string | null
  /** 当前会话类型。 */
  readonly mode: 'apikey' | 'web'

  constructor(private readonly ctx: HandlerContext, options: { anonymous?: boolean } = {}) {
    const tokens = scope(ctx.credential).tokens
    const key = tokens.api_key
    if (typeof tokens.auth === 'string' && tokens.auth) {
      this.mode = 'web'
      this.key = null
    } else if (typeof key === 'string' && key) {
      this.mode = 'apikey'
      this.key = key
    } else if (options.anonymous) {
      this.mode = 'web'
      this.key = null
    } else {
      throw authError(ctx, '缺少 M-Team 登录凭证，请重新登录')
    }
    this.http = httpClient(ctx, { browser: 'chrome', os: 'windows' })
  }

  get webSession(): boolean {
    return this.mode === 'web'
  }

  /** 调用接口，返回 data。写操作成功时 data 可能为 null，用 `nullable` 放行。 */
  async call<T>(path: string, payload: { form?: PairsInit; json?: Record<string, unknown> } = {}, options: { nullable?: boolean } = {}): Promise<T> {
    const value = await this.request<T>(path, payload)
    if (String(value.code) !== '0') throw this.businessError(value)
    if (value.data == null && !options.nullable) throw new CatbusError('UPSTREAM', 'M-Team 成功响应缺少 data')
    return value.data as T
  }

  /** 网页登录：返回业务结果，不按 code 抛错（1001 / 1002 是登录流程的正常分支）。 */
  async login(form: Record<string, string>): Promise<LoginResult> {
    const value = await this.request<unknown>('/login', { form })
    if (value.code == null) throw new CatbusError('UPSTREAM', 'M-Team 登录接口缺少业务状态码')
    return { code: Number(value.code), message: String(redact(String(value.message ?? ''))).slice(0, 300), data: value.data ?? null }
  }

  /** 发送登录用的邮箱验证码。必须紧跟在一次返回 1001 的登录之后，否则站点报「登入驗證已失效」。 */
  async sendLoginEmailCode(username: string, email: string): Promise<void> {
    await this.call<unknown>('/member/sendLoginEmailVerifyCode', { form: { username, email } }, { nullable: true })
  }

  private async request<T>(path: string, payload: { form?: PairsInit; json?: Record<string, unknown> }): Promise<Envelope<T>> {
    const tokens = scope(this.ctx.credential).tokens
    const headers: Record<string, string> = { 'user-agent': UA, accept: 'application/json, text/plain, */*', origin: SITE, referer: SITE + '/' }
    let form = payload.form
    let json = payload.json
    if (this.mode === 'apikey') {
      headers['x-api-key'] = this.key!
    } else {
      const now = Date.now()
      const sign = { _timestamp: String(now), _sgin: webSign(path, now) }
      if (json !== undefined) json = { ...json, ...sign }
      else form = [...toPairs(form ?? {}), ...Object.entries(sign)]
      Object.assign(headers, { ts: String(Math.floor(now / 1000)), visitorid: ensureVisitorId(this.ctx.credential), version: WEB_VERSION, webversion: WEB_VERSION_CODE })
      if (typeof tokens.auth === 'string' && tokens.auth) headers.authorization = tokens.auth
      if (typeof tokens.did === 'string' && tokens.did) headers.did = tokens.did
    }
    const res = await this.http.request({
      method: 'POST', url: API + path, redirect: 'manual', cookies: false, headers,
      ...(json !== undefined ? { json } : { form: form ?? {} }),
    })
    if (this.mode === 'web') {
      // 服务端在登录和续期时通过响应头下发新的 authorization / did，凭证由 core 落盘
      const auth = res.headers.get('authorization')
      const did = res.headers.get('did')
      if (auth) tokens.auth = auth
      if (did) tokens.did = did
    }
    if (res.status === 401) throw authError(this.ctx, this.expiredMessage)
    if (res.status === 429) throw this.risk('rate_limit', 'M-Team 请求过于频繁，请稍后再试')
    if (res.status === 403) throw this.risk('blocked', 'M-Team 拒绝了请求，请在网站检查账号或访问限制')
    if (!res.ok) throw new CatbusError('UPSTREAM', `M-Team 接口失败：HTTP ${res.status}`, { detail: { status: res.status } })
    let value: Envelope<T>
    try { value = jsonLoads<Envelope<T>>(await res.text()) } catch {
      throw new CatbusError('UPSTREAM', 'M-Team 返回了非 JSON 响应')
    }
    if (!value || typeof value !== 'object' || value.code == null) throw new CatbusError('UPSTREAM', 'M-Team 响应缺少业务状态码')
    return value
  }

  private get expiredMessage(): string {
    return this.mode === 'apikey' ? 'M-Team API Key 无效或已失效' : 'M-Team 登录态已失效'
  }

  private businessError(value: Envelope<unknown>): CatbusError {
    let message = String(value.message ?? '未知错误')
    if (this.key) message = message.replaceAll(this.key, '***')
    message = String(redact(message)).slice(0, 300)
    if (['401', '403'].includes(String(value.code)) || /unauthori[sz]ed|authentication|not.?login|(?:invalid|expired).{0,16}\b(?:api[ _-]?key|key|token)\b|\b(?:api[ _-]?key|key|token)\b.{0,16}(?:invalid|expired|无效|無效|失效|过期|過期|停用|错误|錯誤)|(?:令牌|凭证|憑證).{0,12}(?:无效|無效|失效|过期|過期)|未登[录錄入]|[请請].*登[录錄入]/i.test(message)) {
      return authError(this.ctx, this.expiredMessage)
    }
    if (/rate.?limit|too many|频繁|頻繁|限流/i.test(message)) return this.risk('rate_limit', message)
    if (/captcha|验证码|驗證碼|人机|人機/i.test(message)) return this.risk('captcha', message)
    return new CatbusError('UPSTREAM', `M-Team：${message}`, { detail: { code: value.code } })
  }

  /** 下载地址含临时令牌，不记录 URL，不转发登录凭证；每一跳都限制为 MT 的 HTTPS 域名。 */
  async download(url: string): Promise<HttpResponse> {
    const http = new HttpClient({ browser: 'chrome', os: 'windows', proxy: this.ctx.config.proxy, timeout: this.ctx.config.timeout })
    for (let hop = 0; hop < 5; hop++) {
      let target: URL
      try { target = new URL(url) } catch { throw new CatbusError('UPSTREAM', 'M-Team 返回了无效的种子下载地址') }
      // 第一跳必须是 MT 自己的域名；之后 api.m-team.cc 会 302 到下载节点 *.halomt.com
      const allowed = isMteamHost(target.hostname) || (hop > 0 && isMteamDownloadHost(target.hostname))
      if (target.protocol !== 'https:' || !allowed || target.username || target.password || target.port) {
        throw new CatbusError('UPSTREAM', 'M-Team 返回的种子下载地址不属于受支持的官方 HTTPS 域名')
      }
      let res: HttpResponse
      try {
        res = await http.request({ url: target.href, redirect: 'manual', cookies: false, headers: { 'user-agent': UA, accept: 'application/x-bittorrent, application/octet-stream' } })
      } catch (error) {
        // 底层网络错误的 message 可能含完整 URL，不能把下载令牌带进错误信封。
        const kind = error instanceof CatbusError && error.code === 'NETWORK'
          ? (error.detail as { kind?: string } | null)?.kind : undefined
        throw new CatbusError('NETWORK', 'M-Team 种子文件下载网络请求失败', { detail: { kind: kind ?? 'connect' }, cause: error })
      }
      if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
        try { url = new URL(res.headers.get('location')!, target).href } catch {
          throw new CatbusError('UPSTREAM', 'M-Team 返回了无效的种子下载跳转地址')
        }
        continue
      }
      if (res.status === 429) throw this.risk('rate_limit', 'M-Team 种子下载请求过于频繁')
      if (res.status === 403) throw this.risk('blocked', 'M-Team 拒绝了种子下载请求')
      if (res.status === 401) throw authError(this.ctx, 'M-Team 下载授权已失效')
      if (!res.ok) throw new CatbusError('UPSTREAM', `M-Team 种子文件下载失败：HTTP ${res.status}`, { detail: { status: res.status } })
      return res
    }
    throw new CatbusError('UPSTREAM', 'M-Team 种子下载重定向过多')
  }

  private risk(kind: string, message: string): CatbusError {
    return new CatbusError('RISK_CONTROL', message, { detail: { kind } })
  }
}
