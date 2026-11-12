import * as n from '../../../core/normalize.js'
import type { Comment, Item, ItemKind, ItemStatus, Media, User, UserRef } from '../../../core/schemas.js'
import { midToBid } from './sign.js'

/**
 * 微博原始对象 → 归一化类型（AGENTS 6.2）。
 * weibo.com（ajax）与 m.weibo.cn 的微博对象字段大体相同，差别在图片（pic_infos / pics）、视频（page_info）和正文（text_raw / HTML）。
 */

export const userUrl = (uid: unknown) => `https://weibo.com/u/${uid}`

/** 微博的规范链接：weibo.com/<uid>/<mblogid>；不知道作者时用 m.weibo.cn/detail/<mid>。 */
export function itemUrl(mid: string, uid?: unknown, bid?: unknown): string {
  if (uid == null || uid === '') return `https://m.weibo.cn/detail/${mid}`
  return `https://weibo.com/${uid}/${bid || midToBid(mid)}`
}

export function ref(u: any): UserRef | null {
  const id = u?.idstr ?? u?.id
  // 头像：profile_image_url 是小图（列表里够用），没有时 avatar_large / avatar_hd
  return n.userRef({ id, name: u?.screen_name, url: id == null || id === '' ? null : userUrl(id), avatar: u?.profile_image_url || u?.avatar_large || u?.avatar_hd })
}

/** "21万次播放" / "1,234" → 整数。 */
function plays(v: unknown): number | null {
  if (typeof v === 'number') return n.count(v)
  const m = /^\s*([\d.,]+\s*[万亿wW]?)/.exec(String(v ?? ''))
  return m ? n.count(m[1]!.replace(/\s/g, '')) : null
}

function isVideo(m: any): boolean {
  return m?.page_info?.type === 'video' || m?.page_info?.object_type === 'video'
}

/** 图片：weibo.com 是 pic_infos（按 pic_ids 的顺序），m.weibo.cn 是 pics。 */
function images(m: any): Media[] {
  if (m?.pic_infos && typeof m.pic_infos === 'object') {
    const ids: string[] = Array.isArray(m.pic_ids) && m.pic_ids.length ? m.pic_ids : Object.keys(m.pic_infos)
    return ids
      .map((pid) => m.pic_infos[pid])
      .filter(Boolean)
      .map((p: any) => {
        const best = p.largest ?? p.mw2000 ?? p.original ?? p.large ?? p.bmiddle
        return n.media({ id: n.idOrNull(p.pic_id), type: 'image', url: n.url(best?.url)!, width: n.count(best?.width), height: n.count(best?.height) }, p)
      })
      .filter((x: Media) => x.url)
  }
  if (Array.isArray(m?.pics)) {
    return m.pics
      .map((p: any) => {
        const large = p.large ?? p
        return n.media({ id: n.idOrNull(p.pid), type: 'image', url: n.url(large.url)!, width: n.count(large.geo?.width), height: n.count(large.geo?.height) }, p)
      })
      .filter((x: Media) => x.url)
  }
  return []
}

/** 视频：weibo.com 的 media_info.playback_list 按清晰度从高到低；m.weibo.cn 是 urls。 */
function video(m: any): Media | null {
  const p = m.page_info ?? {}
  const info = p.media_info ?? {}
  const best = info.playback_list?.[0]?.play_info
  const url =
    best?.url ??
    p.urls?.mp4_720p_mp4 ??
    p.urls?.mp4_hd_mp4 ??
    p.urls?.mp4_ld_mp4 ??
    info.mp4_720p_mp4 ??
    info.mp4_hd_url ??
    info.stream_url_hd ??
    info.stream_url
  if (!url) return null
  return n.media(
    {
      id: n.idOrNull(info.media_id ?? p.object_id),
      type: 'video',
      url: n.url(url)!,
      width: n.count(best?.width),
      height: n.count(best?.height),
      duration: n.seconds(best?.duration ?? info.duration),
    },
    info,
  )
}

/** 媒体从哪条微博取：自己没有 page_info、也没有图片的转发微博取原微博（retweeted_status），其余取自己。 */
function mediaSource(m: any): any {
  const rt = m?.retweeted_status
  if (!rt || typeof rt !== 'object') return m
  if (m.page_info || images(m).length || Number(m.pic_num) > 0) return m
  return rt
}

const VISIBLE: Record<number, ItemStatus> = { 0: 'published', 1: 'private', 6: 'published', 10: 'published' }

/**
 * 一条微博。own 为 true 时（自己的微博）按 visible.type 给出 status：仅自己可见为 private，其余为 published。
 */
export function mblog(m: any, own = false): Item {
  const id = n.id(m.idstr ?? m.mid ?? m.id)
  const author = ref(m.user)
  // 转发微博自己没有媒体时，媒体、封面、类型取原微博（AGENTS 4.8）；正文、作者、计数仍是转发这条的
  const src = mediaSource(m)
  const vid = isVideo(src) ? video(src) : null
  const pics = images(src)
  const media = vid ? [vid] : pics
  const kind: ItemKind = vid ? 'video' : src.page_info?.object_type === 'article' || src.page_info?.type === 'article' ? 'article' : pics.length || Number(src.pic_num) > 0 ? 'image' : 'text'
  const cover = vid ? n.url(src.page_info?.page_pic?.url ?? src.page_info?.page_pic) : (pics[0]?.url ?? null)
  return n.item(
    {
      id,
      kind,
      url: itemUrl(id, author?.id, m.mblogid ?? m.bid),
      title: kind === 'article' ? n.str(src.page_info?.page_title ?? src.page_info?.content1) : null,
      text: n.str(m.text_raw) ?? n.plainText(m.text),
      author,
      created_at: n.time(m.created_at),
      cover,
      media,
      stats: {
        views: vid ? plays(src.page_info?.play_count ?? src.page_info?.media_info?.online_users_number) : null,
        likes: n.count(m.attitudes_count),
        comments: n.count(m.comments_count),
        shares: n.count(m.reposts_count),
      },
      status: own ? (VISIBLE[Number(m.visible?.type ?? 0)] ?? 'published') : null,
    },
    m,
  )
}

/** weibo.com/ajax/profile/info 的 data.user。 */
export function user(u: any): User {
  const id = n.id(u.idstr ?? u.id)
  return n.user(
    {
      id,
      name: n.str(u.screen_name),
      handle: n.str(u.domain) ?? n.str(u.weihao),
      avatar: n.url(u.avatar_hd ?? u.avatar_large ?? u.profile_image_url),
      url: userUrl(id),
      bio: n.str(u.description),
      stats: {
        followers: n.count(u.followers_count),
        following: n.count(u.friends_count ?? u.follow_count),
        items: n.count(u.statuses_count),
        likes: n.count(u.status_total_counter?.like_cnt),
      },
    },
    u,
  )
}

/**
 * 评论附带的图片：weibo.com 的图片评论把图片放在 `url_struct[i].pic_infos`（正文里只有「查看图片」短链），
 * 也可能直接在评论上的 `pic_infos`；m.weibo.cn 的评论是单张的 `pic`。按地址去重。
 */
function commentImages(c: any): Media[] {
  const all = [...images(c), ...(Array.isArray(c?.url_struct) ? c.url_struct : []).flatMap((u: any) => images(u)), ...(c?.pic ? images({ pics: [c.pic] }) : [])]
  const seen = new Set<string>()
  return all.filter((m) => !seen.has(m.url!) && !!seen.add(m.url!))
}

/** buildComments 的一条评论。 */
export function comment(c: any, itemId: string): Comment {
  const id = n.id(c.idstr ?? c.id)
  const root = n.idOrNull(c.rootidstr ?? c.rootid)
  return n.comment(
    {
      id,
      item_id: itemId,
      parent_id: root && root !== id ? root : null,
      author: ref(c.user),
      text: n.str(c.text_raw) ?? n.plainText(c.text) ?? '',
      media: commentImages(c),
      created_at: n.time(c.created_at),
      stats: { likes: n.count(c.like_counts), replies: n.count(c.total_number) },
    },
    c,
  )
}
