import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { CatbusError, Live, LiveEvent } from '@/api/types'
import { getLive } from '@/api/extras'
import { listLiveHistory } from '@/api/live'
import { mockLiveEvent } from '@/api/mock/live'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'
import { closeOverlays, liveRoute, parseLivePath, type LiveRoute } from './route'

/**
 * 直播弹幕（AGENTS.md 7.9「直播弹幕」）：bridge 的 `/api/live/*` 起 `live listen`，SSE 收事件。
 * 页面只保留最近 LIVE_KEEP 条；暂停时事件先攒着，继续时一起显示（不断开连接）。
 */
export const LIVE_KEEP = 2000
export const LIVE_TYPES = ['chat', 'gift', 'like', 'enter', 'follow', 'other'] as const
export type LiveType = (typeof LIVE_TYPES)[number]
export const LIVE_DURATIONS = ['', '600', '1800', '3600'] as const
export type LiveDuration = (typeof LIVE_DURATIONS)[number]

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'ended'
export type EndReason = 'done' | 'stopped' | 'error' | 'disconnected'
export interface ShownEvent extends LiveEvent {
  seq: number
}

/** 直播间输入：粘贴的是 App 的分享文案时取出其中的链接，其余原样（去掉首尾空白） */
export function roomRef(input: string): string {
  const s = input.trim()
  if (/^https?:\/\/\S+$/.test(s) || !/\s/.test(s)) return s
  // 链接后面常紧跟中文或分享口令，只取 URL 允许的字符
  return /https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/.exec(s)?.[0] ?? s
}

export const useLiveStore = defineStore('live', () => {
  const discover = useDiscoverStore()
  const route = liveRoute
  const active = computed(() => route.value != null)
  const platform = computed(() => route.value?.platform ?? '')

  const hasLive = (id: string) => Boolean(discover.filters?.[id]?.live)
  const hasLiveGet = (id: string) => Boolean(discover.filters?.[id]?.liveGet)
  const hasLiveMedia = (id: string) => Boolean(discover.filters?.[id]?.liveMedia)
  const account = () => (route.value ? (discover.accountFor(route.value.platform)?.account ?? null) : null)
  const hasAccount = computed(() => discover.accounts.some((a) => a.platform === platform.value))
  /** 本页浏览用的账号已失效 */
  const expired = computed(() => {
    const a = route.value ? discover.accountFor(route.value.platform) : null
    return Boolean(a && discover.isExpired(a))
  })

  const room = ref(route.value?.room ?? '')
  const duration = ref<LiveDuration>('')
  const status = ref<LiveStatus>('idle')
  const endReason = ref<EndReason | null>(null)
  const error = shallowRef<CatbusError | null>(null)
  const header = shallowRef<Live | null>(null)
  const headerError = shallowRef<CatbusError | null>(null)
  const events = shallowRef<ShownEvent[]>([])
  /** 进入直播间前的最近弹幕（`live history`）：放在事件流最前面，不计入条数、不进导出 */
  const recent = shallowRef<ShownEvent[]>([])
  /** 超出 LIVE_KEEP 丢掉的条数 */
  const dropped = ref(0)
  const paused = ref(false)
  let pending: ShownEvent[] = []
  const pendingCount = ref(0)
  const counts = reactive<Record<LiveType, number>>({ chat: 0, gift: 0, like: 0, enter: 0, follow: 0, other: 0 })
  /** 只看这些类型；空集表示全部 */
  const filter = ref<Set<LiveType>>(new Set())
  const startedAt = ref<number | null>(null)

  let seq = 0
  let session: string | null = null
  let es: EventSource | null = null
  let demoTimer: ReturnType<typeof setTimeout> | null = null
  let endTimer: ReturnType<typeof setTimeout> | null = null
  let run = 0

  /** 直播间实时数据（AGENTS.md 6.2 Event.stats）：在线人数、累计点赞；监听开始前为 null */
  const viewers = ref<number | null>(null)
  const likes = ref<number | null>(null)
  const statsOnly = (e: LiveEvent) => e.type === 'other' && Boolean(e.stats)

  const typeOf = (e: LiveEvent): LiveType => (LIVE_TYPES.includes(e.type as LiveType) ? (e.type as LiveType) : 'other')

  function flush(list: ShownEvent[]) {
    if (!list.length) return
    const next = events.value.concat(list)
    const over = next.length - LIVE_KEEP
    if (over > 0) dropped.value += over
    events.value = over > 0 ? next.slice(over) : next
  }
  function receive(e: LiveEvent) {
    if (e.stats?.viewers != null) viewers.value = e.stats.viewers
    if (e.stats?.likes != null) likes.value = Math.max(likes.value ?? 0, e.stats.likes)
    const ev = { ...e, seq: seq++ }
    // 只更新直播间数字的消息（在线人数、累计点赞）不进事件流，只留着导出
    // （暂停时也直接存进去：它们不显示，不算进「继续时补上的 N 条」）
    if (statsOnly(e)) return flush([ev])
    counts[typeOf(e)]++
    if (paused.value) {
      pending.push(ev)
      if (pending.length > LIVE_KEEP) {
        pending.shift()
        dropped.value++
      }
      pendingCount.value = pending.length
    } else flush([ev])
  }
  function setPaused(v: boolean) {
    paused.value = v
    if (!v) {
      flush(pending)
      pending = []
      pendingCount.value = 0
    }
  }

  function reset() {
    events.value = []
    recent.value = []
    pending = []
    pendingCount.value = 0
    dropped.value = 0
    paused.value = false
    seq = 0
    for (const k of LIVE_TYPES) counts[k] = 0
    viewers.value = likes.value = null
    error.value = null
    endReason.value = null
  }

  function closeTransport() {
    es?.close()
    es = null
    if (demoTimer) clearTimeout(demoTimer)
    if (endTimer) clearTimeout(endTimer)
    demoTimer = endTimer = null
  }
  function end(reason: EndReason, err: CatbusError | null = null) {
    closeTransport()
    session = null
    if (status.value === 'idle') return
    flush(pending)
    pending = []
    pendingCount.value = 0
    paused.value = false
    status.value = 'ended'
    endReason.value = reason
    error.value = err
  }

  async function loadHeader(id: number, p: string, r: string) {
    header.value = null
    headerError.value = null
    if (!hasLiveGet(p)) return
    try {
      const env = await getLive(p, r, account())
      if (id !== run) return
      if (env.ok) header.value = env.data
      else headerError.value = env.error
    } catch {
      // 头部取不到不影响监听
    }
  }

  async function loadHistory(id: number, p: string, r: string) {
    if (!discover.filters?.[p]?.liveHistory) return
    try {
      const env = await listLiveHistory(p, r, account())
      if (id !== run || !env.ok || !env.data?.length) return
      recent.value = env.data.filter((e) => !statsOnly(e)).map((e) => ({ ...e, seq: -1 - seq++ }))
    } catch {
      // 取不到不提示
    }
  }

  async function start() {
    const p = platform.value
    const r = roomRef(room.value)
    if (!p || !r || status.value === 'connecting' || status.value === 'live') return
    room.value = r
    stop(true)
    reset()
    const id = ++run
    route.value = { platform: p, room: r }
    const url = toUrl(route.value)
    if (url !== location.pathname + location.search) history.pushState(null, '', url)
    status.value = 'connecting'
    startedAt.value = Date.now()
    void loadHeader(id, p, r)
    void loadHistory(id, p, r)
    const ms = duration.value ? Number(duration.value) * 1000 : 0
    if (isDemo()) {
      status.value = 'live'
      const tick = () => {
        if (id !== run) return
        const n = 1 + Math.floor(Math.random() * 3)
        for (let i = 0; i < n; i++) receive(mockLiveEvent())
        demoTimer = setTimeout(tick, 300 + Math.random() * 300)
      }
      tick()
      if (ms) endTimer = setTimeout(() => id === run && end('done'), ms)
      return
    }
    try {
      const res = await fetch('/api/live/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: p, room: r, account: account(), duration: duration.value || null }),
      })
      const body = (await res.json()) as { ok: boolean; id?: string; error?: CatbusError }
      if (id !== run) return
      if (!body.ok || !body.id) return end('error', body.error ?? { code: 'BRIDGE', message: `HTTP ${res.status}`, hint: null, detail: null })
      session = body.id
      es = new EventSource(`/api/live/${body.id}/events`)
      es.onopen = () => id === run && status.value === 'connecting' && (status.value = 'live')
      es.onmessage = (m) => {
        if (id !== run) return
        if (status.value === 'connecting') status.value = 'live'
        try {
          receive(JSON.parse(m.data as string) as LiveEvent)
        } catch {
          // 不是一条完整的 JSON：丢掉
        }
      }
      es.addEventListener('end', (m) => {
        if (id !== run) return
        let info: { reason?: EndReason; error?: CatbusError | null } = {}
        try {
          info = JSON.parse((m as MessageEvent).data as string)
        } catch {
          // 结束原因读不出来：按断开处理
        }
        end(info.reason ?? 'disconnected', info.error ?? null)
      })
      // 断开时浏览器会自己重连（服务端 15 秒内可以续上）；彻底关闭时才算结束
      es.onerror = () => {
        if (id === run && es?.readyState === EventSource.CLOSED) end('disconnected')
      }
    } catch (e) {
      if (id === run) end('error', { code: 'NETWORK', message: (e as Error).message, hint: null, detail: null })
    }
  }

  /** 主动停止；`silent` 用于重新开始、离开页面时（不显示结束原因） */
  function stop(silent = false) {
    const s = session
    closeTransport()
    session = null
    if (s) void fetch(`/api/live/${s}/stop`, { method: 'POST' }).catch(() => {})
    if (silent) {
      run++
      status.value = 'idle'
      return
    }
    if (status.value === 'connecting' || status.value === 'live') end('stopped')
  }

  function toggleType(k: LiveType) {
    const next = new Set(filter.value)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    filter.value = next
  }
  const shownRecent = computed(() => recent.value.filter((e) => !filter.value.size || filter.value.has(typeOf(e))))
  const shown = computed(() =>
    events.value.filter((e) => !statsOnly(e) && (!filter.value.size || filter.value.has(typeOf(e)))),
  )
  /** 事件流里的条数（不含只更新直播间数字的消息） */
  const total = computed(() => LIVE_TYPES.reduce((s, k) => s + counts[k], 0))

  /** 按 CLI 的 jsonl 格式交给浏览器 */
  function exportJsonl() {
    const all = events.value.concat(pending)
    if (!all.length) return
    const body = all.map(({ seq: _seq, ...e }) => JSON.stringify(e)).join('\n') + '\n'
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/x-ndjson' }))
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    a.download = `catbus-${platform.value}-live-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.jsonl`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // ---------- 地址 ----------
  function toUrl(r: LiveRoute) {
    const parts: string[] = []
    if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
    if (r.room) parts.push(`room=${encodeURIComponent(r.room)}`)
    return `/${encodeURIComponent(r.platform)}/live${parts.length ? `?${parts.join('&')}` : ''}`
  }
  /** 停止后回到「发现直播间」：事件清空，地址去掉直播间 */
  function backToDiscover() {
    if (!route.value) return
    stop(true)
    reset()
    header.value = null
    room.value = ''
    route.value = { platform: route.value.platform, room: null }
    const url = toUrl(route.value)
    if (url !== location.pathname + location.search) history.pushState(null, '', url)
  }

  function open(id: string) {
    if (!hasLive(id)) return
    if (route.value?.platform === id) return
    stop(true)
    closeOverlays()
    header.value = null
    reset()
    room.value = ''
    route.value = { platform: id, room: null }
    history.pushState(null, '', toUrl(route.value))
  }
  function leave() {
    if (!route.value) return
    stop(true)
    route.value = null
  }
  addEventListener('popstate', () => {
    const r = parseLivePath()
    if (!r) return void leave()
    if (r.platform !== route.value?.platform || r.room !== route.value?.room) stop(true)
    route.value = r
    room.value = r.room ?? ''
  })
  // 发现页换了平台：离开
  watch(
    () => discover.state.platform,
    (p) => route.value && p !== route.value.platform && leave(),
  )
  addEventListener('pagehide', () => stop(true))
  // 别的页（「我的」、作者页……）收起了直播页：连接一并断掉
  watch(route, (r, old) => old && !r && stop(true))

  return {
    route,
    active,
    platform,
    hasLive,
    hasLiveMedia,
    hasAccount,
    expired,
    account,
    room,
    duration,
    status,
    endReason,
    error,
    header,
    headerError,
    events,
    recent,
    shown,
    shownRecent,
    dropped,
    paused,
    pendingCount,
    counts,
    total,
    viewers,
    likes,
    filter,
    startedAt,
    start,
    stop,
    setPaused,
    toggleType,
    exportJsonl,
    open,
    leave,
    backToDiscover,
  }
})
