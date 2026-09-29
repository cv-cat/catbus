import type { Cookie } from './schemas.js'
import { nowSeconds } from './rand.js'

/**
 * Cookie 罐：直接读写凭证文件里某个 scope 的 cookie 数组，所以请求中更新的 cookie
 * 会随凭证一起由 core 落盘（AGENTS 5.3「自动刷新」）。
 *
 * domain 以 `.` 开头表示对子域名生效；不带点表示只对该主机生效（host-only）。
 */
export class CookieJar {
  constructor(readonly cookies: Cookie[] = []) {}

  /** 对某个 URL 生效、未过期的 cookie，按存入顺序。 */
  forUrl(url: string | URL): Cookie[] {
    const u = typeof url === 'string' ? new URL(url) : url
    const now = nowSeconds()
    return this.cookies.filter(
      (c) => domainMatch(u.hostname, c.domain) && pathMatch(u.pathname, c.path) && (c.expires == null || c.expires > now),
    )
  }

  /** 按名字取值；有多个同名 cookie 时，指定 domain 可以消歧，否则取第一个。 */
  get(name: string, domain?: string): string | undefined {
    return this.find(name, domain)?.value
  }

  has(name: string): boolean {
    return this.cookies.some((c) => c.name === name)
  }

  /** 写入或覆盖（同名、同 domain、同 path 视为同一个）。 */
  set(name: string, value: string, domain: string, options: { path?: string; expires?: number | null } = {}): this {
    const path = options.path ?? '/'
    const existing = this.cookies.find((c) => c.name === name && c.domain === domain && c.path === path)
    if (existing) {
      existing.value = value
      if (options.expires !== undefined) existing.expires = options.expires
    } else {
      this.cookies.push({ name, value, domain, path, expires: options.expires ?? null })
    }
    return this
  }

  delete(name: string, domain?: string): this {
    for (let i = this.cookies.length - 1; i >= 0; i--) {
      const c = this.cookies[i]!
      if (c.name === name && (domain == null || c.domain === domain)) this.cookies.splice(i, 1)
    }
    return this
  }

  /** 按名字的顺序表重排；表外的排在最后，保持相对顺序。 */
  sort(order: string[]): this {
    const index = new Map(order.map((n, i) => [n, i]))
    const ranked = this.cookies.map((c, i) => ({ c, i, r: index.get(c.name) ?? order.length }))
    ranked.sort((a, b) => a.r - b.r || a.i - b.i)
    this.cookies.splice(0, this.cookies.length, ...ranked.map((x) => x.c))
    return this
  }

  /** Cookie 请求头：对 url 生效的 cookie（不给 url 时为全部），按存入顺序拼成 `a=1; b=2`。 */
  header(url?: string | URL): string {
    return (url ? this.forUrl(url) : this.cookies).map((c) => `${c.name}=${c.value}`).join('; ')
  }

  /** 名字 → 值；同名时取第一个。 */
  toObject(url?: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const c of url ? this.forUrl(url) : this.cookies) if (!(c.name in out)) out[c.name] = c.value
    return out
  }

  /** 处理响应的 Set-Cookie。 */
  applySetCookie(url: string, headers: string[]): void {
    const host = new URL(url).hostname
    for (const header of headers) {
      const parsed = parseSetCookie(header, host)
      // Domain 属性必须覆盖当前主机（RFC 6265 5.3），否则丢弃
      if (!parsed || !domainMatch(host, parsed.domain)) continue
      const { name, value, domain, path, expires } = parsed
      if (expires != null && expires <= nowSeconds()) {
        const i = this.cookies.findIndex((c) => c.name === name && c.domain === domain && c.path === path)
        if (i >= 0) this.cookies.splice(i, 1)
      } else this.set(name, value, domain, { path, expires })
    }
  }

  private find(name: string, domain?: string): Cookie | undefined {
    return this.cookies.find((c) => c.name === name && (domain == null || c.domain === domain))
  }
}

function domainMatch(host: string, domain: string): boolean {
  if (!domain) return true
  if (domain.startsWith('.')) {
    const d = domain.slice(1)
    return host === d || host.endsWith(domain)
  }
  return host === domain
}

function pathMatch(path: string, cookiePath: string): boolean {
  if (!cookiePath || cookiePath === '/') return true
  return path === cookiePath || path.startsWith(cookiePath.endsWith('/') ? cookiePath : cookiePath + '/')
}

/** 解析一条 Set-Cookie。domain 属性统一规范成带点的形式，没有 domain 属性时为 host-only。 */
export function parseSetCookie(header: string, host: string): Cookie | null {
  const [pair, ...attrs] = header.split(';')
  const i = pair!.indexOf('=')
  if (i <= 0) return null
  const cookie: Cookie = { name: pair!.slice(0, i).trim(), value: pair!.slice(i + 1).trim(), domain: host, path: '/', expires: null }
  let maxAge: number | null = null
  for (const attr of attrs) {
    const j = attr.indexOf('=')
    const key = (j < 0 ? attr : attr.slice(0, j)).trim().toLowerCase()
    const val = j < 0 ? '' : attr.slice(j + 1).trim()
    if (key === 'domain' && val) cookie.domain = '.' + val.replace(/^\./, '').toLowerCase()
    else if (key === 'path' && val.startsWith('/')) cookie.path = val
    else if (key === 'max-age' && /^-?\d+$/.test(val)) maxAge = Number(val)
    else if (key === 'expires') {
      const t = Date.parse(val)
      if (!Number.isNaN(t)) cookie.expires = Math.floor(t / 1000)
    }
  }
  if (maxAge != null) cookie.expires = nowSeconds() + maxAge
  return cookie
}

/**
 * 解析用户导入的 cookie 字符串（`a=1; b=2`），也接受浏览器导出的 JSON 数组
 * （`[{name, value, domain, path, expirationDate}]`）。domain 缺省时取平台默认域。
 */
export function parseCookieInput(input: string, defaultDomain: string): Cookie[] {
  const text = input.trim()
  if (text.startsWith('[')) {
    const list = JSON.parse(text) as { name: string; value: string; domain?: string; path?: string; expirationDate?: number; expires?: number }[]
    return list.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ? (c.domain.startsWith('.') ? c.domain : '.' + c.domain.replace(/^www\./, '')) : defaultDomain,
      path: c.path ?? '/',
      expires: c.expirationDate ?? c.expires ?? null,
    }))
  }
  const out: Cookie[] = []
  for (const part of text.replace(/^cookie:\s*/i, '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0) continue
    const name = part.slice(0, i).trim()
    if (!name) continue
    const existing = out.find((c) => c.name === name)
    const value = part.slice(i + 1).trim()
    if (existing) existing.value = value
    else out.push({ name, value, domain: defaultDomain, path: '/', expires: null })
  }
  return out
}
