import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import { isAbort } from '@/api/client'
import {
  SEED_STATUSES,
  bonusHistory,
  bonusRate,
  collects,
  exams,
  seedList,
  seedStats,
  type MteamMode,
  type SeedStatus,
} from '@/api/mteam'
import type { BonusRate, BonusRecord, CatbusError, Envelope, Exam, Item, SeedStats } from '@/api/types'
import { authorRoute, isMePath, meActive, railActive } from './route'
import { useDiscoverStore } from './discover'
import { useSelectionStore } from './selection'
import { useSettingsStore } from './settings'

/**
 * M-Team「我的」页（AGENTS.md 7.9「M-Team「我的」页与筛选」）：地址 `/mteam/me[?tab=<status>]`。
 * 进入页面时各块各自请求一次，之后只在点刷新时重新请求（不轮询）；各块各自加载、各自出错。
 */

export const MTEAM_ID = 'mteam'

/** 一块只取一次的数据 */
export interface Block<T> {
  loading: boolean
  error: CatbusError | null
  data: T | null
}
/** 一块分页列表 */
export interface Paged<T> {
  loading: boolean
  loadingMore: boolean
  error: CatbusError | null
  items: T[]
  cursor: string | null
  hasMore: boolean
  /** 拿到过第一页 */
  loaded: boolean
}
const block = <T>(): Block<T> => ({ loading: false, error: null, data: null })
const paged = <T>(): Paged<T> => ({ loading: false, loadingMore: false, error: null, items: [], cursor: null, hasMore: false, loaded: false })
const netError = (e: unknown): CatbusError => ({ code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })
const failed = (env: Envelope<unknown>): CatbusError => env.error ?? { code: 'ERROR', message: '', hint: null, detail: null }

function tabFromUrl(): SeedStatus {
  const v = new URLSearchParams(location.search).get('tab') as SeedStatus | null
  return v && SEED_STATUSES.includes(v) ? v : 'seeding'
}
function toUrl(tab: SeedStatus): string {
  const parts: string[] = []
  if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
  if (tab !== 'seeding') parts.push(`tab=${tab}`)
  return `/mteam/me${parts.length ? `?${parts.join('&')}` : ''}`
}

export const useMteamStore = defineStore('mteam', () => {
  const d = useDiscoverStore()
  const selection = useSelectionStore()
  const { settings } = useSettingsStore()
  const active = meActive

  const tab = ref<SeedStatus>(tabFromUrl())
  const collectsMode = ref<MteamMode>('normal')
  /** 魔力流水只看魔力有变动的（页面里过滤，不改请求） */
  const onlyChange = ref(false)

  const stats = reactive(block<SeedStats>())
  const rate = reactive(block<BonusRate>())
  const exam = reactive(block<Exam[]>())
  /** 我的种子：每个分段一份（切回来不重新请求，刷新时全部丢掉） */
  const seeds = reactive(new Map<SeedStatus, Paged<Item>>())
  const bonus = reactive(paged<BonusRecord>())
  const fav = reactive(paged<Item>())

  const updatedAt = ref<Date | null>(null)
  const elapsed = ref<number | null>(null)
  let t0 = 0
  /** 每轮刷新一个取消器：再点刷新、离开页面时中止旧的 */
  let ctl = new AbortController()
  let round = 0

  /** M-Team 本页浏览用的第一个账号；没有账号时为 null（整页提示登录） */
  const account = computed(() => d.accountFor(MTEAM_ID))
  const hasAccount = computed(() => d.accounts.some((a) => a.platform === MTEAM_ID && a.endpoint === 'web'))
  const accountName = () => account.value?.account ?? null

  /** 一次刷新里还在加载的块数：都结束时记下更新时间和耗时 */
  let pending = 0
  function track<T>(p: Promise<T>): Promise<T> {
    pending++
    const r = round
    return p.finally(() => {
      if (r !== round) return
      if (--pending === 0) {
        updatedAt.value = new Date()
        elapsed.value = (performance.now() - t0) / 1000
      }
    })
  }

  async function loadBlock<T>(b: Block<T>, fetcher: (s: AbortSignal) => Promise<Envelope<T>>) {
    const r = round
    const signal = ctl.signal
    b.loading = true
    b.error = null
    try {
      const env = await fetcher(signal)
      if (r !== round) return
      if (env.ok) b.data = env.data
      else b.error = failed(env)
    } catch (e) {
      if (r !== round || isAbort(e)) return
      b.error = netError(e)
    } finally {
      if (r === round) b.loading = false
    }
  }

  async function loadPage<T>(p: Paged<T>, fetcher: (cursor: string | null, s: AbortSignal) => Promise<Envelope<T[]>>, append: boolean) {
    if (append && (p.loadingMore || p.loading || !p.hasMore || p.error)) return
    const r = round
    const signal = ctl.signal
    if (append) p.loadingMore = true
    else {
      p.loading = true
      p.error = null
    }
    try {
      const env = await fetcher(append ? p.cursor : null, signal)
      if (r !== round) return
      if (!env.ok) {
        p.error = failed(env)
        if (!append) {
          p.items = []
          p.hasMore = false
        }
        return
      }
      const got = env.data ?? []
      p.items = append ? [...p.items, ...got] : got
      p.cursor = env.page?.cursor ?? null
      p.hasMore = !!(env.page?.has_more && env.page.cursor)
      p.loaded = true
    } catch (e) {
      if (r !== round || isAbort(e)) return
      p.error = netError(e)
      if (append) p.hasMore = false
    } finally {
      if (r === round) p.loading = p.loadingMore = false
    }
  }

  const limit = () => settings.pageSize
  function seedsOf(status: SeedStatus): Paged<Item> {
    let p = seeds.get(status)
    if (!p) {
      seeds.set(status, paged<Item>())
      p = seeds.get(status)!
    }
    return p
  }

  const loadSeeds = (status: SeedStatus, append = false) =>
    loadPage(seedsOf(status), (c, s) => seedList(status, limit(), c, accountName(), s), append)
  const loadBonus = (append = false) => loadPage(bonus, (c, s) => bonusHistory(limit(), c, accountName(), s), append)
  const loadFav = (append = false) => loadPage(fav, (c, s) => collects(collectsMode.value, limit(), c, accountName(), s), append)

  /** 进入页面或点刷新：各块全部（重新）请求 */
  function refresh() {
    ctl.abort()
    ctl = new AbortController()
    round++
    pending = 0
    t0 = performance.now()
    if (!hasAccount.value) return
    // 刷新时其他分段的种子丢掉，切过去时再请求
    for (const k of [...seeds.keys()]) if (k !== tab.value) seeds.delete(k)
    void track(loadBlock(stats, (s) => seedStats(accountName(), s)))
    void track(loadBlock(rate, (s) => bonusRate(accountName(), s)))
    void track(loadBlock(exam, (s) => exams(accountName(), s)))
    void track(loadSeeds(tab.value))
    void track(loadBonus())
    void track(loadFav())
  }
  const started = ref(false)
  function ensureLoaded() {
    if (started.value || !hasAccount.value) return
    started.value = true
    refresh()
  }

  /** 加载中（任一块） */
  const busy = computed(
    () =>
      stats.loading ||
      rate.loading ||
      exam.loading ||
      bonus.loading ||
      fav.loading ||
      [...seeds.values()].some((p) => p.loading),
  )

  /** 全部失败且是同一种原因时整页报错（「重试」「去登录」） */
  const pageError = computed<CatbusError | null>(() => {
    const cur = seeds.get(tab.value)
    const errs = [stats.error, rate.error, exam.error, cur?.error ?? null, bonus.error, fav.error]
    if (busy.value || errs.some((e) => !e)) return null
    return errs.every((e) => e!.code === errs[0]!.code) ? errs[0]! : null
  })

  function setTab(next: SeedStatus) {
    if (tab.value === next) return
    tab.value = next
    pushUrl()
    if (!seeds.get(next)?.loaded) void loadSeeds(next)
  }
  function setCollectsMode(m: MteamMode) {
    if (collectsMode.value === m) return
    collectsMode.value = m
    void loadFav()
  }

  function pushUrl() {
    const next = toUrl(tab.value)
    if (next !== location.pathname + location.search) history.pushState(null, '', next)
  }

  /** 侧栏或分段点了「我的」：进入（作者页、查询页一并收起） */
  function open() {
    if (active.value) return
    authorRoute.value = null
    railActive.value = false
    selection.none()
    active.value = true
    pushUrl()
    ensureLoaded()
  }
  /** 回到发现页：发现页随后的搜索写回自己的地址 */
  function leave() {
    active.value = false
  }

  // 前进 / 后退：地址是「我的」页就按地址恢复分段，否则离开
  addEventListener('popstate', () => {
    if (!isMePath()) return void (active.value = false)
    active.value = true
    const next = tabFromUrl()
    if (next !== tab.value) {
      tab.value = next
      if (!seeds.get(next)?.loaded) void loadSeeds(next)
    }
    ensureLoaded()
  })

  // 关掉成人分区时，收藏停在成人分区的回到综合
  const adultOff = computed(() => !settings.mteamAdult)
  const seedTotal = (status: SeedStatus): number | null =>
    status === 'seeding' ? (stats.data?.seeding ?? null) : status === 'leeching' ? (stats.data?.leeching ?? null) : null

  /** 魔力流水（按开关过滤） */
  const bonusShown = computed(() => (onlyChange.value ? bonus.items.filter((r) => r.change != null && r.change !== 0) : bonus.items))

  const seedPage = computed(() => seedsOf(tab.value))
  /** 详情卡片用的条目（我的种子、收藏、魔力流水的相关种子） */
  const detailItem = shallowRef<Item | null>(null)

  return {
    active,
    tab,
    collectsMode,
    onlyChange,
    stats,
    rate,
    exam,
    seeds,
    seedPage,
    bonus,
    bonusShown,
    fav,
    updatedAt,
    elapsed,
    busy,
    pageError,
    hasAccount,
    account,
    adultOff,
    seedTotal,
    detailItem,
    refresh,
    ensureLoaded,
    setTab,
    setCollectsMode,
    loadSeeds,
    loadBonus,
    loadFav,
    retryBlock: (which: 'stats' | 'rate' | 'exam') => {
      if (which === 'stats') void loadBlock(stats, (s) => seedStats(accountName(), s))
      else if (which === 'rate') void loadBlock(rate, (s) => bonusRate(accountName(), s))
      else void loadBlock(exam, (s) => exams(accountName(), s))
    },
    open,
    leave,
  }
})
