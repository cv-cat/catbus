import * as n from '../../../core/normalize.js'
import type { Comment, Folder, Item, Keyword, Media, Question, Topic, User, UserRef } from '../../../core/schemas.js'
import { withRaw } from '../../../core/schemas.js'
import { WWW, ZHUANLAN } from './profile.js'

/**
 * 知乎原始对象 → 归一化类型（AGENTS 6.2）。
 * item 有三种：回答（id 为回答 ID）、文章（`article:<id>`）、想法（`pin:<id>`）；问题单独是 Question（`question:<id>`）。
 */

/** 主页链接：机构号是 /org/，其他是 /people/。 */
export const userUrl = (token: unknown, org = false) => `${WWW}/${org ? 'org' : 'people'}/${token}`
const isOrg = (m: any) => m?.is_org === true || m?.user_type === 'organization'
export const answerUrl = (questionId: unknown, id: unknown) => (questionId == null ? `${WWW}/answer/${id}` : `${WWW}/question/${questionId}/answer/${id}`)
export const articleUrl = (id: unknown) => `${ZHUANLAN}/p/${id}`
export const pinUrl = (id: unknown) => `${WWW}/pin/${id}`
export const questionUrl = (id: unknown) => `${WWW}/question/${id}`

/** 输出的 item id：回答是回答 ID，文章、想法带类型前缀（resolve.resolveItem 反过来解析）。 */
export const itemId = (type: 'answer' | 'article' | 'pin', id: unknown) => (type === 'answer' ? String(id) : `${type}:${id}`)

/** 作者：comment_v5 的作者有时包在 member 里。匿名用户的 id 为 0，没有主页。 */
export function ref(u: any): UserRef | null {
  const m = u?.member ?? u
  if (!m || m.id == null || m.id === '') return null
  const token = m.url_token || null
  const anonymous = String(m.id) === '0'
  return n.userRef({ id: m.id, name: m.name, url: anonymous ? null : userUrl(token ?? m.id, isOrg(m)) })
}

export function user(m: any): User {
  const token = m.url_token || null
  return n.user(
    {
      id: n.id(m.id),
      // 搜索结果里的名字带 <em> 高亮
      name: n.plainText(m.name),
      handle: token,
      avatar: n.url(m.avatar_url),
      url: userUrl(token ?? m.id, isOrg(m)),
      bio: n.plainText(m.headline) ?? n.plainText(m.description),
      stats: {
        followers: n.count(m.follower_count),
        following: n.count(m.following_count),
        items: m.answer_count == null && m.articles_count == null ? null : (n.count(m.answer_count) ?? 0) + (n.count(m.articles_count) ?? 0),
        likes: n.count(m.voteup_count),
      },
    },
    m,
  )
}

/** 正文 HTML 里的图片：优先 data-original / data-actualsrc（原图），跳过 data: 占位图。 */
export function images(html: unknown): Media[] {
  if (typeof html !== 'string' || !html) return []
  const out: Media[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    // 属性名前面不能是字母、数字或连字符：src 不能匹配到 data-src
    const attr = (name: string) => new RegExp(`(?<![\\w-])${name}="([^"]*)"`, 'i').exec(tag)?.[1]
    const src = n.url(n.unescapeHtml(attr('data-original') || attr('data-actualsrc') || attr('src') || ''))
    if (!src || src.startsWith('data:') || seen.has(src)) continue
    seen.add(src)
    out.push(n.media({ type: 'image', url: src, width: n.count(attr('data-rawwidth')), height: n.count(attr('data-rawheight')) }))
  }
  return out
}

export function answer(a: any): Item {
  const q = a.question ?? {}
  const media = images(a.content)
  return n.item(
    {
      id: itemId('answer', a.id),
      kind: 'text',
      url: answerUrl(q.id, a.id),
      title: n.plainText(q.title ?? q.name),
      text: n.plainText(a.content) ?? n.plainText(a.excerpt),
      author: ref(a.author),
      created_at: n.time(a.created_time),
      cover: n.url(a.thumbnail) ?? media[0]?.url ?? null,
      media,
      // 详情给 favlists_count；搜索结果给 favorites_count 和 visits_count
      stats: { views: n.count(a.visits_count), likes: n.count(a.voteup_count), comments: n.count(a.comment_count), collects: n.count(a.favlists_count ?? a.favorites_count) },
    },
    a,
  )
}

export function article(a: any): Item {
  const media = images(a.content)
  return n.item(
    {
      id: itemId('article', a.id),
      kind: 'article',
      url: articleUrl(a.id),
      title: n.plainText(a.title),
      text: n.plainText(a.content) ?? n.plainText(a.excerpt),
      author: ref(a.author),
      created_at: n.time(a.created ?? a.created_time),
      cover: n.url(a.title_image || a.image_url || a.thumbnail) ?? media[0]?.url ?? null,
      media,
      // 详情给 favlists_count；搜索结果给 favorites_count 和 visits_count
      stats: { views: n.count(a.visits_count), likes: n.count(a.voteup_count), comments: n.count(a.comment_count), collects: n.count(a.favlists_count ?? a.favorites_count) },
    },
    a,
  )
}

/** 想法：content 是块数组，文字块拼成正文，图片块是媒体。 */
export function pin(p: any): Item {
  const blocks: any[] = Array.isArray(p.content) ? p.content : []
  const text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => n.plainText(b.content ?? b.own_text))
    .filter(Boolean)
    .join('\n')
  const media = blocks
    .filter((b) => b?.type === 'image')
    .map((b) => n.media({ type: 'image', url: n.url(b.original_url || b.url), width: n.count(b.width), height: n.count(b.height) }, b))
    .filter((m) => m.url)
  return n.item(
    {
      id: itemId('pin', p.id),
      kind: media.length ? 'image' : 'text',
      url: pinUrl(p.id),
      title: null,
      text: text || n.plainText(p.excerpt_title),
      author: ref(p.author),
      created_at: n.time(p.created),
      cover: media[0]?.url ?? null,
      media,
      // 详情把计数放在 reaction.statistics 里（up_vote_count 是赞同数，favorites 是收藏数）
      stats: {
        likes: n.count(p.like_count ?? p.reaction?.statistics?.up_vote_count ?? p.reaction_count),
        comments: n.count(p.comment_count),
        collects: n.count(p.reaction?.statistics?.favorites),
        shares: n.count(p.repin_count),
      },
    },
    p,
  )
}

/**
 * 热榜里的问题当作 item 输出（`question:<id>`），用 `question get` / `question answers` 继续查看。
 * 现在的热榜把标题、摘要、配图放在 `title_area` / `excerpt_area` / `image_area` 里，问题 ID 只在 `card_id`（`Q_<id>`）
 * 和 `link.url` 里；旧格式是 target 上直接带 id、title、excerpt。
 */
export function hotQuestion(entry: any): Item | null {
  const t = entry?.target ?? {}
  const id = t.id ?? /^Q_(\d+)$/.exec(entry?.card_id ?? '')?.[1] ?? /\/question\/(\d+)/.exec(t.link?.url ?? '')?.[1]
  if (id == null) return null
  const image = t.image_area?.url ?? entry.children?.find?.((c: any) => c?.thumbnail)?.thumbnail
  return n.item(
    {
      id: `question:${id}`,
      kind: 'text',
      url: questionUrl(id),
      title: n.plainText(t.title_area?.text ?? t.title),
      text: n.plainText(t.excerpt_area?.text ?? t.excerpt),
      author: ref(t.author),
      created_at: n.time(t.created),
      cover: n.url(image),
      stats: { comments: n.count(t.comment_count) },
    },
    entry,
  )
}

/** 按对象的 type 分派；问题、视频、广告等不是 item 的返回 null。 */
export function target(t: any): Item | null {
  switch (t?.type) {
    case 'answer':
      return answer(t)
    case 'article':
      return article(t)
    case 'pin':
      return pin(t)
    default:
      return null
  }
}

export function items(list: unknown, pick: (x: any) => any = (x) => x): Item[] {
  return (Array.isArray(list) ? list : []).map((x) => target(pick(x))).filter((x): x is Item => x != null)
}

export function question(q: any): Question {
  return withRaw(
    {
      id: `question:${q.id}`,
      url: questionUrl(q.id),
      title: n.plainText(q.title),
      text: n.plainText(q.detail) ?? n.plainText(q.excerpt),
      author: ref(q.author),
      created_at: n.time(q.created ?? q.created_time),
      stats: {
        views: n.count(q.visit_count ?? q.read_count),
        answers: n.count(q.answer_count),
        followers: n.count(q.follower_count),
        comments: n.count(q.comment_count),
      },
    },
    q,
  )
}

export function comment(c: any, itemId: string, parentId: string | null = null): Comment {
  const reply = c.reply_comment_id != null && String(c.reply_comment_id) !== '0' ? String(c.reply_comment_id) : null
  return n.comment(
    {
      id: n.id(c.id),
      item_id: itemId,
      parent_id: reply ?? parentId,
      author: ref(c.author),
      text: n.plainText(c.content) ?? '',
      created_at: n.time(c.created_time),
      stats: { likes: n.count(c.like_count ?? c.vote_count), replies: n.count(c.child_comment_count) },
    },
    c,
  )
}

export function folder(c: any): Folder {
  return n.folder({ id: n.id(c.id), name: n.str(c.title) ?? '', count: n.count(c.item_count ?? c.answer_count), url: `${WWW}/collection/${c.id}` }, c)
}

export function topic(t: any): Topic {
  return n.topic(
    {
      id: n.id(t.id),
      name: n.plainText(t.name) ?? '',
      url: `${WWW}/topic/${t.id}`,
      stats: { views: null, items: n.count(t.questions_count ?? t.question_count) },
    },
    t,
  )
}

export function suggestion(s: any): Keyword {
  return n.keyword({ text: String(s.query ?? '') }, s)
}

export function hotWord(w: any): Keyword {
  return n.keyword({ text: String(w.display_query || w.query || '') }, w)
}
