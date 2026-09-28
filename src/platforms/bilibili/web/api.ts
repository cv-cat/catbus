import { type MultipartPart } from '../../../core/http.js'
import { compactJson, type Pairs, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { Bili } from './client.js'
import { API, headers, LIVE_API, MEMBER, ORIGIN, PASSPORT, PROFILE } from './profile.js'
import { bv2av, dumps, qvId, randomHex } from './sign.js'

/**
 * 上游 apis/*.py 的请求构造，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）。
 * 返回平台原始 JSON 的 data（`call`）或整个 JSON（`raw`）。
 */

const MAIN = ORIGIN.main
const VIDEO_SPMID = '333.788.0.0'
const STATISTICS = '{"appId":100,"platform":5}'
const STATISTICS_DM = '{"appId":100,"platform":5,"abtest":"","version":""}'

/** 设置 web_location：已有同名参数时原位替换，否则追加（上游 with_web_location）。 */
function withLocation(params: Pairs, value: string): Pairs {
  const i = params.findIndex(([k]) => k === 'web_location')
  if (i >= 0) params[i] = ['web_location', value]
  else params.push(['web_location', value])
  return params
}

// ================================================================ 主站（BiliApi）

export function nav(b: Bili) {
  return b.json({ url: `${API}/x/web-interface/nav`, headers: headers('GET', { accept: '*/*' }).get() })
}

export async function searchType(b: Bili, keyword: string, order = 'totalrank', page = 1, searchType = 'video') {
  const h = headers('GET', { origin: ORIGIN.search }).referer(`https://search.bilibili.com/all?keyword=${quote(keyword)}`)
  const params: Pairs = [
    ['__refresh__', 'true'],
    ['_extra', ''],
    ['ad_resource', '5654'],
    ['category_id', ''],
    ['context', ''],
    ['dynamic_offset', (page - 1) * 24],
    ['from_source', ''],
    ['from_spmid', '333.337'],
    ['gaia_vtoken', ''],
    ['highlight', 1],
    ['keyword', keyword],
    ['order', order],
    ['page', page],
    ['page_size', 42],
    ['platform', 'pc'],
    ['qv_id', qvId()],
    ['search_type', searchType],
    ['single_column', 0],
    ['source_tag', 3],
  ]
  return b.get(`${API}/x/web-interface/wbi/search/type`, { headers: h.get(), query: await b.wbi(withLocation(params, '1430654')) })
}

export async function videoInfo(b: Bili, bvid: string) {
  const h = headers('GET').referer(`${MAIN}/video/${bvid}`)
  return b.get(`${API}/x/web-interface/wbi/view`, { headers: h.get(), query: await b.wbi([['bvid', bvid]]) })
}

/** 稿件完整信息，含相关推荐 `Related`（上游 get_video_detail）。 */
export async function videoDetail(b: Bili, bvid: string, page = 1) {
  const h = headers('GET').referer(`${MAIN}/video/${bvid}`)
  const params = withLocation(
    [
      ['aid', bv2av(bvid)],
      ['p', page],
      ['isGaiaAvoided', 'false'],
      ['platform', 'web'],
    ],
    '1315873',
  )
  return b.get(`${API}/x/web-interface/wbi/view/detail`, { headers: h.get(), query: await b.wbi(params) })
}

export async function playerInfo(b: Bili, aid: string | number, cid: string | number) {
  const h = headers('GET').referer(`${MAIN}/`)
  const params = withLocation(
    [
      ['aid', aid],
      ['cid', cid],
      ['isGaiaAvoided', 'false'],
    ],
    '1315873',
  )
  return b.get(`${API}/x/player/wbi/v2`, { headers: h.get(), query: await b.wbiDm(params) })
}

export async function playUrl(b: Bili, bvid: string, cid: string | number, qn = 80, fnval = 4048) {
  const h = headers('GET').referer(`${MAIN}/video/${bvid}`)
  const params: Pairs = [
    ['avid', bv2av(bvid)],
    ['bvid', bvid],
    ['cid', cid],
    ['qn', qn],
    ['fnver', 0],
    ['fnval', fnval],
    ['fourk', 1],
    ['gaia_source', ''],
    ['from_client', 'BROWSER'],
    ['is_main_page', 'true'],
    ['need_fragment', 'false'],
    ['isGaiaAvoided', 'false'],
    ['session', randomHex(32)],
  ]
  return b.get(`${API}/x/player/wbi/playurl`, { headers: h.get(), query: await b.wbi(withLocation(params, '1315873')) })
}

export async function danmakuSeg(b: Bili, aid: string | number, cid: string | number, segment = 1): Promise<Uint8Array> {
  const h = headers('GET', { accept: '*/*' }).referer(`${MAIN}/`)
  const params = withLocation(
    [
      ['type', 1],
      ['oid', cid],
      ['pid', aid],
      ['segment_index', segment],
      ['pull_mode', 1],
      ['ps', 0],
      ['pe', 120000],
    ],
    '1315873',
  )
  return b.bytes({ url: `${API}/x/v2/dm/wbi/web/seg.so`, headers: h.get(), query: await b.wbi(params) })
}

/** 评论区：type 1 视频（oid 为 aid）、12 专栏（cv 号）、17 动态（动态 ID）；mode 3 热门、2 时间。 */
export async function replies(b: Bili, oid: string | number, type = 1, page = 1, mode = 3) {
  const h = headers('GET').referer(`${MAIN}/`)
  const params: Pairs = [
    ['oid', oid],
    ['type', type],
    ['mode', mode],
    ['pagination_str', '{"offset":""}'],
    ['plat', 1],
    ['seek_rpid', ''],
  ]
  if (page > 1) params.push(['next', page])
  return b.get(`${API}/x/v2/reply/wbi/main`, { headers: h.get(), query: await b.wbi(withLocation(params, '1315875')) })
}

export async function userInfo(b: Bili, mid: string) {
  const h = headers('GET', { origin: ORIGIN.space }).referer(`https://space.bilibili.com/${mid}`)
  const params = withLocation(
    [
      ['mid', mid],
      ['token', ''],
      ['platform', 'web'],
    ],
    '1550101',
  )
  return b.get(`${API}/x/space/wbi/acc/info`, { headers: h.get(), query: await b.wbiDm(params) })
}

export async function userVideos(b: Bili, mid: string, page = 1, pageSize = 42, order = 'pubdate', keyword = '') {
  const h = headers('GET', { origin: ORIGIN.space }).referer(`https://space.bilibili.com/${mid}/video`)
  const params = withLocation(
    [
      ['pn', page],
      ['ps', pageSize],
      ['tid', 0],
      ['special_type', ''],
      ['order', order],
      ['mid', mid],
      ['index', 0],
      ['keyword', keyword],
      ['order_avoided', 'true'],
      ['platform', 'web'],
    ],
    '333.1387',
  )
  return b.get(`${API}/x/space/wbi/arc/search`, { headers: h.get(), query: await b.wbiDm(params) })
}

export async function rcmdFeed(b: Bili, freshIdx = 1, ps = 12, lastShowlist = '') {
  const h = headers('GET').referer(`${MAIN}/`)
  const params: Pairs = [
    ['web_location', '1430650'],
    ['y_num', 4],
    ['fresh_type', 4],
    ['feed_version', 'V8'],
    ['fresh_idx_1h', freshIdx],
    ['fetch_row', 4],
    ['fresh_idx', freshIdx],
    ['brush', freshIdx],
    ['device', 'win'],
    ['homepage_ver', 1],
    ['ps', ps],
    ['last_y_num', 5],
    ['screen', PROFILE.browserResolution],
    ['seo_info', ''],
    ['tt_exp', ''],
    ['last_showlist', lastShowlist],
    ['uniq_id', String(rand.randint(10 ** 12, 10 ** 13 - 1))],
  ]
  return b.get(`${API}/x/web-interface/wbi/index/top/feed/rcmd`, { headers: h.get(), query: await b.wbi(params) })
}

export async function popular(b: Bili, page = 1, pageSize = 20) {
  const h = headers('GET').referer(`${MAIN}/v/popular/all/`)
  const params = withLocation(
    [
      ['ps', pageSize],
      ['pn', page],
    ],
    '333.934',
  )
  return b.get(`${API}/x/web-interface/popular`, { headers: h.get(), query: await b.wbi(params) })
}

// ================================================================ 互动（BiliInteractApi）

function playerFields(paused = false, played = 0): Pairs {
  return [
    ['eab_x', paused ? 2 : 1],
    ['ramval', played],
    ['source', 'web_normal'],
    ['ga', 1],
  ]
}

export function like(b: Bili, bvid: string, on = true) {
  const h = headers('FORM').referer(`${MAIN}/video/${bvid}`)
  const form: Pairs = [
    ['aid', bv2av(bvid)],
    ['like', on ? 1 : 2],
    ['from_spmid', ''],
    ['spmid', VIDEO_SPMID],
    ['statistics', STATISTICS],
    ...playerFields(),
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/web-interface/archive/like`, { headers: h.get(), form })
}

export function addCoin(b: Bili, bvid: string, num = 1, alsoLike = false) {
  const h = headers('FORM').referer(`${MAIN}/video/${bvid}`)
  const form: Pairs = [
    ['aid', bv2av(bvid)],
    ['multiply', num],
    ['select_like', alsoLike ? 1 : 0],
    ['cross_domain', 'true'],
    ['from_spmid', ''],
    ['spmid', VIDEO_SPMID],
    ['statistics', STATISTICS],
    ...playerFields(),
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/web-interface/coin/add`, { headers: h.get(), form })
}

/** 我创建的收藏夹；传 rid 时每项带 fav_state（该稿件是否在此收藏夹里）。 */
export function favFolders(b: Bili, mid?: string, rid?: string) {
  const h = headers('GET').referer(`${MAIN}/`)
  const query: Pairs = [['up_mid', mid ?? b.mid]]
  if (rid) query.push(['type', 2], ['rid', rid])
  query.push(['web_location', '333.999'])
  return b.get(`${API}/x/v3/fav/folder/created/list-all`, { headers: h.get(), query })
}

export async function favour(b: Bili, aid: string, addMediaIds = '', delMediaIds = '') {
  if (!addMediaIds && !delMediaIds) {
    const folders = (await favFolders(b))?.list ?? []
    if (!folders.length) throw new Error('没有可用的收藏夹')
    addMediaIds = String(folders[0].id)
  }
  const h = headers('FORM').referer(`${MAIN}/`)
  const form: Pairs = [
    ['rid', aid],
    ['type', 2],
  ]
  if (addMediaIds) form.push(['add_media_ids', addMediaIds])
  if (delMediaIds) form.push(['del_media_ids', delMediaIds])
  form.push(['platform', 'web'], ['from_spmid', ''], ['spmid', VIDEO_SPMID], ['statistics', STATISTICS], ['csrf', b.csrf])
  return b.post(`${API}/x/v3/fav/resource/deal`, { headers: h.get(), form })
}

export function triple(b: Bili, bvid: string) {
  const h = headers('FORM').referer(`${MAIN}/video/${bvid}`)
  const form: Pairs = [
    ['aid', bv2av(bvid)],
    ['from_spmid', ''],
    ['spmid', VIDEO_SPMID],
    ['statistics', STATISTICS],
    ...playerFields(),
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/web-interface/archive/like/triple`, { headers: h.get(), form })
}

/** 发评论；回复楼中楼时 root 为根评论、parent 为被回复的那条，parent 缺省同 root。 */
export async function addReply(b: Bili, oid: string, message: string, type = 1, root: string | number = '', parent: string | number = '') {
  const h = headers('FORM').referer(`${MAIN}/`)
  const query = await b.wbiDm([])
  const form: Pairs = [
    ['plat', 1],
    ['oid', oid],
    ['type', type],
    ['message', message],
    ['at_name_to_mid', '{}'],
  ]
  if (root) form.push(['root', root], ['parent', parent || root])
  form.push(['gaia_source', 'main_web'], ['csrf', b.csrf], ['statistics', STATISTICS])
  return b.post(`${API}/x/v2/reply/add`, { headers: h.get(), query, form })
}

export function deleteReply(b: Bili, oid: string, rpid: string, type = 1) {
  const h = headers('FORM').referer(`${MAIN}/`)
  const form: Pairs = [
    ['oid', oid],
    ['type', type],
    ['rpid', rpid],
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/v2/reply/del`, { headers: h.get(), form })
}

/** 弹幕的 rnd：会话内自增序号（上游 itertools.count(1)），每条命令从 1 开始。 */
let dmSeq = 0

export interface DanmakuStyle {
  /** 十进制颜色，默认白色。 */
  color?: number
  fontsize?: number
  /** 1 滚动、4 底部、5 顶部。 */
  mode?: number
}

export async function sendVideoDanmaku(b: Bili, aid: string, cid: string | number, message: string, progress = 0, style: DanmakuStyle = {}) {
  const h = headers('FORM').referer(`${MAIN}/`)
  const query = await b.wbiDm([
    ['web_location', '1315873'],
    ['csrf', b.csrf],
  ])
  const form: Pairs = [
    ['color', style.color ?? 16777215],
    ['fontsize', style.fontsize ?? 25],
    ['pool', 0],
    ['mode', style.mode ?? 1],
    ['type', 1],
    ['oid', cid],
    ['msg', message],
    ['aid', aid],
    ['progress', progress],
    ['rnd', ++dmSeq],
    ['plat', 1],
    ['checkbox_type', 0],
    ['colorful', ''],
    ['gaiasource', 'main_web'],
    ['polaris_app_id', 100],
    ['polaris_platform', 5],
    ['spmid', VIDEO_SPMID],
    ['from_spmid', VIDEO_SPMID],
    ['statistics', STATISTICS_DM],
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/v2/dm/post`, { headers: h.get(), query, form })
}

// ================================================================ 创作（BiliCreatorApi）

const UPLOAD_PAGE = 'https://member.bilibili.com/platform/upload/video/frame'

export function archivePre(b: Bili) {
  const h = headers('GET', { origin: ORIGIN.member, sameOrigin: true }).referer(UPLOAD_PAGE)
  return b.get(`${MEMBER}/x/vupre/web/archive/pre`, {
    headers: h.get(),
    query: [
      ['lang', 'cn'],
      ['t', rand.now()],
    ],
  })
}

export function myArchives(b: Bili, page = 1, pageSize = 20, status = 'is_pubing,pubed,not_pubed') {
  const h = headers('GET', { origin: ORIGIN.member, sameOrigin: true })
  return b.get(`${MEMBER}/x/web/archives`, {
    headers: h.get(),
    query: [
      ['status', status],
      ['pn', page],
      ['ps', pageSize],
      ['coop', 1],
      ['interactive', 1],
    ],
  })
}

export function uploadCover(b: Bili, data: Uint8Array, suffix: string) {
  const h = headers('FORM', { origin: ORIGIN.member, sameOrigin: true })
  const form: Pairs = [
    ['cover', `data:image/${suffix};base64,${Buffer.from(data).toString('base64')}`],
    ['csrf', b.csrf],
  ]
  return b.post(`${MEMBER}/x/vu/web/cover/up`, { headers: h.get(), form })
}

export interface ArchiveInput {
  /** 每项一个分 P。 */
  videos: { filename: string; title?: string; desc?: string; biz_id?: unknown }[]
  title: string
  tid: number
  tag: string
  cover?: string
  desc?: string
  /** 1 自制、2 转载。 */
  copyright?: number
  /** 转载来源，copyright 为 2 时必填。 */
  source?: string
  private?: boolean
  /** 同步到动态的文案。 */
  dynamic?: string
  /** 1 禁止转载。 */
  noReprint?: number
}

export function submitArchive(b: Bili, a: ArchiveInput) {
  const h = headers('POST', { origin: ORIGIN.member, sameOrigin: true }).referer(UPLOAD_PAGE)
  const body = {
    copyright: a.copyright ?? 1,
    source: a.source ?? '',
    cover: a.cover ?? '',
    title: a.title,
    tid: a.tid,
    tag: a.tag,
    desc: a.desc ?? '',
    desc_format_id: 0,
    dynamic: a.dynamic ?? '',
    recreate: -1,
    interactive: 0,
    no_reprint: a.noReprint ?? 1,
    subtitle: { open: 0, lan: '' },
    videos: a.videos.map((v) => ({ filename: v.filename, title: v.title || a.title, desc: v.desc ?? '', cid: v.biz_id ?? null })),
    human_type2: 0,
    topic_id: 0,
    mission_id: 0,
    topic_name: '',
    topic_from: '',
    act_reserve_create: 0,
    is_only_self: a.private === false ? 0 : 1,
    web_os: 2,
    csrf: b.csrf,
  }
  return b.post(`${MEMBER}/x/vu/web/add/v3`, {
    headers: h.get(),
    query: [
      ['web_location', '333.1024'],
      ['t', rand.now()],
      ['csrf', b.csrf],
    ],
    json: body,
  })
}

/** 撤稿。平台要求先过极验，不带验证结果固定返回 340022（上游 delete_archive）。 */
export function deleteArchive(b: Bili, aid: string, gt?: { validate: string; seccode?: string; challenge?: string }) {
  const h = headers('FORM', { origin: ORIGIN.member, sameOrigin: true }).referer('https://member.bilibili.com/platform/upload-manager/article')
  const form: Pairs = [
    ['aid', aid],
    ['csrf', b.csrf],
  ]
  if (gt?.validate) form.push(['validate', gt.validate], ['seccode', gt.seccode || `${gt.validate}|jordan`], ['challenge', gt.challenge ?? ''])
  return b.post(`${MEMBER}/x/web/archive/delete`, { headers: h.get(), form })
}

export function uploadDynamicImage(b: Bili, data: Uint8Array, filename: string, contentType: string) {
  const h = headers('GET', { origin: ORIGIN.dynamic })
  const multipart: MultipartPart[] = [
    { name: 'file_up', filename, data, contentType },
    { name: 'biz', data: 'new_dyn' },
    { name: 'category', data: 'daily' },
    { name: 'csrf', data: b.csrf },
  ]
  return b.post(`${API}/x/dynamic/feed/draw/upload_bfs`, { headers: h.get(), multipart, timeout: 120 })
}

export interface DynPic {
  img_src: string
  img_width: number
  img_height: number
  img_size: number
}

export function createDynamic(b: Bili, text: string, pics: DynPic[]) {
  const h = headers('POST', { origin: ORIGIN.dynamic })
  const dynReq: Record<string, unknown> = {
    content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
    scene: pics.length ? 2 : 1,
    attach_card: null,
    upload_id: `${b.mid}_${rand.nowSeconds()}_${rand.randint(1000, 9999)}`,
    meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
  }
  if (pics.length) dynReq.pics = pics
  return b.post(`${API}/x/dynamic/feed/create/dyn`, {
    headers: h.get(),
    query: [
      ['platform', 'web'],
      ['csrf', b.csrf],
    ],
    json: { dyn_req: dynReq },
  })
}

export function removeDynamic(b: Bili, id: string) {
  const h = headers('POST', { origin: ORIGIN.dynamic })
  return b.post(`${API}/x/dynamic/feed/operate/remove`, { headers: h.get(), query: [['csrf', b.csrf]], json: { dyn_id_str: id } })
}

export interface ArticleInput {
  title: string
  /** HTML 正文。 */
  content: string
  category?: number
  bannerUrl?: string
  /** 逗号分隔。 */
  tags?: string
  summary?: string
}

function articleForm(b: Bili, a: ArticleInput): Pairs {
  return [
    ['title', a.title],
    ['content', a.content],
    ['summary', a.summary ?? ''],
    ['banner_url', a.bannerUrl ?? ''],
    ['category', a.category ?? 0],
    ['tags', a.tags ?? ''],
    ['list_id', 0],
    ['reprint', 0],
    ['media_id', 0],
    ['spoiler', 0],
    ['original', 1],
    ['csrf', b.csrf],
  ]
}

const EDITOR = 'https://member.bilibili.com/read/editor/'

/** 保存专栏草稿；传 aid 时更新已有草稿。返回的 aid 是草稿 ID。 */
export function saveArticleDraft(b: Bili, a: ArticleInput, aid?: string) {
  const h = headers('FORM').referer(EDITOR)
  const form = articleForm(b, a)
  if (aid) form.push(['aid', aid])
  return b.post(`${API}/x/article/creative/draft/addupdate`, { headers: h.get(), form })
}

export function submitArticle(b: Bili, aid: string, a: ArticleInput) {
  const h = headers('FORM').referer(EDITOR)
  return b.post(`${API}/x/article/creative/article/submit`, { headers: h.get(), form: [['aid', aid], ...articleForm(b, a)] })
}

/** 按 ID 读专栏草稿（上游 get_article_draft）。 */
export function articleDraft(b: Bili, aid: string) {
  return b.get(`${API}/x/article/creative/draft/view`, { headers: headers('GET').referer(EDITOR).get(), query: [['aid', aid]] })
}

export function deleteArticleDraft(b: Bili, aid: string) {
  const form: Pairs = [
    ['aid', aid],
    ['csrf', b.csrf],
  ]
  return b.post(`${API}/x/article/creative/draft/delete`, { headers: headers('FORM').referer(EDITOR).get(), form })
}

// ================================================================ 直播（BiliLiveApi）

const LIVE = ORIGIN.live

export function roomInit(b: Bili, roomId: string) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  return b.get(`${LIVE_API}/room/v1/Room/room_init`, { headers: h.get(), query: [['id', roomId]] })
}

export function roomByMid(b: Bili, mid: string) {
  return b.get(`${LIVE_API}/room/v1/Room/getRoomInfoOld`, { headers: headers('GET', { origin: LIVE }).get(), query: [['mid', mid]] })
}

export async function roomInfo(b: Bili, roomId: string | number) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const params = withLocation([['room_id', roomId]], '444.8')
  return b.get(`${LIVE_API}/xlive/web-room/v1/index/getInfoByRoom`, { headers: h.get(), query: await b.wbi(params) })
}

export async function roomPlayInfo(b: Bili, roomId: string | number, qn = 0) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const params: Pairs = [
    ['room_id', roomId],
    ['protocol', '0,1'],
    ['format', '0,1,2'],
    ['codec', '0,1,2'],
    ['qn', qn],
    ['platform', 'web'],
    ['ptype', 8],
    ['dolby', 5],
    ['panorama', 1],
    ['eotf', '0,1,2'],
    ['supported_drms', '0,1,2,3'],
    ['req_reason', 0],
  ]
  return b.get(`${LIVE_API}/xlive/web-room/v2/index/getRoomPlayInfo`, { headers: h.get(), query: await b.wbi(withLocation(params, '444.8')) })
}

export async function danmuInfo(b: Bili, roomId: string | number) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const params = withLocation(
    [
      ['id', roomId],
      ['type', 0],
    ],
    '444.8',
  )
  return b.get(`${LIVE_API}/xlive/web-room/v1/index/getDanmuInfo`, { headers: h.get(), query: await b.wbi(params) })
}

export function danmakuHistory(b: Bili, roomId: string | number) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  return b.get(`${LIVE_API}/xlive/web-room/v1/dM/gethistory`, {
    headers: h.get(),
    query: [
      ['roomid', roomId],
      ['room_type', 0],
    ],
  })
}

export async function giftList(b: Bili, roomId: string | number, areaParentId: number | string, areaId: number | string, ruid: string | number) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const params: Pairs = [
    ['platform', 'pc'],
    ['room_id', roomId],
    ['area_parent_id', areaParentId],
    ['area_id', areaId],
    ['source', 'live'],
    ['build', 0],
    ['ruid', ruid],
    ['base_version', 0],
    ['receive_users', ''],
  ]
  return b.get(`${LIVE_API}/xlive/web-room/v1/giftPanel/roomGiftList`, { headers: h.get(), query: await b.wbi(withLocation(params, '444.8')) })
}

export function areaList(b: Bili) {
  return b.get(`${LIVE_API}/xlive/web-interface/v1/index/getWebAreaList`, { headers: headers('GET', { origin: LIVE }).get(), query: [['source_id', 2]] })
}

export function bagList(b: Bili, roomId: string | number) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  return b.get(`${LIVE_API}/xlive/web-room/v1/gift/bag_list`, {
    headers: h.get(),
    query: [
      ['t', rand.now()],
      ['room_id', roomId],
    ],
  })
}

export function sendGift(
  b: Bili,
  roomId: string | number,
  ruid: string | number,
  giftId: string | number,
  giftNum = 1,
  bagId: string | number = 0,
  coinType = 'silver',
  price = 0,
) {
  const path = bagId && bagId !== '0' ? '/xlive/revenue/v2/gift/sendBagMultiUser' : coinType === 'gold' ? '/xlive/revenue/v2/gift/sendGoldMultiUser' : '/xlive/revenue/v2/gift/sendSilverMultiUser'
  const h = headers('FORM', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const query: Pairs = [
    ['uid', b.mid],
    ['gift_id', giftId],
    ['ruid', ruid],
    ['send_ruid', 0],
    ['gift_num', giftNum],
    ['coin_type', coinType],
    ['bag_id', bagId],
    ['platform', 'pc'],
    ['biz_code', 'Live'],
    ['biz_id', roomId],
    ['storm_beat_id', 0],
    ['metadata', ''],
    ['price', price],
    ['receive_users', dumps([{ uid: Number(ruid) }])],
    ['all_flag', 1],
    [
      'live_statistics',
      dumps({
        pc_client: 'pc_web',
        jumpfrom: '-99998',
        room_category: '-99998',
        source_event: 0,
        official_channel: { program_room_id: '-99998', program_up_id: '-99998' },
      }),
    ],
    ['statistics', dumps({ platform: 5, pc_client: 'pc_web', appId: 100 })],
    ['web_location', '444.8'],
    ['csrf_token', b.csrf],
    ['csrf', b.csrf],
    ['visit_id', ''],
  ]
  return b.post(`${LIVE_API}${path}`, { headers: h.get(), query })
}

export interface LiveDanmakuStyle extends DanmakuStyle {
  /** 回复某位观众。 */
  replyMid?: string | number
  replyUname?: string
}

export async function sendLiveDanmaku(b: Bili, roomId: string | number, msg: string, style: LiveDanmakuStyle = {}) {
  const h = headers('GET', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const query = await b.wbi([['web_location', '444.8']])
  const fields: [string, string | number][] = [
    ['bubble', 0],
    ['msg', msg],
    ['color', style.color ?? 16777215],
    ['mode', style.mode ?? 1],
    ['room_type', 0],
    ['jumpfrom', 0],
    ['reply_mid', style.replyMid ?? 0],
    ['reply_attr', 0],
    ['replay_dmid', ''],
    ['statistics', STATISTICS],
    ['reply_type', 0],
    ['reply_uname', style.replyUname ?? ''],
    ['data_extend', dumps({ trackid: '-99998' })],
    ['fontsize', style.fontsize ?? 25],
    ['rnd', rand.nowSeconds()],
    ['roomid', roomId],
    ['csrf', b.csrf],
    ['csrf_token', b.csrf],
  ]
  const multipart: MultipartPart[] = fields.map(([name, value]) => ({ name, data: String(value) }))
  return b.post(`${LIVE_API}/msg/send`, { headers: h.get(), query, multipart })
}

export function startLive(b: Bili, roomId: string | number, areaV2: string | number, platform = 'pc_link') {
  const h = headers('FORM', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const form: Pairs = [
    ['room_id', roomId],
    ['platform', platform],
    ['area_v2', areaV2],
    ['backup_stream', 0],
    ['csrf', b.csrf],
    ['csrf_token', b.csrf],
  ]
  return b.post(`${LIVE_API}/room/v1/Room/startLive`, { headers: h.get(), form })
}

export function stopLive(b: Bili, roomId: string | number, platform = 'pc_link') {
  const h = headers('FORM', { origin: LIVE }).referer(`${LIVE}/${roomId}`)
  const form: Pairs = [
    ['room_id', roomId],
    ['platform', platform],
    ['csrf', b.csrf],
    ['csrf_token', b.csrf],
  ]
  return b.post(`${LIVE_API}/room/v1/Room/stopLive`, { headers: h.get(), form })
}

// ================================================================ 登录（BiliLoginApi）

const LOCALE_JSON = compactJson({ c_locale: { language: 'zh', region: 'CN' }, always_translate: true })

function passportParams(params: Pairs): Pairs {
  const merged = [...params]
  if (!merged.some(([k]) => k === 'web_location')) merged.push(['web_location', '333.1228'])
  merged.push(['x-bili-redirect', 1], ['x-bili-locale-json', LOCALE_JSON])
  return merged
}

const PASSPORT_BARE: Pairs = [
  ['x-bili-redirect', 1],
  ['x-bili-locale-json', LOCALE_JSON],
]

function passportHeaders(type: 'GET' | 'FORM' = 'GET') {
  return headers(type, { origin: PASSPORT, accept: '*/*', sameOrigin: true }).set('accept-language', 'zh-CN,zh;q=0.9').referer(`${PASSPORT}/login`).get()
}

export function qrcodeGenerate(b: Bili) {
  return b.json<{ url: string; qrcode_key: string }>({
    url: `${PASSPORT}/x/passport-login/web/qrcode/generate`,
    headers: passportHeaders(),
    query: passportParams([
      ['source', 'main_web'],
      ['go_url', ''],
    ]),
  })
}

export function qrcodePoll(b: Bili, qrcodeKey: string, bRet: string) {
  const query = passportParams([
    ['qrcode_key', qrcodeKey],
    ['source', 'main_web'],
  ])
  if (bRet) query.push(['b_ret', bRet])
  return b.json<{ code: number; message: string; refresh_token?: string }>({
    url: `${PASSPORT}/x/passport-login/web/qrcode/poll`,
    headers: passportHeaders(),
    query,
  })
}

export function captcha(b: Bili) {
  return b.json<{ token: string; geetest: { gt: string; challenge: string } }>({
    url: `${PASSPORT}/x/passport-login/captcha`,
    headers: passportHeaders(),
    query: passportParams([['source', 'main-fe']]),
  })
}

export interface Geetest {
  token: string
  challenge: string
  validate: string
  seccode?: string
}

export function smsSend(b: Bili, tel: string, gt: Geetest, cid = 86) {
  const form: Pairs = [
    ['source', 'main_web'],
    ['tel', tel],
    ['cid', cid],
    ['go_url', ''],
    ['token', gt.token],
    ['validate', gt.validate],
    ['seccode', gt.seccode || `${gt.validate}|jordan`],
    ['challenge', gt.challenge],
  ]
  return b.json<{ captcha_key: string }>({
    method: 'POST',
    url: `${PASSPORT}/x/passport-login/web/sms/send`,
    headers: passportHeaders('FORM'),
    query: PASSPORT_BARE,
    form,
  })
}

export function smsLogin(b: Bili, tel: string, code: string, captchaKey: string, cid = 86) {
  const form: Pairs = [
    ['source', 'main_web'],
    ['captcha_key', captchaKey],
    ['cid', cid],
    ['tel', tel],
    ['code', code],
    ['go_url', ''],
  ]
  return b.json<{ refresh_token?: string }>({
    method: 'POST',
    url: `${PASSPORT}/x/passport-login/web/login/sms`,
    headers: passportHeaders('FORM'),
    query: PASSPORT_BARE,
    form,
  })
}

export function loginKey(b: Bili) {
  const h = headers('GET', { origin: PASSPORT }).referer(`${PASSPORT}/login`)
  return b.json<{ hash: string; key: string }>({ url: `${PASSPORT}/x/passport-login/web/key`, headers: h.get() })
}

export function passwordLogin(b: Bili, username: string, encPassword: string, gt: Geetest) {
  const h = headers('FORM', { origin: PASSPORT }).referer(`${PASSPORT}/login`)
  const form: Pairs = [
    ['username', username],
    ['password', encPassword],
    ['keep', 0],
    ['token', gt.token],
    ['challenge', gt.challenge],
    ['validate', gt.validate],
    ['seccode', gt.seccode || `${gt.validate}|jordan`],
    ['source', 'main-fe-header'],
    ['go_url', 'https://www.bilibili.com/'],
  ]
  return b.json<{ refresh_token?: string }>({ method: 'POST', url: `${PASSPORT}/x/passport-login/web/login`, headers: h.get(), form })
}

export function cookieInfo(b: Bili) {
  return b.json<{ refresh: boolean; timestamp: number }>({
    url: `${PASSPORT}/x/passport-login/web/cookie/info`,
    headers: headers('GET', { origin: PASSPORT }).get(),
    query: [
      ['web_location', '333.788'],
      ['csrf', b.csrf],
    ],
  })
}

export async function refreshCsrf(b: Bili, correspondPath: string): Promise<string> {
  const h = headers('DOC').remove('sec-fetch-user').set('sec-fetch-site', 'same-origin').set('sec-fetch-dest', 'iframe')
  h.insertBefore('accept-encoding', 'referer', 'https://www.bilibili.com/')
  const res = await b.request({ url: `https://www.bilibili.com/correspond/1/${correspondPath}`, headers: h.get() })
  if (res.status !== 200) return ''
  return /id="1-name"[^>]*>\s*([^<\s]+)\s*</.exec(await res.text())?.[1] ?? ''
}

export function cookieRefresh(b: Bili, refreshCsrf: string, refreshToken: string) {
  const form: Pairs = [
    ['csrf', b.csrf],
    ['refresh_csrf', refreshCsrf],
    ['source', 'main_web'],
    ['refresh_token', refreshToken],
  ]
  return b.json<{ refresh_token?: string }>({ method: 'POST', url: `${PASSPORT}/x/passport-login/web/cookie/refresh`, headers: headers('FORM').get(), form })
}

export function confirmRefresh(b: Bili, oldRefreshToken: string) {
  const form: Pairs = [
    ['csrf', b.csrf],
    ['refresh_token', oldRefreshToken],
  ]
  return b.json({ method: 'POST', url: `${PASSPORT}/x/passport-login/web/confirm/refresh`, headers: headers('FORM').get(), form })
}

export function logout(b: Bili) {
  return b.json({ method: 'POST', url: `${PASSPORT}/login/exit/v2`, headers: headers('FORM', { origin: PASSPORT }).get(), form: [['biliCSRF', b.csrf]] })
}
