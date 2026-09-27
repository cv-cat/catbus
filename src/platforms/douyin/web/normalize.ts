import * as n from '../../../core/normalize.js'
import type { Comment, Event, Item, Live, Media, Notice, User, UserRef } from '../../../core/schemas.js'
import { LIVE, WWW } from './profile.js'

/** 抖音原始对象 → 归一化类型（AGENTS 6.2）。用户 id 用 sec_uid：它能直接拼出主页 URL，也是各接口的入参。 */

export const userUrl = (secUid: unknown) => `${WWW}/user/${secUid}`
export const liveUrl = (webRid: unknown) => `${LIVE}/${webRid}`
export const itemUrl = (id: unknown, image = false) => `${WWW}/${image ? 'note' : 'video'}/${id}`

const first = (v: any): string | null => n.url(v?.url_list?.[0])

export function ref(secUid: unknown, name: unknown): UserRef | null {
  return n.userRef({ id: secUid, name, url: secUid ? userUrl(secUid) : null })
}

export function authorRef(u: any): UserRef | null {
  if (!u) return null
  return ref(u.sec_uid || u.sec_user_id, u.nickname)
}

/** 图文：aweme_type 68，或带 images。 */
function isImage(v: any): boolean {
  return v?.aweme_type === 68 || (Array.isArray(v?.images) && v.images.length > 0)
}

/** 作品的媒体：视频取 play_addr，图文取每张图（上游 handle_work_info 的 video_addr / images）。 */
export function awemeMedia(v: any): Media[] {
  if (isImage(v)) {
    return (v.images ?? [])
      .map((img: any, i: number) => {
        const url = n.url(img?.url_list?.at(-1) ?? img?.url_list?.[0])
        return url ? n.media({ id: String(i + 1), type: 'image', url, width: n.count(img.width), height: n.count(img.height) }, img) : null
      })
      .filter(Boolean) as Media[]
  }
  const video = v?.video ?? {}
  const url = first(video.play_addr)
  if (!url) return []
  const duration = n.seconds(v.duration ?? video.duration)
  return [
    n.media(
      {
        id: n.idOrNull(video.play_addr?.uri),
        type: 'video',
        url,
        width: n.count(video.width ?? video.play_addr?.width),
        height: n.count(video.height ?? video.play_addr?.height),
        duration: duration == null ? null : duration / 1000,
      },
      video.play_addr,
    ),
  ]
}

export function aweme(v: any): Item {
  const image = isImage(v)
  const stats = v.statistics ?? {}
  return n.item(
    {
      id: n.id(v.aweme_id),
      kind: image ? 'image' : 'video',
      url: itemUrl(v.aweme_id, image),
      title: n.str(v.item_title),
      text: n.str(v.desc),
      author: authorRef(v.author),
      created_at: n.time(v.create_time),
      cover: first(v.video?.cover) ?? first(v.video?.origin_cover) ?? (image ? first(v.images?.[0]) : null),
      media: awemeMedia(v),
      stats: {
        views: n.count(stats.play_count) || null,
        likes: n.count(stats.digg_count),
        comments: n.count(stats.comment_count),
        collects: n.count(stats.collect_count),
        shares: n.count(stats.share_count),
      },
    },
    v,
  )
}

export function user(u: any): User {
  return n.user(
    {
      id: n.id(u.sec_uid),
      name: n.str(u.nickname),
      handle: n.str(u.unique_id) ?? n.str(u.short_id),
      avatar: first(u.avatar_larger) ?? first(u.avatar_300x300) ?? first(u.avatar_medium) ?? first(u.avatar_thumb),
      url: u.sec_uid ? userUrl(u.sec_uid) : null,
      bio: n.str(u.signature),
      stats: {
        followers: n.count(u.follower_count ?? u.mplatform_followers_count),
        following: n.count(u.following_count),
        items: n.count(u.aweme_count),
        likes: n.count(u.total_favorited),
      },
    },
    u,
  )
}

export function comment(c: any, itemId: string): Comment {
  const parent = c.reply_id && c.reply_id !== '0' ? n.id(c.reply_id) : null
  return n.comment(
    {
      id: n.id(c.cid),
      item_id: n.id(c.aweme_id ?? itemId),
      parent_id: parent,
      author: authorRef(c.user),
      text: String(c.text ?? ''),
      created_at: n.time(c.create_time),
      stats: { likes: n.count(c.digg_count), replies: n.count(c.reply_comment_total) },
    },
    c,
  )
}

/** 商品评价（get_product_comments 的 data.Comments，大写驼峰）。 */
export function productComment(c: any, productId: string): Comment {
  const u = c.User ?? c.user ?? {}
  return n.comment(
    {
      id: n.id(c.CommentId ?? c.comment_id ?? c.Id ?? c.id),
      item_id: productId,
      author: n.userRef({ id: u.Id ?? u.SecUid ?? u.Nickname ?? u.NickName, name: u.NickName ?? u.Nickname ?? u.nickname }),
      text: String(c.Content ?? c.content ?? ''),
      created_at: n.time(c.CommentTime ?? c.CreateTime ?? c.create_time),
      stats: { likes: n.count(c.LikeCount ?? c.like_count), replies: n.count(c.ReplyCount ?? c.reply_count) },
    },
    c,
  )
}

/** 搜索结果里的直播（live/search 的 data 项，房间信息在 lives.rawdata 的 JSON 串里）。 */
export function searchLive(item: any): Live | null {
  const lives = item?.lives ?? item
  let room: any = {}
  try {
    room = typeof lives?.rawdata === 'string' ? JSON.parse(lives.rawdata) : (lives?.rawdata ?? {})
  } catch {}
  const owner = room.owner ?? lives?.author ?? {}
  const webRid = owner.web_rid ?? room.web_rid ?? /"web_rid":"(\d+)"/.exec(JSON.stringify(lives ?? {}))?.[1]
  if (!webRid) return null
  return n.live(
    {
      id: String(webRid),
      url: liveUrl(webRid),
      title: n.str(room.title),
      status: room.status === 4 ? 'offline' : 'live',
      host: authorRef(owner),
      cover: first(room.cover),
      stats: { viewers: n.count(room.user_count ?? room.stats?.total_user) },
    },
    item,
  )
}

/** room/web/enter 的响应 → Live。 */
export function roomEnter(body: any, webRid: string): Live {
  const room = body?.data?.data?.[0] ?? {}
  const owner = room.owner ?? body?.data?.user ?? {}
  return n.live(
    {
      id: webRid,
      url: liveUrl(webRid),
      title: n.str(room.title),
      status: Number(room.status ?? body?.data?.room_status) === 2 ? 'live' : 'offline',
      host: authorRef(owner),
      cover: first(room.cover),
      stats: { viewers: n.count(room.user_count_str ?? room.stats?.user_count_str ?? room.room_view_stats?.display_value) },
    },
    body,
  )
}

/** 直播间商品（promotions 项）→ Item（kind goods）。url 带上 product_id / shop_id，供 comment list 直接使用。 */
export function promotion(p: any): Item {
  const promotionId = n.id(p.promotion_id)
  const url = productUrl(promotionId, p.product_id, p.shop_id)
  const cover = n.url(p.cover ?? p.cover_url ?? p.images?.[0]?.url_list?.[0])
  return n.item(
    {
      id: promotionId,
      kind: 'goods',
      url,
      title: n.str(p.title),
      cover,
      price: n.price(Number(p.min_price ?? p.price) / 100),
      status: p.status === 2 || p.in_stock === false ? 'off_shelf' : 'on_sale',
    },
    p,
  )
}

export function productUrl(promotionId: unknown, productId?: unknown, shopId?: unknown): string {
  const q = new URLSearchParams({ id: String(productId ?? promotionId) })
  q.set('promotion_id', String(promotionId))
  if (shopId != null && shopId !== '') q.set('shop_id', String(shopId))
  return `https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?${q}`
}

/** 商品详情（pack/detail 的响应）→ Item。 */
export function productDetail(body: any, promotionId: string): Item {
  const info = body?.detail_info ?? body?.data?.detail_info ?? {}
  const promo = body?.promotions?.[0] ?? body?.promotion ?? {}
  const imgs: string[] = [...(info.title_image ?? []), ...(info.detail_imgs ?? [])].map((x: any) => (typeof x === 'string' ? x : x?.url_list?.[0])).filter(Boolean)
  return n.item(
    {
      id: promotionId,
      kind: 'goods',
      url: productUrl(promotionId, promo.product_id, promo.shop_id),
      title: n.str(promo.title ?? info.title ?? body?.title),
      cover: n.url(imgs[0]),
      media: imgs.map((u, i) => n.media({ id: String(i + 1), type: 'image', url: n.url(u)! })),
      price: promo.min_price != null ? n.price(Number(promo.min_price) / 100) : null,
    },
    body,
  )
}

/** 通知（notice_list_v2 项）。 */
export function notice(v: any): Notice {
  const type = v.type
  const kind: Notice['type'] = type === 31 || type === 3 ? 'like' : type === 33 || type === 401 ? 'follow' : type === 45 || type === 601 ? 'mention' : type === 2 || type === 1 ? 'comment' : 'system'
  const u = v.from_user?.[0] ?? v.user ?? v.comment?.comment?.user ?? v.digg?.from_user?.[0] ?? v.follow?.from_user ?? null
  const aweme = v.comment?.aweme ?? v.digg?.aweme ?? v.aweme ?? null
  return n.notice(
    {
      id: n.id(v.nid_str ?? v.nid),
      type: kind,
      user: u ? authorRef(u) : null,
      target: aweme?.aweme_id ? { id: n.id(aweme.aweme_id), url: itemUrl(aweme.aweme_id) } : null,
      text: n.str(v.comment?.comment?.text ?? v.content ?? v.text),
      created_at: n.time(v.create_time),
    },
    v,
  )
}

/** 直播弹幕长连的消息 → Event；不关心的消息返回 null（上游 dy_live/server.py 的 on_message）。 */
export function liveEvent(method: string, msg: any): Event | null {
  const u = msg?.user
  const secUid = u?.sec_uid
  const who = u ? n.userRef({ id: secUid || u.id_str || n.idOrNull(u.id), name: u.nickname, url: secUid ? userUrl(secUid) : null }) : null
  switch (method) {
    case 'WebcastChatMessage':
      return n.event({ type: 'chat', user: who, text: String(msg.content ?? '') }, msg)
    case 'WebcastGiftMessage':
      return n.event({ type: 'gift', user: who, gift: { name: String(msg.gift?.name ?? ''), count: Number(msg.comboCount ?? 1) } }, msg)
    case 'WebcastMemberMessage':
      return n.event({ type: 'enter', user: who }, msg)
    case 'WebcastLikeMessage':
      return n.event({ type: 'like', user: who, text: msg.count != null ? String(msg.count) : null }, msg)
    case 'WebcastSocialMessage':
      return Number(msg.action) === 1 ? n.event({ type: 'follow', user: who }, msg) : null
    case 'WebcastRoomStatsMessage':
      return n.event({ type: 'other', text: n.str(msg.displayLong) }, msg)
    default:
      return null
  }
}
