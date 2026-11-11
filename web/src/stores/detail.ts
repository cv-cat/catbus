import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { Item } from '@/api/types'

/** 详情卡片里切换上一条 / 下一条时用的列表（瀑布流的顺序） */
export interface DetailNav {
  items: () => Item[]
  /** 列表里某条对应的卡片元素：关闭时缩回它 */
  sourceOf: (id: string) => HTMLElement | null
  /** 快到末尾时预取下一页 */
  loadMore?: () => void
  hasMore?: () => boolean
  /** 列表里的条目各属于哪个平台、用哪个账号（聚合模式下每条都可能不同）；不给时沿用打开时的 */
  targetOf?: (item: Item) => { platform: string; account: string | null }
}

/** 详情卡片的打开状态（AGENTS.md 7.9）：从哪张卡片打开，用于共享元素放大 / 缩回 */
export interface DetailTarget {
  item: Item
  platform: string
  account: string | null
  /** 瀑布流里的卡片元素：打开时从它的封面放大，关闭时缩回它 */
  source: HTMLElement | null
  nav?: DetailNav
  /** 由上一条 / 下一条切换而来：1 下一条，-1 上一条；直接打开时没有 */
  dir?: 1 | -1
}

export const useDetailStore = defineStore('detail', () => {
  // shallowRef：target 里有 DOM 元素，不能被深层代理
  const target = shallowRef<DetailTarget | null>(null)

  function open(t: DetailTarget) {
    target.value = t
  }

  function close() {
    target.value = null
  }

  function neighbour(dir: 1 | -1): Item | null {
    const t = target.value
    const list = t?.nav?.items() ?? []
    const i = list.findIndex((x) => x.id === t?.item.id)
    return i < 0 ? null : (list[i + dir] ?? null)
  }

  /** 是否还能往这个方向切；往后切时，列表还有下一页也算能切 */
  function canStep(dir: 1 | -1): boolean {
    if (neighbour(dir)) return true
    return dir === 1 && Boolean(target.value?.nav?.hasMore?.())
  }

  /** 切到上一条 / 下一条；到末尾时先去取下一页 */
  function step(dir: 1 | -1): boolean {
    const t = target.value
    const nav = t?.nav
    if (!t || !nav) return false
    const list = nav.items()
    const i = list.findIndex((x) => x.id === t.item.id)
    if (dir === 1 && i >= list.length - 4) nav.loadMore?.()
    const next = i < 0 ? null : list[i + dir]
    if (!next) return false
    target.value = { ...t, ...nav.targetOf?.(next), item: next, source: nav.sourceOf(next.id), dir }
    return true
  }

  return { target, open, close, step, canStep }
})
