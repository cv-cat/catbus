import { CatbusError } from '../../../core/errors.js'
import { HttpClient, type HttpResponse } from '../../../core/http.js'
import { redact } from '../../../core/log.js'
import { jsonLoads, type PairsInit } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, scope } from '../../../core/toolkit.js'
import { isMteamHost } from './resolve.js'

export const API = 'https://api.m-team.cc/api'
export const SITE = 'https://kp.m-team.cc'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

interface Envelope<T> { code?: string | number; message?: string; data?: T }

/** 官方 API Key 只发送到固定 API 地址；不跟随 API 重定向，不自动重试业务操作。 */
export class Client {
  private readonly http: HttpClient
  private readonly key: string

  constructor(private readonly ctx: HandlerContext) {
    const key = scope(ctx.credential).tokens.api_key
    if (typeof key !== 'string' || !key) throw authError(ctx, '缺少 M-Team API Key，请重新登录')
    this.key = key
    this.http = httpClient(ctx, { browser: 'chrome', os: 'windows' })
  }

  async call<T>(path: string, payload: { form?: PairsInit; json?: unknown } = {}): Promise<T> {
    const res = await this.http.request({
      method: 'POST', url: API + path, redirect: 'manual', cookies: false,
      headers: { 'user-agent': UA, accept: 'application/json', origin: SITE, referer: SITE + '/', 'x-api-key': this.key },
      ...(payload.json !== undefined ? { json: payload.json } : { form: payload.form ?? {} }),
    })
    if (res.status === 401) throw authError(this.ctx, 'M-Team API Key 无效或已失效')
    if (res.status === 429) throw this.risk('rate_limit', 'M-Team 请求过于频繁，请稍后再试')
    if (res.status === 403) throw this.risk('blocked', 'M-Team 拒绝了请求，请在网站检查账号或访问限制')
    if (!res.ok) throw new CatbusError('UPSTREAM', `M-Team 接口失败：HTTP ${res.status}`, { detail: { status: res.status } })
    let value: Envelope<T>
    try { value = jsonLoads<Envelope<T>>(await res.text()) } catch {
      throw new CatbusError('UPSTREAM', 'M-Team 返回了非 JSON 响应')
    }
    if (!value || typeof value !== 'object' || value.code == null) throw new CatbusError('UPSTREAM', 'M-Team 响应缺少业务状态码')
    if (String(value.code) !== '0') {
      const message = String(redact(String(value.message ?? '未知错误').replaceAll(this.key, '***'))).slice(0, 300)
      if (['401', '403'].includes(String(value.code)) || /unauthori[sz]ed|authentication|not.?login|(?:invalid|expired).{0,16}\b(?:api[ _-]?key|key|token)\b|\b(?:api[ _-]?key|key|token)\b.{0,16}(?:invalid|expired|无效|無效|失效|过期|過期|停用|错误|錯誤)|(?:令牌|凭证|憑證).{0,12}(?:无效|無效|失效|过期|過期)|未登[录錄入]|[请請].*登[录錄入]/i.test(message)) {
        throw authError(this.ctx, 'M-Team API Key 无效或已失效')
      }
      if (/rate.?limit|too many|频繁|頻繁|限流/i.test(message)) throw this.risk('rate_limit', message)
      if (/captcha|验证码|驗證碼|人机|人機/i.test(message)) throw this.risk('captcha', message)
      throw new CatbusError('UPSTREAM', `M-Team：${message}`, { detail: { code: value.code } })
    }
    if (value.data == null) throw new CatbusError('UPSTREAM', 'M-Team 成功响应缺少 data')
    return value.data
  }

  /** 下载地址含临时令牌，不记录 URL，不转发 API Key；每一跳都限制为 MT 的 HTTPS 域名。 */
  async download(url: string): Promise<HttpResponse> {
    const http = new HttpClient({ browser: 'chrome', os: 'windows', proxy: this.ctx.config.proxy, timeout: this.ctx.config.timeout })
    for (let hop = 0; hop < 5; hop++) {
      let target: URL
      try { target = new URL(url) } catch { throw new CatbusError('UPSTREAM', 'M-Team 返回了无效的种子下载地址') }
      if (target.protocol !== 'https:' || !isMteamHost(target.hostname) || target.username || target.password || target.port) {
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
