import type { HeaderPairs } from '../../../core/http.js'

export const WEB = 'https://www.zhihu.com'
export const COOKIE_DOMAIN = '.zhihu.com'
export const BROWSER = 'chrome_146' as const

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

/** `/api/v4/me` 在已登录网页里发出的同源 JSON 请求头。 */
export function meHeaders(): HeaderPairs {
  return [
    ['accept', 'application/json, text/plain, */*'],
    ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8'],
    ['referer', `${WEB}/`],
    ['sec-ch-ua', '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"'],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', '"Windows"'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-origin'],
    ['user-agent', UA],
  ]
}
