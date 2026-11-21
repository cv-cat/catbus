import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'
import { getUser } from '@/api/author'
import { isAbort } from '@/api/client'
import { MINE_TABS, isNested, listFolderItems, listFolders, listMine, type MineTab } from '@/api/mine'
import { MOCK_MINE } from '@/api/mock/mine'
import type { CatbusError, Envelope, Folder, Item, User } from '@/api/types'
import { closeOverlays, mineRoute, parseMinePath, type MineRoute } from './route'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'
import { useMteamStore, MTEAM_ID } from './mteam'
import { useSelectionStore } from './selection'
import { useSettingsStore } from './settings'

/** 一页全是重复时自动再翻，最多连续这么多页（同发现页） */
const MAX_EMPTY_PAGES = 3

/** 一个标签（或一个收藏夹）的分页列表 */
export interface MinePage {
  loading: boolean
  loadingMore: boolean
  error: CatbusError | null
  items: Item[]
  cursor: string | null
  hasMore: boolean
  loaded: boolean
  elapsed: number | null
  seen: Set<string>
}
interface FolderBlock {
  loading: boolean
  error: CatbusError | null
  data: Folder[] | null
}
const newPage = (): MinePage => ({ loading: false, loadingMore: false, error: null, items: [], cursor: null, hasMore: false, loaded: false, elapsed: null, seen: new Set() })
const netError = (e: unknown): CatbusError => ({ code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })
const failed = (env: Envelope<unknown>): CatbusError => env.error ?? { code: 'ERROR', message: '', hint: null, detail: null }

/**
 * 各平台的「我的」页（AGENTS.md 7.9「各平台的「我的」页」，设计稿 mine-desgin Z1–Z4、Z9）。
 * 地址见 stores/route 的 mineRoute；标签按注册表（/api/filters 的 mine）显示。
 * 每个标签（收藏夹、合集按每一个）的结果在本页会话里缓存，切回来不重新请求；刷新按钮只重新请求当前标签。
 */
export const useMineStore = defineStore('mine', () => {
  const discover = useDiscoverStore()
  const selection = useSelectionStore()
  const { settings } = useSettingsStore()

  const route = mineRoute
  const active = computed(() => route.value != null)
  const platform = computed(() => route.value?.platform ?? '')

  /** 平台「我的」页可用的标签；M-Team 有自己的页，不在这里 */
  function tabsOf(id: string): MineTab[] {
    if (id === MTEAM_ID) return []
    const caps = discover.filters?.[id]?.mine ?? (isDemo() ? MOCK_MINE[id] : undefined) ?? []
    return MINE_TABS.filter((t) => caps.includes(t))
  }
  /** 有「我的」页（含 M-Team 自己的那一页）：侧栏据此展开「发现 / 我的」 */
  const hasMine = (id: string) => id === MTEAM_ID || tabsOf(id).length > 0

  const tabs = computed(() => tabsOf(platform.value))
  /** 地址里的标签不可用时回到默认标签（第一个） */
  const tab = computed<MineTab | null>(() => {
    const want = route.value?.tab as MineTab | null | undefined
    return want && tabs.value.includes(want) ? want : (tabs.value[0] ?? null)
  })
  const sub = computed(() => (tab.value && isNested(tab.value) ? (route.value?.sub ?? null) : null))

  const account = () => (route.value ? (discover.accountFor(route.value.platform)?.account ?? null) : null)
  const hasAccount = computed(() => Boolean(route.value && discover.accounts.some((a) => a.platform === route.value!.platform)))
  /** 本页浏览用的账号已失效（「登录已失效」） */
  const expired = computed(() => {
    const a = route.value ? discover.accountFor(route.value.platform) : null
    return Boolean(a && discover.isExpired(a))
  })

  // ---------- 缓存 ----------
  const pages = reactive(new Map<string, MinePage>())
  const folders = reactive(new Map<string, FolderBlock>())
  const users = reactive(new Map<string, { loading: boolean; data: User | null }>())
  const base = () => JSON.stringify([platform.value, account()])
  const pageKey = (t: MineTab, s: string | null) => `${base()}|${t}|${s ?? ''}`
  const folderKey = (t: MineTab) => `${base()}|${t}`

  const page = computed<MinePage | null>(() => {
    const t = tab.value
    if (!t || (isNested(t) && !sub.value)) return null
    return pages.get(pageKey(t, sub.value)) ?? null
  })
  const folderList = computed<FolderBlock | null>(() => (tab.value && isNested(tab.value) ? (folders.get(folderKey(tab.value)) ?? null) : null))
  const header = computed(() => users.get(base()) ?? null)

  /** 同一时间只认当前这一轮：换了平台 / 账号、刷新时中止旧的请求 */
  let ctl = new AbortController()

  async function loadHeader(force = false) {
    const key = base()
    if (!force && users.has(key)) return
    const slot = reactive({ loading: true, data: users.get(key)?.data ?? null })
    users.set(key, slot)
    const signal = ctl.signal
    try {
      const env = await getUser(platform.value, 'me', account(), null, signal)
      if (env.ok && env.data) slot.data = env.data
    } catch {
      // 头部取不到不单独报错：只显示账号卡里的头像和昵称
    } finally {
      slot.loading = false
    }
  }

  async function loadPage(t: MineTab, s: string | null, append: boolean, emptyPages = 0): Promise<void> {
    const key = pageKey(t, s)
    let p = pages.get(key)
    if (!p || !append) {
      p = reactive(newPage()) as MinePage
      pages.set(key, p)
    }
    const cur = p
    if (cur.loading || cur.loadingMore) return
    const signal = ctl.signal
    const t0 = performance.now()
    append ? (cur.loadingMore = true) : (cur.loading = true)
    cur.error = null
    try {
      const opts = { cursor: append ? cur.cursor : null, limit: settings.pageSize, account: account(), signal }
      const env = isNested(t) ? await listFolderItems(platform.value, t, s!, opts) : await listMine(platform.value, t, opts)
      if (pages.get(key) !== cur) return
      if (!env.ok) {
        cur.error = failed(env)
        if (append) cur.hasMore = false
        return
      }
      const fresh: Item[] = []
      for (const it of env.data ?? []) {
        if (cur.seen.has(it.id)) continue
        cur.seen.add(it.id)
        fresh.push(it)
      }
      cur.items = append ? [...cur.items, ...fresh] : fresh
      cur.cursor = env.page?.cursor ?? null
      cur.hasMore = Boolean(env.page?.has_more && env.page.cursor)
      cur.loaded = true
      cur.elapsed = (performance.now() - t0) / 1000
      if (append && !fresh.length && cur.hasMore && emptyPages + 1 < MAX_EMPTY_PAGES) {
        cur.loadingMore = false
        return loadPage(t, s, true, emptyPages + 1)
      }
    } catch (e) {
      if (isAbort(e) || pages.get(key) !== cur) return
      cur.error = netError(e)
    } finally {
      cur.loading = cur.loadingMore = false
    }
  }

  async function loadFolders(t: 'folders' | 'series', force = false) {
    const key = folderKey(t)
    const old = folders.get(key)
    if (!force && old && (old.loading || old.data)) return
    const b = reactive<FolderBlock>({ loading: true, error: null, data: null })
    folders.set(key, b)
    try {
      const env = await listFolders(platform.value, t, account(), ctl.signal)
      if (folders.get(key) !== b) return
      if (env.ok) b.data = env.data ?? []
      else b.error = failed(env)
    } catch (e) {
      if (!isAbort(e) && folders.get(key) === b) b.error = netError(e)
    } finally {
      b.loading = false
    }
  }

  /** 按当前地址补齐数据（缓存里有就不请求） */
  function ensure() {
    const t = tab.value
    if (!route.value || !t || !hasAccount.value) return
    void loadHeader()
    if (isNested(t)) {
      void loadFolders(t)
      if (sub.value && !pages.get(pageKey(t, sub.value))?.loaded) void loadPage(t, sub.value, false)
    } else if (!pages.get(pageKey(t, null))?.loaded && !pages.get(pageKey(t, null))?.loading) {
      void loadPage(t, null, false)
    }
  }

  /** 刷新按钮：重新请求当前标签（收藏夹、合集连同列表），其余标签的缓存保留 */
  function refresh() {
    const t = tab.value
    if (!t) return
    ctl.abort()
    ctl = new AbortController()
    selection.none()
    void loadHeader(true)
    if (isNested(t)) {
      void loadFolders(t, true)
      if (sub.value) void loadPage(t, sub.value, false)
    } else void loadPage(t, null, false)
  }

  function loadMore() {
    const t = tab.value
    const p = page.value
    if (!t || !p || p.loading || p.loadingMore || !p.hasMore) return
    void loadPage(t, sub.value, true)
  }

  // ---------- 地址 ----------
  function toUrl(r: MineRoute): string {
    const parts: string[] = []
    if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
    const tabs = tabsOf(r.platform)
    if (r.tab && r.tab !== tabs[0]) parts.push(`tab=${r.tab}`)
    if (r.sub && (r.tab === 'folders' || r.tab === 'series')) parts.push(`${r.tab === 'folders' ? 'folder' : 'series'}=${encodeURIComponent(r.sub)}`)
    return `/${encodeURIComponent(r.platform)}/me${parts.length ? `?${parts.join('&')}` : ''}`
  }
  function go(r: MineRoute, replace = false) {
    const next = toUrl(r)
    route.value = r
    if (next !== location.pathname + location.search) (replace ? history.replaceState : history.pushState).call(history, null, '', next)
    ensure()
  }

  /** 侧栏或分段点了「我的」：M-Team 进它自己的页，其余进这一页 */
  function open(id: string) {
    if (id === MTEAM_ID) return useMteamStore().open()
    if (!tabsOf(id).length) return
    if (route.value?.platform === id) return
    closeOverlays()
    selection.none()
    go({ platform: id, tab: null, sub: null })
  }
  function leave() {
    if (!route.value) return
    route.value = null
    selection.none()
  }
  function setTab(next: MineTab) {
    const r = route.value
    if (!r || tab.value === next) return
    selection.none()
    go({ platform: r.platform, tab: next, sub: null })
  }
  /** 点开一个收藏夹 / 合集；`replace` 用于桌面上默认选中第一个（不多出一条历史） */
  function setSub(id: string | null, replace = false) {
    const r = route.value
    const t = tab.value
    if (!r || !t || !isNested(t) || sub.value === id) return
    selection.none()
    go({ platform: r.platform, tab: t, sub: id }, replace)
  }

  addEventListener('popstate', () => {
    const r = parseMinePath()
    if (!r) return void leave()
    route.value = r
    selection.none()
    ensure()
  })

  // 发现页换了平台（侧栏点了别的渠道、进了聚合）：离开
  watch(
    () => discover.state.platform,
    (p) => route.value && p !== route.value.platform && leave(),
  )
  // 账号读到之后（打开页面时）、换了浏览账号、登录后：按新账号补齐
  watch([account, hasAccount, () => discover.filters], () => route.value && ensure())

  const busy = computed(() => Boolean(page.value?.loading || folderList.value?.loading))
  /** 详情卡片翻页：当前列表 */
  const current = computed<Item[]>(() => page.value?.items ?? [])

  return {
    route,
    active,
    platform,
    tabs,
    tab,
    sub,
    page,
    folderList,
    header,
    current,
    busy,
    hasAccount,
    expired,
    account,
    tabsOf,
    hasMine,
    open,
    leave,
    setTab,
    setSub,
    refresh,
    ensure,
    loadMore,
    loadFolders,
  }
})

/** 列表为空、还没请求过时的骨架判断 */
export const pending = (p: MinePage | null) => !p || (!p.loaded && !p.error)
