import { CatbusError } from '../../../core/errors.js'
import { buildUrl, type HttpClient } from '../../../core/http.js'
import { jsonLoads } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient } from '../../../core/toolkit.js'
import { mtgsig, UA } from './sign.js'

export const YANCHU = 'https://yanchu.maoyan.com'
export const DIANPING = 'https://m.dianping.com'
const USER_CENTER = 'https://usercenter-inf.maoyan.com'

/** 列表接口只认浏览器 UA；不能带 sellChannel，带了就要验签。 */
const LIST_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

export class MaoyanClient {
  readonly http: HttpClient

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx)
  }

  /** yanchu.maoyan.com：免登录、免签名。 */
  async list<T = any>(path: string, query: [string, string][]): Promise<T> {
    return this.send(buildUrl(YANCHU + path, query), [
      ['User-Agent', LIST_UA],
      ['Accept-Encoding', 'gzip'],
    ])
  }

  /** m.dianping.com：不带 Cookie（登录态是 query 里的 token），但要带 H5guard 的 mtgsig，签名绑定完整的 URL 和 body。 */
  async signed<T = any>(path: string, query: [string, string][], uuid: string, body?: string): Promise<T> {
    const url = buildUrl(DIANPING + path, query)
    const sig = await mtgsig(url, body == null ? 'GET' : 'POST', body ?? '')
    const headers: [string, string][] = [
      ['User-Agent', UA],
      ['Accept', 'application/json, text/plain, */*'],
      ['Content-Type', 'application/json'],
      ['Referer', 'https://h5.dianping.com/'],
      ['Origin', 'https://h5.dianping.com'],
      ['uuid', uuid],
      ['mtgsig', sig],
    ]
    return this.send(url, headers, body)
  }

  /** 当前账号：H5 用同一个 token 查 usercenter-inf，令牌无效时报登录态失效。 */
  async userInfo(token: string): Promise<any> {
    const url = buildUrl(`${USER_CENTER}/api/account/v1/getUserInfoByToken`, [['token', token]])
    const res = await this.http.request({ url, headers: [['User-Agent', UA]], cookies: false })
    let body: any
    try {
      body = jsonLoads(await res.text())
    } catch {
      throw new CatbusError('UPSTREAM', `账号接口返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status } })
    }
    const user = body?.data ?? body
    if (body?.success === false || user?.userId == null) throw authError(this.ctx, body?.error?.message)
    return user
  }

  private async send<T>(url: string, headers: [string, string][], data?: string): Promise<T> {
    const res = await this.http.request({ url, headers, cookies: false, ...(data == null ? {} : { method: 'POST', body: data }) })
    if (res.status === 403 || res.status === 429) {
      throw new CatbusError('RISK_CONTROL', `猫眼拒绝了请求（HTTP ${res.status}）`, {
        hint: '降低查询频率，几分钟后再试',
        detail: { kind: res.status === 403 ? 'blocked' : 'rate_limit', status: res.status },
      })
    }
    if (!res.ok) throw new CatbusError('UPSTREAM', `猫眼返回 HTTP ${res.status}`, { detail: { status: res.status } })
    let body: any
    try {
      body = jsonLoads(await res.text())
    } catch {
      throw new CatbusError('UPSTREAM', '猫眼返回的不是 JSON', { detail: { url: new URL(url).pathname } })
    }
    if (!body?.success) {
      const err = body?.error ?? {}
      if (err.code === 403) throw authError(this.ctx, err.message)
      throw new CatbusError('UPSTREAM', err.message || '猫眼返回业务错误', { detail: { code: err.code ?? null, response: body } })
    }
    return body.data as T
  }
}
