import { createSession, RequestError, type Session } from 'wreq-js'
import { CatbusError } from './errors.js'
import type { Cookie } from './schemas.js'

// wreq-js 默认读 HTTP(S)_PROXY 和系统代理。代理只能显式配置（AGENTS 5.5），这里全部关掉，
// 只通过 createSession 的 proxy 传入。cli/main.ts 在加载任何模块前也会设置一次。
disableEnvProxy()

export function disableEnvProxy(): void {
  process.env.NO_PROXY = process.env.no_proxy = '*,0.0.0.0/0,::/0'
}

export interface SessionOptions {
  proxy: string | null
  /** 秒。 */
  timeout: number
  cookies?: Cookie[]
}

/** 一个 平台 × 账号 × 代理 一个 session。凭证里的 cookie 预先写入，请求结束后用 {@link sessionCookies} 取回。 */
export async function openSession(options: SessionOptions): Promise<Session> {
  const session = await createSession({
    browser: 'chrome',
    os: 'windows',
    timeout: options.timeout * 1000,
    ...(options.proxy ? { proxy: options.proxy } : {}),
  })
  for (const c of options.cookies ?? []) {
    session.setCookie(c.name, c.value, `https://${c.domain.replace(/^\./, '')}${c.path}`)
  }
  return session
}

/** session 当前的全部 cookie，用于合并回凭证。 */
export function sessionCookies(session: Session): Cookie[] {
  return session.getAllCookies().map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? '',
    path: c.path ?? '/',
    expires: c.expiresAtMs == null ? null : Math.floor(c.expiresAtMs / 1000),
  }))
}

/** wreq-js 的错误映射成 NETWORK，`detail.kind` 区分超时、代理、连接、DNS、TLS、中止。 */
export function toNetworkError(err: unknown): CatbusError {
  if (err instanceof CatbusError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (!(err instanceof RequestError) && !(err instanceof Error && err.name === 'AbortError')) {
    return new CatbusError('ERROR', message, { cause: err })
  }
  const kind = /timed? ?out/i.test(message)
    ? 'timeout'
    : /proxy|tunnel|socks/i.test(message)
      ? 'proxy'
      : /certificate|tls|ssl/i.test(message)
        ? 'tls'
        : /abort/i.test(message)
          ? 'abort'
          : /dns|resolve|lookup|name or service/i.test(message)
            ? 'dns'
            : 'connect'
  return new CatbusError('NETWORK', `网络错误：${message}`, {
    hint: kind === 'proxy' ? '检查代理：catbus config get proxy' : null,
    detail: { kind },
    cause: err,
  })
}
