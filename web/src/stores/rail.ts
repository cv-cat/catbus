import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import { getRoute, searchStations, searchTickets, searchTransfers } from '@/api/rail'
import { isAbort } from '@/api/client'
import type { CatbusError, Envelope, Station, Stop, Ticket, Transfer } from '@/api/types'
import {
  DATE_SPAN,
  addDays,
  dayIndex,
  inRange,
  kindOf,
  sortTickets,
  sortTransfers,
  todayIso,
  type DirectSort,
  type TrainKind,
  type TransferSort,
} from '@/composables/rail'
import { authorRoute, isRailPath, meActive, railActive } from './route'
import { isDemo } from './source'
import { useSelectionStore } from './selection'

/**
 * 12306 查询页（AGENTS.md 7.9「12306 查询页」）：表单、直达 / 中转结果、经停，地址 `/12306?from&to&date&view&via`。
 * 结果按查询在本页会话里缓存（只在内存里）；新的查询取消还在路上的旧请求。
 */

export type RailView = 'direct' | 'transfer'
export interface StationField {
  name: string
  /** 电报码：选过联想项、或查询结果里认出来时才有 */
  code: string | null
}
export interface RailQuery {
  from: string
  to: string
  date: string
}

/** 上次查询的两个站（地址里没有时用来填表单） */
const LAST_KEY = 'catbus.rail'
function readLast(): { from: string; to: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as { from?: unknown; to?: unknown } | null
    return typeof v?.from === 'string' && typeof v.to === 'string' ? { from: v.from, to: v.to } : null
  } catch {
    return null
  }
}
function writeLast(q: RailQuery) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ from: q.from, to: q.to }))
  } catch {
    /* 隐私模式：下次不记得，忽略 */
  }
}

interface UrlState {
  query: RailQuery | null
  date: string
  view: RailView
  via: string | null
}
function fromUrl(): UrlState {
  const q = new URLSearchParams(location.search)
  const from = q.get('from')?.trim() ?? ''
  const to = q.get('to')?.trim() ?? ''
  const raw = q.get('date') ?? ''
  const date = inRange(raw) ? raw : todayIso()
  return {
    query: from && to ? { from, to, date } : null,
    date,
    view: q.get('view') === 'transfer' ? 'transfer' : 'direct',
    via: q.get('via')?.trim() || null,
  }
}

/** `?demo` 原样保留在最前；今天省略 date，直达省略 view，不限中转站省略 via */
function toUrl(q: RailQuery | null, view: RailView, via: string | null): string {
  const parts: string[] = []
  if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
  if (q) {
    parts.push(`from=${encodeURIComponent(q.from)}`, `to=${encodeURIComponent(q.to)}`)
    if (q.date !== todayIso()) parts.push(`date=${q.date}`)
  }
  if (view === 'transfer') parts.push('view=transfer')
  if (view === 'transfer' && via) parts.push(`via=${encodeURIComponent(via)}`)
  return `/12306${parts.length ? `?${parts.join('&')}` : ''}`
}

/** 一次查询（直达或中转）的结果 */
interface Result<T> {
  loading: boolean
  error: CatbusError | null
  data: T[] | null
  elapsed: number | null
}
const empty = <T>(): Result<T> => ({ loading: false, error: null, data: null, elapsed: null })

/** 经停：每趟车一份 */
export interface RouteState {
  loading: boolean
  error: CatbusError | null
  stops: Stop[] | null
}

const netError = (e: unknown): CatbusError => ({ code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })

export const useRailStore = defineStore('rail', () => {
  const selection = useSelectionStore()
  const init = fromUrl()
  const last = readLast()
  const demoDefault = isDemo() || new URLSearchParams(location.search).has('demo')
  const seedFrom = init.query?.from ?? last?.from ?? (demoDefault ? '北京南' : '') // i18n-ignore
  const seedTo = init.query?.to ?? last?.to ?? (demoDefault ? '上海虹桥' : '') // i18n-ignore

  /** 表单（输入框里正在改的） */
  const form = reactive({
    from: { name: seedFrom, code: null } as StationField,
    to: { name: seedTo, code: null } as StationField,
    date: init.date,
  })
  /** 已提交的查询（结果对应它）；没查过时为 null */
  const query = shallowRef<RailQuery | null>(init.query)
  const view = ref<RailView>(init.view)
  /** 中转站：null 为不限 */
  const via = ref<string | null>(init.via)

  /** 车型（空集合表示全部）、只看有票、排序：在页面里筛和排，不进地址 */
  const kinds = ref<Set<TrainKind>>(new Set())
  const available = ref(false)
  const directSort = ref<DirectSort>('early')
  const transferSort = ref<TransferSort>('fast')

  const active = railActive

  // ---------- 结果与缓存 ----------
  const cache = new Map<string, Result<Ticket> | Result<Transfer>>()
  const directKey = (q: RailQuery) => JSON.stringify(['d', q.from, q.to, q.date])
  const transferKey = (q: RailQuery, v: string | null) => JSON.stringify(['t', q.from, q.to, q.date, v ?? ''])

  const direct = shallowRef<Result<Ticket>>(empty())
  const transfer = shallowRef<Result<Transfer>>(empty())
  /** 当前查询开始的时刻（加载中跳动的耗时） */
  const startedAt = ref(0)
  let ctl = new AbortController()
  let seq = 0

  async function load<T>(
    kind: 'direct' | 'transfer',
    key: string,
    fetcher: (signal: AbortSignal) => Promise<Envelope<T[]>>,
    force: boolean,
  ) {
    const target = (kind === 'direct' ? direct : transfer) as unknown as { value: Result<T> }
    const hit = cache.get(key) as Result<T> | undefined
    if (hit && !force && !hit.error) {
      target.value = hit
      return
    }
    ctl.abort()
    ctl = new AbortController()
    const id = ++seq
    const signal = ctl.signal
    startedAt.value = performance.now()
    // 换了查询：先清空（显示骨架）；同一查询刷新时旧结果留着、变淡
    target.value = { ...(force && hit ? hit : empty<T>()), loading: true, error: null }
    const t0 = performance.now()
    let next: Result<T>
    try {
      const env = await fetcher(signal)
      if (id !== seq) return
      next = env.ok
        ? { loading: false, error: null, data: env.data ?? [], elapsed: (performance.now() - t0) / 1000 }
        : { loading: false, error: env.error ?? { code: 'ERROR', message: '', hint: null, detail: null }, data: null, elapsed: null }
    } catch (e) {
      if (id !== seq || isAbort(e)) return
      next = { loading: false, error: netError(e), data: null, elapsed: null }
    }
    target.value = next
    if (!next.error) cache.set(key, next as Result<Ticket> | Result<Transfer>)
    else cache.delete(key)
    if (kind === 'direct') learnCodes(next.data as Ticket[] | null)
  }

  /** 当前视图（直达 / 中转）按已提交的查询加载；缓存里有就直接恢复 */
  function run(force = false) {
    const q = query.value
    if (!q) return
    if (view.value === 'direct') {
      void load('direct', directKey(q), (s) => searchTickets(q.from, q.to, q.date, s), force)
    } else {
      const v = via.value
      void load('transfer', transferKey(q, v), (s) => searchTransfers(q.from, q.to, q.date, v, s), force)
      // 「途经」的选项来自不限中转站时的结果：选了中转站之后也要有
      if (v && !cache.has(transferKey(q, null))) void preloadVias(q)
    }
  }

  /** 不限中转站的结果只用来列出「途经」的选项：不占当前的取消器、不显示加载 */
  const viaSource = shallowRef<Transfer[] | null>(null)
  async function preloadVias(q: RailQuery) {
    try {
      const env = await searchTransfers(q.from, q.to, q.date, null)
      if (!env.ok) return
      const r: Result<Transfer> = { loading: false, error: null, data: env.data ?? [], elapsed: null }
      cache.set(transferKey(q, null), r)
      if (query.value === q) viaSource.value = r.data
    } catch {
      /* 只是选项，取不到就只显示当前的中转站 */
    }
  }

  /** 结果回来后，认出表单里两个站的电报码（右侧小字） */
  function learnCodes(list: Ticket[] | null) {
    const q = query.value
    if (!list?.length || !q) return
    if (form.from.name === q.from && !form.from.code) form.from.code = list.find((x) => x.from.name === q.from)?.from.code ?? null
    if (form.to.name === q.to && !form.to.code) form.to.code = list.find((x) => x.to.name === q.to)?.to.code ?? null
  }

  // ---------- 地址 ----------
  function pushUrl() {
    const next = toUrl(query.value, view.value, via.value)
    if (next !== location.pathname + location.search) history.pushState(null, '', next)
  }

  /** 提交表单：返回空着的那一框（页面让它抖一下），都填了时返回 null */
  function submit(): 'from' | 'to' | null {
    const from = form.from.name.trim()
    const to = form.to.name.trim()
    if (!from) return 'from'
    if (!to) return 'to'
    if (!inRange(form.date)) form.date = todayIso()
    const q = { from, to, date: form.date }
    const same = query.value && JSON.stringify(query.value) === JSON.stringify(q)
    if (!same) via.value = null
    query.value = q
    viaSource.value = null
    writeLast(q)
    pushUrl()
    run(Boolean(same))
    return null
  }

  /** 换日期：两个站都填了就直接查询 */
  function setDate(iso: string) {
    if (!inRange(iso)) return
    form.date = iso
    if (form.from.name.trim() && form.to.name.trim()) submit()
  }

  function swap() {
    const a = form.from
    form.from = form.to
    form.to = a
  }

  function setView(v: RailView) {
    if (view.value === v) return
    view.value = v
    pushUrl()
    run()
  }

  function setVia(v: string | null) {
    if (via.value === v) return
    via.value = v
    pushUrl()
    run()
  }

  /** 刷新：按已提交的查询重新请求，替换缓存 */
  const refresh = () => run(true)

  // ---------- 筛选与排序（页面里做） ----------
  function toggleKind(k: TrainKind | 'all') {
    if (k === 'all') return void (kinds.value = new Set())
    const next = new Set(kinds.value)
    next.has(k) ? next.delete(k) : next.add(k)
    // 全部选上等于全部
    kinds.value = next.size === 7 ? new Set() : next
  }
  const clearFilters = () => {
    kinds.value = new Set()
    available.value = false
  }
  const filtering = computed(() => kinds.value.size > 0 || available.value)

  const tickets = computed(() => {
    const list = direct.value.data ?? []
    const shown = list.filter((x) => (!kinds.value.size || kinds.value.has(kindOf(x.type))) && (!available.value || x.has_ticket))
    return sortTickets(shown, directSort.value)
  })
  const plans = computed(() => sortTransfers(transfer.value.data ?? [], transferSort.value))
  /** 结果里有和查询不同名的车站（同城车站） */
  const sameCity = computed(() => {
    const q = query.value
    return Boolean(q && direct.value.data?.some((x) => x.from.name !== q.from || x.to.name !== q.to))
  })
  /** 「途经」的选项：不限中转站时结果里出现过的中转站（选中的那个总在里面） */
  const vias = computed(() => {
    const q = query.value
    const src = q ? ((cache.get(transferKey(q, null)) as Result<Transfer> | undefined)?.data ?? viaSource.value ?? []) : []
    // 读一下 transfer，让不限中转站的结果回来后选项跟着更新
    void transfer.value
    const names = [...new Set(src.map((x) => x.via))]
    if (via.value && !names.includes(via.value)) names.unshift(via.value)
    return names
  })

  // ---------- 经停 ----------
  const routes = reactive(new Map<string, RouteState>())
  const routeKey = (x: Ticket) => JSON.stringify([x.train_no, x.from.code, x.to.code, x.date])
  /** 展开的车次（按 `车次@出发站`），同一时间可以展开多行 */
  const expanded = ref(new Set<string>())
  const rowKey = (x: Ticket) => `${x.id}@${x.from.code}@${x.date}`

  async function loadRoute(x: Ticket, force = false) {
    const key = routeKey(x)
    const hit = routes.get(key)
    if (hit && !force && (hit.loading || hit.stops)) return
    routes.set(key, { loading: true, error: null, stops: null })
    try {
      const env = await getRoute(x)
      routes.set(key, env.ok ? { loading: false, error: null, stops: env.data ?? [] } : { loading: false, error: env.error, stops: null })
    } catch (e) {
      routes.set(key, { loading: false, error: netError(e), stops: null })
    }
  }
  function toggleRow(x: Ticket) {
    const k = rowKey(x)
    const next = new Set(expanded.value)
    if (next.has(k)) next.delete(k)
    else {
      next.add(k)
      void loadRoute(x)
    }
    expanded.value = next
  }
  const routeOf = (x: Ticket) => routes.get(routeKey(x)) ?? null

  // ---------- 进出查询页 ----------
  /** 侧栏点了 12306：进入查询页（作者页一并收起），地址换成查询页的 */
  function open() {
    if (active.value) return
    authorRoute.value = null
    meActive.value = false
    selection.none()
    active.value = true
    history.pushState(null, '', toUrl(query.value, view.value, via.value))
    if (query.value && !(view.value === 'direct' ? direct.value.data : transfer.value.data)) run()
  }
  /** 回到发现页：发现页随后的搜索写回自己的地址 */
  function leave() {
    active.value = false
  }
  /** 打开页面时（地址就是查询页）：地址里有查询就直接查 */
  function start() {
    if (active.value && query.value) run()
  }

  // 前进 / 后退：地址是查询页就按地址恢复（缓存里有就直接恢复），否则离开
  addEventListener('popstate', () => {
    if (!isRailPath()) return void (active.value = false)
    active.value = true
    const s = fromUrl()
    view.value = s.view
    via.value = s.via
    form.date = s.date
    query.value = s.query
    if (s.query) {
      form.from = { name: s.query.from, code: form.from.name === s.query.from ? form.from.code : null }
      form.to = { name: s.query.to, code: form.to.name === s.query.to ? form.to.code : null }
      run()
    }
  })

  // ---------- 车站联想 ----------
  const stationCache = new Map<string, Station[]>()
  let stationCtl: AbortController | null = null
  /** 只采用最后一次请求的结果；同一关键词在本页会话里缓存。返回 null 表示被更新的请求取代 */
  async function suggest(keyword: string): Promise<Station[] | null> {
    const kw = keyword.trim()
    if (!kw) return []
    const hit = stationCache.get(kw)
    if (hit) return hit
    stationCtl?.abort()
    const c = (stationCtl = new AbortController())
    try {
      const env = await searchStations(kw, c.signal)
      if (c !== stationCtl) return null
      const list = env.ok ? (env.data ?? []) : []
      if (env.ok) stationCache.set(kw, list)
      return list
    } catch (e) {
      if (isAbort(e) || c !== stationCtl) return null
      return []
    }
  }

  return {
    active,
    form,
    query,
    view,
    via,
    kinds,
    available,
    directSort,
    transferSort,
    direct,
    transfer,
    startedAt,
    tickets,
    plans,
    sameCity,
    vias,
    filtering,
    expanded,
    rowKey,
    routeOf,
    loadRoute,
    toggleRow,
    submit,
    setDate,
    swap,
    setView,
    setVia,
    refresh,
    toggleKind,
    clearFilters,
    open,
    leave,
    start,
    suggest,
    /** 日期选择器的范围 */
    lastDate: () => addDays(todayIso(), DATE_SPAN - 1),
    dayIndex,
  }
})
