import * as n from '../../../core/normalize.js'
import type { Comment, Conversation, Item, Media, Message, User, UserRef } from '../../../core/schemas.js'
import { X_HOST } from './profile.js'

/** X 原始对象 → 归一化类型（AGENTS 6.2），字段取值参照上游 utils/data_util.py 的 handle_work_info。 */

/** TweetWithVisibilityResults 包了一层 tweet，统一拆开（上游 handle_work_info 开头）。 */
export function unwrap(result: any): any {
  if (result?.__typename === 'TweetWithVisibilityResults') return result.tweet ?? result
  return result
}

function screenNameOf(u: any): string | null {
  return n.str(u?.core?.screen_name ?? u?.legacy?.screen_name)
}

export const userUrl = (screenName: string) => `${X_HOST}/${screenName}`
export const tweetUrl = (id: string, screenName?: string | null) => (screenName ? `${X_HOST}/${screenName}/status/${id}` : `${X_HOST}/i/status/${id}`)

/** 用户对象（tweet 的 core.user_results.result、UserByScreenName 的 user.result、Viewer 的 user_results.result）。 */
export function userRef(u: any): UserRef | null {
  if (!u) return null
  const screenName = screenNameOf(u)
  return n.userRef({ id: u.rest_id ?? u.legacy?.id_str, name: u.core?.name ?? u.legacy?.name, url: screenName ? userUrl(screenName) : null })
}

/** 完整用户资料：新版字段在 core / avatar / profile_bio / relationship_counts / tweet_counts，老版在 legacy。 */
export function user(u: any): User {
  const legacy = u.legacy ?? {}
  const screenName = screenNameOf(u)
  return n.user(
    {
      id: n.id(u.rest_id ?? legacy.id_str),
      name: n.str(u.core?.name ?? legacy.name),
      handle: screenName,
      avatar: n.url(u.avatar?.image_url ?? legacy.profile_image_url_https),
      url: screenName ? userUrl(screenName) : null,
      bio: n.str(u.profile_bio?.description ?? legacy.description),
      stats: {
        followers: n.count(u.relationship_counts?.followers ?? legacy.followers_count),
        following: n.count(u.relationship_counts?.following ?? legacy.friends_count),
        items: n.count(u.tweet_counts?.tweets ?? legacy.statuses_count),
        likes: n.count(u.action_counts?.favorites_count ?? legacy.favourites_count),
      },
    },
    u,
  )
}

/** 推文的媒体：`extended_entities` 才有完整列表，`entities` 只有第一张。视频取码率最高的 mp4。 */
function mediaOf(legacy: any): { media: Media[]; cover: string | null } {
  const list: any[] = (legacy.extended_entities ?? legacy.entities ?? {}).media ?? []
  const media: Media[] = []
  for (const m of list) {
    const info = m.original_info ?? {}
    if (m.type === 'photo') {
      media.push(n.media({ id: n.id(m.id_str), type: 'image', url: m.media_url_https, width: n.count(info.width), height: n.count(info.height) }, m))
      continue
    }
    const mp4 = (m.video_info?.variants ?? []).filter((v: any) => v.content_type === 'video/mp4')
    const best = mp4.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]
    if (!best) continue
    const ms = m.video_info?.duration_millis
    media.push(n.media({ id: n.id(m.id_str), type: 'video', url: best.url, width: n.count(info.width), height: n.count(info.height), duration: ms == null ? null : n.seconds(ms / 1000) }, m))
  }
  return { media, cover: n.url(list[0]?.media_url_https) }
}

/** 推文对象里的正文：长推文的全文在 note_tweet 里，legacy.full_text 是截断的。 */
function textOf(t: any): string | null {
  return n.str(t.note_tweet?.note_tweet_results?.result?.text ?? t.legacy?.full_text)
}

/** tweet result → Item。kind：有视频为 video，有图片为 image，否则 text（上游 work_type）。 */
export function item(raw: any): Item {
  const t = unwrap(raw)
  const legacy = t.legacy ?? {}
  const author = t.core?.user_results?.result
  const id = n.id(t.rest_id ?? legacy.id_str)
  const { media, cover } = mediaOf(legacy)
  return n.item(
    {
      id,
      kind: media.some((m) => m.type === 'video') ? 'video' : media.length ? 'image' : 'text',
      url: tweetUrl(id, screenNameOf(author)),
      text: textOf(t),
      author: userRef(author),
      created_at: n.time(legacy.created_at),
      cover,
      media,
      stats: {
        views: n.count(t.views?.count),
        likes: n.count(legacy.favorite_count),
        comments: n.count(legacy.reply_count),
        collects: n.count(legacy.bookmark_count),
        shares: n.count(legacy.retweet_count),
      },
    },
    raw,
  )
}

/** 回复推文 → Comment。直接回复本推文的 parent_id 为 null，楼中楼为被回复的那条。 */
export function comment(raw: any, itemId: string): Comment {
  const t = unwrap(raw)
  const legacy = t.legacy ?? {}
  const parent = n.idOrNull(legacy.in_reply_to_status_id_str)
  return n.comment(
    {
      id: n.id(t.rest_id ?? legacy.id_str),
      item_id: itemId,
      parent_id: parent === itemId ? null : parent,
      author: userRef(t.core?.user_results?.result),
      text: textOf(t) ?? '',
      created_at: n.time(legacy.created_at),
      stats: { likes: n.count(legacy.favorite_count), replies: n.count(legacy.reply_count) },
    },
    raw,
  )
}

// ---------------------------------------------------------------- timeline

/** 深度遍历 timeline，产出所有带 entryId + content 的 entry（上游 _walk_entries）。 */
function* walkEntries(node: any): Generator<any> {
  if (Array.isArray(node)) {
    for (const v of node) yield* walkEntries(v)
  } else if (node && typeof node === 'object') {
    if ('entryId' in node && 'content' in node) yield node
    for (const v of Object.values(node)) yield* walkEntries(v)
  }
}

/** 真正的推文条目：跳过游标、广告、模块占位和已删除 / 不可见的推文（上游 extract_tweet_entries）。 */
export function tweetResults(res: any): any[] {
  const out: any[] = []
  for (const entry of walkEntries(res)) {
    if (!String(entry.entryId).startsWith('tweet-')) continue
    const result = entry.content?.itemContent?.tweet_results?.result
    if (unwrap(result)?.rest_id) out.push(result)
  }
  return out
}

/** 搜索 People 的用户条目。 */
export function userResults(res: any): any[] {
  const out: any[] = []
  for (const entry of walkEntries(res)) {
    if (!String(entry.entryId).startsWith('user-')) continue
    const result = entry.content?.itemContent?.user_results?.result
    if (result?.rest_id) out.push(result)
  }
  return out
}

/** TweetDetail 里的回复：在 conversationthread-* 模块的 items 里，第一条是直接回复，其后是楼中楼。 */
export function replyResults(res: any): any[] {
  const out: any[] = []
  for (const entry of walkEntries(res)) {
    if (!String(entry.entryId).startsWith('conversationthread-')) continue
    for (const it of entry.content?.items ?? []) {
      const result = it.item?.itemContent?.tweet_results?.result
      if (unwrap(result)?.rest_id) out.push(result)
    }
  }
  return out
}

/** 按 cursorType 在整棵树里找游标（上游 extract_cursor）。 */
export function cursorOf(res: any, direction: 'Top' | 'Bottom' = 'Bottom'): string | null {
  for (const entry of walkEntries(res)) {
    const content = entry.content ?? {}
    for (const holder of [content, content.itemContent ?? {}]) {
      if (holder && typeof holder === 'object' && holder.cursorType === direction && holder.value) return holder.value
    }
  }
  return null
}

// ---------------------------------------------------------------- X Chat

/** 收件箱条目 → Conversation。单聊的 peer 是自己以外的那个参与者；消息是端到端加密的，不解。 */
export function conversation(entry: any, selfId: string): Conversation {
  const detail = entry.conversation_detail ?? {}
  const group = detail.group_metadata
  const others = (detail.participants_results ?? []).map((p: any) => p.result ?? p).filter((u: any) => u?.rest_id && u.rest_id !== selfId)
  return n.conversation(
    {
      id: n.id(detail.conversation_id),
      peer: group ? null : userRef(others[0]),
      updated_at: n.time(group?.updated_at_msec),
    },
    entry,
  )
}

/**
 * X Chat 的消息事件是 base64 的加密载荷（端到端加密，要用户的 passcode 才能解），
 * 这里只按顺序给出占位的 Message，原始事件用 `--raw` 取。
 */
export function encryptedMessage(encoded: string, index: number, conversationId: string): Message {
  return n.message({ id: String(index), conversation_id: conversationId, type: 'other' }, encoded)
}
