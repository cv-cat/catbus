import type { Zhihu } from './client.js'
import { meHeaders, WEB } from './profile.js'

/** 浏览器创作中心同样用这个接口确认当前登录用户；上游 ZhihuApis 没有登录态接口。 */
export function me(zhihu: Zhihu) {
  return zhihu.json<any>(`${WEB}/api/v4/me`, meHeaders())
}
