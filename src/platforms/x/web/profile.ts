import type { HeaderPairs } from '../../../core/http.js'

/**
 * 设备画像与请求头装配，移植自上游 utils/fingerprint.py + builder/client.py + builder/header.py。
 *
 * X 专属签名头（authorization / x-csrf-token / x-twitter-* / x-client-transaction-id / content-type）
 * 由本文件按浏览器实抓顺序生成；浏览器通用头（user-agent / sec-ch-ua* / accept / sec-fetch-* / priority）
 * 对应上游传输层 `_apply_fetch_headers` 追加在 X 头之后。catbus 关掉默认头，所以这里显式写全。
 */

// X web 公开固定 bearer（不是用户身份，所有 web 接口都带它，上游 PUBLIC_BEARER）。
export const PUBLIC_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

/** 当前真实 Chrome 153 画像（上游 get_profile）。所有请求的 UA / UA-CH 都取自这里，保持一致。 */
export const PROFILE = {
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  secChUa: '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
  secChUaMobile: '?0',
  secChUaPlatform: '"Windows"',
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  clientLanguage: 'zh-CN',
  timezone: 'Asia/Shanghai',
} as const

// wreq-js 最高到 chrome_149；应用层 UA/UA-CH 显式覆盖为 Chrome 153（与上游同思路）。
export const BROWSER = 'chrome_149' as const

export const X_HOST = 'https://x.com'
export const API_X = 'https://api.x.com'
export const UPLOAD_HOST = 'https://upload.x.com'
export const COOKIE_DOMAIN = '.x.com'

/** Sec-Fetch-Site：按目标 host 相对 x.com 的关系（上游 _sec_fetch_site）。 */
function secFetchSite(url: string): string {
  const host = (new URL(url).hostname || '').toLowerCase()
  if (host === 'x.com' || host === 'www.x.com') return 'same-origin'
  if (host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) return 'same-site'
  return 'cross-site'
}

/** 真实浏览器 fetch/XHR 的通用头（上游 _apply_fetch_headers），追加在 X 头之后。 */
export function fetchHeaders(url: string): HeaderPairs {
  return [
    ['user-agent', PROFILE.ua],
    ['sec-ch-ua', PROFILE.secChUa],
    ['sec-ch-ua-mobile', PROFILE.secChUaMobile],
    ['sec-ch-ua-platform', PROFILE.secChUaPlatform],
    ['accept', '*/*'],
    ['accept-language', PROFILE.acceptLanguage],
    ['priority', 'u=1, i'],
    ['sec-fetch-site', secFetchSite(url)],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-dest', 'empty'],
  ]
}

export interface AuthView {
  bearer: string
  ct0: string
  lang: string
  loggedIn: boolean
}

export type HeaderType = 'GRAPHQL' | 'FORM' | 'UPLOAD'

export interface HeaderOptions {
  referer?: string
  origin?: string
  /** x-client-transaction-id，只有 GRAPHQL / FORM 带（UPLOAD 没有这个头）。 */
  xctid?: string
}

/**
 * 装配一次请求的完整头，顺序逐项对齐浏览器实抓（2026-08 上游 builder/header.py 三族顺序）。
 * `url` 用来算 sec-fetch-site 并追加 fetch 头。
 */
export function buildHeaders(type: HeaderType, url: string, auth: AuthView, options: HeaderOptions = {}): HeaderPairs {
  const x: HeaderPairs = []
  const authType = (): void => {
    if (auth.loggedIn) x.push(['x-twitter-auth-type', 'OAuth2Session'])
  }
  if (type === 'GRAPHQL') {
    x.push(['content-type', 'application/json'])
    x.push(['authorization', auth.bearer])
    authType()
    x.push(['x-csrf-token', auth.ct0])
    x.push(['x-twitter-client-language', auth.lang])
    x.push(['x-twitter-active-user', 'yes'])
    if (options.xctid) x.push(['x-client-transaction-id', options.xctid])
    if (options.origin) x.push(['origin', options.origin])
    if (options.referer) x.push(['referer', options.referer])
  } else if (type === 'FORM') {
    x.push(['authorization', auth.bearer])
    authType()
    x.push(['x-csrf-token', auth.ct0])
    x.push(['x-twitter-client-language', auth.lang])
    x.push(['x-twitter-active-user', 'yes'])
    x.push(['content-type', 'application/x-www-form-urlencoded; charset=UTF-8'])
    if (options.xctid) x.push(['x-client-transaction-id', options.xctid])
    if (options.origin) x.push(['origin', options.origin])
    if (options.referer) x.push(['referer', options.referer])
  } else {
    // UPLOAD：只有这几个头，无 xctid / client-language / active-user（上游 _UPLOAD_ORDER）。
    x.push(['authorization', auth.bearer])
    authType()
    if (options.referer) x.push(['referer', options.referer])
    x.push(['x-csrf-token', auth.ct0])
    if (options.origin) x.push(['origin', options.origin])
  }
  return [...x, ...fetchHeaders(url)]
}
