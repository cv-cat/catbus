import type { Envelope, Item, Poi } from './types'
import { call } from './client'
import { mockCities, mockShowTickets } from './mock'
import { isDemo } from '@/stores/source'

/**
 * 猫眼演出（AGENTS.md 7.9「猫眼演出的城市」「猫眼演出的场次与票档」）的两条只读命令。
 * 演示模式不请求服务端。
 */

/** 城市搜索的结果按关键词在本页会话里缓存（只在内存里） */
export const citySearchCache = new Map<string, Poi[]>()

/** 城市搜索：`catbus maoyan poi search [-a <账号>] -- <关键词>`（bridge 把关键词放到 `--` 之后） */
export async function searchCities(keyword: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<Poi[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 260))
    return mockCities(keyword)
  }
  const argv = ['maoyan', 'poi', 'search', keyword]
  if (account) argv.push('-a', account)
  return call<Poi[]>(argv, signal)
}

/** 场次与票档：`catbus maoyan item get [-a <账号>] --tickets -- <item>`，场次和票档在 text 里（需要登录） */
export async function getTickets(item: Item, account?: string | null, signal?: AbortSignal): Promise<Envelope<Item>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 900))
    return mockShowTickets(item)
  }
  const argv = ['maoyan', 'item', 'get', item.url || item.id]
  if (account) argv.push('-a', account)
  argv.push('--tickets')
  return call<Item>(argv, signal)
}
