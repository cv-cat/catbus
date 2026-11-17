import type { Comment } from '@/api/types'

/** 评论区筛选（AGENTS.md 7.9「评论区筛选」）：只作用于已加载的评论 */
export type CommentSort = 'default' | 'hot' | 'new'
export const COMMENT_FILTER_MIN = 5

export function filterComments(list: Comment[], query: string, sort: CommentSort): Comment[] {
  const q = query.trim().toLowerCase()
  let out = q ? list.filter((c) => (c.text ?? '').toLowerCase().includes(q) || (c.author?.name ?? '').toLowerCase().includes(q)) : list
  if (sort === 'hot') out = [...out].sort((a, b) => (b.stats.likes ?? -1) - (a.stats.likes ?? -1))
  else if (sort === 'new') {
    const ts = (c: Comment) => (c.created_at ? Date.parse(c.created_at) || -Infinity : -Infinity)
    out = [...out].sort((a, b) => ts(b) - ts(a))
  }
  return out
}
