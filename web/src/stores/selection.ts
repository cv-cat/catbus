import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import type { Item } from '@/api/types'

/**
 * 卡片多选。选中的是 id；下载时按当前结果列表取回条目。
 * 换一次搜索（新结果）时清空，见 stores/discover。
 */
export const useSelectionStore = defineStore('selection', () => {
  const selected = shallowRef(new Set<string>())

  function set(next: Set<string>) {
    selected.value = next
  }

  return {
    selected,
    count: computed(() => selected.value.size),
    active: computed(() => selected.value.size > 0),
    has: (id: string) => selected.value.has(id),
    set,
    toggle(id: string) {
      const next = new Set(selected.value)
      next.has(id) ? next.delete(id) : next.add(id)
      set(next)
    },
    all: (items: Item[]) => set(new Set(items.map((i) => i.id))),
    none: () => set(new Set()),
    invert: (items: Item[]) => set(new Set(items.filter((i) => !selected.value.has(i.id)).map((i) => i.id))),
    pick: (items: Item[]) => items.filter((i) => selected.value.has(i.id)),
  }
})
