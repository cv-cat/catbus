import { CookieJar } from './cookies.js'
import { CatbusError } from './errors.js'
import { type ClientOptions, HttpClient } from './http.js'
import type { HandlerContext, Page } from './registry.js'
import type { Credential } from './schemas.js'
import { endpointFlag, GUEST } from './auth-store.js'

/** 平台实现常用的小工具。 */

type Scope = Credential['scopes'][string]

/** 凭证里的一个子站点分区，不存在时创建。 */
export function scope(credential: Credential, name = 'main'): Scope {
  return (credential.scopes[name] ??= { cookies: [], tokens: {} })
}

/** 绑定到凭证某个 scope 的 cookie 罐：请求中更新的 cookie 会随凭证由 core 落盘。 */
export function jarOf(credential: Credential, name = 'main'): CookieJar {
  return new CookieJar(scope(credential, name).cookies)
}

/** 按本次调用的代理和超时创建 HTTP 客户端。 */
export function httpClient(ctx: HandlerContext, options: Omit<ClientOptions, 'proxy' | 'timeout' | 'log'> & { scope?: string } = {}): HttpClient {
  const { scope: name, ...rest } = options
  return new HttpClient({ jar: jarOf(ctx.credential, name), ...rest, proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
}

/** 当前身份是否是游客。 */
export function isGuest(ctx: HandlerContext): boolean {
  return ctx.account == null || ctx.account === GUEST || ctx.credential.method === 'guest'
}

/** 平台返回登录墙时：游客 → AUTH_REQUIRED；已登录 → AUTH_EXPIRED（AGENTS 5.2）。 */
export function authError(ctx: HandlerContext, message?: string): CatbusError {
  const p = ctx.platform.id
  const e = endpointFlag(ctx.endpoint)
  if (isGuest(ctx)) return new CatbusError('AUTH_REQUIRED', message ?? '需要登录', { hint: `catbus ${p} auth login${e}` })
  return new CatbusError('AUTH_EXPIRED', message ?? `账号 ${ctx.account} 的登录态已失效`, {
    hint: `catbus ${p} auth login -a ${ctx.account}${e}`,
  })
}

/** 分页结果。 */
export function paged<T>(data: T[], cursor: string | number | null | undefined, hasMore: boolean): { data: T[]; page: Page } {
  return { data, page: { cursor: hasMore && cursor != null ? String(cursor) : null, has_more: hasMore && cursor != null } }
}
