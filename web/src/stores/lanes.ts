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
  /** 最近一次请求的查询（账号 + 排序 + 类型 + 分类 + 时间 + 关键词）；与当前查询相同就不重新请求 */
  key: string | null
  /** 这个渠道本页浏览用的账号（多选时几个账号各请求一次再合并）；空数组表示不带 -a */
  accounts: string[]
  sort: string
  type: string
  kind: string
  time: string
  keyword: string
  /** 猫眼演出的城市（空串为默认城市）；别的平台恒为空串 */
  city: string
  /** M-Team 的筛选（别的平台为 null） */
  mt: { mode: string; category: string; free: boolean } | null
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
    accounts: [],
    sort: 'general',
    type: 'all',
    kind: 'recommend',
    time: 'all',
    keyword: '',
    city: '',
    mt: null,
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

// ---------- 多账号：同一查询用几个账号各请求一次，结果合并（AGENTS.md 7.9「多账号合并」） ----------

/** 多账号的翻页位置前缀：之后是 `{账号: cursor}` 的 JSON，只列还有下一页的账号 */
const MULTI = 'multi:'

/**
 * 这一次该请求哪些账号、各从哪个 cursor 开始。第一页每个账号都从头请求；
 * 只有一个账号时 cursor 就是平台自己的（不包一层），多个账号时从 `multi:` 里取，不在里面的账号已经翻完。
 */
export function cursorsFor(accounts: readonly string[], cursor: string | null, append: boolean): [string, string | null][] {
  if (!append) return accounts.map((a) => [a, null])
  if (accounts.length === 1) return cursor ? [[accounts[0]!, cursor]] : []
  if (!cursor?.startsWith(MULTI)) return []
  try {
    const map = JSON.parse(cursor.slice(MULTI.length)) as Record<string, string>
    return accounts.filter((a) => typeof map[a] === 'string').map((a) => [a, map[a]!])
  } catch {
    return []
  }
}

/** 把还有下一页的账号的 cursor 合成一个；都翻完时为 null */
export function joinCursors(accounts: readonly string[], next: ReadonlyMap<string, string>): string | null {
  if (!next.size) return null
  if (accounts.length === 1) return next.get(accounts[0]!) ?? null
  return MULTI + JSON.stringify(Object.fromEntries(next))
}

/** 各账号的结果轮流排：第一个账号的第 1 条、第二个账号的第 1 条……（去重由调用方按 id 做，先出现的留下） */
export function roundRobin<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = []
  const n = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < n; i++) for (const l of lists) if (i < l.length) out.push(l[i]!)
  return out
}
