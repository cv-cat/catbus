import type { HeaderPairs } from '../../../core/http.js'

/**
 * 闲鱼 web 端的常量与请求头（上游 goofish_apis.py、goofish_live.py）。
 * 请求头的名字、大小写和顺序照抄上游，对拍测试逐字节比较。
 */

/** build_initial_cookies / qrcode_login 用的 UA（Chrome 147）。 */
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
/** XianyuApis 各方法用的 UA（Chrome 146）。 */
const API_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
/** 私信长连握手用的 UA（Chrome 133，goofish_live.py），照抄。 */
const WS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
const SEC_CH_UA_147 = '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"'
const SEC_CH_UA_146 = '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"'
const ACCEPT_LANGUAGE = 'en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7,ja;q=0.6'
export const BROWSER = 'chrome_146' as const

export const COOKIE_DOMAIN = '.goofish.com'
export const H5API = 'https://h5api.m.goofish.com/h5'
export const PASSPORT = 'https://passport.goofish.com'

/** mtop 的 appKey，也参与签名（写死在上游 JS 的 generate_sign 里）。 */
export const APP_KEY = '34839810'
/** 钉钉 IMPaaS 的 app-key。 */
export const IM_APP_KEY = '444e9908a51d1cb236a27862abc769c9'
/** 私信里用户 ID、会话 ID 的后缀。 */
export const IM_DOMAIN = 'goofish'
export const WSS_URL = 'wss://wss-goofish.dingtalk.com/'
export const UPLOAD_URL = 'https://stream-upload.goofish.com/api/upload.api'

/** /reg 帧里的 ua。 */
export const IM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 DingTalk(2.1.5) OS(Windows/10) Browser(Chrome/133.0.0.0) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5'

/** Python 的 `{**base, **extra}`：已有的键原位改值，新键追加到末尾。 */
export function merge(base: HeaderPairs, extra: HeaderPairs): HeaderPairs {
  const out: HeaderPairs = base.map(([k, v]) => [k, v])
  for (const [k, v] of extra) {
    const i = out.findIndex(([x]) => x === k)
    if (i >= 0) out[i] = [k, v]
    else out.push([k, v])
  }
  return out
}

/** 真浏览器抓出来的 mtop XHR 请求头（_MTOP_HEADERS）。 */
export const MTOP_HEADERS: HeaderPairs = [
  ['User-Agent', UA],
  ['Accept', 'application/json'],
  ['Accept-Language', ACCEPT_LANGUAGE],
  ['Accept-Encoding', 'gzip, deflate, br, zstd'],
  ['sec-ch-ua', SEC_CH_UA_147],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['Origin', 'https://www.goofish.com'],
  ['Referer', 'https://www.goofish.com/'],
  ['sec-fetch-dest', 'empty'],
  ['sec-fetch-mode', 'cors'],
  ['sec-fetch-site', 'same-site'],
  ['priority', 'u=1, i'],
  ['Content-Type', 'application/x-www-form-urlencoded'],
]

/** passport 域的请求头（_PASSPORT_HEADERS）。 */
export const PASSPORT_HEADERS: HeaderPairs = [
  ['User-Agent', UA],
  ['Accept', 'application/json, text/plain, */*'],
  ['Accept-Language', ACCEPT_LANGUAGE],
  ['Accept-Encoding', 'gzip, deflate, br, zstd'],
  ['sec-ch-ua', SEC_CH_UA_147],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['sec-fetch-dest', 'empty'],
  ['sec-fetch-mode', 'cors'],
  ['sec-fetch-site', 'same-origin'],
  ['priority', 'u=1, i'],
]

/** build_initial_cookies 的 session 头：只设了 User-Agent。 */
export const SESSION_HEADERS: HeaderPairs = [['User-Agent', UA]]

/** get_token 的请求头。 */
export const TOKEN_HEADERS: HeaderPairs = [
  ['Host', 'h5api.m.goofish.com'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['user-agent', API_UA],
  ['accept', 'application/json'],
  ['sec-ch-ua', SEC_CH_UA_146],
  ['content-type', 'application/x-www-form-urlencoded'],
  ['sec-ch-ua-mobile', '?0'],
  ['origin', 'https://www.goofish.com'],
  ['sec-fetch-site', 'same-site'],
  ['sec-fetch-mode', 'cors'],
  ['sec-fetch-dest', 'empty'],
  ['referer', 'https://www.goofish.com/'],
  ['accept-language', ACCEPT_LANGUAGE],
  ['priority', 'u=1, i'],
]

/** refresh_token、get_public_channel、public 共用的请求头。 */
export const API_HEADERS: HeaderPairs = [
  ['accept', 'application/json'],
  ['accept-language', ACCEPT_LANGUAGE],
  ['cache-control', 'no-cache'],
  ['content-type', 'application/x-www-form-urlencoded'],
  ['origin', 'https://www.goofish.com'],
  ['pragma', 'no-cache'],
  ['priority', 'u=1, i'],
  ['referer', 'https://www.goofish.com/'],
  ['sec-ch-ua', SEC_CH_UA_146],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['sec-fetch-dest', 'empty'],
  ['sec-fetch-mode', 'cors'],
  ['sec-fetch-site', 'same-site'],
  ['user-agent', API_UA],
]

/** get_default_location 的请求头：多一个 eagleeye-userdata。 */
export const LOCATION_HEADERS: HeaderPairs = [
  ...API_HEADERS.slice(0, 4),
  ['eagleeye-userdata', 'spm-cnt=a21ybx'],
  ...API_HEADERS.slice(4),
]

/** upload_media 的请求头（multipart，content-type 由请求库生成）。 */
export const UPLOAD_HEADERS: HeaderPairs = [
  ['accept', '*/*'],
  ['accept-language', ACCEPT_LANGUAGE],
  ['cache-control', 'no-cache'],
  ['origin', 'https://www.goofish.com'],
  ['pragma', 'no-cache'],
  ['priority', 'u=1, i'],
  ['referer', 'https://www.goofish.com/'],
  ['sec-ch-ua', SEC_CH_UA_146],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['sec-fetch-dest', 'empty'],
  ['sec-fetch-mode', 'cors'],
  ['sec-fetch-site', 'same-site'],
  ['user-agent', API_UA],
]

/** 私信长连的握手头（goofish_live.py main / list_all_conversations）。 */
export function wsHeaders(cookie: string): HeaderPairs {
  return [
    ['Cookie', cookie],
    ['Host', 'wss-goofish.dingtalk.com'],
    ['Connection', 'Upgrade'],
    ['Pragma', 'no-cache'],
    ['Cache-Control', 'no-cache'],
    ['User-Agent', WS_UA],
    ['Origin', 'https://www.goofish.com'],
    ['Accept-Encoding', 'gzip, deflate, br, zstd'],
    ['Accept-Language', 'zh-CN,zh;q=0.9'],
  ]
}

export const itemUrl = (id: string) => `https://www.goofish.com/item?id=${id}`
export const userUrl = (id: string) => `https://www.goofish.com/personal?userId=${id}`
