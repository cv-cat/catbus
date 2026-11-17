import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import type { CatbusError, Envelope, Gift, Item, Rank } from '@/api/types'
import { listLiveGifts, listLiveProducts, listLiveRank, listLiveReplays } from '@/api/live'
import { useDiscoverStore } from './discover'
import { useSettingsStore } from './settings'
import { useLiveStore } from './live'

/**
 * 直播间标签（AGENTS.md 7.9「直播弹幕」的「直播间标签」）：弹幕之外的礼物、榜单、带货商品、回放。
 * 切到标签时才请求，结果按「平台 + 直播间」在本页会话里缓存。
 */
export const LIVE_TABS = ['chat', 'gifts', 'rank', 'products', 'replays'] as const
export type LiveTab = (typeof LIVE_TABS)[number]
type DataTab = Exclude<LiveTab, 'chat'>

export interface TabState<T> {
  data: T[]
  loading: boolean
  error: CatbusError | null
  loaded: boolean
  cursor: string | null
  hasMore: boolean
}
const fresh = <T>(): TabState<T> => ({ data: [], loading: false, error: null, loaded: false, cursor: null, hasMore: false })

export const useLiveTabsStore = defineStore('liveTabs', () => {
  const discover = useDiscoverStore()
  const live = useLiveStore()
  const { settings } = useSettingsStore()

  const tab = ref<LiveTab>('chat')
  const room = computed(() => live.route?.room ?? '')
  /** 回放的 <user>：直播间头部的主播 */
  const host = computed(() => live.header?.host?.url || live.header?.host?.id || '')

  const tabs = computed<LiveTab[]>(() => {
    const f = discover.filters?.[live.platform]
    const out: LiveTab[] = ['chat']
    if (f?.liveGifts) out.push('gifts')
    if (f?.liveRank) out.push('rank')
    if (f?.liveProducts) out.push('products')
    if (f?.liveReplays && host.value) out.push('replays')
    return out
  })

  const cache = reactive(new Map<string, TabState<Gift | Rank | Item>>())
  const keyOf = (t: DataTab) => `${live.platform}\n${t === 'replays' ? `u:${host.value}` : `r:${room.value}`}\n${t}`
  function state(t: DataTab): TabState<Gift | Rank | Item> | null {
    return cache.get(keyOf(t)) ?? null
  }

  async function load(t: DataTab, append = false) {
    const p = live.platform
    const k = keyOf(t)
    if (!p || !room.value) return
    if (!cache.has(k)) cache.set(k, fresh())
    const st = cache.get(k)!
    if (st.loading || (append && !st.hasMore)) return
    st.loading = true
    if (!append) st.error = null
    const acc = live.account()
    let env: Envelope<(Gift | Rank | Item)[]>
    try {
      if (t === 'gifts') env = await listLiveGifts(p, room.value, acc)
      else if (t === 'rank') env = await listLiveRank(p, room.value, acc)
      else if (t === 'products') env = await listLiveProducts(p, room.value, acc)
      else env = await listLiveReplays(p, host.value, { account: acc, limit: settings.pageSize, cursor: append ? st.cursor : null })
    } catch (e) {
      st.loading = false
      st.error = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
      return
    }
    st.loading = false
    if (!env.ok) {
      st.error = env.error
      return
    }
    st.data = append ? st.data.concat(env.data ?? []) : (env.data ?? [])
    st.cursor = env.page?.cursor ?? null
    st.hasMore = Boolean(env.page?.has_more && env.page.cursor)
    st.loaded = true
  }

  function select(t: LiveTab) {
    tab.value = t
    if (t === 'chat') return
    const st = state(t)
    if (!st || (!st.loaded && !st.loading && !st.error)) void load(t)
  }
  function refresh(t: DataTab) {
    cache.delete(keyOf(t))
    void load(t)
  }

  // 换直播间、换平台：回到弹幕标签
  watch(() => `${live.platform}\n${room.value}`, () => (tab.value = 'chat'))
  // 标签不再可用（如回放要的主播还没取到）：回到弹幕
  watch(tabs, (list) => !list.includes(tab.value) && (tab.value = 'chat'))

  return { tab, tabs, state, load, select, refresh }
})
