import * as n from '../../../core/normalize.js'
import type { Comment, Event, Item, ItemStatus, Live, User, UserRef } from '../../../core/schemas.js'

/** B 站原始对象 → 归一化类型（AGENTS 6.2）。 */

export const videoUrl = (bvid: string) => `https://www.bilibili.com/video/${bvid}`
export const spaceUrl = (mid: unknown) => `https://space.bilibili.com/${mid}`
export const liveUrl = (room: unknown) => `https://live.bilibili.com/${room}`
export const articleUrl = (cvid: unknown) => `https://www.bilibili.com/read/cv${cvid}`

export function ref(mid: unknown, name: unknown): UserRef | null {
  return n.userRef({ id: mid, name, url: mid == null || mid === '' ? null : spaceUrl(mid) })
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
      title: n.plainText(v.title),
      text: n.str(v.description),
      author: ref(v.mid, v.author),
      created_at: n.time(v.pubdate),
      cover: n.url(v.pic),
      stats: { views: n.count(v.play), likes: n.count(v.like), comments: n.count(v.review), collects: n.count(v.favorites) },
    },
    v,
  )
}

/** 专栏搜索结果（search_type=article）。id 用 `cv<id>`，可以直接传给 comment list。 */
export function searchArticle(v: any): Item {
  return n.item(
    {
      id: `cv${v.id}`,
      kind: 'article',
      url: articleUrl(v.id),
      title: n.plainText(v.title),
      text: n.plainText(v.desc),
      author: ref(v.mid, null),
      created_at: n.time(v.pub_time),
      cover: n.url(v.image_urls?.[0]),
      stats: { views: n.count(v.view), likes: n.count(v.like), comments: n.count(v.reply) },
    },
    v,
  )
}

/** 专栏草稿（article/creative/draft/view 的 data）。 */
export function articleDraft(v: any, id: string, mid: string): Item {
  return n.item(
    {
      id: n.id(v.id ?? v.aid ?? id),
      kind: 'article',
      title: n.str(v.title),
      text: n.str(v.content),
      author: ref(v.author?.mid ?? mid, v.author?.name),
      created_at: n.time(v.ctime ?? v.mtime),
      cover: n.url(v.banner_url || v.image_urls?.[0]),
      status: 'draft',
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
      title: n.plainText(v.title),
      status: v.live_status === 1 ? 'live' : 'offline',
      host: ref(v.uid, v.uname),
      cover: n.url(v.user_cover || v.cover),
      stats: { viewers: n.count(v.online) },
    },
    v,
  )
}

/** 没有专门映射的 cmd：能读出内容的给内容，其余给 cmd 名（上游 live/server.py 的 on('*') 兜底）。 */
function otherText(cmd: string, d: any): string {
  switch (cmd) {
    case 'WATCHED_CHANGE':
      return n.str(d.text_large) ?? cmd
    case 'ROOM_CHANGE':
      return d.title ? `直播间标题：${d.title}` : cmd
    case 'LIVE':
      return '开播'
    case 'PREPARING':
      return '下播'
    default:
      return cmd || 'UNKNOWN'
  }
}

/** 弹幕长连的心跳回复（op 3）：人气值（上游 live/server.py 的 popularity）。 */
export function popularityEvent(value: number): Event {
  return n.event({ type: 'other', text: `人气值 ${value}` }, { op: 3, popularity: value })
}

/** INTERACT_WORD 的 msg_type：1 进场，2 关注、4 特别关注、5 互相关注；3 分享没有对应的 Event 类型，和其余取值一样记为 other。 */
const INTERACT_TYPE: Record<number, Event['type']> = { 1: 'enter', 2: 'follow', 4: 'follow', 5: 'follow' }

/** 直播弹幕长连的业务消息 → Event：弹幕、礼物、进场、关注、点赞，其余 cmd 为 other。 */
export function liveEvent(msg: any): Event {
  const cmd = String(msg?.cmd ?? '').split(':')[0]!
  const d = msg?.data ?? {}
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
    case 'INTERACT_WORD': {
      const type = INTERACT_TYPE[Number(d.msg_type)] ?? 'other'
      const text = type !== 'other' ? undefined : Number(d.msg_type) === 3 ? '分享直播间' : cmd
      return n.event({ type, time: n.time(d.timestamp) ?? undefined, user: ref(d.uid, d.uname), text }, msg)
    }
    case 'LIKE_INFO_V3_CLICK':
      return n.event({ type: 'like', user: ref(d.uid, d.uname) }, msg)
    case 'GUARD_BUY':
      return n.event(
        { type: 'gift', time: n.time(d.start_time) ?? undefined, user: ref(d.uid, d.username), gift: { name: String(d.gift_name ?? ''), count: Number(d.num ?? 1) } },
        msg,
      )
    default:
      return n.event({ type: 'other', time: n.time(d.timestamp) ?? undefined, user: d.uid ? ref(d.uid, d.uname) : null, text: otherText(cmd, d) }, msg)
  }
}

/** gethistory 的弹幕，timeline 是北京时间。 */
export function historyEvent(v: any): Event {
  const t = typeof v.timeline === 'string' ? n.time(v.timeline.replace(' ', 'T') + '+08:00') : null
  return n.event({ type: 'chat', time: t ?? undefined, user: ref(v.uid, v.nickname), text: n.str(v.text) }, v)
}
