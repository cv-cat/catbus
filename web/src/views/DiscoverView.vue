<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Menu, RefreshCw, Rocket } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import SearchBar from '@/components/SearchBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import FilterChip from '@/components/FilterChip.vue'
import KindSwitch from '@/components/KindSwitch.vue'
import TimeFilter from '@/components/TimeFilter.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import SelectionActions from '@/components/SelectionActions.vue'
import DownloadCenter from '@/components/DownloadCenter.vue'
import MasonryGrid from '@/components/MasonryGrid.vue'
import StateView from '@/components/StateView.vue'
import LoadingBar from '@/components/LoadingBar.vue'
import { KINDS, SORTS, TIMES, TYPES, useDiscoverStore } from '@/stores/discover'
import { ORDERS, parseOrder } from '@/data/filters'
import { animateFrom, wave, waveWhileLoading } from '@/composables/motion'
import { openLogin } from '@/stores/login'
import { useSelectionStore } from '@/stores/selection'
import { useDownloadsStore } from '@/stores/downloads'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { openVerify } from '@/stores/verify'
import { useSourceStore } from '@/stores/source'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useNavStore } from '@/stores/nav'
import { platformById } from '@/data/platforms'
import type { Item } from '@/api/types'
import { errorTitle } from '@/i18n/errors'

const d = useDiscoverStore()
const { state } = d
const sel = useSelectionStore()
const downloads = useDownloadsStore()
const src = useSourceStore()
const bp = useBreakpoint()
const nav = useNavStore()
const { t } = useI18n()

/** 排序选项：当前平台不支持的置灰，原因放进 tooltip */
/** 声明了 --order-by 的平台（M-Team）换成字段排序：选中的那一项带方向箭头，再点一次切换升序 / 降序 */
const sortOptions = computed(() => {
  const fields = d.orderFields
  if (!fields) return SORTS.map((o) => ({ ...o, disabled: d.unsupported('sort', o.value) }))
  const cur = parseOrder(state.sort)
  return ORDERS.filter((o) => o.value === 'general' || fields.includes(o.value)).map((o) =>
    cur?.field === o.value
      ? { value: state.sort, label: `${o.label} ${cur.asc ? '↑' : '↓'}`, disabled: null }
      : { value: o.value as string, label: o.label as string, disabled: null },
  )
})
function toggleOrder() {
  const cur = parseOrder(state.sort)
  if (cur) state.sort = cur.asc ? cur.field : `${cur.field}_asc`
}

/**
 * 没有（已提交的）关键词时走推荐流（feed list）：筛选栏换成推荐流分类，排序 / 类型 / 时间不显示；
 * 只有推荐流的平台（猫眼）总是这样。声明了 --order-by 的平台（M-Team）浏览时仍保留字段排序。
 */
const feedUi = computed(() => !d.committed || (!d.aggregate && d.platform.mode === 'feed'))
const timeOptions = computed(() => TIMES.map((o) => ({ value: o.value as string, label: o.label as string, disabled: d.unsupported('time', o.value) })))
const kindLabel = computed(() => KINDS.find((k) => k.value === state.kind)?.label ?? t('filters.kind.recommend'))

/** 聚合模式下选中的渠道 */
const lanes = computed(() => d.selected.map((id) => platformById(id)!))
/** 顶栏小字：单一模式是「小红书 · 笔记搜索」，聚合模式列出渠道（多了只写前两个） */
const eyebrow = computed(() => {
  if (!d.aggregate) return t(d.platform.mode === 'feed' ? 'discover.eyebrow.feed' : 'discover.eyebrow.search', { platform: d.platform.name, item: d.platform.item })
  const names = lanes.value.map((p) => p.name)
  const sep = t('discover.eyebrow.sep')
  return names.length > 3
    ? t('discover.eyebrow.aggregateMany', { names: names.slice(0, 2).join(sep), n: names.length }, names.length)
    : t('discover.eyebrow.aggregate', { names: names.join(sep) })
})
const placeholder = computed(() =>
  d.aggregate && lanes.value.length > 1
    ? t('discover.search.placeholderMany', { n: lanes.value.length }, lanes.value.length)
    : t('discover.search.placeholder', { platform: d.platform.name, item: d.platform.item }),
)

/** 选中的条目按平台（和账号）各作为一批下载（聚合模式下可能来自几个平台），然后打开下载记录 */
/** 选中条目所属的平台：下载面板据此判断能不能带评论 */
const selectedPlatforms = computed(() => [...new Set(sel.pick(d.items).map((it) => d.platformOf(it)))])

async function downloadSelected() {
  const picked = sel.pick(d.items)
  if (!picked.length) return
  // 同一平台里按取到条目的账号再分（多账号合并时各条可能来自不同账号）
  const groups = new Map<string, { platform: string; account: string | null; list: Item[] }>()
  for (const it of picked) {
    const platform = d.platformOf(it)
    const account = d.accountOf(it, platform)
    const key = `${platform}\n${account ?? ''}`
    const g = groups.get(key) ?? { platform, account, list: [] }
    g.list.push(it)
    groups.set(key, g)
  }
  try {
    for (const g of groups.values()) await downloads.start(g.platform, g.account, g.list, commentsSupported(g.platform))
    sel.none()
    downloads.open = true
  } catch (e) {
    alert((e as Error).message)
  }
}

const root = ref<HTMLElement>()
const stuck = ref(false)
/** 滚过这段距离后右下角出现回顶按钮 */
const TOP_BUTTON_AFTER = 640
const showTop = ref(false)
const launching = ref(false)
/**
 * 回顶按钮：滚过 TOP_BUTTON_AFTER 后出现。不监听 scroll 读 scrollTop（页面上一直有 CSS 动画，样式每帧都是脏的，
 * 读一次就强制一次样式重算），改用 IntersectionObserver 看一个绝对定位在这个深度的 1px 哨兵：哨兵整个滚出容器顶部（scrollTop > TOP_BUTTON_AFTER）即出现。
 */
const topSentinel = ref<HTMLElement>()
let topIo: IntersectionObserver | undefined
function observeTop() {
  topIo = new IntersectionObserver(
    ([e]) => {
      if (!e) return
      const above = e.rootBounds ? e.boundingClientRect.bottom <= e.rootBounds.top : false
      showTop.value = !e.isIntersecting && above
    },
    { root: root.value },
  )
  topIo.observe(topSentinel.value!)
}

/*
 * 吸顶：筛选栏滚到容器内容区顶部（scrollTop > 筛选栏原位 − 容器 padding-top）时算吸顶。
 * 不在滚动事件里读样式和布局（会强制重算），改用 IntersectionObserver 看筛选栏前面的顶栏：
 * 顶栏底边越过「容器顶 + padding-top − 顶栏下外边距」时吸顶。顶栏高度变化（手机上两行）由 IO 自己处理；
 * padding-top、下外边距只随断点和安全区变，在容器尺寸变化时重算一次。
 */
const header = ref<HTMLElement>()
let stuckIo: IntersectionObserver | undefined
let stuckRo: ResizeObserver | undefined
let stuckMargin: number | undefined
function observeStuck() {
  const el = root.value
  const h = header.value
  if (!el || !h) return
  const margin = parseFloat(getComputedStyle(h).marginBottom) - parseFloat(getComputedStyle(el).paddingTop)
  if (margin === stuckMargin && stuckIo) return
  stuckMargin = margin
  stuckIo?.disconnect()
  stuckIo = new IntersectionObserver(([e]) => e && (stuck.value = !e.isIntersecting), {
    root: el,
    rootMargin: `${margin}px 0px 0px 0px`,
  })
  stuckIo.observe(h)
}

function toTop() {
  launching.value = true
  root.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
/** 筛选栏横向滚动：哪一端还有内容，就在哪一端加渐隐遮罩 */
const scroller = ref<HTMLElement>()
const fade = ref({ l: false, r: false })
function updateFade() {
  const el = scroller.value
  if (!el) return
  const l = el.scrollLeft > 2
  const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
  if (l !== fade.value.l || r !== fade.value.r) fade.value = { l, r }
}
let fadeRo: ResizeObserver | undefined

const sentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined

function submit(origin?: { x: number; y: number }) {
  if (origin) wave()
  root.value?.scrollTo({ top: 0, behavior: 'smooth' })
  d.search()
}

/** 人机验证：引导用户去浏览器里验证，回来后重新搜索 */
function verify(url: string) {
  openVerify({ platform: d.errorPlatform, url, message: d.error ? errorTitle(d.error) : undefined, retry: () => submit() })
}

/** 错误提示里的 `-a <账号>` 就是要重新登录的账号 */
function login() {
  const hinted = /\s-a\s+(\S+)/.exec(d.error?.hint ?? '')?.[1]
  openLogin(d.errorPlatform, hinted ?? d.accountFor(d.errorPlatform)?.account)
}

// 换渠道：先记下旧渠道的滚动位置（切回来时恢复），回到顶部（不平滑滚动）再请求；
// 新渠道有缓存时 run() 直接恢复结果，下面的 watch 再滚回它离开时的位置
watch(
  () => state.platform,
  (_, old) => {
    // 聚合模式下平台只是最后点选的渠道，结果不换
    if (d.aggregate) return
    if (old) d.rememberScroll(old, root.value?.scrollTop ?? 0)
    root.value?.scrollTo({ top: 0 })
    d.search()
  },
)
watch(
  () => d.restoredScroll,
  (r) => {
    if (!r) return
    // 等瀑布流按缓存的条目排好再滚，否则内容高度不够、滚不到原位
    void nextTick(() => requestAnimationFrame(() => root.value?.scrollTo({ top: r.top })))
  },
)

/** 刷新当前渠道：丢掉缓存，按已提交的查询重新请求 */
function refresh() {
  wave()
  root.value?.scrollTo({ top: 0, behavior: 'smooth' })
  d.refresh()
}
watch(() => [state.sort, state.type, state.kind, state.time], () => submit())

/** 加载中右上角实时跳动的耗时：从 0.00s 开始涨，结束后换成最终的条数和耗时 */
const ticking = ref(0)
let tickTimer: ReturnType<typeof setInterval> | undefined
watch(
  () => d.loading,
  (on) => {
    // 加载期间背景持续起人浪
    waveWhileLoading(on)
    clearInterval(tickTimer)
    if (!on) return
    const t0 = performance.now()
    ticking.value = 0
    tickTimer = setInterval(() => (ticking.value = (performance.now() - t0) / 1000), 50)
  },
  { immediate: true },
)

/**
 * IntersectionObserver 只在「进入 / 离开」时回调：第一页太短（宽屏六列时常见），加载完后哨兵仍在
 * rootMargin 内，状态没变就不会再回调，滚到底也不翻页。每次加载结束后重新 observe 一次，
 * 观察器会立刻按当前位置回调，仍可见就接着翻。
 */
watch(
  () => d.loading || d.loadingMore,
  (busy) => {
    if (busy || !io || !sentinel.value) return
    void nextTick(() => {
      io!.unobserve(sentinel.value!)
      io!.observe(sentinel.value!)
    })
  },
)

onMounted(() => {
  animateFrom(
    root.value!.querySelectorAll('.reveal'),
    { y: -10, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out', stagger: 0.06, delay: 0.1 },
  )
  io = new IntersectionObserver(([e]) => e?.isIntersecting && !d.loading && d.loadMore(), { root: root.value, rootMargin: '600px' })
  io.observe(sentinel.value!)
  fadeRo = new ResizeObserver(updateFade)
  fadeRo.observe(scroller.value!)
  updateFade()
  stuckRo = new ResizeObserver(observeStuck)
  stuckRo.observe(root.value!)
  observeTop()
})
onBeforeUnmount(() => {
  io?.disconnect()
  fadeRo?.disconnect()
  stuckRo?.disconnect()
  stuckIo?.disconnect()
  topIo?.disconnect()
  clearInterval(tickTimer)
  waveWhileLoading(false)
})
</script>

<template>
  <main ref="root" class="discover" :class="{ 'has-bar': bp.phone && sel.active }">
    <i ref="topSentinel" class="top-sentinel" :style="{ top: `${TOP_BUTTON_AFTER - 1}px` }" aria-hidden="true" />
    <header ref="header" class="top">
      <button
        v-if="bp.phone"
        type="button"
        class="menu glass reveal"
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </button>
      <div class="title reveal">
        <div class="eyebrow">{{ eyebrow }}</div>
        <div class="heading">
          <h1>{{ t('discover.title') }}</h1>
          <span v-if="src.source === 'demo'" class="demo-tag" :title="t('discover.demo.title')">
            <i class="demo-dot" aria-hidden="true" /><span class="demo-long">{{ t('discover.demo.long') }}</span><span class="demo-short">{{ t('discover.demo.short') }}</span>
          </span>
        </div>
      </div>
      <div class="spacer" />
      <SelectionActions v-if="!bp.phone" :items="d.items" :platforms="selectedPlatforms" @download="downloadSelected" />
      <SearchBar
        v-model="state.keyword"
        class="search reveal"
        :hotkey="!stuck"
        :loading="d.loading"
        :placeholder="placeholder"
        @submit="submit"
      />
      <DownloadCenter class="tool reveal" />
      <ThemeToggle class="tool reveal" />
    </header>

    <div class="filters reveal" :class="{ stuck }">
      <div
        ref="scroller"
        class="filter-scroll"
        :class="{ 'fade-l': fade.l, 'fade-r': fade.r }"
        @scroll.passive="updateFade"
      >
        <!-- 没有关键词：推荐流分类（+ M-Team 的字段排序）；有关键词：排序、类型、时间。两组交叉淡入 -->
        <Transition name="fgroup" mode="out-in" @after-enter="updateFade">
          <div v-if="feedUi" key="feed" class="fgroup">
            <KindSwitch v-if="d.kindSwitch" v-model="state.kind" :unsupported="(v) => d.unsupported('kind', v)" />
            <SegmentedControl v-if="d.orderFields" v-model="state.sort" :options="sortOptions" :label="t('discover.filter.sort')" @reselect="toggleOrder" />
          </div>
          <div v-else key="search" class="fgroup">
            <SegmentedControl v-model="state.sort" :options="sortOptions" :label="t('discover.filter.sort')" @reselect="toggleOrder" />
            <FilterChip
              v-for="ty in TYPES"
              :key="ty.value"
              :active="state.type === ty.value"
              :disabled="d.unsupported('type', ty.value)"
              @click="state.type = ty.value"
            >
              {{ ty.label }}
            </FilterChip>
            <TimeFilter v-model="state.time" :options="timeOptions" :disabled="d.unsupportedAll('time')" />
          </div>
        </Transition>
      </div>
      <SelectionActions v-if="stuck && !bp.phone" compact :items="d.items" :platforms="selectedPlatforms" @download="downloadSelected" />
      <Transition name="mini-search">
        <SearchBar
          v-if="stuck && !bp.phone"
          v-model="state.keyword"
          class="mini-search"
          compact
          input-id="catbus-search-mini"
          :hotkey="stuck"
          :loading="d.loading"
          :placeholder="placeholder"
          @submit="submit"
        />
      </Transition>
      <span v-if="d.loading && !bp.phone" class="count mono glass loading-count" aria-live="polite">
        <CatbusLoader :size="14" />{{ t('common.state.loading') }}<span class="tick" aria-hidden="true">{{ ticking.toFixed(2) }}s</span>
      </span>
      <span v-else-if="d.elapsed != null && !d.error && !bp.phone" class="count mono glass done-count">
        <button type="button" class="refresh" :aria-label="t('common.action.refresh')" :title="t('common.action.refresh')" @click="refresh">
          <RefreshCw :size="13" />
        </button>
        <template v-if="feedUi && d.kindSwitch">{{ t('discover.count.feed', { kind: kindLabel, n: d.items.length }, d.items.length) }}</template>
        <template v-else>{{ t('discover.count.search', { n: d.items.length, elapsed: d.elapsed.toFixed(2) }, d.items.length) }}</template>
      </span>
      <!-- 筛选栏底边的进度条：跟着筛选栏吸顶，手机上同样贴在筛选栏下沿 -->
      <LoadingBar class="filters-progress" :active="d.loading" />
    </div>

    <StateView v-if="d.error && !d.items.length" kind="error" :error="d.error" @retry="submit()" @login="login" @verify="verify" />
    <StateView v-else-if="!d.loading && !d.items.length && d.elapsed != null" kind="empty" />
    <MasonryGrid v-else :cells="d.cells" :aggregate="d.aggregate" :loading="d.loading" :stale="d.refreshing" />

    <div ref="sentinel" class="sentinel" aria-hidden="true" />
    <p v-if="d.loadingMore" class="more mono"><CatbusLoader :size="15" />{{ t('common.state.loading') }}</p>
    <p v-else-if="d.items.length && !d.hasMore" class="more mono">{{ t('discover.end') }}</p>

    <SelectionActions v-if="bp.phone" bar :items="d.items" :platforms="selectedPlatforms" @download="downloadSelected" />

    <Transition name="to-top" @after-leave="launching = false">
      <button
        v-if="showTop"
        class="to-top glass"
        :class="{ launching }"
        type="button"
        :aria-label="t('discover.toTop')"
        :title="t('discover.toTop')"
        @click="toTop"
      >
        <Rocket :size="20" />
      </button>
    </Transition>
  </main>
</template>

<style scoped>
/* 回顶按钮的哨兵：脱离文档流，不占位置，只给 IntersectionObserver 看 */
.top-sentinel {
  position: absolute;
  left: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  visibility: hidden;
}
.discover {
  position: absolute;
  /* 左边留 12px 内边距（整体左移 12px，内容位置不变）：
     卡片悬停放大、选中描边、焦点框不会被滚动容器裁掉 */
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(16px + var(--safe-right)) calc(40px + var(--safe-bottom)) 12px;
  z-index: 1;
  transition: left 0.5s var(--ease-out), padding-bottom 0.3s;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.title {
  flex: none;
  white-space: nowrap;
}
.eyebrow {
  font-size: 12px;
  color: var(--ink-3);
}
.heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
/* 演示模式标记：黄色玻璃质感 */
.demo-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 4px 11px 4px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: #8a5a00;
  background: linear-gradient(135deg, #ffe08acc 0%, #f5b8244d 100%);
  border: 1px solid #f5c84299;
  box-shadow:
    inset 0 1px 0 #ffffffb3,
    inset 0 -1px 0 #e0a10a26,
    0 4px 14px #f5a52433;
  backdrop-filter: blur(12px) saturate(1.6);
}
.demo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a524;
  box-shadow: 0 0 0 3px #f5a52433;
}
[data-theme='dark'] .demo-tag {
  color: #ffd770;
  background: linear-gradient(135deg, #f5b82438 0%, #f5a5241a 100%);
  border-color: #f5c84259;
  box-shadow:
    inset 0 1px 0 #ffffff1f,
    0 4px 16px #f5a52426;
}
h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.spacer {
  flex: 1;
}
.search {
  width: min(520px, 46vw);
}
/* 选择操作按钮从搜索框底下滑出 */
.search,
.mini-search {
  position: relative;
  z-index: 2;
}
.filters {
  position: sticky;
  top: -16px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  /* 左右都伸进容器的内边距（左 12px、右 16px），吸顶时背景铺满 */
  margin: 0 -16px 18px -12px;
  padding: 10px 16px 10px 22px;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}
.filters.stuck {
  background: var(--glass);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 8px 24px #1b1f2e10;
}
.filters {
  transition: background 0.3s, box-shadow 0.3s;
}
/* 排序和类型：放不下时横向滚动，不换行；两端按是否还有内容渐隐 */
.filter-scroll {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-width: none;
  /* 上下留出悬停上浮和阴影的位置，不被滚动容器裁掉 */
  padding: 4px 2px;
  margin: -4px -2px;
  --fl: 0px;
  --fr: 0px;
}
/* 遮罩只在可以滚动时加：遮罩会让里面的玻璃（backdrop-filter）取不到背后的内容，桌面上保持原样 */
.filter-scroll.fade-l,
.filter-scroll.fade-r {
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--fl), #000 calc(100% - var(--fr)), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 var(--fl), #000 calc(100% - var(--fr)), transparent);
}
.filter-scroll::-webkit-scrollbar {
  display: none;
}
.filter-scroll.fade-l {
  --fl: 28px;
}
.filter-scroll.fade-r {
  --fr: 28px;
}
.filter-scroll > * {
  flex: none;
  scroll-snap-align: start;
}
/* 一组筛选（推荐流分类 / 排序、类型、时间）：组内同样横排，滚动吸附到每一项 */
.fgroup {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fgroup > * {
  flex: none;
  scroll-snap-align: start;
}
.fgroup-enter-active,
.fgroup-leave-active {
  transition: opacity 0.2s cubic-bezier(0.65, 0, 0.35, 1);
}
.fgroup-enter-from,
.fgroup-leave-to {
  opacity: 0;
}
.count {
  flex: none;
  padding: 7px 12px;
  border-radius: 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--ink-2);
  white-space: nowrap;
}
.done-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-left: 6px;
}
.refresh {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin: -2px 0;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: none;
  color: var(--ink-2);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}
.refresh:hover,
.refresh:focus-visible {
  color: var(--red);
  background: var(--red-soft);
}
.refresh svg {
  transition: transform 0.5s var(--ease-out);
}
.refresh:hover svg {
  transform: rotate(180deg);
}
.loading-count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tick {
  margin-left: 2px;
  min-width: 4.5ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
}
.filters-progress {
  position: absolute;
  left: 22px;
  right: 16px;
  bottom: 0;
}
.sentinel {
  height: 1px;
}
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
  margin: 24px 0 0;
}

/* 滚动后筛选栏里的迷你搜索框：从上方弹入 */
.mini-search {
  width: min(440px, 34vw);
  transform-origin: right center;
}
.mini-search-enter-active {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out;
}
.mini-search-leave-active {
  transition: transform 0.2s ease-in, opacity 0.2s ease-in;
}
.mini-search-enter-from {
  opacity: 0;
  transform: translateY(-14px) scale(0.92);
}
.mini-search-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

/* 回顶按钮：从右侧弹入，点击后火箭向上发射 */
.to-top {
  position: fixed;
  right: calc(28px + var(--safe-right));
  bottom: calc(28px + var(--safe-bottom));
  z-index: 10;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
  box-shadow: 0 10px 30px #1b1f2e1f;
  transition: color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-out);
}
.to-top:hover {
  color: var(--red);
  transform: translateY(-3px);
  box-shadow: 0 14px 34px #1b1f2e29, 0 0 0 4px var(--red-soft);
}
.to-top svg {
  transform: rotate(-45deg);
  transition: transform 0.3s var(--ease-out);
}
.to-top:hover svg {
  transform: rotate(-45deg) translate(1px, -1px);
}
.to-top.launching svg {
  animation: launch 0.6s cubic-bezier(0.55, 0, 0.75, 0) forwards;
}
@keyframes launch {
  to {
    transform: rotate(-45deg) translate(28px, -28px);
    opacity: 0;
  }
}
.to-top-enter-active {
  transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease-out;
}
.to-top-leave-active {
  transition: transform 0.3s ease-in, opacity 0.3s ease-in;
}
.to-top-enter-from,
.to-top-leave-to {
  opacity: 0;
  transform: translateX(120px);
}

/* 手机上顶栏放不下完整的演示标记，只写「演示」 */
.demo-short {
  display: none;
}
@media (max-width: 640px) {
  .demo-long {
    display: none;
  }
  .demo-short {
    display: inline;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mini-search-enter-active,
  .mini-search-leave-active,
  .to-top-enter-active,
  .to-top-leave-active {
    transition: opacity 0.2s;
  }
  .mini-search-enter-from,
  .mini-search-leave-to,
  .to-top-enter-from,
  .to-top-leave-to {
    transform: none;
  }
  .to-top.launching svg {
    animation: none;
  }
}

/* 顶栏放不下一行时：搜索框单独一行（平板窄的一端） */
@media (max-width: 820px) {
  .top {
    flex-wrap: wrap;
  }
  .search {
    order: 5;
    width: 100%;
  }
}
/* 平板：迷你搜索框收窄；吸顶时不显示计数，给筛选留地方 */
@media (max-width: 1024px) {
  .mini-search {
    width: min(260px, 30vw);
  }
  .filters.stuck .count {
    display: none;
  }
}
/* 手机 */
.menu {
  flex: none;
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
}
@media (max-width: 640px) {
  .discover {
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom))
      calc(12px + var(--safe-left));
  }
  /* 选择模式的底部操作条出现时，最后一排卡片不被挡住 */
  .discover.has-bar {
    padding-bottom: calc(108px + var(--safe-bottom));
  }
  .top {
    gap: 8px;
    margin-bottom: 12px;
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .spacer {
    display: none;
  }
  .eyebrow {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  h1 {
    font-size: 22px;
  }
  .heading {
    gap: 8px;
    min-width: 0;
  }
  .demo-tag {
    min-width: 0;
    padding: 3px 9px 3px 7px;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .demo-dot {
    flex: none;
  }
  .tool {
    flex: none;
  }
  .search {
    order: 5;
    width: 100%;
  }
  .filters {
    /* 吸顶时停在刘海下面；上方的安全区用 ::before 补上同样的玻璃背景 */
    top: -12px;
    margin: 0 calc(-12px - var(--safe-right)) 12px calc(-12px - var(--safe-left));
    padding: 8px 0;
    border-radius: 0 0 var(--radius-md) var(--radius-md);
  }
  .filters.stuck::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: var(--safe-top);
    background: var(--glass);
    backdrop-filter: blur(30px) saturate(1.6);
  }
  .filter-scroll {
    padding: 4px calc(16px + var(--safe-right)) 4px calc(16px + var(--safe-left));
    margin: -4px 0;
    scroll-padding-inline: 16px;
  }
  .filter-scroll.fade-l {
    --fl: 20px;
  }
  .filters-progress {
    left: calc(12px + var(--safe-left));
    right: calc(12px + var(--safe-right));
  }
  .filter-scroll.fade-r {
    --fr: 40px;
  }
  .to-top {
    right: calc(14px + var(--safe-right));
    bottom: calc(16px + var(--safe-bottom));
    width: var(--tap);
    height: var(--tap);
    transition: color 0.2s, box-shadow 0.25s, transform 0.25s var(--ease-out), bottom 0.35s var(--ease-out);
  }
  .to-top svg {
    width: 18px;
    height: 18px;
  }
  /* 底部操作条出现时上移避让 */
  .has-bar .to-top {
    bottom: calc(92px + var(--safe-bottom));
  }
}
@media (hover: none) {
  .to-top:hover {
    transform: none;
    color: var(--ink);
    box-shadow: 0 10px 30px #1b1f2e1f;
  }
}
</style>
