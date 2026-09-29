import { jsonDumps, quote, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { authError } from '../../../core/toolkit.js'
import { type Douyin, type DyJson, riskJson } from './client.js'
import { strDataReport } from './mssdk.js'
import { APP_VERSION, headers, type Headers, LIVE, livePlatformParams, Params, platformParams, PROFILE, WWW } from './profile.js'
import { randomMsToken, signedUrl, spliceUrl } from './sign.js'

/**
 * 上游 dy_apis/douyin_api.py 等的请求构造，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）。
 * webid / msToken / csrf 等附带请求发生的时机也与上游一致。返回平台原始 JSON。
 */

const LIVE_HOST = 'live.douyin.com'

// ---------------------------------------------------------------- 公共片段

async function withWebId(d: Douyin, p: Params): Promise<void> {
  p.add('webid', await d.webid())
}

function withUifid(d: Douyin, p: Params): void {
  const v = d.cookie('UIFID')
  if (v) p.add('uifid', v)
}

function headerUifid(d: Douyin, h: Headers): Headers {
  const v = d.cookie('UIFID')
  if (v) h.set('uifid', v)
  return h
}

function withVerifyFp(d: Douyin, p: Params): void {
  const fp = d.cookie('s_v_web_id')
  if (fp) p.add('verifyFp', fp).add('fp', fp)
}

function fp(d: Douyin, p: Params): void {
  const v = d.cookie('s_v_web_id') ?? ''
  p.add('verifyFp', v).add('fp', v)
}

async function withMsToken(d: Douyin, p: Params): Promise<void> {
  p.add('msToken', await d.msToken())
}

/** 上游 with_a_bogus(data)：签名输入是 splice_url 后的 query 与 body。 */
function withABogus(d: Douyin, p: Params, data?: [string, unknown][], host = 'www.douyin.com'): void {
  p.add('a_bogus', d.ab.sign(spliceUrl(p.pairs()), data ? spliceUrl(data) : '', host))
}

/** 上游 with_platform(auth=auth, url=...)：公共组 + webid + uifid + verifyFp/fp。 */
async function withPlatformAuth(d: Douyin, p: Params, rtt = '0'): Promise<void> {
  p.update(platformParams(rtt))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
}

async function getJson(d: Douyin, url: string, h: Headers, p?: Params, timeout?: number): Promise<DyJson> {
  const res = await d.request({ url, headers: h.list(), query: p?.pairs(), timeout })
  return riskJson(res)
}

async function getSigned(d: Douyin, base: string, h: Headers, p: Params): Promise<DyJson> {
  return getJson(d, signedUrl(base, p.raw(), d.cookie('UIFID') ?? ''), h)
}

/** x-secsdk-csrf-token：HEAD 一次 abtest_config，取响应头 X-Ware-Csrf-Token 的第 2 段（上游 generate_csrf_token）。 */
export async function csrfToken(d: Douyin, cookieStr: string, origin = WWW, path = '/service/2/abtest_config/', referer?: string): Promise<string | null> {
  try {
    const res = await d.http.request({
      method: 'HEAD',
      url: origin + path,
      headers: [
        ['x-secsdk-csrf-request', '1'],
        ['referer', referer ?? origin + '/'],
        ['user-agent', PROFILE.ua],
        ['x-secsdk-csrf-version', '1.2.22'],
        ['accept', '*/*'],
        ['accept-language', PROFILE.acceptLanguage],
      ],
      cookies: cookieObject(cookieStr),
    })
    const parts = (res.headers.get('x-ware-csrf-token') ?? '').split(',')
    return parts.length > 4 ? parts[1]! : null
  } catch {
    return null
  }
}

async function withCsrf(d: Douyin, h: Headers): Promise<void> {
  const token = await csrfToken(d, d.cookieStr)
  if (token != null) h.set('x-secsdk-csrf-token', token)
}

/** trans_cookies：cookie 串 → 有序对象（空片段跳过）。 */
export function cookieObject(cookieStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of cookieStr.split(';')) {
    const s = item.trim()
    const i = s.indexOf('=')
    if (i <= 0) continue
    out[s.slice(0, i)] = s.slice(i + 1)
  }
  return out
}

// ================================================================ 游客态：ttwid、msToken、设备号

/** ttwid 注册（上游 DYLoginApi.register_ttwid）。 */
export async function registerTtwid(d: Douyin): Promise<string> {
  const body = jsonDumps({
    region: 'cn',
    aid: 1768,
    needFid: false,
    service: 'www.douyin.com',
    migrate_info: { ticket: '', source: 'node' },
    cbUrlProtocol: 'https',
    union: true,
  })
  const res = await d.plain({
    method: 'POST',
    url: 'https://ttwid.bytedance.com/ttwid/union/register/',
    headers: [
      ['content-type', 'application/json'],
      ['user-agent', PROFILE.ua],
    ],
    body,
    timeout: 20,
  })
  for (const line of res.headers.getSetCookie()) {
    const m = /^ttwid=([^;]*)/.exec(line)
    if (m) return m[1]!
  }
  return ''
}

function mssdkHeaders(storageAccess = false): [string, string][] {
  const h: [string, string][] = [
    ['sec-ch-ua-platform', PROFILE.secChUaPlatform],
    ['referer', `${WWW}/`],
    ['user-agent', PROFILE.ua],
    ['sec-ch-ua', PROFILE.secChUa],
    ['content-type', 'text/plain;charset=UTF-8'],
    ['sec-ch-ua-mobile', '?0'],
    ['accept', '*/*'],
    ['accept-language', 'zh-CN,zh;q=0.9'],
    ['cache-control', 'no-cache'],
    ['origin', WWW],
    ['pragma', 'no-cache'],
    ['priority', 'u=1, i'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'cross-site'],
  ]
  if (storageAccess) h.push(['sec-fetch-storage-access', 'active'])
  return h
}

function msTokenOf(res: { headers: { get(n: string): string | null } }): string {
  const token = res.headers.get('x-ms-token') ?? ''
  if (token) return token
  return /msToken=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? ''
}

/** mssdk /web/r/token 换 msToken；续期时把旧 token 挂在 query 上（上游 utils/mstoken.get_mstoken）。 */
export async function mstoken(d: Douyin, previous = ''): Promise<string> {
  const body = strDataReport()
  let url = 'https://mssdk.bytedance.com/web/r/token?ms_appid=6383'
  if (previous) url += '&msToken=' + quote(previous, '')
  const res = await d.plain({ method: 'POST', url, headers: mssdkHeaders(), body, timeout: 25 })
  return msTokenOf(res)
}

/** mssdk /web/common 轮换 msToken（上游 refresh_common_mstoken）：完整上报或 5 分钟一次的行为心跳。响应的 cookie 并回会话（cookie_sink）。 */
export async function commonMstoken(d: Douyin, current: string, body: string): Promise<string> {
  let url = 'https://mssdk.bytedance.com/web/common?ms_appid=6383'
  if (current) url += '&msToken=' + quote(current, '')
  const res = await d.plain({ method: 'POST', url, headers: mssdkHeaders(true), body, timeout: 25 })
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(';', 1)[0]!
    const i = pair.indexOf('=')
    if (i > 0 && pair.slice(i + 1).trim()) d.setCookie(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
  return msTokenOf(res)
}

/** 设备号（上游 get_device_id）：query/user 的 id。 */
export async function deviceId(d: Douyin): Promise<string> {
  const refer = `${WWW}/discover`
  const h = headerUifid(d, headers('GET').set('referer', refer))
  const p = new Params().update(platformParams()).add('publish_video_strategy_type', '2')
  await withWebId(d, p)
  p.add('msToken', randomMsToken())
  fp(d, p)
  withABogus(d, p)
  const body = await getJson(d, `${WWW}/aweme/v1/web/query/user`, h, p)
  return body.id
}

/** 服务端渲染页面里的 user_unique_id（上游 generate_webid）；拿不到返回空串。 */
export async function pageWebid(d: Douyin, url: string): Promise<string> {
  try {
    const h = headers('DOC').set('cookie', d.cookieStr).set('upgrade-insecure-requests', '1')
    const text = await (await d.http.request({ url, headers: h.list() })).text()
    return /\\"user_unique_id\\":\\"(.*?)\\"/.exec(text)?.[1] ?? ''
  } catch {
    return ''
  }
}

/** 自己的数字 uid（上游 get_my_uid）。没有 user_uid 或为 0 表示没登录，报 AUTH_*（游客 AUTH_REQUIRED，账号 AUTH_EXPIRED）。 */
export async function myUid(d: Douyin): Promise<string> {
  const refer = `${WWW}/`
  const h = headerUifid(d, headers('GET').set('referer', refer))
  const p = new Params().add('publish_video_strategy_type', '2').update(platformParams())
  withUifid(d, p)
  await withWebId(d, p)
  fp(d, p)
  withABogus(d, p)
  const body = await getJson(d, `${WWW}/aweme/v1/web/query/user/`, h, p)
  const uid = String(body.user_uid ?? '').trim()
  if (!/^\d+$/.test(uid) || /^0+$/.test(uid)) throw authError(d.ctx, 'query/user 没有返回 user_uid，cookie 无效或已过期')
  return uid
}

/** 自己的 sec_uid（上游 get_my_sec_uid）：创作者中心 user/info，主站 HTML 兜底。 */
export async function mySecUid(d: Douyin): Promise<{ secUid: string; user: any }> {
  try {
    const res = await d.request({
      url: 'https://creator.douyin.com/web/api/media/user/info/',
      headers: [
        ['accept', 'application/json, text/plain, */*'],
        ['accept-language', PROFILE.acceptLanguage],
        ['referer', 'https://creator.douyin.com/creator-micro/home'],
        ['user-agent', PROFILE.ua],
      ],
      timeout: 20,
    })
    const user = (JSON.parse(await res.text()) ?? {}).user ?? {}
    if (user.sec_uid) return { secUid: user.sec_uid, user }
  } catch {}
  const res = await d.request({ url: `${WWW}/user/self`, headers: headers('GET').list(), query: [['from_tab_name', 'main']] })
  const found = /\\"secUid\\":\\"(.*?)\\"/.exec(await res.text())?.[1]
  if (!found) throw new Error('未取到 sec_uid：创作者接口与主站 HTML 都没拿到，请检查登录态')
  return { secUid: found, user: null }
}

// ================================================================ 作品、用户、评论、搜索

export async function userWorks(d: Douyin, secUid: string, maxCursor = '0', own = false): Promise<DyJson> {
  const userUrl = `${WWW}/user/${secUid}`
  const h = headerUifid(d, headers('GET').referer(userUrl))
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web')
  p.add('sec_user_id', secUid).add('max_cursor', maxCursor).add('locate_query', 'false').add('show_live_replay_strategy', '1')
  p.add('need_time_list', maxCursor === '0' ? '1' : '0').add('time_list_query', '0').add('whale_cut_token', '').add('cut_version', '1')
  p.add('count', '18').add('publish_video_strategy_type', '2').add('from_user_page', own ? '0' : '1')
  p.add('update_version_code', '170400').add('pc_client_type', '1').add('pc_libra_divert', 'Windows').add('support_h265', '1').add('support_dash', '1')
  p.add('cpu_core_num', PROFILE.cpuCoreNum).add('version_code', '290100').add('version_name', '29.1.0').add('cookie_enabled', 'true')
  p.add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight).add('browser_language', 'zh-CN').add('browser_platform', 'Win32')
  p.add('browser_name', PROFILE.browserName).add('browser_version', PROFILE.browserVersion).add('browser_online', 'true').add('engine_name', 'Blink')
  p.add('engine_version', PROFILE.engineVersion).add('os_name', 'Windows').add('os_version', '10').add('device_memory', PROFILE.deviceMemory)
  p.add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '0')
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  withVerifyFp(d, p)
  return getSigned(d, `${WWW}/aweme/v1/web/aweme/post/`, h, p)
}

export async function workInfo(d: Douyin, awemeId: string): Promise<DyJson> {
  const h = headerUifid(d, headers('GET').referer(`${WWW}/video/${awemeId}`))
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('aweme_id', awemeId)
  p.add('request_source', '600').add('origin_type', 'video_page')
  p.update(platformParams('50', '190500', '19.5.0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getSigned(d, `${WWW}/aweme/v1/web/aweme/detail/`, h, p)
}

export async function comments(d: Douyin, awemeId: string, cursor = '0'): Promise<DyJson> {
  const h = headerUifid(d, headers('GET').referer(`${WWW}/video/${awemeId}`))
  d.withBdReadonly(h)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('aweme_id', awemeId).add('cursor', cursor)
  p.add('count', '5').add('item_type', '0').add('whale_cut_token', '').add('cut_version', '1').add('rcFT', '')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/comment/list/`, h, p)
}

export async function replies(d: Douyin, awemeId: string, commentId: string, cursor = '0', count = '3'): Promise<DyJson> {
  const h = headers('GET').referer(`${WWW}/video/${awemeId}`)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('item_id', awemeId).add('comment_id', commentId)
  p.add('cut_version', '1').add('cursor', cursor).add('count', count).add('item_type', '0')
  p.update(platformParams('0'))
  await withWebId(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  fp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/comment/list/reply/`, h, p)
}

export async function userInfo(d: Douyin, secUid: string): Promise<DyJson> {
  const h = headerUifid(d, headers('GET').referer(`${WWW}/user/${secUid}`))
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('publish_video_strategy_type', '2')
  p.add('source', 'channel_pc_web').add('sec_user_id', secUid).add('personal_center_strategy', '1').add('profile_other_record_enable', '1').add('land_to', '1')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  withVerifyFp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/user/profile/other/`, h, p)
}

/**
 * 搜索筛选（上游 search_general_work / search_video_work 的参数）：sort_type 0 综合 / 1 最多点赞 / 2 最新；
 * publish_time 0 不限 / 1 / 7 / 180 天；filter_duration '' 不限 / 0-1 / 1-5 / 5-10000 分钟；
 * search_range 不限 / 1 看过 / 2 没看过 / 3 关注的人；content_type（仅综合）'' 不限 / 1 视频 / 2 图文。
 */
export interface SearchFilters {
  sortType?: string
  publishTime?: string
  filterDuration?: string
  searchRange?: string
  contentType?: string
}

/**
 * 综合搜索（上游 search_general_work）。上游只按筛选是否非默认把 is_filter_search 置 1，
 * 筛选值本身不进 query（fe3eb24 删掉了 filter_selected），这里照抄。
 */
export async function searchGeneral(d: Douyin, keyword: string, offset = '0', searchId = '', f: SearchFilters = {}): Promise<DyJson> {
  const filtered = (f.sortType ?? '0') !== '0' || (f.publishTime ?? '0') !== '0' || Boolean(f.filterDuration || f.searchRange || f.contentType)
  const refer = `${WWW}/search/${quote(keyword)}?aid=${rand.uuid4()}&type=general`
  const h = headerUifid(d, headers('GET').referer(refer))
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('search_channel', 'aweme_general')
  p.add('enable_history', '1').add('keyword', keyword).add('search_source', 'normal_search').add('query_correct_type', '1')
  p.add('is_filter_search', filtered ? '1' : '0').add('from_group_id', '').add('disable_rs', '0').add('offset', offset).add('count', '15')
  p.add('need_filter_settings', offset === '0' ? '1' : '0').add('list_type', 'single').add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}')
  p.add('search_id', searchId)
  p.update(platformParams('0', '190600', '19.6.0'))
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  withVerifyFp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/general/search/single/`, h, p)
}

/**
 * 视频频道搜索（上游 search_video_work）：筛选值都进 query。翻页时带上一页响应头的 X-Tt-Logid 作为 search_id。
 * 返回 [下一页的 search_id, 原始 JSON]。
 */
export async function searchVideo(d: Douyin, keyword: string, offset = '0', count = '16', f: SearchFilters = {}, searchId = ''): Promise<[string, DyJson]> {
  const refer = `${WWW}/search/${quote(keyword)}?aid=${rand.uuid4()}&type=video`
  const h = headers('GET').referer(refer)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('search_channel', 'aweme_video_web')
  p.add('enable_history', '1').add('sort_type', f.sortType ?? '0').add('publish_time', f.publishTime ?? '0')
  p.add('filter_duration', f.filterDuration ?? '').add('search_range', f.searchRange ?? '0')
  p.add('keyword', keyword).add('search_source', 'normal_search').add('query_correct_type', '1').add('is_filter_search', '1')
  p.add('from_group_id', '').add('offset', offset).add('count', count).add('need_filter_settings', offset === '0' ? '1' : '0')
  if (searchId) p.add('search_id', searchId)
  p.add('list_type', 'single').add('pc_search_top_1_params', '')
  p.update(platformParams('50'))
  await withWebId(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  fp(d, p)
  const res = await d.request({ url: `${WWW}/aweme/v1/web/search/item/`, headers: h.list(), query: p.pairs() })
  const next = res.headers.get('x-tt-logid') ?? ''
  return [next, await riskJson(res)]
}

/** 用户搜索（上游 search_user）。fans：0_1k / 1k_1w / 1w_10w / 10w_100w / 100w_；userType：common_user / enterprise_user / personal_user。 */
export async function searchUser(d: Douyin, keyword: string, offset = '0', count = '25', fans = '', userType = ''): Promise<DyJson> {
  const refer = `${WWW}/search/${quote(keyword)}?type=user`
  const h = headerUifid(d, headers('GET').referer(refer))
  const hasFilter = Boolean(fans || userType)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('search_channel', 'aweme_user_web')
  if (hasFilter) p.add('search_filter_value', `{"douyin_user_fans":["${fans}"],"douyin_user_type":["${userType}"]}`)
  p.add('keyword', keyword).add('search_source', 'normal_search').add('query_correct_type', '1').add('is_filter_search', hasFilter ? '1' : '0')
  p.add('from_group_id', '').add('disable_rs', '0').add('offset', offset).add('count', count).add('need_filter_settings', offset === '0' ? '1' : '0')
  p.add('list_type', 'single').add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}')
  p.update(platformParams('50').slice(3))
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  fp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/discover/search/`, h, p)
}

export async function searchLive(d: Douyin, keyword: string, offset = '0', count = '15'): Promise<DyJson> {
  const refer = `${WWW}/search/${quote(keyword)}?aid=${rand.uuid4()}&type=live`
  const h = headerUifid(d, headers('GET').referer(refer))
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('search_channel', 'aweme_live')
  p.add('keyword', keyword).add('search_source', 'normal_search').add('query_correct_type', '1').add('is_filter_search', '0')
  p.add('from_group_id', '').add('disable_rs', '0').add('offset', offset).add('count', count).add('need_filter_settings', offset === '0' ? '1' : '0')
  p.add('list_type', 'single').add('pc_search_top_1_params', '{"enable_ai_search_top_1":1}')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  withVerifyFp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/live/search/`, h, p)
}

/** 用户喜欢的作品（上游 get_user_favorite，接口是 aweme/favorite）。 */
export async function userFavorite(d: Douyin, secUid: string, maxCursor = '0', count = '18'): Promise<DyJson> {
  const refer = `${WWW}/user/${secUid}?showTab=like`
  const h = headerUifid(d, headers('GET').referer(refer))
  d.withBdReadonly(h)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('sec_user_id', secUid).add('max_cursor', maxCursor)
  p.add('min_cursor', '0').add('whale_cut_token', '').add('cut_version', '1').add('count', count).add('publish_video_strategy_type', '2')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  withABogus(d, p)
  return getSigned(d, `${WWW}/aweme/v1/web/aweme/favorite/`, h, p)
}

/** 收藏夹列表（上游 get_collect_list 只取 cursor=0 的第一页；翻页时换成上一页响应的 cursor）。 */
export async function collectList(d: Douyin, cursor = '0', count = '20'): Promise<DyJson> {
  const h = headerUifid(d, headers('GET')).referer(`${WWW}/?recommend=1`)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('cursor', cursor).add('count', count)
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getSigned(d, `${WWW}/aweme/v1/web/collects/list/`, h, p)
}

export async function followers(d: Douyin, userId: string, secUid: string, maxTime = '', count = '20'): Promise<DyJson> {
  if (!maxTime || maxTime === '0') maxTime = String(rand.nowSeconds())
  const h = headerUifid(d, headers('GET')).referer(`${WWW}/user/${secUid}`)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('user_id', userId).add('sec_user_id', secUid)
  p.add('offset', '0').add('min_time', '0').add('max_time', maxTime).add('count', count).add('source_type', maxTime === '0' ? '2' : '1')
  p.add('gps_access', '0').add('address_book_access', '0')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/user/follower/list/`, h, p)
}

export async function following(d: Douyin, userId: string, secUid: string, maxTime = '0', count = '20'): Promise<DyJson> {
  const h = headers('GET').referer(`${WWW}/user/${secUid}`)
  d.withBdReadonly(h)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('user_id', userId).add('sec_user_id', secUid)
  p.add('offset', '0').add('min_time', '0').add('max_time', maxTime).add('count', count).add('source_type', maxTime === '0' ? '2' : '1')
  p.add('gps_access', '0').add('address_book_access', '0').add('is_top', '1').add('pc_client_type', '1').add('pc_libra_divert', 'Windows')
  p.add('support_h265', '1').add('support_dash', '1').add('webcast_sdk_version', '170400').add('webcast_version_code', '170400')
  p.add('version_code', '170400').add('version_name', '17.4.0').add('cookie_enabled', 'true').add('screen_width', PROFILE.screenWidth)
  p.add('screen_height', PROFILE.screenHeight).add('browser_language', 'zh-CN').add('browser_platform', 'Win32').add('browser_name', PROFILE.browserName)
  p.add('browser_version', PROFILE.browserVersion).add('browser_online', 'true').add('engine_name', 'Blink').add('engine_version', PROFILE.engineVersion)
  p.add('os_name', 'Windows').add('os_version', '10').add('cpu_core_num', PROFILE.cpuCoreNum).add('device_memory', PROFILE.deviceMemory)
  p.add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '0')
  await withWebId(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getSigned(d, `${WWW}/aweme/v1/web/user/following/list/`, h, p)
}

export async function notices(d: Douyin, minTime = '0', maxTime = '0', count = '10', group = '960'): Promise<DyJson> {
  const h = headerUifid(d, headers('GET')).referer(`${WWW}/?recommend=1`)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('is_new_notice', '1').add('is_mark_read', '1')
  p.add('notice_group', group).add('count', count).add('min_time', minTime).add('max_time', maxTime)
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  fp(d, p)
  const body = await getJson(d, `${WWW}/aweme/v1/web/notice/`, h, p)
  if (!body.notice_list?.length && body.notice_list_v2) body.notice_list = body.notice_list_v2
  return body
}

export async function feed(d: Douyin, count = '20', refreshIndex = '2'): Promise<DyJson> {
  const h = headers('GET').referer(`${WWW}/`)
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('module_id', '3003101').add('count', count)
  p.add('filterGids', '').add('presented_ids', '').add('refresh_index', refreshIndex).add('refer_id', '').add('refer_type', '10')
  p.add('awemePcRecRawData', '{"is_client":false}').add('Seo-Flag', '0').add('install_time', '1715480185').add('pc_client_type', '1')
  p.add('update_version_code', '170400').add('version_code', '170400').add('version_name', '17.4.0').add('cookie_enabled', 'true')
  p.add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight).add('browser_language', 'zh-CN').add('browser_platform', 'Win32')
  p.add('browser_name', PROFILE.browserName).add('browser_version', PROFILE.browserVersion).add('browser_online', 'true').add('engine_name', 'Blink')
  p.add('engine_version', PROFILE.engineVersion).add('os_name', 'Windows').add('os_version', '10').add('cpu_core_num', PROFILE.cpuCoreNum)
  p.add('device_memory', PROFILE.deviceMemory).add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '100')
  await withWebId(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  fp(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/module/feed/`, h, p)
}

// ================================================================ 写操作：点赞、收藏、评论

export async function digg(d: Douyin, awemeId: string, type: '1' | '0'): Promise<DyJson> {
  const api = '/aweme/v1/web/commit/item/digg/'
  const refer = `${WWW}/discover?modal_id=${awemeId}`
  const h = headers('FORM')
  d.withBdReadonly(h)
  const dt = d.dtraitHeader(api)
  if (dt) h.set('x-tt-session-dtrait', dt)
  await withCsrf(d, h)
  headerUifid(d, h).set('origin', WWW).set('referer', refer)
  const p = new Params().update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  p.add('uid', await d.commentUid())
  const res = await d.request({
    method: 'POST',
    url: WWW + api,
    headers: h.list(),
    query: p.pairs(),
    form: [
      ['aweme_id', awemeId],
      ['item_type', '0'],
      ['type', type],
    ],
  })
  return riskJson(res)
}

export async function collect(d: Douyin, awemeId: string, action: '1' | '0'): Promise<DyJson> {
  const api = '/aweme/v1/web/aweme/collect/'
  const h = headers('FORM').referer(`${WWW}/?recommend=1`)
  d.withBdReadonly(h)
  await withCsrf(d, h)
  headerUifid(d, h).set('origin', WWW)
  const p = new Params().add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('pc_client_type', '1')
  p.update(platformParams('0'))
  await withWebId(d, p)
  withUifid(d, p)
  withVerifyFp(d, p)
  await withMsToken(d, p)
  const data: [string, string][] = [
    ['action', action],
    ['aweme_id', awemeId],
    ['aweme_type', '0'],
  ]
  withABogus(d, p, data)
  p.add('uid', await d.commentUid())
  const res = await d.request({ method: 'POST', url: WWW + api, headers: h.list(), query: p.pairs(), form: data })
  return riskJson(res)
}

/** 收藏夹移动的 query（上游 move / remove_collect_aweme 手写的那组，键按字母序）。 */
async function collectsMoveParams(d: Douyin, awemeId: string, collectName: string, collectId: string, remove: boolean): Promise<Params> {
  const p = new Params()
  p.add('aid', '6383').add('browser_language', 'zh-CN').add('browser_name', PROFILE.browserName).add('browser_online', 'true')
  p.add('browser_platform', PROFILE.platform).add('browser_version', PROFILE.browserVersion).add('channel', 'channel_pc_web').add('collects_name', collectName)
  p.add('cookie_enabled', 'true').add('cpu_core_num', PROFILE.cpuCoreNum).add('device_memory', PROFILE.deviceMemory).add('device_platform', 'webapp')
  p.add('downlink', '10').add('effective_type', '4g').add('engine_name', 'Blink').add('engine_version', PROFILE.engineVersion)
  if (remove) p.add('from_collects_id', collectId)
  p.add('item_ids', awemeId).add('item_type', '2')
  if (!remove) p.add('move_collects_list', collectId)
  p.add('os_name', 'Windows').add('os_version', PROFILE.osVersion).add('pc_client_type', '1').add('platform', 'PC').add('round_trip_time', '50')
  p.add('screen_height', PROFILE.screenHeight).add('screen_width', PROFILE.screenWidth)
  if (!remove) p.add('to_collects_id', collectId).add('update_collects_sort', 'true')
  p.add('update_version_code', '170400').add('version_code', '170400').add('version_name', '17.4.0')
  await withWebId(d, p)
  fp(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return p
}

/** 把已收藏的作品移进某个收藏夹（上游 move_collect_aweme）。 */
export async function collectMove(d: Douyin, awemeId: string, collectName: string, collectId: string): Promise<DyJson> {
  const api = '/aweme/v1/web/collects/video/move/'
  const h = headers('FORM').referer(`${WWW}/?recommend=1`)
  d.withBdReadonly(h)
  const dt = d.dtraitHeader(api)
  if (dt) h.set('x-tt-session-dtrait', dt)
  await withCsrf(d, h)
  headerUifid(d, h).set('origin', WWW)
  const p = await collectsMoveParams(d, awemeId, collectName, collectId, false)
  return riskJson(await d.request({ method: 'POST', url: WWW + api, headers: h.list(), query: p.pairs() }))
}

/** 把作品从某个收藏夹移出（上游 remove_collect_aweme，同一个接口）。 */
export async function collectRemove(d: Douyin, awemeId: string, collectName: string, collectId: string): Promise<DyJson> {
  const api = '/aweme/v1/web/collects/video/move/'
  const h = headers('FORM').referer(`${WWW}/user/self?showTab=favorite_collection`)
  d.withBdReadonly(h)
  await withCsrf(d, h)
  headerUifid(d, h).set('origin', WWW)
  const p = await collectsMoveParams(d, awemeId, collectName, collectId, true)
  return riskJson(await d.request({ method: 'POST', url: WWW + api, headers: h.list(), query: p.pairs() }))
}

export async function publishComment(d: Douyin, awemeId: string, text: string, replyId = '', replyToReplyId = ''): Promise<DyJson> {
  const api = '/aweme/v1/web/comment/publish'
  const refer = `${WWW}/video/${awemeId}`
  const h = headers('FORM').set('origin', WWW).referer(refer)
  await d.withBd(h, api)
  await withCsrf(d, h)
  headerUifid(d, h)
  const p = new Params()
  p.add('app_name', 'aweme').add('enter_from', 'video_detail').add('previous_page', 'video_detail').add('device_platform', 'webapp').add('aid', '6383')
  p.add('channel', 'channel_pc_web').add('pc_client_type', '1').add('pc_libra_divert', 'Windows').add('update_version_code', '170400')
  p.add('support_h265', '1').add('support_dash', '1').add('version_code', '170400').add('version_name', '17.4.0').add('cookie_enabled', 'true')
  p.add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight).add('browser_language', 'zh-CN').add('browser_platform', 'Win32')
  p.add('browser_name', PROFILE.browserName).add('browser_version', PROFILE.browserVersion).add('browser_online', 'true').add('engine_name', 'Blink')
  p.add('engine_version', PROFILE.engineVersion).add('os_name', 'Windows').add('os_version', '10').add('cpu_core_num', PROFILE.cpuCoreNum)
  p.add('device_memory', PROFILE.deviceMemory).add('platform', 'PC').add('downlink', '10').add('effective_type', '4g').add('round_trip_time', '50')
  await withWebId(d, p)
  withUifid(d, p)
  fp(d, p)
  await withMsToken(d, p)
  const data: [string, string][] = [['aweme_id', awemeId]]
  if (replyId) data.push(['reply_id', replyId])
  if (replyToReplyId) data.push(['reply_to_reply_id', replyToReplyId])
  data.push(
    ['comment_send_celltime', '0'],
    ['comment_video_celltime', '0'],
    ['one_level_comment_rank', '-1'],
    ['paste_edit_method', 'non_paste'],
    ['text', text],
    ['text_extra', '[]'],
  )
  withABogus(d, p, data)
  const uid = await d.commentUid()
  if (uid) p.add('uid', uid)
  const res = await d.request({ method: 'POST', url: WWW + api, headers: h.list(), query: p.pairs(), form: data })
  return riskJson(res)
}

// ================================================================ 商品

function liveEcomHeaders(url: string): Headers {
  return headers('GET').referer(url).remove('sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform')
}

/** 直播间正在讲解的商品（上游 get_live_production，接口 /live/promotions/pop/v3/）。 */
export async function liveProduction(d: Douyin, url: string, roomId: string, authorId: string, sceneId = '1001'): Promise<DyJson> {
  const h = headerUifid(d, liveEcomHeaders(url))
  const entrance = JSON.stringify({ room_id: roomId, anchor_id: authorId, carrier_type: 'live_popup_card', ecom_scene_id: sceneId })
  const p = new Params()
  p.add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web').add('room_id', roomId).add('author_id', authorId)
  p.add('live_scene_id', '0').add('entrance_info', quote(entrance, ''))
  p.update(livePlatformParams())
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  withABogus(d, p, undefined, LIVE_HOST)
  const res = await d.request({ url: `${LIVE}/live/promotions/pop/v3/`, headers: h.list(), query: p.pairs() })
  const buf = await res.clone().arrayBuffer()
  if (!buf.byteLength) return { promotions: [] }
  return riskJson(res)
}

/** 商品详情（上游 get_live_production_detail，接口 /aweme/v2/shop/promotion/pack/detail/）。 */
export async function productDetail(d: Douyin, url: string, promotionId: string, originType = '638303'): Promise<DyJson> {
  const h = headers('FORM').set('origin', LIVE).referer(url)
  await withCsrf(d, h)
  headerUifid(d, h).remove('sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform')
  const p = new Params().add('is_h5', '1').add('origin_type', originType).add('device_platform', 'webapp').add('aid', '6383').add('channel', 'channel_pc_web')
  p.update(livePlatformParams())
  await withWebId(d, p)
  withUifid(d, p)
  await withMsToken(d, p)
  const data: [string, string][] = [
    ['is_h5', '1'],
    ['bff_type', '2'],
    ['origin_type', originType],
    ['promotion_id', promotionId],
  ]
  withABogus(d, p, data, LIVE_HOST)
  const res = await d.request({ method: 'POST', url: `${LIVE}/aweme/v2/shop/promotion/pack/detail/`, headers: h.list(), query: p.pairs(), form: data })
  return riskJson(res)
}

/** 商品评价（上游 get_product_comments）。 */
export async function productComments(d: Douyin, productId: string, shopId: string, cursor = '0', count = '10', sortType = '0', tagId = '', statId = ''): Promise<DyJson> {
  const h = headerUifid(d, headers('GET').referer(`${WWW}/`))
  const p = new Params().add('product_id', productId).add('shop_id', shopId).add('cursor', cursor).add('count', count)
  p.add('stat_id', statId).add('tag_id', tagId).add('sort_type', sortType)
  await withPlatformAuth(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/ecom/product/comments/`, h, p)
}

/** 商品评价的分类计数：好评 / 差评 / 有图等标签（上游 get_product_comment_counter）。 */
export async function productCommentCounter(d: Douyin, productId: string, shopId: string, statId = ''): Promise<DyJson> {
  const h = headerUifid(d, headers('GET').referer(`${WWW}/`))
  const p = new Params().add('product_id', productId).add('shop_id', shopId).add('stat_id', statId)
  await withPlatformAuth(d, p)
  await withMsToken(d, p)
  withABogus(d, p)
  return getJson(d, `${WWW}/aweme/v1/web/ecom/product/comment/counter/`, h, p)
}

// ================================================================ 直播

export interface LiveInfo {
  room_id: string
  user_id: string
  user_unique_id: string
  anchor_id: string
  sec_uid: string
  ttwid: string
  room_status?: string
  room_title?: string
}

/** 直播间页面（上游 get_live_info）：从服务端渲染的脚本里取 roomId、user_unique_id、主播 id。 */
export async function liveInfo(d: Douyin, webRid: string): Promise<LiveInfo | null> {
  const res = await d.request({
    url: `${LIVE}/${webRid}`,
    headers: [
      ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
      ['accept-language', 'zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7,ja;q=0.6'],
      ['cache-control', 'no-cache'],
      ['pragma', 'no-cache'],
      ['priority', 'u=0, i'],
      ['referer', 'https://live.douyin.com/?from_nav=1'],
      ['sec-ch-ua', '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Windows"'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'navigate'],
      ['sec-fetch-site', 'same-origin'],
      ['upgrade-insecure-requests', '1'],
      ['user-agent', PROFILE.ua],
    ],
    timeout: 30,
  })
  const text = await res.text()
  const ttwid = /(?:^|;\s*)ttwid=([^;]*)/.exec(res.headers.getSetCookie().find((c) => c.startsWith('ttwid=')) ?? '')?.[1] ?? d.cookie('ttwid') ?? ''
  const scripts = [...text.matchAll(/<script\b[^>]*\bnonce\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!)
  for (const s of scripts) {
    if (!s.includes('roomId')) continue
    const userId = /\\"user_unique_id\\":\\"(\d+)\\"/.exec(s)?.[1]
    const roomId = /\\"roomId\\":\\"(\d+)\\"/.exec(s)?.[1]
    const info = /\\"roomInfo\\":\{\\"room\\":\{\\"id_str\\":\\".*?\\",\\"status\\":(.*?),\\"status_str\\":\\".*?\\",\\"title\\":\\"(.*?)\\"/.exec(s)
    const anchorId = /\\"anchor\\":\{\\"id_str\\":\\"(\d+)\\"/.exec(s)?.[1]
    const secUid = /\\"sec_uid\\":\\"(.*?)\\"/.exec(s)?.[1]
    if (userId && roomId && info && anchorId && secUid) {
      return { room_id: roomId, user_id: userId, user_unique_id: userId, anchor_id: anchorId, sec_uid: secUid, ttwid, room_status: info[1], room_title: info[2] }
    }
  }
  if (text.includes('roomId')) {
    const first = (re: RegExp) => re.exec(text)?.[1] ?? ''
    const roomId = first(/\\"roomId\\"\s*:\s*\\"(\d+)\\"/)
    const userId = first(/\\"user_unique_id\\"\s*:\s*\\"(\d+)\\"/)
    const anchorId = first(/\\"anchor\\"\s*:\s*\\\{[^{}]*?\\"id_str\\"\s*:\s*\\"(\d+)\\"/)
    const secUid = first(/\\"sec_uid\\"\s*:\s*\\"([^"]+)\\"/)
    if (roomId && userId) return { room_id: roomId, user_id: userId, user_unique_id: userId, anchor_id: anchorId || userId, sec_uid: secUid, ttwid }
  }
  return null
}

/** 直播 GET 公共参数（上游 _get_live_web）。 */
async function liveWeb(d: Douyin, api: string, endpoint: [string, string | null][], webRid = '', enterFrom = 'link_share'): Promise<DyJson> {
  const h = headers('GET').referer(webRid ? `${LIVE}/${webRid}` : LIVE)
  const p = new Params()
  p.add('aid', '6383').add('app_name', 'douyin_web').add('live_id', '1').add('device_platform', 'web').add('language', 'zh-CN')
  p.add('enter_from', enterFrom).add('cookie_enabled', 'true').add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight)
  p.add('browser_language', 'zh-CN').add('browser_platform', PROFILE.platform).add('browser_name', PROFILE.browserName)
  p.add('browser_version', PROFILE.browserVersion).add('os_name', 'Windows').add('os_version', '10')
  for (const [k, v] of endpoint) if (v != null) p.add(k, v)
  await withMsToken(d, p)
  withABogus(d, p, undefined, LIVE_HOST)
  return getJson(d, LIVE + api, h, p, 30)
}

/** 房间资料（上游 get_live_room_enter）。 */
export function liveRoomEnter(d: Douyin, webRid: string): Promise<DyJson> {
  return liveWeb(d, '/webcast/room/web/enter/', [['web_rid', webRid]], webRid)
}

/** 直播间贡献榜（上游 get_live_contribution_rank）。 */
export function liveRank(d: Douyin, roomId: string, anchorId: string, secAnchorId: string, webRid = ''): Promise<DyJson> {
  return liveWeb(
    d,
    '/webcast/ranklist/audience/',
    [
      ['webcast_sdk_version', '2450'],
      ['room_id', roomId],
      ['anchor_id', anchorId],
      ['sec_anchor_id', secAnchorId],
      ['ignoreToast', 'true'],
      ['rank_type', '30'],
      ['update_scene', null],
    ],
    webRid,
    'web_live',
  )
}

/** 直播间千票榜，页面上的「1000 贡献用户」（上游 get_live_thousand_ticket_rank，接口 ranklist/paygrade_seats）。 */
export function liveThousandRank(d: Douyin, roomId: string, webRid = '', seatsType = '2'): Promise<DyJson> {
  return liveWeb(
    d,
    '/webcast/ranklist/paygrade_seats/',
    [
      ['webcast_sdk_version', '2450'],
      ['room_id', roomId],
      ['seats_type', seatsType],
    ],
    webRid,
    'web_live',
  )
}

/** 弹幕长连前的 im/fetch（上游 get_webcast_detail），返回 protobuf 字节。 */
export async function webcastFetch(d: Douyin, userId: string, roomId: string, url: string): Promise<Uint8Array> {
  const h = headers('FORM').set('origin', LIVE).referer(url)
  await withCsrf(d, h)
  const p = new Params()
  p.add('resp_content_type', 'protobuf').add('did_rule', '3').add('device_id', '').add('app_name', 'douyin_web').add('endpoint', 'live_pc')
  p.add('support_wrds', '1').add('user_unique_id', userId).add('identity', 'audience').add('need_persist_msg_count', '15').add('insert_task_id', '')
  p.add('live_reason', '').add('room_id', roomId).add('version_code', '180800').add('last_rtt', '0').add('live_id', '1').add('aid', '6383')
  p.add('fetch_rule', '1').add('cursor', '').add('internal_ext', '').add('device_platform', 'web').add('cookie_enabled', 'true')
  p.add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight).add('browser_language', 'zh-CN').add('browser_platform', PROFILE.platform)
  p.add('browser_name', 'Mozilla').add('browser_version', APP_VERSION).add('browser_online', 'true').add('tz_name', 'Asia/Shanghai')
  await withMsToken(d, p)
  withABogus(d, p, undefined, LIVE_HOST)
  const res = await d.request({ url: `${LIVE}/webcast/im/fetch/`, headers: h.list(), query: p.pairs() })
  return new Uint8Array(await res.arrayBuffer())
}

function liveBase(p: Params): Params {
  p.add('aid', '6383').add('app_name', 'douyin_web').add('live_id', '1').add('device_platform', 'web').add('language', 'zh-CN')
  return p
}

/** 直播间点赞（上游 diggLiveRoom）。 */
export async function liveLike(d: Douyin, roomId: string, count = '1'): Promise<DyJson> {
  const h = headers('FORM').set('origin', WWW)
  await withCsrf(d, h)
  h.referer(`${LIVE}/${roomId}`)
  const p = liveBase(new Params())
  p.add('enter_from', 'web_live').add('cookie_enabled', 'true').add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight)
  p.add('browser_language', 'zh-CN').add('browser_platform', 'Win32').add('browser_name', PROFILE.browserName).add('browser_version', PROFILE.browserVersion)
  p.add('room_id', roomId).add('count', count)
  await withMsToken(d, p)
  withABogus(d, p, [])
  const res = await d.request({ method: 'POST', url: `${LIVE}/webcast/room/like/`, headers: h.list(), query: p.pairs(), form: [] })
  return riskJson(res)
}

/** 发直播间评论（上游 sendMsgInRoom，GET /webcast/room/chat/）。 */
export async function liveChat(d: Douyin, roomId: string, content: string, webRid = roomId): Promise<DyJson> {
  const api = '/webcast/room/chat/'
  const h = headers('GET').set('Origin', LIVE)
  await d.withBd(h, api, { origin: LIVE })
  await withCsrf(d, h)
  h.referer(`${LIVE}/${webRid}`)
  const p = liveBase(new Params())
  p.add('enter_from', 'link_share').add('cookie_enabled', 'true').add('screen_width', PROFILE.screenWidth).add('screen_height', PROFILE.screenHeight)
  p.add('browser_language', 'zh-CN').add('browser_platform', 'Win32').add('browser_name', PROFILE.browserName).add('browser_version', PROFILE.browserVersion)
  p.add('room_id', roomId).add('content', content).add('type', '0')
  await withMsToken(d, p)
  withABogus(d, p, undefined, LIVE_HOST)
  return getJson(d, LIVE + api, h, p)
}

/** 服务端 ecies 证书（上游 utils/bd_ticket.fetch_server_cert）。 */
export async function serverCert(d: Douyin, aid: number | string, cookieStr: string, origin = WWW, options: { dtrait?: string; csrf?: string; msToken?: string; referer?: string } = {}): Promise<string> {
  const query: [string, string][] = [
    ['aid', String(aid)],
    ['is_from_ttaccountsdk', '1'],
    ['msToken', options.msToken || randomMsToken()],
  ]
  query.push(['a_bogus', d.ab.sign(urlencode(query))])
  const url = `${origin}/passport/ticket_guard/get_client_cert/?${urlencode(query)}`
  const h: [string, string][] = [
    ['x-tt-session-dtrait', options.dtrait ?? ''],
    ['referer', options.referer ?? `${origin}/`],
    ['user-agent', PROFILE.ua],
    ['accept', 'application/json'],
  ]
  const csrf = options.csrf ?? (await csrfToken(d, cookieStr))
  if (csrf) h.push(['x-secsdk-csrf-token', csrf])
  h.push(['content-type', 'application/x-www-form-urlencoded'], ['cookie', cookieStr])
  h.push(['accept-language', 'zh-CN,zh;q=0.9'], ['origin', origin], ['priority', 'u=1, i'], ['sec-fetch-dest', 'empty'], ['sec-fetch-mode', 'cors'], ['sec-fetch-site', 'same-origin'])
  const res = await d.http.request({ method: 'POST', url, headers: h, body: `server_data=1,aid=${aid}`, timeout: 15 })
  const body = JSON.parse(await res.text())
  if (body.message !== 'success') throw new Error(`获取服务端证书失败：${body.message ?? ''}`)
  const cert = body.data?.server_cert
  if (!cert) throw new Error('服务端证书为空')
  return cert
}
