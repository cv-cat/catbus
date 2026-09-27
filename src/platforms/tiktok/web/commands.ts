import { parseCookieInput } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { downloadMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Credential, Event, Item, Media, Message } from '../../../core/schemas.js'
import { openSocket, reconnecting } from '../../../core/stream.js'
import { paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { TikTok, tiktok } from './client.js'
import { frontierSign } from './jsrun.js'
import * as im from './im.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, ORIGIN } from './profile.js'
import { currentUser, isProductInput, parseUser, resolveItem, resolveProduct, resolveRoom, resolveSecUid, resolveUserInfo, userDetail } from './resolve.js'
import * as up from './upload.js'
import * as wire from './wire.js'

type Ctx = HandlerContext

/** 直播的 live_id 在 TikTok web 端是常量 12。 */
const LIVE_ID = '12'

const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true'
const cursorOf = (ctx: Ctx, fallback = '0') => ctx.cursor ?? fallback

// ================================================================ auth

/**
 * cookie 登录。`--cookie` 可以是 Cookie 字符串、浏览器导出的 cookie 数组，
 * 也可以是上游 `.tiktok-runtime.json` 格式的会话 JSON（cookie + device_id / local_storage / ticket_guard_* 等），
 * 后者是点赞、评论、发布、私信等需要 ticket-guard 的操作所必需的。
 */
function loginCredential(ctx: Ctx): Credential {
  const input = String(ctx.options.cookie ?? '').trim()
  if (!input.startsWith('{')) return cookieCredential(ctx, COOKIE_DOMAIN)
  let session: Record<string, unknown>
  try {
    session = JSON.parse(input)
  } catch {
    throw new CatbusError('USAGE', '无法解析会话 JSON', { hint: '传 Cookie 字符串，或 {"cookie": "...", "device_id": "...", ...} 格式的会话 JSON' })
  }
  const { cookie, ...device } = session
  if (typeof cookie !== 'string' || !cookie.trim()) throw new CatbusError('USAGE', '会话 JSON 缺少 cookie 字段')
  const credential = freshCredential(ctx, 'cookie')
  credential.scopes.main!.cookies = parseCookieInput(cookie, COOKIE_DOMAIN)
  credential.device = device
  return credential
}

/** 当前登录用户：首页 app-context.user，拿不到时用 multi_sids 的 uid 查私信卡片。 */
async function me(t: TikTok): Promise<{ id: string; name: string | null; handle: string | null; secUid: string | null }> {
  try {
    const u = await currentUser(t)
    return { id: String(u.uid ?? t.uid), name: (u.nickName as string) ?? null, handle: u.uniqueId ?? null, secUid: u.secUid ?? null }
  } catch (err) {
    if (!t.uid) throw err
    const r = await api.imUserProfile(t, [t.uid])
    const p = r.users?.[0]?.im_user_profile
    if (!p) throw err
    return { id: t.uid, name: p.nickname ?? null, handle: p.unique_id ?? null, secUid: p.sec_uid ?? null }
  }
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  if (method !== 'cookie') throw new CatbusError('UNSUPPORTED', `TikTok 只支持 cookie 登录（上游没有 ${method} 登录）`, { hint: 'catbus tiktok auth login --cookie "<cookie>"' })
  const credential = loginCredential(ctx)
  const t = await tiktok({ ...ctx, account: 'login', credential })
  if (!t.loggedIn) throw new CatbusError('AUTH_REQUIRED', 'cookie 里没有登录态（缺少 sessionid / sid_tt / multi_sids）')
  const u = await me(t)
  return finishLogin(ctx, credential, norm.ref(u.id, u.name, u.handle)!)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const t = new TikTok(ctx)
  const out: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  if (!t.loggedIn) return out
  try {
    const u = await me(t)
    const sess = t.jar.cookies.find((c) => c.name === 'sessionid' || c.name === 'sid_tt')
    return { logged_in: true, user: norm.ref(u.id, u.name, u.handle), method: ctx.credential.method, expires_at: sess?.expires ? n.time(sess.expires) : null }
  } catch (err) {
    if (err instanceof CatbusError && (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED')) return out
    throw err
  }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const t = await tiktok(ctx)
  const u = await parseUser(t, ctx.args.user!)
  if (u.handle) return norm.user(await userDetail(t, u.handle))
  return norm.user(await resolveUserInfo(t, ctx.args.user!))
}

function itemPage(list: any[] | null | undefined, cursor: unknown, hasMore: unknown) {
  return paged((list ?? []).filter((v) => v?.id).map(norm.item), cursor == null ? null : String(cursor), bool(hasMore))
}

export async function userItems(ctx: Ctx) {
  const t = await tiktok(ctx)
  const sec = await resolveSecUid(t, ctx.args.user!)
  const d = await api.userPosted(t, sec, cursorOf(ctx))
  return itemPage(d.itemList, d.cursor, d.hasMore)
}

export async function userCollects(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.collectedItemList(t, await resolveSecUid(t, ctx.args.user!), cursorOf(ctx))
  return itemPage(d.itemList, d.cursor, d.hasMore)
}

export async function userReposts(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.repostList(t, await resolveSecUid(t, ctx.args.user!), cursorOf(ctx))
  return itemPage(d.itemList, d.cursor, d.hasMore)
}

async function userList(ctx: Ctx, scene: '67' | '21') {
  const t = await tiktok(ctx)
  const d = await api.profileUserList(t, await resolveSecUid(t, ctx.args.user!), scene, { minCursor: cursorOf(ctx) })
  return paged((d.userList ?? []).map(norm.user), d.minCursor, bool(d.hasMore))
}
export const userFollowers = (ctx: Ctx) => userList(ctx, '67')
export const userFollowing = (ctx: Ctx) => userList(ctx, '21')

async function follow(ctx: Ctx, on: boolean) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const info = await resolveUserInfo(t, ctx.args.user!)
  const u = info.user ?? {}
  const page = `${ORIGIN}/@${u.uniqueId}`
  await api.followUser(t, String(u.id), String(u.secUid), { actionType: on ? '1' : '0', referer: page, queryReferer: page })
  return { id: String(u.id) }
}
export const userFollow = (ctx: Ctx) => follow(ctx, true)
export const userUnfollow = (ctx: Ctx) => follow(ctx, false)

// ================================================================ item

/** 视频页 hydration 的 itemStruct（上游 get_video_detail）。 */
async function itemStruct(t: TikTok, input: string): Promise<any> {
  const ref = await resolveItem(t, input)
  return api.videoDetail(t, ref.url, ref.id)
}

export async function itemGet(ctx: Ctx) {
  const t = await tiktok(ctx)
  return norm.item(await itemStruct(t, ctx.args.item!))
}

export async function itemSearch(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.searchGeneral(t, ctx.args.keyword!, { offset: cursorOf(ctx) })
  const list = (d.data ?? []).filter((x: any) => x.type === 1 && x.item?.id).map((x: any) => norm.item(x.item))
  return paged(list, d.cursor, bool(d.has_more))
}

export async function itemRelated(ctx: Ctx) {
  const t = await tiktok(ctx)
  const ref = await resolveItem(t, ctx.args.item!)
  const d = await api.relatedItems(t, ref.id, { referer: ref.handle ? ref.url : undefined })
  return itemPage(d.itemList, null, false)
}

/** 创作者中心的作品（字段名随 Studio 版本变化，取常见的几种）。 */
function studioItem(v: any): Item {
  const id = n.id(v.item_id ?? v.aweme_id ?? v.id ?? v.itemId)
  const privacy = Number(v.privacy_level ?? v.visibility_type ?? v.visibility ?? -1)
  const review = Number(v.review_status ?? v.audit_status ?? v.status ?? -1)
  return n.item(
    {
      id,
      kind: v.image_post_info || v.aweme_type === 150 ? 'image' : 'video',
      url: norm.itemUrl(v.author?.unique_id ?? v.unique_id, id),
      text: n.str(v.desc ?? v.description ?? v.title),
      created_at: n.time(v.create_time ?? v.createTime ?? v.post_time),
      cover: n.url(v.cover_url ?? v.cover?.url_list?.[0] ?? v.cover),
      stats: {
        views: n.count(v.play_count ?? v.statistics?.play_count),
        likes: n.count(v.like_count ?? v.digg_count ?? v.statistics?.digg_count),
        comments: n.count(v.comment_count ?? v.statistics?.comment_count),
        collects: n.count(v.favorite_count ?? v.collect_count ?? v.statistics?.collect_count),
        shares: n.count(v.share_count ?? v.statistics?.share_count),
      },
      status: privacy === 1 ? 'private' : review === 0 || review === 1 ? 'reviewing' : review === 2 ? 'rejected' : 'published',
    },
    v,
  )
}

export async function itemList(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const cursor = Number(cursorOf(ctx)) || 0
  const d = await api.creatorItemList(t, cursor)
  const list: any[] = d.item_list ?? d.items ?? d.data?.item_list ?? []
  const next = d.cursor ?? d.data?.cursor ?? cursor + list.length
  return paged(list.map(studioItem), next, bool(d.has_more ?? d.hasMore ?? d.data?.has_more))
}

export async function itemMedia(ctx: Ctx): Promise<Media[]> {
  const t = await tiktok(ctx)
  const s = await itemStruct(t, ctx.args.item!)
  const media = norm.itemMedia(s)
  if (!s.imagePost && s.music?.playUrl) media.push(n.media({ id: n.id(s.music.id), type: 'audio', url: n.url(s.music.playUrl)!, duration: n.seconds(s.music.duration) }, s.music))
  return media
}

export async function itemDownload(ctx: Ctx) {
  const t = await tiktok(ctx)
  const s = await itemStruct(t, ctx.args.item!)
  const media = norm.itemMedia(s)
  if (!media.length) throw new CatbusError('UPSTREAM', '作品没有可下载的媒体')
  return downloadMedia(ctx, t.http, String(s.id), media, {
    headers: [
      ['user-agent', t.ua],
      ['referer', `${ORIGIN}/`],
    ],
    ext: (m) => (m.type === 'audio' ? 'mp3' : m.type === 'image' ? 'jpg' : 'mp4'),
  })
}

async function digg(ctx: Ctx, on: boolean) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const ref = await resolveItem(t, ctx.args.item!)
  await api.itemDigg(t, ref.id, on ? '1' : '0', ref.handle ? { referer: ref.url, queryReferer: `${ORIGIN}/@${ref.handle}` } : {})
  return { id: ref.id }
}
export const itemLike = (ctx: Ctx) => digg(ctx, true)
export const itemUnlike = (ctx: Ctx) => digg(ctx, false)

async function collect(ctx: Ctx, on: boolean) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const s = await itemStruct(t, ctx.args.item!)
  const handle = s.author?.uniqueId
  await api.itemCollect(t, String(s.id), String(s.author?.secUid ?? ''), on ? '1' : '0', handle ? { referer: norm.itemUrl(handle, s.id), queryReferer: `${ORIGIN}/@${handle}` } : {})
  return { id: String(s.id) }
}
export const itemCollect = (ctx: Ctx) => collect(ctx, true)
export const itemUncollect = (ctx: Ctx) => collect(ctx, false)

const VISIBILITY: Record<string, number> = { public: 0, private: 1, friends: 2 }

function captionOf(o: Record<string, any>): string {
  const tags = [...(o.tag ?? []), ...(o.topic ?? [])].map((x: string) => `#${x.replace(/^#/, '')}`)
  const mentions = (o.mention ?? []).map((x: string) => `@${x.replace(/^@/, '')}`)
  return [o.text ?? '', ...tags, ...mentions].filter(Boolean).join(' ')
}

export async function itemPublish(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const o = ctx.options as Record<string, any>
  if (o.schedule) throw new CatbusError('UNSUPPORTED', 'TikTok 发布暂不支持 --schedule')
  if (o.poi || o.category || o.price != null) throw new CatbusError('UNSUPPORTED', 'TikTok 发布不支持 --poi / --category / --price')
  if (!o.video && !o.image?.length) throw new CatbusError('USAGE', '发布需要 --video 或 --image', { hint: 'catbus tiktok item publish --video a.mp4 --cover a.jpg --text "文案"' })
  if (o.video && o.image?.length) throw new CatbusError('USAGE', '--video 和 --image 只能选一个')
  const text = captionOf(o)
  const visibilityType = VISIBILITY[o.visibility ?? 'public']
  t.ticketGuard(up.PROJECT_POST_PATH)
  if (o.video) {
    if (!o.cover) throw new CatbusError('USAGE', '发布视频需要 --cover（catbus 不带 ffmpeg，无法从视频里截首帧）', { hint: 'catbus tiktok item publish --video a.mp4 --cover a.jpg --text "文案"' })
    const video = await readMedia(t.http, o.video)
    const cover = await up.picture((await readMedia(t.http, o.cover)).data)
    const meta = up.mp4Meta(video.data)
    const auth = await up.uploadAuth(t, { referer: api.UPLOAD_REFERER })
    const hosts = await up.probeUploadCandidates(t, await up.uploadCandidates(t, auth))
    const uploaded = await up.uploadMediaBytes(t, video.data, { fileType: 'video', spaceName: 'tiktok', businessTag: 'tiktok_video_submission_web', filename: video.filename, auth, clientBestHosts: hosts })
    await up.mediaOpenId(t)
    await up.enableVideoTranscode(t, uploaded.video_id)
    const creation = up.creationId()
    await up.projectCreate(t, creation)
    const fileKey = `file_${rand.now()}_${String(up.randbelow(1000000)).padStart(6, '0')}`
    const transcode = await up.waitVideoTranscode(t, uploaded.video_id, { width: meta.width, height: meta.height, durationMs: meta.durationMs, fileKey })
    const playUrl = String(transcode.transcode_result?.[0]?.play_url ?? '')
    if (!playUrl) throw new CatbusError('UPSTREAM', '转码结果缺少 play_url')
    await up.uploadMediaBytes(t, up.zipOne('0.jpeg', cover.jpeg), { fileType: 'image', spaceName: 'tiktok-ai-frame', auth: await up.uploadAuth(t) })
    const poster = await up.uploadMediaBytes(t, cover.png, { fileType: 'image', spaceName: 'tiktok', scene: 'poster', businessTag: 'tiktok_video_cover_web', auth: await up.uploadAuth(t) })
    const coverUri = String(poster.commit?.Result?.Results?.[0]?.Uri ?? '')
    if (!coverUri) throw new CatbusError('UPSTREAM', 'CommitUploadInner 缺少 Result.Results[0].Uri')
    const body = up.buildVideoProjectBody({ creationId: creation, videoId: uploaded.video_id, text, coverUri, playUrl, filename: video.filename, ...meta, visibilityType })
    const r = await up.postProject(t, body)
    return published(r, 'video', text, visibilityType)
  }
  const photos = []
  for (const input of o.image as string[]) {
    const file = await readMedia(t.http, input)
    photos.push({ data: file.data, pic: await up.picture(file.data) })
  }
  const referer = `${ORIGIN}/tiktokstudio/upload/post/photo`
  const imageAuth = await up.uploadAuth(t, { signed: false, referer })
  const uploaded = []
  for (const p of photos) uploaded.push(await up.uploadPhotoBytes(t, p.data, imageAuth, { referer }))
  await up.uploadMediaBytes(t, up.zipOne('0.jpeg', photos[0]!.pic.jpeg), { fileType: 'image', spaceName: 'tiktok-ai-frame', auth: await up.uploadAuth(t, { referer }), referer })
  const creation = up.photoCreationId()
  const now = rand.now()
  const rows = uploaded.map((u, i) => ({ id: `file_${now + i}_${up.randbelow(1000000)}`, uri: u.uri, width_px: u.width, height_px: u.height }))
  const body = up.buildPhotoProjectBody({ creationId: creation, photos: rows, text, title: o.title ?? '', visibilityType })
  const r = await up.postProject(t, body, referer)
  return published(r, 'image', text, visibilityType)
}

function published(r: any, kind: 'video' | 'image', text: string, visibility: number): Item {
  const resp = r.single_post_resp_list?.[0] ?? {}
  const id = n.id(resp.item_id ?? resp.aweme_id ?? r.item_id ?? '')
  return n.item({ id, kind, url: id ? norm.itemUrl('_', id, kind === 'image') : null, text, status: visibility === 1 ? 'private' : 'reviewing' }, r)
}

// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const t = await tiktok(ctx)
  t.requireLogin()
  const file = await readMedia(t.http, ctx.args.file!)
  if (file.contentType.startsWith('video/')) {
    const auth = await up.uploadAuth(t)
    const r = await up.uploadMediaBytes(t, file.data, { fileType: 'video', spaceName: 'tiktok', businessTag: 'tiktok_video_submission_web', filename: file.filename, auth })
    return n.media({ id: r.video_id, type: 'video', url: r.video_id }, r)
  }
  const referer = `${ORIGIN}/tiktokstudio/upload/post/photo`
  const r = await up.uploadPhotoBytes(t, file.data, await up.uploadAuth(t, { signed: false, referer }), { referer })
  return n.media({ id: r.uri, type: 'image', url: r.uri, width: r.width, height: r.height }, r)
}

// ================================================================ product 与商品评价

async function productDetail(t: TikTok, input: string): Promise<{ id: string; url: string; data: any }> {
  const { id, url } = resolveProduct(input)
  return { id, url, data: await api.shopProductDetail(t, url, id) }
}

export async function productGet(ctx: Ctx) {
  const t = await tiktok(ctx)
  return norm.product((await productDetail(t, ctx.args.product!)).data)
}

async function productReviews(ctx: Ctx, t: TikTok) {
  const page = Number(ctx.cursor ?? 1) || 1
  const { id, url, data } = await productDetail(t, ctx.args.item!)
  const r = page === 1 ? data.review_info : await api.shopReviewPage(t, url, id, page)
  if (!r || !Array.isArray(r.product_reviews)) throw new CatbusError('UPSTREAM', 'TikTok Shop 评价缺少 product_reviews')
  return paged(r.product_reviews.map((v: any) => norm.review(v, id)), page + 1, r.has_more === true)
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  const t = await tiktok(ctx)
  if (ctx.options.product || isProductInput(ctx.args.item!)) return productReviews(ctx, t)
  const ref = await resolveItem(t, ctx.args.item!)
  const d = await api.comments(t, ref.id, cursorOf(ctx))
  return paged((d.comments ?? []).map((c: any) => norm.comment(c, ref.id)), d.cursor, bool(d.has_more))
}

export async function commentReplies(ctx: Ctx) {
  const t = await tiktok(ctx)
  const ref = await resolveItem(t, ctx.args.item!)
  // 上游默认从 cursor=1 开始（跳过列表里已预览的一条），catbus 从 0 开始取全部回复
  const d = await api.commentReplies(t, ref.id, ctx.args.comment!, { cursor: cursorOf(ctx), referer: ref.url, rootReferer: ref.url })
  return paged((d.comments ?? []).map((c: any) => norm.comment(c, ref.id)), d.cursor, bool(d.has_more))
}

export async function commentAdd(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const ref = await resolveItem(t, ctx.args.item!)
  const replyTo = ctx.options.replyTo as string | undefined
  const d = await api.postComment(t, ref.id, ctx.args.text!, replyTo ? { replyId: replyTo } : {})
  if (d.comment) return norm.comment(d.comment, ref.id)
  return n.comment({ id: n.id(d.cid ?? ''), item_id: ref.id, text: ctx.args.text!, parent_id: replyTo ?? null, created_at: n.time(rand.nowSeconds()) }, d)
}

// ================================================================ feed

export async function feedList(ctx: Ctx) {
  const t = await tiktok(ctx)
  if ((ctx.options.kind ?? 'recommend') === 'following') {
    t.requireLogin()
    const d = await api.followingItemList(t, cursorOf(ctx))
    return itemPage(d.itemList, d.cursor, d.hasMore)
  }
  // 推荐流没有游标，每次请求返回新的一批
  const page = Number(ctx.cursor ?? 0) || 0
  const d = await api.recommendFeed(t)
  return itemPage(d.itemList, page + 1, d.hasMore ?? true)
}

// ================================================================ live

export async function liveGet(ctx: Ctx) {
  const t = await tiktok(ctx)
  const r = await resolveRoom(t, ctx.args.room!, { needHost: true })
  return norm.liveRoom(r.data)
}

export async function liveList(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.webcastFeed(t)
  const rooms = (Array.isArray(d.data) ? d.data : []).map((x: any) => x?.data ?? x).filter((r: any) => r?.id_str || r?.id)
  return paged(rooms.map(norm.webcastRoom), null, false)
}

export async function liveSearch(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.searchLiveRoom(t, ctx.args.keyword!)
  return paged((d.data?.room_list ?? []).map(norm.webcastRoom), null, false)
}

export async function liveCategories(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.webcastDrawerTabs(t)
  return norm.categories(d.data ?? [])
}

export async function liveHistory(ctx: Ctx): Promise<Event[]> {
  const t = await tiktok(ctx)
  const r = await resolveRoom(t, ctx.args.room!)
  const resp = wire.decodeLiveResponse(await api.webcastImFetch(t, LIVE_ID, r.roomId))
  return resp.events.filter((e) => e.type === 'chat').map((e) => norm.liveEvent(e)!)
}

export async function liveSend(ctx: Ctx) {
  if (ctx.options.gift != null) throw new CatbusError('NOT_IMPLEMENTED', 'tiktok 的 live send --gift 尚未实现（上游不含送礼）', { detail: { upstream: 'none' } })
  const t = await tiktok(ctx)
  t.requireLogin()
  const r = await resolveRoom(t, ctx.args.room!, { needHost: true })
  await api.postLiveChat(t, r.roomId, ctx.args.text!, { referer: norm.liveUrl(r.handle)! })
  return { id: r.roomId }
}

export async function liveLike(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const r = await resolveRoom(t, ctx.args.room!, { needHost: true })
  await api.postLiveLike(t, r.hostId!, r.roomId, { referer: norm.liveUrl(r.handle)! })
  return { id: r.roomId }
}

export async function liveRank(ctx: Ctx) {
  const t = await tiktok(ctx)
  const r = await resolveRoom(t, ctx.args.room!, { needHost: true })
  const d = await api.webcastRankList(t, r.hostId!, r.roomId)
  const ranks: any[] = d.data?.ranks ?? d.data?.rank_list ?? d.data?.list ?? []
  return ranks.map(norm.rank).filter((x): x is NonNullable<typeof x> => x != null)
}

export async function liveGifts(ctx: Ctx) {
  const t = await tiktok(ctx)
  const r = await resolveRoom(t, ctx.args.room!)
  const d = await api.liveGiftList(t, r.roomId)
  return (d.data?.gifts ?? []).map(norm.gift)
}

/**
 * 弹幕长连的原始事件（上游 iter_live_ws_events）：HTTP 拉一次拿 cursor → frontierSign → WS 心跳 + 进房 →
 * 收帧、按需 ACK；首批历史只在第一次连接时输出，按 (method, message_id) 去重。
 */
export function liveEvents(ctx: Ctx, t: TikTok, roomId: string, page: string): AsyncIterable<wire.LiveEvent> {
  const seen = new Set<string>()
  let first = true
  return reconnecting(ctx, async function* () {
    const initial = wire.decodeLiveResponse(await api.webcastImFetch(t, LIVE_ID, roomId, { referer: page }))
    if (!initial.cursor) throw new CatbusError('UPSTREAM', '直播初始 protobuf 缺少 WS cursor')
    const marker = await frontierSign({ cookie: t.device.document_cookie || t.cookieStr, userAgent: t.ua, referer: page, metrics: t.metrics })
    const socket = await openSocket(api.liveWsUrl(t, LIVE_ID, roomId, marker), {
      headers: { 'User-Agent': t.ua, Origin: ORIGIN, Cookie: t.cookieStr },
      signal: ctx.signal,
    })
    const heartbeat = () => socket.send(wire.encodeHeartbeat(roomId)).catch(() => {})
    await socket.send(wire.encodeHeartbeat(roomId))
    await socket.send(wire.encodeEnterRoom(roomId, LIVE_ID, initial.cursor))
    const beat = setInterval(heartbeat, 10_000).unref()
    const fresh = function* (events: wire.LiveEvent[]) {
      for (const e of events) {
        const key = `${e.method}:${e.message_id}`
        if (seen.has(key)) continue
        seen.add(key)
        if (e.type !== 'other') yield e
      }
    }
    try {
      if (first) yield* fresh(initial.events)
      else initial.events.forEach((e) => seen.add(`${e.method}:${e.message_id}`))
      first = false
      for await (const raw of socket.messages) {
        if (typeof raw === 'string') continue
        const frame = wire.decodePushFrame(raw)
        const resp = frame.response
        ctx.log.debug(`ws ${frame.payload_type} ${resp ? resp.events.map((e) => e.method).join(',') : `${frame.payload_length} 字节`}`)
        if (!resp) continue
        if (resp.need_ack) await socket.send(wire.encodeFrame('ack', new TextEncoder().encode(resp.internal_ext), frame.log_id)).catch(() => {})
        yield* fresh(resp.events)
      }
    } finally {
      clearInterval(beat)
      socket.close()
    }
  })
}

export function liveListen(ctx: Ctx) {
  return (async function* () {
    const t = await tiktok(ctx)
    const r = await resolveRoom(t, ctx.args.room!)
    const page = r.handle ? norm.liveUrl(r.handle)! : `${ORIGIN}/live`
    for await (const e of liveEvents(ctx, t, r.roomId, page)) {
      const ev = norm.liveEvent(e)
      if (ev) yield ev
    }
  })()
}

// ================================================================ keyword

export async function keywordSuggest(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.searchSuggest(t, ctx.args.prefix!)
  return (d.data ?? d.sug_list ?? []).map((x: any) => n.keyword({ text: String(x.word ?? x.content ?? '') }, x)).filter((k: any) => k.text)
}

// ================================================================ notice

export async function noticeList(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const maxTime = cursorOf(ctx)
  const d = await api.noticeMulti(t, [{ count: 20, is_mark_read: 0, group: 500, max_time: Number(maxTime) || 0, min_time: 0 }])
  const group = (d.notice_lists ?? d.notice_list_v2 ?? [])[0] ?? {}
  const list: any[] = group.notice_list ?? []
  return paged(list.map(norm.notice), group.max_time, bool(group.has_more))
}

export async function noticeCount(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const d = await api.noticeCount(t)
  const groups: any[] = d.notice_count ?? []
  return n.noticeCount({ total: groups.reduce((s, g) => s + (Number(g.count) || 0), 0) }, d)
}

// ================================================================ msg

async function initWire(t: TikTok) {
  const w = wire.decodeWire(await im.pullInit(t))
  const cache = im.convCache(t)
  for (const c of wire.pulledConversations(w)) cache[c.conversation_id] = { short_id: c.conversation_short_id, type: c.conversation_type }
  return w
}

/** 会话的对方：`0:1:<uid>:<uid>` 里不是自己的那个。 */
function peerOf(t: TikTok, conversationId: string): string | null {
  const parts = conversationId.split(':').slice(2)
  return parts.find((p) => p !== t.uid) ?? parts[0] ?? null
}

export async function msgList(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const w = await initWire(t)
  const messages = wire.pulledMessages(w)
  const list = Object.keys(im.convCache(t)).map((id) => {
    const last = messages.filter((m) => m.conversation_id === id).sort((a, b) => Number(b.create_time) - Number(a.create_time))[0]
    return norm.conversation(id, peerOf(t, id), last, { conversation_id: id, ...im.convCache(t)[id] })
  })
  return paged(list, null, false)
}

async function conversationInfo(t: TikTok, id: string): Promise<im.ConvInfo> {
  let info = im.convCache(t)[id]
  if (!info) {
    await initWire(t)
    info = im.convCache(t)[id]
  }
  if (!info) throw new CatbusError('USAGE', `找不到会话 ${id}`, { hint: 'catbus tiktok msg list' })
  return info
}

export async function msgHistory(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const id = ctx.args.conversation!
  const info = await conversationInfo(t, id)
  const w = wire.decodeWire(await im.pullConversation(t, { conversationId: id, shortId: info.short_id, type: info.type, anchorIndex: cursorOf(ctx) }))
  return paged(wire.pulledMessages(w).map(norm.pulledMessage), null, false)
}

export async function msgSend(ctx: Ctx): Promise<Message> {
  const o = ctx.options as Record<string, any>
  if (o.item) throw new CatbusError('UNSUPPORTED', 'TikTok 没有联系商品卖家的私信', { hint: '用 --to <用户> 或 --conversation <会话 ID>' })
  if (o.image || o.video) throw new CatbusError('NOT_IMPLEMENTED', 'tiktok 的 msg send 只支持文本（上游只有文本）', { detail: { upstream: 'partial' } })
  if (ctx.args.text == null) throw new CatbusError('USAGE', '需要消息内容 <text>')
  const t = await tiktok(ctx)
  t.requireLogin()
  let id = o.conversation as string | undefined
  if (!id) {
    const target = await parseUser(t, o.to)
    const uid = target.id ?? String((await resolveUserInfo(t, o.to)).user?.id ?? '')
    if (!Object.keys(im.convCache(t)).some((c) => c.split(':').includes(uid))) await initWire(t)
    id = Object.keys(im.convCache(t)).find((c) => c.split(':').slice(2).includes(uid))
    if (!id) throw new CatbusError('USAGE', '还没有和该用户的会话（上游不支持新建会话）', { hint: '先在 TikTok 里和对方开始会话，再用 catbus tiktok msg list 查看会话 ID' })
  }
  const info = await conversationInfo(t, id)
  const built = await im.buildSendFrame(t, { conversationId: id, shortId: info.short_id, type: info.type, text: ctx.args.text })
  const socket = await openSocket(await im.imWsUrl(t), { headers: { 'User-Agent': t.ua, Origin: ORIGIN, Cookie: t.cookieStr }, signal: ctx.signal })
  const deadline = rand.now() + ctx.config.timeout * 1000
  try {
    await socket.send(built.frame)
    const timer = setTimeout(() => socket.close(), Math.max(1000, deadline - rand.now()))
    try {
      for await (const raw of socket.messages) {
        let r: Record<string, any>
        try {
          r = wire.decodeImSendResponse(raw)
        } catch {
          continue
        }
        if (r.heartbeat || r.cmd !== 100) continue
        if (r.status_code) throw new CatbusError('UPSTREAM', `私信发送失败：${r.error_desc || r.status_code}`, { detail: r })
        return n.message(
          { id: String(r.server_message_id ?? built.clientMessageId), conversation_id: id, from: n.userRef({ id: t.uid }), type: 'text', text: ctx.args.text, created_at: n.time(rand.now()) },
          r,
        )
      }
    } finally {
      clearTimeout(timer)
    }
  } finally {
    socket.close()
  }
  throw new CatbusError('NETWORK', '私信 WebSocket 没有收到 command-100 回包', { detail: { kind: 'timeout' } })
}

/** 新消息推送（上游 iter_im_ws_messages）：只处理文本，心跳 hi 原样回。 */
export function msgListen(ctx: Ctx) {
  return (async function* () {
    const t = await tiktok(ctx)
    t.requireLogin()
    const seen = new Set<string>()
    yield* reconnecting(ctx, async function* () {
      const socket = await openSocket(await im.imWsUrl(t), { headers: { 'User-Agent': t.ua, Origin: ORIGIN, Cookie: t.cookieStr }, signal: ctx.signal })
      try {
        for await (const raw of socket.messages) {
          if (raw === 'hi') {
            await socket.send('hi').catch(() => {})
            continue
          }
          let m: wire.ImTextMessage | null
          try {
            m = wire.decodeImNotification(raw)
          } catch (err) {
            ctx.log.debug(`私信推送解码失败：${(err as Error).message}`)
            continue
          }
          if (!m) continue
          const key = `${m.conversation_id}:${m.server_message_id}`
          if (seen.has(key)) continue
          seen.add(key)
          yield n.message(
            {
              id: m.server_message_id,
              conversation_id: m.conversation_id,
              from: n.userRef({ id: m.sender }),
              type: 'text',
              text: m.text,
              created_at: n.time(Number(m.create_time) > 1e14 ? Math.floor(Number(m.create_time) / 1000) : m.create_time),
            },
            m,
          )
        }
      } finally {
        socket.close()
      }
    })
  })()
}

// ================================================================ folder / series

export async function folderList(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.collectionList(t, await resolveSecUid(t, ctx.args.user ?? 'me'), cursorOf(ctx))
  return paged((d.collectionList ?? []).map(norm.folder), d.cursor, bool(d.hasMore))
}

export async function folderItems(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.collectionItemList(t, ctx.args.folder!, cursorOf(ctx))
  return itemPage(d.itemList, d.cursor, d.hasMore)
}

export async function folderCreate(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const name = ctx.args.name!
  await api.checkPlaylistName(t, name)
  const d = await api.collectionCreate(t, name)
  const c = d.collection ?? d.collectionInfo ?? d
  return n.folder({ id: n.id(c.collectionId ?? c.collection_id ?? d.collectionId), name, count: 0 }, d)
}

export async function folderUpdate(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const name = ctx.options.name as string
  const d = await api.collectionModifyInfo(t, ctx.args.folder!, name)
  return n.folder({ id: ctx.args.folder!, name }, d)
}

export async function seriesList(ctx: Ctx) {
  const t = await tiktok(ctx)
  const d = await api.userPlaylist(t, await resolveSecUid(t, ctx.args.user ?? 'me'), cursorOf(ctx))
  return paged((d.playList ?? []).map(norm.series), d.cursor, bool(d.hasMore))
}

// ================================================================ poi

/** 上游的地点列表没有关键词字段：取推荐地点后按关键词在本地过滤。 */
export async function poiSearch(ctx: Ctx) {
  const t = await tiktok(ctx)
  t.requireLogin()
  const page = Number(ctx.cursor ?? 1) || 1
  const d = await api.creatorPoiList(t, { pageNum: page })
  const list: any[] = d.poi_list ?? d.data?.poi_list ?? d.pois ?? []
  const kw = ctx.args.keyword!.toLowerCase()
  const pois = list.map(norm.poi).filter((p) => `${p.name} ${p.address ?? ''}`.toLowerCase().includes(kw))
  return paged(pois, page + 1, bool(d.has_more ?? d.data?.has_more))
}

