import { defineStore } from 'pinia'
import { shallowRef, watch } from 'vue'
import { useDetailStore } from './detail'
import { useSettingsStore } from './settings'

/**
 * 看过的标记（AGENTS.md 7.9「看过的标记」）：点开过详情的条目。只在浏览器里：
 * localStorage `catbus.seen` = `{<平台>: [条目 id...]}`，最近的在后，总共最多 SEEN_MAX 条，满了丢最早的。
 */
const KEY = 'catbus.seen'
export const SEEN_MAX = 5000

type Seen = Record<string, string[]>

function read(): Seen {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Seen = {}
    for (const [k, list] of Object.entries(v)) if (Array.isArray(list)) out[k] = list.filter((x): x is string => typeof x === 'string')
    return out
  } catch {
    return {}
  }
}

/** 加一条；总数超过上限时按加入的先后丢最早的（每个平台各自最早的轮流丢，近似全局最早） */
export function addSeen(seen: Seen, platform: string, id: string, max = SEEN_MAX): Seen {
  const list = (seen[platform] ?? []).filter((x) => x !== id)
  list.push(id)
  const next = { ...seen, [platform]: list }
  let total = Object.values(next).reduce((n, l) => n + l.length, 0)
  while (total > max) {
    const longest = Object.keys(next).reduce((a, b) => (next[a]!.length >= next[b]!.length ? a : b))
    next[longest] = next[longest]!.slice(1)
    total--
  }
  return next
}

export const useSeenStore = defineStore('seen', () => {
  const { settings } = useSettingsStore()
  const seen = shallowRef<Seen>(read())
  let sets = new Map<string, Set<string>>()
  const rebuild = () => (sets = new Map(Object.entries(seen.value).map(([k, l]) => [k, new Set(l)])))
  rebuild()

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(seen.value))
    } catch {
      // 写不进去：本次会话里照常可用
    }
  }
  function mark(platform: string, id: string) {
    if (!settings.markSeen || !platform || !id) return
    seen.value = addSeen(seen.value, platform, id)
    rebuild()
    save()
  }
  /** 读 seen.value 以便组件跟着更新 */
  const has = (platform: string | undefined, id: string) => Boolean(platform && seen.value && sets.get(platform)?.has(id))
  function clear() {
    seen.value = {}
    rebuild()
    save()
  }
  const count = () => Object.values(seen.value).reduce((n, l) => n + l.length, 0)

  // 打开详情（包括上一条 / 下一条、相关推荐切换）就算看过
  const detail = useDetailStore()
  watch(
    () => detail.target,
    (t) => t && mark(t.platform, t.item.id),
  )
  addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    seen.value = read()
    rebuild()
  })

  return { seen, has, mark, clear, count }
})
