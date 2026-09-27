import type { HeaderPairs } from '../../../core/http.js'

/**
 * 淘宝 web 端的常量与请求头（上游 taobao_apis.py、taobao_live.py）。
 * 请求头的名字、大小写和顺序照抄上游，对拍测试逐字节比较。
 */

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
/** 上游私信长连握手用的是 Chrome 133 的 UA（taobao_live.py），照抄。 */
export const WS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
export const SEC_CH_UA = '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"'
export const BROWSER = 'chrome_146' as const

export const COOKIE_DOMAIN = '.taobao.com'

/** mtop 的 appKey，也参与签名。 */
export const APP_KEY = '12574478'
/** 钉钉 IMPaaS 的 app-key。 */
export const IM_APP_KEY = '3ce2dacdc7c0c43ad7bc7f9bc7d7a1b8'
/** 私信里用户 ID、会话 ID 的后缀。 */
export const IM_DOMAIN = 'cntaobao'

export const LOGIN_TOKEN_URL = 'https://h5api.m.taobao.com/h5/mtop.taobao.login.token.get.h5/2.0/'
export const UPLOAD_URL = 'https://stream-upload.taobao.com/api/upload.api'
export const WSS_URL = 'wss://wss-cntaobao.dingtalk.com/'

/** /reg 帧里的 ua。 */
export const IM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 DingTalk(2.1.5) OS(Windows/10) Browser(Chrome/146.0.0.0) DingWeb/2.1.5 IMPaaS DingWeb/2.1.5'

/** get_token 的请求头。 */
export const TOKEN_HEADERS: HeaderPairs = [
  ['accept', '*/*'],
  ['accept-language', 'en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
  ['cache-control', 'no-cache'],
  ['pragma', 'no-cache'],
  ['referer', 'https://market.m.taobao.com/'],
  ['sec-ch-ua', SEC_CH_UA],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['sec-fetch-dest', 'script'],
  ['sec-fetch-mode', 'no-cors'],
  ['sec-fetch-site', 'same-site'],
  ['user-agent', UA],
]

/** get_goods_uid_encrypt_uid 打开商品页的请求头。 */
export const DOC_HEADERS: HeaderPairs = [
  ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
  ['accept-language', 'en'],
  ['cache-control', 'no-cache'],
  ['pragma', 'no-cache'],
  ['priority', 'u=0, i'],
  ['referer', 'https://www.taobao.com/'],
  ['sec-ch-ua', SEC_CH_UA],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
  ['sec-fetch-dest', 'document'],
  ['sec-fetch-mode', 'navigate'],
  ['sec-fetch-site', 'same-origin'],
  ['sec-fetch-user', '?1'],
  ['upgrade-insecure-requests', '1'],
  ['user-agent', UA],
]

/** upload_media 的请求头。 */
export const UPLOAD_HEADERS: HeaderPairs = [
  ['Accept', '*/*'],
  ['Accept-Language', 'en,zh-CN;q=0.9,zh;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
  ['Cache-Control', 'no-cache'],
  ['Connection', 'keep-alive'],
  ['Origin', 'https://market.m.taobao.com'],
  ['Pragma', 'no-cache'],
  ['Referer', 'https://market.m.taobao.com/'],
  ['Sec-Fetch-Dest', 'empty'],
  ['Sec-Fetch-Mode', 'cors'],
  ['Sec-Fetch-Site', 'same-site'],
  ['User-Agent', UA],
  ['sec-ch-ua', SEC_CH_UA],
  ['sec-ch-ua-mobile', '?0'],
  ['sec-ch-ua-platform', '"Windows"'],
]

/** 私信长连的握手头（Cookie 由调用方填）。Host / Connection 由 WebSocket 库自己管，真正连接时去掉。 */
export function wsHeaders(cookie: string): HeaderPairs {
  return [
    ['Cookie', cookie],
    ['Host', 'wss-cntaobao.dingtalk.com'],
    ['Connection', 'Upgrade'],
    ['Pragma', 'no-cache'],
    ['Cache-Control', 'no-cache'],
    ['User-Agent', WS_UA],
    ['Origin', 'https://www.cntaobao.com'],
    ['Accept-Encoding', 'gzip, deflate, br, zstd'],
    ['Accept-Language', 'zh-CN,zh;q=0.9'],
  ]
}
