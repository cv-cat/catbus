import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import { isAbort, listAccounts, loadFilters, removeAccount, searchItems, useAccount, type PlatformFilters, type SearchParams } from '@/api/client'
import type { Account, CatbusError, Item } from '@/api/types'
import { PLATFORMS, platformById } from '@/data/platforms'
import { KINDS, ORDERS, SORTS, TIMES, TYPES, parseOrder } from '@/data/filters'
import { useSelectionStore } from './selection'
import { useSettingsStore } from './settings'
import { toast } from './toast'
import { t } from '@/i18n'
import { errorTitle } from '@/i18n/errors'
import { cursorsFor, fill, interleave, itemCell, joinCursors, newLane, roundRobin, skeletonCells, type Cell, type Lane } from './lanes'
import { authorRoute, isMePath, isRailPath, meActive, parseAuthorPath, railActive } from './route'
import { CITY, DEFAULT_CITY } from '@/data/cities'
import { categories as mteamCategories, MTEAM_MODES, type MteamMode } from '@/api/mteam'
import { categoryIn } from '@/data/mteam'
import type { Category } from '@/api/types'

export { KINDS, SORTS, TIMES, TYPES }

/**
 * 发现页状态的兜底值：平台、排序、类型。综合、全部任何平台都能用（不带选项），
 * 平台不支持设置里的默认排序 / 类型时退回这里。日常的默认值来自设置（见 `useSettingsStore`）。
 */
export const DEFAULTS = {
  platform: PLATFORMS[0]!.id,
  keyword: '',
  sort: 'general',
  type: 'all',
  kind: 'recommend',
  time: 'all',
  /** 猫眼演出的城市（空串为默认城市北京） */
  city: '',
  /** M-Team 的浏览筛选（AGENTS.md 7.9「M-Team「我的」页与筛选」）：分区、子类 id、只看免费（'1'）；只对 mteam 生效 */
  mtMode: 'normal' as string,
  mtCategory: '',
  mtFree: '',
}

export const MTEAM = 'mteam'
/** 一个渠道的 M-Team 筛选：只有 mteam 有，别的平台为 null */
export type MteamQuery = { mode: string; category: string; free: boolean }
export function mteamQuery(id: string, s: { mtMode: string; mtCategory: string; mtFree: string }): MteamQuery | null {
  return id === MTEAM ? { mode: s.mtMode, category: s.mtCategory, free: s.mtFree === '1' } : null
}

/** 只有它用城市（feed list --city，AGENTS.md 7.9「猫眼演出的城市」） */
const CITY_PLATFORM = 'maoyan'
/** 地址里的城市：不合法的、等于默认城市（北京）的都当作默认（空串） */
const cityParam = (v: string | null) => (v && v !== DEFAULT_CITY && CITY.test(v) ? v : '')
/** 这个平台请求用的城市：只有猫眼带，别的平台恒为空串（渠道缓存的查询里也就不含城市） */
const cityFor = (platform: string, city: string) => (platform === CITY_PLATFORM ? city : '')

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
  // 直接打开 M-Team「我的」页（`/mteam/me`）：发现页在后台停在 M-Team
  const id = parseAuthorPath()?.platform ?? (isMePath() ? MTEAM : decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, '')))
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
    city: cityParam(q.get('city')),
    mtMode: MTEAM_MODES.includes(q.get('mode') as MteamMode) ? q.get('mode')! : DEFAULTS.mtMode,
    mtCategory: /^\d{1,6}$/.test(q.get('category') ?? '') ? q.get('category')! : '',
    mtFree: q.get('free') === '1' ? '1' : '',
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
  // 猫眼的城市：路径或聚合的渠道里有猫眼时才写，默认城市省略
  if (s.city && (s.platform === CITY_PLATFORM || agg?.includes(CITY_PLATFORM))) parts.push(`city=${encodeURIComponent(s.city)}`)
  if (s.sort !== d.sort) parts.push(`sort=${encodeURIComponent(s.sort)}`)
  if (s.type !== d.type) parts.push(`type=${encodeURIComponent(s.type)}`)
  if (s.kind !== DEFAULTS.kind) parts.push(`kind=${encodeURIComponent(s.kind)}`)
  if (s.time !== DEFAULTS.time) parts.push(`time=${encodeURIComponent(s.time)}`)
  // M-Team 的筛选：只在单一模式的 mteam、或聚合里选了 mteam 时出现
  if (s.platform === MTEAM || agg?.includes(MTEAM)) {
    if (s.mtMode !== DEFAULTS.mtMode) parts.push(`mode=${encodeURIComponent(s.mtMode)}`)
    if (s.mtCategory) parts.push(`category=${encodeURIComponent(s.mtCategory)}`)
    if (s.mtFree) parts.push('free=1')
  }
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
  /** 请求用的账号（多选时几个） */
  accounts: string[]
  sort: string
  type: string
  kind: string
  time: string
  keyword: string
  /** 猫眼的城市（别的平台为空串） */
  city: string
  /** M-Team 的筛选（别的平台为 null） */
  mt: MteamQuery | null
  items: Item[]
  cursor: string | null
  hasMore: boolean
  elapsed: number | null
  seen: Set<string>
  /** 离开渠道时的滚动位置，由页面在切走前记下 */
  scrollTop: number
}

const channelKey = (s: DiscoverState, accounts: readonly string[]) =>
  JSON.stringify([s.platform, accounts.join(','), s.sort, s.type, s.kind, s.time, s.keyword.trim(), cityFor(s.platform, s.city), mteamQuery(s.platform, s)])

/** 多账号请求的结果：合并后的条目（还没按 id 去重）、合起来的翻页位置，以及每个账号的成败 */
type MultiPage = {
  ok: boolean
  items: Item[]
  cursor: string | null
  hasMore: boolean
  /** 第一个出错账号的错误；全部出错时 ok 为 false */
  error: CatbusError | null
  results: { account: string; error: CatbusError | null }[]
}

/** 勾选账号停下这么久再重新请求：连点几个账号只请求一次 */
const ACCOUNT_DEBOUNCE_MS = 400

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
      return f?.kind && f.kind.length > 1
        ? t('discover.unsupported.kind', { platform: meta.name, label: labelOf(kind, value) })
        : t('discover.unsupported.noKinds', { platform: meta.name })
    }
    // 字段排序（--order-by）：平台声明了这个字段才能用，搜索和浏览都支持
    const order = kind === 'sort' ? parseOrder(value) : null
    if (order) {
      if (f?.order?.includes(order.field)) return null
      const name = ORDERS.find((o) => o.value === order.field)?.label ?? order.field
      return t('discover.unsupported.sort', { platform: meta.name, label: name })
    }
    if (meta.mode === 'feed' || !f?.search) return t('discover.unsupported.feedOnly', { platform: meta.name })
    const list = f[kind]
    if (list?.includes(value)) return null
    const label = labelOf(kind, value)
    if (!list) return t(`discover.unsupported.noFilter.${kind}`, { platform: meta.name })
    return t(`discover.unsupported.${kind}`, { platform: meta.name, label })
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
    return t(`discover.unsupportedAll.${kind}`, { label })
  }

  /** 整个筛选都用不了时的原因（时间 chip 整体置灰）：除默认值外没有一个取值能用 */
  function unsupportedAll(kind: FilterKind): string | null {
    const first = CHOICES[kind].find((o) => o.value !== DEFAULTS[kind])!.value
    if (CHOICES[kind].some((o) => o.value !== DEFAULTS[kind] && !unsupported(kind, o.value))) return null
    if (aggregate.value && lanes.value.length > 1) return t(`discover.unsupportedAll.noFilter.${kind}`)
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
    clampMteam()
  }

  // ---------- M-Team 的浏览筛选 ----------
  /** 分类表（`item categories`），本页会话只取一次；取不到时为 null（分类 chip 置灰） */
  const mtCategories = shallowRef<Category[] | null>(null)
  const mtCategoriesError = ref(false)
  /** 筛选只对 mteam 生效：单一模式的 mteam，或聚合里选了 mteam */
  const mteamOn = computed(() => (aggregate.value ? lanes.value.some((l) => l.platform === MTEAM) : state.platform === MTEAM))
  let categoriesLoading = false
  async function loadMtCategories() {
    if (mtCategories.value || categoriesLoading) return
    categoriesLoading = true
    try {
      const categories = mteamCategories
      const env = await categories(accountsFor(MTEAM)[0] ?? null)
      if (env.ok && env.data) {
        mtCategories.value = env.data
        mtCategoriesError.value = false
        // 地址里的分类不属于当前分区：丢掉并重新请求
        if (state.mtCategory && !categoryIn(env.data, state.mtMode as MteamMode, state.mtCategory)) {
          state.mtCategory = ''
          scheduleSearch()
        }
      } else mtCategoriesError.value = true
    } catch {
      mtCategoriesError.value = true
    } finally {
      categoriesLoading = false
    }
  }
  /** 成人分区没有打开时，地址带 mode=adult 回到综合并提示；分类不属于分区时丢掉 */
  function clampMteam() {
    if (state.mtMode === 'adult' && !settings.mteamAdult) {
      state.mtMode = DEFAULTS.mtMode
      state.mtCategory = ''
      if (mteamOn.value) {
        toast(t('filters.mteam.adultOff'), 4000, {
          label: t('filters.mteam.toSettings'),
          run: () => useSettingsStore().show('display'),
        })
      }
    }
    const all = mtCategories.value
    if (state.mtCategory && all && !categoryIn(all, state.mtMode as MteamMode, state.mtCategory)) state.mtCategory = ''
    if (mteamOn.value) void loadMtCategories()
  }
  /** 换分区：清掉分类 */
  function setMtMode(m: string) {
    if (state.mtMode === m) return
    state.mtMode = m
    state.mtCategory = ''
    scheduleSearch()
  }
  function setMtCategory(id: string) {
    if (state.mtCategory === id) return
    state.mtCategory = id
    scheduleSearch()
  }
  function toggleMtFree() {
    state.mtFree = state.mtFree ? '' : '1'
    scheduleSearch()
  }
  // 设置里关掉成人分区：正在看成人分区就回到综合
  watch(
    () => settings.mteamAdult,
    (on) => {
      if (!on && state.mtMode === 'adult') {
        state.mtMode = DEFAULTS.mtMode
        state.mtCategory = ''
        scheduleSearch()
      }
    },
  )

  async function initFilters() {
    filters.value = await loadFilters()
  }

  /**
   * 第一次同步用 replace：把不规范的地址（如 `/`、未知平台）改成规范地址，不多出一条历史。
   * 从 12306 查询页打开的：查询页那一条要留在历史里，之后一律 push
   */
  let urlSynced = isRailPath() || isMePath()
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
    // 在作者页 / 12306 查询页上：发现页在后台更新，地址栏归它们（之后写地址用 push，不替换掉它们）
    if (authorRoute.value || railActive.value || meActive.value) return void (urlSynced = true)
    const next = urlFor(synced)
    // 打开时地址已经是规范地址：同样算同步过，之后换筛选用 push（否则第一次改动会替换掉打开时的那一条，后退直接离开页面）
    if (next === location.pathname + location.search) return void (urlSynced = true)
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
    if (parseAuthorPath() || isRailPath() || isMePath()) return
    if (synced && location.pathname + location.search === urlFor(synced)) return
    const next = fromUrl(urlDefaults())
    // 地址里没有猫眼（不在路径、也不在 agg 里）时不写城市：沿用页面上的城市，切回猫眼时还是它
    const agg0 = aggFromUrl()
    if (next.platform !== CITY_PLATFORM && !agg0?.includes(CITY_PLATFORM)) next.city = state.city
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
      if (id === MTEAM) {
        state.mtMode = snap?.mt?.mode ?? DEFAULTS.mtMode
        state.mtCategory = snap?.mt?.category ?? ''
        state.mtFree = snap?.mt?.free ? '1' : ''
      }
      if (snap) state.keyword = snap.keyword
    },
  )
  writeLastPlatform(state.platform)

  /** 同一轮里多处触发的搜索（换平台 + 换筛选 + 后退）合并成一次请求 */
  let searchTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleSearch(delay = 0) {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void run(false), delay)
  }

  const items = shallowRef<Item[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref<CatbusError | null>(null)
  const cursor = ref<string | null>(null)
  const hasMore = ref(false)
  const elapsed = ref<number | null>(null)
  const accounts = shallowRef<Account[]>([])
  /** 每个平台本页浏览用的账号（可多选，顺序即勾选的顺序），没勾选过时用 _current */
  const browse = reactive<Record<string, string[]>>({})
  /** 请求时报登录失效的账号，键为 `平台:账号` */
  const expired = shallowRef(new Set<string>())
  /** 恢复渠道缓存后要回到的滚动位置；每次恢复换一个新对象，页面 watch 它来滚动 */
  const restoredScroll = shallowRef<{ top: number } | null>(null)

  const platform = computed(() => platformById(state.platform)!)
  /** 同一渠道里重新请求：旧结果还在、但已经过时（变淡、不可点） */
  const refreshing = computed(() => loading.value && items.value.length > 0)
  const webAccounts = (id: string) => accounts.value.filter((a) => a.platform === id && a.endpoint === 'web')
  /** 勾选的账号（还存在的），没勾选过时为 _current */
  function chosenFor(id: string): string[] {
    const list = webAccounts(id)
    const picked = (browse[id] ?? []).filter((n) => list.some((a) => a.account === n))
    if (picked.length) return picked
    const cur = list.find((a) => a.current)
    return cur ? [cur.account] : []
  }
  /** 弹窗里打勾的账号：勾选的里面没失效的 */
  function selectedAccounts(id: string): string[] {
    return chosenFor(id).filter((n) => !expired.value.has(`${id}:${n}`))
  }
  /**
   * 某个平台请求用的账号：勾选的里面没失效的；都失效时仍用第一个（让页面报出登录失效、给出重新登录）。
   * 空数组表示这个平台没有账号，请求不带 -a。
   */
  function accountsFor(id: string): string[] {
    const picked = chosenFor(id)
    const live = picked.filter((n) => !expired.value.has(`${id}:${n}`))
    return live.length ? live : picked.slice(0, 1)
  }
  /** 某个平台本页浏览用的第一个账号（作者页、联想、热搜这些只发一个请求的地方用它） */
  function accountFor(id: string): Account | null {
    const name = accountsFor(id)[0]
    return webAccounts(id).find((a) => a.account === name) ?? null
  }
  /** 条目是用哪个账号取到的（详情、评论、悬停预览、下载用它）；不知道时用这个平台的第一个账号 */
  const itemAccount = new WeakMap<Item, string>()
  function accountOf(item: Item, platform = platformOf(item)): string | null {
    const a = itemAccount.get(item)
    return a !== undefined ? a || null : (accountFor(platform)?.account ?? null)
  }

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
  /**
   * 单一模式这一轮请求共用的取消器：发起新的一次搜索（seq 变了、旧结果反正要丢）时中止旧的，
   * bridge 随之结束对应的子进程，过期的请求不再打到平台。翻页沿用当前这一轮的，不另外取消。
   */
  let singleCtl = new AbortController()
  function abortSingle() {
    singleCtl.abort()
    singleCtl = new AbortController()
  }
  /** 聚合模式每个渠道自己的取消器（规则同上，按 lane.seq） */
  const laneCtl = new WeakMap<Lane, AbortController>()
  /** 渠道的请求作废：seq 加一并中止还在路上的请求 */
  function invalidateLane(l: Lane) {
    l.seq++
    laneCtl.get(l)?.abort()
    laneCtl.delete(l)
  }

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

  /**
   * 用几个账号各请求一次同样的查询（第一页全部账号；翻页只请求还有下一页的），结果按账号轮流合并。
   * 只有一个账号时与原来的单次请求完全相同。取消（AbortError）原样抛出。
   */
  async function fetchMulti(
    q: Omit<SearchParams, 'account' | 'cursor' | 'signal'>,
    accs: string[],
    cursor: string | null,
    append: boolean,
    signal: AbortSignal,
  ): Promise<MultiPage> {
    const list = accs.length ? accs : ['']
    const todo = cursorsFor(list, cursor, append)
    if (!todo.length) return { ok: true, items: [], cursor: null, hasMore: false, error: null, results: [] }
    const envs = await Promise.all(
      todo.map(([a, c]) =>
        searchItems({ ...q, account: a || null, cursor: c, signal }).catch((e: unknown) => {
          if (isAbort(e)) throw e
          return { ok: false, data: null, page: null, error: { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null } as CatbusError }
        }),
      ),
    )
    const lists: Item[][] = []
    const next = new Map<string, string>()
    const results = todo.map(([a], i) => {
      const env = envs[i]!
      if (!env.ok) return { account: a, error: env.error ?? { code: 'ERROR', message: t('common.state.failed'), hint: null, detail: null } }
      const got = (env.data ?? []).filter(isAlive)
      for (const it of got) itemAccount.set(it, a)
      lists.push(got)
      if (env.page?.has_more && env.page.cursor) next.set(a, env.page.cursor)
      return { account: a, error: null }
    })
    const failed = results.find((r) => r.error)
    const ok = results.some((r) => !r.error)
    const merged = joinCursors(list, next)
    return { ok, items: roundRobin(lists), cursor: merged, hasMore: merged != null, error: failed?.error ?? null, results }
  }

  /** 请求回来（且没过期）后：按每个账号的成败标记 / 解除失效；部分账号出错时弹提示（全部出错由调用方整页报错） */
  function settleAccounts(platform: string, page: MultiPage) {
    for (const r of page.results) {
      if (!r.account) continue
      if (!r.error) markExpired(platform, r.account, false)
      else if (/^AUTH_(EXPIRED|REQUIRED)$/.test(r.error.code)) markExpired(platform, r.account, true)
    }
    if (!page.ok) return
    for (const r of page.results) {
      if (!r.error) continue
      const who = webAccounts(platform).find((a) => a.account === r.account)?.user?.name || r.account
      toast(t('discover.toast.accountFailed', { platform: platformById(platform)!.name, account: who, error: errorTitle(r.error) }), 3200)
    }
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
    // 新的一次搜索：上一轮还在路上的请求（含翻页）都已作废，直接取消
    if (!append) abortSingle()
    const signal = singleCtl.signal
    const t0 = performance.now()
    const platform = state.platform
    const accs = accountsFor(platform)
    if (!append) {
      clampFilters()
      syncUrl()
      error.value = null
      if (shownPlatform !== platform) {
        shownPlatform = platform
        const snap = channels.get(platform)
        // ++seq 已经让还在路上的旧请求作废，加载状态在这里收起
        if (snap && snap.key === channelKey(synced!, accs)) {
          loading.value = loadingMore.value = false
          return restoreChannel(snap)
        }
        resetResults()
      }
    }
    append ? (loadingMore.value = true) : (loading.value = true)
    // 缓存按已提交的查询记（输入框里正在打的关键词不算）
    const query = { ...synced!, platform }
    const key = channelKey(query, accs)
    try {
      const page = await fetchMulti(
        {
          platform: state.platform,
          keyword: state.keyword.trim(),
          mode: meta.mode,
          sort: state.sort,
          type: state.type,
          kind: state.kind,
          time: state.time,
          city: cityFor(platform, query.city),
          mteam: mteamQuery(platform, query),
          // 每页条数取设置，改了之后下一次请求（含翻页）生效
          limit: settings.pageSize,
        },
        accs,
        cursor.value,
        append,
        signal,
      )
      if (id !== seq) return // 已经有更新的请求
      settleAccounts(platform, page)
      if (!page.ok) {
        error.value = page.error
        if (!append) {
          items.value = []
          channels.delete(platform)
          // 上一个查询的翻页状态不再对应：不收起的话哨兵仍可见，会拿旧 cursor 反复翻页、反复报错
          cursor.value = null
          hasMore.value = false
        }
        return
      }
      if (!append) {
        seenIds = new Set()
        selection.none() // 换了一批结果，原来的选择不再对应
      }
      const fresh = dedupe(page.items)
      // 换成新数组（而不是 push），瀑布流的 computed / watch 才会更新
      items.value = append ? [...items.value, ...fresh] : fresh
      cursor.value = page.cursor
      hasMore.value = page.hasMore
      elapsed.value = (performance.now() - t0) / 1000
      channels.set(platform, {
        key,
        accounts: accs,
        sort: query.sort,
        type: query.type,
        kind: query.kind,
        time: query.time,
        keyword: query.keyword,
        city: cityFor(platform, query.city),
        mt: mteamQuery(platform, query),
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
      // 取消只发生在请求作废之后；保险起见，取消一律不当成错误
      if (id !== seq || isAbort(e)) return
      error.value = { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null }
      if (!append) {
        cursor.value = null
        hasMore.value = false
      }
    } finally {
      if (id === seq) loading.value = loadingMore.value = false
    }
  }

  // 单一模式下出错后不自动翻页：每次加载结束哨兵都会重新 observe，出错还接着翻就会无限重试、「加载中」高频闪烁。
  // 由用户点重试 / 刷新 / 换筛选重新开始（新一次搜索会先清掉 error）
  const loadMore = () => !loadingMore.value && (aggregate.value || !error.value) && view.hasMore.value && run(true)

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
    const accs = accountsFor(id)
    const q = {
      platform: id,
      keyword: s.keyword.trim(),
      sort: effective(id, 'sort', s.sort),
      type: effective(id, 'type', s.type),
      kind: effective(id, 'kind', s.kind),
      time: effective(id, 'time', s.time),
      city: cityFor(id, s.city),
      mtMode: s.mtMode,
      mtCategory: s.mtCategory,
      mtFree: s.mtFree,
    }
    return { ...q, mt: mteamQuery(id, q), accounts: accs, key: channelKey(q, accs) }
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
      accounts: q.accounts,
      sort: q.sort,
      type: q.type,
      kind: q.kind,
      time: q.time,
      keyword: q.keyword,
      city: q.city,
      mt: q.mt,
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
      abortSingle()
      loading.value = loadingMore.value = false
      error.value = null
      aggregate.value = true
    }
    const old = lanes.value
    for (const l of old) if (!want.includes(l.platform)) invalidateLane(l)
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
      invalidateLane(l)
      if (!l.key || l.error || l.loading || !l.items.length) continue
      channels.set(l.platform, {
        key: l.key,
        accounts: l.accounts,
        sort: l.sort,
        type: l.type,
        kind: l.kind,
        time: l.time,
        keyword: l.keyword,
        city: l.city,
        mt: l.mt,
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
    // 重新加载第一页：这个渠道上一轮的请求（含翻页）都已作废，直接取消；翻页沿用当前这一轮的
    let ctl = laneCtl.get(lane)
    if (!append || !ctl) {
      ctl?.abort()
      ctl = new AbortController()
      laneCtl.set(lane, ctl)
    }
    const signal = ctl.signal
    const t0 = performance.now()
    const live = () => id === lane.seq && lanes.value.includes(lane)
    const fail = (e: CatbusError | null) => {
      // 翻页出错：这个渠道不再继续翻（否则滚到底会一直重试），已有的卡片保留
      if (append) lane.hasMore = false
      else {
        Object.assign(lane, { error: e, items: [], cursor: null, hasMore: false, seen: new Set() })
        channels.delete(lane.platform)
      }
      toast(t('discover.toast.laneFailed', { platform: platformById(lane.platform)!.name, error: errorTitle(e) }), 3200)
    }
    if (!append) {
      const q = laneQuery(lane.platform)
      Object.assign(lane, { key: q.key, accounts: q.accounts, sort: q.sort, type: q.type, kind: q.kind, time: q.time, keyword: q.keyword, city: q.city, mt: q.mt, error: null, empty: 0 })
      lane.loading = true
    }
    try {
      const page = await fetchMulti(
        {
          platform: lane.platform,
          keyword: lane.keyword,
          mode: platformById(lane.platform)!.mode,
          sort: lane.sort,
          type: lane.type,
          kind: lane.kind,
          time: lane.time,
          city: lane.city,
          mteam: lane.mt,
          limit: settings.pageSize,
        },
        lane.accounts,
        lane.cursor,
        append,
        signal,
      )
      if (!live()) return false
      settleAccounts(lane.platform, page)
      if (!page.ok) {
        fail(page.error)
        return true
      }
      if (!append) lane.seen = new Set()
      const fresh = dedupe(page.items, lane.seen)
      for (const it of fresh) origin.set(it, lane.platform)
      lane.items = append ? [...lane.items, ...fresh] : fresh
      lane.cursor = page.cursor
      lane.hasMore = page.hasMore
      lane.elapsed = (performance.now() - t0) / 1000
      // 连续几页全是重复：平台在原地打转，不再翻
      lane.empty = append && !fresh.length ? lane.empty + 1 : 0
      if (lane.empty >= MAX_EMPTY_PAGES) lane.hasMore = false
      return true
    } catch (e) {
      // 被取消的请求不报错、不弹提示、不动渠道缓存和账号状态
      if (!live() || isAbort(e)) return false
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
    const before = new Map(accounts.value.map((a) => [`${a.platform}:${a.account}`, a.updated_at]))
    accounts.value = env?.ok && env.data ? env.data : []
    // 凭证更新过（重新登录）的账号不再算失效：失效的账号不参与请求，不在这里解除就永远等不到成功的那次
    for (const a of accounts.value) {
      const was = before.get(`${a.platform}:${a.account}`)
      if (was && was !== a.updated_at) markExpired(a.platform, a.account, false)
    }
  }

  /**
   * 勾选 / 取消一个账号（AGENTS.md 7.9「账号切换」）：至少保留一个（只剩一个时返回 false），失效的不能勾选。
   * 停一下再重新请求，连点几个账号只请求一次；聚合模式下只有这个渠道的查询变了，只重新请求它。
   */
  function toggleAccount(platform: string, account: string): boolean {
    const picked = selectedAccounts(platform)
    if (picked.includes(account)) {
      if (picked.length <= 1) return false
      browse[platform] = picked.filter((n) => n !== account)
    } else {
      if (expired.value.has(`${platform}:${account}`)) return false
      browse[platform] = [...picked, account]
    }
    scheduleSearch(ACCOUNT_DEBOUNCE_MS)
    return true
  }

  /** 设为默认（auth use）：不改变勾选，所以先把当前勾选固定下来（没勾选过时勾选跟着 _current 走） */
  async function setDefault(platform: string, account: string) {
    browse[platform] = chosenFor(platform)
    await useAccount(platform, account)
    await refreshAccounts()
  }

  /** 删除账号：从勾选里去掉；它正在参与请求时重新加载 */
  async function deleteAccount(platform: string, account: string) {
    const wasBrowsing = accountsFor(platform).includes(account)
    await removeAccount(platform, account)
    markExpired(platform, account, false)
    if (channels.get(platform)?.accounts.includes(account)) channels.delete(platform)
    if (browse[platform]) {
      browse[platform] = browse[platform]!.filter((n) => n !== account)
      if (!browse[platform]!.length) delete browse[platform]
    }
    await refreshAccounts()
    if (wasBrowsing) scheduleSearch()
  }

  /** 城市 chip 出不出现：单一模式下是猫眼，或聚合模式下选中了猫眼 */
  const cityFilter = computed(() => (aggregate.value ? lanes.value.some((l) => l.platform === CITY_PLATFORM) : state.platform === CITY_PLATFORM))
  /** 换城市（默认城市存成空串）；筛选的 watch 会重新请求 */
  function setCity(name: string) {
    state.city = name === DEFAULT_CITY ? '' : name
  }

  return {
    state,
    cityFilter,
    setCity,
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
    accountsFor,
    accountOf,
    selectedAccounts,
    toggleAccount,
    accounts,
    platform,
    health,
    isExpired,
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
    mteamOn,
    mtCategories,
    mtCategoriesError,
    setMtMode,
    setMtCategory,
    toggleMtFree,
    filters,
    initFilters,
    /** 发现页当前该在的地址（作者页回到发现页时用）；还没搜索过时为 null */
    discoverUrl: () => (synced ? urlFor(synced) : null),
  }
})
