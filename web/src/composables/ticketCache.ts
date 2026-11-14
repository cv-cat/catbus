import { shallowReactive } from 'vue'
import type { Item } from '@/api/types'
import { parseSessions, type Session } from './tickets'

/**
 * 场次与票档的查询结果，按「平台 + 条目」在本页会话里缓存（只在内存里，AGENTS.md 7.9「猫眼演出的场次与票档」）。
 * 只缓存成功的结果；详情卡片据此决定要不要隐藏原来的「票价」一行。
 */
export interface TicketResult {
  item: Item
  sessions: Session[]
  /** 查询的时间（毫秒） */
  at: number
}

export const ticketCache = shallowReactive(new Map<string, TicketResult>())

export const ticketKey = (platform: string, id: string) => `${platform}:${id}`

export function storeTickets(platform: string, id: string, item: Item): TicketResult {
  const result = { item, sessions: parseSessions(item.text), at: Date.now() }
  ticketCache.set(ticketKey(platform, id), result)
  return result
}
