<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Layers, Lock, LogIn, Plus, RotateCw, Star, Trash2 } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import type { Account } from '@/api/types'
import type { PlatformMeta } from '@/data/platforms'
import type { Health } from '@/stores/discover'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { since } from '@/composables/format'
import { useBreakpoint } from '@/composables/useBreakpoint'
import BottomSheet from './BottomSheet.vue'
import { imgSrc } from '@/api/client'

/** 收起时显示几个账号；展开后超过这么多个就改成滚动 */
const COLLAPSED = 3
const MAX_VISIBLE = 10
/** 超过这么多个渠道时 Tab 改成一行横排、两侧出现箭头（设计稿 T ③） */
const TABS_FLAT = 3
/** 「至少保留一个账号」的提示显示多久 */
const LOCK_TIP_MS = 2000

const props = defineProps<{
  /** 弹窗里的渠道 Tab：聚合模式下是选中的渠道（按点选顺序），单一模式下只有当前平台 */
  platforms: PlatformMeta[]
  /** 当前平台（聚合模式下是最后点选的渠道），弹窗打开时停在它的 Tab 上 */
  focus: PlatformMeta
  aggregate: boolean
  /** 全部账号（各平台、各端），组件里按平台取 web 端的 */
  accounts: Account[]
  /** 某个平台打勾的账号（勾选的里面没失效的） */
  selectedOf: (platform: string) => string[]
  /** 某个平台请求实际用的账号（都失效时仍是第一个），账号卡显示它们 */
  browsingOf: (platform: string) => string[]
  isExpired: (a: Account) => boolean
  health: Map<string, Health>
  source: 'live' | 'demo'
  /** 平板的图标窄栏：只显示头像（带状态点），账号列表从侧栏右侧弹出 */
  rail?: boolean
}>()
const emit = defineEmits<{
  toggle: [platform: string, account: string]
  setDefault: [platform: string, account: string]
  login: [platform: string, account?: string]
  remove: [platform: string, account: string, done: (ok: boolean) => void]
}>()

const { t } = useI18n()
const open = ref(false)
const expanded = ref(false)
const root = ref<HTMLElement>()
const rows = ref<HTMLElement>()
const pending = ref<string | null>(null)
const panelEl = ref<HTMLElement>()

const bp = useBreakpoint()
/** 手机：侧栏是抽屉，账号列表改成底部弹层（BottomSheet） */
const sheet = computed(() => bp.phone)
/** 窄栏：列表浮在侧栏右侧，挂到 body 上，按账号卡的位置定位 */
const floating = computed(() => Boolean(props.rail) && !sheet.value)
const floatStyle = ref<Record<string, string>>({})
function placeFloat() {
  const r = root.value?.getBoundingClientRect()
  if (!r || !floating.value) return
  const left = Math.round(r.right + 10)
  floatStyle.value = {
    left: `${left}px`,
    bottom: `${Math.max(8, Math.round(innerHeight - r.bottom))}px`,
    width: `${Math.max(240, Math.min(340, innerWidth - left - 12))}px`,
    maxHeight: `${Math.max(200, Math.round(r.bottom - 12))}px`,
  }
}

const webOf = (id: string) => props.accounts.filter((a) => a.platform === id && a.endpoint === 'web')

// ---------- 渠道 Tab（聚合模式） ----------
/** 弹窗里正在看哪个渠道的账号；打开时停在当前平台 */
const tab = ref(props.focus.id)
const tabs = computed(() => (props.aggregate && props.platforms.length > 1 ? props.platforms : null))
const platform = computed(() => props.platforms.find((p) => p.id === tab.value) ?? props.focus)
const many = computed(() => (tabs.value?.length ?? 0) > TABS_FLAT)
const strip = ref<HTMLElement>()
const canLeft = ref(false)
const canRight = ref(false)
function onStrip() {
  const el = strip.value
  if (!el) return
  canLeft.value = el.scrollLeft > 1
  canRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
/** 两侧箭头：每次翻一屏（留一点重叠，看得出接续） */
function page(dir: -1 | 1) {
  const el = strip.value
  if (!el) return
  el.scrollBy({ left: dir * Math.max(80, el.clientWidth - 48), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}
/** 选中的 Tab 被遮住时滚到可见（不用 scrollIntoView，免得连页面一起滚） */
function revealTab() {
  const el = strip.value
  const t = el?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tab.value)}"]`)
  if (!el || !t) return
  const pad = 24
  if (t.offsetLeft - pad < el.scrollLeft) el.scrollLeft = Math.max(0, t.offsetLeft - pad)
  else if (t.offsetLeft + t.offsetWidth + pad > el.scrollLeft + el.clientWidth)
    el.scrollLeft = t.offsetLeft + t.offsetWidth + pad - el.clientWidth
  onStrip()
}
function pickTab(id: string) {
  if (tab.value === id) return
  tab.value = id
}
/** Tab 上的左右方向键 */
function onTabKey(e: KeyboardEvent) {
  const list = tabs.value
  if (!list || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  const i = list.findIndex((p) => p.id === tab.value)
  const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]!
  tab.value = next.id
  nextTick(() => strip.value?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next.id)}"]`)?.focus())
}
// 切 Tab：列表高度从旧的平滑过渡到新的，新列表的行按切换方向错落滑入（watch 在 DOM 更新前运行，先量旧高度）
watch(tab, async (next, prev) => {
  confirming.value = null
  lockTip.value = null
  expanded.value = false
  const from = rows.value?.getBoundingClientRect().height
  const ids = tabs.value?.map((p) => p.id) ?? []
  const dir = Math.sign(ids.indexOf(next) - ids.indexOf(prev)) || 1
  await nextTick()
  revealTab()
  rows.value?.scrollTo({ top: 0 })
  resize(true, from)
  if (!open.value || prefersReducedMotion()) return
  gsap.fromTo(
    [...(rows.value?.children ?? [])],
    { opacity: 0, x: dir * 16 },
    { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out', stagger: 0.035, clearProps: 'opacity,transform' },
  )
})
// 选中的渠道变了（去掉了正在看的那个）：回到当前平台
watch(
  () => props.platforms.map((p) => p.id).join(','),
  async () => {
    if (!props.platforms.some((p) => p.id === tab.value)) tab.value = props.focus.id
    await nextTick()
    onStrip()
  },
)

// ---------- 账号列表 ----------
const list = computed(() => webOf(platform.value.id))
const picked = computed(() => props.selectedOf(platform.value.id))
const isPicked = (a: Account) => picked.value.includes(a.account)
/** 只剩这一个勾选的账号：复选框锁定 */
const isLocked = (a: Account) => picked.value.length <= 1 && isPicked(a)

const canExpand = computed(() => !sheet.value && list.value.length > COLLAPSED)
const scrollable = computed(() => expanded.value && list.value.length > MAX_VISIBLE)
const atBottom = ref(false)

const PALETTE = ['#E8414F', '#3B6FE0', '#2E9E6A', '#8E5BD9', '#E07A2E', '#C9A227', '#1F8FA8', '#B4486B']
function color(a: Account) {
  if (a.current) return 'var(--navy)'
  let h = 0
  for (const c of a.user?.id ?? a.account) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const nick = (a: Account | null) => a?.user?.name || a?.account || ''

/** 加载失败的头像地址，回退到首字母 */
const broken = ref(new Set<string>())
const avatarOf = (a: Account | null) => {
  const url = a?.user?.avatar
  return url && !broken.value.has(url) ? url : null
}
function onAvatarError(url: string) {
  broken.value = new Set(broken.value).add(url)
}

/** 正在浏览、默认在前，其余按最近登录；勾选不改变顺序（连续勾选时行不跳动） */
const sorted = computed(() =>
  [...list.value].sort((x, y) => Number(y.current) - Number(x.current) || Date.parse(y.updated_at) - Date.parse(x.updated_at)),
)

// ---------- 侧栏底部的账号卡 ----------
/** 当前平台请求用的账号（单一模式的账号卡、窄栏的头像都看它） */
const browsing = computed(() => {
  const all = webOf(props.focus.id)
  return props.browsingOf(props.focus.id).flatMap((n) => all.filter((a) => a.account === n))
})
const first = computed(() => browsing.value[0] ?? null)
/** 失效账号的总数 */
const badTotal = (bad: { bad: number }[]) => bad.reduce((s, x) => s + x.bad, 0)
/** 账号卡的内容：聚合模式汇总选中的渠道，单一模式是当前平台勾选的账号 */
const card = computed(() => {
  const ps = tabs.value
  if (ps) {
    const per = ps.map((p) => ({ p, n: props.browsingOf(p.id).length, bad: props.health.get(p.id)?.bad ?? 0 }))
    const total = per.reduce((s, x) => s + x.n, 0)
    const bad = per.filter((x) => x.bad)
    return {
      kind: 'agg' as const,
      logos: ps.slice(0, 3),
      more: Math.max(0, ps.length - 3),
      name: t('account.card.aggName', { channels: ps.length, n: total }, total),
      sub: bad.length
        ? t('account.card.expired', { platforms: bad.map((x) => x.p.name).join(t('account.sep')), n: badTotal(bad) }, badTotal(bad))
        : per.map((x) => `${x.p.name} ${x.n}`).join(' · '),
      warn: bad.length > 0,
      label: t('account.card.aggLabel', { channels: ps.length, n: total }, total),
    }
  }
  const accs = browsing.value
  return {
    kind: 'acc' as const,
    accs: accs.slice(0, 3),
    name: !accs.length
      ? t('account.card.notLoggedIn')
      : accs.length > 1
        ? t('account.card.many', { name: nick(accs[0]!), n: accs.length }, accs.length)
        : nick(accs[0]!),
    sub: accs.length > 1 ? t('account.card.manySub', { platform: props.focus.name, n: accs.length }, accs.length) : `${props.focus.name} · web`,
    warn: false,
    label: accs.length ? t('account.card.switchLabel', { names: accs.map(nick).join(t('account.sep')) }) : t('account.card.notLoggedInLabel'),
  }
})
/** 当前浏览账号的状态点（窄栏用） */
const status = computed(() => (!first.value ? null : props.isExpired(first.value) ? 'expired' : 'online'))

function toggle() {
  if (!tabs.value && !webOf(props.focus.id).length) return emit('login', props.focus.id)
  open.value = !open.value
}
function close() {
  open.value = false
}

/** 前 n 行的总高度（rows 是 position: relative，offsetTop 不受滚动影响） */
function heightFor(n: number): number {
  const el = rows.value
  const last = el?.children[Math.min(n, el.children.length) - 1] as HTMLElement | undefined
  return last ? last.offsetTop + last.offsetHeight : 0
}

/** 列表变高：带一点回弹（弹窗底边固定，列表向上撑开）；变矮：快出慢停，不回弹 */
const GROW = { duration: 0.55, ease: 'back.out(1.35)' }
const SHRINK = { duration: 0.42, ease: 'expo.out' }

/** 列表该有的高度：收起时前 3 行、展开时前 10 行；底部弹层自己会滚动，全部显示 */
function targetHeight(el: HTMLElement): number {
  if (!sheet.value) return heightFor(expanded.value ? MAX_VISIBLE : COLLAPSED)
  const prev = el.style.height
  el.style.height = 'auto'
  const h = el.offsetHeight
  el.style.height = prev
  return h
}

/**
 * 按内容重算列表高度。`from` 是内容变化之前量的高度（切 Tab、进出删除确认这类会换掉行的变化要先量）；
 * 不给时取当前高度（桌面上列表的高度是写死的，内容变了它不变）。
 */
function resize(animated: boolean, from?: number) {
  const el = rows.value
  if (!el) return
  gsap.killTweensOf(el, 'height')
  const to = targetHeight(el)
  const start = from ?? el.getBoundingClientRect().height
  // 底部弹层动完后回到 auto，之后内容自然撑开
  const settle = () => void (sheet.value && gsap.set(el, { height: 'auto' }))
  if (!animated || !open.value || prefersReducedMotion() || Math.abs(to - start) < 1) {
    gsap.set(el, { height: sheet.value ? 'auto' : to })
    return
  }
  gsap.fromTo(el, { height: start }, { height: to, ...(to > start ? GROW : SHRINK), onComplete: settle })
}

/** 「N 个账号同时加载」提示条进出：高度和弹窗的间距一起展开 / 收起，进场带回弹 */
function mergeEnter(el: Element, done: () => void) {
  if (prefersReducedMotion()) return done()
  // 先量出完整高度（含内边距）再过渡；直接补间到 auto 时 GSAP 按 0 内边距解析，结束那一帧会跳
  const h = (el as HTMLElement).offsetHeight
  gsap.fromTo(
    el,
    { height: 0, opacity: 0, scale: 0.96, marginTop: -8, paddingTop: 0, paddingBottom: 0 },
    { height: h, opacity: 1, scale: 1, marginTop: 0, paddingTop: 8, paddingBottom: 8, ...GROW, clearProps: 'all', onComplete: done },
  )
}
function mergeLeave(el: Element, done: () => void) {
  if (prefersReducedMotion()) return done()
  gsap.to(el, { height: 0, opacity: 0, scale: 0.96, marginTop: -8, paddingTop: 0, paddingBottom: 0, duration: 0.32, ease: 'power3.inOut', onComplete: done })
}

function toggleExpand() {
  expanded.value = !expanded.value
  if (!expanded.value) rows.value?.scrollTo({ top: 0, behavior: 'smooth' })
  resize(true)
}

function onScroll() {
  const el = rows.value
  if (el) atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
}

/** 防连点：账号列表刷新回来（或 3 秒后）才解除 */
function setDefault(a: Account) {
  pending.value = a.account
  emit('setDefault', platform.value.id, a.account)
  setTimeout(() => (pending.value = null), 3000)
}

/** 删除账号：先在行内二次确认 */
const confirming = ref<string | null>(null)
const removing = ref<string | null>(null)
/** 有服务端登出的平台（AGENTS.md 5.3） */
const SERVER_LOGOUT = new Set(['bilibili', 'kuaishou'])
function askRemove(a: Account) {
  confirming.value = a.account
}
function cancelRemove() {
  confirming.value = null
}
function confirmRemove(a: Account) {
  removing.value = a.account
  emit('remove', platform.value.id, a.account, () => {
    removing.value = null
    confirming.value = null
  })
}

// 确认行换成两行、比普通行高：进入 / 退出确认后按新的行高重算列表高度，避免被裁掉
watch(confirming, async () => {
  if (!open.value) return
  const from = rows.value?.getBoundingClientRect().height
  await nextTick()
  resize(true, from)
})

/** 「至少保留一个账号」提示挂在哪一行上 */
const lockTip = ref<string | null>(null)
let lockTimer: ReturnType<typeof setTimeout> | undefined
function showLock(a: Account) {
  lockTip.value = a.account
  clearTimeout(lockTimer)
  lockTimer = setTimeout(() => (lockTip.value = null), LOCK_TIP_MS)
}

/** 点一行：切换勾选（不关闭弹窗）；失效的去重新登录；只剩一个勾选时提示不能取消 */
function pick(a: Account) {
  if (confirming.value === a.account) return
  if (props.isExpired(a)) return relogin(a)
  if (isLocked(a)) return showLock(a)
  lockTip.value = null
  emit('toggle', platform.value.id, a.account)
}
function relogin(a: Account) {
  const id = platform.value.id
  close()
  emit('login', id, a.account)
}
function add() {
  const id = platform.value.id
  close()
  emit('login', id)
}

function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (!root.value?.contains(t) && !panelEl.value?.contains(t)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirming.value && !removing.value) return cancelRemove()
  close()
}
watch(open, async (v) => {
  confirming.value = null
  lockTip.value = null
  if (v) {
    tab.value = props.focus.id
    expanded.value = false
    atBottom.value = false
    placeFloat()
    await nextTick()
    resize(false)
    revealTab()
    // 底部弹层由遮罩、下滑关闭；其余形态点外面关闭
    if (!sheet.value) document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    addEventListener('resize', placeFloat)
  } else {
    document.removeEventListener('pointerdown', onDoc)
    document.removeEventListener('keydown', onKey)
    removeEventListener('resize', placeFloat)
  }
})
// 形态变了（转屏、窗口缩放跨断点、窄栏展开）就收起，避免停在错误的位置
watch([sheet, floating], close)
// 单一模式下换了平台就收起；聚合模式下点侧栏渠道只是选上 / 去掉，Tab 跟到它上面
watch(
  () => props.focus.id,
  (id) => (tabs.value && open.value ? (tab.value = id) : close()),
)
// 账号增减（设为默认、登录后刷新）时重新量一次高度
watch(() => props.accounts, async () => {
  pending.value = null
  if (!open.value) return
  const from = rows.value?.getBoundingClientRect().height
  await nextTick()
  resize(true, from)
})
onBeforeUnmount(() => {
  close()
  clearTimeout(lockTimer)
})
</script>

<template>
  <div ref="root" class="switcher" :class="{ rail: rail && !sheet }">
    <BottomSheet :open="open" desktop="inline" :label="t('account.dialogLabel', { platform: platform.name })" :z="55" :close-on-esc="false" @close="close">
    <Teleport to="body" :disabled="!floating">
    <Transition :name="floating ? 'pop-side' : 'pop'">
      <div
        v-if="open || sheet"
        ref="panelEl"
        class="panel"
        :class="{ glass: !sheet, 'in-sheet': sheet, floating }"
        :style="floating ? floatStyle : undefined"
        :role="sheet ? undefined : 'dialog'"
        :aria-label="sheet ? undefined : t('account.dialogLabel', { platform: platform.name })"
      >
        <div v-if="tabs" class="tabs" :class="{ many }">
          <button v-if="many" type="button" class="arrow" :disabled="!canLeft" :aria-label="t('account.tabs.prev')" @click="page(-1)">
            <ChevronLeft :size="16" />
          </button>
          <div
            ref="strip"
            class="strip"
            :class="{ 'fade-l': many && canLeft, 'fade-r': many && canRight }"
            role="tablist"
            :aria-label="t('account.tabs.label')"
            @scroll.passive="onStrip"
            @keydown="onTabKey"
          >
            <button
              v-for="p in tabs"
              :key="p.id"
              type="button"
              role="tab"
              class="tab"
              :class="{ on: p.id === tab }"
              :data-tab="p.id"
              :aria-selected="p.id === tab"
              :tabindex="p.id === tab ? 0 : -1"
              @click="pickTab(p.id)"
            >
              <img class="tab-logo" :src="p.logo" alt="" />
              <span class="tab-name">{{ p.name }}</span>
              <span class="tab-count mono" :aria-label="t('account.tabs.selected', { n: selectedOf(p.id).length }, selectedOf(p.id).length)">{{ selectedOf(p.id).length }}</span>
              <span v-if="(health.get(p.id)?.bad ?? 0) > 0" class="tab-warn" role="img" :aria-label="t('account.tabs.expired')" />
            </button>
          </div>
          <button v-if="many" type="button" class="arrow" :disabled="!canRight" :aria-label="t('account.tabs.next')" @click="page(1)">
            <ChevronRight :size="16" />
          </button>
        </div>

        <header class="head">
          <div class="title-row">
            <img class="logo" :src="platform.logo" alt="" />
            <span class="title">{{ t('account.dialogLabel', { platform: platform.name }) }}</span>
            <span v-if="list.length" class="count" :class="{ on: picked.length }">{{ t('account.head.selected', { n: picked.length, total: list.length }, picked.length) }}</span>
          </div>
          <p class="hint">
            {{ tabs ? t('account.head.hintAgg') : t('account.head.hint') }}
          </p>
        </header>

        <div class="list">
          <div ref="rows" class="rows" :class="{ scrollable, faded: scrollable && !atBottom }" role="group" :aria-label="t('account.dialogLabel', { platform: platform.name })" @scroll.passive="onScroll">
            <div
              v-for="a in sorted"
              :key="a.account"
              :data-account="a.account"
              class="row"
              :class="{ active: isPicked(a), expired: isExpired(a), confirming: confirming === a.account }"
              role="checkbox"
              :aria-checked="isPicked(a)"
              :aria-disabled="isExpired(a) || isLocked(a) || undefined"
              tabindex="0"
              @click="pick(a)"
              @keydown.enter.prevent="pick(a)"
              @keydown.space.prevent="pick(a)"
            >
              <template v-if="confirming === a.account">
                <span class="warn-ico" aria-hidden="true"><Trash2 :size="15" /></span>
                <div class="text">
                  <div class="name-row"><span class="nick">{{ t('account.remove.ask', { name: nick(a) }) }}</span></div>
                  <div class="sub">{{ SERVER_LOGOUT.has(platform.id) ? t('account.remove.serverLogout', { platform: platform.name }) : t('account.remove.localOnly') }}</div>
                </div>
                <div class="confirm-acts">
                  <button type="button" class="act cancel" :disabled="removing === a.account" @click.stop="cancelRemove">{{ t('common.action.cancel') }}</button>
                  <button type="button" class="act danger" :disabled="removing === a.account" @click.stop="confirmRemove(a)">
                    <CatbusLoader v-if="removing === a.account" :size="12" :label="t('account.remove.removingLabel')" />
                    {{ removing === a.account ? t('account.remove.removing') : t('common.action.delete') }}
                  </button>
                </div>
              </template>
              <template v-else>
                <span class="box" :class="{ on: isPicked(a), off: isExpired(a), locked: isLocked(a) }" aria-hidden="true">
                  <Check v-if="isPicked(a)" :size="13" :stroke-width="3" />
                </span>
                <span class="ava" :style="{ background: color(a) }" aria-hidden="true">
                  <img v-if="avatarOf(a)" :src="imgSrc(avatarOf(a)!)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(avatarOf(a)!)" />
                  <template v-else>{{ nick(a).slice(0, 1) }}</template>
                </span>
                <div class="text">
                  <div class="name-row">
                    <span class="nick">{{ nick(a) }}</span>
                    <span v-if="a.current" class="badge">{{ t('account.row.default') }}</span>
                  </div>
                  <div class="sub">
                    {{ isExpired(a) ? t('account.row.expired') : isPicked(a) ? t('account.row.browsing') : t('account.row.loggedInAt', { time: since(a.updated_at) }) }}
                  </div>
                </div>
                <button v-if="isExpired(a)" type="button" class="act relogin" @click.stop="relogin(a)">
                  <RotateCw :size="12" />{{ t('common.action.relogin') }}
                </button>
                <button
                  v-else-if="!a.current"
                  type="button"
                  class="act set-default"
                  :disabled="pending === a.account"
                  @click.stop="setDefault(a)"
                >
                  <Star :size="12" />{{ t('account.row.setDefault') }}
                </button>
                <button v-tip="t('account.remove.tip')" type="button" class="act icon del" :aria-label="t('account.remove.tip')" @click.stop="askRemove(a)">
                  <Trash2 :size="13" />
                </button>
                <Transition name="tip">
                  <span v-if="lockTip === a.account" class="lock-tip" role="status">
                    <Lock :size="12" />{{ t('account.row.keepOne') }}
                  </span>
                </Transition>
              </template>
            </div>
            <p v-if="!list.length" class="empty">{{ t('account.row.empty', { platform: platform.name }) }}</p>
          </div>
          <div v-if="canExpand" class="expand-wrap">
            <button
              type="button"
              class="expand"
              :class="{ up: expanded }"
              :aria-label="expanded ? t('account.collapse') : t('account.expandAll')"
              :aria-expanded="expanded"
              @click="toggleExpand"
            >
              <ChevronDown :size="16" />
            </button>
          </div>
        </div>

        <Transition :css="false" @enter="mergeEnter" @leave="mergeLeave">
          <p v-if="picked.length > 1" class="merge">
            <Layers :size="14" />{{ t('account.merge', { n: picked.length }, picked.length) }}
          </p>
        </Transition>

        <button type="button" class="add" @click="add">
          <span class="plus" aria-hidden="true"><Plus :size="16" /></span>
          <span class="text">
            <span class="nick">{{ t('account.add.title', { platform: platform.name }) }}</span>
            <span class="sub">{{ t('account.add.methods') }}</span>
          </span>
        </button>
      </div>
    </Transition>
    </Teleport>
    </BottomSheet>

    <button
      type="button"
      class="chip"
      :class="{ open }"
      :title="card.kind === 'agg' || browsing.length ? t('account.card.switch') : t('common.action.login')"
      :aria-label="rail ? card.label : undefined"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="ava-wrap">
        <!-- 窄栏只放一个头像 -->
        <span v-if="rail || card.kind === 'acc' && card.accs.length <= 1" class="ava" aria-hidden="true">
          <img v-if="avatarOf(first)" :src="imgSrc(avatarOf(first)!)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(avatarOf(first)!)" />
          <template v-else>{{ first ? nick(first).slice(0, 1) : '?' }}</template>
        </span>
        <span v-else-if="card.kind === 'acc'" class="stack" aria-hidden="true">
          <span v-for="a in card.accs" :key="a.account" class="ava" :style="{ background: color(a) }">
            <img v-if="avatarOf(a)" :src="imgSrc(avatarOf(a)!)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(avatarOf(a)!)" />
            <template v-else>{{ nick(a).slice(0, 1) }}</template>
          </span>
        </span>
        <span v-else class="stack logos" aria-hidden="true">
          <img v-for="p in card.logos" :key="p.id" class="stack-logo" :src="p.logo" alt="" />
          <span v-if="card.more" class="stack-logo more mono">+{{ card.more }}</span>
        </span>
        <span v-if="rail && status" class="dot" :class="status" aria-hidden="true" />
      </span>
      <span class="chip-text">
        <span class="chip-name">{{ card.name }}</span>
        <span class="chip-sub" :class="{ warn: card.warn }">
          {{ card.sub }}<template v-if="source === 'demo'"> · <em>{{ t('common.state.demo') }}</em></template>
        </span>
      </span>
      <LogIn v-if="card.kind === 'acc' && !browsing.length" :size="16" class="chev" aria-hidden="true" />
      <ChevronsUpDown v-else :size="16" class="chev" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  flex: none;
}

/* ---------- 侧栏底部的账号卡 ---------- */
.chip {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  text-align: left;
  border-radius: var(--radius-md);
  background: var(--glass-strong);
  border: 1px solid transparent;
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s, border-color 0.2s;
}
.chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px #1b1f2e14;
}
.chip.open {
  border-color: #e8414f55;
  box-shadow: 0 0 0 3px var(--red-soft);
  transform: none;
}
.chip .ava {
  width: 30px;
  height: 30px;
  font-size: 13px;
  background: var(--navy);
}
.chip-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.chip-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-sub {
  font-size: 10.5px;
  color: var(--ink-3);
}
.chip-sub em {
  font-style: normal;
  color: var(--red);
}
.chev {
  color: var(--ink-2);
  flex: none;
}

/* ---------- 弹窗 ---------- */
.panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: 340px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 22px;
  background: var(--glass-strong);
  box-shadow: 0 18px 50px #1b1f2e24;
  transform-origin: 20% 100%;
}
.head {
  padding: 10px 10px 4px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
}
.count {
  font-size: 11px;
  color: var(--ink-3);
}
.hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
}

.list {
  padding: 6px;
  border-radius: 18px;
  border: 1px solid var(--hair);
  background: color-mix(in srgb, var(--ink) 3%, transparent);
}
.rows {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
.rows.scrollable {
  overflow-y: auto;
  overscroll-behavior: contain;
  margin-right: -2px;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 22%, transparent) transparent;
}
.rows.faded {
  mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent);
}
.rows::-webkit-scrollbar {
  width: 4px;
}
.rows::-webkit-scrollbar-track {
  margin: 6px 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.rows::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.rows:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink) 38%, transparent);
}

.row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 14px;
  cursor: pointer;
  outline: none;
  transition: background 0.2s, box-shadow 0.2s;
}
.row {
  position: relative;
}
.row:active:not(.confirming) {
  transform: scale(0.98);
  transition: transform 0.1s;
}
.row:hover,
.row:focus-visible {
  background: color-mix(in srgb, var(--glass-strong) 70%, transparent);
}
.row.active {
  background: #fff;
  box-shadow: 0 2px 10px #1b1f2e10;
}
[data-theme='dark'] .row.active {
  background: #ffffff14;
}
.ava {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.nick {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--red);
  background: var(--red-soft);
}
.sub {
  font-size: 11px;
  color: var(--ink-3);
}
.ava {
  overflow: hidden;
}
.ava img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.row.expired .ava {
  opacity: 0.45;
}
.row.expired .nick {
  color: var(--ink-3);
}
.row.expired .sub {
  color: var(--red);
}
.act {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  transition: opacity 0.2s, transform 0.2s var(--ease-out);
}
.set-default {
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  opacity: 0;
  transform: translateX(4px);
}
.row:hover .set-default,
.row:focus-within .set-default {
  opacity: 1;
  transform: none;
}
.set-default:hover {
  color: var(--red);
}
.set-default:disabled {
  cursor: progress;
}
.relogin {
  color: var(--red);
  background: var(--red-soft);
}
/* 删除：悬停时出现的垃圾桶 */
.act.icon {
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
  color: var(--ink-3);
  opacity: 0;
  transform: translateX(4px);
}
.row:hover .act.icon,
.row:focus-within .act.icon {
  opacity: 1;
  transform: none;
}
.act.icon:hover {
  color: var(--red);
  background: var(--red-soft);
}
/* 行内二次确认 */
.row.confirming {
  cursor: default;
  background: var(--red-soft);
  box-shadow: inset 0 0 0 1px #e8414f40;
  animation: shake 0.35s var(--ease-out);
}
.row.confirming .nick {
  color: var(--red);
}
.warn-ico {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--red);
}
/* 确认行：图标 + 提示在第一行，按钮换到第二行右对齐，窄面板下也不会撑出容器 */
.row.confirming {
  flex-wrap: wrap;
  row-gap: 8px;
}
.row.confirming .sub {
  white-space: normal;
  overflow-wrap: anywhere;
}
.confirm-acts {
  flex: 1 0 100%;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.act.cancel {
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
}
.act.danger {
  color: #fff;
  background: var(--red);
  gap: 6px;
  --catbus-loader-accent: var(--navy);
}
.act.cancel:disabled,
.act.danger:disabled {
  opacity: 0.6;
  cursor: progress;
}
@keyframes shake {
  20% { transform: translateX(-3px); }
  45% { transform: translateX(3px); }
  70% { transform: translateX(-1.5px); }
}
@media (prefers-reduced-motion: reduce) {
  .row.confirming {
    animation: none;
  }
}

.expand-wrap {
  display: flex;
  justify-content: center;
  padding-top: 6px;
}
.expand {
  display: grid;
  place-items: center;
  padding: 3px 14px;
  border-radius: 11px;
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  box-shadow: 0 2px 6px #1b1f2e0d;
  transition: color 0.2s, transform 0.2s var(--ease-out);
}
.expand:hover {
  color: var(--ink);
  transform: translateY(-1px);
}
.expand svg {
  transition: transform 0.3s var(--ease-out);
}
.expand.up svg {
  transform: rotate(180deg);
}

.add {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 14px;
  text-align: left;
  transition: background 0.2s;
}
.add:hover {
  background: var(--hair);
}
.plus {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border: 1.2px solid var(--ink-3);
}

/* ---------- 多选：复选框、锁定提示、合并说明（设计稿 T） ---------- */
.box {
  width: 20px;
  height: 20px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: #fff;
  background: var(--glass-strong);
  border: 1.3px solid var(--ink-3);
  transition: background 0.18s, border-color 0.18s, box-shadow 0.18s, transform 0.18s var(--ease-out);
}
.box.on {
  background: var(--red);
  border-color: var(--red);
  box-shadow: 0 2px 6px #e8414f40;
}
.box.on svg {
  animation: tick 0.22s var(--ease-out);
}
.box.off {
  opacity: 0.4;
}
.row:hover .box:not(.on):not(.off) {
  border-color: var(--red);
}
@keyframes tick {
  from { transform: scale(0.4); opacity: 0; }
}
.count.on {
  color: var(--red);
  font-weight: 600;
}
.lock-tip {
  /* 盖在行右侧的操作按钮上（列表是 overflow: hidden，不能浮到行外） */
  position: absolute;
  right: 8px;
  top: 50%;
  translate: 0 -50%;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 9px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  color: #fff;
  background: var(--navy);
  box-shadow: 0 6px 16px #0b0d1833;
  pointer-events: none;
}
[data-theme='dark'] .lock-tip {
  color: #1b1f2e;
  background: #f2f3f8;
}
.tip-enter-active,
.tip-leave-active {
  transition: opacity 0.18s, transform 0.18s var(--ease-out);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
.merge {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--red);
  background: var(--red-soft);
}
.merge svg {
  flex: none;
}
.merge {
  overflow: hidden;
  transform-origin: 50% 100%;
}
.empty {
  margin: 0;
  padding: 14px 10px;
  font-size: 12px;
  color: var(--ink-3);
  text-align: center;
}

/* ---------- 聚合模式的渠道 Tab ---------- */
.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  border: 1px solid var(--hair);
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.strip {
  /* Tab 的 offsetLeft 相对它算（revealTab 用） */
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}
.strip::-webkit-scrollbar {
  display: none;
}
.strip.fade-l {
  mask-image: linear-gradient(to right, transparent, #000 20px);
}
.strip.fade-r {
  mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
}
.strip.fade-l.fade-r {
  mask-image: linear-gradient(to right, transparent, #000 20px, #000 calc(100% - 20px), transparent);
}
.tab {
  flex: 1 0 auto;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--ink-2);
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
}
.tabs.many .tab {
  flex: none;
}
.tab:hover {
  color: var(--ink);
}
.tab.on {
  color: var(--ink);
  font-weight: 700;
  background: #fff;
  box-shadow: 0 2px 8px #1b1f2e14;
}
[data-theme='dark'] .tab.on {
  background: #ffffff1a;
}
.tab:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: -2px;
}
.tab-logo {
  width: 16px;
  height: 16px;
  border-radius: 5px;
}
.tab-count {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ink-2);
  background: color-mix(in srgb, var(--ink) 8%, transparent);
}
.tab.on .tab-count {
  color: #fff;
  background: var(--red);
}
.tab-warn {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
}
.arrow {
  flex: none;
  width: 28px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  transition: opacity 0.2s, color 0.2s;
}
.arrow:hover:not(:disabled) {
  color: var(--ink);
}
.arrow:disabled {
  opacity: 0.35;
  background: transparent;
  border-color: transparent;
  cursor: default;
}

/* ---------- 账号卡：多个账号 / 多个渠道时叠放 ---------- */
.stack {
  display: flex;
  align-items: center;
}
.stack > * + * {
  margin-left: -9px;
}
.chip .stack .ava {
  box-shadow: 0 0 0 2px var(--glass-strong);
}
.stack.logos > * + * {
  margin-left: -12px;
}
.stack-logo {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  box-shadow: 0 0 0 2px var(--glass-strong);
}
.stack-logo.more {
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--navy);
}
.chip-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-sub.warn {
  color: var(--warn);
}

/* ---------- 窄栏（平板）：只显示头像 ---------- */
.ava-wrap {
  position: relative;
  flex: none;
  display: grid;
}
.dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--glass-strong);
  box-sizing: border-box;
}
.dot.online {
  background: var(--online);
}
.dot.expired {
  background: var(--red);
}
.rail .chip {
  justify-content: center;
  padding: 0;
  width: var(--tap);
  height: var(--tap);
  margin: 0 auto;
  border-radius: 50%;
  background: transparent;
}
.rail .chip .ava {
  width: 36px;
  height: 36px;
  font-size: 14px;
}
.rail .chip-text,
.rail .chev {
  display: none;
}
.rail .chip.open {
  box-shadow: 0 0 0 3px var(--red-soft);
}
/* 窄栏的列表挂在 body 上，从账号卡右侧弹出 */
.panel.floating {
  position: fixed;
  z-index: 45;
  overflow-y: auto;
  overscroll-behavior: contain;
  transform-origin: 0% 100%;
}
.pop-side-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease-out;
}
.pop-side-leave-active {
  transition: transform 0.18s ease-in, opacity 0.18s ease-in;
}
.pop-side-enter-from,
.pop-side-leave-to {
  opacity: 0;
  transform: translateX(-10px) scale(0.94);
}

/* ---------- 手机：底部弹层（外壳由 BottomSheet 提供） ---------- */
.panel.in-sheet {
  position: static;
  width: auto;
  padding: 2px 12px 14px;
  border-radius: 0;
  background: none;
  box-shadow: none;
  border: none;
  backdrop-filter: none;
}
.in-sheet .head {
  padding: 6px 8px 6px;
}
.in-sheet .title {
  font-size: 16px;
}
.in-sheet .tab {
  height: 40px;
}
.in-sheet .arrow {
  width: 36px;
  height: 40px;
}
.in-sheet .box {
  width: 22px;
  height: 22px;
}

/* ---------- 触屏：没有悬停，操作按钮一直显示，可点区域至少 --tap ---------- */
@media (hover: none) and (pointer: coarse) {
  .row {
    min-height: var(--tap);
  }
  .set-default,
  .act.icon {
    opacity: 1;
    transform: none;
  }
  .act {
    position: relative;
    min-height: 34px;
    padding: 0 11px;
    font-size: 12px;
  }
  .act.icon {
    width: 34px;
    height: 34px;
  }
  /* 视觉尺寸不变，点击区域外扩到 44px */
  .act::before {
    content: '';
    position: absolute;
    inset: -5px;
  }
  .expand {
    min-height: 32px;
    padding: 6px 22px;
  }
  .add {
    min-height: var(--tap);
  }
  .chip:hover {
    transform: none;
    box-shadow: none;
  }
}

/* 弹窗：从账号卡往上弹出 */
.pop-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease-out;
}
.pop-leave-active {
  transition: transform 0.18s ease-in, opacity 0.18s ease-in;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: opacity 0.2s;
  }
  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
