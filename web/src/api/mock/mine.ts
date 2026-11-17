import type { Envelope, Item } from '../types'
import { mockUser } from './author'
import { mockItems } from './content'
import { hash } from './shared'

export const MOCK_MINE: Record<string, string[]> = {
  xhs: ['works', 'likes', 'collects'],
  douyin: ['works', 'likes'],
  tiktok: ['works', 'collects', 'reposts', 'folders'],
  bilibili: ['works', 'folders'],
  kuaishou: ['works', 'likes', 'collects'],
  jd: ['collects', 'history'],
  youtube: ['works', 'likes', 'collects', 'series', 'history'],
}
const MINE_STATUSES = ['published', 'published', 'reviewing', 'published', 'private', 'published', 'rejected', 'published', 'draft']
const FOLDER_NAMES = ['默认收藏夹', '露营装备', '想去的地方', '做饭灵感', '稍后再看']

/** 演示的「我的」列表：作品带审核状态、作者是当前账号；转发为空（演示空标签）；每个标签 60 条，按 offset 分页 */
export function mockMineItems(platform: string, tab: string, folder: string | null, offset: number, limit = 20): Envelope<Item[]> {
  const total = tab === 'reposts' ? 0 : folder ? 12 + (hash(folder) % 30) : 60
  // 标签和收藏夹只用来换一批数据（variant），不拼进标题
  const page = mockItems(platform, '', Math.floor(offset / limit), limit, `mine-${tab}-${folder ?? ''}`)
  const me = tab === 'works' ? mockUser(platform, 'me').data! : null
  const author = me ? { id: me.id, name: me.name, url: me.url, avatar: me.avatar } : null
  const data = page.data!.slice(0, Math.max(0, total - offset)).map((it, i) => ({
    ...it,
    ...(author ? { author } : {}),
    id: `${it.id}-${tab}${folder ?? ''}`,
    status: tab === 'works' ? (MINE_STATUSES[(offset + i) % MINE_STATUSES.length] ?? null) : null,
  }))
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

export function mockMineFolders(platform: string, tab: string): Envelope<{ id: string; name: string; count: number; url: string }[]> {
  const data = FOLDER_NAMES.map((name, i) => {
    const id = `${tab}-${i + 1}`
    return { id, name, count: 12 + (hash(id) % 30), url: `https://example.com/${platform}/${tab}/${id}` }
  })
  return { ok: true, data, page: null, error: null }
}

// 搜索联想与热搜的演示词（AGENTS.md 7.9「搜索联想与热搜」）
