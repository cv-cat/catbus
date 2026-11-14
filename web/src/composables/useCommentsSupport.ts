import { ref } from 'vue'
import { loadFilters } from '@/api/client'

/**
 * 下载时能不能带评论（AGENTS.md 7.9「批量选择与下载」）：GET /api/filters 的 `comments`
 * （平台 web 端的 `comment list` 已实现，来自注册表）。还没读到、或读不到（旧版 bridge）时不置灰：
 * 没有评论的平台由 CLI 写出空的评论列表，不报错。
 */
const supported = ref<Record<string, boolean> | null>(null)
let probing: Promise<void> | null = null

function probe() {
  probing ??= loadFilters().then((all) => {
    if (!all) return
    const out: Record<string, boolean> = {}
    for (const [id, f] of Object.entries(all)) if (typeof f.comments === 'boolean') out[id] = f.comments
    supported.value = out
  })
  return probing
}

/** 响应式：平台下载时能不能带评论（第一次调用时去读 /api/filters） */
export function commentsSupported(platform: string): boolean {
  void probe()
  return supported.value?.[platform] ?? true
}
