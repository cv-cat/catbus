import * as n from '../../../core/normalize.js'
import type { Comment, Event, Item, ItemStatus, Live, User, UserRef } from '../../../core/schemas.js'

/** B 站原始对象 → 归一化类型（AGENTS 6.2）。 */

export const videoUrl = (bvid: string) => `https://www.bilibili.com/video/${bvid}`
export const spaceUrl = (mid: unknown) => `https://space.bilibili.com/${mid}`
export const liveUrl = (room: unknown) => `https://live.bilibili.com/${room}`

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' }

/** 搜索结果里的高亮标签与 HTML 实体。 */
export function plain(html: unknown): string | null {
  if (html == null) return null
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (_, e: string) => ENTITIES[e]!)
}

export function ref(mid: unknown, name: unknown): UserRef | null {
  return n.userRef({ id: mid, name, url: mid == null || mid === '' ? null : spaceUrl(mid) })
}

/** "4:30" / "1:02:03" / 秒数 → 秒。 */
export function duration(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v !== 'string' || !v) return null
  if (/^\d+$/.test(v)) return Number(v)
  return v.split(':').reduce((s, p) => s * 60 + Number(p), 0)
}

/** 稿件详情（x/web-interface/wbi/view 的 data）。 */
export function video(v: any): Item {
  return n.item(
    {
      id: v.bvid,
      kind: 'video',
      url: videoUrl(v.bvid),
      title: n.str(v.title),
      text: n.str(v.desc),
      author: ref(v.owner?.mid, v.owner?.name),
      created_at: n.time(v.pubdate),
      cover: n.url(v.pic),
      stats: {
        views: n.count(v.stat?.view),
        likes: n.count(v.stat?.like),
        comments: n.count(v.stat?.reply),
        collects: n.count(v.stat?.favorite),
        shares: n.count(v.stat?.share),
      },
    },
    v,
  )
}

/** 搜索结果里的视频卡片。 */
export function searchVideo(v: any): Item {
  return n.item(
    {
      id: v.bvid,
      kind: 'video',
      url: videoUrl(v.bvid),
      title: plain(v.title),
      text: n.str(v.description),
      author: ref(v.mid, v.author),
      created_at: n.time(v.pubdate),
      cover: n.url(v.pic),
      stats: { views: n.count(v.play), likes: n.count(v.like), comments: n.count(v.review), collects: n.count(v.favorites) },
    },
    v,
  )
}

/** 空间投稿列表（arc/search 的 vlist 项）。 */
export function spaceVideo(v: any): Item {
  return n.item(
    {
      id: v.bvid,
      kind: 'video',
      url: videoUrl(v.bvid),
      title: n.str(v.title),
      text: n.str(v.description),
      author: ref(v.mid, v.author),
      created_at: n.time(v.created),
      cover: n.url(v.pic),
      stats: { views: n.count(v.play), comments: n.count(v.comment) },
    },
    v,
  )
}

/** 首页推荐流的卡片。 */
export function feedVideo(v: any): Item {
  return n.item(
    {
      id: v.bvid,
      kind: 'video',
      url: videoUrl(v.bvid),
      title: n.str(v.title),
      author: ref(v.owner?.mid, v.owner?.name),
      created_at: n.time(v.pubdate),
      cover: n.url(v.pic),
      stats: { views: n.count(v.stat?.view), likes: n.count(v.stat?.like) },
    },
    v,
  )
}

/** 收藏夹内容（fav/resource/list 的 medias 项）。 */
export function favVideo(v: any): Item {
  return n.item(
    {
      id: v.bvid ?? n.id(v.id),
      kind: 'video',
      url: v.bvid ? videoUrl(v.bvid) : null,
      title: n.str(v.title),
      text: n.str(v.intro),
      author: ref(v.upper?.mid, v.upper?.name),
      created_at: n.time(v.pubtime),
      cover: n.url(v.cover),
      stats: { views: n.count(v.cnt_info?.play), collects: n.count(v.cnt_info?.collect) },
    },
    v,
  )
}

/** 稿件审核状态（创作中心 state）。 */
function archiveStatus(state: unknown): ItemStatus | null {
  const s = Number(state)
  if (s >= 0) return 'published'
  if ([-2, -4, -16, -100].includes(s)) return 'rejected'
  if ([-1, -6, -30, -40].includes(s)) return 'reviewing'
  return null
}

/** 我的稿件（x/web/archives 的 arc_audits 项）。 */
export function archive(v: any): Item {
  const a = v.Archive ?? {}
  return n.item(
    {
      id: a.bvid,
      kind: 'video',
      url: videoUrl(a.bvid),
      title: n.str(a.title),
      text: n.str(a.desc),
      author: ref(a.mid, a.author),
      created_at: n.time(a.ptime || a.ctime),
      cover: n.url(a.cover),
      stats: {
        views: n.count(v.stat?.view),
        likes: n.count(v.stat?.like),
        comments: n.count(v.stat?.reply),
        collects: n.count(v.stat?.favorite),
        shares: n.count(v.stat?.share),
      },
      status: archiveStatus(a.state),
    },
    v,
  )
}

export function spaceUser(v: any): User {
  return n.user(
    { id: n.id(v.mid), name: n.str(v.name), avatar: n.url(v.face), url: spaceUrl(v.mid), bio: n.str(v.sign) },
    v,
  )
}

export function searchUser(v: any): User {
  return n.user(
    {
      id: n.id(v.mid),
      name: n.str(v.uname),
      avatar: n.url(v.upic),
      url: spaceUrl(v.mid),
      bio: n.str(v.usign),
      stats: { followers: n.count(v.fans), following: null, items: n.count(v.videos), likes: null },
    },
    v,
  )
}

export function navUser(v: any): User {
  return n.user({ id: n.id(v.mid), name: n.str(v.uname), avatar: n.url(v.face), url: spaceUrl(v.mid) }, v)
}

export function reply(v: any, itemId: string): Comment {
  return n.comment(
    {
      id: n.id(v.rpid),
      item_id: itemId,
      parent_id: v.parent ? n.id(v.parent) : null,
      author: ref(v.member?.mid, v.member?.uname),
      text: String(v.content?.message ?? ''),
      created_at: n.time(v.ctime),
      stats: { likes: n.count(v.like), replies: n.count(v.rcount) },
    },
    v,
  )
}

export function searchLive(v: any): Live {
  return n.live(
    {
      id: n.id(v.roomid),
      url: liveUrl(v.roomid),
      title: plain(v.title),
      status: v.live_status === 1 ? 'live' : 'offline',
      host: ref(v.uid, v.uname),
      cover: n.url(v.user_cover || v.cover),
      stats: { viewers: n.count(v.online) },
    },
    v,
  )
}

/** 直播弹幕长连的业务消息 → Event；不关心的消息返回 null。 */
export function liveEvent(msg: any): Event | null {
  const cmd = String(msg?.cmd ?? '').split(':')[0]
  const d = msg.data ?? {}
  switch (cmd) {
    case 'DANMU_MSG': {
      const info = msg.info ?? []
      return n.event({ type: 'chat', time: n.time(info[0]?.[4]) ?? undefined, user: ref(info[2]?.[0], info[2]?.[1]), text: String(info[1] ?? '') }, msg)
    }
    case 'SUPER_CHAT_MESSAGE':
      return n.event({ type: 'chat', time: n.time(d.start_time) ?? undefined, user: ref(d.uid, d.user_info?.uname), text: n.str(d.message) }, msg)
    case 'SEND_GIFT':
      return n.event(
        { type: 'gift', time: n.time(d.timestamp) ?? undefined, user: ref(d.uid, d.uname), gift: { name: String(d.giftName ?? ''), count: Number(d.num ?? 1) } },
        msg,
      )
    case 'INTERACT_WORD':
      return n.event({ type: d.msg_type === 2 ? 'follow' : 'enter', time: n.time(d.timestamp) ?? undefined, user: ref(d.uid, d.uname) }, msg)
    case 'LIKE_INFO_V3_CLICK':
      return n.event({ type: 'like', user: ref(d.uid, d.uname) }, msg)
    default:
      return null
  }
}

/** gethistory 的弹幕，timeline 是北京时间。 */
export function historyEvent(v: any): Event {
  const t = typeof v.timeline === 'string' ? n.time(v.timeline.replace(' ', 'T') + '+08:00') : null
  return n.event({ type: 'chat', time: t ?? undefined, user: ref(v.uid, v.nickname), text: n.str(v.text) }, v)
}
