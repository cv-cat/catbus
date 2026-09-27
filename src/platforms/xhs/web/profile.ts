import { readFileSync } from 'node:fs'
import { CREATOR_JS, PC_JS } from './js.js'

/**
 * 小红书 web 端的常量：站点、设备画像（上游 xhs_pc/js/reference_profile.json、xhs_creator/js/reference_profile.json）
 * 与浏览器实抓的请求头顺序（上游 xhs_pc/params.py、xhs_creator/params.py）。
 */

export const PC_REFERENCE = JSON.parse(readFileSync(PC_JS('reference_profile.json'), 'utf8'))
export const CREATOR_REFERENCE = JSON.parse(readFileSync(CREATOR_JS('reference_profile.json'), 'utf8'))

export const WEB = 'https://www.xiaohongshu.com'
export const EDITH = 'https://edith.xiaohongshu.com'
export const SO = 'https://so.xiaohongshu.com'
export const LIVE = 'https://live-room.xiaohongshu.com'
export const AS = 'https://as.xiaohongshu.com'
export const SEM = 'https://pages.xiaohongshu.com'
export const CREATOR = 'https://creator.xiaohongshu.com'
export const CUSTOMER = 'https://customer.xiaohongshu.com'
export const ROS_UPLOAD = 'https://ros-upload.xiaohongshu.com'
export const PGY = 'https://pgy.xiaohongshu.com'
export const PUSH_URL = 'wss://apppush-rws.xiaohongshu.com/rwp'
export const COOKIE_DOMAIN = '.xiaohongshu.com'

/** 上游 curl_cffi 用 chrome146（PC）/ chrome150（Creator）的 TLS 指纹；wreq-js 最新到 chrome_149。 */
export const BROWSER = 'chrome_146' as const
export const CREATOR_BROWSER = 'chrome_149' as const

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
export const SEC_CH_UA = '"Not;A=Brand";v="8", "Chromium";v="152", "Google Chrome";v="152"'
export const LOGIN_LANG = 'zh-CN,zh;q=0.9'
export const BUSINESS_LANG = 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'
export const ACCEPT_ENCODING = 'gzip, deflate, br, zstd'
export const XHR_ACCEPT = 'application/json, text/plain, */*'
export const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

/** 值为 null 的头不发（对应 curl_cffi 的 None）。 */
export type Headers = Record<string, string | null>

// ---------------------------------------------------------------- 头顺序（PC）

const o = (s: string) => s.split(' ')

export const PC_ORDER = {
  navigation: o('upgrade-insecure-requests user-agent sec-ch-ua sec-ch-ua-mobile sec-ch-ua-platform accept accept-encoding accept-language cookie priority sec-fetch-dest sec-fetch-mode sec-fetch-site sec-fetch-user'),
  honeypot: o('sec-ch-ua-platform referer user-agent accept sec-ch-ua content-type sec-ch-ua-mobile accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  security: o('sec-ch-ua-platform referer sec-ch-ua sec-ch-ua-mobile x-t x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  sem: o('sec-ch-ua-platform referer sec-ch-ua sec-ch-ua-mobile x-t x-s-common user-agent accept x-s accept-encoding accept-language origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  signedPost: o('sec-ch-ua-platform referer sec-ch-ua x-xray-traceid sec-ch-ua-mobile x-t x-b3-traceid x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  signedGet: o('sec-ch-ua-platform referer sec-ch-ua x-xray-traceid sec-ch-ua-mobile x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  businessPost: o('referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  businessGet: o('referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  cdeviceGet: o('referer x-xray-traceid c_device_id x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  livePost: o('referer xy-common-params x-t x-s-common x-ratelimit-meta accept content-type x-s user-agent accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  liveGet: o('referer xy-common-params x-t x-s-common x-ratelimit-meta accept x-s user-agent accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  rapPost: o('referer x-xray-traceid x-t x-b3-traceid x-s-common x-rap-param accept content-type x-s user-agent accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  xyRapPost: o('xy-direction referer x-xray-traceid x-t x-b3-traceid x-s-common x-rap-param accept content-type x-s user-agent accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  rapGet: o('referer x-xray-traceid x-t x-b3-traceid x-s-common x-rap-param user-agent accept x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
}

// ---------------------------------------------------------------- 头顺序（Creator）

export const CREATOR_ORDER = {
  navigation: PC_ORDER.navigation,
  honeypot: o('referer user-agent accept content-type accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  redcaptcha: o('referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  security: o('authorization referer x-t x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  get: o('authorization referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cookie priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  post: o('authorization referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  casGet: o('authorization referer x-t x-s-common user-agent accept x-ratelimit-meta x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  casPost: o('authorization referer x-t x-s-common user-agent accept x-ratelimit-meta content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  casGetNoRate: o('authorization referer x-t x-s-common user-agent accept x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  casPostNoRate: o('authorization referer x-t x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie origin priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  loginUserInfo: o('authorization referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept content-type x-s accept-encoding accept-language cookie priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  noteManager: o('authorization referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cookie priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
  noteManagerUserInfo: o('authorization referer x-xray-traceid x-t x-b3-traceid x-s-common user-agent accept x-s accept-encoding accept-language cache-control cookie pragma priority sec-fetch-dest sec-fetch-mode sec-fetch-site'),
}

/**
 * 上游 xhs_core/http.ordered_wire_headers：键转小写、补 accept-encoding 与 cookie，按实抓顺序排列；
 * 顺序表外的键（optional 除外）直接报错，保证与浏览器的头集合一致。
 */
export function orderedHeaders(
  headers: Headers,
  order: string[],
  cookies?: Record<string, string> | null,
  options: { optional?: string[]; strict?: boolean } = {},
): [string, string][] {
  const values: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'authority') values[k.toLowerCase()] = v == null ? null : String(v)
  values['accept-encoding'] ??= ACCEPT_ENCODING
  const cookie = cookieHeader(cookies)
  if (cookie) values.cookie = cookie
  else delete values.cookie
  const optional = new Set(options.optional ?? [])
  const missing = order.filter((k) => !(k in values) && !optional.has(k))
  const unexpected = Object.keys(values).filter((k) => !order.includes(k) && !optional.has(k))
  if (missing.length || ((options.strict ?? true) && unexpected.length)) {
    throw new Error(`请求头与实抓顺序不符：missing=${missing.join(',')} unexpected=${unexpected.join(',')}`)
  }
  const out: [string, string | null][] = order.filter((k) => k in values).map((k) => [k, values[k]!])
  for (const k of Object.keys(values)) if (optional.has(k) && !order.includes(k)) out.push([k, values[k]!])
  return out.filter((p): p is [string, string] => p[1] != null)
}

export function cookieHeader(cookies: Record<string, string> | null | undefined): string {
  return cookies ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') : ''
}

/** 导航请求的公共头（上游 get_common_headers）。 */
export function navigationHeaders(site = 'none'): Headers {
  return {
    'upgrade-insecure-requests': '1',
    'user-agent': UA,
    'sec-ch-ua': SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    accept: DOC_ACCEPT,
    'accept-language': LOGIN_LANG,
    priority: 'u=0, i',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': site,
    'sec-fetch-user': '?1',
  }
}

/** 在 after 之后插入一个头（上游 _insert_header_after / _insert_after）。 */
export function insertAfter(headers: Headers, key: string, value: string, after: string): Headers {
  const out: Headers = {}
  let inserted = false
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === key.toLowerCase()) continue
    out[k] = v
    if (k.toLowerCase() === after.toLowerCase()) {
      out[key] = value
      inserted = true
    }
  }
  if (!inserted) out[key] = value
  return out
}
