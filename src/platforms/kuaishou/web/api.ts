import { CatbusError } from '../../../core/errors.js'
import type { HttpResponse } from '../../../core/http.js'
import { compactJson, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type Json, type Ks, liveContext } from './client.js'
import * as gql from './gql.js'
import { genLikeToken } from './oracle.js'
import { ACCEPT_AXIOS, ACCEPT_ENCODING, ACCEPT_LANGUAGE, buildHeaders, CP, ID_HOST, LIVE, PASSPORT, UA, WWW } from './profile.js'
import { type Issued, mergeIssued, responseCookies } from './session.js'

/**
 * 上游请求构造，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）：
 * ks_apis/kuaishou_api.py（www）、login_api.py（passport / STS）、live_api.py（直播）、publish_api.py（创作者中心）、
 * utils/ksuploader.py（分片上传）。
 */

// ================================================================ www：KuaishouAPI

/** get_feed_hot：首屏是 0 字节 POST，翻页发字面量 `{}`。 */
export function feedHot(ks: Ks, pcursor = ''): Promise<Json> {
  return ks.wwwPost('/rest/v/feed/hot', pcursor ? {} : null)
}

/** get_video_detail：visionVideoDetail GraphQL。 */
export async function videoDetail(ks: Ks, photoId: string): Promise<Json> {
  const data = await ks.graphql('visionVideoDetail', { photoId, page: 'detail' }, gql.VIDEO_DETAIL, `${WWW}/short-video/${photoId}`, 'www_graphql_detail')
  const detail = data?.data?.visionVideoDetail
  if (!detail || typeof detail !== 'object') throw new CatbusError('UPSTREAM', 'visionVideoDetail 没有返回作品', { detail: { photoId } })
  if (detail.status !== 1) throw new CatbusError('UPSTREAM', `作品不可见或不存在（status=${detail.status}）`, { detail: { photoId, status: detail.status } })
  return detail
}

/** get_short_video_reco：详情页旁路的推荐流。 */
export async function shortVideoReco(ks: Ks, photoId: string): Promise<Json> {
  const data = await ks.graphql('visionShortVideoReco', { page: 'detail', photoId }, gql.SHORT_VIDEO_RECO, `${WWW}/short-video/${photoId}`, 'www_graphql_detail')
  return data?.data?.visionShortVideoReco ?? {}
}

/** get_comment_list：REST 一级评论。 */
export function commentList(ks: Ks, photoId: string, pcursor = ''): Promise<Json> {
  return ks.wwwPost('/rest/v/photo/comment/list', { photoId, pcursor })
}

/** get_comment_list_gql：作品详情页用的 GraphQL 评论（数据在 V2 字段里）。 */
export async function commentListGql(ks: Ks, photoId: string, pcursor = ''): Promise<Json> {
  const data = await ks.graphql('commentListQuery', { photoId, pcursor }, gql.COMMENT_LIST, `${WWW}/short-video/${photoId}`, 'www_graphql_detail')
  return data?.data?.visionCommentList ?? {}
}

/** get_sub_comment_list：“查看更多回复”。 */
export async function subCommentList(ks: Ks, photoId: string, rootCommentId: string, pcursor = ''): Promise<Json> {
  const data = await ks.graphql('visionSubCommentList', { photoId, rootCommentId, pcursor }, gql.SUB_COMMENT_LIST, `${WWW}/short-video/${photoId}`, 'www_graphql_detail')
  return data?.data?.visionSubCommentList ?? {}
}

/** get_profile：当前登录用户资料，顺带缓存本人 eid。 */
export async function profile(ks: Ks, referer?: string): Promise<Json> {
  const result = await ks.wwwGet('/rest/v/profile/get', { referer })
  const eid = String(result?.eid ?? result?.userDefineId ?? '')
  if (eid) ks.s.selfEid = eid
  return result
}

/** get_profile_feed：指定用户的作品，body 键名是 user_id；请求头多一个空的 profile_referer。 */
export function profileFeed(ks: Ks, eid: string, pcursor = ''): Promise<Json> {
  return ks.wwwPost(
    '/rest/v/profile/feed',
    { user_id: eid, pcursor, page: 'profile' },
    { referer: `https://www.kuaishou.com/profile/${eid}`, extraHeaders: [['profile_referer', '']] },
  )
}

const searchReferer = (keyword: string) => `https://www.kuaishou.com/search/video?searchKey=${quote(keyword, '')}`

/** search_feed：首屏带 page / webPageArea，翻页带首屏返回的 searchSessionId。 */
export function searchFeed(ks: Ks, keyword: string, pcursor = '', sessionId = ''): Promise<Json> {
  const body = pcursor ? { keyword, pcursor, searchSessionId: sessionId } : { keyword, page: 'search', webPageArea: '', pcursor: '' }
  return ks.wwwPost('/rest/v/search/feed', body, { referer: searchReferer(keyword) })
}

/** search_user。 */
export function searchUser(ks: Ks, keyword: string, pcursor = '', sessionId = ''): Promise<Json> {
  return ks.wwwPost('/rest/v/search/user', { keyword, pcursor, searchSessionId: sessionId }, { referer: searchReferer(keyword) })
}

/** get_relation：关注（ftype=1）/ 粉丝（2），只有本人；Referer 是本人主页。 */
export function relation(ks: Ks, ftype: 1 | 2, pcursor = ''): Promise<Json> {
  return ks.wwwPost(
    '/rest/v/relation/fol',
    { pcursor, ftype },
    { referer: `${WWW}/profile/${ks.s.selfEid}`, cookieProfile: ftype === 1 ? 'www_relogin_relation_following' : 'www_relogin_relation_fans' },
  )
}

/** get_liked_list：我的喜欢。 */
export function likedList(ks: Ks, pcursor = '', referer?: string): Promise<Json> {
  return ks.wwwPost('/rest/v/feed/liked', { pcursor, page: 'profile' }, { referer })
}

/** get_collect_list：收藏，body 里是 eid（驼峰 userId）。 */
export function collectList(ks: Ks, eid: string, pcursor = ''): Promise<Json> {
  return ks.wwwPost('/rest/v/collect/list', { userId: eid, pcursor, page: 'collect' }, { referer: eid ? `https://www.kuaishou.com/profile/${eid}` : undefined })
}

/** get_playback_list：用户的直播回放。 */
export function playbackList(ks: Ks, eid: string, pcursor = ''): Promise<Json> {
  return ks.wwwPost('/rest/v/live/playBack/list', { userId: eid, pcursor }, { referer: `https://www.kuaishou.com/profile/${eid}` })
}

const MY_FOLLOW = 'https://www.kuaishou.com/myFollow'

/** like_data：关注页的 likeDataQuery，token 由抓包 bundle 的引擎按 {did, ts, uri} 生成。 */
export async function likeData(ks: Ks, page = 'follow'): Promise<Json> {
  const st = rand.now()
  const token = genLikeToken(ks.s.did, st, '/rest/v/feed/myfollow')
  const data = await ks.graphql('likeDataQuery', { token, st, page }, gql.LIKE_DATA, MY_FOLLOW)
  return data?.data?.likeData ?? {}
}

/** vision_profile_reduced：用户资料（不带 userId 时是当前用户）。 */
export async function profileReduced(ks: Ks, userId?: string): Promise<Json> {
  const data = await ks.graphql('visionProfileReduced', userId == null ? {} : { userId }, gql.VISION_PROFILE_REDUCED, MY_FOLLOW)
  return data?.data?.visionProfileReduced ?? {}
}

/** get_user_info：userInfoQuery，登录用户的轻量信息（直接给 eid）。 */
export async function userInfo(ks: Ks): Promise<Json> {
  const data = await ks.graphql('userInfoQuery', {}, gql.USER_INFO, MY_FOLLOW)
  return data?.data?.userInfo ?? {}
}

// ================================================================ 登录：KuaishouLoginAPI

export const SID_LIVE = 'kuaishou.live.web'
export const SID_WEB_API = 'kuaishou.web.api'
export const SID_WWW = 'kuaishou.server.webday7'
export const SID_CP = 'kuaishou.web.cp.api'
const CHANNEL_PC = 'PC_PAGE'
const CHANNEL_UNKNOWN = 'UNKNOWN'
const SITE_BY_SID: Record<string, string> = { [SID_WWW]: WWW, [SID_CP]: CP, [SID_LIVE]: LIVE }
const SESSION_KEYS = ['passToken', 'userId', 'ssecurity', 'bUserId']

export const channelFor = (sid: string) => (sid === SID_WWW ? CHANNEL_UNKNOWN : CHANNEL_PC)

/** 扫码流程实抓的页面来源：www sid 在 www 页面，直播 / 手机号在 passport 页面。 */
function qrPageOrigin(sid: string, channel: string): string {
  if (sid === SID_WWW || (!sid && channel === CHANNEL_UNKNOWN)) return WWW
  return PASSPORT
}

/** 登录响应的票据：Set-Cookie，加上正文里的 passToken / userId / *_st / *.at。 */
function sessionCookies(data: Json, res: HttpResponse): Issued {
  const cookies = responseCookies(res)
  for (const key of SESSION_KEYS) if (data?.[key]) mergeIssued(cookies, [[key, String(data[key])]])
  for (const [key, value] of Object.entries(data ?? {})) {
    if (typeof value === 'string' && value && (key.endsWith('_st') || key.endsWith('.at'))) mergeIssued(cookies, [[key, value]])
  }
  return cookies
}

export async function qrStart(ks: Ks, sid: string, channel = channelFor(sid)): Promise<Json> {
  const [data] = await ks.loginForm(
    '/rest/c/infra/ks/qr/start',
    [
      ['sid', sid],
      ['channelType', channel],
      ['isWebSig4', 'true'],
    ],
    qrPageOrigin(sid, channel),
  )
  return data
}

export async function qrScanResult(ks: Ks, token: string, signature: string, channel: string): Promise<Json> {
  const [data] = await ks.loginForm(
    '/rest/c/infra/ks/qr/scanResult',
    [
      ['qrLoginToken', token],
      ['qrLoginSignature', signature],
      ['channelType', channel],
      ['isWebSig4', 'true'],
    ],
    qrPageOrigin('', channel),
    70,
  )
  return data
}

export async function qrAcceptResult(ks: Ks, token: string, signature: string, sid: string, channel: string): Promise<Json> {
  const [data] = await ks.loginForm(
    '/rest/c/infra/ks/qr/acceptResult',
    [
      ['qrLoginToken', token],
      ['qrLoginSignature', signature],
      ['sid', sid],
      ['channelType', channel],
      ['isWebSig4', 'true'],
    ],
    qrPageOrigin(sid, channel),
    70,
  )
  return data
}

/** qr_callback：用 qrToken 换登录态，票据在正文和 Set-Cookie 里。 */
export async function qrCallback(ks: Ks, qrToken: string, sid: string, channel: string): Promise<[Json, Issued]> {
  const [data, res] = await ks.loginForm(
    '/pass/kuaishou/login/qr/callback',
    [
      ['qrToken', qrToken],
      ['sid', sid],
      ['channelType', channel],
      ['isWebSig4', 'true'],
    ],
    qrPageOrigin(sid, channel),
  )
  return [data, sessionCookies(data, res)]
}

/** request_mobile_code：手机号登录短信（type=53 即 LOGIN）。 */
export async function requestMobileCode(ks: Ks, phone: string, countryCode = '+86'): Promise<Json> {
  const [data] = await ks.loginForm(
    '/pass/kuaishou/sms/requestMobileCode',
    [
      ['channelType', CHANNEL_PC],
      ['countryCode', countryCode],
      ['isWebSig4', 'true'],
      ['phone', phone],
      ['sid', SID_WEB_API],
      ['type', '53'],
    ],
    PASSPORT,
    30,
  )
  return data
}

/** login_by_mobile_code 的登录请求本身。 */
export async function mobileCodeLogin(ks: Ks, phone: string, smsCode: string, countryCode = '+86'): Promise<[Json, Issued]> {
  const [data, res] = await ks.loginForm(
    '/pass/kuaishou/login/mobileCode',
    [
      ['channelType', CHANNEL_PC],
      ['countryCode', countryCode],
      ['createId', 'true'],
      ['isWebSig4', 'true'],
      ['phone', phone],
      ['setCookie', 'true'],
      ['sid', SID_WEB_API],
      ['smsCode', smsCode],
    ],
    PASSPORT,
  )
  return [data, sessionCookies(data, res)]
}

/** STS 两跳是 iframe 导航，不是 XHR。 */
function navHeaders(referer: string): [string, string][] {
  return [
    ['user-agent', UA],
    ['upgrade-insecure-requests', '1'],
    ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
    ['sec-fetch-site', 'same-site'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-dest', 'iframe'],
    ['referer', referer],
    ['accept-encoding', ACCEPT_ENCODING],
    ['accept-language', 'zh-CN,zh;q=0.9'],
  ]
}

/**
 * sts_login：用 passToken 换站点域名下的 `<sid>_st` / `<sid>_ph`（两跳 302，第二跳的 authToken 由服务端补上）。
 */
export async function stsLogin(ks: Ks, sid: string, site = SITE_BY_SID[sid]!): Promise<Issued> {
  ks.s.useSite(site)
  const ssoId = `SSO_${rand.now()}`
  const result = (ok: string) => `${PASSPORT}/pc/account/passToken/result?successful=${ok}&id=${ssoId}&for=passTokenSuccess`
  const stsUrl = `${site}/rest/infra/sts?followUrl=${quote(result('true'), '')}&failUrl=${quote(result('false'), '')}&setRootDomain=${sid === SID_CP ? 'true' : 'false'}`
  const loginPage = `${PASSPORT}/pc/account/passToken/result?successful=false&id=${ssoId}&for=pullTokenFail`
  const url = `${ID_HOST}/pass/kuaishou/login/passToken?callback=${quote(stsUrl, '')}&__loginPage=${quote(loginPage, '')}&sid=${quote(sid, '')}`
  const headers = navHeaders(`${site}/`)
  const first = await ks.send({ method: 'GET', url, headers, cookie: await ks.s.currentLine(), redirect: 'manual' })
  const issued = responseCookies(first)
  const location = first.headers.get('location')
  if (!location) {
    ks.s.update(issued)
    return issued
  }
  const second = await ks.send({ method: 'GET', url: location, headers, cookie: await ks.s.currentLine(), redirect: 'manual' })
  mergeIssued(issued, responseCookies(second))
  ks.s.update(issued)
  return issued
}

/** bootstrap_document：加载站点文档，接收页面级 Set-Cookie（如 ktrace-context）。 */
export async function bootstrapDocument(ks: Ks, site: string, path: string): Promise<Issued> {
  const h = buildHeaders('DOC')
  h.set('sec-fetch-site', 'none')
  const res = await ks.send({ method: 'GET', url: `${site}${path}`, headers: h.get(), cookie: await ks.s.currentLine() })
  const issued = responseCookies(res)
  ks.s.update(issued)
  return issued
}

/** 直播页换票时的 Cookie 线序：没有创作者中心票据时是 `_direct` 那一套。 */
function passTokenProfile(ks: Ks, referer: string): string {
  const base = liveContext(referer) === 'room' ? 'live_pass_token_room' : 'live_pass_token_home'
  return ks.s.cookies.get('kuaishou.web.cp.api_st') ? base : `${base}_direct`
}

/** get_cdns：passToken 之前的预检，也是一次直播页导航的开始（新的 Sentry trace）。 */
export async function getCdns(ks: Ks, referer: string): Promise<Json> {
  ks.s.beginLiveTransaction(referer)
  const cookie = await ks.s.cookieHeader(passTokenProfile(ks, referer))
  const h = buildHeaders('POST', 'login_pass_token')
  h.set('content-type', 'application/json')
  h.set('referer', referer)
  h.set('origin', LIVE)
  h.set('sec-fetch-site', 'same-site')
  const res = await ks.send({ method: 'POST', url: `${ID_HOST}/pass/kuaishou/getCdns`, headers: h.get(), cookie, body: compactJson({ sid: SID_LIVE, did: ks.s.did }) })
  return res.json().catch(() => ({}))
}

/** pass_token_login：用 passToken 给直播站铸一份新鲜的 `<sid>_st` / `<sid>.at`。 */
export async function passTokenLogin(ks: Ks, referer = `${LIVE}/`): Promise<[Json, Issued]> {
  await getCdns(ks, referer)
  const h = buildHeaders('POST', 'login_pass_token')
  h.set('referer', referer)
  h.set('origin', LIVE)
  h.set('sec-fetch-site', 'same-site')
  const cookie = await ks.s.cookieHeader(passTokenProfile(ks, referer))
  const body = `sid=${quote(SID_LIVE, '')}&channelType=${quote(CHANNEL_UNKNOWN, '')}&encryptHeaders=`
  const res = await ks.send({ method: 'POST', url: `${ID_HOST}/pass/kuaishou/login/passToken`, headers: h.get(), cookie, body })
  const data = await res
    .clone()
    .json()
    .catch(() => ({}))
  return [data, sessionCookies(data, res)]
}

/** user_login_session：直播站 userLogin(authToken)，真正可用的 live web_st / web_ph 在 Set-Cookie 里。 */
export async function userLoginSession(ks: Ks, authToken: string, referer = `${LIVE}/`): Promise<[boolean, Issued]> {
  const context = liveContext(referer)
  const hasPh = Boolean(ks.s.cookies.get('kuaishou.live.web_ph'))
  let profile = context === 'room' ? ks.roomProfile('login') : context === 'home' ? ks.homeProfile('login') : `live_${context}_login`
  if (context === 'room' && !hasPh) profile = ks.s.liveOnly ? 'live_room_current_login_bootstrap' : 'live_room_login_bootstrap'
  if (context === 'home' && !hasPh) profile = ks.s.liveOnly ? ks.homeProfile('login_bootstrap') : 'live_home_login_bootstrap'
  const [data, res] = await ks.live('POST', '/live_api/baseuser/userLogin', {
    body: { userLoginInfo: { authToken, sid: SID_LIVE } },
    referer,
    sentry: true,
    cookieProfile: profile,
  })
  const ok = data?.data?.result === 1
  if (ok) {
    if (context === 'room' && ks.s.liveOnly) ks.s.advanceLive(context, 'authenticated')
    else ks.s.advanceLive(context, context === 'home' ? 'authenticated_1' : 'login')
  }
  return [ok, responseCookies(res)]
}

/** refresh_site_session：passToken 换票 + userLogin，重建直播站会话。 */
export async function refreshLiveSession(ks: Ks, referer = `${LIVE}/`): Promise<boolean> {
  const [data, cookies] = await passTokenLogin(ks, referer)
  if (data?.result !== 1) return false
  ks.s.update(cookies)
  const token = data?.[`${SID_LIVE}.at`] ?? cookies.find(([k]) => k === `${SID_LIVE}.at`)?.[1] ?? ''
  if (!token) return false
  const [ok, issued] = await userLoginSession(ks, token, referer)
  if (!ok) return false
  ks.s.update(issued)
  return true
}

// ================================================================ 直播：KuaishouLiveAPI

export const roomReferer = (eid: string) => `${LIVE}/u/${eid}`

export async function homeList(ks: Ks): Promise<Json> {
  const [data] = await ks.live('GET', '/live_api/home/list', { referer: `${LIVE}/`, cookieProfile: ks.homeProfile('initial') })
  return data
}

export async function categoryClassify(ks: Ks, referer = `${LIVE}/`): Promise<Json> {
  const [data] = await ks.live('GET', '/live_api/category/classify', {
    query: [
      ['type', 4],
      ['source', 2],
      ['page', 1],
      ['pageSize', 20],
    ],
    referer,
  })
  return data
}

/**
 * gift_list：首屏（只有 liveStreamId，带 Sentry，当前阶段的 Cookie 线序）；
 * 传 sortType 时是点击“更多礼物”（`liveStreamId&sortType=0`，不带 Sentry，authenticated 线序）。
 */
export async function giftList(ks: Ks, liveStreamId: string, eid: string, sortType?: number): Promise<Json> {
  const more = sortType != null
  const query: [string, unknown][] = [['liveStreamId', liveStreamId]]
  if (more) query.push(['sortType', sortType])
  const [data] = await ks.live('GET', '/live_api/emoji/gift-list', {
    query,
    referer: roomReferer(eid),
    sentry: !more,
    cookieProfile: more ? ks.roomProfile('authenticated') : undefined,
  })
  return data
}

/** emoji_all_gifts：房间首屏的完整礼物字典（`/emoji/allgifts`，带 Sentry，房间资源的 Cookie 线序）。 */
export async function emojiAllGifts(ks: Ks, eid: string): Promise<Json> {
  const [data] = await ks.live('GET', '/live_api/emoji/allgifts', { referer: roomReferer(eid), sentry: true, cookieProfile: 'live_room_assets_initial' })
  return data
}

export async function websocketInfo(ks: Ks, liveStreamId: string, eid: string): Promise<Json> {
  const [data] = await ks.live('GET', '/live_api/liveroom/websocketinfo', {
    query: [['liveStreamId', liveStreamId]],
    referer: roomReferer(eid),
    cookieProfile: ks.roomProfile('authenticated'),
  })
  return data
}

// ================================================================ 创作者中心：KuaishouPublishAPI

const CREATOR_AXIOS = { style: 'cp_creator_axios', withKww: false, creator: true } as const

export async function authorityAccountCurrent(ks: Ks): Promise<Json> {
  const result = await ks.cpPost('/rest/v2/creator/pc/authority/account/current', {}, { style: 'cp_creator_json', withKww: false, creator: true })
  if (result?.result === 1 && result?.data?.ab?.enablePublish === true) ks.cpAuthority = result
  return result
}

/** require_publish_authority：上传之前复现发布页的账号权限门禁。 */
export async function requirePublishAuthority(ks: Ks): Promise<Json> {
  if (ks.cpAuthority) return ks.cpAuthority
  const result = await authorityAccountCurrent(ks)
  if (result?.result === 119120) throw new CatbusError('UPSTREAM', '创作者中心：账号异常，暂时无法发布（result=119120）', { detail: { result: 119120 } })
  ks.check(result, '创作者中心')
  if (result?.data?.ab?.enablePublish !== true) throw new CatbusError('UPSTREAM', '创作者中心：这个账号当前没有发布权限', { detail: { result: result?.result } })
  return result
}

export function notificationUnreadCount(ks: Ks): Promise<Json> {
  return ks.cpPost('/rest/v2/creator/pc/notification/unReadCountV3', {}, CREATOR_AXIOS)
}

export interface PhotoListQuery {
  queryType: string
  cursor: number
  startTime: number
  endTime: number
  limit: number
  timeRangeType: number
  keyword: string
}

/** video_photo_list：作品管理页的作品列表（字段顺序固定）。 */
export function videoPhotoList(ks: Ks, q: PhotoListQuery): Promise<Json> {
  return ks.cpPost(
    '/rest/cp/works/v2/video/pc/photo/list',
    {
      queryType: q.queryType,
      cursor: q.cursor,
      startTime: q.startTime,
      endTime: q.endTime,
      limit: q.limit,
      timeRangeType: q.timeRangeType,
      keyword: q.keyword,
    },
    CREATOR_AXIOS,
  )
}

export const UPLOAD_TYPE_VIDEO = 1
export const UPLOAD_TYPE_ATLAS = 10

export function videoUploadPre(ks: Ks): Promise<Json> {
  return ks.cpPost('/rest/cp/works/v2/video/pc/upload/pre', { uploadType: UPLOAD_TYPE_VIDEO })
}

export async function videoUploadFinish(ks: Ks, token: string, fileName: string, fileType: string, fileLength: number): Promise<Json> {
  const result = await ks.cpPost('/rest/cp/works/v2/video/pc/upload/finish', { token, fileName, fileType, fileLength })
  if (result?.result === 1) ks.cpLastVideoFinish = { ...(result.data ?? {}) }
  return result
}

/** video_cover_report：submit 之前上报封面，bizKey 就是 upload/finish 返回的 coverKey。 */
export function videoCoverReport(ks: Ks, coverKey: string): Promise<Json> {
  return ks.cpPost('/rest/cp/works/v2/common/pc/report', { bizKey: coverKey, bizType: 1, data: '{}' })
}

export const PHOTO_STATUS = { public: 1, private: 2, friends: 4 } as const

/** publish_video 的当前 51 键 submit（走 sig4）。 */
export function videoSubmitBody(o: { fileId: number; coverKey: string; mediaId: string; videoDuration: number; caption: string; photoStatus: number; publishTime: number }) {
  return {
    fileId: o.fileId,
    coverKey: o.coverKey,
    coverTimeStamp: 0,
    caption: o.caption.replace(/(\S)#/g, '$1 #'),
    photoStatus: o.photoStatus,
    coverType: 1,
    coverTitle: '',
    photoType: 0,
    collectionId: 0,
    publishTime: o.publishTime,
    longitude: '',
    latitude: '',
    poiId: 0,
    notifyResult: 0,
    domain: '',
    secondDomain: '',
    coverCropped: false,
    pkCoverKey: '',
    profileCoverKey: '',
    downloadType: 1,
    disableNearbyShow: false,
    allowSameFrame: true,
    movieId: '',
    openPrePreview: false,
    declareInfo: { source: 0, platform: 0, time: 0, location: '', sourceId: 0, sourceName: '', statementId: 0 },
    activityIds: [],
    riseQuality: false,
    chapters: null,
    videoComposite: null,
    useAiCaptionCover: false,
    useAiCaption: false,
    isUseIdealTime: false,
    useAiCover: false,
    kceInfo: '',
    coverSize: '',
    pkCoverTimeStamp: -1,
    pkCoverType: 1,
    pkCoverSize: '',
    innerChannel: 0,
    mediaId: o.mediaId,
    videoInfoMeta: '',
    triggerH265: false,
    recTagIdList: [],
    onvideoDuration: 0,
    disallowRecreation: false,
    previewUrlErrorMessage: '',
    coPublishUser: [],
    coPublishRole: 0,
    extraInfo: '',
    videoDuration: o.videoDuration,
  }
}

/** publish_video：先上报封面（必须 result=1），紧接着 submit。 */
export async function publishVideo(ks: Ks, o: Parameters<typeof videoSubmitBody>[0]): Promise<Json> {
  const report = await videoCoverReport(ks, o.coverKey)
  if (report?.result !== 1) throw new CatbusError('UPSTREAM', '封面上报没有通过，已停止提交', { detail: { result: report?.result, message: report?.message } })
  return ks.cpPost('/rest/cp/works/v2/video/pc/submit', videoSubmitBody(o))
}

export function atlasRealizeEntrance(ks: Ks): Promise<Json> {
  return ks.cpPost('/rest/cp/works/v2/video/pc/realize/entrance', { movieId: '' }, { upload: 'atlas' })
}

/** creator_activity_list 的两套字段顺序（initial / post_resume）。 */
export function activityList(ks: Ks, phase: 'initial' | 'post_resume', upload: 'video' | 'atlas'): Promise<Json> {
  const body =
    phase === 'initial'
      ? { page: 1, count: 20, category: 0, rewardType: 0, sortType: 0, pageSource: 2 }
      : { page: 1, count: 20, category: 0, sortType: 0, rewardType: 0, pageSource: 2 }
  return ks.cpPost('/rest/v2/creator/activity/pc/list', body, { upload })
}

export const activityTab = (ks: Ks, upload: 'video' | 'atlas') => ks.cpPost('/rest/v2/creator/activity/pc/tab', {}, { upload })
export const activityFilter = (ks: Ks, upload: 'video' | 'atlas') => ks.cpPost('/rest/v2/creator/activity/pc/filter', {}, { upload })
export const collectionCanAddAtlas = (ks: Ks) => ks.cpPost('/rest/cp/works/v2/collection/canAddAtlas')

/** atlas_upload_pre：每张图各调一次；第一张不带 atlasId / fileId（JSON.stringify 丢掉 undefined）。 */
export function atlasUploadPre(ks: Ks, mime: string, atlasId?: unknown, fileId?: unknown): Promise<Json> {
  const body: Record<string, unknown> = {}
  if (atlasId != null) body.atlasId = atlasId
  if (fileId != null) body.fileId = fileId
  body.uploadType = UPLOAD_TYPE_ATLAS
  body.pictureCount = 1
  body.fileExtendNames = compactJson([{ fileExtendName: mime }])
  return ks.cpPost('/rest/cp/works/atlas/pc/upload/pre', body)
}

export function atlasUploadSingleFinish(ks: Ks, fileId: unknown, atlasId: unknown, blobKey: string): Promise<Json> {
  return ks.cpPost('/rest/cp/works/atlas/pc/upload/single/finish', { fileId, atlasId, blobKey })
}

export function atlasSnapshotSave(ks: Ks, fileId: unknown, atlasId: unknown, caption = '', photoStatus = 1, publishTime = 0): Promise<Json> {
  return ks.cpPost('/rest/cp/works/atlas/pc/publishInfo/snapshot/save', {
    fileId,
    atlasId,
    caption: caption.replace(/(\S)#/g, '$1 #'),
    photoStatus,
    longitude: '',
    latitude: '',
    declareInfo: {},
    activityIds: [],
    publishTime,
    coPublishUser: [],
  })
}

export function atlasUploadFinish(ks: Ks, fileId: unknown, atlasId: unknown, blobKeys: string[]): Promise<Json> {
  return ks.cpPost('/rest/cp/works/atlas/pc/upload/finish', { fileId, atlasId, blobKey: blobKeys }, { upload: 'atlas' })
}

export function publishAtlas(ks: Ks, o: { caption: string; fileId: unknown; atlasId: unknown; photoStatus: number; publishTime: number; coverType?: number }): Promise<Json> {
  return ks.cpPost(
    '/rest/cp/works/atlas/pc/publish/submit',
    {
      fileId: o.fileId,
      atlasId: o.atlasId,
      caption: o.caption.replace(/(\S)#/g, '$1 #'),
      photoStatus: o.photoStatus,
      longitude: '',
      latitude: '',
      declareInfo: {},
      activityIds: [],
      publishTime: o.publishTime,
      coPublishUser: [],
      useAiCaption: false,
      coverType: o.coverType ?? 1,
    },
    { upload: 'atlas' },
  )
}

// ================================================================ 分片上传：ksuploader

export const CHUNK_SIZE = 4 * 1024 * 1024
const UPLOAD_ACCEPT = ACCEPT_AXIOS
const CP_ROOT = `${CP}/`

function uploadHeaders(path: string, contentRange = ''): [string, string][] {
  if (path === '/api/upload/fragment') {
    return [
      ['referer', CP_ROOT],
      ['user-agent', UA],
      ['accept', UPLOAD_ACCEPT],
      ['content-type', 'application/octet-stream'],
      ['content-range', contentRange],
      ['accept-encoding', ACCEPT_ENCODING],
      ['accept-language', ACCEPT_LANGUAGE],
      ['origin', CP],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'cross-site'],
    ]
  }
  return [
    ['user-agent', UA],
    ['accept', UPLOAD_ACCEPT],
    ['referer', CP_ROOT],
    ['accept-encoding', ACCEPT_ENCODING],
    ['accept-language', ACCEPT_LANGUAGE],
    ['origin', CP],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'cross-site'],
  ]
}

/** endPoints 可能是裸域名，统一成 https 前缀、无尾斜杠。 */
export function uploadBase(endpoint: string): string {
  const e = endpoint.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(e) ? e : `https://${e}`
}

async function uploadCall(ks: Ks, method: string, base: string, path: string, query: [string, string | number][], body?: Uint8Array | string, contentRange?: string): Promise<Json> {
  const res = await ks.http.request({ method, url: `${base}${path}`, query, headers: uploadHeaders(path, contentRange), body, cookies: false, timeout: 120 })
  if (res.status >= 400) throw new CatbusError('UPSTREAM', `上传失败：HTTP ${res.status}`, { detail: { status: res.status, path } })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

export const uploadResume = (ks: Ks, base: string, token: string) => uploadCall(ks, 'GET', base, '/api/upload/resume', [['upload_token', token]])

export function uploadFragment(ks: Ks, base: string, token: string, index: number, chunk: Uint8Array, start: number, total: number): Promise<Json> {
  const range = `bytes ${start}-${start + chunk.length - 1}/${total}`
  return uploadCall(
    ks,
    'POST',
    base,
    '/api/upload/fragment',
    [
      ['upload_token', token],
      ['fragment_id', String(index)],
    ],
    chunk,
    range,
  )
}

export const uploadComplete = (ks: Ks, base: string, token: string, count: number) =>
  uploadCall(
    ks,
    'POST',
    base,
    '/api/upload/complete',
    [
      ['fragment_count', count],
      ['upload_token', token],
    ],
    '',
  )
