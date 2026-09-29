import { CatbusError } from '../../../core/errors.js'
import { downloadMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential, showQrcode, smsLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Credential, Item, Media, Message, User } from '../../../core/schemas.js'
import { authError, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { check, Douyin, douyin } from './client.js'
import * as creator from './creator.js'
import { buildBlob, DTRAIT_BROKEN, DTRAIT_HINT } from './dtrait.js'
import * as im from './im.js'
import * as live from './live.js'
import * as norm from './normalize.js'
import { Passport } from './passport.js'
import { PROFILE, WWW, WWW_ONLY } from './profile.js'
import { resolveItem, resolveProduct, resolveRoom, resolveShare, resolveUser } from './resolve.js'

type Ctx = HandlerContext
const cursor = (ctx: Ctx, dflt = '0') => ctx.cursor ?? dflt
const more = (v: unknown) => v === 1 || v === true
const isAuthError = (err: unknown) => err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')

// ================================================================ auth

/**
 * 在线校验：只有 query/user 表明没登录（AUTH_*：没有 user_uid 或为 0）才算未登录；
 * 风控（空响应、acrawler、Uifid）、网络、业务错误原样抛出，不误报成未登录。
 */
export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const loggedOut: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  const d = await douyin(ctx)
  if (!d.isLogin) return loggedOut
  let uid: string
  try {
    uid = await api.myUid(d)
  } catch (err) {
    if (isAuthError(err)) return loggedOut
    throw err
  }
  d.tokens.uid = uid
  // sec_uid 取不到（创作者接口与主页 HTML 都没给）时沿用凭证里的用户，登录态本身已经由 uid 确认
  const me = await api.mySecUid(d).catch((err) => {
    if (err instanceof CatbusError) throw err
    ctx.log.debug(`取 sec_uid 失败：${(err as Error).message}`)
    return null
  })
  const sess = d.jar.find((c) => c.name === 'sessionid')
  const user = me ? norm.ref(me.secUid, me.user?.nickname ?? ctx.credential.user?.name) : ctx.credential.user
  return { logged_in: true, user, method: ctx.credential.method, expires_at: sess?.expires ? n.time(sess.expires) : null }
}

// ================================================================ user

/** 用户资料（profile/other）；me 先经创作者中心取自己的 sec_uid。 */
async function profile(d: Douyin, input: string): Promise<any> {
  const secUid = await resolveUser(d, input)
  const body = check(d.ctx, await api.userInfo(d, secUid))
  if (!body.user) throw new CatbusError('UPSTREAM', `没有找到用户：${input}`, { detail: { status_code: body.status_code } })
  return body.user
}

export async function userGet(ctx: Ctx): Promise<User> {
  const d = await douyin(ctx)
  return norm.user(await profile(d, ctx.args.user!))
}

const USER_TYPE: Record<string, string> = { common: 'common_user', enterprise: 'enterprise_user', personal: 'personal_user' }

export async function userSearch(ctx: Ctx) {
  const d = await douyin(ctx)
  const offset = cursor(ctx)
  const fans = (ctx.options.fans as string | undefined) ?? ''
  const userType = USER_TYPE[(ctx.options.userType as string | undefined) ?? ''] ?? ''
  const body = check(ctx, await api.searchUser(d, ctx.args.keyword!, offset, '25', fans, userType))
  const list = (body.user_list ?? []).map((x: any) => norm.user(x.user_info ?? x))
  // 游标是自己算的偏移：服务端给 has_more=1 却返回空列表时要停下，否则 --all 一直翻
  return paged(list, Number(offset) + 25, more(body.has_more) && list.length > 0)
}

export async function userItems(ctx: Ctx) {
  const d = await douyin(ctx)
  const secUid = await resolveUser(d, ctx.args.user!)
  const body = check(ctx, await api.userWorks(d, secUid, cursor(ctx), secUid === ctx.credential.user?.id))
  return paged((body.aweme_list ?? []).map(norm.aweme), body.max_cursor, more(body.has_more))
}

/**
 * 缺 UIFID 时自动补上，再把整条命令重跑一次：UIFID 由服务端在推荐流的响应里下发（实测 2026-09），扫码 / 短信登录后
 * 凭证里还没有它，个别接口（如 user likes）会报 "Uifid Not Found"。正常路径不多发请求，与上游一致。
 * 整条重跑只对读取类命令安全，注册表只给它们套上（index.ts）；写操作重跑会把已经做完的步骤再做一遍。
 */
export function retryWithUifid(handler: (ctx: Ctx) => unknown): (ctx: Ctx) => unknown {
  return (ctx: Ctx) => {
    const result = handler(ctx)
    // 长连接的 handler 同步返回 AsyncIterable，原样交回
    if (!(result instanceof Promise)) return result
    return result.catch(async (err: unknown) => {
      const reason = err instanceof CatbusError ? (err.detail as { reason?: string } | null)?.reason : undefined
      if (reason !== 'uifid') throw err
      const d = await douyin(ctx)
      if (d.cookie('UIFID')) throw err
      ctx.log.info('凭证里缺 UIFID，先请求一次推荐流取回，然后重试')
      await api.feed(d)
      if (!d.cookie('UIFID')) throw err
      return handler(ctx)
    })
  }
}

export async function userLikes(ctx: Ctx) {
  const d = await douyin(ctx)
  const secUid = await resolveUser(d, ctx.args.user ?? 'me')
  const body = check(ctx, await api.userFavorite(d, secUid, cursor(ctx)))
  return paged((body.aweme_list ?? []).map(norm.aweme), body.max_cursor, more(body.has_more))
}

async function relations(ctx: Ctx, kind: 'followers' | 'following') {
  const d = await douyin(ctx)
  const u = await profile(d, ctx.args.user ?? 'me')
  const maxTime = ctx.cursor ?? (kind === 'followers' ? '' : '0')
  const body = check(ctx, await (kind === 'followers' ? api.followers(d, n.id(u.uid), u.sec_uid, maxTime) : api.following(d, n.id(u.uid), u.sec_uid, maxTime)))
  const list = (body[kind === 'followers' ? 'followers' : 'followings'] ?? []).map(norm.user)
  return paged(list, body.min_time, more(body.has_more))
}
export const userFollowers = (ctx: Ctx) => relations(ctx, 'followers')
export const userFollowing = (ctx: Ctx) => relations(ctx, 'following')

// ================================================================ item

async function detail(d: Douyin, input: string): Promise<any> {
  const id = await resolveItem(d, input)
  const body = check(d.ctx, await api.workInfo(d, id))
  if (!body.aweme_detail) throw new CatbusError('UPSTREAM', `作品不存在或不可见：${id}`, { detail: { status_code: body.status_code, filter: body.filter_detail ?? null } })
  return body.aweme_detail
}

export async function itemGet(ctx: Ctx): Promise<Item> {
  const d = await douyin(ctx)
  return norm.aweme(await detail(d, ctx.args.item!))
}

/** 搜索筛选的标准取值 → 上游参数（AGENTS 4.9 / 4.7）。 */
const SEARCH_SORT: Record<string, string> = { general: '0', popular: '1', latest: '2' }
const SEARCH_TIME: Record<string, string> = { all: '0', day: '1', week: '7', half_year: '180' }
const SEARCH_LENGTH: Record<string, string> = { all: '', short: '0-1', medium: '1-5', long: '5-10000' }
const SEARCH_RANGE: Record<string, string> = { seen: '1', unseen: '2', following: '3' }
const VIDEO_PAGE = 16

/**
 * `item search` 的筛选：综合频道（上游 search_general_work）只把 is_filter_search 置 1；`--type video` 走视频频道（search_video_work）。
 * 综合频道的 content_type 同样不进 query，所以注册表不支持 `--type image`，这里不再给它取值。
 */
export function searchFilters(o: Record<string, unknown>, video: boolean): api.SearchFilters {
  const range = SEARCH_RANGE[o.range as string] ?? ''
  return {
    sortType: SEARCH_SORT[(o.sort as string) ?? 'general'] ?? '0',
    publishTime: SEARCH_TIME[(o.time as string) ?? 'all'] ?? '0',
    filterDuration: SEARCH_LENGTH[(o.length as string) ?? 'all'] ?? '',
    searchRange: video ? range || '0' : range,
    contentType: video ? undefined : '',
  }
}

export async function itemSearch(ctx: Ctx) {
  const d = await douyin(ctx)
  const keyword = ctx.args.keyword!
  if (ctx.options.type === 'video') {
    // 视频频道：cursor 是「偏移,上一页的 X-Tt-Logid」，翻页时 search_id 带上它（上游 search_some_video_work）
    const [offset = '0', searchId = ''] = (ctx.cursor ?? '0').split(',')
    const [next, raw] = await api.searchVideo(d, keyword, offset, String(VIDEO_PAGE), searchFilters(ctx.options, true), searchId)
    const body = check(ctx, raw)
    const data: any[] = body.data ?? []
    const list = data.map((x) => x.aweme_info ?? x).filter((x) => x?.aweme_id).map(norm.aweme)
    return paged(list, `${Number(offset) + VIDEO_PAGE},${next}`, more(body.has_more) && data.length > 0)
  }
  const offset = cursor(ctx)
  const f = searchFilters(ctx.options, false)
  if (f.sortType !== '0' || f.publishTime !== '0' || f.filterDuration || f.searchRange) {
    ctx.log.info('综合搜索照上游只标记 is_filter_search，筛选值不随请求发出；要按筛选取视频，加 --type video')
  }
  const body = check(ctx, await api.searchGeneral(d, keyword, offset, '', f))
  const data: any[] = body.data ?? []
  const list = data.filter((x) => x.aweme_info).map((x) => norm.aweme(x.aweme_info))
  return paged(list, Number(offset) + data.length, more(body.has_more) && data.length > 0)
}

/** 自己的作品（创作者中心的作品预览 work_list），带审核 / 私密 / 定时状态。 */
export async function itemList(ctx: Ctx) {
  const d = await douyin(ctx)
  d.requireLogin()
  await creator.bootstrap(d)
  const body = check(ctx, await creator.workList(d, cursor(ctx)))
  return paged((body.aweme_list ?? []).map(norm.work), body.max_cursor, more(body.has_more))
}

export async function itemMedia(ctx: Ctx) {
  const d = await douyin(ctx)
  return norm.awemeMedia(await detail(d, ctx.args.item!))
}

export async function itemDownload(ctx: Ctx) {
  const d = await douyin(ctx)
  const v = await detail(d, ctx.args.item!)
  return downloadMedia(ctx, d.http, n.id(v.aweme_id), norm.awemeMedia(v), {
    headers: [
      ['user-agent', PROFILE.ua],
      ['referer', `${WWW}/`],
    ],
    ext: (m) => (m.type === 'image' ? 'jpg' : 'mp4'),
  })
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  const d = await douyin(ctx)
  const input = ctx.args.item!
  if (ctx.options.product || /jinritemai|haohuo|product_id=|promotion_id=/.test(input)) return productComments(ctx, d, input)
  if (ctx.options.label != null) throw new CatbusError('USAGE', '--label 只用于商品评价', { hint: 'catbus douyin comment list <商品 url> --product --label <标签>' })
  const id = await resolveItem(d, input)
  const body = check(ctx, await api.comments(d, id, cursor(ctx)))
  const list = (body.comments ?? []).map((c: any) => norm.comment(c, id))
  return paged(list, body.cursor, more(body.has_more))
}

/**
 * 商品评价。带 `--label` 时游标是「服务端游标,tag_id」：标签只在第一页解析一次（comment/counter），翻页时从游标里取。
 */
async function productComments(ctx: Ctx, d: Douyin, input: string) {
  const p = resolveProduct(input)
  if (!p.productId || !p.shopId) {
    throw new CatbusError('USAGE', '商品评价需要 product_id 和 shop_id', { hint: '传 catbus douyin live products 输出的商品 url（带 id 和 shop_id 参数）' })
  }
  const labeled = ctx.options.label != null
  let [offset = '0', tagId = ''] = labeled ? (ctx.cursor ?? '').split(',') : [cursor(ctx)]
  if (labeled && !tagId) tagId = await productLabel(ctx, d, p.productId, p.shopId, String(ctx.options.label))
  offset ||= '0'
  const body = check(ctx, await api.productComments(d, p.productId, p.shopId, offset, '10', '0', tagId))
  const data = body.data ?? {}
  const list = (data.Comments ?? data.comments ?? []).map((c: any) => norm.productComment(c, p.promotionId))
  const next = data.Cursor ?? data.cursor ?? Number(offset) + list.length
  return paged(list, labeled ? `${next},${tagId}` : next, Boolean(data.HasMore ?? data.has_more))
}

/** `--label`：先取评价的分类计数（comment/counter），按名字或 id 找到 tag_id。 */
async function productLabel(ctx: Ctx, d: Douyin, productId: string, shopId: string, label: string): Promise<string> {
  const labels = norm.commentLabels(check(ctx, await api.productCommentCounter(d, productId, shopId)))
  const hit = labels.find((x) => x.id === label || x.name === label)
  if (hit) return hit.id
  if (/^\d+$/.test(label)) return label
  throw new CatbusError('USAGE', `没有这个评价标签：${label}`, { hint: labels.length ? `可选：${labels.map((x) => x.name).join('、')}` : '这个商品没有返回评价标签' })
}

export async function commentReplies(ctx: Ctx) {
  const d = await douyin(ctx)
  const id = await resolveItem(d, ctx.args.item!)
  const body = check(ctx, await api.replies(d, id, ctx.args.comment!, cursor(ctx), '10'))
  const list = (body.comments ?? []).map((c: any) => norm.comment(c, id))
  return paged(list, body.cursor, more(body.has_more))
}

// ================================================================ feed / notice / folder

export async function feedList(ctx: Ctx) {
  const kind = (ctx.options.kind as string) ?? 'recommend'
  if (kind !== 'recommend') throw new CatbusError('NOT_IMPLEMENTED', `douyin 的 feed list --kind ${kind} 尚未实现`, { detail: { upstream: 'none' } })
  const d = await douyin(ctx)
  const index = cursor(ctx, '2')
  const body = check(ctx, await api.feed(d, '20', index))
  // 推荐流现在放在 cards[].aweme（JSON 串）里，老的 aweme_list 兜底
  const cards: any[] = (body.cards ?? []).map((c: any) => (typeof c.aweme === 'string' ? JSON.parse(c.aweme) : c.aweme)).filter((a: any) => a?.aweme_id)
  const list = [...(body.aweme_list ?? []), ...cards].map(norm.aweme)
  return paged(list, Number(index) + 1, body.has_more == null ? list.length > 0 : more(body.has_more))
}

/** 通知分组（上游 get_notice_list 的 notice_group）；不带时用上游默认的 960。 */
const NOTICE_GROUP: Record<string, string> = { all: '700', fans: '401', mention: '601', comment: '2', like: '3', danmaku: '520' }

export async function noticeList(ctx: Ctx) {
  const d = await douyin(ctx)
  const [minTime = '0', maxTime = '0'] = (ctx.cursor ?? '0,0').split(',')
  const group = NOTICE_GROUP[(ctx.options.group as string | undefined) ?? ''] ?? '960'
  const body = check(ctx, await api.notices(d, minTime, maxTime, '10', group))
  const list = (body.notice_list_v2 ?? body.notice_list ?? []).map(norm.notice)
  return paged(list, `${body.min_time ?? 0},${body.max_time ?? 0}`, more(body.has_more))
}

export async function folderList(ctx: Ctx) {
  const d = await douyin(ctx)
  if (ctx.args.user && ctx.args.user !== 'me' && (await resolveUser(d, ctx.args.user)) !== (await resolveUser(d, 'me'))) {
    throw new CatbusError('UNSUPPORTED', '抖音只能查看自己的收藏夹', { hint: 'catbus douyin folder list' })
  }
  const body = check(ctx, await api.collectList(d, cursor(ctx)))
  const raw: any[] = body.collects_list ?? []
  const list = raw.map((f: any) => n.folder({ id: folderId(f), name: String(f.collects_name ?? ''), count: n.count(f.total_number ?? f.item_num) }, f))
  return paged(list, body.cursor, more(body.has_more) && raw.length > 0)
}

const folderId = (f: any) => n.id(f.collects_id_str ?? f.collects_id)

/** 收藏夹最多翻几页（每页 20 个）找 `--folder`，防服务端游标不前进时死循环。 */
const FOLDER_PAGES = 50

// ================================================================ product

export async function productGet(ctx: Ctx) {
  const d = await douyin(ctx)
  const p = resolveProduct(ctx.args.product!)
  const body = check(ctx, await api.productDetail(d, 'https://live.douyin.com/', p.promotionId))
  return norm.productDetail(body, p.promotionId)
}

// ================================================================ live

async function room(d: Douyin, input: string) {
  const webRid = await resolveRoom(d, input)
  const info = await api.liveInfo(d, webRid)
  if (!info) throw live.roomNotFound(webRid)
  return { webRid, ...info }
}

export async function liveGet(ctx: Ctx) {
  const d = await douyin(ctx)
  const webRid = await resolveRoom(d, ctx.args.room!)
  const body = check(ctx, await api.liveRoomEnter(d, webRid))
  return norm.roomEnter(body, webRid)
}

export async function liveSearch(ctx: Ctx) {
  const d = await douyin(ctx)
  const offset = cursor(ctx)
  const body = check(ctx, await api.searchLive(d, ctx.args.keyword!, offset))
  const data: any[] = body.data ?? []
  const list = data.map(norm.searchLive).filter(Boolean)
  // 同 user search：偏移是自己算的，空页时停下
  return paged(list, Number(offset) + 15, more(body.has_more) && data.length > 0)
}

/** 直播间榜单：默认贡献榜（get_live_contribution_rank），`--ranking thousand` 为千票榜（get_live_thousand_ticket_rank）。 */
export async function liveRank(ctx: Ctx) {
  const d = await douyin(ctx)
  const r = await room(d, ctx.args.room!)
  if (ctx.options.ranking === 'thousand') return norm.rankRows(check(ctx, await api.liveThousandRank(d, r.room_id, r.webRid)))
  const body = check(ctx, await api.liveRank(d, r.room_id, r.anchor_id, r.sec_uid, r.webRid))
  return (body.data?.ranks ?? []).map(norm.rankRow)
}

/** 最近的弹幕：进房时 im/fetch 带回的历史消息（need_persist_msg_count=15），只取聊天。 */
export async function liveHistory(ctx: Ctx) {
  const d = await douyin(ctx)
  const r = await room(d, ctx.args.room!)
  const events = live.fetchEvents(await api.webcastFetch(d, r.user_id, r.room_id, norm.liveUrl(r.webRid)))
  return events.filter((e) => e.type === 'chat')
}

/** 拉流地址：房间资料（room/web/enter）里的 stream_url。 */
export async function liveMedia(ctx: Ctx) {
  const d = await douyin(ctx)
  const webRid = await resolveRoom(d, ctx.args.room!)
  return norm.liveStreams(check(ctx, await api.liveRoomEnter(d, webRid)))
}

export async function liveProducts(ctx: Ctx) {
  const d = await douyin(ctx)
  const r = await room(d, ctx.args.room!)
  const body = check(ctx, await api.liveProduction(d, norm.liveUrl(r.webRid), r.room_id, r.anchor_id))
  return (body.promotions ?? []).map(norm.promotion)
}

// ================================================================ 登录

/** 设备绑定的 dtrait 素材：内层 blob、设备档案、成品头（上游 DY_DTRAIT_BLOB / DY_DTRAIT_PROFILE / DY_SESSION_DTRAIT）。 */
const DTRAIT_KEYS = ['dtrait_blob', 'dtrait_profile', 'session_dtrait']

/**
 * 登录用的临时会话：凭证是新建的；设备绑定的 dtrait 素材从同名账号继承（上游 save_credential 把它和 cookie 一起落盘）。
 */
function loginSession(ctx: Ctx, method: Credential['method']): Douyin {
  const credential = freshCredential(ctx, method)
  for (const key of DTRAIT_KEYS) if (ctx.credential.device[key]) credential.device[key] = ctx.credential.device[key]
  return new Douyin({ ...ctx, credential })
}

/** 登录后校验：query/user 取 uid，创作者中心取 sec_uid 与昵称。 */
async function completeLogin(ctx: Ctx, d: Douyin) {
  d.deleteCookie('msToken')
  let uid: string
  try {
    uid = await api.myUid(d)
  } catch (err) {
    // 只有 query/user 表明没登录才是 cookie 无效；风控、网络错误原样抛出
    if (isAuthError(err)) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期')
    throw err
  }
  d.tokens.uid = uid
  const { secUid, user } = await api.mySecUid(d)
  return finishLogin(ctx, d.credential, norm.ref(secUid, user?.nickname)!)
}

/**
 * `--cookie` 除了 cookie 串 / 浏览器导出的 JSON 数组，还接受一个 JSON 对象，用来一并导入写操作需要的
 * bd-ticket-guard 素材（上游 DouyinAuth.from_cookie 的参数），以及可选的 dtrait 素材：
 * `{"cookie": "...", "ticket": "...", "ts_sign": "...", "client_cert": "...", "private_key": "-----BEGIN ...", "dtrait_blob": "..."}`
 *
 * dtrait 素材不给时，按随包的设备档案现算。想用自己浏览器的设备指纹时再导入：`dtrait_blob` 是抓到的内层 blob，
 * `dtrait_profile` 是设备档案对象（结构同 static/douyin/dtrait_profile.json），两者都给时 dtrait_blob 优先。
 * JSON 里出现任何一个 dtrait 键时这一组整体替换，值为 null 表示清掉；一个都没有时沿用同名账号已有的。
 */
function cookieLogin(ctx: Ctx): Douyin {
  const input = String(ctx.options.cookie ?? '').trim()
  let extra: Record<string, unknown> = {}
  let cookieInput = input
  if (input.startsWith('{')) {
    try {
      extra = JSON.parse(input)
    } catch {
      throw new CatbusError('USAGE', '--cookie 的 JSON 对象解析失败')
    }
    const c = extra.cookie ?? extra.cookies
    cookieInput = typeof c === 'string' ? c : JSON.stringify(c ?? '')
  }
  const credential = cookieCredential({ ...ctx, options: { ...ctx.options, cookie: cookieInput } }, '.douyin.com')
  for (const c of credential.scopes.main!.cookies) c.domain = WWW_ONLY.has(c.name) ? 'www.douyin.com' : '.douyin.com'
  const tokens = credential.scopes.main!.tokens
  for (const key of ['ticket', 'ts_sign', 'client_cert']) if (typeof extra[key] === 'string') tokens[key] = extra[key]
  if (typeof extra.private_key === 'string') credential.device.private_key = extra.private_key
  const given = DTRAIT_KEYS.some((k) => k in extra)
  for (const key of DTRAIT_KEYS) {
    const v = given ? extra[key] : ctx.credential.device[key]
    if (v == null || v === '') continue
    if (given && key === 'dtrait_profile') buildBlob(v) // 导入时就校验档案（上游 load_dtrait_profile），坏档案报 USAGE
    else if (given && typeof v !== 'string') throw new CatbusError('USAGE', `--cookie 的 ${key} 要是字符串`)
    credential.device[key] = v
  }
  return new Douyin({ ...ctx, credential })
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  if (ctx.options.sso && method !== 'sms') throw new CatbusError('USAGE', '--sso 只用于 --method sms', { hint: 'catbus douyin auth login --method sms --sso' })
  if (method === 'cookie') {
    const d = cookieLogin(ctx)
    await d.init()
    // 粘贴的 cookie 常带 __ac_nonce 却没有 __ac_signature：执行一次页面 acrawler 补上（上游 from_cookie，非严格）
    if (d.cookie('__ac_nonce') && !d.cookie('__ac_signature')) await new Passport(d).applyAcSignature()
    return completeLogin(ctx, d)
  }
  if (method === 'qrcode') {
    const d = loginSession(ctx, 'qrcode')
    await new Passport(d).qrcodeLogin((url) => showQrcode(ctx, url, '请用抖音 App 扫码并确认').then(() => {}))
    return completeLogin(ctx, d)
  }
  if (method === 'sms') {
    const d = loginSession(ctx, 'sms')
    const p = new Passport(d)
    return smsLogin(ctx, {
      send: async (phone) => {
        // --sso：改走 login.douyin.com 页的 SSO 链（上游 DY_PHONE_LOGIN_PROFILE=sso，是显式开关，不是自动退路）
        if (ctx.options.sso) {
          await p.bootstrapSso()
          await p.sendSmsCodeSso(phone)
        } else {
          await p.bootstrap(true)
          await p.sendSmsCode(phone)
        }
        return { phone, session: p.snapshot() }
      },
      verify: async (state, code) => {
        if (!p.smsSentAt) p.restore(state.session as Record<string, unknown>)
        if (p.sso) await p.phoneLoginSso(String(state.phone), code)
        else await p.phoneLogin(String(state.phone), code)
        return completeLogin(ctx, d)
      },
    })
  }
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

// ================================================================ 写操作

async function diggItem(ctx: Ctx, type: '1' | '0') {
  const d = await douyin(ctx)
  d.requireLogin()
  const id = await resolveItem(d, ctx.args.item!)
  check(ctx, await api.digg(d, id, type))
  return { id }
}
export const itemLike = (ctx: Ctx) => diggItem(ctx, '1')
export const itemUnlike = (ctx: Ctx) => diggItem(ctx, '0')

/** `--folder`：收藏夹 ID 或名字 → (id, name)（移动接口两个都要）。逐页找，每页里 ID 优先于名字。 */
async function findFolder(ctx: Ctx, d: Douyin, input: string): Promise<{ id: string; name: string }> {
  let at = '0'
  for (let page = 0; page < FOLDER_PAGES; page++) {
    const body = check(ctx, await api.collectList(d, at))
    const list: any[] = body.collects_list ?? []
    const f = list.find((x) => folderId(x) === input) ?? list.find((x) => x.collects_name === input)
    if (f) return { id: folderId(f), name: String(f.collects_name ?? '') }
    const next = body.cursor == null ? '' : String(body.cursor)
    if (!more(body.has_more) || !list.length || !next || next === at) break
    at = next
  }
  throw new CatbusError('USAGE', `没有这个收藏夹：${input}`, { hint: 'catbus douyin folder list --all' })
}

/**
 * 收藏 / 取消收藏。带 `--folder` 时：收藏后移进这个收藏夹（上游 move_collect_aweme，要求先收藏）；
 * 取消时只从这个收藏夹移出，仍保留收藏（remove_collect_aweme）。
 */
async function collectItem(ctx: Ctx, action: '1' | '0') {
  const d = await douyin(ctx)
  d.requireLogin()
  const id = await resolveItem(d, ctx.args.item!)
  const folder = ctx.options.folder as string | undefined
  if (!folder) {
    check(ctx, await api.collect(d, id, action))
    return { id }
  }
  const f = await findFolder(ctx, d, folder)
  if (action === '1') {
    check(ctx, await api.collect(d, id, '1'))
    check(ctx, await api.collectMove(d, id, f.name, f.id))
  } else check(ctx, await api.collectRemove(d, id, f.name, f.id))
  return { id }
}
export const itemCollect = (ctx: Ctx) => collectItem(ctx, '1')
export const itemUncollect = (ctx: Ctx) => collectItem(ctx, '0')

/** 评论发布前的安全素材检查（上游 publish_comment 的前置条件）。 */
function requireCommentSecurity(d: Douyin): void {
  if (!d.ticketMatchesSession()) throw authError(d.ctx, '发评论需要与 cookie 同一次登录的 ticket / ts_sign，请用扫码登录或导入配套凭证')
  if (!d.dtraitBlob() && !d.device.session_dtrait) {
    throw new CatbusError('AUTH_REQUIRED', `发评论需要 dtrait 设备素材（${DTRAIT_BROKEN}），只有 cookie 会被风控拦截`, { hint: DTRAIT_HINT })
  }
}

export async function commentAdd(ctx: Ctx) {
  const d = await douyin(ctx)
  d.requireLogin()
  requireCommentSecurity(d)
  const id = await resolveItem(d, ctx.args.item!)
  const replyTo = (ctx.options.replyTo as string | undefined) ?? ''
  const body = check(ctx, await api.publishComment(d, id, ctx.args.text!, replyTo))
  const c = body.comment
  return c ? norm.comment(c, id) : n.comment({ id: n.id(body.comment_id ?? ''), item_id: id, text: ctx.args.text!, parent_id: replyTo || null }, body)
}

const VISIBILITY: Record<string, number> = { public: 0, private: 1, friends: 2 }

/** 正文：--text 后面接 #话题（--tag / --topic）和 @用户（--mention），按上游说明作为纯文本写进描述。 */
export function publishDesc(o: Record<string, any>): string {
  const tags = [...(o.tag ?? []), ...(o.topic ?? [])].map((x: string) => `#${x.replace(/^#/, '')}`)
  const mentions = (o.mention ?? []).map((x: string) => `@${x.replace(/^@/, '')}`)
  return [o.text ?? '', ...tags, ...mentions].filter(Boolean).join(' ')
}

/** 发布选项 → creator.PublishOptions（图文封面在 itemPublish 里另算）。 */
export function publishOptions(o: Record<string, any>): creator.PublishOptions {
  return {
    title: o.title,
    desc: publishDesc(o),
    visibility: VISIBILITY[o.visibility ?? 'public']!,
    timing: o.schedule ? Math.floor(Date.parse(o.schedule) / 1000) : undefined,
    allowDownload: !o.noDownload,
    poi: o.poi != null ? { poi_id: String(o.poi), poi_name: String(o.poiName ?? '') } : undefined,
    mixId: o.series,
    hotSpot: o.hotspot != null ? { word: String(o.hotspot) } : undefined,
  }
}

export async function itemPublish(ctx: Ctx) {
  const o = ctx.options as Record<string, any>
  const images: string[] = o.image ?? []
  if (!o.video && !images.length) throw new CatbusError('USAGE', '发布需要 --image（图文）或 --video（视频）', { hint: 'catbus douyin item publish --video <文件> --title <标题> --text <描述>' })
  if (o.video && images.length) throw new CatbusError('USAGE', '--image 与 --video 只能二选一')
  if (o.poiName != null && o.poi == null) throw new CatbusError('USAGE', '--poi-name 要和 --poi <地点 id> 一起用')
  const cover = o.cover as string | undefined
  const coverIndex = cover != null && !o.video ? images.indexOf(cover) : -1
  if (cover != null && !o.video && coverIndex < 0 && !cover.startsWith('tos-')) {
    throw new CatbusError('USAGE', '图文的 --cover 必须是 --image 里的一张（或已上传的 tos- uri）')
  }
  const d = await douyin(ctx)
  d.requireLogin()
  const options = publishOptions(o)
  let body
  if (o.video) {
    const coverFile = cover == null ? null : cover.startsWith('tos-') ? cover : await readMedia(d.http, cover)
    body = await creator.postVideo(d, await readMedia(d.http, o.video), coverFile, options)
  } else {
    if (coverIndex >= 0) options.coverIndex = coverIndex
    else if (cover) options.coverUri = cover
    const files = []
    for (const img of images) files.push(await readMedia(d.http, img))
    body = await creator.postImages(d, files, options)
  }
  check(ctx, body)
  if (!body.item_id) throw new CatbusError('UPSTREAM', `发布失败：${body.status_msg ?? ''}`, { detail: { status_code: body.status_code ?? null } })
  const id = n.id(body.item_id)
  return n.item({ id, kind: o.video ? 'video' : 'image', url: norm.itemUrl(id, !o.video), title: n.str(o.title), text: n.str(options.desc), status: 'reviewing' }, body)
}

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const d = await douyin(ctx)
  d.requireLogin()
  const file = await readMedia(d.http, ctx.args.file!)
  await creator.bootstrap(d)
  if (file.contentType.startsWith('video/')) {
    const sts = await creator.uploadAuth(d)
    const v = await creator.uploadVideo(d, sts, file, await api.myUid(d).catch(() => ''))
    // VOD 只给 vid，没有可访问的地址；Media.url 在 schemas 里不能为 null，这里留空（id 就是 vid）
    return n.media({ id: v.vid, type: 'video', url: null, width: v.width || null, height: v.height || null, duration: v.duration || null }, v.raw)
  }
  const sts = await creator.uploadAuth(d, creator.POST_IMAGE_REFERER)
  const info = await creator.uploadImage(d, sts, file, '')
  return n.media({ id: info.uri, type: 'image', url: await creator.mediaUrl(d, info.uri), width: info.width || null, height: info.height || null }, info)
}

// ================================================================ 直播：发弹幕、点赞、监听

export async function liveSend(ctx: Ctx) {
  if (ctx.options.gift) throw new CatbusError('NOT_IMPLEMENTED', 'douyin 的 live send --gift 尚未实现', { detail: { upstream: 'none' } })
  const d = await douyin(ctx)
  d.requireLogin()
  const r = await room(d, ctx.args.room!)
  check(ctx, await api.liveChat(d, r.room_id, ctx.args.text!, r.webRid))
  return { id: r.webRid }
}

export async function liveLike(ctx: Ctx) {
  const d = await douyin(ctx)
  d.requireLogin()
  const r = await room(d, ctx.args.room!)
  check(ctx, await api.liveLike(d, r.room_id, String((ctx.options.count as number | undefined) ?? 1)))
  return { id: r.webRid }
}

export function liveListen(ctx: Ctx) {
  return (async function* () {
    const d = await douyin(ctx)
    const webRid = await resolveRoom(d, ctx.args.room!)
    yield* live.listenLive(ctx, d, webRid)
  })()
}

// ================================================================ 私信

/**
 * 会话 ID 形如 0:1:<uid>:<uid>：取另一方的 uid 重新建会话，拿到 short_id 与 ticket。
 * `--to` 除了用户（sec_uid / 主页 / 分享链接）也接受数字 uid：`msg listen` 输出的 from.id 就是它，直接建会话。
 */
async function conversationFor(ctx: Ctx, d: Douyin) {
  const o = ctx.options as Record<string, any>
  if (o.item) throw new CatbusError('UNSUPPORTED', '抖音没有商品客服私信，--item 不适用', { hint: '用 --to <用户>' })
  if (o.conversation) {
    const parts = String(o.conversation).split(':')
    const me = await d.uid()
    const peer = parts.length === 4 ? parts.slice(2).find((x) => x !== me) : undefined
    if (!peer) throw new CatbusError('USAGE', `无法识别的会话：${o.conversation}`, { hint: '单聊会话 ID 形如 0:1:<uid>:<uid>' })
    return im.createConversation(d, peer)
  }
  const to = String(o.to).trim()
  if (/^\d+$/.test(to)) return im.createConversation(d, to)
  const u = await profile(d, to)
  return im.createConversation(d, n.id(u.uid))
}

/** `--share` 的卡片：作品（视频 type 8 / 图文 type 77，uid 是自己）、用户名片（type 25）、网页（type 26）。 */
async function shareCard(d: Douyin, input: string): Promise<[number, Record<string, unknown>]> {
  const target = await resolveShare(d, input)
  if (target.kind === 'web') return [im.IM_SHARE_WEB, im.shareWebContent(target.url)]
  if (target.kind === 'user') {
    const u = await profile(d, target.secUid)
    return [im.IM_SHARE_USER, im.userCardContent({ uid: n.id(u.uid), secUid: n.id(u.sec_uid), name: String(u.nickname ?? ''), avatar: u.avatar_larger ?? u.avatar_thumb ?? '' })]
  }
  const v = await detail(d, target.id)
  const uid = await d.uid().catch(() => '')
  return norm.isImage(v) ? [im.IM_SHARE_PHOTOS, im.sharePhotosContent(v, uid)] : [im.IM_SHARE_AWEME, im.shareAwemeContent(v, uid)]
}

/** 一条待发的私信：IM 消息类型、content，以及输出 Message 用的类型与文字。 */
interface Outgoing {
  messageType: number
  content: unknown
  type: Message['type']
  text: string | null
}

/**
 * 私信：先建会话，再把每条消息准备好（上传图片 / 视频 / 文件、取分享卡片），最后逐条发送。
 * 准备阶段出错（上传失败、分享的作品不可见、撞上风控）时一条都还没发出，不会只发出一半。返回最后一条。
 */
export async function msgSend(ctx: Ctx) {
  const o = ctx.options as Record<string, any>
  const images: string[] = o.image ?? []
  if (o.video && !images.length) {
    throw new CatbusError('USAGE', '发视频私信需要封面：用 --image 给出一张封面图（与 --video 一起时不单独发送）', { hint: 'catbus douyin msg send --to <用户> --video <视频> --image <封面>' })
  }
  const d = await douyin(ctx)
  d.requireLogin()
  if (!d.privateKey) throw authError(ctx, '私信需要扫码登录时生成的 bd-ticket-guard 私钥')
  const conv = await conversationFor(ctx, d)
  const outbox: Outgoing[] = []
  if (ctx.args.text) outbox.push({ messageType: im.IM_TEXT, content: im.textContent(ctx.args.text), type: 'text', text: ctx.args.text })
  if (o.video) {
    const content = await im.uploadVideo(d, await readMedia(d.http, o.video), await readMedia(d.http, images[0]!))
    outbox.push({ messageType: im.IM_STORY_VIDEO, content, type: 'video', text: null })
  } else {
    for (const img of images) outbox.push({ messageType: im.IM_STORY_PICTURE, content: await im.uploadImage(d, await readMedia(d.http, img)), type: 'image', text: null })
  }
  if (o.file) {
    const file = await readMedia(d.http, o.file)
    // 上游 _source_name：本地文件取文件名，URL 与字节一律叫 file.bin
    if (/^https?:\/\//i.test(o.file)) file.filename = 'file.bin'
    outbox.push({ messageType: im.IM_FILE, content: await im.uploadFile(d, file), type: 'other', text: file.filename })
  }
  if (o.share) {
    const [messageType, content] = await shareCard(d, String(o.share))
    outbox.push({ messageType, content, type: 'card', text: null })
  }
  let id = ''
  for (const m of outbox) id = await im.sendMessage(d, conv, m.messageType, m.content)
  const last = outbox.at(-1)!
  return n.message({ id, conversation_id: conv.conversationId, from: d.credential.user ?? null, type: last.type, text: last.text, created_at: n.time(rand.now()) })
}

export function msgListen(ctx: Ctx) {
  return (async function* () {
    const d = await douyin(ctx)
    d.requireLogin()
    yield* live.listenMessages(ctx, d)
  })()
}
