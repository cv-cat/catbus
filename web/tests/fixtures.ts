import type { Comment, Item } from '@/api/types'

/** 一条 6.2 Item：字段齐全，按需覆盖 */
export function item(over: Partial<Item> = {}): Item {
  return {
    id: '1',
    kind: 'video',
    url: 'https://example.com/1',
    title: null,
    text: null,
    author: null,
    created_at: null,
    cover: null,
    media: [],
    stats: { views: null, likes: null, comments: null, collects: null, shares: null },
    price: null,
    status: null,
    ...over,
  }
}

export function comment(over: Partial<Comment> & { likes?: number | null } = {}): Comment {
  const { likes = null, ...rest } = over
  return {
    id: 'c1',
    item_id: '1',
    parent_id: null,
    author: null,
    text: null,
    created_at: null,
    stats: { likes, replies: null },
    ...rest,
  }
}

/** 改地址（jsdom 下 location 跟着变） */
export const go = (path: string) => history.replaceState(null, '', path)
