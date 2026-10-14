import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HeaderPairs, type HttpClient, parseJson } from '../../../core/http.js'
import type { HandlerContext } from '../../../core/registry.js'
import { httpClient } from '../../../core/toolkit.js'
import { BROWSER } from './profile.js'

export class Zhihu {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
  }

  get isLoggedIn(): boolean {
    return Boolean(this.jar.get('d_c0') && this.jar.get('z_c0'))
  }

  async json<T>(url: string, headers: HeaderPairs): Promise<T | null> {
    const response = await this.http.request({ url, headers, redirect: 'manual' })
    if (response.status === 401) return null
    if (response.status === 403 || response.status === 429) {
      throw new CatbusError('RISK_CONTROL', `知乎拒绝了请求（HTTP ${response.status}），请稍后再试`, {
        detail: { kind: response.status === 429 ? 'rate_limit' : 'blocked', status: response.status },
      })
    }
    const body = await parseJson<T>(response)
    if (!response.ok) throw new CatbusError('UPSTREAM', `知乎返回 HTTP ${response.status}`, { detail: { status: response.status } })
    return body
  }
}
