import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HttpClient, type HttpRequest, type HttpResponse, type MultipartPart, parseJson } from '../../../core/http.js'
import { jsonLoads, type Pairs } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient } from '../../../core/toolkit.js'
import { GraphQLOperation } from './graphql.js'
import { type AuthView, BROWSER, buildHeaders, COOKIE_DOMAIN, type HeaderOptions, PROFILE, PUBLIC_BEARER, X_HOST } from './profile.js'
import { userIdFromTwid } from './resolve.js'
import { transaction } from './transaction.js'

/**
 * X web 端会话，移植自上游 builder/auth.py（XAuth）+ x_apis 里的 graphql_get / graphql_post_query /
 * graphql_post / _rest_post。
 *
 * XAuth 持有的动态状态（cookie 含 ct0）在 catbus 里都存进凭证，由 core 落盘。web 端不支持游客态
 * （AGENTS 5.2），上游的 guest token 不移植。
 * XCTID 素材用打包进仓库的 static/x/transaction_l1.json（上游 from_cached）：上游优先
 * from_network 抓 /i/flow/login 的 app shell，但它现在 307 到 jetfuel 登录页、拿不到素材，
 * 上游实际也是回退到这份缓存。
 */

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
   * 建立会话（上游 XAuth.prepare_auth）：已登录会话的 ct0 由服务端签发，缺了只能报错；补上 lang cookie。
   * 上游未登录时本地生成 ct0 给游客用，web 端没有游客态，不移植。
   */
  async init(): Promise<void> {
    if (this.isLoggedIn && !this.ct0) throw authError(this.ctx, 'cookie 里有 auth_token 但缺 ct0，请把浏览器 cookie 完整复制过来')
    if (!this.jar.has('lang')) this.jar.set('lang', PROFILE.clientLanguage, COOKIE_DOMAIN)
  }

  private view(): AuthView {
    return { bearer: PUBLIC_BEARER, ct0: this.ct0, lang: this.lang, loggedIn: this.isLoggedIn }
  }

  private xctid(method: string, path: string): string {
    return transaction().generate(method.toUpperCase(), path)
  }

  // ---------------------------------------------------------------- GraphQL

  /** query 型 GraphQL 读接口（GET）。读接口存在「部分成功」，有 data 时不抛。上游 graphql_get。 */
  async graphqlGet(operationName: string, variables: Map<string, unknown>, options: { referer?: string } = {}): Promise<any> {
    const op = new GraphQLOperation(operationName)
    const res = await this.http.request({
      method: 'GET',
      url: op.url(),
      query: op.queryParams(variables),
      headers: this.graphqlHeaders(op.url(), 'GET', op.path(), options.referer),
    })
    return this.checkGraphQL(res, operationName, false)
  }

  /** POST 发送的 query 型操作（HomeTimeline 带 seenTweetIds、SearchTimeline）。上游 graphql_post_query。 */
  async graphqlPostQuery(operationName: string, variables: Map<string, unknown>, options: { referer?: string } = {}): Promise<any> {
    const op = new GraphQLOperation(operationName)
    const res = await this.http.request({
      method: 'POST',
      url: op.url(),
      json: op.jsonBody(variables),
      headers: this.graphqlHeaders(op.url(), 'POST', op.path(), options.referer),
    })
    return this.checkGraphQL(res, operationName, false)
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

  private graphqlHeaders(url: string, method: string, path: string, referer = `${X_HOST}/home`): [string, string][] {
    return buildHeaders('GRAPHQL', url, this.view(), { xctid: this.xctid(method, path), referer })
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
    return this.checkJson(res, `/1.1${api}`)
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

  /** HTTP 状态不是 2xx 时报错（上游 raise_for_status），否则解析 JSON。operation 用在错误信息里。 */
  async checkJson<T = any>(res: HttpResponse, operation = 'request'): Promise<T> {
    if (!res.ok) throw this.httpError(res.status, await res.text(), operation)
    return parseJson<T>(res)
  }

  /** 只校验 HTTP 状态（响应体为空的接口）。 */
  async checkOk(res: HttpResponse, operation = 'request'): Promise<void> {
    if (!res.ok) throw this.httpError(res.status, await res.text(), operation)
  }

  /**
   * X 的 GraphQL 失败不一定用 HTTP 状态码表达：会话过期、限流都可能是 200 + errors。
   * 读接口存在「部分成功」，有 data 时不抛；mutation 有 errors 就抛（上游 graphql_get / graphql_post）。
   */
  private async checkGraphQL(res: HttpResponse, operation: string, mutation: boolean): Promise<any> {
    const body = await this.checkJson<any>(res, operation)
    const errors = body?.errors
    if (errors?.length && (mutation || !body.data)) throw this.mapErrors(new GraphQLError(operation, errors, body))
    return body
  }

  /**
   * 非 2xx。X 的错误响应体多半也是 `{errors: [{code, message}]}`：REST 的业务拒绝（158 不能关注自己、
   * 160 已发出关注请求、161 关注数到上限、162 被对方屏蔽）和 353（ct0 不匹配）都是 403，
   * 所以先按错误码映射；没有错误码时，401 / 403 才当作登录态失效。
   */
  private httpError(status: number, text: string, operation: string): CatbusError {
    let errors: unknown
    try {
      errors = jsonLoads(text)?.errors
    } catch {}
    if (Array.isArray(errors) && errors[0]?.code != null) return this.mapErrors(new GraphQLError(operation, errors, text.slice(0, 300)), status)
    if (status === 401 || status === 403) return authError(this.ctx)
    if (status === 429) return new CatbusError('RISK_CONTROL', `X 限流（HTTP ${status}）`, { detail: { kind: 'rate_limit', status } })
    return new CatbusError('UPSTREAM', `X 返回 HTTP ${status}`, { detail: { status, body: text.slice(0, 300) } })
  }

  /** errors 里的错误码映射成 catbus 错误（AGENTS 6.4）；status 是 HTTP 状态（200 + errors 时不给）。 */
  private mapErrors(err: GraphQLError, status?: number): CatbusError {
    const code = err.code
    if (code != null && AUTH_CODES.has(code)) return authError(this.ctx, err.message)
    if (code != null && RISK_CODES.has(code)) {
      return new CatbusError('RISK_CONTROL', err.message, { detail: { kind: code === 88 ? 'rate_limit' : 'blocked', code, ...(status ? { status } : {}) } })
    }
    return new CatbusError('UPSTREAM', err.message, { detail: { code: code ?? null, operation: err.operation, errors: err.errors, ...(status ? { status } : {}) } })
  }

  /** 确认 cookie 里有 auth_token / ct0（registry 已挡住未登录，这里防 cookie 不全）。 */
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
