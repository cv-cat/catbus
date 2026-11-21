import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'
import { isAbort } from '@/api/client'
import { INBOX_TABS, NOTICE_TYPES, getNoticeCount, listConversations, listMessages, listNotices, type InboxTab, type NoticeType, type PageOpts } from '@/api/inbox'
import { MOCK_INBOX } from '@/api/mock/inbox'
import type { CatbusError, Conversation, Envelope, Message, Notice, NoticeCount } from '@/api/types'
import { closeOverlays, inboxRoute, parseInboxPath, type InboxRoute } from './route'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'
import { useSettingsStore } from './settings'

/** 一页全是重复时自动再翻，最多连续这么多页（同发现页） */
const MAX_EMPTY_PAGES = 3

/** 一个分页列表（通知、会话、一个会话的消息） */
export interface InboxList<T> {
  loading: boolean
  loadingMore: boolean
  error: CatbusError | null
  items: T[]
  cursor: string | null
  hasMore: boolean
  loaded: boolean
  elapsed: number | null
  seen: Set<string>
}
const newList = <T>(): InboxList<T> => ({ loading: false, loadingMore: false, error: null, items: [], cursor: null, hasMore: false, loaded: false, elapsed: null, seen: new Set() })
const netError = (e: unknown): CatbusError => ({ code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })
const failed = (env: Envelope<unknown>): CatbusError => env.error ?? { code: 'ERROR', message: '', hint: null, detail: null }

const NO_CAPS = { notices: false, count: false, messages: false }

/** 消息按时间从早到晚；有消息没有时间时保持平台给的顺序 */
export function orderMessages(list: Message[]): Message[] {
  const ts = list.map((m) => (m.created_at ? Date.parse(m.created_at) : NaN))
  if (ts.some((v) => Number.isNaN(v))) return list
  return list.map((m, i) => [m, ts[i]!, i] as const).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([m]) => m)
}

/**
 * 收件箱（AGENTS.md 7.9「通知与私信」）：通知、私信，全部只读。
 * 地址见 stores/route 的 inboxRoute；各列表在本页会话里按「平台 + 账号（+ 会话）」缓存。
 * 未读角标（notice count）只在第一次选中渠道、进入收件箱、点刷新时请求，不轮询。
 */
export const useInboxStore = defineStore('inbox', () => {
  const discover = useDiscoverStore()
  const { settings } = useSettingsStore()

  const route = inboxRoute
  const active = computed(() => route.value != null)
  const platform = computed(() => route.value?.platform ?? '')

  function caps(id: string) {
    return discover.filters?.[id]?.inbox ?? (isDemo() ? MOCK_INBOX[id] : undefined) ?? NO_CAPS
  }
  /** 有收件箱：通知或私信至少有一个；只有 notice count 的平台没有 */
  const hasInbox = (id: string) => caps(id).notices || caps(id).messages
  const tabsOf = (id: string): InboxTab[] => INBOX_TABS.filter((t) => (t === 'notices' ? caps(id).notices : caps(id).messages))

  const tabs = computed(() => tabsOf(platform.value))
  const tab = computed<InboxTab | null>(() => {
    const want = route.value?.tab as InboxTab | null | undefined
    return want && tabs.value.includes(want) ? want : (tabs.value[0] ?? null)
  })
  const type = computed<NoticeType | null>(() => {
    const v = route.value?.type as NoticeType | null | undefined
    return v && NOTICE_TYPES.includes(v) ? v : null
  })
  const conv = computed(() => (tab.value === 'messages' ? (route.value?.conv ?? null) : null))

  const accountOf = (id: string) => discover.accountFor(id)?.account ?? null
  const account = () => (route.value ? accountOf(route.value.platform) : null)
  const hasAccountFor = (id: string) => discover.accounts.some((a) => a.platform === id)
  const hasAccount = computed(() => Boolean(route.value && hasAccountFor(route.value.platform)))
  const expired = computed(() => {
    const a = route.value ? discover.accountFor(route.value.platform) : null
    return Boolean(a && discover.isExpired(a))
  })
  /** 当前账号的用户 id：自己发的消息靠右 */
  const myId = computed(() => (route.value ? (discover.accountFor(route.value.platform)?.user?.id ?? null) : null))

  // ---------- 未读角标 ----------
  const counts = reactive(new Map<string, { loading: boolean; data: NoticeCount | null }>())
  const countKey = (id: string) => JSON.stringify([id, accountOf(id)])
  async function loadCount(id: string, force = false) {
    if (!caps(id).count || !hasAccountFor(id)) return
    const key = countKey(id)
    const old = counts.get(key)
    if (old?.loading || (old && !force)) return
    const slot = reactive({ loading: true, data: old?.data ?? null })
    counts.set(key, slot)
    try {
      const env = await getNoticeCount(id, accountOf(id))
      // 取不到时不显示角标，也不提示
      slot.data = env.ok ? env.data : null
    } catch {
      slot.data = null
    } finally {
      slot.loading = false
    }
  }
  const countOf = (id: string): NoticeCount | null => counts.get(countKey(id))?.data ?? null
  /** 侧栏「收件箱」子项的角标：未读通知总数 */
  const badge = (id: string) => countOf(id)?.total ?? 0

  // ---------- 列表缓存 ----------
  const notices = reactive(new Map<string, InboxList<Notice>>())
  const convs = reactive(new Map<string, InboxList<Conversation>>())
  const msgs = reactive(new Map<string, InboxList<Message>>())
  const base = () => JSON.stringify([platform.value, account()])
  const msgKey = (c: string) => `${base()}|${c}`

  const noticeList = computed(() => notices.get(base()) ?? null)
  const convList = computed(() => convs.get(base()) ?? null)
  const msgList = computed(() => (conv.value ? (msgs.get(msgKey(conv.value)) ?? null) : null))
  const curConv = computed(() => convList.value?.items.find((c) => c.id === conv.value) ?? null)

  /** 通知按类型过滤：只作用于已经加载的 */
  const shownNotices = computed(() => {
    const all = noticeList.value?.items ?? []
    return type.value ? all.filter((n) => n.type === type.value) : all
  })

  /** 同一时间只认当前这一轮：刷新、换了平台 / 账号时中止旧的请求 */
  let ctl = new AbortController()

  type Fetch<T> = (o: PageOpts) => Promise<Envelope<T[]>>
  async function loadList<T extends { id: string }>(
    map: Map<string, InboxList<T>>,
    key: string,
    fetch: Fetch<T>,
    append: boolean,
    merge: (old: T[], fresh: T[]) => T[] = (old, fresh) => [...old, ...fresh],
    emptyPages = 0,
  ): Promise<void> {
    let l = map.get(key)
    if (!l || !append) {
      l = reactive(newList<T>()) as InboxList<T>
      map.set(key, l)
    }
    const cur = l
    if (cur.loading || cur.loadingMore) return
    const signal = ctl.signal
    const t0 = performance.now()
    append ? (cur.loadingMore = true) : (cur.loading = true)
    cur.error = null
    try {
      const env = await fetch({ cursor: append ? cur.cursor : null, limit: settings.pageSize, account: account(), signal })
      if (map.get(key) !== cur) return
      if (!env.ok) {
        cur.error = failed(env)
        if (append) cur.hasMore = false
        return
      }
      const fresh: T[] = []
      for (const it of env.data ?? []) {
        if (cur.seen.has(it.id)) continue
        cur.seen.add(it.id)
        fresh.push(it)
      }
      cur.items = append ? merge(cur.items, fresh) : merge([], fresh)
      cur.cursor = env.page?.cursor ?? null
      cur.hasMore = Boolean(env.page?.has_more && env.page.cursor)
      cur.loaded = true
      cur.elapsed = (performance.now() - t0) / 1000
      if (append && !fresh.length && cur.hasMore && emptyPages + 1 < MAX_EMPTY_PAGES) {
        cur.loadingMore = false
        return loadList(map, key, fetch, true, merge, emptyPages + 1)
      }
    } catch (e) {
      if (isAbort(e) || map.get(key) !== cur) return
      cur.error = netError(e)
    } finally {
      cur.loading = cur.loadingMore = false
    }
  }

  const p = () => platform.value
  const loadNotices = (append: boolean) => loadList(notices, base(), (o) => listNotices(p(), o), append)
  const loadConvs = (append: boolean) => loadList(convs, base(), (o) => listConversations(p(), o), append)
  /** 更早的消息接在上面 */
  const loadMsgs = (c: string, append: boolean) =>
    loadList(msgs, msgKey(c), (o) => listMessages(p(), c, o), append, (old, fresh) => orderMessages([...fresh, ...old]))

  /** 按当前地址补齐数据（缓存里有就不请求） */
  function ensure() {
    const t = tab.value
    if (!route.value || !t || !hasAccount.value) return
    void loadCount(platform.value)
    const fresh = (l: InboxList<unknown> | null | undefined) => !l || (!l.loaded && !l.loading && !l.error)
    if (t === 'notices') {
      if (fresh(notices.get(base()))) void loadNotices(false)
    } else {
      if (fresh(convs.get(base()))) void loadConvs(false)
      if (conv.value && fresh(msgs.get(msgKey(conv.value)))) void loadMsgs(conv.value, false)
    }
  }

  /** 刷新按钮：重新请求未读数和当前标签（私信时连同当前会话） */
  function refresh() {
    const t = tab.value
    if (!t) return
    ctl.abort()
    ctl = new AbortController()
    void loadCount(platform.value, true)
    if (t === 'notices') void loadNotices(false)
    else {
      void loadConvs(false)
      if (conv.value) void loadMsgs(conv.value, false)
    }
  }

  function loadMoreNotices() {
    const l = noticeList.value
    if (l && !l.loading && !l.loadingMore && l.hasMore) void loadNotices(true)
  }
  function loadMoreConvs() {
    const l = convList.value
    if (l && !l.loading && !l.loadingMore && l.hasMore) void loadConvs(true)
  }
  /** 往上翻：取更早的一页消息 */
  function loadOlder() {
    const c = conv.value
    const l = msgList.value
    if (c && l && !l.loading && !l.loadingMore && l.hasMore) void loadMsgs(c, true)
  }
  function retryMsgs() {
    if (conv.value) void loadMsgs(conv.value, false)
  }

  // 过滤后不够一屏时自动再翻一页
  watch(
    () => [shownNotices.value.length, noticeList.value?.loading, noticeList.value?.loadingMore, type.value] as const,
    ([n, loading, more, ty]) => {
      if (ty && !loading && !more && n < 8 && noticeList.value?.hasMore) loadMoreNotices()
    },
  )

  // ---------- 地址 ----------
  function toUrl(r: InboxRoute): string {
    const parts: string[] = []
    if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
    const list = tabsOf(r.platform)
    const t = r.tab && list.includes(r.tab as InboxTab) ? r.tab : list[0]
    if (r.tab && r.tab !== list[0]) parts.push(`tab=${r.tab}`)
    if (t === 'notices' && r.type) parts.push(`type=${encodeURIComponent(r.type)}`)
    if (t === 'messages' && r.conv) parts.push(`c=${encodeURIComponent(r.conv)}`)
    return `/${encodeURIComponent(r.platform)}/inbox${parts.length ? `?${parts.join('&')}` : ''}`
  }
  function go(r: InboxRoute, replace = false) {
    const next = toUrl(r)
    route.value = r
    if (next !== location.pathname + location.search) (replace ? history.replaceState : history.pushState).call(history, null, '', next)
    ensure()
  }

  /** 侧栏或分段点了「收件箱」 */
  function open(id: string) {
    if (!hasInbox(id) || route.value?.platform === id) return
    closeOverlays()
    go({ platform: id, tab: null, type: null, conv: null })
  }
  function leave() {
    if (route.value) route.value = null
  }
  function setTab(next: InboxTab) {
    const r = route.value
    if (!r || tab.value === next) return
    go({ platform: r.platform, tab: next, type: null, conv: null })
  }
  function setType(next: NoticeType | null) {
    const r = route.value
    if (!r || type.value === next) return
    go({ ...r, tab: 'notices', type: next }, true)
  }
  /** 选中一个会话；`replace` 用于桌面上默认选中第一个（不多出一条历史） */
  function setConv(id: string | null, replace = false) {
    const r = route.value
    if (!r || conv.value === id) return
    go({ platform: r.platform, tab: 'messages', type: null, conv: id }, replace)
  }

  addEventListener('popstate', () => {
    const r = parseInboxPath()
    if (!r) return void leave()
    route.value = r
    // 前进 / 后退到别的平台的收件箱：发现页（侧栏）跟着换过去。先改 route，下面「换了平台就离开」的 watch 才不会把它关掉
    if (!discover.aggregate && discover.state.platform !== r.platform) discover.state.platform = r.platform
    ensure()
  })

  // 发现页换了平台：离开
  watch(
    () => discover.state.platform,
    (id) => route.value && id !== route.value.platform && leave(),
  )
  // 账号读到之后、换了浏览账号、登录后：按新账号补齐
  watch([account, hasAccount, () => discover.filters], () => route.value && ensure())
  // 单一模式下第一次选中一个渠道：取一次未读数（每个平台、每个账号在本页会话里一次）
  watch(
    [() => discover.state.platform, () => discover.aggregate, () => discover.accounts, () => discover.filters],
    () => {
      const id = discover.state.platform
      if (!discover.aggregate && id) void loadCount(id)
    },
    { immediate: true },
  )

  const busy = computed(() =>
    tab.value === 'notices' ? Boolean(noticeList.value?.loading) : Boolean(convList.value?.loading || msgList.value?.loading),
  )

  return {
    route,
    active,
    platform,
    tabs,
    tab,
    type,
    conv,
    curConv,
    noticeList,
    shownNotices,
    convList,
    msgList,
    myId,
    busy,
    hasAccount,
    expired,
    account,
    hasInbox,
    countOf,
    badge,
    open,
    leave,
    setTab,
    setType,
    setConv,
    refresh,
    ensure,
    loadMoreNotices,
    loadMoreConvs,
    loadOlder,
    retryMsgs,
  }
})
