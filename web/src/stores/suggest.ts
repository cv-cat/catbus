import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { keywordHot, keywordSuggest } from '@/api/client'
import { MOCK_KEYWORD_SUPPORT } from '@/api/mock'
import type { Keyword } from '@/api/types'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'

/** 热搜最多 10 条、联想最多 8 条（设计稿 Q / Q2） */
export const HOT_MAX = 10
export const SUGGEST_MAX = 8
/** 与 bridge 的上限一致 */
const PREFIX_MAX = 100

/**
 * 搜索联想与热搜（AGENTS.md 7.9「搜索联想与热搜」）：能力判断、本页会话缓存、失败后停用。
 * 缓存只在内存里，刷新页面即清空。
 */
export const useSuggestStore = defineStore('suggest', () => {
  const d = useDiscoverStore()
  /** 请求失败、风控、未登录过的平台：本次会话不再自动请求 */
  const blocked = reactive(new Set<string>())
  const hotCache = new Map<string, Keyword[]>()
  const hotPending = new Map<string, Promise<Keyword[] | null>>()
  const suggestCache = new Map<string, Keyword[]>()

  function support(platform: string): { suggest: boolean; hot: boolean } {
    if (blocked.has(platform)) return { suggest: false, hot: false }
    const f = d.filters?.[platform] ?? (isDemo() ? MOCK_KEYWORD_SUPPORT[platform] : undefined)
    return { suggest: !!f?.suggest, hot: !!f?.hot }
  }

  const account = (platform: string) => d.accountFor(platform)?.account ?? null

  /** 统一处理失败：不弹提示，只把平台停用 */
  async function guard(platform: string, run: () => ReturnType<typeof keywordHot>): Promise<Keyword[] | null> {
    try {
      const env = await run()
      if (env.ok && Array.isArray(env.data)) return env.data.filter((k) => k && typeof k.text === 'string' && k.text.trim())
    } catch {
      /* 静默 */
    }
    blocked.add(platform)
    return null
  }

  const cachedHot = (platform: string) => hotCache.get(platform)
  /** 每个平台本页会话只取一次 */
  function hot(platform: string): Promise<Keyword[] | null> {
    const hit = hotCache.get(platform)
    if (hit) return Promise.resolve(hit)
    let p = hotPending.get(platform)
    if (!p) {
      p = guard(platform, () => keywordHot(platform, account(platform))).then((r) => {
        hotPending.delete(platform)
        if (r) hotCache.set(platform, r.slice(0, HOT_MAX))
        return r && r.slice(0, HOT_MAX)
      })
      hotPending.set(platform, p)
    }
    return p
  }

  const normalize = (prefix: string) => [...prefix.trim()].slice(0, PREFIX_MAX).join('')
  const cachedSuggest = (platform: string, prefix: string) => suggestCache.get(`${platform}\n${normalize(prefix)}`)
  /** 同一平台同一前缀缓存 */
  async function suggest(platform: string, prefix: string): Promise<Keyword[] | null> {
    const q = normalize(prefix)
    const key = `${platform}\n${q}`
    const hit = suggestCache.get(key)
    if (hit) return hit
    const r = await guard(platform, () => keywordSuggest(platform, q, account(platform)))
    if (!r) return null
    const list = r.slice(0, SUGGEST_MAX)
    suggestCache.set(key, list)
    return list
  }

  return { support, hot, suggest, cachedHot, cachedSuggest }
})
