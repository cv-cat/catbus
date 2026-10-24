import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { Comment, Event, Item, Live, Media, Notice, Series, User, UserRef } from '../../../core/schemas.js'

/** InnerTube 原始对象 → 归一化类型（AGENTS 6.2）。原始对象挂在结果上，供 `--raw`。 */

const BASE = 'https://www.youtube.com'

export const videoUrl = (id: string, shorts = false) => (shorts ? `${BASE}/shorts/${id}` : `${BASE}/watch?v=${id}`)
export const channelUrl = (id: string) => `${BASE}/channel/${id}`
export const playlistUrl = (id: string) => `${BASE}/playlist?list=${id}`

/** 按出现顺序深度优先遍历每个键；回调返回 false 时不再深入这个值，返回 'stop' 时结束整个遍历。 */
function walk(o: unknown, fn: (key: string, value: any) => boolean | 'stop' | void): boolean {
  if (Array.isArray(o)) {
    for (const v of o) if (!walk(v, fn)) return false
  } else if (o && typeof o === 'object') {
    for (const k in o) {
      const v = (o as Record<string, unknown>)[k]
      const r = fn(k, v)
      if (r === 'stop') return false
      if (r !== false && !walk(v, fn)) return false
    }
  }
  return true
}

/** 深度优先收集某个键下的所有对象。InnerTube 的列表嵌套层级随页面变化，按渲染器名字找比按路径取稳。 */
export function collect(o: unknown, key: string): any[] {
  const out: any[] = []
  walk(o, (k, v) => void (k === key && out.push(v)))
  return out
}

/** 第一个命中的对象，找到就停。 */
export function first(o: unknown, key: string): any {
  let hit: any
  walk(o, (k, v) => (k === key ? ((hit = v), 'stop') : undefined))
  return hit
}

/** `{simpleText}`、`{runs:[{text}]}`、`{content}` 三种文字结构。 */
export function text(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v || null
  if (typeof v.simpleText === 'string') return v.simpleText || null
  if (typeof v.content === 'string') return v.content || null
  if (Array.isArray(v.runs)) {
    const s = v.runs.map((r: any) => r.text ?? r.emoji?.shortcuts?.[0] ?? '').join('')
    return s || null
  }
  return null
}

const UNIT: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9 }

/** `1,234 views`、`15.8M subscribers`、`2.3M`、`No views` → 整数。 */
export function count(v: unknown): number | null {
  const s = typeof v === 'string' ? v : text(v)
  if (s == null) return null
  if (/^\s*no\b/i.test(s)) return 0
  const m = /([\d.,]+)\s*([KMB])?\b/i.exec(s)
  if (!m) return null
  const num = Number(m[1]!.replaceAll(',', ''))
  return Number.isFinite(num) ? Math.round(num * (m[2] ? UNIT[m[2].toUpperCase()]! : 1)) : null
}

const SPAN: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 }
const SHORT_SPAN: Record<string, string> = { s: 'second', m: 'minute', min: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }

/**
 * 相对时间 → ISO 时间：`4 years ago`、`6y ago`、`Streamed 2 days ago`、`3 weeks ago (edited)`。
 * 页面只给相对时间，结果是按当前时间倒推的近似值；精确时间只有 `item get`（microformat 的 publishDate）有。
 */
export function relTime(v: unknown): string | null {
  const s = typeof v === 'string' ? v : text(v)
  if (!s) return null
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year|mo|min|s|m|h|d|w|y)s?\b\.?\s*ago/i.exec(s)
  if (!m) return null
  const unit = SPAN[m[2]!.toLowerCase()] ?? SPAN[SHORT_SPAN[m[2]!.toLowerCase()] ?? '']
  if (!unit) return null
  return n.time(rand.nowSeconds() - Number(m[1]) * unit)
}

/** 缩略图取最大的那张：`{thumbnails:[...]}` 或 `{sources:[...]}`。 */
export function thumb(v: any): string | null {
  const list: any[] = v?.thumbnails ?? v?.sources ?? v?.image?.sources ?? []
  const best = list.reduce((a, b) => ((b?.width ?? 0) > (a?.width ?? 0) ? b : a), list[0])
  return n.url(best?.url)
}

/** 按频道 ID 的 UserRef；ID 为空时为 null。 */
export function channelUser(id: unknown, name: unknown): UserRef | null {
  return n.userRef({ id, name, url: id ? channelUrl(String(id)) : null })
}

function channelRef(endpoint: any, name: unknown): UserRef | null {
  const id = endpoint?.browseEndpoint?.browseId
  return typeof id === 'string' && id.startsWith('UC') ? channelUser(id, name) : null
}

/**
 * videoRenderer 的频道：署名直接链到频道；多人合作的视频署名点开是「Collaborators」列表（showDialogCommand），
 * 取列表第一个（上传者），再不行取频道头像的链接。
 */
function rendererOwner(v: any): UserRef | null {
  const run = v.ownerText?.runs?.[0] ?? v.longBylineText?.runs?.[0] ?? v.shortBylineText?.runs?.[0]
  if (run?.navigationEndpoint?.browseEndpoint) return channelRef(run.navigationEndpoint, run.text)
  const collaborator = first(run?.navigationEndpoint, 'listItemViewModel')
  const endpoint = first(collaborator, 'browseEndpoint') ?? first(v.channelThumbnailSupportedRenderers, 'browseEndpoint')
  return channelRef({ browseEndpoint: endpoint }, text(collaborator?.title) ?? run?.text)
}

/**
 * 搜索结果、旧版列表里的 videoRenderer；稍后观看等播放列表里的 playlistVideoRenderer 结构相同，
 * 只是播放量和时间合在 videoInfo 里（`1.8B views • 16 years ago`）。
 */
export function videoRenderer(v: any): Item {
  const snippet = v.detailedMetadataSnippets?.[0]?.snippetText ?? v.descriptionSnippet
  const info = text(v.videoInfo)
  return n.item(
    {
      id: v.videoId,
      kind: 'video',
      url: videoUrl(v.videoId),
      title: text(v.title),
      text: text(snippet),
      author: rendererOwner(v),
      created_at: relTime(v.publishedTimeText ?? info),
      cover: thumb(v.thumbnail),
      stats: { views: count(v.viewCountText ?? info) },
    },
    v,
  )
}

function lockupRows(v: any): string[] {
  const rows: any[] = v?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? []
  return rows.flatMap((r) => (r.metadataParts ?? []).map((p: any) => text(p.text) ?? '')).filter(Boolean)
}

/**
 * 新版列表（推荐、频道视频、播放列表）里的 lockupViewModel，contentType 为 VIDEO 时是视频。
 * 元数据行没有字段名：带 `views` / `watching` 的是播放量，带 `ago` 的是时间，其余第一个是频道名。
 * `author` 取不到时用 fallback（频道页里列表项不带频道）。
 */
export function lockupVideo(v: any, fallback: UserRef | null = null): Item {
  const id: string = v.contentId
  const rows = lockupRows(v)
  const md = v.metadata?.lockupMetadataViewModel
  const views = rows.find((r) => /views?$|watching/i.test(r) || /^[\d.,]+[KMB]?$/i.test(r))
  const ago = rows.find((r) => /\bago\b/i.test(r))
  const name = rows.find((r) => r !== views && r !== ago)
  const author = channelRef({ browseEndpoint: first(md?.image, 'browseEndpoint') }, name) ?? fallback
  return n.item(
    {
      id,
      kind: 'video',
      url: videoUrl(id),
      title: text(md?.title),
      author,
      created_at: relTime(ago),
      cover: thumb(v.contentImage?.thumbnailViewModel?.image),
      stats: { views: count(views) },
    },
    v,
  )
}

/** Shorts 列表项。 */
export function shortsLockup(v: any, fallback: UserRef | null = null): Item {
  const id: string = first(v.onTap, 'reelWatchEndpoint')?.videoId ?? String(v.entityId ?? '').replace(/^shorts-shelf-item-/, '')
  return n.item(
    {
      id,
      kind: 'video',
      url: videoUrl(id, true),
      title: text(v.overlayMetadata?.primaryText),
      author: fallback,
      cover: thumb(v.thumbnailViewModel?.thumbnailViewModel?.image ?? v.thumbnail),
      stats: { views: count(v.overlayMetadata?.secondaryText) },
    },
    v,
  )
}

/** 响应里所有的视频，按出现顺序去重。播放列表类的 lockup 不算。 */
export function videos(res: unknown, fallback: UserRef | null = null): Item[] {
  const out: Item[] = []
  const seen = new Set<string>()
  const push = (it: Item) => {
    if (it.id && !seen.has(it.id)) (seen.add(it.id), out.push(it))
  }
  walk(res, (k, v) => {
    if (k === 'videoRenderer' || k === 'gridVideoRenderer' || k === 'compactVideoRenderer' || k === 'playlistVideoRenderer') push(videoRenderer(v))
    else if (k === 'lockupViewModel' && v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') push(lockupVideo(v, fallback))
    else if (k === 'shortsLockupViewModel') push(shortsLockup(v, fallback))
    else return true
    return false
  })
  return out
}

/** 列表项是「加载更多」时的 token：旧版 continuationItemRenderer，新版（播放列表）continuationItemViewModel。 */
function continuationOf(x: any): string | null {
  const c = x?.continuationItemRenderer ?? x?.continuationItemViewModel
  return c ? (collect(c, 'continuationCommand').map((cc) => cc.token).find((t) => typeof t === 'string') ?? null) : null
}

/**
 * 列表的下一页 token：挂在列表最后一项的「加载更多」。页面上还有排序 chip、评论入口等别的 continuation，
 * 所以只看数组末尾的，取最长的那个数组（就是内容列表）。
 */
export function nextToken(res: unknown): string | null {
  let best: { token: string; size: number } | null = null
  const visit = (o: unknown): void => {
    if (Array.isArray(o)) {
      const token = o.length ? continuationOf(o.at(-1)) : null
      if (token && (!best || o.length > best.size)) best = { token, size: o.length }
      for (const v of o) visit(v)
    } else if (o && typeof o === 'object') for (const v of Object.values(o)) visit(v)
  }
  visit(res)
  return (best as { token: string } | null)?.token ?? null
}

/** 搜索结果里的频道。 */
export function channelRenderer(v: any): User {
  const id: string = v.channelId
  // 新版页面里 subscriberCountText 放的是 @handle，videoCountText 放的是订阅数
  const handle = [text(v.subscriberCountText), text(v.videoCountText)].find((s) => s?.startsWith('@')) ?? null
  const subs = [text(v.videoCountText), text(v.subscriberCountText)].find((s) => s && /subscriber/i.test(s))
  const canonical: string | undefined = v.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
  return n.user(
    {
      id,
      name: text(v.title),
      handle: handle ?? (canonical?.startsWith('/@') ? canonical.slice(1) : null),
      avatar: thumb(v.thumbnail),
      url: channelUrl(id),
      bio: text(v.descriptionSnippet),
      stats: { followers: count(subs) },
    },
    v,
  )
}

/** 频道页（browse UC…）：metadata 给名字、简介、头像，pageHeaderViewModel 给 @handle、订阅数、视频数。 */
export function channel(res: any): User {
  const md = res?.metadata?.channelMetadataRenderer ?? {}
  const header = first(res?.header, 'pageHeaderViewModel')
  const parts = lockupRows({ metadata: { lockupMetadataViewModel: { metadata: header?.metadata } } })
  const id: string = md.externalId ?? first(res?.header, 'browseEndpoint')?.browseId
  const vanity: string | undefined = md.vanityChannelUrl
  return n.user(
    {
      id,
      name: md.title ?? text(header?.title?.dynamicTextViewModel?.text),
      handle: parts.find((p) => p.startsWith('@')) ?? (vanity?.includes('/@') ? vanity.slice(vanity.indexOf('/@') + 1) : null),
      avatar: thumb(md.avatar),
      url: channelUrl(id),
      bio: md.description || null,
      stats: { followers: count(parts.find((p) => /subscriber/i.test(p))), items: count(parts.find((p) => /videos?$/i.test(p))) },
    },
    res,
  )
}

/** 频道播放列表 tab 里的播放列表。 */
export function playlists(res: unknown): Series[] {
  return collect(res, 'lockupViewModel')
    .filter((v) => v.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST')
    .map((v) => {
      const badge = collect(v.contentImage, 'thumbnailBadgeViewModel')
        .map((b) => b.text as string)
        .find((t) => /video|episode|lesson/i.test(t ?? ''))
      return n.folder({ id: v.contentId, name: text(v.metadata?.lockupMetadataViewModel?.title) ?? v.contentId, count: count(badge), url: playlistUrl(v.contentId) }, v)
    })
}

/**
 * 视频详情：player 的 videoDetails + microformat（精确的发布时间、点赞数），评论数取自 next 的评论面板。
 */
export function video(player: any, next: any): Item {
  const d = player?.videoDetails ?? {}
  const mf = player?.microformat?.playerMicroformatRenderer ?? {}
  const id: string = d.videoId
  const panel = collect(next, 'engagementPanelSectionListRenderer').find((p) => p.panelIdentifier === 'engagement-panel-comments-section')
  const comments = count(first(panel, 'contextualInfo'))
  const shorts = mf.isShortsEligible === true && Number(d.lengthSeconds) <= 180 && /\/shorts\//.test(mf.canonicalUrl ?? '')
  return n.item(
    {
      id,
      kind: 'video',
      url: videoUrl(id, shorts),
      title: d.title ?? mf.title?.simpleText ?? null,
      text: d.shortDescription || null,
      author: channelUser(d.channelId, d.author),
      created_at: n.time(mf.publishDate ?? mf.uploadDate),
      cover: thumb(d.thumbnail),
      stats: { views: n.count(d.viewCount), likes: n.count(mf.likeCount), comments },
      status: d.isPrivate === true ? 'private' : null,
    },
    { player, next },
  )
}

/** 评论区：commentThreadRenderer / commentViewModel 只给 key，内容在 frameworkUpdates 的 commentEntityPayload 里。 */
export function comments(res: unknown, videoId: string): Comment[] {
  return collect(res, 'commentEntityPayload').map((e) => comment(e, videoId))
}

export function comment(e: any, videoId: string): Comment {
  const p = e.properties ?? {}
  const a = e.author ?? {}
  const id: string = p.commentId
  // 回复都挂在根评论下（回复某条回复时只是在正文前 @ 对方），回复的 ID 是「根评论 ID.回复 ID」
  const parent = p.replyLevel > 0 && id.includes('.') ? id.slice(0, id.indexOf('.')) : null
  return n.comment(
    {
      id,
      item_id: videoId,
      parent_id: parent,
      author: channelUser(a.channelId, a.displayName),
      text: text(p.content) ?? '',
      created_at: relTime(p.publishedTime),
      stats: { likes: count(e.toolbar?.likeCountNotliked) ?? 0, replies: count(e.toolbar?.replyCount) ?? 0 },
    },
    e,
  )
}

/** 搜索结果里正在直播的视频（带 LIVE 角标）。 */
export function liveRenderer(v: any): Live {
  const it = videoRenderer(v)
  return n.live({ id: it.id, url: it.url, title: it.title, status: 'live', host: it.author, cover: it.cover, stats: { viewers: count(v.viewCountText) } }, v)
}

export function isLiveRenderer(v: any): boolean {
  return (v.badges ?? []).some((b: any) => /LIVE/.test(b.metadataBadgeRenderer?.style ?? '')) || /watching/i.test(text(v.viewCountText) ?? '')
}

/** 直播间：player 的 videoDetails 给状态，next 给在看人数。 */
export function liveRoom(player: any, next: any): Live {
  const d = player?.videoDetails ?? {}
  const viewers = first(next, 'videoViewCountRenderer')
  const live = d.isLive === true || viewers?.isLive === true
  return n.live(
    {
      id: d.videoId,
      url: videoUrl(d.videoId),
      title: d.title ?? null,
      status: live ? 'live' : 'offline',
      host: channelUser(d.channelId, d.author),
      cover: thumb(d.thumbnail),
      stats: { viewers: live ? (n.count(viewers?.originalViewCount) ?? count(viewers?.viewCount)) : null },
    },
    { player, next },
  )
}

/** 直播聊天的 action → Event。占位、系统提示等不是观众事件的返回 null。 */
export function chatEvent(action: any): Event | null {
  const item = action?.addChatItemAction?.item
  if (!item) return null
  const [kind, r] = Object.entries(item)[0] as [string, any]
  const user = channelUser(r.authorExternalChannelId, text(r.authorName))
  const time = n.time(r.timestampUsec) ?? undefined
  switch (kind) {
    case 'liveChatTextMessageRenderer':
      return n.event({ type: 'chat', time, user, text: text(r.message) }, r)
    case 'liveChatPaidMessageRenderer':
      return n.event({ type: 'gift', time, user, text: text(r.message), gift: { name: `Super Chat ${text(r.purchaseAmountText) ?? ''}`.trim(), count: 1 } }, r)
    case 'liveChatPaidStickerRenderer':
      return n.event({ type: 'gift', time, user, text: null, gift: { name: `Super Sticker ${text(r.purchaseAmountText) ?? ''}`.trim(), count: 1 } }, r)
    case 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer': {
      const h = r.header?.liveChatSponsorshipsHeaderRenderer ?? {}
      const giftUser = channelUser(r.authorExternalChannelId, text(h.authorName))
      return n.event({ type: 'gift', time, user: giftUser, text: text(h.primaryText), gift: { name: 'Membership gift', count: count(h.primaryText) ?? 1 } }, r)
    }
    case 'liveChatMembershipItemRenderer':
      return n.event({ type: 'other', time, user, text: text(r.headerSubtext) ?? text(r.message) }, r)
    default:
      return null
  }
}

const NOTICE_TYPE: [RegExp, Notice['type']][] = [
  [/\brepl(y|ied)\b/i, 'comment'],
  [/\bmention/i, 'mention'],
  [/\b(liked|hearted)\b/i, 'like'],
  [/\bsubscribed\b/i, 'follow'],
]

/**
 * 通知菜单里的 notificationRenderer。大多是订阅频道的新视频（system），按文案识别回复、提及、点赞、新订阅。
 * 2026-10-24 测试账号没有通知，字段取自 YouTube.js 的解析器，尚未用真实数据核对。
 */
export function notification(v: any): Notice {
  const msg = text(v.shortMessage)
  const watch = first(v.navigationEndpoint, 'watchEndpoint')
  const vid: string | undefined = watch?.videoId
  return n.notice(
    {
      id: String(v.notificationId ?? ''),
      type: NOTICE_TYPE.find(([re]) => re.test(msg ?? ''))?.[1] ?? 'system',
      target: vid ? { id: vid, url: videoUrl(vid) } : null,
      text: msg,
      created_at: relTime(v.sentTimeText),
    },
    v,
  )
}

/** `video/mp4; codecs="avc1.640028"` → 扩展名：mp4 / webm，音频的 mp4 为 m4a。 */
export function formatExt(mime: string | undefined): string {
  const [type, sub] = (mime ?? '').split(';')[0]!.split('/')
  if (sub === 'webm') return 'webm'
  return type === 'audio' ? 'm4a' : 'mp4'
}

/**
 * player 的 adaptiveFormats → 最清晰的一路视频 + 码率最高的一路音频（DASH 分轨，与 B 站的处理相同）。
 * 同样高度时优先 mp4（H.264 兼容性最好）。没有分轨时退回到音视频合一的 formats。
 */
export function playMedia(player: any): Media[] {
  const sd = player?.streamingData ?? {}
  const duration = n.seconds(player?.videoDetails?.lengthSeconds)
  const adaptive: any[] = (sd.adaptiveFormats ?? []).filter((f: any) => f.url)
  const isMp4 = (f: any) => (f.mimeType ?? '').startsWith('video/mp4')
  const videos = adaptive.filter((f) => (f.mimeType ?? '').startsWith('video/'))
  const audios = adaptive.filter((f) => (f.mimeType ?? '').startsWith('audio/'))
  const video = videos.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || Number(isMp4(b)) - Number(isMp4(a)) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
  const audio = audios.sort((a, b) => Number((b.mimeType ?? '').startsWith('audio/mp4')) - Number((a.mimeType ?? '').startsWith('audio/mp4')) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
  const muxed = (sd.formats ?? []).filter((f: any) => f.url).sort((a: any, b: any) => (b.height ?? 0) - (a.height ?? 0))[0]
  const pick = video && audio ? [video, audio] : muxed ? [muxed] : []
  return pick.map((f) =>
    n.media(
      {
        id: String(f.itag),
        type: (f.mimeType ?? '').startsWith('audio/') ? 'audio' : 'video',
        url: f.url,
        width: f.width ?? null,
        height: f.height ?? null,
        duration: n.seconds(f.approxDurationMs) != null ? Number(f.approxDurationMs) / 1000 : duration,
      },
      f,
    ),
  )
}

/** `Oct 24, 2009`、`Premiered Oct 1, 2020`、`Streamed live on Mar 3, 2024` → ISO（按 UTC 的当天）；相对时间按 relTime。 */
function watchDate(v: unknown): string | null {
  const s = text(v)
  const m = s ? /([A-Z][a-z]{2,8}) (\d{1,2}), (\d{4})/.exec(s) : null
  if (m) {
    const ms = Date.parse(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`)
    if (Number.isFinite(ms)) return n.time(ms)
  }
  return relTime(s)
}

/** watch 页（next）的主信息：标题、播放量、日期、频道、简介、点赞。player 被人机验证拦下时用它兜底。 */
function watchInfo(next: any) {
  const p = first(next, 'videoPrimaryInfoRenderer')
  if (!p) return null
  const s = first(next, 'videoSecondaryInfoRenderer')
  const owner = s?.owner?.videoOwnerRenderer
  const views = p.viewCount?.videoViewCountRenderer ?? {}
  // 精确的点赞数只在无障碍文字里：「like this video along with 19,494,554 other people」
  const likeText = collect(first(p, 'likeButtonViewModel'), 'accessibilityText').find((t: string) => /along with/i.test(t))
  return {
    title: text(p.title),
    views: n.count(views.originalViewCount) ?? count(views.viewCount),
    live: views.isLive === true,
    date: watchDate(p.dateText),
    channel: channelRef(owner?.navigationEndpoint, text(owner?.title)),
    description: text(s?.attributedDescription) ?? text(s?.description),
    likes: likeText ? count(likeText) : count(text(first(first(p, 'likeButtonViewModel'), 'title'))),
  }
}

/** 视频的封面：watch 页不给缩略图，用固定格式的地址。 */
const coverOf = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/** 只有 watch 页数据时的视频详情（player 被拦）：发布日期只精确到天，点赞数取自按钮文字。 */
export function watchVideo(id: string, next: any): Item | null {
  const w = watchInfo(next)
  if (!w) return null
  const panel = collect(next, 'engagementPanelSectionListRenderer').find((x) => x.panelIdentifier === 'engagement-panel-comments-section')
  return n.item(
    {
      id,
      kind: 'video',
      url: videoUrl(id),
      title: w.title,
      text: w.description,
      author: w.channel,
      created_at: w.date,
      cover: coverOf(id),
      stats: { views: w.views, likes: w.likes, comments: count(first(panel, 'contextualInfo')) },
    },
    { next },
  )
}

/** 直播间信息只用 watch 页：不调 player，少一次容易触发人机验证的请求。 */
export function watchLive(id: string, next: any): Live | null {
  const w = watchInfo(next)
  if (!w) return null
  return n.live(
    { id, url: videoUrl(id), title: w.title, status: w.live ? 'live' : 'offline', host: w.channel, cover: coverOf(id), stats: { viewers: w.live ? w.views : null } },
    { next },
  )
}

/** watch 页里视频所属的频道 ID。 */
export function watchChannel(next: any): string | null {
  return watchInfo(next)?.channel?.id ?? null
}
