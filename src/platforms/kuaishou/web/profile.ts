import type { HeaderPairs } from '../../../core/http.js'

/**
 * 设备画像、请求头与 Cookie 线序（上游 utils/fingerprint.py、builder/header.py、builder/auth.py 的 cookie_header）。
 * UA 锁在上游实抓的 Chrome 151；TLS 指纹用 wreq-js 最新的 chrome_149。
 */

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
export const SEC_CH_UA = '"Not)A;Brand";v="8", "Chromium";v="151", "Google Chrome";v="151"'
export const BROWSER = 'chrome_149' as const

/**
 * 进程级浏览器档案（上游 fingerprint.py 的 get_profile）：请求头、gdfp manMachine 载荷与滑块的
 * captchaExtraParam 都从这里取值，不能各自漂移——UA、几何互相矛盾时服务端回 350014 anti check err。
 * 几何是上游在 Chrome 151 验证码 iframe 里实测的（CURRENT_GEO 与单独给出的 CURRENT_OUTER_WIDTH）。
 */
export const PROFILE = {
  ua: UA,
  platform: 'Win32',
  language: 'zh-CN',
  timeZone: 'UTC+8',
  productSub: '20030107',
  product: 'Gecko',
  cpuCores: 20,
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  screenWidth: 2560,
  screenHeight: 1440,
  availWidth: 2560,
  availHeight: 1440,
  innerHeight: 1440,
  outerWidth: 2576,
  outerHeight: 1460,
  devicePixelRatio: 1,
} as const

/** `screen.width x screen.height`（gdfp 字段 8、captchaExtraParam 的 resolution）。 */
export const RESOLUTION = `${PROFILE.screenWidth}x${PROFILE.screenHeight}`

export const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'
/** 登录站的 STS 导航与 gdfp 指纹上报用的短 accept-language（上游实抓如此）。 */
export const ACCEPT_LANGUAGE_SHORT = 'zh-CN,zh;q=0.9'
export const ACCEPT_ENCODING = 'gzip, deflate, br, zstd'
const ACCEPT_WWW = 'application/json'
export const ACCEPT_AXIOS = 'application/json, text/plain, */*'
export const ACCEPT_ANY = '*/*'
const CONTENT_TYPE_JSON = 'application/json'
const CONTENT_TYPE_CP = 'application/json;charset=UTF-8'
const CONTENT_TYPE_FORM = 'application/x-www-form-urlencoded'
const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'

export const WWW = 'https://www.kuaishou.com'
export const CP = 'https://cp.kuaishou.com'
export const LIVE = 'https://live.kuaishou.com'
export const ID_HOST = 'https://id.kuaishou.com'
export const PASSPORT = 'https://passport.kuaishou.com'
export const GDFP = 'https://gdfp.gifshow.com'
/** 滑块验证码的 iframe 与接口。 */
export const CAPTCHA_HOST = 'https://captcha.zt.kuaishou.com'

/** 直播页 Sentry 的 baggage（带 sentry-trace 的直播接口与登出）。 */
export const LIVE_SENTRY_BAGGAGE = 'sentry-environment=prod,sentry-release=ab256f1'

export const RECO_REFERER = `${WWW}/new-reco`
export const PUBLISH_REFERER = `${CP}/article/publish/video?origin=www.kuaishou.com`

// webweapon 产品名与页面地址（kww_pure.py）
export const PRODUCT_WWW = 'kuaishou-vision'
export const PRODUCT_CP = 'onvideo-cp'
export const PRODUCT_LIVE = 'PCLive'
export const PRODUCT_CAPTCHA = 'verification-captcha'
export const HREF_WWW = `${WWW}/new-reco`
export const HREF_CP = PUBLISH_REFERER
export const HREF_LIVE = `${LIVE}/`
export const HREF_CAPTCHA = `${CAPTCHA_HOST}/iframe/index.html`

/** 按 product 取 webweapon 的 href / product（_site_defaults）。 */
export function siteDefaults(product: string): [href: string, product: string] {
  if (product === PRODUCT_CAPTCHA) return [HREF_CAPTCHA, PRODUCT_CAPTCHA]
  if (product === PRODUCT_CP) return [HREF_CP, PRODUCT_CP]
  if (product === PRODUCT_LIVE) return [HREF_LIVE, PRODUCT_LIVE]
  return [HREF_WWW, PRODUCT_WWW]
}

// ---------------------------------------------------------------- 请求头（builder/header.py）

const DOC_ONLY = ['cache-control', 'pragma', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-fetch-user', 'upgrade-insecure-requests']
const ORDER: Record<string, string[]> = {
  www: [
    'profile_referer', 'sentry-trace', 'referer', 'user-agent', 'accept', 'content-type', 'kww', 'baggage', 'accept-encoding', 'accept-language',
    'cache-control', 'cookie', 'origin', 'pragma', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', ...DOC_ONLY,
  ],
  cp: ['referer', 'user-agent', 'content-type', 'kww', 'accept', 'accept-encoding', 'accept-language', 'cookie', 'origin', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', ...DOC_ONLY],
  cp_submit: [
    'referer', 'user-agent', 'content-type', 'kww', 'accept', 'accept-encoding', 'accept-language', 'connection', 'content-length', 'cookie', 'host',
    'origin', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', ...DOC_ONLY,
  ],
  cp_creator_json: [
    'referer', 'user-agent', 'accept', 'content-type', 'returnsetrootdomainloginurl', 'accept-encoding', 'accept-language', 'cache-control', 'cookie',
    'origin', 'pragma', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', ...DOC_ONLY,
  ],
  cp_creator_axios: [
    'referer', 'x-requested-with', 'user-agent', 'accept', 'content-type', 'returnsetrootdomainloginurl', 'accept-encoding', 'accept-language',
    'cache-control', 'cookie', 'origin', 'pragma', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', ...DOC_ONLY,
  ],
  login: [
    'user-agent', 'content-type', 'kww', 'accept', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'referer', 'accept-encoding',
    'accept-language', 'cookie', 'priority', ...DOC_ONLY,
  ],
  login_pass_token: [
    'user-agent', 'content-type', 'referer', 'accept', 'accept-encoding', 'accept-language', 'cookie', 'origin', 'sec-fetch-dest', 'sec-fetch-mode',
    'sec-fetch-site', ...DOC_ONLY,
  ],
}

const STYLE: Record<string, [order: string, accept: string, contentType: string]> = {
  www: ['www', ACCEPT_WWW, CONTENT_TYPE_JSON],
  live: ['www', ACCEPT_AXIOS, CONTENT_TYPE_JSON],
  cp: ['cp', ACCEPT_ANY, CONTENT_TYPE_CP],
  cp_submit: ['cp_submit', ACCEPT_ANY, CONTENT_TYPE_CP],
  cp_creator_json: ['cp_creator_json', ACCEPT_WWW, CONTENT_TYPE_CP],
  cp_creator_axios: ['cp_creator_axios', ACCEPT_AXIOS, CONTENT_TYPE_CP],
  login: ['login', ACCEPT_ANY, CONTENT_TYPE_FORM],
  login_pass_token: ['login_pass_token', ACCEPT_ANY, CONTENT_TYPE_FORM],
}

export type HeaderStyle = keyof typeof STYLE
export type HeaderType = 'GET' | 'POST' | 'FORM' | 'DOC'

/** 有序请求头（上游 Header）：输出时先按 order，再追加不在 order 里的键。 */
export class Headers {
  readonly map = new Map<string, string>()
  constructor(private readonly order: string[] = ORDER.www!) {}

  set(key: string, value: string): this {
    this.map.set(key, value)
    return this
  }

  remove(key: string): this {
    this.map.delete(key)
    return this
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get(): HeaderPairs {
    const out: HeaderPairs = []
    const seen = new Set<string>()
    for (const k of [...this.order, ...this.map.keys()]) {
      if (seen.has(k) || !this.map.has(k)) continue
      seen.add(k)
      out.push([k, this.map.get(k)!])
    }
    return out
  }
}

/** HeaderBuilder.build：按站点风格产出顺序与 Chrome 一致的请求头。 */
export function buildHeaders(type: HeaderType, style: HeaderStyle = 'www', accept?: string): Headers {
  if (type === 'DOC') {
    const h = new Headers()
    h.set('accept', DOC_ACCEPT)
      .set('accept-language', ACCEPT_LANGUAGE)
      .set('cache-control', 'no-cache')
      .set('pragma', 'no-cache')
      .set('priority', 'u=0, i')
      .set('sec-ch-ua', SEC_CH_UA)
      .set('sec-ch-ua-mobile', '?0')
      .set('sec-ch-ua-platform', '"Windows"')
      .set('sec-fetch-dest', 'document')
      .set('sec-fetch-mode', 'navigate')
      .set('sec-fetch-site', 'none')
      .set('sec-fetch-user', '?1')
      .set('upgrade-insecure-requests', '1')
      .set('user-agent', UA)
    return h
  }
  const [order, defaultAccept, contentType] = STYLE[style]!
  const h = new Headers(ORDER[order])
  h.set('user-agent', UA)
  h.set('accept', accept ?? defaultAccept)
  if (type === 'POST' || type === 'FORM') h.set('content-type', type === 'POST' ? contentType : CONTENT_TYPE_FORM)
  h.set('accept-encoding', ACCEPT_ENCODING)
  h.set('accept-language', ACCEPT_LANGUAGE)
  h.set('sec-fetch-dest', 'empty')
  h.set('sec-fetch-mode', 'cors')
  h.set('sec-fetch-site', 'same-origin')
  if (style === 'login') h.set('priority', 'u=1, i')
  return h
}

// ---------------------------------------------------------------- Cookie 线序（builder/auth.py cookie_header）

const W_HEAD = [
  'kpf', 'clientid', 'did', 'wid', 'didv', 'kwpsecproductname', 'userId', 'kuaishou.server.webday7_st', 'kuaishou.server.webday7_ph', 'bUserId',
  'kuaishou.web.cp.api_st', 'kuaishou.web.cp.api_ph',
]
const CP_HEAD = ['did', 'wid', 'didv', 'userId', 'bUserId', 'kuaishou.web.cp.api_st', 'kuaishou.web.cp.api_ph']
const LIVE_HEAD = ['did', 'wid', 'clientid', 'did', 'client_key', 'kpn', 'didv']
const LIVE_CP = [...LIVE_HEAD, 'userId', 'bUserId', 'kuaishou.web.cp.api_st', 'kuaishou.web.cp.api_ph', 'kuaishou.live.bfb1s', 'userId']
const LIVE_ONLY = [...LIVE_HEAD, 'bUserId', 'kuaishou.live.bfb1s', 'kwpsecproductname', 'userId', 'userId']
const PASS_CP = ['did', 'wid', 'didv', 'userId', 'userId', 'bUserId', 'bUserId', 'kuaishou.web.cp.api_st', 'kuaishou.web.cp.api_ph']
const PASS_DIRECT = ['did', 'wid', 'didv', 'bUserId', 'kwpsecproductname', 'userId', 'userId', 'passToken', 'kwfv1', 'kwssectoken', 'kwscode']
const WEB = ['kuaishou.live.web_st', 'kuaishou.live.web_ph']
const Q = ['kwpsecproductname', 'kwssectoken', 'kwscode', 'kwfv1']

/** 各页面、各阶段 Chrome 实抓的 Cookie 字段顺序（含同名重复的 path-scoped 字段）。 */
export const SEQUENCES: Record<string, string[]> = {
  www_initial: [...W_HEAD, 'ktrace-context', 'kpn', ...Q.slice(0, 1), 'kwssectoken', 'kwscode', 'kwfv1'],
  www_graphql_initial: [...W_HEAD, 'ktrace-context', 'kwpsecproductname', 'kwfv1', 'kwssectoken', 'kwscode', 'kpn'],
  www_graphql_refreshed: [...W_HEAD, 'ktrace-context', 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kpn', 'kwfv1'],
  www_graphql_detail_initial: [...W_HEAD, 'kwpsecproductname', 'ktrace-context', 'kwssectoken', 'kwscode', 'kpn', 'kwfv1', 'kwssectoken', 'kwscode'],
  www_graphql_detail_bootstrap: [...W_HEAD, 'ktrace-context', 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwfv1', 'kwssectoken', 'kwscode', 'kpn'],
  www_graphql_detail_video_success: [...W_HEAD, 'ktrace-context', 'kwpsecproductname', 'kpn', 'kwssectoken', 'kwscode', 'kwssectoken', 'kwscode', 'kwfv1'],
  www_graphql_detail_refreshed: [...W_HEAD, 'kwpsecproductname', 'ktrace-context', 'kwssectoken', 'kwscode', 'kpn', 'kwfv1', 'kwssectoken', 'kwscode'],
  www_graphql_comment_initial: [...W_HEAD, 'ktrace-context', 'kpn', 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwssectoken', 'kwscode', 'kwfv1'],
  www_graphql_subcomment_initial: [...W_HEAD, 'kwpsecproductname', 'ktrace-context', 'kwssectoken', 'kwscode', 'kpn', 'kwfv1', 'kwssectoken', 'kwscode'],
  www_relogin_relation_following: [...W_HEAD, 'ktrace-context', 'kpn', 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwfv1', 'kwssectoken', 'kwscode'],
  www_relogin_relation_fans: [...W_HEAD, 'ktrace-context', 'kpn', 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwssectoken', 'kwscode', 'kwfv1'],
  cp_creator_initial: [...CP_HEAD, 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwfv1'],
  cp_creator_warmed: [...CP_HEAD, 'kwpsecproductname', 'kwscode', 'kwssectoken', 'kwfv1'],
  cp_creator_refreshed: [...CP_HEAD, 'kwpsecproductname', 'kwscode', 'kwssectoken', 'kwfv1'],
  cp: [...CP_HEAD, 'kwpsecproductname', 'kwscode', 'kwssectoken', 'kwfv1'],
  cp_upload: [...CP_HEAD, 'kwpsecproductname', 'kwfv1', 'kwssectoken', 'kwscode'],
  cp_video_submit: [...CP_HEAD, 'kwpsecproductname', 'kwfv1', 'kwssectoken', 'kwscode'],
  cp_atlas: [...CP_HEAD, 'kwpsecproductname', 'kwfv1', 'kwssectoken', 'kwscode'],
  live_pass_token_home: [...PASS_CP, 'passToken', 'kwfv1', 'kwpsecproductname', 'kwssectoken', 'kwscode'],
  live_pass_token_room: [...PASS_CP, 'kwpsecproductname', 'passToken', 'kwssectoken', 'kwscode', 'kwfv1'],
  live_pass_token_home_direct: PASS_DIRECT,
  live_pass_token_room_direct: PASS_DIRECT,
  live_home_initial: [...LIVE_CP, ...WEB, 'kwfv1', 'kwpsecproductname', 'kwssectoken', 'kwscode'],
  live_home_login: [...LIVE_CP, ...WEB, ...Q],
  live_home_login_bootstrap: [...LIVE_CP, 'kuaishou.live.web_st', ...Q],
  live_home_current_initial: [...LIVE_ONLY, ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_home_current_login: [...LIVE_ONLY, ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_home_current_login_bootstrap: [...LIVE_ONLY, 'kuaishou.live.web_st', 'kwssectoken', 'kwscode', 'kwfv1'],
  live_home_current_authenticated_1: [...LIVE_ONLY, 'kwssectoken', 'kwscode', 'kwfv1', ...WEB],
  live_home_current_authenticated_2: [...LIVE_ONLY, 'kwfv1', ...WEB, 'kwssectoken', 'kwscode'],
  live_home_current_authenticated_3: [...LIVE_ONLY, ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_home_authenticated_1: [...LIVE_CP, ...WEB, ...Q],
  live_home_authenticated_2: [...LIVE_CP, ...Q, ...WEB],
  live_room_initial: [...LIVE_CP, 'kwpsecproductname', ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_room_current_initial: [...LIVE_ONLY, 'kwfv1', 'kwssectoken', 'kwscode', ...WEB],
  live_room_login: [...LIVE_CP, 'kwpsecproductname', ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_room_login_bootstrap: [...LIVE_CP, 'kwpsecproductname', 'kuaishou.live.web_st', 'kwssectoken', 'kwscode', 'kwfv1'],
  live_room_current_login: [...LIVE_ONLY, 'kwssectoken', 'kwscode', ...WEB, 'kwfv1'],
  live_room_current_login_bootstrap: [...LIVE_ONLY, 'kwssectoken', 'kwscode', 'kuaishou.live.web_st', 'kwfv1'],
  live_room_authenticated: [...LIVE_CP, 'kwpsecproductname', ...WEB, 'kwssectoken', 'kwscode', 'kwfv1'],
  live_room_current_authenticated: [...LIVE_ONLY, 'kwfv1', ...WEB, 'kwssectoken', 'kwscode'],
  // 房间首屏的表情 / 礼物字典（emoji/icon、emoji/allgifts）
  live_room_assets_initial: [...LIVE_HEAD, 'bUserId', 'kuaishou.live.bfb1s', 'userId', ...WEB, 'kwfv1', 'kwssectoken', 'kwscode', 'kwpsecproductname'],
  // 直播间登出：passport 那一跳只带设备与安全票据；已清理过的会话再登出一次时顺序不同
  live_logout_passport_authenticated: ['did', 'wid', 'didv', 'bUserId', 'kwfv1', 'kwssectoken', 'kwscode', 'kwpsecproductname'],
  live_logout_passport_clean: ['did', 'wid', 'didv', 'bUserId', ...Q],
  live_room_logout_authenticated: [...LIVE_HEAD, 'bUserId', 'kuaishou.live.bfb1s', 'userId', ...WEB, ...Q],
  live_room_logout_clean: [...LIVE_HEAD, 'bUserId', 'kuaishou.live.bfb1s', ...Q],
  // 视频发布后跳到的作品管理页（仍是上传上下文的 kuaishou-vision 产品）
  cp_post_publish_manage: [...CP_HEAD, 'kwpsecproductname', 'kwssectoken', 'kwscode', 'kwfv1'],
  // 验证码 iframe：第一个 kwpsecproductname 是 iframe 路径下的 verification-captcha，第二个是父页的产品
  captcha: ['did', 'wid', 'kwpsecproductname', 'didv', 'bUserId', ...Q],
}
SEQUENCES.www_refreshed = SEQUENCES.www_initial!
SEQUENCES.www_security_refreshed = SEQUENCES.www_initial!

/** 取值时直接读原始 cookie 映射、不触发 webweapon 续期的线序（其余都先经 `auth.cookie`）。 */
export const RAW_VALUE_PROFILES = new Set([
  'www_initial', 'www_graphql_initial', 'www_graphql_subcomment_initial', 'cp_creator_initial', 'cp_creator_warmed', 'cp_creator_refreshed',
  'live_home_initial', 'live_home_current_initial', 'live_room_initial', 'live_room_assets_initial', 'cp_post_publish_manage',
])

/** 这些线序里奇数次出现的 kwssectoken / kwscode 取上一次轮换前的旧值（真实发生过轮换时）。 */
export const STALE_PAIR_PROFILES = new Set([
  'www_graphql_detail_bootstrap', 'www_graphql_detail_initial', 'www_graphql_detail_video_success', 'www_graphql_detail_refreshed',
  'www_graphql_comment_initial', 'www_graphql_subcomment_initial', 'www_relogin_relation_following', 'www_relogin_relation_fans',
])
