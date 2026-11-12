import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { getUser, listUserItems } from '@/api/author'
import { isAbort, loadFilters } from '@/api/client'
import type { CatbusError, Item, User, UserRef } from '@/api/types'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'
import { useSelectionStore } from './selection'
import { useSettingsStore } from './settings'
import { authorPath, authorRoute, parseAuthorPath, type AuthorRoute } from './route'

/** 一页全是重复时自动再翻，最多连续这么多页（同发现页） */
const MAX_EMPTY_PAGES = 3

/** history.state 里的标记：这一条作者页是从本页 pushState 进来的，返回按钮可以直接后退 */
const PUSHED = 'catbusAuthor'

/**
 * 作者页（AGENTS.md 7.9「作者页」，设计稿 P / P2 / P3 / P4）：`user get` 取作者，`user items` 取作品（分页）。
 * 地址见 stores/route；发现页保持挂载、在后台不动，后退时原样恢复。
 */
export const useAuthorStore = defineStore('author', () => {
  const discover = useDiscoverStore()
  const selection = useSelectionStore()
  const { settings } = useSettingsStore()

  /** 各平台能不能做站内作者页（注册表里 user get、user items 都已实现）；读不到时为 null */
  const caps = shallowRef<Record<string, boolean> | null>(null)
  async function initCaps() {
    const all = await loadFilters()
    caps.value = all ? Object.fromEntries(Object.entries(all).map(([id, f]) => [id, Boolean(f.author)])) : null
  }
  /** 平台的作者能不能点进作者页；读不到能力时只在演示模式下放行（演示数据不访问平台） */
  const canOpen = (platform: string) => (caps.value ? Boolean(caps.value[platform]) : isDemo())

  /** 作者页用的 `<user>`：url 优先（小红书的链接带 xsec_token），否则 id */
  const refOf = (u: UserRef | null | undefined) => (u?.url || u?.id || '').trim() || null

  const route = authorRoute
  const active = computed(() => route.value != null)
  /** 点进来时卡片上的作者（演示数据沿用它的昵称和头像） */
  let hint: UserRef | null = null

  const user = shallowRef<User | null>(null)
  const userLoading = ref(false)
  const items = shallowRef<Item[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<CatbusError | null>(null)
  const cursor = ref<string | null>(null)
  const hasMore = ref(false)
  const elapsed = ref<number | null>(null)
  /** 已加载的是哪位作者、用哪个账号（换了才重新请求） */
  let loadedKey: string | null = null
  let seq = 0
  /**
   * 这一位作者（seq）的请求共用的取消器：换了作者 / 账号、重新加载时中止旧的（结果反正要丢），
   * bridge 随之结束子进程。翻页沿用当前这一轮的；离开作者页不取消（回来时同一位作者不重新请求）。
   */
  let ctl = new AbortController()
  let seen = new Set<string>()

  const account = () => (route.value ? (discover.accountFor(route.value.platform)?.account ?? null) : null)
  const keyOf = (r: AuthorRoute) => JSON.stringify([r.platform, r.user, account()])

  async function loadUser(r: AuthorRoute, id: number) {
    userLoading.value = true
    try {
      const env = await getUser(r.platform, r.user, account(), hint, ctl.signal)
      if (id !== seq) return
      if (env.ok && env.data) user.value = env.data
      // 作者取不到不单独报错：作品列表出错时整页报错；作品能取到时头部退回卡片上的作者
      else if (!user.value && hint) user.value = fromRef(hint)
    } catch (e) {
      if (id === seq && !isAbort(e) && !user.value && hint) user.value = fromRef(hint)
    } finally {
      if (id === seq) userLoading.value = false
    }
  }

  async function loadItems(r: AuthorRoute, id: number, append: boolean, emptyPages = 0): Promise<void> {
    const t0 = performance.now()
    append ? (loadingMore.value = true) : (loading.value = true)
    try {
      const env = await listUserItems(r.platform, r.user, {
        cursor: append ? cursor.value : null,
        limit: settings.pageSize,
        account: account(),
        hint,
        signal: ctl.signal,
      })
      if (id !== seq) return
      if (!env.ok) {
        error.value = env.error
        if (append) hasMore.value = false
        else items.value = []
        return
      }
      const fresh: Item[] = []
      for (const it of env.data ?? []) {
        if (seen.has(it.id)) continue
        seen.add(it.id)
        fresh.push(it)
      }
      items.value = append ? [...items.value, ...fresh] : fresh
      cursor.value = env.page?.cursor ?? null
      hasMore.value = Boolean(env.page?.has_more && env.page.cursor)
      elapsed.value = (performance.now() - t0) / 1000
      if (append && !fresh.length && hasMore.value && emptyPages + 1 < MAX_EMPTY_PAGES) {
        return loadItems(r, id, true, emptyPages + 1)
      }
    } catch (e) {
      if (id !== seq || isAbort(e)) return
      error.value = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
    } finally {
      if (id === seq) loading.value = loadingMore.value = false
    }
  }

  /** 加载当前地址上的作者（作者和第一页作品并行请求）；`force` 时即使已加载过也重新请求 */
  function load(force = false) {
    const r = route.value
    if (!r) return
    const key = keyOf(r)
    if (!force && key === loadedKey) return
    loadedKey = key
    const id = ++seq
    ctl.abort()
    ctl = new AbortController()
    // 换了作者：清空旧数据，显示骨架；同一位作者重新请求（登录后、换账号）时保留头部
    const same = user.value && refOf(user.value) === r.user
    if (!same) user.value = null
    items.value = []
    cursor.value = null
    hasMore.value = false
    elapsed.value = null
    error.value = null
    seen = new Set()
    selection.none()
    void loadUser(r, id)
    void loadItems(r, id, false)
  }

  const loadMore = () => {
    const r = route.value
    if (!r || loading.value || loadingMore.value || !hasMore.value) return
    void loadItems(r, seq, true)
  }

  /** 进入作者页：pushState，后退回到原来的发现页 */
  function open(platform: string, author: UserRef | null | undefined): boolean {
    const ref = refOf(author)
    if (!ref || !canOpen(platform)) return false
    hint = author ?? null
    const r = { platform, user: ref }
    history.pushState({ [PUSHED]: true }, '', authorPath(r))
    route.value = r
    load()
    return true
  }

  /** 回到发现页：从本页进来的直接后退（发现页原样恢复）；直接打开的作者页改写成发现页的地址 */
  function back() {
    if (history.state?.[PUSHED]) return history.back()
    leave()
    history.pushState(null, '', discover.discoverUrl() ?? '/')
  }

  /** 离开作者页（发现页接着往地址栏写自己的地址） */
  function leave() {
    if (!route.value) return
    route.value = null
    selection.none()
  }

  /** 在作者页提交搜索：回到发现页，用这个关键词搜索 */
  function search(keyword: string) {
    leave()
    discover.state.keyword = keyword
    document.querySelector('.discover')?.scrollTo({ top: 0 })
    discover.search()
  }

  // 浏览器前进 / 后退：地址是作者页就显示（换了作者才请求），否则回到发现页
  addEventListener('popstate', () => {
    const r = parseAuthorPath()
    const was = route.value
    if (!r) return void (was && leave())
    if (!was || was.platform !== r.platform || was.user !== r.user) {
      hint = null
      route.value = r
      selection.none()
    }
    load()
  })

  // 作者页上在侧栏点了渠道（或聚合模式里加、减渠道）：回到发现页；发现页随后的搜索会写回自己的地址
  watch(
    () => [discover.state.platform, discover.selected.join(',')],
    () => {
      if (!route.value) return
      leave()
      discover.search()
    },
  )
  // 换了浏览账号：用新账号重新请求
  watch(account, () => route.value && load())

  return {
    route,
    active,
    user,
    userLoading,
    items,
    loading,
    loadingMore,
    error,
    hasMore,
    elapsed,
    caps,
    initCaps,
    canOpen,
    refOf,
    account,
    open,
    back,
    search,
    load,
    loadMore,
  }
})

/** 作者接口取不到时，用卡片上的作者撑起头部（没有简介和计数） */
function fromRef(u: UserRef): User {
  return {
    id: u.id,
    name: u.name,
    handle: null,
    avatar: u.avatar ?? null,
    url: u.url,
    bio: null,
    stats: { followers: null, following: null, items: null, likes: null },
  }
}
