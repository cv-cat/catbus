<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Inbox, Layers, Radio, UserRound, X } from 'lucide-vue-next'
import MascotAvatar from './MascotAvatar.vue'
import ChannelItem from './ChannelItem.vue'
import AccountSwitcher from './AccountSwitcher.vue'
import SettingsButton from './SettingsButton.vue'
import LocalButton from './LocalButton.vue'
import ModeSwitch from './ModeSwitch.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import RailAccountCard from './rail/RailAccountCard.vue'
import { LOCAL, RAIL, SUBS, type PlatformMeta } from '@/data/platforms'
import { flashTip } from '@/directives/tip'
import type { Account } from '@/api/types'
import type { Health } from '@/stores/discover'
import { animate, animateFrom, gsap, prefersReducedMotion } from '@/composables/motion'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { storeToRefs } from 'pinia'
import { useNavStore } from '@/stores/nav'

const props = defineProps<{
  platforms: PlatformMeta[]
  health: Map<string, Health>
  /** 全部账号（账号切换按平台取 web 端的） */
  accounts: Account[]
  /** 某个平台打勾的账号 / 请求实际用的账号（AGENTS.md 7.9「账号切换」） */
  selectedOf: (platform: string) => string[]
  browsingOf: (platform: string) => string[]
  isExpired: (a: Account) => boolean
  source: 'live' | 'demo'
  /** 聚合模式选中的渠道（按点选顺序）；单一模式为空 */
  selected: string[]
  /** 第一页还在加载的渠道 */
  busy: Set<string>
  /** 正在看 12306 查询页（AGENTS.md 7.9「12306 查询页」） */
  railPage: boolean
  /** 正在看「我的」页（M-Team 自己的，或各平台的，AGENTS.md 7.9「各平台的「我的」页」） */
  mePage: boolean
  /** 平台有「我的」页：单一模式下这个渠道的行下面展开「发现 / 我的」 */
  hasMine: (id: string) => boolean
  /** 正在看直播弹幕页（AGENTS.md 7.9「直播弹幕」） */
  livePage: boolean
  /** 平台的 live listen 已实现：子项多一个「直播」 */
  hasLive: (id: string) => boolean
  /** 正在看收件箱（AGENTS.md 7.9「通知与私信」） */
  inboxPage: boolean
  /** 平台有收件箱：子项多一个「收件箱」 */
  hasInbox: (id: string) => boolean
  /** 「收件箱」子项的未读角标 */
  inboxBadge: (id: string) => number
  /** 正在看本地收藏（AGENTS.md 7.9「本地收藏与稍后看」） */
  localPage: boolean
  /** 本地收藏的条数 */
  localCount: number
  /** 正在看订阅页（AGENTS.md 7.9「订阅」） */
  subsPage: boolean
  /** 订阅的未读总数 */
  subsUnread: number
}>()
const active = defineModel<string>({ required: true })
/** 单一 / 聚合：聚合模式下点渠道是选上 / 去掉，不是切换 */
const aggregate = defineModel<boolean>('aggregate', { required: true })
const emit = defineEmits<{
  /** 聚合模式下点了一个渠道 */
  toggle: [id: string]
  login: [platform: string, account?: string]
  toggleAccount: [platform: string, account: string]
  setDefault: [platform: string, account: string]
  remove: [platform: string, account: string, done: (ok: boolean) => void]
  /** 点了 12306：进入查询页 */
  openRail: []
  /** 在查询页上点了别的渠道：先离开查询页，再切过去 */
  leaveRail: [id: string]
  /** 点了渠道下面的「我的」 */
  openMe: [id: string]
  /** 点了渠道下面的「直播」 */
  openLive: [id: string]
  /** 点了渠道下面的「收件箱」 */
  openInbox: [id: string]
  /** 点了「本地收藏」 */
  openLocal: []
  /** 在本地收藏上点了别的渠道：离开本地收藏再切过去 */
  leaveLocal: [id: string]
  /** 在「我的」页上点了「发现」或别的渠道：离开「我的」页再切过去 */
  leaveMe: [id: string]
  /** 点了「订阅」 */
  openSubs: []
  /** 在订阅页上点了别的渠道：离开订阅页再切过去 */
  leaveSubs: [id: string]
}>()

/**
 * 三种形态（AGENTS.md 7.9「响应式」）：
 * - 桌面：完整侧栏，常驻；
 * - 平板：图标窄栏（--sidebar-rail-w），navOpen 时完整侧栏浮在内容上面；
 * - 手机：抽屉，navOpen 时从左边滑入。
 */
const bp = useBreakpoint()
const { t } = useI18n()
const navStore = useNavStore()
const { navOpen } = storeToRefs(navStore)
const { openNav, closeNav } = navStore
const mode = computed(() => (bp.phone ? 'phone' : bp.tablet ? 'tablet' : 'desktop'))
/** 当前是图标窄栏 */
const rail = computed(() => mode.value === 'tablet' && !navOpen.value)
/** 侧栏浮在内容上面（平板展开 / 手机抽屉打开），此时有遮罩 */
const overlay = computed(() => mode.value !== 'desktop' && navOpen.value)

/** 账号弹窗的渠道 Tab：聚合模式下是选中的渠道（按点选顺序），否则只有当前平台 */
const tabPlatforms = computed(() => {
  const ids = aggregate.value && props.selected.length ? props.selected : [active.value]
  return ids.flatMap((id) => props.platforms.filter((p) => p.id === id))
})

const aside = ref<HTMLElement>()
const list = ref<HTMLElement>()
const highlight = ref<HTMLElement>()

/** 侧栏上高亮的渠道：查询页上是 12306 */
const current = computed(() => (props.railPage ? RAIL.id : props.subsPage ? SUBS.id : props.localPage ? LOCAL.id : active.value))
/** 聚合模式下 12306 不参与聚合（置灰）；在查询页上「单一 / 聚合」开关置灰 */
const railOff = computed(() => (aggregate.value ? t('rail.nav.noAggregate') : null))

/** 选中块跟着当前渠道滑动 */
function place(instant = false, scroll = true) {
  const el = list.value?.querySelector<HTMLElement>(`[data-id="${current.value}"]`)
  if (!el || !highlight.value) return
  // 正在收起的子项（上一个渠道的「发现 / 我的」）还占着高度：按收起之后的位置算，选中块直接滑到终点
  // （连同它在列表里占的那一份 gap）
  let y = el.offsetTop
  const gap = parseFloat(getComputedStyle(list.value!).rowGap) || 0
  list.value!.querySelectorAll<HTMLElement>('.subnav.leaving').forEach((s) => {
    if (s.offsetTop < el.offsetTop) y -= s.offsetHeight + (parseFloat(getComputedStyle(s).marginBottom) || 0) + gap
  })
  // 滑完再量一次：滑动途中布局还在变（子项展开 / 收起），终点有偏差就补齐
  const settle = () => {
    const h = highlight.value
    if (h && Math.abs((gsap.getProperty(h, 'y') as number) - el.offsetTop) > 0.5) gsap.set(h, { y: el.offsetTop, height: el.offsetHeight })
  }
  const vars = { y, height: el.offsetHeight, opacity: 1, duration: 0.5, ease: 'power3.out', onComplete: settle }
  // 立即对齐时先停掉还在跑的滑动：否则它会滑到旧位置（例如展开 M-Team 子项后行高变了）
  if (instant) gsap.killTweensOf(highlight.value)
  instant ? gsap.set(highlight.value, vars) : animate(highlight.value, vars)
  if (scroll) {
    el.scrollIntoView({ block: 'nearest', behavior: instant ? 'auto' : 'smooth' })
    // 已经展开的「发现 / 我的」子项一起滚进视野（列表在底部时，否则会被下面的账号卡挡住）
    const sub = el.nextElementSibling
    if (sub instanceof HTMLElement && sub.classList.contains('subnav') && !sub.classList.contains('leaving')) revealSub(sub, instant)
  }
}
/** 子项滚进列表的可见范围（scroll-margin 让开列表底部的渐隐） */
function revealSub(node: HTMLElement, instant = false) {
  node.scrollIntoView({ block: 'nearest', behavior: instant || prefersReducedMotion() ? 'auto' : 'smooth' })
}
/** 渠道行在首屏之后才定下高度（字体、图标加载完）：列表尺寸变了就把选中块对齐，不滚动 */
let listObserver: ResizeObserver | undefined

function pickRail(e: MouseEvent) {
  if (railOff.value) return flashTip(e.currentTarget)
  if (!props.railPage) emit('openRail')
  if (mode.value !== 'desktop') closeNav()
}

/** 「发现 / 我的」子项：单一模式下当前渠道有「我的」页（或正在看「我的」）时展开 */
const showSub = computed(
  () => !aggregate.value && !rail.value && !props.railPage && !props.localPage && !props.subsPage && (props.hasMine(active.value) || props.hasLive(active.value) || props.hasInbox(active.value)),
)
/** 子项展开 / 收起：高度和外边距过渡，子项依次淡入；减少动效时直接出现 */
const SUB_EASE = 'power3.out'
function subEnter(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (prefersReducedMotion()) return void (done(), revealSub(node, true))
  gsap
    .timeline({ onComplete: () => (gsap.set(node, { clearProps: 'height,marginBottom,opacity,overflow' }), done(), revealSub(node)) })
    .fromTo(node, { height: 0, marginBottom: 0, opacity: 0, overflow: 'hidden' }, { height: 'auto', marginBottom: 6, opacity: 1, duration: 0.36, ease: SUB_EASE })
    .fromTo(node.children, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: SUB_EASE, stagger: 0.04, clearProps: 'transform,opacity' }, 0.06)
}
function subLeave(el: Element, done: () => void) {
  const node = el as HTMLElement
  if (prefersReducedMotion()) return done()
  node.classList.add('leaving')
  gsap.to(node, { height: 0, marginBottom: 0, opacity: 0, overflow: 'hidden', duration: 0.28, ease: 'power2.inOut', onComplete: done })
}
function pickSub(which: 'discover' | 'me' | 'live' | 'inbox') {
  if (which === 'me') {
    if (!props.mePage) emit('openMe', active.value)
  } else if (which === 'live') {
    if (!props.livePage) emit('openLive', active.value)
  } else if (which === 'inbox') {
    if (!props.inboxPage) emit('openInbox', active.value)
  } else if (props.mePage || props.livePage || props.inboxPage) emit('leaveMe', active.value)
  if (mode.value !== 'desktop') closeNav()
}
function pickLocal() {
  if (!props.localPage) emit('openLocal')
  if (mode.value !== 'desktop') closeNav()
}

function pickSubs() {
  if (!props.subsPage) emit('openSubs')
  if (mode.value !== 'desktop') closeNav()
}

function pick(id: string) {
  if (props.subsPage) {
    emit('leaveSubs', id)
    if (mode.value !== 'desktop') closeNav()
    return
  }
  if (props.localPage) {
    emit('leaveLocal', id)
    if (mode.value !== 'desktop') closeNav()
    return
  }
  if (props.mePage || props.livePage || props.inboxPage) {
    emit('leaveMe', id)
    if (mode.value !== 'desktop') closeNav()
    return
  }
  if (props.railPage) {
    emit('leaveRail', id)
    if (mode.value !== 'desktop') closeNav()
    return
  }
  if (aggregate.value) {
    // 至少留一个：只剩它时点不掉，晃一下
    if (props.selected.length === 1 && props.selected[0] === id) {
      const el = list.value?.querySelector<HTMLElement>(`[data-id="${id}"]`)
      if (el) animate(el, { keyframes: { x: [0, -5, 4, -2, 0] }, duration: 0.35, ease: 'power2.out', clearProps: 'transform' })
      return
    }
    // 连着选几个渠道：浮层（平板、手机）不收起
    return emit('toggle', id)
  }
  active.value = id
  if (mode.value !== 'desktop') closeNav()
}

/** 计数里「已选 /」的数字：退出聚合时选中列表先清空，滑回去的途中仍显示原来的数 */
const pickedCount = ref(1)
watch(() => props.selected.length, (n) => n && (pickedCount.value = n), { immediate: true })

/* ---------- 打开 / 关闭：焦点、Esc、滚动锁 ---------- */
let returnFocus: HTMLElement | null = null

function focusables() {
  return [...(aside.value?.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])') ?? [])].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  )
}

function onKey(e: KeyboardEvent) {
  if (!overlay.value) return
  if (e.key === 'Escape') {
    // 侧栏里的弹层（账号切换）先处理自己的 Esc
    if (e.defaultPrevented) return
    closeNav()
    return
  }
  // 抽屉打开时把 Tab 焦点圈在侧栏里
  if (e.key === 'Tab') {
    const els = focusables()
    if (!els.length) return
    const first = els[0]!
    const last = els[els.length - 1]!
    const cur = document.activeElement
    if (!aside.value?.contains(cur)) {
      e.preventDefault()
      first.focus()
    } else if (e.shiftKey && cur === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(overlay, async (open) => {
  // 手机抽屉打开时锁住背后滚动
  document.documentElement.classList.toggle('nav-locked', open && mode.value === 'phone')
  if (open) {
    const cur = document.activeElement
    // Safari 点按钮不会让按钮获得焦点：退回到声明了 aria-controls 的触发按钮（发现页顶栏的菜单按钮）
    returnFocus =
      cur instanceof HTMLElement && cur !== document.body && !aside.value?.contains(cur)
        ? cur
        : [...document.querySelectorAll<HTMLElement>('[aria-controls="catbus-nav"]')].find(
            (el) => !aside.value?.contains(el) && el.offsetParent !== null,
          ) ?? null
    await nextTick()
    const target = list.value?.querySelector<HTMLElement>(`[data-id="${current.value}"]`) ?? focusables()[0]
    // 指针打开时不画焦点环（键盘打开时浏览器仍会显示）
    target?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
  } else {
    // 焦点还在侧栏里（或已丢失）时，交还给打开它的按钮
    const cur = document.activeElement
    if (returnFocus?.isConnected && (!cur || cur === document.body || aside.value?.contains(cur))) {
      returnFocus.focus({ preventScroll: true })
    }
    returnFocus = null
  }
})

// 断点切换（旋转屏幕、拖窗口）时收回，避免带着打开状态进入别的形态
watch(mode, () => {
  closeNav()
  dragX.value = 0
  nextTick(() => place(true))
})
// 窄栏 ↔ 完整侧栏：渠道行高变了，选中块重新定位（等宽度过渡开始后再量）
watch(rail, () => nextTick(() => place(true)))

/* ---------- 手机抽屉：向左滑动关闭 ---------- */
const dragX = ref(0)
let drag: { id: number; x: number; y: number; t: number; locked: 'x' | 'y' | null } | null = null

function onDown(e: PointerEvent) {
  if (mode.value !== 'phone' || !navOpen.value || e.pointerType === 'mouse') return
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), locked: null }
}
function onMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = e.clientX - drag.x
  const dy = e.clientY - drag.y
  if (!drag.locked) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    drag.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (drag.locked === 'x') aside.value?.setPointerCapture(e.pointerId)
  }
  if (drag.locked === 'x') dragX.value = Math.min(0, dx)
}
function onUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const dx = dragX.value
  const v = dx / Math.max(1, performance.now() - drag.t)
  const w = aside.value?.offsetWidth ?? 300
  drag = null
  if (dx < -w * 0.3 || v < -0.5) closeNav()
  dragX.value = 0
}
const dragStyle = computed(() =>
  dragX.value ? { transform: `translate3d(${dragX.value}px, 0, 0)`, transition: 'none' } : undefined,
)

onMounted(async () => {
  addEventListener('keydown', onKey)
  await nextTick()
  place(true)
  // 选中块正在滑动时不打断它（子项展开 / 收起会让列表尺寸连续变化），滑完由 place 的 onComplete 对齐
  listObserver = new ResizeObserver(() => {
    if (highlight.value && gsap.isTweening(highlight.value)) return
    place(true, false)
  })
  listObserver.observe(list.value!)
  list.value!.querySelectorAll('.channel').forEach((el) => listObserver!.observe(el))
  animateFrom(
    list.value!.querySelectorAll('.channel'),
    { x: -12, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.03, delay: 0.15, clearProps: 'transform' },
  )
})
onBeforeUnmount(() => {
  listObserver?.disconnect()
  removeEventListener('keydown', onKey)
  document.documentElement.classList.remove('nav-locked')
})
// post：等子项的离场钩子先给上一个渠道的子项加上 .leaving，place 才能按收起后的位置算
watch(current, () => place(), { flush: 'post' })
// 回到单一模式：滑动的选中块直接落到当前渠道上，再淡入
watch(aggregate, () => nextTick(() => place(true)))
// 展开 / 收起 M-Team 子项会改变各行的位置
watch(showSub, () => nextTick(() => place(true, false)))
watch(() => props.platforms, () => nextTick(() => place(true)))
</script>

<template>
  <Transition name="nav-scrim">
    <div v-if="overlay" class="nav-scrim" :class="mode" aria-hidden="true" @click="closeNav" />
  </Transition>

  <aside
    :id="'catbus-nav'"
    ref="aside"
    class="sidebar glass"
    :class="[mode, { rail, open: navOpen && mode !== 'desktop' }]"
    :style="dragStyle"
    :aria-label="t('layout.nav.label')"
    :role="overlay ? 'dialog' : undefined"
    :aria-modal="overlay ? 'true' : undefined"
    :aria-hidden="mode === 'phone' && !navOpen ? 'true' : undefined"
    :inert="mode === 'phone' && !navOpen ? true : undefined"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <GlassButton v-if="overlay" icon tone="quiet" class="nav-close" :aria-label="t('layout.nav.close')" @click="closeNav">
      <X :size="18" />
    </GlassButton>

    <SettingsButton v-if="!rail" class="settings-btn" />
    <LocalButton v-if="!rail" class="local-btn" :class="{ shifted: overlay }" :active="localPage" @click="pickLocal" />

    <header class="brand">
      <button
        v-if="rail"
        v-tip="t('layout.nav.expand')"
        type="button"
        class="rail-toggle"
        :aria-label="t('layout.nav.expand')"
        aria-controls="catbus-nav"
        :aria-expanded="false"
        @click="openNav"
      >
        <MascotAvatar :size="44" />
      </button>
      <MascotAvatar v-else :size="mode === 'phone' ? 88 : 112" />
      <template v-if="!rail">
        <div class="wordmark">catbus</div>
        <div class="slogan">{{ t('layout.slogan') }}</div>
      </template>
    </header>

    <div class="divider" />

    <div v-if="!rail" class="label">
      <ModeSwitch v-model="aggregate" :disabled="railPage ? t('rail.nav.noAggregate') : null" />
      <!-- 13 → 1/13：「1/」从 13 的后面向左滑出来 -->
      <span
        class="count mono"
        role="img"
        :aria-label="aggregate ? t('layout.nav.countSelected', { n: selected.length, total: platforms.length }, platforms.length) : t('layout.nav.count', { n: platforms.length + 1 }, platforms.length + 1)"
      >
        <span class="picked" :class="{ on: aggregate }" aria-hidden="true">
          <span class="picked-in">
            <Transition name="digit" mode="out-in">
              <span :key="pickedCount" class="digit">{{ pickedCount }}</span>
            </Transition>
            <span class="slash">/</span>
          </span>
        </span>
        <!-- 单一模式算上 12306；聚合模式的总数只算参与聚合的 -->
        <span class="total" aria-hidden="true">{{ aggregate ? platforms.length : platforms.length + 1 }}</span>
      </span>
    </div>

    <nav ref="list" class="channels" :class="{ multi: aggregate }">
      <span ref="highlight" class="highlight" aria-hidden="true" />
      <template v-for="p in platforms" :key="p.id">
        <ChannelItem
          :platform="p"
          :active="aggregate ? selected.includes(p.id) : !railPage && !localPage && !subsPage && p.id === active"
          :health="health.get(p.id) ?? null"
          :compact="rail"
          :multi="aggregate"
          :order="selected.indexOf(p.id) + 1"
          :busy="busy.has(p.id)"
          @click="pick(p.id)"
        />
        <Transition :css="false" @enter="subEnter" @leave="subLeave">
        <div v-if="showSub && p.id === active" class="subnav" role="group" :aria-label="t('mine.nav.label', { platform: platforms.find((x) => x.id === active)?.name ?? '' })">
          <GlassButton tone="quiet" class="sub" :class="{ 'is-on': !mePage && !livePage && !inboxPage }" :aria-current="!mePage && !livePage && !inboxPage ? 'page' : undefined" @click="pickSub('discover')">
            <Layers :size="15" aria-hidden="true" />{{ t('mteam.nav.discover') }}
          </GlassButton>
          <GlassButton v-if="hasMine(active)" tone="quiet" class="sub" :class="{ 'is-on': mePage }" :aria-current="mePage ? 'page' : undefined" @click="pickSub('me')">
            <UserRound :size="15" aria-hidden="true" />{{ t('mteam.nav.me') }}
          </GlassButton>
          <GlassButton v-if="hasLive(active)" tone="quiet" class="sub" :class="{ 'is-on': livePage }" :aria-current="livePage ? 'page' : undefined" @click="pickSub('live')">
            <Radio :size="15" aria-hidden="true" />{{ t('live.nav') }}
          </GlassButton>
          <GlassButton v-if="hasInbox(active)" tone="quiet" class="sub" :class="{ 'is-on': inboxPage }" :aria-current="inboxPage ? 'page' : undefined" @click="pickSub('inbox')">
            <Inbox :size="15" aria-hidden="true" />{{ t('inbox.nav') }}
            <span v-if="inboxBadge(active)" class="sub-badge mono" :aria-label="t('inbox.badge', { n: inboxBadge(active) }, inboxBadge(active))">{{ inboxBadge(active) > 99 ? '99+' : inboxBadge(active) }}</span>
          </GlassButton>
        </div>
        </Transition>
      </template>
      <div class="rail-sep" aria-hidden="true" />
      <ChannelItem
        :platform="RAIL"
        :active="railPage"
        :health="null"
        :compact="rail"
        :tag="t('rail.nav.tag')"
        :disabled="railOff"
        @click="pickRail"
      />
      <!-- 订阅：聚合模式下也能进 -->
      <ChannelItem
        :platform="SUBS"
        :active="subsPage"
        :health="null"
        :compact="rail"
        :multi="aggregate"
        :badge="subsUnread"
        @click="pickSubs"
      />
    </nav>

    <RailAccountCard v-if="railPage" :rail="rail" />
    <AccountSwitcher
      v-else
      :platforms="tabPlatforms"
      :focus="platforms.find((p) => p.id === active)!"
      :aggregate="aggregate"
      :accounts="accounts"
      :selected-of="selectedOf"
      :browsing-of="browsingOf"
      :is-expired="isExpired"
      :health="health"
      :source="source"
      :rail="rail"
      @toggle="(p: string, a: string) => $emit('toggleAccount', p, a)"
      @set-default="(p: string, a: string) => $emit('setDefault', p, a)"
      @remove="(p: string, a: string, done: (ok: boolean) => void) => $emit('remove', p, a, done)"
      @login="(p: string, a?: string) => $emit('login', p, a)"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  position: absolute;
  top: var(--sidebar-inset);
  left: var(--sidebar-inset);
  bottom: var(--sidebar-inset);
  width: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 14px 14px;
  border-radius: var(--sidebar-radius);
  box-shadow: var(--shadow-panel);
  z-index: 2;
  transition: top 0.5s var(--ease-out), left 0.5s var(--ease-out), bottom 0.5s var(--ease-out),
    border-radius 0.5s var(--ease-out), background 0.5s, box-shadow 0.5s;
}
.settings-btn {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 1;
}
.local-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
}
/* 侧栏浮出时右上角是关闭按钮：排到它左边 */
.local-btn.shifted {
  right: 56px;
}
.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.brand > :first-child {
  margin-bottom: 10px;
}
.wordmark {
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: 24px;
  letter-spacing: -0.5px;
}
.slogan {
  font-size: 12px;
  color: var(--ink-3);
}
.divider {
  height: 1px;
  background: var(--hair);
  flex: none;
}
.label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--ink-3);
}
.subnav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 6px 30px;
  padding-left: 10px;
  border-left: 1px solid var(--hair);
  scroll-margin-bottom: 28px;
}
/* 外观来自 GlassButton（quiet：平时无底，悬停 / 选中出玻璃胶囊） */
.sub {
  --lg-h: 36px;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 12px;
  font-size: 13.5px;
  text-align: left;
}
.sub.is-on {
  font-weight: 600;
}
/* 收件箱的未读角标：靠右，同渠道行的角标 */
.sub-badge {
  margin-left: auto;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  color: #fff;
  background: var(--red);
}
.sidebar.phone .sub {
  --lg-h: var(--tap);
}
.channels {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: none;
  mask-image: linear-gradient(to bottom, #000 calc(100% - 24px), transparent);
}
/* 渠道计数：13 → 1/13 */
.count {
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}
/* 裁剪区的右边缘就是「13」的左边缘：里面的字从右边缘外滑进来，看起来像从 13 后面抽出来 */
.picked {
  display: inline-flex;
  overflow: hidden;
}
.picked-in {
  display: inline-flex;
  transform: translateX(100%);
  opacity: 0;
  transition: transform 0.4s var(--ease-out), opacity 0.2s ease-in;
}
.picked.on .picked-in {
  transform: none;
  opacity: 1;
  transition: transform 0.6s cubic-bezier(0.3, 1.3, 0.5, 1), opacity 0.3s ease-out;
}
.digit {
  display: inline-block;
  color: var(--red);
}
.slash {
  margin: 0 1px;
}
.digit-enter-active,
.digit-leave-active {
  transition: transform 0.16s var(--ease-out), opacity 0.16s;
}
.digit-enter-from {
  transform: translateY(70%);
  opacity: 0;
}
.digit-leave-to {
  transform: translateY(-70%);
  opacity: 0;
}
/* 聚合模式：选中是多选的，每个渠道自己带底色（见 ChannelItem），滑动的选中块隐去 */
.channels.multi .highlight {
  opacity: 0 !important;
}
.highlight {
  transition: opacity 0.25s ease-out;
}
/* 12306 与内容平台之间的分隔线 */
.rail-sep {
  flex: none;
  height: 1px;
  margin: 6px 10px;
  background: var(--hair);
}
.highlight {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  opacity: 0;
  /* 单一模式滑动的选中底：玻璃胶囊，和 ChannelItem 的悬停 / 聚合选中同一套 --lg-* */
  border-radius: 999px;
  background: var(--lg-fill-hover);
  box-shadow: var(--lg-edge), var(--lg-shadow);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
}

/* 收起按钮：只在浮层形态（平板展开、手机抽屉）出现 */
/* 外观来自 GlassButton（quiet） */
.nav-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
}
@media (hover: none) and (pointer: coarse) {
  .nav-close {
    --lg-h: var(--tap);
    top: 6px;
    right: 6px;
  }
}

/* ---------- 平板：图标窄栏 / 展开后浮在内容上 ---------- */
.sidebar.tablet {
  overflow: hidden;
  transition: width 0.42s var(--ease-out), box-shadow 0.42s, background 0.5s;
}
.sidebar.tablet.rail {
  width: var(--sidebar-rail-w);
  padding: 14px 14px 12px;
  gap: 12px;
}
.sidebar.tablet.open {
  z-index: 40;
  background: color-mix(in srgb, var(--detail-bg) 90%, transparent);
  box-shadow: var(--shadow-panel), 0 24px 64px #0b0e1a33;
}
.rail-toggle {
  border-radius: 50%;
  display: grid;
  place-items: center;
  margin: 0 auto 2px;
}
.rail-toggle:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 3px;
}
.rail .brand > :first-child {
  margin-bottom: 0;
}
.rail .highlight {
  border-radius: 14px;
}

/* ---------- 手机：抽屉 ---------- */
.sidebar.phone {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: min(300px, 86vw);
  padding: calc(18px + var(--safe-top)) 14px calc(12px + var(--safe-bottom)) calc(14px + var(--safe-left));
  border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
  background: color-mix(in srgb, var(--detail-bg) 92%, transparent);
  z-index: 40;
  touch-action: pan-y;
  transform: translate3d(calc(-100% - 32px), 0, 0);
  visibility: hidden;
  transition: transform 0.38s var(--ease-out), visibility 0s linear 0.38s, background 0.5s;
}
.sidebar.phone.open {
  transform: translate3d(0, 0, 0);
  visibility: visible;
  transition: transform 0.38s var(--ease-out), visibility 0s, background 0.5s;
  box-shadow: 0 24px 64px #0b0e1a40;
}
.sidebar.phone .nav-close {
  top: calc(6px + var(--safe-top));
}

/* ---------- 遮罩 ---------- */
.nav-scrim {
  position: fixed;
  inset: 0;
  z-index: 39;
  background: var(--detail-scrim);
  touch-action: none;
}
.nav-scrim.tablet {
  background: color-mix(in srgb, var(--detail-scrim) 60%, transparent);
}
.nav-scrim-enter-active,
.nav-scrim-leave-active {
  transition: opacity 0.3s var(--ease-out);
}
.nav-scrim-enter-from,
.nav-scrim-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .picked-in,
  .picked.on .picked-in,
  .digit-enter-active,
  .digit-leave-active,
  .highlight {
    transition: none;
  }
  .sidebar.tablet,
  .sidebar.phone,
  .sidebar.phone.open {
    transition-duration: 0.01s;
  }
  .sidebar.phone {
    transition-delay: 0s;
  }
}
</style>

<style>
/* 手机抽屉打开时锁住背后滚动 */
html.nav-locked,
html.nav-locked body {
  overflow: hidden;
  overscroll-behavior: none;
}
</style>
