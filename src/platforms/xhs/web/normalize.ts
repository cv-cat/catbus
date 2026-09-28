import * as n from '../../../core/normalize.js'
import type { Comment, Item, ItemKind, Media, User, UserRef } from '../../../core/schemas.js'
import { noWaterImage } from './api.js'

/**
 * 小红书原始对象 → 归一化类型（AGENTS 6.2）。字段来源以上游 xhs_utils/data_util.py 的 handle_* 为准，
 * 并兼容列表接口里的卡片形态（note_card / user 等）。
 *
 * 小红书的 url 必须带 xsec_token（AGENTS 4.8）：拿不到 token 的对象，url 为不带 token 的地址，
 * 取详情前需要从带 token 的列表或分享链接进入。
 */

const WEB = 'https://www.xiaohongshu.com'

export function noteUrl(id: string, token?: unknown, source = 'pc_feed'): string {
  return token ? `${WEB}/explore/${id}?xsec_token=${encodeURIComponent(String(token))}&xsec_source=${source}` : `${WEB}/explore/${id}`
}

export function userUrl(id: unknown, token?: unknown, source = 'pc_note'): string | null {
  if (id == null || id === '') return null
  return token ? `${WEB}/user/profile/${id}?xsec_token=${encodeURIComponent(String(token))}&xsec_source=${source}` : `${WEB}/user/profile/${id}`
}

export function ref(u: any): UserRef | null {
  if (!u) return null
  const id = u.user_id ?? u.userId ?? u.id
  return n.userRef({ id, name: u.nickname ?? u.nick_name ?? u.name ?? u.userName, url: userUrl(id, u.xsec_token) })
}

const kindOf = (type: unknown): ItemKind => (type === 'video' ? 'video' : 'image')

/** 图片的地址：info_list 里取默认档（上游取 info_list[1]），否则 url_default / url。 */
function imageUrl(img: any): string | null {
  const list = img?.info_list ?? []
  return n.url(list.find((x: any) => x.image_scene === 'WB_DFT')?.url ?? list[1]?.url ?? list[0]?.url ?? img?.url_default ?? img?.url)
}

/** 编码的优先顺序：新版 Web 把编码名混淆成 EF4（h264）/ EF5（h265）等，优先兼容性最好的 h264，其余编码排在后面。 */
const CODECS = ['h264', 'EF4', 'h265', 'EF5']

const streamUrl = (s: any): string | undefined => s?.master_url || s?.url || s?.backup_urls?.[0] || undefined

/** 上游 handle_note_info 的视频地址：按编码优先顺序取第一个有地址的流，否则 origin_video_key 拼 sns-video-bd。 */
function videoMedia(v: any): Media | null {
  const stream = v?.media?.stream ?? {}
  const codecs = [...CODECS, ...Object.keys(stream).filter((k) => !CODECS.includes(k))]
  const s = codecs.flatMap((c) => (Array.isArray(stream[c]) ? stream[c] : [])).find(streamUrl)
  const url = streamUrl(s) ?? (v?.consumer?.origin_video_key ? `https://sns-video-bd.xhscdn.com/${v.consumer.origin_video_key}` : null)
  if (!url) return null
  return n.media({ id: n.idOrNull(v?.media?.video_id), type: 'video', url: n.url(url)!, width: s?.width ?? null, height: s?.height ?? null, duration: n.seconds(v?.capa?.duration ?? (s?.duration ? s.duration / 1000 : null)) }, v)
}

/** 笔记详情（feed 接口的 items[i]：{id, xsec_token?, note_card}）。 */
export function note(v: any, token?: string): Item {
  const c = v.note_card ?? v
  const id = String(v.id ?? c.note_id)
  const kind = kindOf(c.type)
  const images = (c.image_list ?? []).map((img: any) => imageUrl(img)).filter(Boolean) as string[]
  const media: Media[] = []
  if (kind === 'video') {
    const vm = videoMedia(c.video)
    if (vm) media.push(vm)
  } else for (const [i, img] of (c.image_list ?? []).entries()) {
    const url = imageUrl(img)
    if (url) media.push(n.media({ id: String(i), type: 'image', url, width: img.width ?? null, height: img.height ?? null }, img))
  }
  const i = c.interact_info ?? {}
  return n.item(
    {
      id,
      kind,
      url: noteUrl(id, v.xsec_token ?? token),
      title: n.str(c.title) ?? n.str(c.display_title),
      text: n.str(c.desc),
      author: ref(c.user),
      created_at: n.time(c.time),
      cover: n.url(c.cover?.url_default ?? c.cover?.url) ?? images[0] ?? null,
      media,
      stats: { likes: n.count(i.liked_count), comments: n.count(i.comment_count), collects: n.count(i.collected_count), shares: n.count(i.share_count) },
    },
    v,
  )
}

/** 列表卡片：用户笔记 / 点赞 / 收藏（{note_id, xsec_token, display_title, cover, user, interact_info, type}）与搜索、推荐流（{id, xsec_token, note_card}）。 */
export function card(v: any): Item {
  const c = v.note_card ?? v
  const id = String(v.id || v.note_id || c.note_id || '')
  const i = c.interact_info ?? {}
  return n.item(
    {
      id,
      kind: kindOf(c.type),
      url: id ? noteUrl(id, v.xsec_token ?? c.xsec_token) : null,
      title: n.str(c.display_title) ?? n.str(c.title),
      author: ref(c.user),
      created_at: n.time(c.time),
      cover: n.url(c.cover?.url_default ?? c.cover?.url ?? c.cover?.info_list?.[0]?.url),
      stats: { likes: n.count(i.liked_count), comments: n.count(i.comment_count), collects: n.count(i.collected_count), shares: n.count(i.shared_count ?? i.share_count) },
    },
    v,
  )
}

/** 媒体地址（item media / download）：图片换成无水印 JPEG，视频用原始流。 */
export function mediaOf(item: Item): Media[] {
  return item.media.map((m) => (m.type === 'image' ? { ...m, url: noWaterImage(m.url) } : m))
}

/** 用户资料（user/otherinfo：{basic_info, interactions, tags}）。 */
export function profile(v: any, id: string, token?: string): User {
  const b = v.basic_info ?? {}
  const count = (type: string) => n.count((v.interactions ?? []).find((x: any) => x.type === type)?.count)
  return n.user(
    {
      id,
      name: n.str(b.nickname),
      handle: n.str(b.red_id),
      avatar: n.url(b.imageb ?? b.images),
      url: userUrl(id, token),
      bio: n.str(b.desc),
      stats: { following: count('follows'), followers: count('fans'), likes: count('interaction') },
    },
    v,
  )
}

/** user/me。 */
export function me(v: any): User {
  return n.user({ id: String(v.user_id), name: n.str(v.nickname), handle: n.str(v.red_id), avatar: n.url(v.images ?? v.imageb), url: userUrl(v.user_id), bio: n.str(v.desc) }, v)
}

/** 搜索用户的结果项。 */
export function searchUser(v: any): User {
  const id = String(v.id ?? v.user_id)
  return n.user(
    {
      id,
      name: n.str(v.name ?? v.nickname),
      handle: n.str(v.red_id),
      avatar: n.url(v.image ?? v.avatar),
      url: userUrl(id, v.xsec_token, 'pc_search'),
      bio: n.str(v.desc),
      stats: { followers: n.count(v.fans), items: n.count(v.note_count) },
    },
    v,
  )
}

/** 私信页的关注列表（users/following/all 的 follow_user_d_t_o_list[i]：{user_id, nick_name, ...}）。 */
export function followingUser(v: any): User {
  const id = String(v.user_id ?? v.userId ?? v.id)
  return n.user(
    {
      id,
      name: n.str(v.nick_name ?? v.nickname ?? v.name),
      handle: n.str(v.red_id),
      avatar: n.url(v.avatar ?? v.image ?? v.images),
      url: userUrl(id),
      bio: n.str(v.desc),
    },
    v,
  )
}

/** 评论（comment/page 的 comments[i] 与 sub_comments）。 */
export function comment(v: any, itemId: string, parent: string | null = null): Comment {
  return n.comment(
    {
      id: String(v.id),
      item_id: itemId,
      parent_id: parent ?? n.idOrNull(v.target_comment?.id) ?? null,
      author: ref(v.user_info),
      text: String(v.content ?? ''),
      created_at: n.time(v.create_time),
      stats: { likes: n.count(v.like_count), replies: n.count(v.sub_comment_count) },
    },
    v,
  )
}

/** 创作者中心「笔记管理」的笔记（审核状态：0 已发布；1/2 审核中；3 未通过；私密看 permission）。 */
export function postedNote(v: any): Item {
  const id = String(v.id ?? v.note_id)
  const audit = Number(v.audit_status ?? v.status ?? 0)
  const status = v.permission_code === 1 || v.permission_msg === '仅自己可见' ? 'private' : audit === 3 || audit === 4 ? 'rejected' : audit === 1 || audit === 2 ? 'reviewing' : 'published'
  return n.item(
    {
      id,
      kind: v.type === 'video' ? 'video' : 'image',
      url: noteUrl(id, v.xsec_token),
      title: n.str(v.display_title ?? v.title),
      created_at: n.time(v.time ?? v.post_time),
      cover: n.url(v.images_list?.[0]?.url ?? v.cover?.url),
      stats: { views: n.count(v.view_count), likes: n.count(v.likes), comments: n.count(v.comments_count), collects: n.count(v.collected_count), shares: n.count(v.shared_count) },
      status,
    },
    v,
  )
}

export const categoryId = (v: string) => v
