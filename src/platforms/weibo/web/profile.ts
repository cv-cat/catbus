import type { HeaderPairs } from '../../../core/http.js'

/**
 * 请求头：逐字照抄上游 utils/weibo_utils.py、weibo_mobile_utils.py、weibo_creator_utils.py，
 * 键名大小写和顺序都不改（对拍测试逐字节比较）。
 *
 * 与上游的差异：上游写死的 `content-length` 不发（上游的 requests 发送前会用真实长度覆盖它，
 * 而 get_post_video_headers 里写的是视频大小、与表单体不符），由 HTTP 库按实际请求体计算。
 */

export const WEB = 'https://weibo.com'
export const MOBILE = 'https://m.weibo.cn'
export const COOKIE_DOMAIN = '.weibo.com'

/** 上游 HTML 请求头里的 UA（Chrome 132），访客接口也用它。 */
export const UA_132 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'
const SEC_CH_UA_132 = '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"'
const UA_130 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
const SEC_CH_UA_130 = '"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99"'
const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
const XHR_ACCEPT = 'application/json, text/plain, */*'

// ================================================================ utils/weibo_utils.py

/** get_common_headers：weibo.com 的 ajax 接口。xsrf 取 cookie 里的 XSRF-TOKEN，游客为空串。 */
export function commonHeaders(xsrf: string): HeaderPairs {
  return [
    ['accept', XHR_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'],
    ['cache-control', 'no-cache'],
    ['client-version', 'v2.46.7'],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['referer', 'https://weibo.com/u/5266778656'],
    ['sec-ch-ua', '"Chromium";v="128", "Not;A=Brand";v="24", "Microsoft Edge";v="128"'],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-origin'],
    ['server-version', 'v2024.08.30.1'],
    ['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'],
    ['x-requested-with', 'XMLHttpRequest'],
    ['x-xsrf-token', xsrf],
  ]
}

/** get_html_headers：weibo.com 首页（取 $CONFIG）。 */
export function htmlHeaders(): HeaderPairs {
  return [
    ['accept', DOC_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['pragma', 'no-cache'],
    ['priority', 'u=0, i'],
    ['referer', 'https://weibo.com/tv/home'],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'document'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-site', 'same-origin'],
    ['sec-fetch-user', '?1'],
    ['upgrade-insecure-requests', '1'],
    ['user-agent', UA_132],
  ]
}

// ================================================================ utils/weibo_mobile_utils.py

/** get_search_headers：m.weibo.cn 的搜索接口。 */
export function searchHeaders(): HeaderPairs {
  return [
    ['sec-ch-ua-platform', '"Windows"'],
    ['X-XSRF-TOKEN', 'a1d843'],
    ['Referer', 'https://m.weibo.cn/'],
    ['sec-ch-ua', SEC_CH_UA_130],
    ['sec-ch-ua-mobile', '?0'],
    ['MWeibo-Pwa', '1'],
    ['X-Requested-With', 'XMLHttpRequest'],
    ['User-Agent', UA_130],
    ['Accept', XHR_ACCEPT],
  ]
}

/** get_detail_headers：m.weibo.cn 的详情页。 */
export function detailHeaders(): HeaderPairs {
  return [
    ['accept', DOC_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'],
    ['cache-control', 'no-cache'],
    ['pragma', 'no-cache'],
    ['priority', 'u=0, i'],
    ['sec-ch-ua', SEC_CH_UA_130],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'document'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-site', 'none'],
    ['sec-fetch-user', '?1'],
    ['upgrade-insecure-requests', '1'],
    ['user-agent', UA_130],
  ]
}

// ================================================================ utils/weibo_creator_utils.py

/** generate_upload_image_media_headers：picupload 上传图片。 */
export function uploadImageHeaders(): HeaderPairs {
  return [
    ['accept', XHR_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['content-type', 'application/octet-stream'],
    ['origin', 'https://weibo.com'],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['referer', 'https://weibo.com/'],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-site'],
    ['user-agent', UA_132],
  ]
}

/** generate_video_check_headers：fileplatform check.json。 */
export function videoCheckHeaders(auth: string): HeaderPairs {
  return [
    ['Accept', XHR_ACCEPT],
    ['Accept-Language', 'zh-CN,zh;q=0.9'],
    ['Cache-Control', 'no-cache'],
    ['Connection', 'keep-alive'],
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Origin', 'https://weibo.com'],
    ['Pragma', 'no-cache'],
    ['Referer', 'https://weibo.com/'],
    ['Sec-Fetch-Dest', 'empty'],
    ['Sec-Fetch-Mode', 'cors'],
    ['Sec-Fetch-Site', 'same-site'],
    ['User-Agent', UA_132],
    ['X-Up-Auth', auth],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
  ]
}

/** generate_video_output_headers：multimedia/output 轮询转码结果。 */
export function videoOutputHeaders(): HeaderPairs {
  return [
    ['accept', XHR_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['referer', 'https://weibo.com/upload/channel'],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-origin'],
    ['user-agent', UA_132],
  ]
}

/** generate_upload_video_media_headers：up.video.weibocdn.com 上传视频（content-length 见文件头注释）。 */
export function uploadVideoHeaders(auth: string): HeaderPairs {
  return [
    ['accept', XHR_ACCEPT],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['content-type', 'application/octet-stream'],
    ['host', 'up.video.weibocdn.com'],
    ['origin', 'https://weibo.com'],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['referer', 'https://weibo.com/'],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-site'],
    ['user-agent', UA_132],
    ['x-up-auth', auth],
  ]
}

function postHeaders(): HeaderPairs {
  return [
    ['accept', XHR_ACCEPT],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['client-version', 'v2.47.25'],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['origin', 'https://weibo.com'],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['referer', 'https://weibo.com/'],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-origin'],
    ['server-version', 'v2025.01.23.1'],
    ['user-agent', UA_132],
    ['x-requested-with', 'XMLHttpRequest'],
  ]
}

/** get_post_image_headers：发图文（statuses/update）。 */
export function postImageHeaders(xsrf: string): HeaderPairs {
  return [...postHeaders(), ['x-xsrf-token', xsrf]]
}

/** get_post_video_headers：发视频（statuses/update）。上游这里不带 x-xsrf-token，照抄。 */
export function postVideoHeaders(): HeaderPairs {
  return postHeaders()
}

/** get_form_headers：fileplatform init.json，multipart/mixed 的 boundary 带秒级时间戳。 */
export function formHeaders(t: string): HeaderPairs {
  return [
    ['Accept', XHR_ACCEPT],
    ['Accept-Language', 'zh-CN,zh;q=0.9'],
    ['Cache-Control', 'no-cache'],
    ['Connection', 'keep-alive'],
    ['Content-Type', `multipart/mixed; boundary=2067456weiboPro${t}`],
    ['Origin', 'https://weibo.com'],
    ['Pragma', 'no-cache'],
    ['Referer', 'https://weibo.com/'],
    ['Sec-Fetch-Dest', 'empty'],
    ['Sec-Fetch-Mode', 'cors'],
    ['Sec-Fetch-Site', 'same-site'],
    ['User-Agent', UA_132],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
  ]
}

// ================================================================ 访客（上游没有，见 client.ts）

/** 新浪访客系统 genvisitor2 的 XHR 头：与访客页里 ufp.util.postData 发出的一致。 */
export function visitorHeaders(origin: string, referer: string): HeaderPairs {
  return [
    ['sec-ch-ua-platform', '"Windows"'],
    ['user-agent', UA_132],
    ['sec-ch-ua', SEC_CH_UA_132],
    ['content-type', 'application/x-www-form-urlencoded'],
    ['sec-ch-ua-mobile', '?0'],
    ['accept', '*/*'],
    ['origin', origin],
    ['sec-fetch-site', 'same-origin'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-dest', 'empty'],
    ['referer', referer],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['priority', 'u=1, i'],
  ]
}
