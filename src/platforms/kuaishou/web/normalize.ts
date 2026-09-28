import * as n from '../../../core/normalize.js'
import type { Comment, Item, ItemStatus, Live, Media, User, UserRef } from '../../../core/schemas.js'

/** 快手原始对象 → 归一化类型（AGENTS 6.2）。字段来源参考上游 utils/data_util.py 的 handle_work_info。 */

export const photoUrl = (id: unknown) => `https://www.kuaishou.com/short-video/${id}`
export const profileUrl = (eid: unknown) => `https://www.kuaishou.com/profile/${eid}`
export const liveUrl = (eid: unknown) => `https://live.kuaishou.com/u/${eid}`

const first = (o: any, ...keys: string[]): any => {
  for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]
  return undefined
}

export function ref(id: unknown, name: unknown): UserRef | null {
  return n.userRef({ id, name, url: id == null || id === '' ? null : profileUrl(id) })
}

/** "74万" / "1.2w" / 数字 → 整数。 */
export const count = (v: unknown) => n.count(v)

/** 取 URL：字符串，或 [{url}] / [{cdn,url}] 列表的第一个。 */
function urlOf(v: unknown): string | null {
  if (typeof v === 'string') return n.url(v)
  if (Array.isArray(v) && v.length) return urlOf(typeof v[0] === 'object' ? v[0]?.url : v[0])
  return null
}

/** 图集：photo.atlas 或 photo.ext_params.atlas，`{cdn, list: [path]}`。 */
function atlasImages(photo: any): string[] {
  const atlas = photo?.atlas ?? photo?.ext_params?.atlas
  if (!atlas || typeof atlas !== 'object') return []
  let cdn = atlas.cdn ?? ''
  if (Array.isArray(cdn)) cdn = cdn[0] ?? ''
  return (atlas.list ?? []).map((p: string) => (cdn ? `https://${cdn}${p}` : p))
}

/** manifest.adaptationSet[].representation[]：挑分辨率最高的一路。 */
export function bestRepresentation(manifest: any): any {
  const reps: any[] = []
  for (const set of manifest?.adaptationSet ?? []) for (const r of set?.representation ?? []) if (r?.url) reps.push({ ...r, duration: set.duration })
  reps.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0) || (b.maxBitrate ?? b.avgBitrate ?? 0) - (a.maxBitrate ?? a.avgBitrate ?? 0))
  return reps[0]
}

/** 作品的媒体：图集为图片，否则取 manifest 最高画质，退回 photoUrl。 */
export function photoMedia(photo: any): Media[] {
  const images = atlasImages(photo)
  if (images.length) return images.map((url, i) => n.media({ id: String(i + 1), type: 'image', url }))
  const manifest = typeof photo?.manifest === 'object' && photo.manifest ? photo.manifest : null
  const best = bestRepresentation(manifest)
  const duration = n.seconds(photo?.duration != null ? Number(photo.duration) / 1000 : null)
  if (best) return [n.media({ id: n.idOrNull(best.id), type: 'video', url: n.url(best.url)!, width: best.width ?? null, height: best.height ?? null, duration }, best)]
  const url = urlOf(first(photo, 'photoUrl', 'photoUrls', 'mainMvUrls'))
  return url ? [n.media({ type: 'video', url, width: photo?.width ?? null, height: photo?.height ?? null, duration })] : []
}

/** 一条 feed（`{photo, author, ...}`）或单独的 photo。 */
export function feed(v: any, authorFallback?: any): Item {
  const photo = v?.photo ?? v
  const author = v?.author ?? authorFallback ?? {}
  const id = n.id(first(photo, 'id', 'photoId', 'photo_id'))
  const images = atlasImages(photo)
  const comments = first(photo, 'commentCount', 'comment_count') ?? first(v?.comment, 'us_c', 'commentCount')
  return n.item(
    {
      id,
      kind: images.length ? 'image' : 'video',
      url: photoUrl(id),
      text: n.str(first(photo, 'caption', 'originCaption')),
      author: ref(first(author, 'id', 'authorId', 'user_id', 'eid'), first(author, 'name', 'user_name', 'nickname')),
      created_at: n.time(first(photo, 'timestamp', 'create_time')),
      cover: urlOf(first(photo, 'coverUrl', 'coverUrls')),
      media: photoMedia(photo),
      stats: {
        views: count(first(photo, 'viewCount', 'view_count')),
        likes: count(first(photo, 'realLikeCount', 'likeCount', 'like_count')),
        comments: count(comments),
        collects: count(first(photo, 'collectCount', 'collect_count')),
        shares: count(first(photo, 'shareCount', 'share_count')),
      },
    },
    v,
  )
}

/** visionVideoDetail。 */
export function detail(d: any): Item {
  return feed({ ...d, photo: d.photo, author: d.author })
}

/** 当前用户资料（/rest/v/profile/get）。 */
export function selfUser(v: any): User {
  const id = n.id(first(v, 'eid', 'userDefineId', 'userId', 'user_id'))
  return n.user(
    {
      id,
      name: n.str(first(v, 'userName', 'user_name', 'name')),
      handle: n.str(first(v, 'kwaiId', 'userId')),
      avatar: n.url(first(v, 'userHead', 'headurl', 'avatar')),
      url: profileUrl(id),
      bio: n.str(first(v, 'userText', 'user_text', 'description')),
      stats: {
        followers: count(first(v, 'fans', 'fan', 'followerCount')),
        following: count(first(v, 'follows', 'follow', 'followingCount')),
        items: count(first(v, 'photo', 'photoCount', 'photo_public')),
        likes: count(first(v, 'liked', 'likedCount')),
      },
    },
    v,
  )
}

/** visionProfileReduced。 */
export function reducedUser(v: any): User {
  const p = v?.userProfile?.profile ?? {}
  const id = n.id(p.user_id)
  return n.user({ id, name: n.str(p.user_name), avatar: n.url(p.headurl), url: profileUrl(id), bio: n.str(p.user_text) }, v)
}

/** 搜索 / 关注 / 粉丝列表里的用户。 */
export function listUser(v: any): User {
  const id = n.id(first(v, 'user_id', 'eid', 'id', 'userId'))
  return n.user(
    {
      id,
      name: n.str(first(v, 'user_name', 'name', 'userName')),
      handle: n.str(first(v, 'kwaiId', 'kwai_id')),
      avatar: n.url(first(v, 'headurl', 'headerUrl', 'avatar', 'userHead')),
      url: profileUrl(id),
      bio: n.str(first(v, 'user_text', 'description', 'userText')),
      stats: {
        followers: count(first(v, 'fansCount', 'fans', 'fan')),
        following: count(first(v, 'followCount', 'follows')),
        items: count(first(v, 'photoCount', 'photo')),
      },
    },
    v,
  )
}

/** GraphQL 评论（rootCommentsV2 / subCommentsV2 / REST 的同名字段）。 */
export function comment(v: any, itemId: string, parentId: string | null = null): Comment {
  return n.comment(
    {
      id: n.id(v.commentId ?? v.comment_id),
      item_id: itemId,
      parent_id: parentId,
      author: ref(first(v, 'authorEid', 'authorId', 'author_id'), first(v, 'authorName', 'author_name')),
      text: String(v.content ?? ''),
      created_at: n.time(v.timestamp),
      stats: { likes: count(first(v, 'realLikedCount', 'likedCount')), replies: count(first(v, 'subCommentCount')) ?? (v.hasSubComments ? null : 0) },
    },
    v,
  )
}

/** 直播首页 home/list 里的直播间（id 用主播 eid，也就是房间页 /u/<eid>）。 */
export function liveRoom(v: any): Live {
  const author = v?.author ?? {}
  const eid = n.id(author.id)
  return n.live(
    {
      id: eid,
      url: liveUrl(eid),
      title: n.str(v.caption),
      status: v.living || author.living ? 'live' : 'offline',
      host: n.userRef({ id: eid, name: author.name, url: liveUrl(eid) }),
      cover: n.url(v.poster),
      stats: { viewers: count(v.watchingCount) },
    },
    v,
  )
}

/** 直播回放列表。 */
export function playback(v: any, eid: string): Item {
  const id = n.id(first(v, 'id', 'productId', 'photoId'))
  return n.item(
    {
      id,
      kind: 'video',
      url: `https://live.kuaishou.com/playback/${id}`,
      title: n.str(first(v, 'caption', 'title')),
      author: ref(eid, null),
      created_at: n.time(first(v, 'createTime', 'timestamp')),
      cover: n.url(first(v, 'poster', 'coverUrl')),
      stats: { views: count(v.viewCount), likes: count(v.likeCount), comments: count(v.commentCount) },
    },
    v,
  )
}

/** 创作者中心作品管理的状态。 */
function workStatus(v: any): ItemStatus | null {
  const s = Number(first(v, 'publishStatus', 'status', 'auditStatus'))
  if (!Number.isFinite(s)) return null
  if (v?.photoStatus === 2 || v?.privacy === 2) return 'private'
  if (s === 1 || s === 3) return 'published'
  if (s === 2 || s === 0) return 'reviewing'
  if (s < 0 || s === 4) return 'rejected'
  return null
}

/** 作品管理页（photo/list）的一行。 */
export function work(v: any): Item {
  const id = n.id(first(v, 'workId', 'photoId', 'photoIdStr', 'publishId'))
  return n.item(
    {
      id,
      // 作品管理的列表没有 photoType，图集靠 showAtlasIcon 判断
      kind: first(v, 'atlasId') || v?.photoType === 1 || v?.showAtlasIcon === true ? 'image' : 'video',
      url: first(v, 'workId', 'photoId', 'photoIdStr') ? photoUrl(id) : null,
      text: n.str(first(v, 'caption', 'title')),
      author: v?.userIdStr ? n.userRef({ id: String(v.userIdStr), name: n.str(v.userName), url: profileUrl(v.userIdStr) }) : null,
      created_at: n.time(first(v, 'publishTime', 'uploadTime', 'createTime')),
      cover: n.url(first(v, 'coverUrl', 'publishCoverUrl', 'cover')),
      stats: {
        views: count(first(v, 'playCount', 'viewCount')),
        likes: count(first(v, 'likeCount')),
        comments: count(first(v, 'commentCount')),
        collects: count(first(v, 'collectCount')),
        shares: count(first(v, 'shareCount')),
      },
      status: workStatus(v),
    },
    v,
  )
}
