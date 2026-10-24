import { CatbusError } from '../../../core/errors.js'
import { type DownloadOptions, downloadMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, loginContext } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { type AuthStatus, type Event, type Keyword, RAW, type UserRef } from '../../../core/schemas.js'
import { reconnecting } from '../../../core/stream.js'
import { authError, isGuest, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { VR_UA, type YtClient, yt } from './client.js'
import * as norm from './normalize.js'
import {
  CHANNEL_TAB,
  channelId,
  commentAction,
  createCommentParams,
  createReplyParams,
  playlistId,
  repliesToken,
  type SearchFilter,
  searchParams,
  videoId,
} from './resolve.js'

type Ctx = HandlerContext

const COOKIE_DOMAIN = '.youtube.com'

// ================================================================ auth

/**
 * 当前账号：头像菜单里的名字，ID 取「你的频道」入口的频道 ID。没有开频道的 Google 账号没有频道 ID，
 * 改用账号列表里的 obfuscatedGaiaId（Google 账号 ID，不会变）。没登录或 cookie 失效时为 null。
 */
async function me(c: YtClient, channelOnly = false): Promise<UserRef | null> {
  const res = await api.accountMenu(c)
  const header = norm.first(res, 'activeAccountHeaderRenderer')
  if (!header) return null
  const name = norm.text(header.accountName) ?? norm.text(header.channelHandle)
  const channel = norm.collect(res, 'browseEndpoint').map((e) => e.browseId).find((b) => typeof b === 'string' && b.startsWith('UC'))
  if (channel || channelOnly) return norm.channelUser(channel, name)
  const accounts = norm.collect(await api.accountsList(c), 'accountItem')
  const gaia = norm.first(accounts.find((a) => a.isSelected) ?? accounts[0], 'accountStateToken')?.obfuscatedGaiaId
  return gaia ? n.userRef({ id: gaia, name, url: null }) : null
}

/** 当前账号的频道 ID：登录时已存进凭证；凭证里不是频道 ID（登录时还没开频道）时再问一次头像菜单。 */
async function meChannel(c: YtClient): Promise<string> {
  const saved = c.ctx.credential.user?.id
  const id = saved?.startsWith('UC') ? saved : (await me(c, true))?.id
  if (!id) throw new CatbusError('UPSTREAM', '这个账号还没有 YouTube 频道', { hint: '在 youtube.com 上先创建频道' })
  return id
}

/** `<user>`：me 为当前账号的频道，其余按频道 ID / @handle / 链接解析。 */
function userChannel(c: YtClient, ctx: Ctx): Promise<string> {
  return ctx.args.user === 'me' ? meChannel(c) : channelId(c, ctx.args.user!)
}

/** 登录校验用：cookie 失效时接口可能直接回 401（AUTH_*），当作没登录。 */
async function meOrNull(c: YtClient): Promise<UserRef | null> {
  try {
    return await me(c)
  } catch (err) {
    if (err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')) return null
    throw err
  }
}

export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const c = yt(loginContext(ctx, credential))
  if (!c.loggedIn) {
    throw new CatbusError('USAGE', 'YouTube 的 cookie 需要包含 SAPISID（或 __Secure-3PAPISID）', {
      hint: '在已登录的 youtube.com 页面，从开发者工具 Network 里任意一个 youtubei 请求复制完整的 Cookie 请求头',
    })
  }
  const user = await meOrNull(c)
  if (!user) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '重新在浏览器登录 youtube.com 后复制 cookie' })
  return finishLogin(ctx, credential, user)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const c = yt(ctx)
  const out: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  const user = c.loggedIn ? await meOrNull(c) : null
  if (!user) return out
  const expires = c.jar.cookies.find((x) => x.name === '__Secure-3PSID' || x.name === 'SID')?.expires
  return { logged_in: true, user, method: ctx.credential.method, expires_at: expires ? n.time(expires) : null }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const c = yt(ctx)
  const id = await userChannel(c, ctx)
  const res = await api.browse(c, id)
  if (!res?.metadata?.channelMetadataRenderer) {
    throw new CatbusError('UPSTREAM', `频道不存在或不可见：${ctx.args.user}`, { detail: { id, alerts: res?.alerts ?? null } })
  }
  return norm.channel(res)
}

export async function userSearch(ctx: Ctx) {
  const c = yt(ctx)
  const res = ctx.cursor ? await api.searchMore(c, ctx.cursor) : await api.search(c, ctx.args.keyword!, searchParams({ type: 'channel' }))
  return page(norm.collect(res, 'channelRenderer').map(norm.channelRenderer), res)
}

/**
 * 频道视频 tab 的列表项不带频道，作者取自频道页 metadata；续页响应里没有 metadata，
 * 所以 cursor 里连同频道一起带上：`<base64url JSON {t: token, c: 频道 ID, n: 频道名}>`。
 */
export async function userItems(ctx: Ctx) {
  const c = yt(ctx)
  const cur = ctx.cursor ? decodeCursor(ctx.cursor) : null
  const res = cur ? await api.browseMore(c, cur.t) : await api.browse(c, await userChannel(c, ctx), CHANNEL_TAB.videos)
  const owner = cur ? norm.channelUser(cur.c, cur.n) : ownerOf(res)
  const token = norm.nextToken(res)
  const data = norm.videos(res, owner)
  return page(data, res, token && encodeCursor({ t: token, c: owner?.id ?? null, n: owner?.name ?? null }))
}

interface ItemsCursor {
  t: string
  c: string | null
  n: string | null
}

function encodeCursor(v: ItemsCursor): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url')
}

function decodeCursor(cursor: string): ItemsCursor {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof v?.t === 'string') return v
  } catch {}
  throw new CatbusError('USAGE', '无法识别的 --cursor', { hint: '用上一次 user items 返回的 page.cursor' })
}

/** 只有自己的才能看的列表（点赞、稍后观看、订阅）：<user> 只接受 me。 */
function onlyMe(ctx: Ctx, what: string): YtClient {
  if (ctx.args.user && ctx.args.user !== 'me') {
    throw new CatbusError('UNSUPPORTED', `YouTube 不公开别人的${what}`, { hint: `catbus youtube ${ctx.resource} ${ctx.action} me` })
  }
  return yt(ctx)
}

/** 登录后才有的 browse 页（FE… / VL…），翻页走 continuation。 */
async function myBrowse(c: YtClient, ctx: Ctx, browseId: string) {
  return ctx.cursor ? api.browseMore(c, ctx.cursor) : api.browse(c, browseId)
}

export async function userLikes(ctx: Ctx) {
  const c = onlyMe(ctx, '点赞列表')
  const res = await myBrowse(c, ctx, 'VLLL')
  return page(norm.videos(res), res)
}

export async function userCollects(ctx: Ctx) {
  const c = onlyMe(ctx, '稍后观看列表')
  const res = await myBrowse(c, ctx, 'VLWL')
  return page(norm.videos(res), res)
}

export async function userFollowing(ctx: Ctx) {
  const c = onlyMe(ctx, '订阅列表')
  const res = await myBrowse(c, ctx, 'FEchannels')
  return page(norm.collect(res, 'channelRenderer').map(norm.channelRenderer), res)
}

/** 频道页 metadata 里的频道，作为列表项缺频道时的 author。 */
function ownerOf(res: any): UserRef | null {
  const md = res?.metadata?.channelMetadataRenderer
  return norm.channelUser(md?.externalId, md?.title)
}

/** 分页结果：下一页 token 就是 cursor。 */
function page<T>(data: T[], res: unknown, token: string | null = norm.nextToken(res)) {
  return paged(data, token, token != null && data.length > 0)
}

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  const [player, next] = await Promise.all([api.player(c, id), api.next(c, id)])
  if (player?.videoDetails?.videoId) return norm.video(player, next)
  // player 被人机验证拦下时（同一出口 IP 请求多了会发生），用 watch 页的数据兜底
  const fallback = isBot(player?.playabilityStatus) ? norm.watchVideo(id, next) : null
  if (fallback) {
    ctx.log.warn('player 接口要求人机验证，改用 watch 页的数据：发布时间只精确到天')
    return fallback
  }
  assertVideo(c.ctx, player, id)
  return norm.video(player, next)
}

/** 人机验证：同一出口 IP 请求过多时 player 返回 LOGIN_REQUIRED + 「confirm you're not a bot」。 */
function isBot(ps: any): boolean {
  return ps?.status === 'LOGIN_REQUIRED' && /bot/i.test(ps.reason ?? '')
}

function checkBot(ps: any): void {
  if (isBot(ps)) {
    throw new CatbusError('RISK_CONTROL', `YouTube 要求人机验证：${ps.reason}`, {
      hint: '当前出口 IP 请求过多，过一段时间再试，或换一个代理出口',
      detail: { kind: 'captcha', status: ps.status },
    })
  }
}

/** 视频不存在、私享或已删除时 player 不给 videoDetails。 */
function assertVideo(ctx: Ctx, player: any, id: string): void {
  if (player?.videoDetails?.videoId) return
  const ps = player?.playabilityStatus ?? {}
  checkBot(ps)
  // reason 为空时，原因在错误页的文字里（例如私享视频：「Private video」）
  const reason: string = ps.reason ?? norm.collect(ps.errorScreen, 'simpleText').find(Boolean) ?? ps.status ?? id
  // 游客：登录后可能能看；已登录还被拦（私享、会员专享等），重新登录也没用
  if (ps.status === 'LOGIN_REQUIRED' && isGuest(ctx)) throw authError(ctx, `这个视频需要登录才能看：${reason}`)
  throw new CatbusError('UPSTREAM', `视频不可用：${reason}`, { detail: { status: ps.status ?? null, reason, id } })
}

/** 媒体地址：ANDROID_VR 客户端的 player。人机验证、年龄限制等拿不到地址时按 playabilityStatus 报错。 */
async function mediaOf(c: YtClient, id: string) {
  const player = await c.mediaPlayer(id)
  const ps = player?.playabilityStatus ?? {}
  checkBot(ps)
  const media = norm.playMedia(player)
  if (!media.length) {
    throw new CatbusError('UPSTREAM', `拿不到视频的媒体地址：${ps.reason ?? ps.status ?? id}`, {
      hint: '年龄限制、会员专享、仅儿童可见等视频不支持',
      detail: { status: ps.status ?? null, reason: ps.reason ?? null, id },
    })
  }
  return media
}

export async function itemMedia(ctx: Ctx) {
  return mediaOf(yt(ctx), videoId(ctx.args.item!))
}

const CHUNK_BYTES = 10 * 1024 * 1024

export async function itemDownload(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  const media = await mediaOf(c, id)
  return downloadMedia(ctx, c.http, id, media, downloadOptions).catch((err) => {
    // 实测（2026-10-24）：没有 PO token 的地址只给前约 1 分钟的数据，之后的分段回 403
    const d = err instanceof CatbusError ? (err.detail as { status?: number; range?: number[] } | null) : null
    if (d?.status === 403 && (d.range?.[0] ?? 0) > 0) {
      throw new CatbusError('UPSTREAM', 'YouTube 只允许下载这个视频的前约 1 分钟（没有 PO token 的地址超过 1 分钟后回 403）', {
        hint: '目前只能完整下载 1 分钟以内的视频（如 Shorts）',
        detail: d,
      })
    }
    throw err
  })
}

const downloadOptions: DownloadOptions = {
  headers: [['User-Agent', VR_UA]],
  ext: (m) => norm.formatExt((m as any)[RAW]?.mimeType),
  // googlevideo 拒绝整文件请求（403），不分段时还会被限速：按 10 MB 一段用 range 参数下载（与 yt-dlp 相同）
  chunked: (m) => {
    const total = Number((m as any)[RAW]?.contentLength)
    return total > 0 ? { total, bytes: CHUNK_BYTES, url: (start, end) => `${m.url}&range=${start}-${end}` } : undefined
  },
}

export async function itemSearch(ctx: Ctx) {
  const c = yt(ctx)
  const { sort, time, type } = ctx.options as { sort?: SearchFilter['sort']; time?: SearchFilter['time']; type?: string }
  const res = ctx.cursor
    ? await api.searchMore(c, ctx.cursor)
    : await api.search(c, ctx.args.keyword!, searchParams({ sort, time, type: type === 'video' ? 'video' : undefined }))
  return page(norm.videos(res), res)
}

export async function itemRelated(ctx: Ctx) {
  const c = yt(ctx)
  if (ctx.cursor) {
    const res = await api.nextMore(c, ctx.cursor)
    return page(norm.videos(res), res)
  }
  const res = await api.next(c, videoId(ctx.args.item!))
  const section = res?.contents?.twoColumnWatchNextResults?.secondaryResults
  return page(norm.videos(section), section)
}

// ================================================================ comment

/** 评论区的第一页 token：watch 页里 sectionIdentifier 为 comment-item-section 的那一节。 */
function commentsToken(next: any): string | null {
  const section = norm.collect(next, 'itemSectionRenderer').find((s) => s.sectionIdentifier === 'comment-item-section')
  return norm.first(section, 'continuationCommand')?.token ?? null
}

/** 评论列表的翻页 token：本页 continuationItems 的最后一项（回复的「查看回复」按钮嵌在每条评论里，不能取）。 */
function commentsPageToken(res: any): string | null {
  const actions = [...(res?.onResponseReceivedEndpoints ?? []), ...(res?.onResponseReceivedActions ?? [])]
  let token: string | null = null
  for (const a of actions) {
    const items: any[] = (a.reloadContinuationItemsCommand ?? a.appendContinuationItemsAction)?.continuationItems ?? []
    const last = items.at(-1)?.continuationItemRenderer
    token = last?.continuationEndpoint?.continuationCommand?.token ?? norm.first(last?.button, 'continuationCommand')?.token ?? token
  }
  return token
}

export async function commentList(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  let token = ctx.cursor
  if (!token) {
    const next = await api.next(c, id)
    token = commentsToken(next)
    if (!token) {
      // 关闭评论时评论区只有一条提示（「Comments are turned off」）；正在直播的视频只有直播聊天，没有评论区
      const live = norm.first(next, 'liveChatRenderer') != null
      const shown = norm.text(norm.first(norm.collect(next, 'itemSectionRenderer').find((x) => x.sectionIdentifier === 'comment-item-section'), 'messageRenderer')?.text)
      throw new CatbusError('UPSTREAM', live ? '正在直播的视频没有评论区，只有直播聊天' : `这个视频没有评论区${shown ? `：${shown}` : '（可能关闭了评论）'}`, {
        hint: live ? `catbus youtube live history ${id}` : null,
        detail: { id },
      })
    }
  }
  const res = await api.nextMore(c, token)
  return page(norm.comments(res, id), res, commentsPageToken(res))
}

export async function commentReplies(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  let token = ctx.cursor
  if (!token) {
    const comment = ctx.args.comment!.trim()
    if (comment.includes('.')) throw new CatbusError('USAGE', 'YouTube 的回复没有下一级回复，传根评论 ID', { hint: `根评论 ID 是 ${comment.slice(0, comment.indexOf('.'))}` })
    token = repliesToken(id, comment, await ownerOfVideo(c, id))
  }
  const res = await api.nextMore(c, token)
  return page(norm.comments(res, id), res)
}

// ================================================================ series（播放列表）

/** 别人的：频道「播放列表」tab，只有公开的。me：「你的播放列表」页（FEplaylist_aggregation），含私享的。 */
export async function seriesList(ctx: Ctx) {
  const c = yt(ctx)
  const res = ctx.cursor
    ? await api.browseMore(c, ctx.cursor)
    : ctx.args.user === 'me'
      ? await api.browse(c, 'FEplaylist_aggregation')
      : await api.browse(c, await channelId(c, ctx.args.user!), CHANNEL_TAB.playlists)
  return page(norm.playlists(res), res)
}

export async function seriesItems(ctx: Ctx) {
  const c = yt(ctx)
  const res = ctx.cursor ? await api.browseMore(c, ctx.cursor) : await api.browse(c, `VL${playlistId(ctx.args.series!)}`)
  if (!ctx.cursor && !res?.metadata?.playlistMetadataRenderer && !norm.first(res, 'lockupViewModel')) {
    throw new CatbusError('UPSTREAM', `播放列表不存在或不可见：${ctx.args.series}`, { detail: { alerts: res?.alerts ?? null } })
  }
  return page(norm.videos(res), res)
}

// ================================================================ feed / history / notice

const FEED: Record<string, string> = { recommend: 'FEwhat_to_watch', following: 'FEsubscriptions' }

export async function feedList(ctx: Ctx) {
  const c = yt(ctx)
  const res = await myBrowse(c, ctx, FEED[(ctx.options.kind as string) ?? 'recommend']!)
  return page(norm.videos(res), res)
}

export async function historyList(ctx: Ctx) {
  const c = yt(ctx)
  const res = await myBrowse(c, ctx, 'FEhistory')
  return page(norm.videos(res), res)
}

export async function noticeList(ctx: Ctx) {
  const c = yt(ctx)
  const res = ctx.cursor
    ? await c.innertube('notification/get_notification_menu', { ctoken: ctx.cursor })
    : await c.innertube('notification/get_notification_menu', { notificationsMenuRequestType: 'NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX' })
  // 「加载更多」是 continuationItemRenderer.continuationEndpoint.getNotificationMenuEndpoint.ctoken，不是 continuationCommand
  const token: string | null = norm.first(norm.collect(res, 'continuationItemRenderer').at(-1), 'getNotificationMenuEndpoint')?.ctoken ?? null
  return page(norm.collect(res, 'notificationRenderer').map(norm.notification), res, token)
}

export async function noticeCount(ctx: Ctx) {
  const c = yt(ctx)
  const res = await c.innertube('notification/get_unseen_count', {})
  const unseen = norm.first(res, 'updateNotificationsUnseenCountAction')?.unseenCount ?? norm.first(res, 'unseenCount')
  return n.noticeCount({ total: Number(unseen) || 0 }, res)
}

// ================================================================ keyword

export async function keywordSuggest(ctx: Ctx): Promise<Keyword[]> {
  const res = await yt(ctx).suggest(ctx.args.prefix!)
  const list: any[] = Array.isArray(res?.[1]) ? res[1] : []
  return list.map((x) => n.keyword({ text: String(Array.isArray(x) ? x[0] : x) }, x))
}

// ================================================================ live

export async function liveSearch(ctx: Ctx) {
  const c = yt(ctx)
  const res = ctx.cursor ? await api.searchMore(c, ctx.cursor) : await api.search(c, ctx.args.keyword!, searchParams({ live: true }))
  return page(norm.collect(res, 'videoRenderer').filter(norm.isLiveRenderer).map(norm.liveRenderer), res)
}

export async function liveGet(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.room!)
  const next = await api.next(c, id)
  const room = norm.watchLive(id, next)
  if (room) return room
  // watch 页没有主信息：视频不存在、私享等，原因在 player 里
  const player = await api.player(c, id)
  assertVideo(c.ctx, player, id)
  return norm.liveRoom(player, next)
}

/**
 * 打开直播聊天：watch 页只给默认视图「Top chat」（YouTube 筛选过的）的 token，用它拉一次之后，
 * 响应头的视图菜单里才有可用的「Live chat」（全部消息）token，再切过去。返回第一批消息（最近的历史）。
 */
async function openChat(c: YtClient, id: string): Promise<any> {
  const chat = norm.first(await api.next(c, id), 'liveChatRenderer')
  const token = norm.first(chat?.continuations, 'continuation')
  if (typeof token !== 'string') {
    throw new CatbusError('UPSTREAM', '这个视频没有直播聊天（不在直播，或者关闭了聊天）', { hint: `先用 catbus youtube live get ${id} 看直播状态`, detail: { id } })
  }
  const res = await api.liveChat(c, token)
  const views: any[] = norm.first(res?.continuationContents?.liveChatContinuation?.header, 'subMenuItems') ?? []
  const all = norm.first(views.find((v) => /live chat/i.test(v.title ?? '') && !v.selected)?.continuation, 'continuation')
  return typeof all === 'string' ? api.liveChat(c, all) : res
}

function chatEvents(res: any): Event[] {
  const actions: any[] = res?.continuationContents?.liveChatContinuation?.actions ?? []
  return actions.map(norm.chatEvent).filter((e): e is Event => e != null)
}

/** 下一次轮询的 token 与等待时间：invalidation / timed / reload 三种 continuation 取第一个。 */
function chatNext(res: any): { token: string | null; wait: number } {
  const cont = res?.continuationContents?.liveChatContinuation?.continuations?.[0] ?? {}
  const data: any = Object.values(cont)[0] ?? {}
  return { token: data.continuation ?? null, wait: Math.min(Math.max(Number(data.timeoutMs) || 5000, 1000), 10_000) }
}

export async function liveHistory(ctx: Ctx) {
  return chatEvents(await openChat(yt(ctx), videoId(ctx.args.room!)))
}

/**
 * 直播聊天没有长连接，按服务端给的间隔轮询 get_live_chat。打开聊天时拿到的第一批是最近的历史消息，不输出。
 * 断网重连时用上一次的 token 续上（不跳过）；其他错误（token 失效等）重新打开聊天。
 */
export function liveListen(ctx: Ctx) {
  return (async function* () {
    const c = yt(ctx)
    const id = videoId(ctx.args.room!)
    let token: string | null = null
    const poll = (t: string) =>
      api.liveChat(c, t).catch((err) => {
        if (!(err instanceof CatbusError && err.code === 'NETWORK')) token = null
        throw err
      })
    yield* reconnecting(ctx, async function* () {
      let res = token ? await poll(token) : await openChat(c, id)
      if (token) yield* chatEvents(res)
      while (!ctx.signal.aborted) {
        const next = chatNext(res)
        token = next.token
        if (!token) throw new CatbusError('UPSTREAM', '直播聊天已结束', { detail: { id } })
        await rand.sleep(next.wait, ctx.signal)
        if (ctx.signal.aborted) return
        res = await poll(token)
        yield* chatEvents(res)
      }
    })
  })()
}

// ================================================================ 写操作

/**
 * 写操作的结果检查：InnerTube 在业务失败时也可能返回 200，状态在 status / actionResult(s) 里，
 * 或者只给一个弹错误提示的 showErrorAction（例如没有频道的账号发评论：「Comment failed to post.」）。
 */
function checkWrite(res: any, what: string, hint?: string): void {
  const shown = norm.first(res, 'showErrorAction')
  if (shown) {
    const text = norm.collect(shown, 'simpleText').find(Boolean) ?? norm.text(norm.first(shown, 'text'))
    throw new CatbusError('UPSTREAM', `${what}失败${text ? `：${text}` : ''}`, { hint: hint ?? null, detail: { action: 'showErrorAction' } })
  }
  const status: string | undefined = res?.status ?? res?.actionResult?.status ?? res?.actionResults?.[0]?.status
  if (status && status !== 'STATUS_SUCCEEDED') {
    throw new CatbusError('UPSTREAM', `${what}失败：${status}`, { detail: { status, feedback: (res?.actionResult ?? res?.actionResults?.[0])?.feedback ?? null } })
  }
}

/** 对一个目标的写操作：解析目标 → 调接口 → 检查结果 → 返回 `{id}`。 */
function write(target: (c: YtClient, ctx: Ctx) => string | Promise<string>, what: string, op: (c: YtClient, id: string) => Promise<unknown>) {
  return async (ctx: Ctx) => {
    const c = yt(ctx)
    const id = await target(c, ctx)
    checkWrite(await op(c, id), what)
    return { id }
  }
}

const channelArg = (c: YtClient, ctx: Ctx) => channelId(c, ctx.args.user!)
const videoArg = (_: YtClient, ctx: Ctx) => videoId(ctx.args.item!)

/**
 * 订阅 / 取消订阅：登录态失效时接口照样返回 200，只是按钮状态（updateSubscribeButtonAction.subscribed）没变，
 * 所以要核对它。
 */
function subscription(on: boolean) {
  return async (c: YtClient, id: string) => {
    const res = await (on ? api.subscribe(c, id) : api.unsubscribe(c, id))
    if (norm.first(res, 'updateSubscribeButtonAction')?.subscribed === on) return res
    const what = on ? '订阅' : '取消订阅'
    if (!(await meOrNull(c))) throw authError(c.ctx, `${what}没有生效：登录态已失效`)
    throw new CatbusError('UPSTREAM', `${what}没有生效`, { hint: '确认频道存在，且不是自己的频道', detail: { id } })
  }
}

export const userFollow = write(channelArg, '订阅', subscription(true))
export const userUnfollow = write(channelArg, '取消订阅', subscription(false))
export const itemLike = write(videoArg, '点赞', (c, id) => api.like(c, 'like', id))
export const itemUnlike = write(videoArg, '取消点赞', (c, id) => api.like(c, 'removelike', id))
/** 收藏即「稍后观看」（WL）。 */
export const itemCollect = write(videoArg, '加入稍后观看', (c, id) => api.editPlaylist(c, 'WL', [{ addedVideoId: id, action: 'ACTION_ADD_VIDEO' }]))
export const itemUncollect = write(videoArg, '移出稍后观看', (c, id) => api.editPlaylist(c, 'WL', [{ removedVideoId: id, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }]))

/** 视频所属频道：评论点赞的 action 要带它。 */
async function ownerOfVideo(c: YtClient, id: string): Promise<string> {
  const owner = norm.watchChannel(await api.next(c, id))
  if (owner) return owner
  const player = await api.player(c, id)
  assertVideo(c.ctx, player, id)
  return player.videoDetails.channelId
}

/** `--reply-to` 给根评论或某条回复：回复都挂在根评论下。 */
export async function commentAdd(ctx: Ctx) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  const to = (ctx.options.replyTo as string | undefined)?.trim()
  const root = to?.split('.')[0]
  const res = root ? await api.createReply(c, ctx.args.text!, createReplyParams(id, root)) : await api.createComment(c, ctx.args.text!, createCommentParams(id))
  checkWrite(res, '发表评论', '常见原因：账号没有开 YouTube 频道；视频关闭了评论；视频正在直播（只有直播聊天）')
  const created = norm.comments(res, id)[0]
  if (!created) throw new CatbusError('UPSTREAM', '评论已提交，但返回里没有新评论', { hint: `用 catbus youtube comment list ${id} 确认`, detail: { keys: Object.keys(res ?? {}) } })
  return created
}

async function actOnComment(ctx: Ctx, kind: 'like' | 'unlike' | 'delete', what: string) {
  const c = yt(ctx)
  const id = videoId(ctx.args.item!)
  const comment = ctx.args.comment!.trim()
  const res = await api.commentAction(c, [commentAction(kind, id, comment, await ownerOfVideo(c, id))])
  checkWrite(res, what)
  return { id: comment }
}

export const commentLike = (ctx: Ctx) => actOnComment(ctx, 'like', '点赞评论')
export const commentUnlike = (ctx: Ctx) => actOnComment(ctx, 'unlike', '取消点赞评论')
/** 只能删自己的评论。 */
export const commentDelete = (ctx: Ctx) => actOnComment(ctx, 'delete', '删除评论')
