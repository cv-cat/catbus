import type { HeaderPairs } from '../../../core/http.js'

/**
 * 设备画像、请求头与业务常量（上游 utils/fingerprint.py、builder/header.py、utils/jd_util.py）。
 * UA 报 Chrome 152（与上游一致）；TLS 指纹用 wreq-js 最高的 chrome_149（上游 curl_cffi 的 chrome 同样对不齐 UA）。
 */

export const PROFILE = {
  profileId: 'chrome152-win32-rtx5060ti-hc32-v2',
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  secChUa: '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
  secChUaMobile: '?0',
  secChUaPlatform: '"Windows"',
  browserLanguage: 'zh-CN',
  browserPlatform: 'Win32',
  screenWidth: 2560,
  screenHeight: 1440,
} as const

export const BROWSER = 'chrome_149' as const
export const ACCEPT_ENCODING = 'gzip, deflate, br, zstd'
export const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'

// ---------------------------------------------------------------- 业务常量（utils/jd_util.py）

export const APPID_PASSPORT = '73806'
export const APPID_DONGDONG = '2b51e'
export const APPID_PC_ITEM = 'fb5df'
export const APPID_PC_SEARCH = 'f06cc'

export type ClientPreset = Record<string, string>
export const CLIENT_WH5: ClientPreset = { appid: 'wh5', client: 'wh5', clientVersion: '1.0.0', loginType: '3' }
export const CLIENT_IMH5: ClientPreset = { client: 'imh5', appid: 'imh5', clientVersion: '1.0.0', loginType: '3' }
export const CLIENT_PC_ITEM: ClientPreset = { appid: 'pc-item-soa', client: 'pc', clientVersion: '1.0.0', loginType: '3' }
export const CLIENT_PC_ITEM_V3: ClientPreset = { appid: 'item-v3', client: 'pc', clientVersion: '1.0.0', loginType: '3' }
export const CLIENT_PC_SEARCH: ClientPreset = { appid: 'search-pc-java', client: 'pc', clientVersion: '1.0.0', loginType: '3' }

export const DEFAULT_AREA = '1_2800_55812_0'

export const ORDER_PC_SEARCH = ['appid', 't', 'client', 'clientVersion', 'cthr', 'uuid', 'loginType', 'keyword', 'functionId', 'body', 'x-api-eid-token', 'h5st']
export const ORDER_PC_ITEM = ['functionId', 'body', 'h5st', 'uuid', 'loginType', 'appid', 'clientVersion', 'client', 't', 'x-api-eid-token', 'scval']
export const ORDER_PC_ITEM_RELWORDS = ['appid', 'functionId', 'client', 'clientVersion', 'uuid', 'skuid', 'num', 'rettype', 'type_name', 'body']
export const ORDER_PC_API = ['functionId', 'appid', 'loginType', 'x-api-eid-token', 'h5st', 't', 'client', 'clientVersion', 'body']
export const ORDER_PC_SEARCH_PLAIN = ['appid', 'functionId', 'client', 'clientVersion', 'uuid', 'body', 't']
export const ORDER_PC_SEARCH_RELWORDS = ['appid', 'functionId', 'client', 'clientVersion', 'uuid', 'keyword', 'num', 'rettype', 'type_name', 'body', 't']
export const ORDER_DD_WITH_TIME = ['functionId', 'client', 'appid', 't', 'clientVersion', 'loginType', 'h5st', 'x-api-eid-token']
export const ORDER_DD_NO_TIME = ['functionId', 'appid', 'client', 'clientVersion', 'loginType', 'h5st', 'x-api-eid-token']

export const RP_CLIENT_CHAT = 'h5_1.0.0'
export const RP_CLIENT_SEARCH = 'h5_2.1.0'
export const RP_CLIENT_ITEM = 'h5_2.2.0'

/** 参与 h5st 签名的 key（builder/params.py H5ST_SIGN_KEYS）。 */
export const H5ST_SIGN_KEYS = ['appid', 'functionId', 'body', 'client', 'clientVersion', 'jsonp', 't']

// ---------------------------------------------------------------- 站点

export const API_URL = 'https://api.m.jd.com'
export const ITEM_ORIGIN = 'https://item.jd.com'
export const ITEM_REFERER = 'https://item.jd.com/'
export const SEARCH_ORIGIN = 'https://search.jd.com'
export const SEARCH_REFERER = 'https://search.jd.com/Search?keyword=%E6%89%8B%E6%9C%BA&enc=utf-8'
export const CHAT_ORIGIN = 'https://jdcs.jd.com'
export const CHAT_REFERER = 'https://jdcs.jd.com/'
export const ORDER_URL = 'https://order.jd.com/center/list.action'
export const QR_URL = 'https://qr.m.jd.com'
export const PASSPORT_URL = 'https://passport.jd.com'
/** Chrome 地址栏与 Network 都保留 ReturnUrl 的未预编码形式。 */
export const LOGIN_PAGE = 'https://passport.jd.com/new/login.aspx?ReturnUrl=https://home.jd.com/index.html'

/** 凭证里 cookie 统一存的域：上游的 cookie 是一张不分域的表，发往所有京东站点。 */
export const COOKIE_DOMAIN = '.jd.com'

// ---------------------------------------------------------------- 请求头（builder/header.py）

/** 有序请求头，对应上游的 Header：改值不影响位置，新键追加到末尾；值为 null 表示显式去掉该头。 */
export class Header {
  pairs: [string, string][] = []

  set(key: string, value: string): this {
    const i = this.pairs.findIndex(([k]) => k === key)
    if (i >= 0) this.pairs[i] = [key, value]
    else this.pairs.push([key, value])
    return this
  }

  update(values: Record<string, string>): this {
    for (const [k, v] of Object.entries(values)) this.set(k, v)
    return this
  }

  referer(url: string): this {
    return this.set('referer', url)
  }

  origin(url: string): this {
    return this.set('origin', url)
  }

  remove(key: string): this {
    this.pairs = this.pairs.filter(([k]) => k !== key)
    return this
  }

  has(key: string): boolean {
    return this.pairs.some(([k]) => k === key)
  }

  /** 按给定顺序重排；不在 order 里的键按原顺序垫在后面。 */
  reorder(order: readonly string[]): this {
    const map = new Map(this.pairs)
    const out: [string, string][] = []
    for (const k of order) if (map.has(k)) out.push([k, map.get(k)!])
    for (const [k, v] of this.pairs) if (!order.includes(k)) out.push([k, v])
    this.pairs = out
    return this
  }

  get(): HeaderPairs {
    return this.pairs
  }
}

export const FETCH_ORDER = [
  'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'user-agent', 'accept', 'accept-encoding',
  'accept-language', 'content-type', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]
export const AXIOS_ORDER = [
  'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'user-agent', 'accept', 'x-referer-page',
  'content-type', 'x-rp-client', 'accept-encoding', 'accept-language', 'origin', 'priority',
  'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]

/** PC / 咚咚接口的 XHR 头（HeaderBuilder.build_xhr）。 */
export function xhr(options: { axios?: boolean; form?: boolean; contentType?: string | null; accept?: string | null } = {}): Header {
  const h = new Header().update({
    'sec-ch-ua-platform': PROFILE.secChUaPlatform,
    'sec-ch-ua': PROFILE.secChUa,
    'sec-ch-ua-mobile': PROFILE.secChUaMobile,
    'user-agent': PROFILE.ua,
    accept: options.accept || (options.axios ? 'application/json, text/plain, */*' : '*/*'),
    'accept-encoding': ACCEPT_ENCODING,
    'accept-language': ACCEPT_LANGUAGE,
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  })
  if (options.form) h.set('content-type', options.contentType || 'application/x-www-form-urlencoded;charset=UTF-8')
  else if (options.contentType != null) h.set('content-type', options.contentType)
  return h
}

/** HeaderBuilder.build 的通用档（GET / POST / FORM / JSONP / DOC）。 */
export function basic(type: 'GET' | 'POST' | 'FORM' | 'JSONP' | 'DOC'): Header {
  const h = new Header().update({
    'user-agent': PROFILE.ua,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-ch-ua': PROFILE.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': PROFILE.secChUaPlatform,
  })
  const xhrPart = { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-site' }
  if (type === 'GET') h.update({ accept: 'application/json, text/plain, */*', ...xhrPart })
  else if (type === 'POST') h.update({ accept: 'application/json, text/plain, */*', 'content-type': 'application/json; charset=UTF-8', ...xhrPart })
  else if (type === 'FORM') h.update({ accept: 'application/json, text/plain, */*', 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', ...xhrPart })
  else if (type === 'JSONP') h.update({ accept: '*/*', 'sec-fetch-dest': 'script', 'sec-fetch-mode': 'no-cors', 'sec-fetch-site': 'same-site' })
  else {
    h.update({
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
    })
  }
  return h
}

/** `qr.m.jd.com/show` 的图片请求头。 */
export function qrImage(): Header {
  return new Header()
    .update({
      'sec-ch-ua-platform': PROFILE.secChUaPlatform,
      'user-agent': PROFILE.ua,
      referer: 'https://passport.jd.com/',
      'sec-ch-ua': PROFILE.secChUa,
      'sec-ch-ua-mobile': PROFILE.secChUaMobile,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'accept-encoding': ACCEPT_ENCODING,
      'accept-language': ACCEPT_LANGUAGE,
      priority: 'u=1, i',
      'sec-fetch-dest': 'image',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'same-site',
    })
    .reorder([
      'sec-ch-ua-platform', 'referer', 'user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'accept', 'accept-encoding',
      'accept-language', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
    ])
}

/** 扫码轮询的 `<script>` 请求头。 */
export function qrJsonp(): Header {
  return new Header()
    .update({
      'sec-ch-ua-platform': PROFILE.secChUaPlatform,
      'user-agent': PROFILE.ua,
      referer: 'https://passport.jd.com/',
      'sec-ch-ua': PROFILE.secChUa,
      'sec-ch-ua-mobile': PROFILE.secChUaMobile,
      accept: '*/*',
      'accept-encoding': ACCEPT_ENCODING,
      'accept-language': ACCEPT_LANGUAGE,
      'sec-fetch-dest': 'script',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'same-site',
    })
    .reorder([
      'sec-ch-ua-platform', 'referer', 'user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'accept', 'accept-encoding',
      'accept-language', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
    ])
}

/** passport 的 jQuery AJAX 头（build_qr_validation），带页面级的 SGM / JDAS 链路头。 */
export function qrValidation(trace: Record<string, string> = {}): Header {
  const h = new Header()
  for (const key of ['sgm-context', 'jdas-trace-id']) if (trace[key]) h.set(key, trace[key]!)
  h.set('sec-ch-ua-platform', PROFILE.secChUaPlatform)
  h.set('referer', 'https://passport.jd.com/new/login.aspx?ReturnUrl=https://home.jd.com/index.html')
  h.set('sec-ch-ua', PROFILE.secChUa)
  h.set('sec-ch-ua-mobile', PROFILE.secChUaMobile)
  h.set('x-requested-with', 'XMLHttpRequest')
  h.set('user-agent', PROFILE.ua)
  h.set('accept', 'application/json, text/javascript, */*; q=0.01')
  for (const key of ['jdas-page-id', 'jdas-session-id']) if (trace[key]) h.set(key, trace[key]!)
  return h.update({
    'accept-encoding': ACCEPT_ENCODING,
    'accept-language': ACCEPT_LANGUAGE,
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  })
}

/** 订单中心 HTML 导航请求头。 */
export function orderDoc(): Header {
  return new Header().update({
    'upgrade-insecure-requests': '1',
    'user-agent': PROFILE.ua,
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-encoding': ACCEPT_ENCODING,
    'accept-language': ACCEPT_LANGUAGE,
    priority: 'u=0, i',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
  })
}

/** 咚咚 WebSocket 握手头。 */
export const WS_HEADERS = {
  'User-Agent': PROFILE.ua,
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
}
