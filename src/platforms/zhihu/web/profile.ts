import type { HeaderPairs } from '../../../core/http.js'
import { ZSE_93 } from './sign.js'

/** 知乎 web 端的站点、浏览器画像与请求头顺序（按 Chrome 在 www.zhihu.com 上发出的 fetch 请求整理）。 */

export const WWW = 'https://www.zhihu.com'
export const ZHUANLAN = 'https://zhuanlan.zhihu.com'
export const COOKIE_DOMAIN = '.zhihu.com'

/** TLS / H2 指纹，与 UA 的大版本一致。 */
export const BROWSER = 'chrome_149' as const
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
export const SEC_CH_UA = '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"'
export const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9'
export const ACCEPT_ENCODING = 'gzip, deflate, br, zstd'
/** 前端请求 `/api/v4` 时带的 `x-api-version`。 */
export const API_VERSION = '3.0.91'

export interface ApiHeaderInit {
  zse96: string
  referer: string
  /** 写操作带上 `_xsrf` cookie 的值。 */
  xsrf?: string | null
  /** 请求体是 JSON 时为 true。 */
  json?: boolean
}

/** `/api` 下的 fetch 请求。cookie 由 HttpClient 插在 priority 之前。 */
export function apiHeaders(h: ApiHeaderInit): HeaderPairs {
  const write = h.xsrf != null
  const pairs: [string, string | null][] = [
    ['sec-ch-ua-platform', '"Windows"'],
    ['x-zse-93', ZSE_93],
    ['x-api-version', API_VERSION],
    ['sec-ch-ua', SEC_CH_UA],
    ['sec-ch-ua-mobile', '?0'],
    ['x-requested-with', 'fetch'],
    ['x-zse-96', h.zse96],
    ['x-xsrftoken', h.xsrf ?? null],
    ['user-agent', UA],
    ['accept', '*/*'],
    ['content-type', h.json ? 'application/json' : null],
    ['origin', write ? WWW : null],
    ['sec-fetch-site', 'same-origin'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-dest', 'empty'],
    ['referer', h.referer],
    ['accept-encoding', ACCEPT_ENCODING],
    ['accept-language', ACCEPT_LANGUAGE],
    ['priority', 'u=1, i'],
  ]
  return pairs.filter((p): p is [string, string] => p[1] != null)
}

/** 首页导航：没有 `_xsrf` 时打开一次首页，由 Set-Cookie 下发。 */
export function navigationHeaders(): HeaderPairs {
  return [
    ['sec-ch-ua', SEC_CH_UA],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['upgrade-insecure-requests', '1'],
    ['user-agent', UA],
    ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
    ['sec-fetch-site', 'none'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-user', '?1'],
    ['sec-fetch-dest', 'document'],
    ['accept-encoding', ACCEPT_ENCODING],
    ['accept-language', ACCEPT_LANGUAGE],
    ['priority', 'u=0, i'],
  ]
}

/** `POST /udid`：前端拿设备标识 d_c0 的请求。 */
export function udidHeaders(): HeaderPairs {
  return [
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-ch-ua', SEC_CH_UA],
    ['sec-ch-ua-mobile', '?0'],
    ['x-requested-with', 'fetch'],
    ['user-agent', UA],
    ['accept', '*/*'],
    ['origin', WWW],
    ['sec-fetch-site', 'same-origin'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-dest', 'empty'],
    ['referer', `${WWW}/`],
    ['accept-encoding', ACCEPT_ENCODING],
    ['accept-language', ACCEPT_LANGUAGE],
    ['priority', 'u=1, i'],
  ]
}
