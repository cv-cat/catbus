import * as n from '../../../core/normalize.js'
import type { Category, Comment, Conversation, Event, Folder, Gift, Item, Live, Media, Message, Notice, Poi, Rank, User, UserRef } from '../../../core/schemas.js'
import { ORIGIN, SHOP } from './profile.js'
import type { LiveEvent, LiveUser, PulledMessage } from './wire.js'

/** TikTok 原始对象 → 归一化类型（AGENTS 6.2）。 */

export const userUrl = (uniqueId: unknown) => (uniqueId ? `${ORIGIN}/@${uniqueId}` : null)
export const itemUrl = (uniqueId: unknown, id: unknown, photo = false) => `${ORIGIN}/@${uniqueId || '_'}/${photo ? 'photo' : 'video'}/${id}`
export const liveUrl = (uniqueId: unknown) => (uniqueId ? `${ORIGIN}/@${uniqueId}/live` : null)
export const productUrl = (id: unknown) => `${SHOP}/view/product/${id}`

export function ref(id: unknown, name: unknown, uniqueId?: unknown): UserRef | null {
  return n.userRef({ id, name: name || uniqueId, url: userUrl(uniqueId) })
}

const first = (v: unknown): string | null => (Array.isArray(v) ? n.url(v[0]) : n.url(v))

/** 作品（itemStruct：视频页 hydration、搜索、推荐、主页列表都用这个结构）。 */
export function item(v: any): Item {
  const a = v.author ?? {}
  const photo = Boolean(v.imagePost)
  const s = { ...(v.stats ?? {}), ...(v.statsV2 ?? {}) }
  return n.item(
    {
      id: n.id(v.id),
      kind: photo ? 'image' : 'video',
      url: itemUrl(a.uniqueId, v.id, photo),
      title: n.str(v.imagePost?.title),
      text: n.str(v.desc),
      author: ref(a.id, a.nickname, a.uniqueId),
      created_at: n.time(v.createTime),
      cover: n.url(v.video?.cover || v.video?.originCover) ?? first(v.imagePost?.cover?.imageURL?.urlList),
      media: itemMedia(v),
      stats: {
        views: n.count(s.playCount),
        likes: n.count(s.diggCount),
        comments: n.count(s.commentCount),
        collects: n.count(s.collectCount),
        shares: n.count(s.shareCount),
      },
      status: v.privateItem || v.secret ? 'private' : null,
    },
    v,
  )
}

/** 可播放 / 下载的媒体：视频取 playAddr（同源 h264），图文取每张图，另附背景音乐。 */
export function itemMedia(v: any): Media[] {
  const out: Media[] = []
  const images: any[] = v.imagePost?.images ?? []
  if (images.length) {
    images.forEach((img, i) => {
      const url = first(img.imageURL?.urlList)
      if (url) out.push(n.media({ id: String(i + 1), type: 'image', url, width: n.count(img.imageWidth), height: n.count(img.imageHeight) }, img))
    })
  } else if (v.video) {
    const url = n.url(v.video.playAddr) ?? n.url(v.video.downloadAddr) ?? first(v.video.bitrateInfo?.[0]?.PlayAddr?.UrlList)
    if (url) {
      out.push(
        n.media(
          { id: n.id(v.video.id || v.id), type: 'video', url, width: n.count(v.video.width), height: n.count(v.video.height), duration: n.seconds(v.video.duration) },
          v.video,
        ),
      )
    }
  }
  if (images.length && v.music?.playUrl) out.push(n.media({ id: n.id(v.music.id), type: 'audio', url: n.url(v.music.playUrl)!, duration: n.seconds(v.music.duration) }, v.music))
  return out
}

/** 用户（user-detail 的 userInfo，或列表里的 {user, stats}）。 */
export function user(info: any): User {
  const u = info.user ?? info
  const s = { ...(info.stats ?? {}), ...(info.statsV2 ?? {}) }
  return n.user(
    {
      id: n.id(u.id ?? u.uid),
      name: n.str(u.nickname ?? u.nickName),
      handle: n.str(u.uniqueId ?? u.unique_id),
      avatar: n.url(u.avatarLarger ?? u.avatarMedium ?? u.avatarThumb),
      url: userUrl(u.uniqueId ?? u.unique_id),
      bio: n.str(u.signature),
      stats: {
        followers: n.count(s.followerCount),
        following: n.count(s.followingCount),
        items: n.count(s.videoCount),
        likes: n.count(s.heartCount ?? s.heart),
      },
    },
    info,
  )
}

export function comment(v: any, itemId: string): Comment {
  const u = v.user ?? {}
  const parent = v.reply_id && v.reply_id !== '0' ? n.id(v.reply_id) : null
  return n.comment(
    {
      id: n.id(v.cid),
      item_id: n.id(v.aweme_id ?? itemId),
      parent_id: parent,
      author: ref(u.uid, u.nickname, u.unique_id),
      text: String(v.text ?? ''),
      created_at: n.time(v.create_time),
      stats: { likes: n.count(v.digg_count), replies: n.count(v.reply_comment_total) },
    },
    v,
  )
}

/** 商品评价（Shop PDP 的 product_reviews 项）。 */
export function review(v: any, productId: string): Comment {
  return n.comment(
    {
      id: n.id(v.review_id ?? v.id),
      item_id: productId,
      author: n.userRef({ id: v.review_user?.user_id ?? v.user_id ?? v.review_user?.name, name: v.review_user?.name ?? v.user_name }),
      text: String(v.review_text ?? v.display_text ?? v.text ?? ''),
      created_at: n.time(v.review_timestamp ?? v.review_time ?? v.create_time),
      stats: { likes: n.count(v.like_count ?? v.helpful_count), replies: null },
    },
    v,
  )
}

/** 商品（Shop PDP SSR 的 product_info.component_data）。 */
export function product(d: any): Item {
  const p = d.product_info?.product_model ?? {}
  const promo = d.product_info?.promotion_model ?? d.promotion_model ?? {}
  const seller = d.product_info?.seller_model ?? d.seller_model ?? d.shop_info ?? {}
  const price = promo.promotion_product_price ?? promo.min_price ?? p.min_price ?? {}
  const images: any[] = p.images ?? []
  const amount = price.sale_price_decimal ?? price.real_price ?? price.min_sku_price ?? price.price_val
  return n.item(
    {
      id: n.id(p.product_id),
      kind: 'goods',
      url: productUrl(p.product_id),
      title: n.str(p.name ?? p.title),
      text: n.str(p.description_text ?? null),
      author: n.userRef({ id: seller.seller_id ?? seller.shop_id, name: seller.name ?? seller.shop_name }),
      cover: first(images[0]?.url_list),
      media: images.flatMap((img, i) => {
        const url = first(img.url_list)
        return url ? [n.media({ id: String(i + 1), type: 'image', url, width: n.count(img.width), height: n.count(img.height) }, img)] : []
      }),
      stats: { comments: n.count(d.review_info?.total_reviews ?? p.review_count), views: null, likes: null, collects: null, shares: null },
      price: amount != null ? n.price(String(amount).replace(/[^\d.]/g, ''), price.currency ?? price.currency_name ?? 'USD') : null,
      status: p.status === 1 || p.status == null ? 'on_sale' : 'off_shelf',
    },
    d,
  )
}

export function folder(v: any): Folder {
  return n.folder({ id: n.id(v.collectionId), name: String(v.name ?? ''), count: n.count(v.total), url: v.userName ? `${ORIGIN}/@${v.userName}/collection/${encodeURIComponent(v.name ?? '')}-${v.collectionId}` : null }, v)
}

export function series(v: any): Folder {
  const id = n.id(v.mixId ?? v.id)
  const creator = v.creator?.uniqueId
  return n.folder({ id, name: String(v.mixName ?? v.name ?? ''), count: n.count(v.videoCount), url: creator ? `${ORIGIN}/@${creator}/playlist/${encodeURIComponent(v.mixName ?? v.name ?? '')}-${id}` : null }, v)
}

// ---------------------------------------------------------------- 直播

/** /api-live/user/room 的 data：user + liveRoom。status 2 为直播中。 */
export function liveRoom(d: any): Live {
  const u = d.user ?? {}
  const r = d.liveRoom ?? {}
  return n.live(
    {
      id: n.id(u.roomId || r.roomId),
      url: liveUrl(u.uniqueId),
      title: n.str(r.title),
      status: Number(r.status ?? u.status) === 2 ? 'live' : 'offline',
      host: ref(u.id, u.nickname, u.uniqueId),
      cover: n.url(r.coverUrl),
      stats: { viewers: n.count(r.liveRoomStats?.userCount) },
    },
    d,
  )
}

/** webcast 接口的房间对象（feed、搜索）：snake_case。 */
export function webcastRoom(r: any): Live {
  const o = r.owner ?? {}
  return n.live(
    {
      id: n.id(r.id_str ?? r.id),
      url: liveUrl(o.display_id),
      title: n.str(r.title),
      status: Number(r.status) === 2 ? 'live' : 'offline',
      host: ref(o.id_str ?? o.id, o.nickname, o.display_id),
      cover: first(r.cover?.url_list),
      stats: { viewers: n.count(r.user_count ?? r.stats?.total_user) },
    },
    r,
  )
}

/** 画质的顺序：原画在前，纯音频（ao）在最后。 */
const QUALITIES = ['origin', 'uhd', 'hd', 'sd', 'ld', 'md', 'ao']
const PROTOCOLS = ['flv', 'hls', 'cmaf', 'dash', 'lls']

function parseJson(v: unknown): any {
  if (typeof v !== 'string') return v ?? null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

/**
 * 拉流地址（上游没有解析）。两种来源：
 * - `pull_data.stream_data`：JSON 串，`data.<画质>.main.{flv,hls,...}`，`sdk_params`（JSON 串）里有 resolution。
 *   /api-live/user/room 在 `liveRoom.streamData`，webcast 房间对象在 `stream_url.live_core_sdk_data`；
 * - webcast 房间对象的 `stream_url.flv_pull_url`（画质 → 地址）、`hls_pull_url_map`、`hls_pull_url`、`rtmp_pull_url`。
 */
export function liveStreams(source: any): Media[] {
  const out: Media[] = []
  const seen = new Set<string>()
  const push = (id: string, url: unknown, raw: unknown, size?: string) => {
    const u = n.url(url)
    if (!u || seen.has(u)) return
    seen.add(u)
    const [w, h] = /^(\d+)x(\d+)$/.exec(String(size ?? ''))?.slice(1) ?? []
    out.push(n.media({ id, type: id.startsWith('ao-') ? 'audio' : 'video', url: u, width: n.count(w), height: n.count(h) }, raw))
  }
  // 可能是 {pull_data}、{live_core_sdk_data}，也可能已经是 stream_data 本身（JSON 串或解析后的对象）
  const pull = source?.pull_data ?? source?.live_core_sdk_data?.pull_data
  const data = parseJson(pull?.stream_data ?? (typeof source === 'string' || source?.data ? source : null))?.data
  if (data && typeof data === 'object') {
    const keys = Object.keys(data).sort((a, b) => (QUALITIES.indexOf(a) + 1 || 99) - (QUALITIES.indexOf(b) + 1 || 99))
    for (const q of keys) {
      const main = data[q]?.main ?? {}
      const size = parseJson(main.sdk_params)?.resolution
      for (const p of PROTOCOLS) push(`${q}-${p}`, main[p], data[q], size)
    }
  }
  for (const [q, url] of Object.entries(source?.flv_pull_url ?? {})) push(`${q}-flv`, url, source)
  for (const [q, url] of Object.entries(source?.hls_pull_url_map ?? {})) push(`${q}-hls`, url, source)
  push('default-hls', source?.hls_pull_url, source)
  push('default-rtmp', source?.rtmp_pull_url, source)
  return out
}

export function gift(g: any): Gift {
  return n.gift({ id: n.id(g.id), name: String(g.name ?? ''), price: g.diamond_count != null ? { amount: Number(g.diamond_count), currency: 'TIKTOK_DIAMOND' } : null }, g)
}

export function rank(v: any, i: number): Rank | null {
  const u = v.user ?? {}
  const r = ref(u.id_str ?? u.id, u.nickname, u.display_id)
  return r ? n.rank({ rank: Number(v.rank ?? i + 1), user: r, score: n.count(v.score) }, v) : null
}

function liveUserRef(u?: LiveUser): UserRef | null {
  return u && u.id !== '0' ? ref(u.id, u.nickname, u.display_id) : null
}

/** 直播 protobuf 事件 → Event；只保留上游关心的 chat / like / gift。 */
export function liveEvent(e: LiveEvent): Event | null {
  if (e.type === 'chat') return n.event({ type: 'chat', user: liveUserRef(e.user), text: e.text ?? '' }, e)
  if (e.type === 'like') return n.event({ type: 'like', user: liveUserRef(e.user), text: e.count != null ? String(e.count) : null }, e)
  if (e.type === 'gift') return n.event({ type: 'gift', user: liveUserRef(e.user), gift: { name: e.gift?.name || String(e.gift_id ?? ''), count: e.combo_count || 1 } }, e)
  return null
}

export function categories(tabs: any[]): Category[] {
  return tabs.flatMap((t) => [
    n.category({ id: String(t.tab_type ?? t.tab_name), name: String(t.tab_name ?? t.tab_type) }, t),
    ...(t.sub_tabs ?? []).map((s: any) => n.category({ id: String(s.tab_type ?? s.tab_name), name: String(s.tab_name ?? s.tab_type), parent_id: String(t.tab_type ?? t.tab_name) }, s)),
  ])
}

// ---------------------------------------------------------------- 通知与私信

const NOTICE_TYPES: Record<number, Notice['type']> = { 31: 'comment', 45: 'comment', 33: 'follow', 41: 'like', 60: 'like', 62: 'like', 43: 'mention', 44: 'mention' }

/**
 * 通知：动态（group 500，按 follow / digg / comment / at 分）与系统通知（group 661，`system` 为 true）。
 * 模板通知（template_notice）的标题在 notice.title_template.title，正文在 notice.content；动态里的转发通知也用模板。
 */
export function notice(v: any, system = false): Notice {
  const template = v.template_notice?.notice
  const type = system ? 'system' : (NOTICE_TYPES[Number(v.type)] ?? (v.follow ? 'follow' : v.digg ? 'like' : v.comment ? 'comment' : v.at ? 'mention' : 'system'))
  const body = v.follow ?? v.digg ?? v.comment ?? v.at ?? v.system ?? template ?? {}
  const u = body.from_user?.[0] ?? body.user ?? body.from_user ?? v.from_user ?? {}
  const aweme = body.aweme ?? body.comment?.aweme ?? null
  const text = template ? [template.title_template?.title, template.content].filter(Boolean).join('\n') : (body.content ?? body.comment?.text ?? body.title ?? v.content)
  return n.notice(
    {
      id: n.id(v.nid_str ?? v.nid),
      type,
      user: ref(u.uid ?? u.id, u.nickname, u.unique_id ?? u.uniqueId),
      target: aweme?.aweme_id ? { id: n.id(aweme.aweme_id), url: itemUrl(aweme.author?.unique_id, aweme.aweme_id) } : null,
      text: n.str(text),
      created_at: n.time(v.create_time),
    },
    v,
  )
}

export function pulledMessage(m: PulledMessage): Message {
  return n.message(
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

export function conversation(id: string, peer: string | null, last: PulledMessage | undefined, raw: unknown): Conversation {
  return n.conversation(
    {
      id,
      peer: peer ? n.userRef({ id: peer }) : null,
      last_message: last?.text ?? null,
      updated_at: last ? n.time(Number(last.create_time) > 1e14 ? Math.floor(Number(last.create_time) / 1000) : last.create_time) : null,
    },
    raw,
  )
}

export function poi(v: any): Poi {
  return n.poi({ id: n.id(v.poi_id ?? v.id), name: String(v.poi_name ?? v.name ?? ''), address: n.str(v.address ?? v.poi_address ?? v.city_name) }, v)
}
