import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useSettingsStore } from './settings'

/**
 * 搜索历史（AGENTS.md 7.9「搜索历史」，设计稿 Z8）：每个平台各自记最近提交过的关键词，只在浏览器里。
 * localStorage `catbus.history` = `{<平台>: [关键词...]}`，最近的在前，每个平台最多 20 条，去重。
 */
const KEY = 'catbus.history'
export const HISTORY_MAX = 20
/** 空输入时显示的条数、有输入时匹配的条数 */
export const HISTORY_SHOWN = 6
export const HISTORY_MATCHED = 3

function read(): Record<string, string[]> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, string[]> = {}
    for (const [p, list] of Object.entries(v as Record<string, unknown>)) {
      if (Array.isArray(list)) out[p] = [...new Set(list.filter((k): k is string => typeof k === 'string' && !!k.trim()))].slice(0, HISTORY_MAX)
    }
    return out
  } catch {
    return {}
  }
}

export const useHistoryStore = defineStore('history', () => {
  const { settings } = useSettingsStore()
  const all = ref<Record<string, string[]>>(settings.searchHistory ? read() : {})

  function save() {
    try {
      if (Object.keys(all.value).length) localStorage.setItem(KEY, JSON.stringify(all.value))
      else localStorage.removeItem(KEY)
    } catch {
      // 写不进去（隐私模式）：只在本次会话里生效
    }
  }

  const list = (platform: string) => all.value[platform] ?? []
  function add(platform: string, keyword: string) {
    const k = keyword.trim()
    if (!settings.searchHistory || !k) return
    all.value = { ...all.value, [platform]: [k, ...list(platform).filter((x) => x !== k)].slice(0, HISTORY_MAX) }
    save()
  }
  function remove(platform: string, keyword: string) {
    const next = list(platform).filter((x) => x !== keyword)
    const copy = { ...all.value }
    if (next.length) copy[platform] = next
    else delete copy[platform]
    all.value = copy
    save()
  }
  function clear(platform?: string) {
    if (platform) {
      const copy = { ...all.value }
      delete copy[platform]
      all.value = copy
    } else all.value = {}
    save()
  }
  /** 有输入时：包含输入（不区分大小写）的历史 */
  function matching(platform: string, query: string): string[] {
    const q = query.trim().toLowerCase()
    if (!q) return list(platform).slice(0, HISTORY_SHOWN)
    return list(platform).filter((k) => k.toLowerCase().includes(q)).slice(0, HISTORY_MATCHED)
  }

  // 关掉「记住搜索历史」：不再记录，并清空已有的
  watch(
    () => settings.searchHistory,
    (on) => !on && clear(),
  )

  return { all, list, add, remove, clear, matching }
})
