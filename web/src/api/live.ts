import { mockLiveCategories, mockLiveGifts, mockLiveHistory, mockLiveProducts, mockLiveRank, mockLiveReplays, mockLives } from './mock'
import { call } from './client'
import type { Category, Envelope, Gift, Item, Live, LiveEvent, Rank } from './types'
import { isDemo } from '@/stores/source'

/** 直播页的发现直播间与直播间标签（AGENTS.md 7.9「直播弹幕」）：都是只读命令，经 /api/catbus */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface PageOpts {
  account?: string | null
  limit?: number
  cursor?: string | null
  signal?: AbortSignal
}

function withPage(argv: string[], o: PageOpts) {
  if (o.account) argv.push('-a', o.account)
  if (o.limit) argv.push('--limit', String(o.limit))
  if (o.cursor) argv.push('--cursor', o.cursor)
  return argv
}
const page = (cursor: string | null | undefined) => (cursor ? Number(cursor) || 0 : 0)

/** 推荐列表：`live list [--category]` */
export async function listLives(platform: string, category: string | null, o: PageOpts = {}): Promise<Envelope<Live[]>> {
  if (isDemo()) return wait(500).then(() => mockLives(platform, category ? `cat:${category}` : '', page(o.cursor), o.limit))
  const argv = withPage([platform, 'live', 'list'], o)
  if (category) argv.push('--category', category)
  return call<Live[]>(argv, o.signal)
}

/** 搜索直播：`live search -- <关键词>` */
export async function searchLives(platform: string, keyword: string, o: PageOpts = {}): Promise<Envelope<Live[]>> {
  if (isDemo()) return wait(550).then(() => mockLives(platform, keyword, page(o.cursor), o.limit))
  return call<Live[]>([platform, 'live', 'search', keyword, ...withPage([], o)], o.signal)
}

export async function listLiveCategories(platform: string, account?: string | null): Promise<Envelope<Category[]>> {
  if (isDemo()) return wait(250).then(() => mockLiveCategories(platform))
  return call<Category[]>(withPage([platform, 'live', 'categories'], { account }))
}

function roomCall<T>(platform: string, action: string, room: string, account?: string | null, signal?: AbortSignal) {
  return call<T>(withPage([platform, 'live', action, room], { account }), signal)
}

export async function listLiveGifts(platform: string, room: string, account?: string | null): Promise<Envelope<Gift[]>> {
  if (isDemo()) return wait(400).then(() => mockLiveGifts(platform))
  return roomCall<Gift[]>(platform, 'gifts', room, account)
}

export async function listLiveRank(platform: string, room: string, account?: string | null): Promise<Envelope<Rank[]>> {
  if (isDemo()) return wait(450).then(() => mockLiveRank(platform, room))
  return roomCall<Rank[]>(platform, 'rank', room, account)
}

export async function listLiveProducts(platform: string, room: string, account?: string | null): Promise<Envelope<Item[]>> {
  if (isDemo()) return wait(450).then(() => mockLiveProducts(platform, room))
  return roomCall<Item[]>(platform, 'products', room, account)
}

export async function listLiveHistory(platform: string, room: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<LiveEvent[]>> {
  if (isDemo()) return wait(300).then(() => mockLiveHistory(platform, room))
  return roomCall<LiveEvent[]>(platform, 'history', room, account, signal)
}

/** 回放：`live replays -- <user>`，<user> 是主播 */
export async function listLiveReplays(platform: string, user: string, o: PageOpts = {}): Promise<Envelope<Item[]>> {
  if (isDemo()) return wait(450).then(() => mockLiveReplays(platform, user, page(o.cursor), o.limit))
  return call<Item[]>([platform, 'live', 'replays', user, ...withPage([], o)], o.signal)
}
