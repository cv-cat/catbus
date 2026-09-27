import { CatbusError } from '../../../core/errors.js'
import { quote, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type Pc, splice, type XhsJson } from './client.js'
import { EDITH, insertAfter, LIVE, orderedHeaders, PC_ORDER, SO, UA, WEB } from './profile.js'

/**
 * 上游 apis/xhs_pc_apis.py（XHS_Apis）与 apis/xhs_live.py（XHSLiveAPI）的请求构造，一个函数对应一个上游方法，
 * 字段与顺序照抄（对拍测试逐字节比较）。返回平台原始 JSON（不检查业务码，由调用方 check）。
 */

const IMAGE_FORMATS = ['jpg', 'webp', 'avif']
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** search_id：base36((ts << 64) + ceil(0x7ffffffe * random))。 */
export function searchId(): string {
  let v = (BigInt(rand.now()) << 64n) + BigInt(Math.ceil(0x7ffffffe * rand.random()))
  if (v === 0n) return '0'
  let s = ''
  while (v) {
    s = BASE36[Number(v % 36n)] + s
    v /= 36n
  }
  return s
}

export const searchRequestId = () => `${Math.ceil(0x7ffffffe * rand.random())}-${rand.now()}`

// ================================================================ 主站

export function userMe(p: Pc) {
  return p.request('/api/sns/web/v2/user/me')
}

export function userInfo(p: Pc, userId: string) {
  return p.request(splice('/api/sns/web/v1/user/otherinfo', { target_user_id: userId }))
}

function notesPage(path: string) {
  return (p: Pc, userId: string, cursor: string, xsecToken = '', xsecSource = '') =>
    p.request(splice(path, { num: '30', cursor, user_id: userId, image_formats: 'jpg,webp,avif', xsec_token: xsecToken, xsec_source: xsecSource }))
}

/** get_user_note_info / get_user_like_note_info / get_user_collect_note_info。 */
export const userNotes = notesPage('/api/sns/web/v1/user_posted')
export const userLikes = notesPage('/api/sns/web/v1/note/like/page')
export const userCollects = notesPage('/api/sns/web/v2/note/collect/page')

/** get_note_info。 */
export function noteInfo(p: Pc, noteId: string, xsecToken: string, xsecSource = 'pc_search') {
  return p.request(
    '/api/sns/web/v1/feed',
    { source_note_id: noteId, image_formats: IMAGE_FORMATS, extra: { need_body_topic: '1' }, xsec_source: xsecSource, xsec_token: xsecToken },
    'POST',
  )
}

/** get_homefeed_all_channel。 */
export function homefeedCategories(p: Pc) {
  return p.request('/api/sns/web/v1/homefeed/category')
}

/** get_homefeed_recommend。 */
export function homefeed(p: Pc, category: string, cursorScore: string, refreshType: number, noteIndex: number, num = 20, needNum = 10) {
  return p.request(
    '/api/sns/web/v1/homefeed',
    {
      cursor_score: cursorScore,
      num,
      refresh_type: refreshType,
      note_index: noteIndex,
      unread_begin_note_id: '',
      unread_end_note_id: '',
      unread_note_count: 0,
      category,
      search_key: '',
      need_num: needNum,
      image_formats: IMAGE_FORMATS,
      need_filter_image: false,
    },
    'POST',
  )
}

export const SORT_TYPES = ['general', 'time_descending', 'popularity_descending', 'comment_descending', 'collect_descending']

/** search_note（不带 filters 的浏览器默认形态）。 */
export function searchNotes(p: Pc, keyword: string, page = 1, sort = 'general', noteType = 0, sid?: string) {
  return p.request(
    '/api/sns/web/v2/search/notes',
    {
      keyword,
      page,
      page_size: 20,
      search_id: sid ?? searchId(),
      sort,
      note_type: noteType,
      ext_flags: [],
      geo: '',
      image_formats: IMAGE_FORMATS,
      session_id: rand.uuid4(),
    },
    'POST',
    { origin: SO },
  )
}

/** search_user。 */
export function searchUsers(p: Pc, keyword: string, page = 1) {
  return p.request(
    '/api/sns/web/v1/search/usersearch',
    { search_user_request: { keyword, search_id: searchId(), page, page_size: 15, biz_type: 'web_search_user', request_id: searchRequestId() } },
    'POST',
  )
}

/** get_note_out_comment。 */
export function comments(p: Pc, noteId: string, cursor: string, xsecToken: string) {
  return p.request(splice('/api/sns/web/v2/comment/page', { note_id: noteId, cursor, top_comment_id: '', image_formats: 'jpg,webp,avif', xsec_token: xsecToken }))
}

/** get_note_inner_comment。 */
export function subComments(p: Pc, noteId: string, rootId: string, cursor: string, xsecToken: string) {
  return p.request(
    splice('/api/sns/web/v2/comment/sub/page', { note_id: noteId, root_comment_id: rootId, num: '10', cursor, image_formats: 'jpg,webp,avif', top_comment_id: '', xsec_token: xsecToken }),
  )
}

/** get_unread_message。 */
export function unreadCount(p: Pc) {
  return p.request('/api/sns/web/unread_count')
}

/** get_metions / get_likesAndcollects / get_new_connections。 */
export function youMessages(p: Pc, kind: 'mentions' | 'likes' | 'connections', cursor: string) {
  return p.request(splice(`/api/sns/web/v1/you/${kind}`, { num: '20', cursor }))
}

/** get_trending_queries（热搜词）。 */
export function trendingQueries(p: Pc) {
  return p.request(
    splice('/api/sns/web/v1/search/trending/query', {
      source: 'UserPage',
      search_type: 'trend',
      last_query: '',
      last_query_time: 0,
      word_request_situation: 'FIRST_ENTER',
      hint_word: '',
      hint_word_type: '',
      hint_word_request_id: '',
    }),
  )
}

/** get_user_board（收藏夹列表）。 */
export function userBoards(p: Pc, userId: string, page = 1, num = 15) {
  return p.request(splice('/api/sns/web/v1/board/user', { user_id: userId, num, page }))
}

/** get_celestial_lt：换取私信 / 直播长连的 RWP 登录 token，写进签名状态。 */
export async function celestialLt(p: Pc) {
  const r = await p.request('/api/sns/web/v1/celestial/lt', '', 'GET', { extra: { c_device_id: p.state.tabDeviceId } })
  const d = r?.data ?? {}
  const ttl = d.expiredTime ?? d.expired_time
  const aLt = String(d.aLt ?? d.a_lt ?? '')
  if (aLt) {
    p.state.rwpToken = {
      aLt,
      rLt: String(d.rLt ?? d.r_lt ?? ''),
      expiredAt: ttl != null && Number.isFinite(Number(ttl)) ? rand.now() + Math.floor((Number(ttl) * 1000) / 2) : null,
      uid: p.userId,
    }
  }
  return r
}

/** get_note_no_water_video：无登录的笔记页导航，取 og:video。 */
export async function noteVideo(p: Pc, noteId: string): Promise<string | null> {
  const { navigationHeaders } = await import('./profile.js')
  const res = await p.http.request({ url: `${WEB}/explore/${noteId}`, headers: orderedHeaders(navigationHeaders(), PC_ORDER.navigation, null, { optional: ['cookie'] }), cookies: false })
  return /<meta name="og:video" content="(.*?)">/.exec(await res.text())?.[1] ?? null
}

/** get_note_no_water_img：CDN 图片地址换成 ci.xiaohongshu.com 的无水印 JPEG。 */
export function noWaterImage(url: string): string {
  const strip = (s: string) => s.split('!', 1)[0]!.split('?', 1)[0]!
  let token: string
  if (url.includes('notes_pre_post/')) token = 'notes_pre_post/' + strip(url.split('notes_pre_post/')[1]!)
  else if (url.includes('spectrum')) token = strip(url.split('/').slice(-2).join('/'))
  else if (url.includes('.jpg')) token = strip(url.split('/').slice(-3).join('/'))
  else token = strip(url.split('/').at(-1)!)
  return `https://ci.xiaohongshu.com/${token}?imageView2/format/jpeg`
}

// ================================================================ 直播（XHSLiveAPI）

/**
 * 上游 XHSLiveAPI._request：live-room 域不带 trace 头、referer 后插 xy-common-params；
 * extra_headers 插在 x-s-common 之后（c_device_id 插在 x-xray-traceid 之后）。
 */
export async function liveRequest(p: Pc, origin: string, api: string, method: 'GET' | 'POST' = 'GET', data: unknown = '', extra: Record<string, string> = {}): Promise<XhsJson> {
  p.sync()
  p.requireSession()
  const context = p.state.nextSignContext(api)
  const b1 = p.state.currentB1(context.now)
  const dslPair = p.state.dslPair(await p.dsl(), rand.now())
  const { pcSignedHeaders, businessOrder } = await import('./client.js')
  const signed = pcSignedHeaders(p.state, api, data, { b1, dslPair, context, userId: p.userId, clientHints: false, trace: origin !== LIVE })
  let h = signed.headers
  h.referer = `${WEB}/`
  h['user-agent'] = UA
  if (origin === LIVE) {
    // 上游 bug：generate_headers 总会写 x-b3-traceid，live-room 域的头顺序表里没有它，上游这里直接抛错；按实抓去掉
    delete h['x-b3-traceid']
    h = insertAfter(h, 'xy-common-params', 'platform=web', 'referer')
  }
  for (const [k, v] of Object.entries(extra)) h = insertAfter(h, k, v, k.toLowerCase() === 'c_device_id' ? 'x-xray-traceid' : 'x-s-common')
  const url = origin + api
  const cookies = p.wire(url)
  let pairs: [string, string][]
  if (origin === LIVE) {
    let order = method === 'GET' ? PC_ORDER.liveGet : PC_ORDER.livePost
    if (!('content-type' in h)) order = order.filter((k) => k !== 'content-type')
    pairs = orderedHeaders(h, order, cookies, { optional: ['xy-common-params', 'x-ratelimit-meta'] })
  } else pairs = orderedHeaders(h, businessOrder(h, method), cookies)
  return p.json({ method, url, headers: pairs, ...(method === 'POST' ? { body: signed.body } : {}) })
}

const liveGet = (p: Pc, path: string, params: Record<string, string | number>, extra?: Record<string, string>) => liveRequest(p, LIVE, splice(path, params), 'GET', '', extra)

export function liveCategories(p: Pc) {
  return liveGet(p, '/api/sns/red/live/web/feed/category', {})
}

/** square_feed：extra_info 里的 `:` `,` 保持可读。 */
export function liveSquare(p: Pc, category = '', size = 27) {
  const extra = JSON.stringify({ image_formats: IMAGE_FORMATS })
  const query = `source=13&category=${quote(category, '')}&pre_source=${quote('', '')}&extra_info=${quote(extra, ':,')}&size=${size}`
  return liveRequest(p, LIVE, `/api/sns/red/live/web/feed/v1/squarefeed?${query}`)
}

export function liveRoomInfo(p: Pc, roomId: string, requestUserId: string) {
  if (!requestUserId) throw new CatbusError('AUTH_REQUIRED', '查看直播间需要当前账号的 user_id', { hint: 'catbus xhs auth login' })
  return liveGet(p, '/api/sns/red/live/web/v1/room/current_room_info', { room_id: roomId, request_user_id: requestUserId, source: 'web_live', client_type: 1 }, { 'x-ratelimit-meta': `roomId=${roomId}` })
}

export function liveGiftPanel(p: Pc, hostId: string, roomId: string) {
  return liveGet(p, '/api/sns/red/live/web/gift/v1/gift_panel', { host_id: hostId, room_id: roomId, scene: 'web_gift_panel' })
}

/** aggregate_business_info：直播间商品等业务信息。 */
export function liveBusiness(p: Pc, roomId: string, hostId: string) {
  return liveGet(p, '/api/sns/red/live/web/v1/room/aggregate_business_info', { room_id: roomId, host_id: hostId, client_type: 1 }, { 'x-ratelimit-meta': `roomId=${roomId}&hostId=${hostId}` })
}

export function liveSendComment(p: Pc, roomId: string, comment: string, hostId: string) {
  return liveRequest(p, LIVE, '/api/sns/v1/live/web/interaction/send_comment', 'POST', { room_id: roomId, comment, source: 'web_live', client_type: 1 }, { 'x-ratelimit-meta': `roomId=${roomId}&hostId=${hostId}` })
}

// ================================================================ 私信（XHSLiveAPI 的 IM 接口，edith 域）

const im = (p: Pc, api: string, method: 'GET' | 'POST' = 'GET', data: unknown = '', extra?: Record<string, string>) => liveRequest(p, EDITH, api, method, data, extra)

export function chats(p: Pc, page = 0, limit = 100) {
  return im(p, `/api/im/web/v3/chats?${urlencode([['limit', limit], ['complete', 'true'], ['page', page], ['source', 'pc']])}`)
}

export function messageHistory(p: Pc, chatUserId: string, lastId = 0, limit = 30) {
  return im(p, `/api/im/web/messages/history?${urlencode([['chat_user_id', chatUserId], ['last_id', lastId], ['start_id', 0], ['limit', limit]])}`)
}

/** mark_messages_read：chat_list 每项按实抓字段顺序。 */
export function markRead(p: Pc, chatList: Record<string, unknown>[]) {
  const required = ['chat_id', 'read_store_id', 'unread_count', 'type', 'need_rm_offline']
  const list = chatList.map((item) => {
    const out: Record<string, unknown> = {}
    for (const k of required) out[k] = item[k]
    for (const [k, v] of Object.entries(item)) if (!required.includes(k)) out[k] = v
    return out
  })
  return im(
    p,
    '/api/im/web/v2/messages/read',
    'POST',
    { chat_list: list, chat_total_unread_count: 0, mute_chat_total_unread_count: 0, stranger_total_unread_count: 0 },
    { 'content-type': 'application/json; charset=UTF-8' },
  )
}

/** revoke_message（参数按实抓：chat_user_id、message_id 等由调用方给出）。 */
export function revokeMessage(p: Pc, params: Record<string, unknown>) {
  return im(p, '/api/im/web/messages/revoke', 'POST', params)
}

/** delete_message（GET，query 按调用方给出的顺序）。 */
export function deleteMessage(p: Pc, params: [string, string | number][]) {
  return im(p, `/api/sns/v6/message/web/delete_msg?${urlencode(params)}`)
}

/** send_captured_short_link_message：RSA 加密后的私信 protobuf，经 HTTP 兜底发送。 */
export function sendShortLink(p: Pc, message: string) {
  return im(p, '/api/im/web/short_link/send_message', 'POST', { message })
}
