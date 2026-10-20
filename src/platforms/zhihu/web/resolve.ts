import { CatbusError } from '../../../core/errors.js'
import * as api from './api.js'
import type { Zhihu } from './client.js'

/** 参数归一化（AGENTS 4.8）。 */

export type ItemType = 'answer' | 'article' | 'pin'

export interface ItemRef {
  type: ItemType
  id: string
}

/** 评论接口路径里的类型。 */
export const COMMENT_TYPE: Record<ItemType, string> = { answer: 'answers', article: 'articles', pin: 'pins' }

const QUESTION_HINT = '问题请用 catbus zhihu question get <问题> 或 question answers <问题>'

function parseUrl(s: string): URL | null {
  if (!/^(https?:\/\/)?([\w-]+\.)*zhihu\.com\//i.test(s)) return null
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
}

/**
 * item：回答 ID（纯数字）、`answer:` / `article:` / `pin:` 前缀的 ID，或者链接
 * `zhihu.com/question/<q>/answer/<a>`、`zhihu.com/answer/<a>`、`zhuanlan.zhihu.com/p/<id>`、`zhihu.com/pin/<id>`。
 */
export function resolveItem(input: string): ItemRef {
  const s = input.trim()
  if (/^\d+$/.test(s)) return { type: 'answer', id: s }
  const typed = /^(answer|article|pin|question):(\d+)$/.exec(s)
  if (typed) {
    if (typed[1] === 'question') throw new CatbusError('USAGE', `${s} 是问题，不是回答、文章或想法`, { hint: QUESTION_HINT })
    return { type: typed[1] as ItemType, id: typed[2]! }
  }
  const url = parseUrl(s)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const at = (name: string) => {
      const i = parts.indexOf(name)
      return i >= 0 && /^\d+$/.test(parts[i + 1] ?? '') ? parts[i + 1]! : null
    }
    const answerId = at('answer') ?? at('answers')
    if (answerId) return { type: 'answer', id: answerId }
    if (url.hostname.startsWith('zhuanlan.') && at('p')) return { type: 'article', id: at('p')! }
    const articleId = at('articles')
    if (articleId) return { type: 'article', id: articleId }
    const pinId = at('pin') ?? at('pins')
    if (pinId) return { type: 'pin', id: pinId }
    if (at('question') || at('questions')) throw new CatbusError('USAGE', '这是问题的链接，不是回答、文章或想法', { hint: QUESTION_HINT })
    if (at('zvideo')) throw new CatbusError('UNSUPPORTED', '知乎视频（zvideo）还不支持', { hint: '目前支持回答、文章和想法' })
  }
  throw new CatbusError('USAGE', `无法识别的知乎内容：${input}`, {
    hint: '传回答 ID，或者回答 / 文章 / 想法的链接，例如 https://www.zhihu.com/question/<问题>/answer/<回答>',
  })
}

/** 问题：问题 ID、`question:<id>`，或问题 / 回答的链接。 */
export function resolveQuestion(input: string): string {
  const s = input.trim()
  const m = /^(?:question:)?(\d+)$/.exec(s)
  if (m) return m[1]!
  const url = parseUrl(s)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const i = parts.findIndex((p) => p === 'question' || p === 'questions')
    if (i >= 0 && /^\d+$/.test(parts[i + 1] ?? '')) return parts[i + 1]!
  }
  throw new CatbusError('USAGE', `无法识别的知乎问题：${input}`, { hint: '传问题 ID 或问题链接，例如 https://www.zhihu.com/question/<问题 ID>' })
}

/** 用户：url_token（老用户可能是中文）、主页链接 `zhihu.com/people/<token>`（机构号是 `/org/<token>`），或 `me`。返回 url_token。 */
export async function resolveUser(z: Zhihu, input: string): Promise<string> {
  const s = input.trim()
  if (s === 'me') {
    const saved = z.ctx.credential.extra.url_token
    if (typeof saved === 'string' && saved) return saved
    return (await api.me(z)).url_token
  }
  const url = parseUrl(s)
  if (url) {
    const parts = url.pathname.split('/').filter(Boolean)
    const i = parts.findIndex((p) => p === 'people' || p === 'org' || p === 'members')
    if (i >= 0 && parts[i + 1]) return decodeURIComponent(parts[i + 1]!)
  } else if (/^[^\s/?#]+$/u.test(s)) return s
  throw new CatbusError('USAGE', `无法识别的知乎用户：${input}`, { hint: '传用户的 url_token 或主页链接，例如 https://www.zhihu.com/people/<url_token>' })
}

/** 收藏夹：收藏夹 ID 或链接 `zhihu.com/collection/<id>`。 */
export function resolveFolder(input: string): string {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  const url = parseUrl(s)
  const m = url && /\/collections?\/(\d+)/.exec(url.pathname)
  if (m) return m[1]!
  throw new CatbusError('USAGE', `无法识别的收藏夹：${input}`, { hint: '传收藏夹 ID 或链接 https://www.zhihu.com/collection/<id>' })
}
