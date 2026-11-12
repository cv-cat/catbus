import { mockAccounts, mockComments, mockFilters, mockHot, mockReplies, mockItem, mockItems, mockLogout, mockSuggest, mockUse } from './mock'
import { loginApi } from './login'
import type { Account, Comment, Envelope, Item, Keyword } from './types'
import { isDemo, useSourceStore, type Source } from '@/stores/source'
import { parseOrder } from '@/data/filters'

async function call<T>(argv: string[]): Promise<Envelope<T>> {
  const res = await fetch('/api/catbus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
  })
  return (await res.json()) as Envelope<T>
}

/** 各平台 `item search` 支持的筛选取值（来自注册表）；null 表示没有这个筛选 */
export interface PlatformFilters {
  search: boolean
  sort: string[] | null
  type: string[] | null
  /** `item search` 的时间范围 `--time`；旧版 bridge 不给 */
  time?: string[] | null
  /** 已实现的 `feed list` 的流种类 `--kind`；旧版 bridge 不给 */
  kind?: string[] | null
  /** 平台私有的字段排序 `--order-by` 的取值；旧版 bridge 不给 */
  order?: string[] | null
  /** `user get` 和 `user items` 都已实现（作者页，AGENTS.md 7.9）；旧版 bridge 不给 */
  author?: boolean
  /** 搜索联想 / 热搜是否已实现；旧版 bridge 不给，当作不支持 */
  suggest?: boolean
  hot?: boolean
}

/** 读不到（旧版 bridge、纯静态预览）时返回 null，页面不置灰任何筛选；演示模式不请求服务端，用演示的取值表 */
export async function loadFilters(): Promise<Record<string, PlatformFilters> | null> {
  if (new URLSearchParams(location.search).has('demo')) return mockFilters()
  try {
    const res = await fetch('/api/filters')
    const env = (await res.json()) as Envelope<Record<string, PlatformFilters>>
    return env.ok ? env.data : null
  } catch {
    return null
  }
}

/** 启动时探测一次 bridge 和 catbus 是否可用 */
export async function detectSource(): Promise<Source> {
  const store = useSourceStore()
  // ?demo 强制使用演示数据（调试界面时不打扰真实账号）
  if (new URLSearchParams(location.search).has('demo')) return (store.source = 'demo')
  try {
    const env = await call<unknown>(['version'])
    store.source = env.ok ? 'live' : 'demo'
  } catch {
    store.source = 'demo'
  }
  return store.source
}

export interface SearchParams {
  platform: string
  keyword: string
  mode: 'search' | 'feed'
  sort?: string
  type?: string
  /** 推荐流的种类（feed list --kind） */
  kind?: string
  /** 搜索的时间范围（item search --time） */
  time?: string
  cursor?: string | null
  limit?: number
  /** 本页浏览用的账号（-a），不传时用 _current */
  account?: string | null
}

export async function searchItems(p: SearchParams): Promise<Envelope<Item[]>> {
  // 条数由调用方给（发现页取设置里的每页条数）；没给时 20
  const limit = p.limit ?? 20
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 450))
    // 演示数据按分类 / 时间换一批种子，切换后能看到结果变化
    const variant = p.keyword ? (p.time ?? 'all') : (p.kind ?? 'recommend')
    return mockItems(p.platform, p.keyword, Number(p.cursor ?? 0), limit, variant === 'all' || variant === 'recommend' ? '' : variant)
  }
  const argv =
    p.mode === 'feed' || !p.keyword
      ? [p.platform, 'feed', 'list']
      : [p.platform, 'item', 'search', p.keyword]
  if (p.account) argv.push('-a', p.account)
  argv.push('--limit', String(limit))
  if (p.cursor) argv.push('--cursor', p.cursor)
  // 字段排序（--order-by，M-Team）：搜索和浏览都能用
  const order = parseOrder(p.sort)
  if (order) {
    argv.push('--order-by', order.field)
    if (order.asc) argv.push('--asc')
  }
  if (argv[1] === 'item') {
    if (p.sort && p.sort !== 'general' && !order) argv.push('--sort', p.sort)
    if (p.type && p.type !== 'all') argv.push('--type', p.type)
    if (p.time && p.time !== 'all') argv.push('--time', p.time)
  } else if (p.kind && p.kind !== 'recommend') argv.push('--kind', p.kind)
  return call<Item[]>(argv)
}

/** 详情：`item get`，补全正文和媒体（AGENTS.md 7.9 详情卡片） */
export async function getItem(platform: string, item: Item, account?: string | null): Promise<Envelope<Item>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 350))
    return mockItem(item)
  }
  const argv = [platform, 'item', 'get', item.url || item.id]
  if (account) argv.push('-a', account)
  return call<Item>(argv)
}

/** 评论：`comment list`，一次一页，用 cursor 续翻 */
export async function listComments(
  platform: string,
  item: Item,
  cursor?: string | null,
  account?: string | null,
): Promise<Envelope<Comment[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 500))
    return mockComments(item, Number(cursor ?? 0))
  }
  const argv = [platform, 'comment', 'list', item.url || item.id]
  if (account) argv.push('-a', account)
  if (cursor) argv.push('--cursor', cursor)
  return call<Comment[]>(argv)
}

/** 楼中楼：`comment replies`，limit 为 1 时用作默认展开的那一条 */
export async function listReplies(
  platform: string,
  item: Item,
  comment: string,
  cursor?: string | null,
  limit?: number,
  account?: string | null,
): Promise<Envelope<Comment[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 400))
    return mockReplies(item, comment, Number(cursor ?? 0), limit ?? 10)
  }
  const argv = [platform, 'comment', 'replies', item.url || item.id, comment]
  if (account) argv.push('-a', account)
  if (limit) argv.push('--limit', String(limit))
  if (cursor) argv.push('--cursor', cursor)
  return call<Comment[]>(argv)
}

/** 支持楼中楼的平台（注册表里实现了 comment replies） */
export const REPLY_PLATFORMS = new Set(['xhs', 'douyin', 'bilibili', 'kuaishou', 'tiktok', 'youtube'])

/** 视频 CDN 校验 Referer 的平台，经 bridge 的 /api/media 转发（见 server/media.ts） */
const PROXIED = new Set(['douyin', 'xhs', 'kuaishou', 'weibo', 'tiktok', 'x'])
export function mediaSrc(platform: string, url: string): string {
  if (isDemo() || !PROXIED.has(platform) || !url.startsWith('https://')) return url
  return `/api/media?${new URLSearchParams({ platform, url })}`
}

export async function listAccounts(): Promise<Envelope<Account[]>> {
  if (isDemo()) return mockAccounts()
  return call<Account[]>(['auth', 'list'])
}

/** 设为默认账号（auth use），改的是 ~/.catbus 里的 _current */
/** 删除账号（auth logout）：删本地凭证，B 站、快手同时服务端登出 */
export async function removeAccount(platform: string, account: string): Promise<void> {
  if (isDemo()) return mockLogout(platform, account)
  const { envelope } = await loginApi.logout(platform, account)
  if (!envelope.ok) throw new Error(envelope.error?.message ?? '删除账号失败')
}

export async function useAccount(platform: string, account: string): Promise<void> {
  if (isDemo()) return mockUse(platform, account)
  const { envelope } = await loginApi.use(platform, account)
  if (!envelope.ok) throw new Error(envelope.error?.message ?? '设为默认失败')
}

/** 热搜（AGENTS.md 7.9「搜索联想与热搜」）：`catbus <p> keyword hot [-a <账号>]` */
export async function keywordHot(platform: string, account?: string | null): Promise<Envelope<Keyword[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 380))
    return mockHot(platform)
  }
  const argv = [platform, 'keyword', 'hot']
  if (account) argv.push('-a', account)
  return call<Keyword[]>(argv)
}

/** 搜索联想：`catbus <p> keyword suggest [-a <账号>] -- <前缀>`（bridge 把前缀放到 `--` 之后） */
export async function keywordSuggest(platform: string, prefix: string, account?: string | null): Promise<Envelope<Keyword[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 220))
    return mockSuggest(platform, prefix)
  }
  const argv = [platform, 'keyword', 'suggest', prefix]
  if (account) argv.push('-a', account)
  return call<Keyword[]>(argv)
}
