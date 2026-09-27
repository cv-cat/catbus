import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HttpClient, type HttpRequest, type HttpResponse, type MultipartPart, parseJson } from '../../../core/http.js'
import type { Pairs } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, scope } from '../../../core/toolkit.js'
import { GraphQLOperation } from './graphql.js'
import { type AuthView, API_X, BROWSER, buildHeaders, COOKIE_DOMAIN, guestActivateHeaders, type HeaderOptions, PROFILE, PUBLIC_BEARER, X_HOST } from './profile.js'
import { userIdFromTwid } from './resolve.js'
import { transaction } from './transaction.js'

/**
 * X web 端会话，移植自上游 builder/auth.py（XAuth）+ x_apis 里的 graphql_get / graphql_post_query /
 * graphql_post / _rest_post。
 *
 * XAuth 持有的动态状态（cookie 含 ct0、guest token）在 catbus 里都存进凭证，由 core 落盘。
 * XCTID 素材用打包进仓库的 static/x/transaction_l1.json（上游 from_cached）：上游优先
 * from_network 抓 /i/flow/login 的 app shell，但它现在 307 到 jetfuel 登录页、拿不到素材，
 * 上游实际也是回退到这份缓存。
 */

const GUEST_ACTIVATE_URL = `${API_X}/1.1/guest/activate.json`
/** guest token 的本地有效期（上游 _GUEST_TTL）。 */
const GUEST_TTL = 3 * 3600_000
/** 会话过期 / 未授权（上游 main.py 的 _AUTH_FAILURE_CODES，加上 353 = ct0 不匹配）。 */
const AUTH_CODES = new Set([32, 89, 215, 326, 353])
/** GraphQL 错误码是否表示未登录 / 会话失效。 */
export const isAuthCode = (code: unknown): boolean => AUTH_CODES.has(Number(code))
/** 限流 / 风控（88 = rate limit，226 / 344 = 自动化 / 日上限）。 */
const RISK_CODES = new Set([88, 226, 344])


export class GraphQLError extends Error {
  constructor(
    readonly operation: string,
    readonly errors: any[],
    readonly res: any,
  ) {
    super(`${operation}: ${errors.map((e) => e?.message ?? e).join('; ')}`)
  }

  get code(): number | undefined {
    return this.errors[0]?.code
  }
}

export class XClient {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
  }

  get isLoggedIn(): boolean {
    return Boolean(this.jar.get('auth_token'))
  }

  get ct0(): string {
    return this.jar.get('ct0') ?? ''
  }

  /** `x-twitter-client-language` 与 `lang` cookie 一致（上游 with_client_language）。 */
  get lang(): string {
    return (this.jar.get('lang') || PROFILE.clientLanguage).toLowerCase()
  }

  /** twid cookie 里的数字用户 id（上游 XAuth.user_id）。 */
  get userId(): string {
    return userIdFromTwid(this.jar.get('twid'))
  }

  /**
   * 建立会话（上游 XAuth.prepare_auth）：已登录会话的 ct0 由服务端签发，缺了只能报错；
   * 未登录时本地生成 ct0，并补上 lang cookie。
   */
  async init(): Promise<void> {
    if (!this.ct0) {
      if (this.isLoggedIn) throw authError(this.ctx, 'cookie 里有 auth_token 但缺 ct0，请把浏览器 cookie 完整复制过来')
      this.jar.set('ct0', rand.hex(16), COOKIE_DOMAIN)
    }
    if (!this.jar.has('lang')) this.jar.set('lang', PROFILE.clientLanguage, COOKIE_DOMAIN)
  }

  private view(guestToken?: string): AuthView {
    return { bearer: PUBLIC_BEARER, ct0: this.ct0, lang: this.lang, loggedIn: this.isLoggedIn, guestToken }
  }

  /**
   * guest token：缓存进游客凭证，过期（3 小时）或被服务端拒绝时重新换取，同时写入 `gt` cookie。
   * 上游 XAuth.guest_token / refresh_guest_token。
   */
  async guestToken(): Promise<string> {
    return (await this.guest()).token
  }

  private async guest(force = false): Promise<{ token: string; fresh: boolean }> {
    const store = scope(this.ctx.credential).tokens as { guest_token?: string; guest_at?: number }
    if (!force && store.guest_token && rand.now() - Number(store.guest_at ?? 0) < GUEST_TTL) return { token: store.guest_token, fresh: false }
    const res = await this.http.request({ method: 'POST', url: GUEST_ACTIVATE_URL, headers: guestActivateHeaders(GUEST_ACTIVATE_URL, PUBLIC_BEARER), cookies: false })
    const body = await this.checkJson<{ guest_token?: string }>(res)
    if (!body.guest_token) throw new CatbusError('UPSTREAM', 'guest/activate 没有返回 guest_token')
    store.guest_token = body.guest_token
    store.guest_at = rand.now()
    this.jar.set('gt', body.guest_token, COOKIE_DOMAIN)
    return { token: body.guest_token, fresh: true }
  }

  private xctid(method: string, path: string): string {
    return transaction().generate(method.toUpperCase(), path)
  }

  // ---------------------------------------------------------------- GraphQL

  /** query 型 GraphQL 读接口（GET）。上游 graphql_get。 */
  graphqlGet(operationName: string, variables: Map<string, unknown>, options: { referer?: string } = {}): Promise<any> {
    const op = new GraphQLOperation(operationName)
    return this.read(operationName, (guestToken) => ({
      method: 'GET',
      url: op.url(),
      query: op.queryParams(variables),
      headers: this.graphqlHeaders(op.url(), 'GET', op.path(), options.referer, guestToken),
    }))
  }

  /** POST 发送的 query 型操作（HomeTimeline 带 seenTweetIds、SearchTimeline）。上游 graphql_post_query。 */
  graphqlPostQuery(operationName: string, variables: Map<string, unknown>, options: { referer?: string } = {}): Promise<any> {
    const op = new GraphQLOperation(operationName)
    return this.read(operationName, (guestToken) => ({
      method: 'POST',
      url: op.url(),
      json: op.jsonBody(variables),
      headers: this.graphqlHeaders(op.url(), 'POST', op.path(), options.referer, guestToken),
    }))
  }

  /** mutation 型写接口。上游 graphql_post：有 errors 就算失败。 */
  async graphqlPost(operationName: string, variables: Map<string, unknown>, options: { referer?: string } = {}): Promise<any> {
    const op = new GraphQLOperation(operationName)
    const res = await this.http.request({
      method: 'POST',
      url: op.url(),
      json: op.jsonBody(variables),
      headers: this.graphqlHeaders(op.url(), 'POST', op.path(), options.referer),
    })
    return this.checkGraphQL(res, operationName, true)
  }

  private graphqlHeaders(url: string, method: string, path: string, referer = `${X_HOST}/home`, guestToken?: string): [string, string][] {
    return buildHeaders('GRAPHQL', url, this.view(guestToken), { xctid: this.xctid(method, path), referer, guest: guestToken != null })
  }

  /**
   * 读接口的发送：未登录时带 x-guest-token（浏览器未登录时就是这样；上游读接口不带，
   * 实测 TweetResultByRestId / UserTweets 等游客可用的接口都接受）。
   * 缓存的 guest token 被拒（401 / 403）时换一个新的重试一次。
   */
  private async read(operation: string, build: (guestToken?: string) => HttpRequest): Promise<any> {
    if (this.isLoggedIn) return this.checkGraphQL(await this.http.request(build()), operation, false)
    const g = await this.guest()
    let res = await this.http.request(build(g.token))
    if (!g.fresh && (res.status === 401 || res.status === 403)) res = await this.http.request(build((await this.guest(true)).token))
    return this.checkGraphQL(res, operation, false)
  }

  /** 老 REST 表单接口（friendships 等）。上游 _rest_post。 */
  async restPost(api: string, data: Pairs): Promise<any> {
    const url = `${X_HOST}/i/api/1.1${api}`
    const res = await this.http.request({
      method: 'POST',
      url,
      form: data,
      headers: buildHeaders('FORM', url, this.view(), { xctid: this.xctid('POST', `/i/api/1.1${api}`), referer: `${X_HOST}/home` }),
    })
    return this.checkJson(res)
  }

  /** 自定义请求（媒体上传、X Chat）。 */
  request(req: HttpRequest): Promise<HttpResponse> {
    return this.http.request(req)
  }

  buildHeaders(type: Parameters<typeof buildHeaders>[0], url: string, options: HeaderOptions = {}): [string, string][] {
    return buildHeaders(type, url, this.view(), options)
  }

  /** 给不走 graphql* 的请求算 XCTID（媒体元数据、X Chat）。 */
  transactionId(method: string, path: string): string {
    return this.xctid(method, path)
  }

  /** HTTP 状态不是 2xx 时报错（上游 raise_for_status），否则解析 JSON。 */
  async checkJson<T = any>(res: HttpResponse): Promise<T> {
    if (!res.ok) throw this.httpError(res.status, await res.text())
    return parseJson<T>(res)
  }

  /** 只校验 HTTP 状态（响应体为空的接口）。 */
  async checkOk(res: HttpResponse): Promise<void> {
    if (!res.ok) throw this.httpError(res.status, await res.text())
  }

  /**
   * X 的 GraphQL 失败不一定用 HTTP 状态码表达：会话过期、限流都可能是 200 + errors。
   * 读接口存在「部分成功」，有 data 时不抛；mutation 有 errors 就抛（上游 graphql_get / graphql_post）。
   */
  private async checkGraphQL(res: HttpResponse, operation: string, mutation: boolean): Promise<any> {
    const body = await this.checkJson<any>(res)
    const errors = body?.errors
    if (errors?.length && (mutation || !body.data)) throw this.mapGraphQL(new GraphQLError(operation, errors, body))
    return body
  }

  private httpError(status: number, text: string): CatbusError {
    if (status === 401 || status === 403) return authError(this.ctx)
    if (status === 429) return new CatbusError('RISK_CONTROL', `X 限流（HTTP ${status}）`, { detail: { kind: 'rate_limit', status } })
    return new CatbusError('UPSTREAM', `X 返回 HTTP ${status}`, { detail: { status, body: text.slice(0, 300) } })
  }

  /** GraphQL 200 里的 errors 映射成 catbus 错误（AGENTS 6.4）。 */
  private mapGraphQL(err: GraphQLError): CatbusError {
    const code = err.code
    if (code != null && AUTH_CODES.has(code)) return authError(this.ctx, err.message)
    if (code != null && RISK_CODES.has(code)) {
      return new CatbusError('RISK_CONTROL', err.message, { detail: { kind: code === 88 ? 'rate_limit' : 'blocked', code } })
    }
    return new CatbusError('UPSTREAM', err.message, { detail: { code: code ?? null, operation: err.operation, errors: err.errors } })
  }

  /** 写操作前确认是登录态（registry 已挡住游客，这里防 cookie 不全）。 */
  requireLogin(): void {
    if (!this.isLoggedIn || !this.ct0) throw authError(this.ctx, '当前账号缺少 auth_token / ct0，请重新登录')
  }
}

/** 建立 X 会话。 */
export async function xclient(ctx: HandlerContext): Promise<XClient> {
  const x = new XClient(ctx)
  await x.init()
  return x
}

export function multipartMedia(chunk: Uint8Array): MultipartPart {
  return { name: 'media', data: chunk, contentType: 'application/octet-stream', filename: 'blob' }
}
