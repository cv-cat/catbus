import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { Category, CatbusError, Envelope, Live } from '@/api/types'
import { listLiveCategories, listLives, searchLives } from '@/api/live'
import { isAbort } from '@/api/client'
import { useDiscoverStore } from './discover'
import { useSettingsStore } from './settings'
import { useLiveStore } from './live'

/**
 * 直播页的发现直播间（AGENTS.md 7.9「直播弹幕」的「发现直播间」）：推荐列表（`live list`，可按分类）、
 * 搜索（`live search`）、分类 chip（`live categories`）。结果按「平台 + 分类或关键词」在本页会话里缓存。
 */
export interface LiveList {
  items: Live[]
  cursor: string | null
  hasMore: boolean
  loading: boolean
  error: CatbusError | null
  loaded: boolean
}

const fresh = (): LiveList => ({ items: [], cursor: null, hasMore: false, loading: false, error: null, loaded: false })

export const useLiveDiscoverStore = defineStore('liveDiscover', () => {
  const discover = useDiscoverStore()
  const live = useLiveStore()
  const { settings } = useSettingsStore()

  const caps = (p: string) => discover.filters?.[p] ?? null
  const platform = computed(() => live.platform)
  const canList = computed(() => Boolean(caps(platform.value)?.liveList))
  const canSearch = computed(() => Boolean(caps(platform.value)?.liveSearch))
  const canCategories = computed(() => Boolean(caps(platform.value)?.liveCategories))
  /** 平台有哪一样都没有：不显示「发现直播间」 */
  const available = computed(() => canList.value || canSearch.value)

  /** 输入框里的关键词与已提交的关键词 */
  const input = ref('')
  const query = ref('')
  const category = ref<string | null>(null)

  const categories = shallowRef<Category[]>([])
  const catCache = new Map<string, Category[]>()
  const lists = reactive(new Map<string, LiveList>())

  const key = computed(() => `${platform.value}\n${query.value ? `s:${query.value}` : `c:${category.value ?? ''}`}`)
  const current = computed<LiveList | null>(() => lists.get(key.value) ?? null)
  /** 没搜索时、平台又没有推荐列表：只写一句提示 */
  const needQuery = computed(() => !query.value && !canList.value)

  let ac: AbortController | null = null

  async function load(append = false) {
    const p = platform.value
    if (!p || needQuery.value) return
    const k = key.value
    let st = lists.get(k)
    if (!st) {
      lists.set(k, fresh())
      st = lists.get(k)!
    }
    if (st.loading || (append && !st.hasMore)) return
    ac?.abort()
    const ctl = (ac = new AbortController())
    st.loading = true
    if (!append) st.error = null
    const opts = { account: live.account(), limit: settings.pageSize, cursor: append ? st.cursor : null, signal: ctl.signal }
    let env: Envelope<Live[]>
    try {
      env = query.value ? await searchLives(p, query.value, opts) : await listLives(p, category.value, opts)
    } catch (e) {
      st.loading = false
      if (isAbort(e)) return
      st.error = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
      return
    }
    st.loading = false
    if (ctl.signal.aborted) return
    if (!env.ok) {
      // 第一页出错时清掉旧结果，只显示错误；翻页出错保留已有的
      if (!append) st.items = []
      st.error = env.error
      st.hasMore = false
      st.loaded = true
      return
    }
    const seen = new Set(append ? st.items.map((x) => x.id) : [])
    const got = (env.data ?? []).filter((x) => !seen.has(x.id))
    st.items = append ? st.items.concat(got) : got
    st.cursor = env.page?.cursor ?? null
    st.hasMore = Boolean(env.page?.has_more && env.page.cursor)
    st.loaded = true
  }

  /** 进入页面、换分类、换关键词：有缓存就直接用 */
  function ensure() {
    if (!available.value) return
    if (canCategories.value) void loadCategories()
    const st = lists.get(key.value)
    if (!st || (!st.loaded && !st.loading)) void load()
  }

  function refresh() {
    lists.delete(key.value)
    void load()
  }

  async function loadCategories() {
    const p = platform.value
    const hit = catCache.get(p)
    if (hit) return void (categories.value = hit)
    categories.value = []
    try {
      const env = await listLiveCategories(p, live.account())
      if (env.ok && env.data) {
        catCache.set(p, env.data)
        if (platform.value === p) categories.value = env.data
      }
    } catch {
      // 取不到分类时不显示 chip
    }
  }

  function submit() {
    const kw = input.value.trim()
    if (kw && !canSearch.value) return
    query.value = kw
    ensure()
  }
  function clearQuery() {
    input.value = ''
    query.value = ''
    ensure()
  }
  function pick(id: string | null) {
    category.value = id
    query.value = ''
    input.value = ''
    ensure()
  }

  // 换平台：关键词、分类复位
  watch(platform, () => {
    ac?.abort()
    input.value = query.value = ''
    category.value = null
    categories.value = catCache.get(platform.value) ?? []
  })

  return { platform, canList, canSearch, canCategories, available, input, query, category, categories, current, needQuery, load, ensure, refresh, submit, clearQuery, pick }
})
