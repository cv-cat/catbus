import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { MAX_SUBS, subsApi, type Sub, type SubKind, type SubsPaused } from '@/api/subs'
import { errorText } from '@/api/client'
import { platformById } from '@/data/platforms'
import { t } from '@/i18n'
import { isDemo } from './source'
import { useDiscoverStore } from './discover'
import { useSelectionStore } from './selection'
import { closeOverlays, isSubsPath, subsActive } from './route'
import { toast } from './toast'

/** 订阅页打开时重新读 /api/subs 的间隔 */
const POLL_MS = 60_000

/**
 * 订阅（AGENTS.md 7.9「订阅」）：关键词和作者，`catbus web` 的服务端定时检查，新内容记为未读。
 * 订阅存在服务端（~/.catbus/webui/subscriptions.json），这里只是读和改；演示模式在内存里模拟。
 * 地址 `/subs[?sub=<id>]`，同本地收藏一样盖在发现页上面。
 */
export const useSubsStore = defineStore('subs', () => {
  const discover = useDiscoverStore()
  const selection = useSelectionStore()

  const subs = shallowRef<Sub[]>([])
  const paused = shallowRef<Record<string, SubsPaused>>({})
  /** 读过一次 */
  const loaded = ref(false)
  const loading = ref(false)
  /** 读不到（服务不可用等）：订阅页显示错误 */
  const error = ref<string | null>(null)
  /** 正在立即检查 / 恢复的订阅 id、平台 */
  const checking = reactive(new Set<string>())
  const resuming = reactive(new Set<string>())
  /** 订阅 / 取消订阅还没回来的「平台 + 类型 + 查询」 */
  const pending = reactive(new Set<string>())

  const unreadTotal = computed(() => subs.value.reduce((n, s) => n + s.unread.length, 0))
  const keyOf = (platform: string, kind: SubKind, query: string) => `${platform}\n${kind}\n${query}`
  const find = (platform: string, kind: SubKind, query: string) =>
    subs.value.find((s) => s.platform === platform && s.kind === kind && s.query === query) ?? null

  // ---------- 能力：平台 web 端的 item search（关键词）/ user items（作者）已实现 ----------
  /** 读不到能力表时：演示模式放行，否则不显示按钮 */
  function can(platform: string, kind: SubKind): boolean {
    const f = discover.filters?.[platform]
    if (!f) return discover.filters ? false : isDemo()
    return kind === 'keyword' ? f.search : Boolean(f.author)
  }

  // ---------- 读 ----------
  let seq = 0
  async function refresh() {
    const my = ++seq
    loading.value = true
    try {
      const s = await subsApi.list()
      if (my !== seq) return
      subs.value = s.subs
      paused.value = s.paused
      error.value = null
      loaded.value = true
      if (selected.value && !subs.value.some((x) => x.id === selected.value)) setSelected(null)
    } catch (e) {
      if (my === seq) error.value = errorText(e)
    } finally {
      if (my === seq) loading.value = false
    }
  }
  /** 替换一条（立即检查、标为已读的返回值） */
  function put(sub: Sub) {
    const i = subs.value.findIndex((x) => x.id === sub.id)
    subs.value = i < 0 ? [...subs.value, sub] : subs.value.map((x, j) => (j === i ? sub : x))
  }

  // ---------- 订阅 / 取消 ----------
  /** 已订阅时取消，否则订阅；返回之后是否处于已订阅 */
  async function toggle(platform: string, kind: SubKind, query: string, label?: string | null): Promise<boolean> {
    const k = keyOf(platform, kind, query)
    if (pending.has(k)) return !!find(platform, kind, query)
    const old = find(platform, kind, query)
    pending.add(k)
    try {
      if (old) {
        await subsApi.remove(old.id)
        subs.value = subs.value.filter((s) => s.id !== old.id)
        if (selected.value === old.id) setSelected(null)
        toast(t('subs.toast.removed', { name: old.label }))
        return false
      }
      if (subs.value.length >= MAX_SUBS) {
        toast(t('subs.toast.full', { n: MAX_SUBS }, MAX_SUBS), 3200)
        return false
      }
      const sub = await subsApi.add({
        platform,
        kind,
        query,
        label: label?.trim().slice(0, 100) || undefined,
        account: discover.accountFor(platform)?.account ?? null,
      })
      put(sub)
      toast(t('subs.toast.added', { name: sub.label }), 4000, { label: t('subs.toast.view'), run: () => open(sub.id) })
      return true
    } catch (e) {
      toast(t('subs.toast.failed', { reason: errorText(e) }), 3600)
      return !!old
    } finally {
      pending.delete(k)
    }
  }
  async function remove(id: string) {
    const s = subs.value.find((x) => x.id === id)
    if (s) await toggle(s.platform, s.kind, s.query)
  }

  async function markRead(id: string) {
    const s = subs.value.find((x) => x.id === id)
    if (!s?.unread.length) return
    try {
      put(await subsApi.read(id))
    } catch (e) {
      toast(errorText(e), 3200)
    }
  }
  async function checkNow(id: string) {
    if (checking.has(id)) return
    checking.add(id)
    const before = subs.value.find((x) => x.id === id)?.unread.length ?? 0
    try {
      const s = await subsApi.check(id)
      put(s)
      // 检查可能让平台暂停（风控）：一并重新读一次
      if (s.error) await refresh()
      else {
        const n = s.unread.length - before
        toast(n > 0 ? t('subs.toast.checkedNew', { n }, n) : t('subs.toast.checkedNone'))
      }
    } catch (e) {
      toast(errorText(e), 3200)
      await refresh()
    } finally {
      checking.delete(id)
    }
  }
  async function resume(platform: string) {
    if (resuming.has(platform)) return
    resuming.add(platform)
    try {
      await subsApi.resume(platform)
      const next = { ...paused.value }
      delete next[platform]
      paused.value = next
      toast(t('subs.toast.resumed', { platform: platformById(platform)?.name ?? platform }))
      // 服务端恢复后马上检查这个平台到期的订阅：稍后再读一次
      setTimeout(() => void refresh(), 3000)
    } catch (e) {
      toast(errorText(e), 3200)
    } finally {
      resuming.delete(platform)
    }
  }

  // ---------- 页面与地址 ----------
  const active = subsActive
  const selected = ref<string | null>(subFromUrl())
  function subFromUrl(): string | null {
    return isSubsPath() ? new URLSearchParams(location.search).get('sub') : null
  }
  function toUrl(id: string | null) {
    const parts: string[] = []
    if (new URLSearchParams(location.search).has('demo')) parts.push('demo')
    if (id) parts.push(`sub=${encodeURIComponent(id)}`)
    return `/subs${parts.length ? `?${parts.join('&')}` : ''}`
  }
  function push(id: string | null) {
    const next = toUrl(id)
    if (next !== location.pathname + location.search) history.pushState(null, '', next)
  }
  function open(id: string | null = null) {
    if (!active.value) {
      closeOverlays()
      active.value = true
    }
    selected.value = id ?? selected.value
    push(selected.value)
  }
  function leave() {
    active.value = false
  }
  function setSelected(id: string | null) {
    if (selected.value === id) return
    selected.value = id
    selection.none()
    if (active.value) push(id)
  }
  addEventListener('popstate', () => {
    if (!isSubsPath()) return void (active.value = false)
    active.value = true
    selected.value = subFromUrl()
  })

  // 订阅页打开时每 60 秒重新读一次；页面切到后台时不读
  let timer: ReturnType<typeof setInterval> | undefined
  function poll(on: boolean) {
    clearInterval(timer)
    timer = undefined
    if (on) timer = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
  }
  watch(active, (on) => {
    poll(on)
    if (on) void refresh()
  })
  /** 启动时（探测完数据来源之后）读一次：侧栏要显示未读总数 */
  async function init() {
    poll(active.value)
    await refresh()
  }

  return {
    subs,
    paused,
    loaded,
    loading,
    error,
    checking,
    resuming,
    pending,
    unreadTotal,
    find,
    can,
    init,
    refresh,
    toggle,
    remove,
    markRead,
    checkNow,
    resume,
    active,
    selected,
    open,
    leave,
    setSelected,
  }
})
