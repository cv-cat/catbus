import type { CatbusError, Item } from '@/api/types'

/**
 * 瀑布流里的一格。`item` 为 null 时是骨架占位（渠道还在加载）。
 * `key` 是格子的身份：占位换成卡片、刷新换一批条目时格子不变，卡片在原位替换。
 */
export interface Cell {
  key: string
  platform: string
  item: Item | null
}

/** 聚合模式里的一个渠道：各有各的结果、翻页位置和加载状态 */
export interface Lane {
  platform: string
  /** 最近一次请求的查询（账号 + 排序 + 类型 + 关键词）；与当前查询相同就不重新请求 */
  key: string | null
  account: string | null
  sort: string
  type: string
  keyword: string
  items: Item[]
  cursor: string | null
  hasMore: boolean
  elapsed: number | null
  seen: Set<string>
  loading: boolean
  error: CatbusError | null
  /** 连续翻到全是重复条目的页数 */
  empty: number
  /** 每次请求加一，丢掉过期的响应 */
  seq: number
}

export function newLane(platform: string): Lane {
  return {
    platform,
    key: null,
    account: null,
    sort: 'general',
    type: 'all',
    keyword: '',
    items: [],
    cursor: null,
    hasMore: false,
    elapsed: null,
    seen: new Set(),
    loading: false,
    error: null,
    empty: 0,
    seq: 0,
  }
}

let serial = 0
const nextKey = (platform: string) => `${platform}#${++serial}`

export const itemCell = (platform: string, item: Item): Cell => ({ key: nextKey(platform), platform, item })

export const skeletonCells = (platform: string, n: number): Cell[] =>
  Array.from({ length: n }, () => ({ key: nextKey(platform), platform, item: null }))

/** 按渠道顺序轮流各取一格：抖音、小红书、X、抖音、小红书、X……各渠道内部的顺序不变 */
export function interleave(order: readonly string[], cells: readonly Cell[]): Cell[] {
  const by = new Map(order.map((p) => [p, [] as Cell[]]))
  for (const c of cells) by.get(c.platform)?.push(c)
  const out: Cell[] = []
  for (let round = 0, more = true; more; round++) {
    more = false
    for (const p of order) {
      const c = by.get(p)![round]
      if (!c) continue
      out.push(c)
      more = true
    }
  }
  return out
}

/**
 * 把一个渠道的格子按顺序换成新的条目：格子留在原位（别的渠道不动），
 * 多出来的格子删掉，多出来的条目接在最后。
 */
export function fill(cells: readonly Cell[], platform: string, items: readonly Item[]): Cell[] {
  let i = 0
  const out: Cell[] = []
  for (const c of cells) {
    if (c.platform !== platform) out.push(c)
    else if (i < items.length) out.push({ ...c, item: items[i++]! })
  }
  while (i < items.length) out.push(itemCell(platform, items[i++]!))
  return out
}
