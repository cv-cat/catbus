import { ref } from 'vue'
import { listRelated, loadFilters } from '@/api/client'
import { MOCK_RELATED_PLATFORMS } from '@/api/mock'
import type { Item } from '@/api/types'
import { isDemo } from '@/stores/source'

/**
 * 相关推荐的数据（AGENTS.md 7.9「相关推荐」）：
 * - 平台是否支持：GET /api/filters 的 `related`（来自注册表），读不到时当作不支持；演示模式下读不到时按演示平台；
 * - 结果按「平台 + 条目」在本页会话里缓存，只在内存里；
 * - 只取一页，最多 12 条；返回空时缓存空数组（整段不渲染），失败时不缓存，下次打开这一条再取。
 */
export const RELATED_LIMIT = 12

/** 平台 id → 是否支持；null 表示还没读到 */
const supported = ref<Record<string, boolean> | null>(null)
let probing: Promise<void> | null = null

function probe() {
  probing ??= loadFilters().then((all) => {
    const out: Record<string, boolean> = {}
    if (all) for (const [id, f] of Object.entries(all)) out[id] = Boolean(f.related)
    else if (isDemo()) for (const id of MOCK_RELATED_PLATFORMS) out[id] = true
    supported.value = out
  })
  return probing
}

/** 响应式：平台的 web 端是否实现了 item related（第一次调用时去读 /api/filters） */
export function relatedSupported(platform: string): boolean {
  void probe()
  return Boolean(supported.value?.[platform])
}

const cache = new Map<string, Item[]>()
const keyOf = (platform: string, id: string) => `${platform}\u0000${id}`

export function cachedRelated(platform: string, id: string): Item[] | undefined {
  return cache.get(keyOf(platform, id))
}

/** 记进缓存：只有结果回来时卡片还停在这一条才记（切换、关闭后的结果整个丢弃） */
export function rememberRelated(platform: string, id: string, list: Item[]) {
  cache.set(keyOf(platform, id), list)
}

/**
 * 同一时间只有一张详情卡片、一行相关推荐：发新的一次（切到别的条目）时，上一次还在路上的直接取消；
 * 卡片换条目、关闭时 DetailCard 调 cancelRelated()。被取消的结果调用方本来就会丢弃（RelatedRail 的 token）。
 */
let ctl: AbortController | null = null
export function cancelRelated() {
  ctl?.abort()
  ctl = null
}

/** 取相关推荐；失败或被取消时返回 null。去掉条目自己和重复的，最多 RELATED_LIMIT 条 */
export async function fetchRelated(platform: string, id: string, item: Item, account: string | null): Promise<Item[] | null> {
  cancelRelated()
  const mine = (ctl = new AbortController())
  try {
    const env = await listRelated(platform, item, RELATED_LIMIT, account, mine.signal)
    if (!env.ok || !Array.isArray(env.data)) return null
    const seen = new Set([id])
    return env.data.filter((x) => x && !seen.has(x.id) && Boolean(seen.add(x.id))).slice(0, RELATED_LIMIT)
  } catch {
    return null
  } finally {
    if (ctl === mine) ctl = null
  }
}
