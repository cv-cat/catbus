import { CatbusError } from '../../../core/errors.js'
import { compactJson, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { hydration, type TikTok } from './client.js'
import { ORIGIN, Params, type QueryValue, SHOP } from './profile.js'
import { encodeXBogus } from './sign.js'
import { shopSign } from './jsrun.js'

/**
 * 上游 api/tiktok_web.py 的请求构造，一个函数对应一个上游方法，query 字段与顺序照抄（对拍测试逐字节比较）。
 * 返回平台原始 JSON。
 */

type Slot = [string, QueryValue][]
type Slots = Partial<
  Record<
    | 'before_aid'
    | 'after_aid'
    | 'before_app_language'
    | 'after_app_name'
    | 'after_browser_online'
    | 'after_browser_version'
    | 'after_channel'
    | 'after_cookie'
    | 'after_data_collection'
    | 'after_device_platform'
    | 'after_focus'
    | 'after_from_page'
    | 'after_history'
    | 'after_fullscreen'
    | 'after_is_page_visible'
    | 'after_os'
    | 'after_priority_region'
    | 'after_region'
    | 'after_root_referer'
    | 'after_screen'
    | 'after_tz'
    | 'after_verify_fp'
    | 'after_webcast_language',
    Slot
  >
>

const bversion = (t: TikTok) => t.ua.split('Mozilla/').slice(1).join('Mozilla/') || t.ua

/** 上游 _current_params：5.3.x 的 query，端点字段放在固定的槽位。 */
export function currentParams(
  t: TikTok,
  o: {
    referer: string
    fromPage?: string
    rootReferer?: string
    queryReferer?: string
    slots?: Slots
    aid?: string
    devicePlatform?: string
    appLanguage?: string
    historyLen?: string
    includeFromPage?: boolean
    includeUserIsLogin?: boolean
    includeOdinId?: boolean
  },
): Params {
  const slots = o.slots ?? {}
  const queryRef = o.queryReferer ?? o.referer
  const root = o.rootReferer ?? queryRef
  const values: [string, QueryValue][] = []
  const add = (k: string, v: QueryValue) => {
    if (v !== undefined && v !== null) values.push([k, v])
  }
  const slot = (name: keyof Slots) => (slots[name] ?? []).forEach(([k, v]) => add(k, v))
  add('WebIdLastTime', t.webIdLastTime)
  slot('before_aid')
  add('aid', o.aid ?? '1988')
  slot('after_aid')
  slot('before_app_language')
  add('app_language', o.appLanguage ?? 'zh-Hans')
  add('app_name', 'tiktok_web')
  slot('after_app_name')
  add('browser_language', 'zh-CN')
  add('browser_name', 'Mozilla')
  add('browser_online', 'true')
  slot('after_browser_online')
  add('browser_platform', 'Win32')
  add('browser_version', bversion(t))
  slot('after_browser_version')
  add('channel', 'tiktok_web')
  slot('after_channel')
  add('cookie_enabled', 'true')
  slot('after_cookie')
  add('data_collection_enabled', 'true')
  slot('after_data_collection')
  add('device_id', t.deviceId)
  add('device_platform', o.devicePlatform ?? 'web_pc')
  slot('after_device_platform')
  add('focus_state', 'true')
  slot('after_focus')
  if (o.includeFromPage ?? true) add('from_page', o.fromPage ?? 'user')
  slot('after_from_page')
  add('history_len', o.historyLen ?? '2')
  slot('after_history')
  add('is_fullscreen', 'false')
  slot('after_fullscreen')
  add('is_page_visible', 'true')
  slot('after_is_page_visible')
  if (o.includeOdinId ?? true) add('odinId', t.odinId)
  add('os', 'windows')
  slot('after_os')
  add('priority_region', t.priorityRegion)
  slot('after_priority_region')
  add('referer', queryRef)
  add('region', t.region)
  slot('after_region')
  add('root_referer', root)
  slot('after_root_referer')
  add('screen_height', '1440')
  add('screen_width', '2560')
  slot('after_screen')
  add('tz_name', 'Asia/Shanghai')
  slot('after_tz')
  if (o.includeUserIsLogin ?? true) add('user_is_login', t.loggedIn ? 'true' : 'false')
  add('verifyFp', t.verifyFp)
  slot('after_verify_fp')
  add('webcast_language', 'zh-Hans')
  slot('after_webcast_language')
  return new Params(values)
}

/** 上游 Params.common：较早一代端点的 query 顺序。OrderedDict 的重复键保留第一次出现的位置。 */
export function commonParams(
  t: TikTok,
  o: {
    referer: string
    fromPage?: string
    historyLen?: string
    rootReferer?: string
    queryReferer?: string
    includeLanguage?: boolean
    includeFromPage?: boolean
    includeUserIsLogin?: boolean
    includeRootReferer?: boolean
    afterAppName?: Slot
    early?: Slot
    beforeTz?: Slot
    late?: Slot
    afterAid?: Slot
    afterCookie?: Slot
    afterDevicePlatform?: Slot
    afterIsPageVisible?: Slot
    afterOs?: Slot
    afterRegion?: Slot
    afterRootReferer?: Slot
  },
): Params {
  const queryRef = o.queryReferer ?? o.referer
  const root = o.rootReferer ?? queryRef
  const values = new Map<string, QueryValue>()
  const put = (k: string, v: QueryValue) => values.set(k, v == null ? v : String(v))
  const emit = (s?: Slot) => (s ?? []).forEach(([k, v]) => put(k, v))
  put('WebIdLastTime', t.webIdLastTime)
  put('aid', '1988')
  emit(o.afterAid)
  put('app_language', 'zh-Hans')
  put('app_name', 'tiktok_web')
  emit(o.afterAppName)
  put('browser_language', 'zh-CN')
  put('browser_name', 'Mozilla')
  put('browser_online', 'true')
  put('browser_platform', 'Win32')
  put('browser_version', bversion(t))
  put('channel', 'tiktok_web')
  put('cookie_enabled', 'true')
  emit(o.afterCookie)
  emit(o.early)
  put('data_collection_enabled', 'true')
  put('device_id', t.deviceId)
  put('device_platform', 'web_pc')
  emit(o.afterDevicePlatform)
  put('focus_state', 'true')
  if (o.includeFromPage) put('from_page', o.fromPage ?? '')
  put('history_len', o.historyLen ?? '2')
  put('is_fullscreen', 'false')
  put('is_page_visible', 'true')
  emit(o.afterIsPageVisible)
  put('language', 'zh-Hans')
  put('odinId', t.odinId)
  put('os', 'windows')
  emit(o.afterOs)
  put('priority_region', t.priorityRegion)
  put('referer', queryRef)
  put('region', t.region)
  emit(o.afterRegion)
  if (o.includeRootReferer ?? true) put('root_referer', root)
  emit(o.afterRootReferer)
  put('screen_height', '1440')
  put('screen_width', '2560')
  emit(o.beforeTz)
  put('tz_name', 'Asia/Shanghai')
  if (o.includeUserIsLogin) put('user_is_login', t.loggedIn ? 'true' : 'false')
  put('verifyFp', t.verifyFp)
  emit(o.late)
  put('webcast_language', 'zh-Hans')
  if (o.includeLanguage === false) values.delete('language')
  return new Params(values)
}

const AXIOS_ACCEPT = 'application/json, text/plain, */*'
const PROFILE_LIST_ORDER = [
  'x-cthulhu-csrf', 'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'tt-csrf-token', 'user-agent', 'content-type', 'accept',
  'accept-encoding', 'accept-language', 'content-length', 'cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]

const profileRef = (secUid: string) => `${ORIGIN}/@${secUid}?lang=zh-Hans`
const DEFAULT_REF = `${ORIGIN}/@tiktok?lang=zh-Hans`

// ================================================================ 用户与作品

export function userPosted(t: TikTok, secUid: string, cursor = '0', count = '24', referer?: string) {
  const ref = referer ?? profileRef(secUid)
  const p = commonParams(t, {
    referer: ref,
    rootReferer: ref,
    historyLen: '2',
    includeFromPage: false,
    includeUserIsLogin: true,
    early: [
      ['count', count],
      ['coverFormat', '2'],
      ['cursor', cursor],
    ],
    beforeTz: [['secUid', secUid]],
    late: [['video_encoding', 'dash']],
  })
  return t.requestJson({ method: 'GET', path: '/api/post/item_list/', params: p, referer: ref })
}

export function recommendFeed(t: TikTok, o: { count?: string; referer?: string; watchLiveLastTime?: string; dayOfWeek?: string; timeOfDay?: string } = {}) {
  const ref = o.referer ?? `${ORIGIN}/`
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'fyp',
    historyLen: '2',
    includeUserIsLogin: false,
    slots: {
      after_channel: [['clientABVersions', t.clientAbVersions]],
      after_cookie: [
        ['count', o.count ?? '6'],
        ['coverFormat', '2'],
        ['cpu_core_number', '20'],
        ['dark_mode', 'false'],
      ],
      after_data_collection: [['day_of_week', o.dayOfWeek ?? '0']],
      after_device_platform: [['enable_cache', 'false']],
      after_history: [['isNonPersonalized', 'false']],
      after_fullscreen: [['is_new_user', 'true']],
      after_is_page_visible: [['language', 'zh-Hans']],
      after_screen: [
        ['showAboutThisAd', 'true'],
        ['showAds', 'true'],
        ['time_of_day', o.timeOfDay ?? '5'],
      ],
      after_verify_fp: [
        ['video_encoding', 'dash'],
        ['vv_count', '0'],
        ['vv_count_fyp', '0'],
        ['watchLiveLastTime', o.watchLiveLastTime ?? String(rand.now())],
      ],
    },
  })
  // pullType 在 priority_region 与 referer 之间
  const items: [string, QueryValue][] = []
  for (const pair of p.pairs) {
    items.push(pair)
    if (pair[0] === 'priority_region') items.push(['pullType', '1'])
  }
  return t.requestJson({ method: 'GET', path: '/api/recommend/item_list/', params: new Params(items), referer: ref })
}

export function userPlaylist(t: TikTok, secUid: string, cursor = '0', count = '20') {
  const ref = profileRef(secUid)
  const p = commonParams(t, {
    referer: ref,
    rootReferer: ref,
    historyLen: '2',
    includeUserIsLogin: true,
    includeLanguage: false,
    early: [
      ['count', count],
      ['cursor', cursor],
    ],
    beforeTz: [['secUid', secUid]],
  })
  return t.requestJson({ method: 'GET', path: '/api/user/playlist/', params: p, referer: ref })
}

/** /api/user/list/：scene 67 为粉丝，21 为关注。 */
export function profileUserList(t: TikTok, secUid: string, scene: '67' | '21', o: { maxCursor?: string; minCursor?: string; count?: string } = {}) {
  const ref = profileRef(secUid)
  const p = currentParams(t, {
    referer: ref,
    queryReferer: ref,
    rootReferer: ref,
    fromPage: 'user',
    historyLen: '2',
    slots: {
      after_channel: [['clientABVersions', t.clientAbVersions]],
      after_cookie: [['count', o.count ?? '30']],
      after_is_page_visible: [
        ['maxCursor', o.maxCursor ?? '0'],
        ['minCursor', o.minCursor ?? '0'],
      ],
      after_root_referer: [['scene', scene]],
      after_screen: [['secUid', secUid]],
    },
  })
  return t.requestJson({ method: 'GET', path: '/api/user/list/', params: p, referer: ref })
}

export function followingItemList(t: TikTok, cursor = '0', count = '9') {
  const ref = `${ORIGIN}/following?lang=zh-Hans`
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'following',
    historyLen: '2',
    slots: {
      after_channel: [['clientABVersions', t.clientAbVersions]],
      after_cookie: [
        ['count', count],
        ['coverFormat', '2'],
        ['cursor', cursor],
      ],
      after_history: [
        ['isNonPersonalized', 'false'],
        ['isResetCounterUsed', 'true'],
      ],
      after_is_page_visible: [
        ['language', 'zh-Hans'],
        ['level', '1'],
      ],
      after_priority_region: [['pullType', '1']],
    },
  })
  return t.requestJson({
    method: 'GET',
    path: '/api/following/item_list/',
    params: p,
    referer: ref,
    ticketGuard: true,
    ticketGuardSecCsrf: false,
    ticketGuardTtCsrfHeader: false,
  })
}

// ================================================================ 通知

export function noticeCount(t: TikTok, referer = `${ORIGIN}/`, fromPage = 'fyp', historyLen = '2') {
  const p = currentParams(t, { referer, queryReferer: '', rootReferer: '', fromPage, historyLen })
  return t.requestJson({ method: 'GET', path: '/api/inbox/notice_count/', params: p, referer })
}

export interface NoticeGroup {
  count: number
  is_mark_read: number
  group: number
  max_time: number | string
  min_time: number | string
}

export function noticeMulti(t: TikTok, groupList?: NoticeGroup[], referer?: string) {
  const ref = referer ?? DEFAULT_REF
  const groups = groupList ?? [{ count: 20, is_mark_read: 0, group: 500, max_time: 0, min_time: 0 }]
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'fyp',
    historyLen: '2',
    slots: { after_from_page: [['group_list', compactJson(groups)]] },
  })
  return t.requestJson({ method: 'GET', path: '/api/notice/multi/', params: p, referer: ref })
}

/** 私信页的用户卡片（不签名）：uid → unique_id 等。 */
export function imUserProfile(t: TikTok, userIds: string[]) {
  const ref = `${ORIGIN}/messages?lang=zh-Hans`
  const p = new Params([
    ['aid', '1988'],
    ['user_ids', JSON.stringify(userIds.map(String))],
  ])
  return t.requestJson({ method: 'GET', path: '/tiktok/v1/im/user/profile/', params: p, referer: ref, signed: false })
}

// ================================================================ 收藏夹、转发、收藏

/** 个人主页的收藏夹 / 转发 / 收藏 tab 的 query（上游 _profile_item_list_params）。 */
function profileItemListParams(
  t: TikTok,
  o: { secUid: string; cursor: string; count: string; rootReferer: string; includeAppId?: boolean; includePublicOnly?: boolean; includeClientAb?: boolean },
): Params {
  const pairs: [string, QueryValue][] = [
    ['WebIdLastTime', t.webIdLastTime],
    ['aid', '1988'],
  ]
  if (o.includeAppId) pairs.push(['appId', '1988'])
  pairs.push(
    ['app_language', 'zh-Hans'],
    ['app_name', 'tiktok_web'],
    ['browser_language', 'zh-CN'],
    ['browser_name', 'Mozilla'],
    ['browser_online', 'true'],
    ['browser_platform', 'Win32'],
    ['browser_version', bversion(t)],
    ['channel', 'tiktok_web'],
  )
  if (o.includeClientAb) pairs.push(['clientABVersions', t.clientAbVersions])
  pairs.push(
    ['cookie_enabled', 'true'],
    ['count', o.count],
    ['coverFormat', '2'],
    ['cursor', o.cursor],
    ['data_collection_enabled', 'true'],
    ['device_id', t.deviceId],
    ['device_platform', 'web_pc'],
    ['focus_state', 'true'],
    ['from_page', 'user'],
    ['history_len', '6'],
    ['is_fullscreen', 'false'],
    ['is_page_visible', 'true'],
    ['language', 'zh-Hans'],
    ['needPinnedItemIds', 'true'],
    ['odinId', t.odinId],
    ['os', 'windows'],
    ['post_item_list_request_type', '0'],
    ['priority_region', t.priorityRegion],
  )
  if (o.includePublicOnly) pairs.push(['publicOnly', 'true'])
  pairs.push(
    ['referer', o.rootReferer],
    ['region', t.region],
    ['root_referer', ''],
    ['screen_height', '1440'],
    ['screen_width', '2560'],
    ['secUid', o.secUid],
    ['tz_name', 'Asia/Shanghai'],
    ['user_is_login', t.loggedIn ? 'true' : 'false'],
    ['verifyFp', t.verifyFp],
    ['video_encoding', 'dash'],
    ['webcast_language', 'zh-Hans'],
  )
  return new Params(pairs)
}

export function collectionList(t: TikTok, secUid: string, cursor = '0', count = '30') {
  const ref = profileRef(secUid)
  const p = profileItemListParams(t, { secUid, cursor, count, rootReferer: ref, includeAppId: true, includePublicOnly: true })
  return t.requestJson({ method: 'GET', path: '/api/user/collection_list/', params: p, referer: ref })
}

export function repostList(t: TikTok, secUid: string, cursor = '0', count = '30') {
  const ref = profileRef(secUid)
  const p = profileItemListParams(t, { secUid, cursor, count, rootReferer: ref, includeClientAb: true })
  return t.requestJson({ method: 'GET', path: '/api/repost/item_list/', params: p, referer: ref })
}

export function collectedItemList(t: TikTok, secUid: string, cursor = '0', count = '16') {
  const ref = profileRef(secUid)
  const p = profileItemListParams(t, { secUid, cursor, count, rootReferer: ref, includeClientAb: true })
  return t.requestJson({ method: 'GET', path: '/api/user/collect/item_list/', params: p, referer: ref })
}

export function checkPlaylistName(t: TikTok, name: string, referer = DEFAULT_REF, historyLen = '7') {
  const p = currentParams(t, { referer, queryReferer: referer, rootReferer: '', fromPage: 'user', historyLen, slots: { after_is_page_visible: [['name', name]] } })
  return t.requestJson({ method: 'GET', path: '/api/playlist/name_check', params: p, referer })
}

function collectionWriteHeaders(t: TikTok): Record<string, string> {
  if (!t.ttCsrfToken) throw new CatbusError('AUTH_REQUIRED', '收藏夹写入缺少 tt-csrf-token（cookie tt_csrf_token）', { hint: 'catbus tiktok auth login --cookie @tiktok-session.json' })
  return { 'x-cthulhu-csrf': '1', 'tt-csrf-token': t.ttCsrfToken }
}

export function collectionCreate(t: TikTok, name: string, status = '1', referer = DEFAULT_REF) {
  if (!name) throw new CatbusError('USAGE', '收藏夹名字不能为空')
  if ([...name].length > 30) throw new CatbusError('USAGE', '收藏夹名字不能超过 30 个字符')
  const headers = collectionWriteHeaders(t)
  const p = currentParams(t, {
    referer,
    queryReferer: referer,
    rootReferer: '',
    fromPage: 'user',
    historyLen: '6',
    slots: {
      after_channel: [
        ['collectionName', name],
        ['collectionStatus', status],
      ],
      after_is_page_visible: [['language', 'zh-Hans']],
    },
  })
  return t.requestJson({ method: 'POST', path: '/api/collection/create/', params: p, referer, origin: ORIGIN, body: '', form: true, extraHeaders: headers, headerOrder: PROFILE_LIST_ORDER })
}

export function collectionModifyInfo(t: TikTok, collectionId: string, name: string, status = '1', referer?: string) {
  if (!collectionId || !name) throw new CatbusError('USAGE', '修改收藏夹需要收藏夹 ID 和新名字')
  if ([...name].length > 30) throw new CatbusError('USAGE', '收藏夹名字不能超过 30 个字符')
  const headers = collectionWriteHeaders(t)
  const ref = referer ?? `${ORIGIN}/@tiktok/collection/${collectionId}`
  const p = currentParams(t, {
    referer: ref,
    queryReferer: ref,
    rootReferer: '',
    fromPage: 'user',
    historyLen: '7',
    slots: {
      after_channel: [
        ['collectionId', collectionId],
        ['collectionName', name],
        ['collectionStatus', status],
      ],
      after_is_page_visible: [['language', 'zh-Hans']],
    },
  })
  return t.requestJson({ method: 'POST', path: '/api/collection/modify_info/', params: p, referer: ref, origin: ORIGIN, body: '', form: true, extraHeaders: headers, headerOrder: PROFILE_LIST_ORDER })
}

/** 收藏夹详情 / 内容的 query（上游 _collection_folder_params）。 */
function collectionFolderParams(t: TikTok, o: { collectionId: string; historyLen: string; scene: string | null; referer: string; cursor?: string; count?: string; sourceType?: string }): Params {
  const pairs: [string, QueryValue][] = [
    ['WebIdLastTime', t.webIdLastTime],
    ['aid', '1988'],
    ['app_language', 'zh-Hans'],
    ['app_name', 'tiktok_web'],
    ['browser_language', 'zh-CN'],
    ['browser_name', 'Mozilla'],
    ['browser_online', 'true'],
    ['browser_platform', 'Win32'],
    ['browser_version', bversion(t)],
    ['channel', 'tiktok_web'],
    ['clientABVersions', t.clientAbVersions],
    ['collectionId', o.collectionId],
    ['cookie_enabled', 'true'],
  ]
  if (o.sourceType != null) pairs.push(['count', o.count ?? '30'], ['cursor', o.cursor ?? '0'])
  pairs.push(
    ['data_collection_enabled', 'true'],
    ['device_id', t.deviceId],
    ['device_platform', 'web_pc'],
    ['focus_state', 'true'],
    ['from_page', 'user'],
    ['history_len', o.historyLen],
    ['is_fullscreen', 'false'],
    ['is_page_visible', 'true'],
    ['language', 'zh-Hans'],
    ['odinId', t.odinId],
    ['os', 'windows'],
    ['priority_region', t.priorityRegion],
    ['referer', o.referer],
    ['region', t.region],
    ['root_referer', ''],
  )
  if (o.scene != null) pairs.push(['scene', o.scene])
  pairs.push(['screen_height', '1440'], ['screen_width', '2560'])
  if (o.sourceType != null) pairs.push(['sourceType', o.sourceType])
  pairs.push(['tz_name', 'Asia/Shanghai'], ['user_is_login', t.loggedIn ? 'true' : 'false'], ['verifyFp', t.verifyFp], ['webcast_language', 'zh-Hans'])
  return new Params(pairs)
}

export function collectionDetail(t: TikTok, collectionId: string, scene = '116') {
  const ref = `${ORIGIN}/@tiktok/collection/${collectionId}`
  const p = collectionFolderParams(t, { collectionId, historyLen: '7', scene, referer: ref })
  return t.requestJson({ method: 'GET', path: '/api/collection/detail/', params: p, referer: ref })
}

export function collectionItemList(t: TikTok, collectionId: string, cursor = '0', count = '30', sourceType = '113') {
  const ref = `${ORIGIN}/@tiktok/collection/${collectionId}`
  const p = collectionFolderParams(t, { collectionId, historyLen: '7', scene: null, referer: ref, cursor, count, sourceType })
  return t.requestJson({ method: 'GET', path: '/api/collection/item_list/', params: p, referer: ref })
}

// ================================================================ 搜索

export function searchLiveRoom(t: TikTok, keyword: string, referer = `${ORIGIN}/live`) {
  const p = currentParams(t, {
    referer,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'search',
    historyLen: '2',
    slots: { after_from_page: [['get_hot_event_rooms', 'v0']], after_priority_region: [['query', keyword]] },
  })
  return t.requestJson({ method: 'GET', path: '/webcast/room/search/', params: p, referer, origin: ORIGIN })
}

export function searchGeneral(t: TikTok, keyword: string, o: { offset?: string; cursor?: string; count?: string; referer?: string } = {}) {
  const ref = o.referer ?? `${ORIGIN}/search?q=${quote(keyword, '')}&lang=zh-Hans`
  const code = compactJson({
    tiktok: { client_params_x: { search_engine: { ies_mt_user_live_video_card_use_libra: 1, mt_search_general_user_live_card: 1 } }, search_server: {} },
  })
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'search',
    historyLen: '2',
    slots: {
      after_channel: [['client_ab_versions', t.clientAbVersions]],
      after_cookie: [
        ['count', o.count ?? '12'],
        ['cursor', o.cursor ?? '0'],
      ],
      after_device_platform: [['device_type', 'web_h265']],
      after_fullscreen: [['is_non_personalized_search', '0']],
      after_is_page_visible: [['keyword', keyword]],
      after_os: [['offset', o.offset ?? '0']],
      after_verify_fp: [['web_search_code', code]],
    },
  })
  return t.requestJson({ method: 'GET', path: '/api/search/general/full/', params: p, referer: ref })
}

export function searchSuggest(t: TikTok, keyword: string, reqSource = 'related_search') {
  if (!keyword) throw new CatbusError('USAGE', '搜索建议需要非空的关键词')
  const ref = `${ORIGIN}/search?q=${quote(keyword, '')}`
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: 'search',
    historyLen: '2',
    slots: { after_is_page_visible: [['keyword', keyword]], after_region: [['req_source', reqSource]] },
  })
  return t.requestJson({ method: 'GET', path: '/api/search/suggest/guide/', params: p, referer: ref, signed: false })
}

// ================================================================ 评论与互动

export function comments(t: TikTok, awemeId: string, cursor = '0', count = '20', referer = DEFAULT_REF) {
  const p = currentParams(t, {
    referer,
    fromPage: 'video',
    historyLen: '3',
    appLanguage: 'ja-JP',
    slots: {
      after_app_name: [['aweme_id', awemeId]],
      after_cookie: [
        ['count', count],
        ['current_region', t.region],
        ['cursor', cursor],
      ],
      after_device_platform: [['enter_from', 'tiktok_web']],
      after_focus: [['fromWeb', '1']],
      after_fullscreen: [['is_non_personalized', 'false']],
    },
  })
  return t.requestJson({ method: 'GET', path: '/api/comment/list/', params: p, referer })
}

export function commentReplies(t: TikTok, itemId: string, commentId: string, o: { cursor?: string; count?: string; referer: string; rootReferer: string }) {
  for (const [name, value] of [
    ['referer', o.referer],
    ['root_referer', o.rootReferer],
  ] as const) {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.host !== 'www.tiktok.com' || !u.pathname.includes('/video/')) {
      throw new CatbusError('ERROR', `comment/list/reply 的 ${name} 必须是完整 TikTok 视频页 URL`)
    }
  }
  const p = currentParams(t, {
    referer: o.referer,
    queryReferer: o.referer,
    rootReferer: o.rootReferer,
    fromPage: 'video',
    historyLen: '6',
    slots: {
      after_channel: [['comment_id', commentId]],
      after_cookie: [
        ['count', o.count ?? '3'],
        ['cursor', o.cursor ?? '1'],
      ],
      after_is_page_visible: [['item_id', itemId]],
    },
  })
  return t.requestJson({ method: 'GET', path: '/api/comment/list/reply/', params: p, referer: o.referer })
}

export function postComment(t: TikTok, awemeId: string, text: string, o: { replyId?: string; replyToReplyId?: string; textExtra?: string; referer?: string; queryReferer?: string } = {}) {
  if (!text) throw new CatbusError('USAGE', '评论内容不能为空')
  const ref = o.referer ?? `${ORIGIN}/@tiktok/video/${awemeId}?lang=zh-Hans`
  const qref = o.queryReferer ?? DEFAULT_REF
  const slots: Slots = {
    after_app_name: [['aweme_id', awemeId]],
    after_screen: [
      ['text', text],
      ['text_extra', o.textExtra ?? '[]'],
    ],
  }
  if (o.replyId) {
    slots.after_region = [
      ['reply_id', o.replyId],
      ['reply_to_reply_id', o.replyToReplyId ?? '0'],
    ]
  }
  const p = currentParams(t, { referer: ref, queryReferer: qref, rootReferer: qref, fromPage: 'video', historyLen: '3', slots })
  return t.requestJson({ method: 'POST', path: '/api/comment/publish/', params: p, referer: ref, origin: ORIGIN, body: '', form: true, ticketGuard: true })
}

export function itemDigg(t: TikTok, awemeId: string, diggType: '1' | '0', o: { referer?: string; queryReferer?: string } = {}) {
  const ref = o.referer ?? `${ORIGIN}/@tiktok/video/${awemeId}?lang=zh-Hans`
  const qref = o.queryReferer ?? DEFAULT_REF
  const p = currentParams(t, {
    referer: ref,
    queryReferer: qref,
    rootReferer: qref,
    fromPage: 'video',
    historyLen: '3',
    slots: { after_app_name: [['aweme_id', awemeId]], after_screen: [['type', diggType]] },
  })
  return t.requestJson({ method: 'POST', path: '/api/commit/item/digg/', params: p, referer: ref, origin: ORIGIN, body: '', form: true, ticketGuard: true, ticketGuardSecCsrf: false })
}

export function itemCollect(t: TikTok, itemId: string, secUid: string, action: '1' | '0', o: { referer?: string; queryReferer?: string } = {}) {
  const ref = o.referer ?? `${ORIGIN}/@tiktok/video/${itemId}?lang=zh-Hans`
  const qref = o.queryReferer ?? DEFAULT_REF
  const p = currentParams(t, {
    referer: ref,
    queryReferer: qref,
    rootReferer: qref,
    fromPage: 'video',
    historyLen: '3',
    slots: { before_aid: [['action', action]], after_is_page_visible: [['itemId', itemId]], after_screen: [['secUid', secUid]] },
  })
  return t.requestJson({ method: 'POST', path: '/api/item/collect/', params: p, referer: ref, origin: ORIGIN, body: '', form: true, ticketGuard: true, ticketGuardSecCsrf: false })
}

export function followUser(t: TikTok, userId: string, secUserId: string, o: { actionType: '1' | '0'; followType?: string; referer: string; queryReferer: string }) {
  const p = currentParams(t, {
    referer: o.referer,
    queryReferer: o.queryReferer,
    rootReferer: o.queryReferer,
    fromPage: 'video',
    historyLen: '3',
    slots: {
      before_aid: [['action_type', o.actionType]],
      after_channel: [['channel_id', '0']],
      after_focus: [
        ['from', '18'],
        ['fromWeb', '1'],
      ],
      after_from_page: [['from_pre', '0']],
      after_screen: [
        ['sec_user_id', secUserId],
        ['type', o.followType ?? o.actionType],
      ],
      after_tz: [['user_id', userId]],
    },
  })
  return t.requestJson({ method: 'POST', path: '/api/commit/follow/user/', params: p, referer: o.referer, origin: ORIGIN, body: '', form: true, ticketGuard: true })
}

export function relatedItems(t: TikTok, itemId: string, o: { cursor?: string; count?: string; referer?: string; queryReferer?: string } = {}) {
  const ref = o.referer ?? `${ORIGIN}/@tiktok/video/${itemId}?lang=zh-Hans`
  let qref = o.queryReferer
  if (qref == null) {
    const m = /^(https?:\/\/[^/]+\/@[^/?]+)/.exec(ref)
    qref = m ? `${m[1]}?lang=zh-Hans` : ref
  }
  const pairs: [string, QueryValue][] = [
    ['CategoryType', '101'],
    ['WebIdLastTime', t.webIdLastTime],
    ['aid', '1988'],
    ['app_language', 'zh-Hans'],
    ['app_name', 'tiktok_web'],
    ['browser_language', 'zh-CN'],
    ['browser_name', 'Mozilla'],
    ['browser_online', 'true'],
    ['browser_platform', 'Win32'],
    ['browser_version', bversion(t)],
    ['channel', 'tiktok_web'],
    ['clientABVersions', t.clientAbVersions],
    ['cookie_enabled', 'true'],
    ['count', o.count ?? '16'],
    ['coverFormat', '2'],
    ['cursor', o.cursor ?? '0'],
    ['data_collection_enabled', 'true'],
    ['device_id', t.deviceId],
    ['device_platform', 'web_pc'],
    ['focus_state', 'true'],
    ['from_page', 'video'],
    ['history_len', '3'],
    ['isNonPersonalized', 'false'],
    ['is_fullscreen', 'false'],
    ['is_page_visible', 'true'],
    ['itemID', itemId],
    ['language', 'zh-Hans'],
    ['launch_mode', 'direct'],
    ['odinId', t.odinId],
    ['os', 'windows'],
    ['priority_region', t.priorityRegion],
    ['referer', ref],
    ['region', t.region],
    ['root_referer', qref],
    ['screen_height', '1440'],
    ['screen_width', '2560'],
    ['tz_name', 'Asia/Shanghai'],
    ['user_is_login', t.loggedIn ? 'true' : 'false'],
    ['verifyFp', t.verifyFp],
    ['video_encoding', 'dash'],
    ['webcast_language', 'zh-Hans'],
  ]
  return t.requestJson({ method: 'GET', path: '/api/related/item_list/', params: new Params(pairs), referer: ref })
}

// ================================================================ 直播

const LIVE = `${ORIGIN}/live`

export function webcastFeed(t: TikTok, referer = LIVE) {
  const p = currentParams(t, {
    referer,
    queryReferer: '',
    rootReferer: '',
    fromPage: '',
    historyLen: '2',
    slots: {
      after_channel: [
        ['channel_id', '42'],
        ['content_type', '1'],
      ],
      after_cookie: [['cpu_number', '20']],
      after_device_platform: [['device_type', 'web_h264']],
      after_fullscreen: [['is_non_personalized', '0']],
      after_is_page_visible: [['max_time', '0']],
      after_region: [['req_from', 'pc_web_side_follow_default']],
    },
  })
  return t.requestJson({ method: 'GET', path: '/webcast/feed/', params: p, referer })
}

export function liveUserRoom(t: TikTok, uniqueId: string, referer?: string) {
  const ref = referer ?? `${ORIGIN}/@${uniqueId}/live`
  const p = currentParams(t, {
    referer: ref,
    queryReferer: '',
    rootReferer: '',
    fromPage: '',
    historyLen: '4',
    includeOdinId: false,
    slots: {
      after_screen: [
        ['sourceType', '54'],
        ['staleTime', '600000'],
      ],
      after_tz: [['uniqueId', uniqueId]],
    },
  })
  return t.requestJson({ method: 'GET', path: '/api-live/user/room', params: p, referer: ref })
}

export function webcastDrawerTabs(t: TikTok, referer = LIVE, scene = '1') {
  const p = currentParams(t, { referer, queryReferer: '', rootReferer: '', fromPage: '', historyLen: '2', slots: { after_root_referer: [['scene', scene]] } })
  return t.requestJson({ method: 'GET', path: '/webcast/feed/drawer_tabs/', params: p, referer, origin: ORIGIN })
}

export function liveGiftList(t: TikTok, roomId: string, referer = LIVE) {
  const p = currentParams(t, { referer, queryReferer: '', rootReferer: '', fromPage: '', historyLen: '4', includeOdinId: false, slots: { after_region: [['room_id', roomId]] } })
  return t.requestJson({ method: 'GET', path: '/webcast/gift/list/', params: p, referer })
}

export function webcastRankList(t: TikTok, anchorId: string, roomId: string, referer = `${ORIGIN}/`) {
  const p = commonParams(t, {
    referer,
    queryReferer: '',
    rootReferer: '',
    historyLen: '2',
    includeFromPage: true,
    fromPage: '',
    includeUserIsLogin: true,
    includeLanguage: false,
    afterAid: [['anchor_id', anchorId]],
    afterRegion: [['room_id', roomId]],
    afterRootReferer: [['source', '0']],
  })
  return t.requestJson({ method: 'GET', path: '/webcast/ranklist/online_audience/', params: p, referer })
}

/** 直播 protobuf 拉取（带两个 version_code 的原样 query）。返回原始字节。 */
export async function webcastImFetch(t: TikTok, liveId: string, roomId: string, o: { cursor?: string; historyCommentCount?: string; referer?: string } = {}): Promise<Uint8Array> {
  const p = new Params()
  for (const [k, v] of [
    ['version_code', '180800'],
    ['device_platform', 'web'],
    ['cookie_enabled', 'true'],
    ['screen_width', '2560'],
    ['screen_height', '1440'],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', 'Mozilla'],
    ['browser_version', bversion(t)],
    ['browser_online', 'true'],
    ['tz_name', 'Asia/Shanghai'],
    ['ws_direct', '1'],
    ['aid', '1988'],
    ['app_name', 'tiktok_web'],
    ['live_id', liveId],
    ['version_code', '270000'],
    ['app_language', 'zh-Hans'],
    ['client_enter', '1'],
    ['room_id', roomId],
    ['identity', 'audience'],
    ['history_comment_count', o.historyCommentCount ?? '6'],
    ['fetch_rule', '1'],
    ['last_rtt', '-1'],
    ['cursor', o.cursor ?? '0'],
    ['internal_ext', '0'],
    ['sup_ws_ds_opt', '1'],
    ['resp_content_type', 'protobuf'],
    ['did_rule', '3'],
    ['webcast_language', 'zh-Hans'],
  ] as const) {
    p.addPair(k, v)
  }
  const res = await t.requestResponse({ method: 'GET', path: '/webcast/im/fetch/', params: p, referer: o.referer ?? LIVE, origin: ORIGIN, accept: '*/*' })
  if (res.status >= 400) throw new CatbusError('UPSTREAM', `webcast/im/fetch 返回 HTTP ${res.status}`, { detail: { status: res.status } })
  return new Uint8Array(await res.arrayBuffer())
}

/** 直播 WS 地址：原样拼接后只把空格换成 %20（上游 _live_ws_url）。 */
export function liveWsUrl(t: TikTok, liveId: string, roomId: string, marker: string): string {
  if (marker.length !== 16) throw new CatbusError('ERROR', '直播 WS X-Bogus 长度必须为 16')
  const m = t.metrics
  const pairs: [string, string][] = [
    ['version_code', '180800'],
    ['device_platform', 'web'],
    ['cookie_enabled', 'true'],
    ['screen_width', String(m.screen_width ?? '2560')],
    ['screen_height', String(m.screen_height ?? '1440')],
    ['browser_language', String(m.browser_language ?? 'zh-CN')],
    ['browser_platform', String(m.browser_platform ?? 'Win32')],
    ['browser_name', 'Mozilla'],
    ['browser_version', bversion(t)],
    ['browser_online', 'true'],
    ['tz_name', String(m.tz_name ?? 'Asia/Shanghai')],
    ['app_name', 'tiktok_web'],
    ['sup_ws_ds_opt', '1'],
    ['update_version_code', '2.0.0'],
    ['compress', 'gzip'],
    ['webcast_language', 'zh-Hans'],
    ['ws_direct', '1'],
    ['aid', '1988'],
    ['live_id', liveId],
    ['version_code', '270000'],
    ['app_language', 'zh-Hans'],
    ['client_enter', '1'],
    ['room_id', roomId],
    ['identity', 'audience'],
    ['history_comment_count', '6'],
    ['last_rtt', '0'],
    ['heartbeat_duration', '10000'],
    ['resp_content_type', 'protobuf'],
    ['did_rule', '3'],
    ['X-Bogus', marker],
  ]
  return ('wss://webcast-ws.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/?' + pairs.map(([k, v]) => `${k}=${v}`).join('&')).replaceAll(' ', '%20')
}

export function postLiveChat(t: TikTok, roomId: string, content: string, o: { referer: string; timestamp?: number; historyLen?: string }) {
  if (!content) throw new CatbusError('USAGE', '弹幕内容不能为空')
  if ([...content].length > 150) throw new CatbusError('USAGE', '弹幕内容不能超过 150 个字符')
  const ts = o.timestamp ?? rand.now()
  const body = compactJson(new Map<string, unknown>([
    ['room_id', roomId],
    ['content', content],
    ['emotes_with_index', ''],
    ['input_type', 0],
    ['client_start_timestamp_millisecond', ts],
  ]))
  const p = currentParams(t, {
    referer: o.referer,
    queryReferer: '',
    rootReferer: '',
    fromPage: '',
    historyLen: o.historyLen ?? '6',
    includeOdinId: false,
    slots: {
      after_channel: [
        ['client_start_timestamp_millisecond', ts],
        ['content', content],
      ],
      after_device_platform: [['emotes_with_index', '']],
      after_history: [['input_type', 0]],
      after_region: [['room_id', roomId]],
    },
  })
  return t.requestJson({
    method: 'POST',
    path: '/webcast/room/chat/',
    params: p,
    referer: o.referer,
    origin: ORIGIN,
    body,
    extraHeaders: { 'content-type': 'application/json; charset=UTF-8' },
    ticketGuard: true,
    ticketGuardSecCsrf: true,
    ticketGuardTtCsrfHeader: false,
    allowEmpty: true,
  })
}

export function postLiveLike(t: TikTok, toUid: string, roomId: string, o: { count?: number; referer: string }) {
  const body = compactJson(new Map<string, unknown>([
    ['to_uid', toUid],
    ['count', o.count ?? 1],
    ['room_id', roomId],
    ['enter_from', 'live'],
  ]))
  const p = currentParams(t, { referer: o.referer, queryReferer: '', rootReferer: '', fromPage: '', historyLen: '6', includeOdinId: false })
  return t.requestJson({
    method: 'POST',
    path: '/webcast/room/like/',
    params: p,
    referer: o.referer,
    origin: ORIGIN,
    body,
    extraHeaders: { 'content-type': 'application/json; charset=UTF-8' },
    contentTypeBeforeMobile: true,
    allowEmpty: true,
  })
}

// ================================================================ 页面（hydration / SSR）

export function userHtml(t: TikTok, url: string): Promise<string> {
  return t.document(url, url)
}

/** 视频页 hydration 的 itemStruct（上游 get_video_detail）。 */
export async function videoDetail(t: TikTok, url: string, expectedId?: string): Promise<any> {
  const html = await userHtml(t, url)
  const detail = hydration(html)?.['webapp.video-detail']
  const item = detail?.itemInfo?.itemStruct
  if (!item?.id) {
    const status = detail?.statusCode
    if (status === 10204 || status === 10216) throw new CatbusError('UPSTREAM', `作品不存在或不可见`, { detail: { statusCode: status, statusMsg: detail?.statusMsg } })
    throw new CatbusError('UPSTREAM', '视频页 hydration 中没有 webapp.video-detail.itemInfo.itemStruct', { detail: { statusCode: status } })
  }
  if (expectedId && String(item.id) !== expectedId) throw new CatbusError('UPSTREAM', `视频页的作品 ID 与链接不一致：期望 ${expectedId}，实际 ${item.id}`)
  return item
}

/** 商品页 SSR 的 product_info.component_data（上游 get_shop_product_detail）。 */
export async function shopProductDetail(t: TikTok, productUrl: string, productId: string): Promise<any> {
  const html = await shopProductHtml(t, productUrl)
  if (/<title>Security Check<\/title>/i.test(html)) {
    throw new CatbusError('RISK_CONTROL', 'TikTok Shop 要求人机验证', { detail: { kind: 'captcha' }, hint: '在浏览器打开商品页通过验证后，重新导出 Cookie 登录' })
  }
  if (/region_not_match/.test(html)) throw new CatbusError('UPSTREAM', '商品在当前地区不可用', { detail: { url: productUrl } })
  const m = /<script[^>]*id="__MODERN_ROUTER_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new CatbusError('UPSTREAM', 'TikTok Shop 页面中没有 __MODERN_ROUTER_DATA__')
  let loader: any
  try {
    loader = JSON.parse(m[1]!).loaderData
  } catch {
    throw new CatbusError('UPSTREAM', 'TikTok Shop SSR loaderData 无法解析')
  }
  let data: any = null
  for (const route of Object.values(loader ?? {}) as any[]) {
    const comp = route?.page_config?.components_map?.find?.((c: any) => c?.component_name === 'product_info')
    if (comp) {
      data = comp.component_data
      break
    }
  }
  if (!data || typeof data !== 'object') throw new CatbusError('UPSTREAM', 'TikTok Shop SSR 中没有 product_info.component_data')
  const pid = String(data.product_info?.product_model?.product_id ?? '')
  if (pid !== productId) throw new CatbusError('UPSTREAM', `TikTok Shop 商品 ID 与链接不一致：期望 ${productId}，实际 ${pid}`)
  return data
}

/** 商品页（Chrome 直接导航的请求头顺序）。 */
export async function shopProductHtml(t: TikTok, productUrl: string): Promise<string> {
  const headers: [string, string][] = [
    ['upgrade-insecure-requests', '1'],
    ['user-agent', t.ua],
    ['sec-ch-ua', t.browser.secChUa],
    ['sec-ch-ua-mobile', '?0'],
    ['sec-ch-ua-platform', t.browser.secChUaPlatform],
    ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', t.browser.acceptLanguage],
    ['priority', 'u=0, i'],
    ['sec-fetch-dest', 'document'],
    ['sec-fetch-mode', 'navigate'],
    ['sec-fetch-site', 'none'],
    ['sec-fetch-user', '?1'],
  ]
  const res = await t.send({ url: productUrl, headers })
  if (res.status >= 400) throw new CatbusError('UPSTREAM', `TikTok Shop 页面返回 HTTP ${res.status}`, { detail: { status: res.status } })
  return res.text()
}

/** 评价翻页：页 1 来自商品页 SSR，从第 2 页开始走这里，每页新算 BSID。 */
export async function shopReviewPage(t: TikTok, productUrl: string, productId: string, pageStart: number) {
  if (pageStart < 2) throw new CatbusError('ERROR', 'page_start=1 来自商品页 SSR，翻页接口从 2 开始')
  const body = compactJson(new Map<string, unknown>([
    ['product_id', productId],
    ['page_start', pageStart],
    ['page_size', 3],
    ['sort_rule', 1],
    ['review_filter', new Map([['filter_type', 1], ['filter_value', 6]])],
    ['component_name', 'pdp_left_reviews'],
  ]))
  const endpoint = `${SHOP}/api/shop/pdp_desktop/get_product_reviews`
  const cookie = t.device.document_cookie || t.cookieStr
  const signed = await shopSign({
    url: endpoint,
    method: 'POST',
    headers: [
      ['accept', 'application/json,*/*;q=0.8'],
      ['content-type', 'application/json'],
    ],
    body,
    cookie,
    userAgent: t.ua,
    xBogus: (msToken) => encodeXBogus(`msToken=${msToken}`, t.ua, body, { ubcode: 14, magic: 2894886431 }),
  })
  const m = /^https:\/\/shop\.tiktok\.com\/api\/shop\/pdp_desktop\/get_product_reviews\?msToken=([^&]+)&X-Bogus=([^&]+)&_signature=([^&]+)&X-Tts-Oec-Bsid=([0-9a-f]{382})$/.exec(signed.signed_url)
  if (!m || m[2]!.length !== 28 || m[3]!.length !== 47 || m[4] !== signed.bsid) throw new CatbusError('ERROR', 'Shop 四字段签名结果未通过校验')
  const headers: [string, string][] = [
    ['sec-ch-ua-platform', t.browser.secChUaPlatform],
    ['referer', productUrl],
    ['user-agent', t.ua],
    ['accept', 'application/json,*/*;q=0.8'],
    ['sec-ch-ua', t.browser.secChUa],
    ['content-type', 'application/json'],
    ['sec-ch-ua-mobile', '?0'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', t.browser.acceptLanguage],
    ['content-length', String(Buffer.byteLength(body))],
    ['origin', SHOP],
    ['priority', 'u=1, i'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-origin'],
  ]
  const res = await t.send({ method: 'POST', url: signed.signed_url, headers, body })
  const result = await t.json<any>(res, { path: '/api/shop/pdp_desktop/get_product_reviews' })
  if (result.code !== 0 || !result.data || typeof result.data !== 'object') {
    throw new CatbusError('UPSTREAM', `TikTok Shop 评价接口返回错误：${result.message ?? result.code}`, { detail: { code: result.code, message: result.message } })
  }
  return result.data
}

// ================================================================ 创作者中心：作品列表、地点

export function creatorItemList(t: TikTok, cursor = 0, size = 50) {
  if (cursor < 0 || size < 1 || size > 50) throw new CatbusError('USAGE', 'Creator 作品列表需要 cursor >= 0 且 1 <= size <= 50')
  if (!t.ttCsrfToken) throw new CatbusError('AUTH_REQUIRED', 'Creator 作品列表缺少 tt-csrf-token（cookie tt_csrf_token）', { hint: 'catbus tiktok auth login --cookie @tiktok-session.json' })
  const country = String(t.cookie('store-country-code') || t.region).toUpperCase()
  const p = new Params(
    [
      ['locale', 'zh-Hans'],
      ['aid', '1988'],
      ['priority_region', country],
      ['region', country],
      ['tz_name', 'Asia/Shanghai'],
      ['app_name', 'tiktok_creator_center'],
      ['app_language', 'zh-Hans'],
      ['device_platform', 'web_pc'],
      ['channel', 'tiktok_web'],
      ['device_id', t.deviceId],
      ['os', 'win'],
      ['screen_width', '2560'],
      ['screen_height', '1440'],
      ['browser_language', 'zh-CN'],
      ['browser_platform', 'Win32'],
      ['browser_name', 'Mozilla'],
      ['browser_version', bversion(t)],
    ],
    new Set(['browser_version']),
  )
  const body = compactJson(new Map<string, unknown>([
    ['cursor', cursor],
    ['size', size],
    ['query', new Map<string, unknown>([['sort_orders', [new Map<string, unknown>([['field_name', 'post_time'], ['order', 2]])]], ['conditions', []], ['is_recent_posts', false]])],
  ]))
  return t.requestJson({
    method: 'POST',
    path: '/tiktok/creator/manage/item_list/v1/',
    params: p,
    referer: `${ORIGIN}/tiktokstudio/content`,
    body,
    origin: ORIGIN,
    accept: AXIOS_ACCEPT,
    extraHeaders: { 'agw-js-conv': 'str', 'tt-csrf-token': t.ttCsrfToken },
    headerOrder: [
      'sec-ch-ua-platform', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'agw-js-conv', 'tt-csrf-token', 'user-agent', 'accept', 'content-type',
      'accept-encoding', 'accept-language', 'content-length', 'cookie', 'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
    ],
  })
}

export const UPLOAD_REFERER = `${ORIGIN}/tiktokstudio/upload?from=webapp&lang=zh-Hans&tab=video`

export function creatorPoiList(t: TikTok, o: { pageNum?: number; pageSize?: number; searchId?: string; creationId?: string; lastSearchId?: string; historyLen?: string } = {}) {
  const webParams = new Map<string, unknown>([
    ['aid', 1988],
    ['app_name', 'tiktok_web'],
    ['channel', 'tiktok_web'],
    ['device_platform', 'web_pc'],
    ['device_id', t.deviceId],
    ['region', t.region],
    ['priority_region', t.priorityRegion],
    ['referer', ''],
    ['cookie_enabled', true],
    ['screen_width', 2560],
    ['screen_height', 1440],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', 'Mozilla'],
    ['browser_version', bversion(t)],
    ['browser_online', true],
    ['verifyFp', t.verifyFp],
    ['app_language', 'zh-Hans'],
    ['webcast_language', 'zh-Hans'],
    ['tz_name', 'Asia/Shanghai'],
    ['is_fullscreen', false],
    ['history_len', o.historyLen ?? '20'],
  ])
  const body = compactJson(new Map<string, unknown>([
    ['page_num', o.pageNum ?? 1],
    ['page_size', o.pageSize ?? 10],
    ['search_params', new Map([['search_id', o.searchId ?? ''], ['creation_id', o.creationId ?? ''], ['last_search_id', o.lastSearchId ?? '']])],
    ['web_params', webParams],
  ]))
  return t.requestJson({ method: 'POST', path: '/tiktok/v1/creator/poi/list', params: new Params([['aid', '1988']]), referer: UPLOAD_REFERER, body, signed: false, accept: AXIOS_ACCEPT, origin: ORIGIN })
}

// ================================================================ 私信的 HTTP 部分

/** privacy config 里的 wid（私信 WS 的 access_key 从它算）。 */
export function cookiePrivacyConfig(t: TikTok, referer = `${ORIGIN}/`) {
  const p = new Params([
    ['locale', 'zh-Hans'],
    ['appId', '1988'],
    ['theme', 'default'],
    ['tea', '1'],
  ])
  return t.requestJson({ method: 'GET', path: '/api/v1/web-cookie-privacy/config', params: p, referer, signed: false, accept: AXIOS_ACCEPT })
}

/** 私信 protobuf 请求（im-api-<region>.tiktok.com）。 */
export async function postImProtobuf(t: TikTok, path: string, raw: Uint8Array, referer = `${ORIGIN}/`): Promise<Uint8Array> {
  const headers: [string, string][] = [
    ['sec-ch-ua-platform', t.browser.secChUaPlatform],
    ['referer', referer],
    ['user-agent', t.ua],
    ['accept', 'application/x-protobuf'],
    ['sec-ch-ua', t.browser.secChUa],
    ['content-type', 'application/x-protobuf'],
    ['sec-ch-ua-mobile', '?0'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', t.browser.acceptLanguage],
    ['content-length', String(raw.length)],
    ['origin', ORIGIN],
    ['priority', 'u=1, i'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'same-site'],
  ]
  const url = `https://im-api-${t.region.toLowerCase()}.tiktok.com${path}`
  const res = await t.send({ method: 'POST', url, headers, body: raw })
  if (res.status >= 400) throw new CatbusError('UPSTREAM', `私信接口返回 HTTP ${res.status}`, { detail: { status: res.status, path } })
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (!bytes.length) throw new CatbusError('UPSTREAM', '私信 protobuf 响应为空')
  return bytes
}

