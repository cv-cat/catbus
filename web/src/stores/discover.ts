import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import { listAccounts, loadFilters, removeAccount, searchItems, useAccount, type PlatformFilters } from '@/api/client'
import type { Account, CatbusError, Item } from '@/api/types'
import { PLATFORMS, platformById } from '@/data/platforms'
import { KINDS, ORDERS, SORTS, TIMES, TYPES, parseOrder } from '@/data/filters'
import { useSelectionStore } from './selection'
import { useSettingsStore } from './settings'
import { toast } from './toast'
import { fill, interleave, itemCell, newLane, skeletonCells, type Cell, type Lane } from './lanes'
import { authorRoute, parseAuthorPath } from './route'

export { KINDS, SORTS, TIMES, TYPES }

/**
 * 发现页状态的兜底值：平台、排序、类型。综合、全部任何平台都能用（不带选项），
 * 平台不支持设置里的默认排序 / 类型时退回这里。日常的默认值来自设置（见 `useSettingsStore`）。
 */
export const DEFAULTS = { platform: PLATFORMS[0]!.id, keyword: '', sort: 'general', type: 'all', kind: 'recommend', time: 'all' }

/** 置灰规则适用的筛选：排序、类型、时间（有关键词时），推荐流分类（没有关键词时） */
export type FilterKind = 'sort' | 'type' | 'time' | 'kind'
const CHOICES = { sort: SORTS, type: TYPES, time: TIMES, kind: KINDS } as const
const labelOf = (kind: FilterKind, value: string) =>
  (CHOICES[kind] as readonly { value: string; label: string }[]).find((o) => o.value === value)?.label ?? value

export type DiscoverState = typeof DEFAULTS

/** 上次浏览的平台（设置「启动时打开的平台」为「上次浏览的」时用），不属于设置面板，单独存 */
const LAST_PLATFORM_KEY = 'catbus.lastPlatform'

function readLastPlatform(): string | null {
  try {
    return localStorage.getItem(LAST_PLATFORM_KEY)
  } catch {
    return null
  }
}

function writeLastPlatform(id: string) {
  try {
    localStorage.setItem(LAST_PLATFORM_KEY, id)
  } catch {
    /* 隐私模式不可写：只是下次不记得，忽略 */
  }
}

/**
 * 地址栏 ⇄ 页面状态：`/<平台>?agg=<渠道,...>&sort=<排序>&type=<类型>&kind=<分类>&time=<时间>&keyword=<关键词>`，取默认值的参数省略。
 * `agg` 只在聚合模式下出现，按选中的顺序列出渠道，路径里的平台是其中最后点选的那个。
 * 仍是单页应用：切换时只用 history API 改地址，不重新加载页面；未知的平台和取值回到默认。
 * 「默认」是设置里的值：地址没带平台时按「启动时打开的平台」，没带排序 / 类型时用默认排序 / 类型。
 */
function fromUrl(d: { platform: string; sort: string; type: string }): DiscoverState {
  // 直接打开作者页（`/<平台>/user?u=...`）：发现页在后台停在作者的平台
  const id = parseAuthorPath()?.platform ?? decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, ''))
  const q = new URLSearchParams(location.search)
  const pick = (v: string | null, list: readonly { value: string }[], d: string) =>
    v && list.some((o) => o.value === v) ? v : d
  return {
    platform: platformById(id)?.id ?? d.platform,
    keyword: q.get('keyword') ?? '',
    sort: parseOrder(q.get('sort')) ? q.get('sort')! : pick(q.get('sort'), SORTS, d.sort),
    type: pick(q.get('type'), TYPES, d.type),
    kind: pick(q.get('kind'), KINDS, DEFAULTS.kind),
    time: pick(q.get('time'), TIMES, DEFAULTS.time),
  }
}

/** 地址里的 `agg`：聚合模式选中的渠道（去重、丢掉未知平台）；没有这个参数时为 null（单一模式） */
function aggFromUrl(): string[] | null {
  const raw = new URLSearchParams(location.search).get('agg')
  if (raw == null) return null
  const ids = raw.split(',').map((s) => platformById(s.trim())?.id)
  return [...new Set(ids.filter((id): id is string => !!id))]
}

/** `d` 是这个平台实际生效的默认排序 / 类型（设置值，平台不支持时为回退值），等于它的参数省略 */
function toUrl(s: DiscoverState, d: { sort: string; type: string }, agg: string[] | null): string {
  const parts: string[] = []
  // 演示模式的 ?demo 原样保留（client.ts 据此只用演示数据）
  if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
  if (agg) parts.push(`agg=${agg.map(encodeURIComponent).join(',')}`)
  if (s.sort !== d.sort) parts.push(`sort=${encodeURIComponent(s.sort)}`)
  if (s.type !== d.type) parts.push(`type=${encodeURIComponent(s.type)}`)
  if (s.kind !== DEFAULTS.kind) parts.push(`kind=${encodeURIComponent(s.kind)}`)
  if (s.time !== DEFAULTS.time) parts.push(`time=${encodeURIComponent(s.time)}`)
  if (s.keyword) parts.push(`keyword=${encodeURIComponent(s.keyword)}`)
  return `/${encodeURIComponent(s.platform)}${parts.length ? `?${parts.join('&')}` : ''}`
}

/**
 * 上游已经不存在的条目（作品被删、笔记失效）：标题、正文、封面、作者都是空的，
 * 卡片只剩「（无标题）」和占位图，没有意义，直接丢掉。
 */
function isAlive(it: Item): boolean {
  return Boolean(it.title?.trim() || it.text?.trim() || it.cover || it.author?.name || it.media.some((m) => m.url))
}

/** 渠道的账号状态：ok 全部正常、warn 有账号失效、bad 全部失效 */
export type Health = { level: 'ok' | 'warn' | 'bad'; total: number; bad: number }

/**
 * 渠道缓存（keep-alive）：每个平台最后一次的结果。切回这个平台时，查询（账号 + 排序 + 类型 + 分类 + 时间 + 关键词）
 * 与缓存相同就直接恢复，不重新请求；不同（前进 / 后退到别的筛选、换了账号）才请求。
 */
type ChannelSnapshot = {
  key: string
  account: string | null
  sort: string
  type: string
  kind: string
  time: string
  keyword: string
  items: Item[]
  cursor: string | null
  hasMore: boolean
  elapsed: number | null
  seen: Set<string>
  /** 离开渠道时的滚动位置，由页面在切走前记下 */
  scrollTop: number
}

const channelKey = (s: DiscoverState, account: string | null) =>
  JSON.stringify([s.platform, account, s.sort, s.type, s.kind, s.time, s.keyword.trim()])

/** 一页全是重复时自动再翻，最多连续这么多页，避免平台一直返回同一批数据时死循环 */
const MAX_EMPTY_PAGES = 3

/** 发现页：平台、筛选、关键词（与地址栏同步）、搜索结果、账号与健康状态 */
export const useDiscoverStore = defineStore('discover', () => {
  const selection = useSelectionStore()
  const { settings } = useSettingsStore()

  /** 地址栏没带平台时进入哪个：固定平台，或上次浏览的（没有记录时第一个平台） */
  function startPlatform(): string {
    const want = settings.startPlatform === 'last' ? readLastPlatform() : settings.startPlatform
    return platformById(want ?? '')?.id ?? DEFAULTS.platform
  }
  /** 地址栏解析用的默认值：都取设置（还没按平台能力回退，回退在 clampFilters 里做） */
  const urlDefaults = () => ({ platform: startPlatform(), sort: settings.defaultSort, type: settings.defaultType })

  const state = reactive(fromUrl(urlDefaults()))

  /** 各平台支持的筛选（注册表）；没读到时为 null，不置灰 */
  const filters = shallowRef<Record<string, PlatformFilters> | null>(null)

  /**
   * 某个筛选取值在当前平台能不能用：能用返回 null，不能用返回提示文字（显示在置灰按钮的 tooltip 里）。
   * 默认值（综合、全部、推荐、不限）不带选项，总能用。
   */
  function unsupportedOn(id: string, kind: FilterKind, value: string): string | null {
    if (value === DEFAULTS[kind]) return null
    const all = filters.value
    if (!all) return null
    const meta = platformById(id)!
    const f = all[id]
    // 推荐流分类（feed list --kind）：声明了这个取值才能用
    if (kind === 'kind') {
      if (f?.kind?.includes(value)) return null
      return f?.kind && f.kind.length > 1 ? `${meta.name}暂不支持「${labelOf(kind, value)}」流` : `${meta.name}没有推荐流分类`
    }
    // 字段排序（--order-by）：平台声明了这个字段才能用，搜索和浏览都支持
    const order = kind === 'sort' ? parseOrder(value) : null
    if (order) {
      if (f?.order?.includes(order.field)) return null
      const name = ORDERS.find((o) => o.value === order.field)?.label ?? order.field
      return `${meta.name}不支持按「${name}」排序`
    }
    if (meta.mode === 'feed' || !f?.search) return `${meta.name}只有推荐流，不支持筛选`
    const list = f[kind]
    if (list?.includes(value)) return null
    const label = labelOf(kind, value)
    if (!list) return `${meta.name}不支持按${{ sort: '排序', type: '类型', time: '时间' }[kind]}筛选`
    if (kind === 'time') return `${meta.name}不支持「${label}」`
    return kind === 'sort' ? `${meta.name}不支持按「${label}」排序` : `${meta.name}不支持只看「${label}」`
  }

  /**
   * 当前页面上这个取值能不能用。聚合模式下只要有一个选中的渠道支持就能用，
   * 不支持它的渠道各自按默认值（综合、全部、推荐、不限）请求（见 `effective`）。
   */
  function unsupported(kind: FilterKind, value: string): string | null {
    if (!aggregate.value) return unsupportedOn(state.platform, kind, value)
    const why = lanes.value.map((l) => unsupportedOn(l.platform, kind, value))
    // 字段排序要选中的渠道全都支持（否则排序按钮显示的是标准排序那一组）
    if (kind === 'sort' && parseOrder(value)) return why.find((w) => w) ?? null
    if (why.some((w) => !w)) return null
    if (why.length === 1) return why[0]!
    const label = labelOf(kind, value)
    if (kind === 'kind') return `选中的渠道都不支持「${label}」流`
    if (kind === 'time') return `选中的渠道都不支持「${label}」`
    return kind === 'sort' ? `选中的渠道都不支持按「${label}」排序` : `选中的渠道都不支持只看「${label}」`
  }

  /** 整个筛选都用不了时的原因（时间 chip 整体置灰）：除默认值外没有一个取值能用 */
  function unsupportedAll(kind: FilterKind): string | null {
    const first = CHOICES[kind].find((o) => o.value !== DEFAULTS[kind])!.value
    if (CHOICES[kind].some((o) => o.value !== DEFAULTS[kind] && !unsupported(kind, o.value))) return null
    if (aggregate.value && lanes.value.length > 1) return `选中的渠道都不支持按${{ sort: '排序', type: '类型', time: '时间', kind: '分类' }[kind]}筛选`
    // 单个渠道：只有推荐流、或者没有这个筛选（如「小红书不支持按时间筛选」），原因与第一个取值的相同
    return unsupportedOn(state.platform, kind, first)
  }

  /** 推荐流分类分段出不出现：当前平台（聚合时任一选中的渠道）的 feed list 声明了不止一种 --kind */
  const kindSwitch = computed(() => {
    const all = filters.value
    if (!all) return false
    const ids = aggregate.value ? lanes.value.map((l) => l.platform) : [state.platform]
    return ids.some((id) => (all[id]?.kind?.length ?? 0) > 1)
  })

  /** 排序按钮用字段排序那一组（ORDERS）还是标准排序（SORTS）：当前平台（聚合时为全部选中的渠道）声明了 --order-by */
  const orderFields = computed<string[] | null>(() => {
    const all = filters.value
    if (!all) return null
    const ids = aggregate.value ? lanes.value.map((l) => l.platform) : [state.platform]
    const lists = ids.map((id) => all[id]?.order ?? null)
    if (!lists.length || lists.some((l) => !l?.length)) return null
    return lists[0]!.filter((f) => lists.every((l) => l!.includes(f)))
  })

  /** 某个渠道实际请求用的取值：支持就用页面上选的，不支持退回默认值 */
  const effective = (id: string, kind: FilterKind, value: string) =>
    unsupportedOn(id, kind, value) ? DEFAULTS[kind] : value

  /** 当前平台能用的第一个取值（按 SORTS / TYPES / TIMES / KINDS 的顺序；默认值总能用） */
  function firstSupported(kind: FilterKind): string {
    return CHOICES[kind].find((o) => !unsupported(kind, o.value))?.value ?? DEFAULTS[kind]
  }

  /** 当前平台实际生效的默认排序 / 类型：设置值；平台不支持时回退到它支持的第一个值 */
  function effectiveDefault(kind: 'sort' | 'type'): string {
    const want = kind === 'sort' ? settings.defaultSort : settings.defaultType
    return unsupported(kind, want) ? firstSupported(kind) : want
  }

  /** 换平台（或地址里带了不支持的取值）后，把当前平台不支持的筛选退回它支持的第一个值 */
  function clampFilters() {
    if (unsupported('sort', state.sort)) state.sort = firstSupported('sort')
    if (unsupported('type', state.type)) state.type = firstSupported('type')
    if (unsupported('kind', state.kind)) state.kind = DEFAULTS.kind
    if (unsupported('time', state.time)) state.time = DEFAULTS.time
  }

  async function initFilters() {
    filters.value = await loadFilters()
  }

  /** 第一次同步用 replace：把不规范的地址（如 `/`、未知平台）改成规范地址，不多出一条历史 */
  let urlSynced = false
  /** 上次写进地址栏的状态（关键词是提交时的，不是输入框里正在打的） */
  let synced: DiscoverState | null = null
  const urlFor = (s: DiscoverState) =>
    toUrl(
      s,
      { sort: effectiveDefault('sort'), type: effectiveDefault('type') },
      aggregate.value ? lanes.value.map((l) => l.platform) : null,
    )
  /** 已提交的关键词（响应式）：筛选栏按它决定显示推荐流分类还是排序 / 类型 / 时间 */
  const committed = ref(state.keyword.trim())
  function syncUrl() {
    synced = { ...state, keyword: state.keyword.trim() }
    committed.value = synced.keyword
    // 在作者页上：发现页在后台更新，地址栏归作者页（之后写地址用 push，不替换掉作者页）
    if (authorRoute.value) return void (urlSynced = true)
    const next = urlFor(synced)
    if (next === location.pathname + location.search) return
    if (urlSynced) history.pushState(null, '', next)
    else history.replaceState(null, '', next)
    urlSynced = true
  }

  /**
   * 设置里改了默认排序 / 类型：不重新搜索、不改当前筛选，只把地址按新的默认值重写一遍（replace），
   * 让刷新、收藏的地址仍指向眼前这一页。
   */
  watch(
    () => [settings.defaultSort, settings.defaultType],
    () => {
      if (!synced || synced.platform !== state.platform) return
      const next = urlFor(synced)
      if (next !== location.pathname + location.search) history.replaceState(null, '', next)
    },
  )

  /** 前进 / 后退带来的平台变化：筛选以地址为准，不按「切平台用默认值」重置 */
  let restoring = false

  /** 浏览器前进 / 后退：按地址恢复状态再搜索（平台、筛选的 watch 也会触发 search，合并成一次）。store 只建一次，监听也只挂一次 */
  addEventListener('popstate', () => {
    // 作者页的前进 / 后退由 stores/author 处理；从作者页后退回来、地址就是发现页上次写的：状态没变，不重新请求
    if (parseAuthorPath()) return
    if (synced && location.pathname + location.search === urlFor(synced)) return
    const next = fromUrl(urlDefaults())
    restoring = next.platform !== state.platform
    Object.assign(state, next)
    // 已提交的查询以地址为准（run() 里会重新记下），聚合的渠道按新的查询去对缓存
    synced = null
    const agg = aggFromUrl()
    if (agg) applyAggregate(agg, next.platform)
    else leaveAggregate()
    scheduleSearch()
  })

  /** 各平台的渠道缓存，只在内存里（刷新页面即清空） */
  const channels = new Map<string, ChannelSnapshot>()

  /**
   * 用户切换平台：有缓存时恢复这个渠道自己的排序、类型和关键词（随后 run() 发现查询与缓存相同，直接恢复结果）；
   * 没有缓存时排序、类型回到设置里的默认值（平台不支持时由 clampFilters 回退）。
   * 同时记下「上次浏览的平台」。同一轮里的筛选 watch 会和换平台的搜索合并成一次请求。
   */
  watch(
    () => state.platform,
    (id) => {
      writeLastPlatform(id)
      if (restoring) return void (restoring = false)
      // 聚合模式下平台只是「最后点选的渠道」（账号卡跟着它），不换结果、不动筛选
      if (aggregate.value) return
      const snap = channels.get(id)
      state.sort = snap?.sort ?? settings.defaultSort
      state.type = snap?.type ?? settings.defaultType
      state.kind = snap?.kind ?? DEFAULTS.kind
      state.time = snap?.time ?? DEFAULTS.time
      if (snap) state.keyword = snap.keyword
    },
  )
  writeLastPlatform(state.platform)

  /** 同一轮里多处触发的搜索（换平台 + 换筛选 + 后退）合并成一次请求 */
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleSearch() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void run(false), 0)
  }

  const items = shallowRef<Item[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<CatbusError | null>(null)
  const cursor = ref<string | null>(null)
  const hasMore = ref(false)
  const elapsed = ref<number | null>(null)
  const accounts = shallowRef<Account[]>([])
  /** 每个平台本页浏览用的账号名（点选切换），没选过时用 _current */
  const browse = reactive<Record<string, string>>({})
  /** 请求时报登录失效的账号，键为 `平台:账号` */
  const expired = shallowRef(new Set<string>())
  /** 恢复渠道缓存后要回到的滚动位置；每次恢复换一个新对象，页面 watch 它来滚动 */
  const restoredScroll = shallowRef<{ top: number } | null>(null)

  const platform = computed(() => platformById(state.platform)!)
  /** 同一渠道里重新请求：旧结果还在、但已经过时（变淡、不可点） */
  const refreshing = computed(() => loading.value && items.value.length > 0)
  const platformAccounts = computed(() => accounts.value.filter((a) => a.platform === state.platform && a.endpoint === 'web'))
  /** 某个平台本页浏览用的账号：点选过的，否则 _current */
  function accountFor(id: string): Account | null {
    const list = accounts.value.filter((a) => a.platform === id && a.endpoint === 'web')
    return list.find((a) => a.account === browse[id]) ?? list.find((a) => a.current) ?? null
  }
  const currentAccount = computed(() => accountFor(state.platform))

  function markExpired(platform: string, account: string, on: boolean) {
    const key = `${platform}:${account}`
    if (expired.value.has(key) === on) return
    const next = new Set(expired.value)
    on ? next.add(key) : next.delete(key)
    expired.value = next
  }

  const isExpired = (a: Account) => expired.value.has(`${a.platform}:${a.account}`)

  const health = computed(() => {
    const out = new Map<string, Health>()
    for (const a of accounts.value) {
      if (a.endpoint !== 'web') continue
      const h = out.get(a.platform) ?? { level: 'ok', total: 0, bad: 0 }
      h.total++
      if (expired.value.has(`${a.platform}:${a.account}`)) h.bad++
      h.level = h.bad === 0 ? 'ok' : h.bad < h.total ? 'warn' : 'bad'
      out.set(a.platform, h)
    }
    return out
  })

  let seq = 0

  /** 当前列表属于哪个平台：换了渠道就不能再显示旧平台的卡片 */
  let shownPlatform: string | null = null

  /**
   * 当前这次搜索里已经渲染过的 item id。平台翻页时常会返回上一页已有的条目，
   * 用 Set 判重：has / add 都是 O(1)，每页的去重是 O(本页条数)，与已加载的总数无关。
   */
  let seenIds = new Set<string>()

  /** 换渠道：立刻清空列表、翻页状态和选择，界面先显示骨架屏，等新数据回来 */
  function resetResults() {
    items.value = []
    cursor.value = null
    hasMore.value = false
    elapsed.value = null
    seenIds = new Set()
    selection.none()
  }

  function dedupe(batch: Item[], seen = seenIds): Item[] {
    const fresh: Item[] = []
    for (const item of batch) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      fresh.push(item)
    }
    return fresh
  }

  /** 切回有缓存的渠道：直接换上缓存的结果和翻页状态，不请求 */
  function restoreChannel(snap: ChannelSnapshot) {
    items.value = snap.items
    cursor.value = snap.cursor
    hasMore.value = snap.hasMore
    elapsed.value = snap.elapsed
    seenIds = snap.seen
    selection.none()
    restoredScroll.value = { top: snap.scrollTop }
  }

  /** 切走前记下这个渠道的滚动位置，切回来时恢复 */
  function rememberScroll(platform: string, top: number) {
    const snap = channels.get(platform)
    if (snap) snap.scrollTop = top
  }

  async function run(append = false, emptyPages = 0) {
    if (aggregate.value) {
      if (append) return void (await loadMoreAggregate())
      clampFilters()
      syncUrl()
      return runAggregate()
    }
    const meta = platformById(state.platform)!
    const id = ++seq
    const t0 = performance.now()
    const platform = state.platform
    const account = currentAccount.value?.account ?? null
    if (!append) {
      clampFilters()
      syncUrl()
      error.value = null
      if (shownPlatform !== platform) {
        shownPlatform = platform
        const snap = channels.get(platform)
        // ++seq 已经让还在路上的旧请求作废，加载状态在这里收起
        if (snap && snap.key === channelKey(synced!, account)) {
          loading.value = loadingMore.value = false
          return restoreChannel(snap)
        }
        resetResults()
      }
    }
    append ? (loadingMore.value = true) : (loading.value = true)
    // 缓存按已提交的查询记（输入框里正在打的关键词不算）
    const query = { ...synced!, platform }
    const key = channelKey(query, account)
    try {
      const env = await searchItems({
        platform: state.platform,
        keyword: state.keyword.trim(),
        mode: meta.mode,
        sort: state.sort,
        type: state.type,
        kind: state.kind,
        time: state.time,
        cursor: append ? cursor.value : null,
        // 每页条数取设置，改了之后下一次请求（含翻页）生效
        limit: settings.pageSize,
        account,
      })
      if (id !== seq) return // 已经有更新的请求
      if (!env.ok) {
        error.value = env.error
        if (account && /^AUTH_(EXPIRED|REQUIRED)$/.test(env.error?.code ?? '')) markExpired(state.platform, account, true)
        if (!append) {
          items.value = []
          channels.delete(platform)
        }
        return
      }
      if (account) markExpired(state.platform, account, false)
      if (!append) {
        seenIds = new Set()
        selection.none() // 换了一批结果，原来的选择不再对应
      }
      const fresh = dedupe((env.data ?? []).filter(isAlive))
      // 换成新数组（而不是 push），瀑布流的 computed / watch 才会更新
      items.value = append ? [...items.value, ...fresh] : fresh
      cursor.value = env.page?.cursor ?? null
      hasMore.value = Boolean(env.page?.has_more && env.page.cursor)
      elapsed.value = (performance.now() - t0) / 1000
      channels.set(platform, {
        key,
        account,
        sort: query.sort,
        type: query.type,
        kind: query.kind,
        time: query.time,
        keyword: query.keyword,
        items: items.value,
        cursor: cursor.value,
        hasMore: hasMore.value,
        elapsed: elapsed.value,
        seen: seenIds,
        // 新的一批结果从顶部看起；翻页时保留原来的位置
        scrollTop: append ? (channels.get(platform)?.scrollTop ?? 0) : 0,
      })
      if (append && !fresh.length && hasMore.value && emptyPages + 1 < MAX_EMPTY_PAGES) {
        return void (await run(true, emptyPages + 1))
      }
    } catch (e) {
      if (id !== seq) return
      error.value = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
    } finally {
      if (id === seq) loading.value = loadingMore.value = false
    }
  }

  const loadMore = () => !loadingMore.value && view.hasMore.value && run(true)

  /** 刷新按钮：按当前渠道已提交的查询重新请求，替换缓存（旧结果变淡，新结果回来后替换）；聚合模式下选中的渠道全部重新请求 */
  function refresh() {
    if (synced && synced.platform === state.platform) state.keyword = synced.keyword
    clearTimeout(searchTimer)
    if (!aggregate.value) return void run(false)
    clampFilters()
    syncUrl()
    runAggregate(true)
  }

  // ---------- 聚合模式：同时看几个渠道，卡片按渠道轮流排 ----------

  /** 是否聚合模式；地址带 `agg` 时一打开就是 */
  const aggregate = ref(false)
  /** 选中的渠道，顺序即点选的顺序（也是卡片轮流的顺序） */
  const lanes = shallowRef<Lane[]>([])
  /** 聚合模式下瀑布流的格子（卡片和骨架占位），顺序即显示顺序 */
  const sequence = shallowRef<Cell[]>([])
  /** 条目来自哪个平台（聚合模式下一个列表里有多个平台的条目） */
  const origin = new WeakMap<Item, string>()
  const platformOf = (item: Item) => origin.get(item) ?? state.platform
  const order = () => lanes.value.map((l) => l.platform)

  /** 这个渠道按页面当前（已提交）的筛选和关键词该发的查询 */
  function laneQuery(id: string) {
    const s = synced ?? state
    const account = accountFor(id)?.account ?? null
    const q = {
      platform: id,
      keyword: s.keyword.trim(),
      sort: effective(id, 'sort', s.sort),
      type: effective(id, 'type', s.type),
      kind: effective(id, 'kind', s.kind),
      time: effective(id, 'time', s.time),
    }
    return { ...q, account, key: channelKey(q, account) }
  }

  /**
   * 新建一个渠道；渠道缓存里正好有同一个查询的结果时直接用上（不请求、不出骨架）。
   * `keepKeys`：格子沿用单一模式的 key（条目 id），进入聚合模式时卡片不用重建。
   */
  function makeLane(id: string, keepKeys = false): { lane: Lane; cells: Cell[] } {
    const lane = shallowReactive(newLane(id))
    const snap = channels.get(id)
    const q = laneQuery(id)
    if (!snap || snap.key !== q.key) return { lane, cells: [] }
    Object.assign(lane, {
      key: q.key,
      account: q.account,
      sort: q.sort,
      type: q.type,
      kind: q.kind,
      time: q.time,
      keyword: q.keyword,
      items: snap.items,
      cursor: snap.cursor,
      hasMore: snap.hasMore,
      elapsed: snap.elapsed,
      seen: new Set(snap.seen),
    })
    for (const it of snap.items) origin.set(it, id)
    return { lane, cells: snap.items.map((it) => (keepKeys ? { key: it.id, platform: id, item: it } : itemCell(id, it))) }
  }

  /** 把选中的渠道改成 `list`（保证包含 `focus`）：留下的渠道原样保留，新加的建出来，去掉的连同格子一起拿走 */
  function applyAggregate(list: string[], focus: string, keepKeys = false) {
    const want = list.includes(focus) ? list : [...list, focus]
    if (!aggregate.value) {
      // 单一模式还在路上的请求作废
      ++seq
      loading.value = loadingMore.value = false
      error.value = null
      aggregate.value = true
    }
    const old = lanes.value
    for (const l of old) if (!want.includes(l.platform)) l.seq++
    let cells = sequence.value.filter((c) => want.includes(c.platform))
    lanes.value = want.map((id) => {
      const kept = old.find((l) => l.platform === id)
      if (kept) return kept
      const made = makeLane(id, keepKeys)
      cells = [...cells, ...made.cells]
      return made.lane
    })
    sequence.value = interleave(want, cells)
  }

  /** 回到单一模式：聚合时看过的渠道都记进渠道缓存，接下来 run() 直接从缓存恢复当前平台 */
  function leaveAggregate() {
    if (!aggregate.value) return
    for (const l of lanes.value) {
      l.seq++
      if (!l.key || l.error || l.loading || !l.items.length) continue
      channels.set(l.platform, {
        key: l.key,
        account: l.account,
        sort: l.sort,
        type: l.type,
        kind: l.kind,
        time: l.time,
        keyword: l.keyword,
        items: l.items,
        cursor: l.cursor,
        hasMore: l.hasMore,
        elapsed: l.elapsed,
        seen: new Set(l.seen),
        scrollTop: 0,
      })
    }
    aggregate.value = false
    lanes.value = []
    sequence.value = []
    loadingMore.value = false
    shownPlatform = null
  }

  /** 侧栏的开关：单一 ⇄ 聚合。进入聚合时默认只选当前渠道（沿用它已有的结果） */
  function setAggregate(on: boolean) {
    if (on === aggregate.value) return
    selection.none()
    if (on) applyAggregate([state.platform], state.platform, true)
    else leaveAggregate()
    clearTimeout(searchTimer)
    void run(false)
  }

  /**
   * 聚合模式下点侧栏的渠道：没选的选上（排在最后），选了的去掉；至少留一个（只剩一个时点它无效，返回 false）。
   * 平台（账号卡跟着它）指向最后点选的渠道；去掉的正是它时，指向剩下的最后一个。
   */
  function toggleChannel(id: string): boolean {
    const ids = order()
    if (!ids.includes(id)) {
      applyAggregate([...ids, id], id)
      state.platform = id
    } else {
      if (ids.length === 1) return false
      const rest = ids.filter((p) => p !== id)
      const focus = state.platform === id ? rest[rest.length - 1]! : state.platform
      applyAggregate(rest, focus)
      state.platform = focus
      // 去掉的渠道的条目不再在列表里，选择里也拿掉
      const left = new Set(view.items.value.map((it) => it.id))
      if (selection.count) selection.set(new Set([...selection.selected].filter((x) => left.has(x))))
    }
    clearTimeout(searchTimer)
    void run(false)
    return true
  }

  /** 请求一个渠道的一页。返回 false 表示响应已经过期（渠道被去掉，或又发了新的请求），调用方什么都不用做 */
  async function fetchLane(lane: Lane, append: boolean): Promise<boolean> {
    const id = ++lane.seq
    const t0 = performance.now()
    const live = () => id === lane.seq && lanes.value.includes(lane)
    const fail = (e: CatbusError | null) => {
      if (lane.account && /^AUTH_(EXPIRED|REQUIRED)$/.test(e?.code ?? '')) markExpired(lane.platform, lane.account, true)
      // 翻页出错：这个渠道不再继续翻（否则滚到底会一直重试），已有的卡片保留
      if (append) lane.hasMore = false
      else {
        Object.assign(lane, { error: e, items: [], cursor: null, hasMore: false, seen: new Set() })
        channels.delete(lane.platform)
      }
      toast(`${platformById(lane.platform)!.name}：${e?.message ?? '加载失败'}`, 3200)
    }
    if (!append) {
      const q = laneQuery(lane.platform)
      Object.assign(lane, { key: q.key, account: q.account, sort: q.sort, type: q.type, kind: q.kind, time: q.time, keyword: q.keyword, error: null, empty: 0 })
      lane.loading = true
    }
    try {
      const env = await searchItems({
        platform: lane.platform,
        keyword: lane.keyword,
        mode: platformById(lane.platform)!.mode,
        sort: lane.sort,
        type: lane.type,
        kind: lane.kind,
        time: lane.time,
        cursor: append ? lane.cursor : null,
        limit: settings.pageSize,
        account: lane.account,
      })
      if (!live()) return false
      if (!env.ok) {
        fail(env.error)
        return true
      }
      if (lane.account) markExpired(lane.platform, lane.account, false)
      if (!append) lane.seen = new Set()
      const fresh = dedupe((env.data ?? []).filter(isAlive), lane.seen)
      for (const it of fresh) origin.set(it, lane.platform)
      lane.items = append ? [...lane.items, ...fresh] : fresh
      lane.cursor = env.page?.cursor ?? null
      lane.hasMore = Boolean(env.page?.has_more && env.page.cursor)
      lane.elapsed = (performance.now() - t0) / 1000
      // 连续几页全是重复：平台在原地打转，不再翻
      lane.empty = append && !fresh.length ? lane.empty + 1 : 0
      if (lane.empty >= MAX_EMPTY_PAGES) lane.hasMore = false
      return true
    } catch (e) {
      if (!live()) return false
      fail({ code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })
      return true
    } finally {
      if (id === lane.seq && !append) lane.loading = false
    }
  }

  /**
   * （重新）加载一个渠道的第一页。它在瀑布流里还没有格子时（刚选上、上次出错）先插入骨架占位：
   * 每张原有的卡片后面跟一张，原有的卡片各让出一格；数据回来后占位在原位换成卡片。
   * 已有卡片的渠道（换筛选、刷新）旧卡片留在原位，回来后原位替换。
   */
  async function loadLane(lane: Lane) {
    const id = lane.platform
    const mine = (c: Cell) => c.platform === id
    if (!sequence.value.some(mine)) {
      const longest = Math.max(0, ...order().map((p) => (p === id ? 0 : sequence.value.filter((c) => c.platform === p).length)))
      const n = longest ? Math.min(longest, settings.pageSize) : settings.pageSize
      sequence.value = interleave(order(), [...sequence.value, ...skeletonCells(id, n)])
    }
    if (!(await fetchLane(lane, false))) return
    sequence.value = fill(sequence.value, id, lane.items)
  }

  /** 按当前查询检查每个选中的渠道：查询没变、上次也没出错的不动，其余重新请求；`force` 时全部重新请求 */
  function runAggregate(force = false) {
    for (const lane of lanes.value) {
      if (!force && !lane.error && lane.key === laneQuery(lane.platform).key) continue
      void loadLane(lane)
    }
  }

  /** 翻页：还有下一页的渠道各翻一页，全部回来后把新条目按渠道轮流接在最后（已有的卡片不动） */
  async function loadMoreAggregate() {
    const targets = lanes.value.filter((l) => l.hasMore && !l.loading)
    if (!targets.length) return
    loadingMore.value = true
    const had = targets.map((l) => l.items.length)
    const ok = await Promise.all(targets.map((l) => fetchLane(l, true)))
    loadingMore.value = false
    if (!aggregate.value) return
    const batch = targets.flatMap((l, i) => (ok[i] ? l.items.slice(had[i]).map((it) => itemCell(l.platform, it)) : []))
    if (batch.length) sequence.value = [...sequence.value, ...interleave(order(), batch)]
  }

  /** 页面看到的结果：单一模式是当前渠道的，聚合模式是各渠道合起来的 */
  const view = {
    cells: computed<Cell[]>(() =>
      aggregate.value ? sequence.value : items.value.map((item) => ({ key: item.id, platform: state.platform, item })),
    ),
    items: computed<Item[]>(() =>
      aggregate.value ? sequence.value.flatMap((c) => (c.item ? [c.item] : [])) : items.value,
    ),
    loading: computed(() => (aggregate.value ? lanes.value.some((l) => l.loading) : loading.value)),
    refreshing: computed(() =>
      aggregate.value ? lanes.value.some((l) => l.loading && l.items.length > 0) : refreshing.value,
    ),
    /** 聚合模式下单个渠道出错只弹提示；全部出错、一张卡片都没有时才整页报错（报第一个渠道的） */
    failed: computed(() =>
      aggregate.value && lanes.value.every((l) => l.error) ? (lanes.value.find((l) => l.error) ?? null) : null,
    ),
    hasMore: computed(() => (aggregate.value ? lanes.value.some((l) => l.hasMore) : hasMore.value)),
    elapsed: computed(() => {
      if (!aggregate.value) return elapsed.value
      // 各渠道同时请求，总耗时取最慢的那个
      const done = lanes.value.flatMap((l) => (l.elapsed == null ? [] : [l.elapsed]))
      return done.length ? Math.max(...done) : null
    }),
  }
  const viewError = computed(() => (aggregate.value ? (view.failed.value?.error ?? null) : error.value))
  /** 整页报错对应的平台（「去登录」「去验证」针对它） */
  const errorPlatform = computed(() => view.failed.value?.platform ?? state.platform)
  /** 聚合模式选中的渠道（按点选顺序）；单一模式为空 */
  const selected = computed(() => (aggregate.value ? lanes.value.map((l) => l.platform) : []))
  /** 正在加载第一页的渠道 */
  const busy = computed(() => new Set(lanes.value.filter((l) => l.loading).map((l) => l.platform)))

  // 地址带 agg：一打开就是聚合模式（各渠道由第一次 run() 请求）
  const initialAgg = aggFromUrl()
  if (initialAgg) applyAggregate(initialAgg, state.platform)

  async function refreshAccounts() {
    const env = await listAccounts().catch(() => null)
    accounts.value = env?.ok && env.data ? env.data : []
  }

  /** 点选一行：本页改用这个账号浏览，并重新搜索 */
  function switchAccount(account: string) {
    if (browse[state.platform] === account && currentAccount.value?.account === account) return
    browse[state.platform] = account
    void run(false)
  }

  /** 设为默认（auth use），同时本页也切到这个账号 */
  async function setDefault(account: string) {
    await useAccount(state.platform, account)
    await refreshAccounts()
    switchAccount(account)
  }

  /** 删除账号；删的是本页正在浏览的账号时回到默认账号重新加载 */
  async function deleteAccount(account: string) {
    const platform = state.platform
    const wasBrowsing = currentAccount.value?.account === account
    await removeAccount(platform, account)
    markExpired(platform, account, false)
    if (channels.get(platform)?.account === account) channels.delete(platform)
    if (browse[platform] === account) delete browse[platform]
    await refreshAccounts()
    if (wasBrowsing && state.platform === platform) void run(false)
  }

  return {
    state,
    items: view.items,
    cells: view.cells,
    loading: view.loading,
    refreshing: view.refreshing,
    loadingMore,
    error: viewError,
    errorPlatform,
    hasMore: view.hasMore,
    elapsed: view.elapsed,
    aggregate,
    selected,
    busy,
    setAggregate,
    toggleChannel,
    platformOf,
    accountFor,
    accounts,
    platform,
    health,
    platformAccounts,
    currentAccount,
    isExpired,
    switchAccount,
    setDefault,
    deleteAccount,
    search: scheduleSearch,
    refresh,
    loadMore,
    rememberScroll,
    restoredScroll,
    refreshAccounts,
    unsupported,
    unsupportedAll,
    kindSwitch,
    committed,
    orderFields,
    filters,
    initFilters,
    /** 发现页当前该在的地址（作者页回到发现页时用）；还没搜索过时为 null */
    discoverUrl: () => (synced ? urlFor(synced) : null),
  }
})
