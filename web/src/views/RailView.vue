<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Menu, RefreshCw, TrainFront } from 'lucide-vue-next'
import ThemeToggle from '@/components/ThemeToggle.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import AppSelect, { type SelectOption } from '@/components/AppSelect.vue'
import SettingSwitch from '@/components/settings/SettingSwitch.vue'
import LoadingBar from '@/components/LoadingBar.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import StateView from '@/components/StateView.vue'
import BackToTop from '@/components/BackToTop.vue'
import RailForm from '@/components/rail/RailForm.vue'
import TicketRow from '@/components/rail/TicketRow.vue'
import TransferCard from '@/components/rail/TransferCard.vue'
import { DIRECT_SORTS, TRAIN_KINDS, TRANSFER_SORTS, monthDay, weekday, type DirectSort, type TransferSort } from '@/composables/rail'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { waveWhileLoading } from '@/composables/motion'
import { useRailStore, type RailView } from '@/stores/rail'
import { useNavStore } from '@/stores/nav'
import { useSourceStore } from '@/stores/source'

/**
 * 12306 查询页（AGENTS.md 7.9「12306 查询页」，设计稿 V1–V5）：表单、直达 / 中转、车型与只看有票、排序、
 * 结果列表和各种状态。只查询时刻和余票，没有任何购票按钮。
 */
const { t } = useI18n()
const rail = useRailStore()
const bp = useBreakpoint()
const nav = useNavStore()
const src = useSourceStore()

const viewOptions = computed(() => [
  { value: 'direct' as RailView, label: t('rail.view.direct') },
  { value: 'transfer' as RailView, label: t('rail.view.transfer') },
])
const view = computed({ get: () => rail.view, set: (v: RailView) => rail.setView(v) })
const directSorts = computed(() => DIRECT_SORTS.map((v) => ({ value: v, label: t(`rail.sort.${v}`) })))
const transferSorts = computed(() => TRANSFER_SORTS.map((v) => ({ value: v, label: t(`rail.sort.transfer.${v}`) })))
const viaModel = computed({ get: () => rail.via ?? '', set: (v: string) => rail.setVia(v || null) })
const viaOptions = computed<SelectOption<string>[]>(() => [
  { value: '', label: t('rail.via.any') },
  ...rail.vias.map((v, i) => ({ value: v, label: v, divider: i === 0 })),
])

const result = computed(() => (rail.view === 'direct' ? rail.direct : rail.transfer))
const loading = computed(() => result.value.loading)
const count = computed(() => (rail.view === 'direct' ? rail.tickets.length : rail.plans.length))

// 加载中右上角实时跳动的耗时；背景持续起人浪
const ticking = ref(0)
let tickTimer: ReturnType<typeof setInterval> | undefined
watch(
  loading,
  (on) => {
    waveWhileLoading(on)
    clearInterval(tickTimer)
    if (!on) return
    const t0 = performance.now()
    ticking.value = 0
    tickTimer = setInterval(() => (ticking.value = (performance.now() - t0) / 1000), 50)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearInterval(tickTimer)
  waveWhileLoading(false)
})

const summary = computed(() => {
  const q = rail.query
  if (!q) return ''
  return `${q.from} → ${q.to} · ${monthDay(q.date)} ${weekday(q.date)}`
})
/**
 * 吸顶：查询表单滚到顶时停在上面（手机上表单太高，不吸顶）。
 * 不在滚动事件里读布局，用 IntersectionObserver 看表单前面的顶栏：表单碰到容器顶边时算吸顶，换成铺满宽度的玻璃条。
 */
const root = ref<HTMLElement>()
const header = ref<HTMLElement>()
const stuck = ref(false)
let stuckIo: IntersectionObserver | undefined
onMounted(() => {
  // 表单到顶时顶栏底边正好在容器顶上方「顶栏下外边距」处
  const margin = parseFloat(getComputedStyle(header.value!).marginBottom)
  stuckIo = new IntersectionObserver(([e]) => e && (stuck.value = !e.isIntersecting), { root: root.value, rootMargin: `${margin}px 0px 0px 0px` })
  stuckIo.observe(header.value!)
})
onBeforeUnmount(() => stuckIo?.disconnect())

/** 骨架行数 */
const skeleton = 6
</script>

<template>
  <main ref="root" class="rail-page">
    <header ref="header" class="top">
      <button
        v-if="bp.phone"
        type="button"
        class="menu glass"
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </button>
      <div class="title">
        <div class="eyebrow">{{ t('rail.eyebrow') }}</div>
        <div class="heading">
          <h1>{{ t('rail.title') }}</h1>
          <span v-if="src.source === 'demo'" class="demo-tag" :title="t('discover.demo.title')">
            <i class="demo-dot" aria-hidden="true" /><span class="demo-long">{{ t('discover.demo.long') }}</span
            ><span class="demo-short">{{ t('discover.demo.short') }}</span>
          </span>
        </div>
      </div>
      <div class="spacer" />
      <ThemeToggle class="tool" />
    </header>

    <RailForm class="rail-form" :class="{ stuck: stuck && !bp.phone }" />

    <template v-if="rail.query">
      <div class="filters">
        <SegmentedControl v-model="view" :options="viewOptions" :label="t('rail.view.label')" />

        <template v-if="rail.view === 'direct'">
          <div class="kinds" role="group" :aria-label="t('rail.kind.label')">
            <span v-if="!bp.phone" class="group-label">{{ t('rail.kind.label') }}</span>
            <button type="button" class="chip" :class="{ on: !rail.kinds.size }" :aria-pressed="!rail.kinds.size" @click="rail.toggleKind('all')">
              {{ t('rail.kind.all') }}
            </button>
            <button
              v-for="k in TRAIN_KINDS"
              :key="k"
              type="button"
              class="chip"
              :class="{ on: rail.kinds.has(k) }"
              :aria-pressed="rail.kinds.has(k)"
              @click="rail.toggleKind(k)"
            >
              {{ k === 'other' ? t('rail.kind.other') : `${k} ${t(`rail.kind.${k}`)}` }}
            </button>
          </div>
          <label class="avail">
            <SettingSwitch v-model="rail.available" :aria-label="t('rail.available')" />
            <span>{{ t('rail.available') }}</span>
          </label>
        </template>
        <div v-else class="via">
          <span class="group-label">{{ t('rail.via.label') }}</span>
          <AppSelect v-model="viaModel" :options="viaOptions" :title="t('rail.via.label')" :label="t('rail.via.label')" />
        </div>

        <span class="spacer" />
        <span v-if="loading && !bp.phone" class="count mono glass" aria-live="polite">
          <CatbusLoader :size="14" />{{ t('common.state.loading') }}<span class="tick" aria-hidden="true">{{ ticking.toFixed(2) }}s</span>
        </span>
        <span v-else-if="result.elapsed != null && !result.error && !bp.phone" class="count mono glass">
          <button type="button" class="refresh" :aria-label="t('common.action.refresh')" v-tip="t('common.action.refresh')" @click="rail.refresh()">
            <RefreshCw :size="13" />
          </button>
          {{
            rail.view === 'direct'
              ? t('rail.count.trains', { n: count, elapsed: result.elapsed.toFixed(2) }, count)
              : t('rail.count.plans', { n: count, elapsed: result.elapsed.toFixed(2) }, count)
          }}
        </span>
        <LoadingBar class="progress" :active="loading" />
      </div>

      <div class="summary">
        <span class="sum-text">
          <template v-if="bp.phone && result.data">
            {{ rail.view === 'direct' ? t('rail.count.trainsShort', { n: count }, count) : t('rail.count.plansShort', { n: count }, count) }}
            <template v-if="rail.view === 'direct' && rail.sameCity"> · {{ t('rail.sameCity') }}</template>
          </template>
          <template v-else-if="!bp.phone">
            {{ summary }}<template v-if="rail.view === 'direct' && rail.sameCity"> · {{ t('rail.sameCity') }}</template>
          </template>
        </span>
        <template v-if="rail.view === 'direct'">
          <AppSelect
            v-if="bp.phone"
            v-model="rail.directSort"
            :options="directSorts as SelectOption<DirectSort>[]"
            :title="t('rail.sort.label')"
            :label="t('rail.sort.label')"
          />
          <SegmentedControl v-else v-model="rail.directSort" :options="directSorts" :label="t('rail.sort.label')" />
        </template>
        <template v-else>
          <AppSelect
            v-if="bp.phone"
            v-model="rail.transferSort"
            :options="transferSorts as SelectOption<TransferSort>[]"
            :title="t('rail.sort.label')"
            :label="t('rail.sort.label')"
          />
          <SegmentedControl v-else v-model="rail.transferSort" :options="transferSorts" :label="t('rail.sort.label')" />
        </template>
      </div>

      <p v-if="rail.view === 'transfer'" class="note"><Info :size="14" aria-hidden="true" />{{ t('rail.transfer.note') }}</p>

      <!-- 状态 -->
      <StateView v-if="result.error && !result.data" kind="error" :error="result.error" @retry="rail.refresh()" />
      <div v-else-if="loading && !result.data" class="list" aria-busy="true">
        <div v-for="i in skeleton" :key="i" class="skeleton glass">
          <i class="sk w1" /><i class="sk w2" /><i class="sk w3" /><i class="sk w2" /><i class="sk w4" />
        </div>
      </div>
      <template v-else-if="rail.view === 'direct' && result.data">
        <div v-if="!result.data.length" class="empty glass">
          <TrainFront :size="26" class="empty-icon" />
          <h2>{{ t('rail.empty.direct') }}</h2>
          <p>{{ t('rail.empty.directDesc', { from: rail.query.from, to: rail.query.to, date: monthDay(rail.query.date) }) }}</p>
          <button type="button" class="btn primary" @click="rail.setView('transfer')">{{ t('rail.empty.toTransfer') }}</button>
        </div>
        <div v-else-if="!rail.tickets.length" class="empty glass">
          <TrainFront :size="26" class="empty-icon" />
          <h2>{{ t('rail.empty.filtered') }}</h2>
          <p>{{ t('rail.empty.filteredDesc') }}</p>
          <button type="button" class="btn primary" @click="rail.clearFilters()">{{ t('rail.empty.clear') }}</button>
        </div>
        <div v-else class="list" :class="{ stale: loading }">
          <TicketRow v-for="x in rail.tickets" :key="rail.rowKey(x)" :ticket="x" />
        </div>
      </template>
      <template v-else-if="rail.view === 'transfer' && result.data">
        <div v-if="!result.data.length" class="empty glass">
          <TrainFront :size="26" class="empty-icon" />
          <h2>{{ t('rail.empty.transfer') }}</h2>
          <p>{{ t('rail.empty.transferDesc') }}</p>
        </div>
        <div v-else class="list" :class="{ stale: loading }">
          <TransferCard v-for="p in rail.plans" :key="p.id" :plan="p" />
        </div>
      </template>
    </template>

    <div v-else class="empty glass intro">
      <TrainFront :size="28" class="empty-icon" />
      <h2>{{ t('rail.empty.intro') }}</h2>
      <p>{{ t('rail.empty.introDesc') }}</p>
    </div>
    <BackToTop />
  </main>
</template>

<style scoped>
.rail-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  /* 左右内边距单独成变量：吸顶的表单要伸进去铺满宽度 */
  --pad-l: 28px;
  --pad-r: calc(24px + var(--safe-right));
  padding: 16px var(--pad-r) calc(40px + var(--safe-bottom)) var(--pad-l);
  z-index: 2;
  transition: left 0.5s var(--ease-out);
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
h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.spacer {
  flex: 1;
}
.menu {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--ink);
}
.demo-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 4px 11px 4px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #8a5a00;
  background: linear-gradient(135deg, #ffe08acc 0%, #f5b8244d 100%);
  border: 1px solid #f5c84299;
  box-shadow: inset 0 1px 0 #ffffffb3, 0 4px 14px #f5a52433;
  backdrop-filter: blur(12px) saturate(1.6);
}
.demo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f5a524;
  box-shadow: 0 0 0 3px #f5a52433;
}
.demo-short {
  display: none;
}
[data-theme='dark'] .demo-tag {
  color: #ffd770;
  background: linear-gradient(135deg, #f5b82438 0%, #f5a5241a 100%);
  border-color: #f5c84259;
  box-shadow: inset 0 1px 0 #ffffff1f, 0 4px 16px #f5a52426;
}

/* ---------- 查询表单吸顶 ---------- */
/* 与发现页的筛选栏一致：贴着容器顶边，左右伸进容器的内边距铺满，上边直角、下边圆角 */
.rail-page .rail-form {
  position: sticky;
  top: -16px;
  transition: background 0.3s, box-shadow 0.3s, border-radius 0.3s;
}
.rail-page .rail-form.stuck {
  margin: 0 calc(-1 * var(--pad-r)) 0 calc(-1 * var(--pad-l));
  padding-left: calc(20px + var(--pad-l));
  padding-right: calc(20px + var(--pad-r));
  border-color: transparent;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: var(--glass);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 8px 24px #1b1f2e10;
}

/* ---------- 筛选栏 ---------- */
.filters {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 18px 0 12px;
  padding-bottom: 8px;
}
.group-label {
  font-size: 12.5px;
  color: var(--ink-3);
  white-space: nowrap;
}
.kinds {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.kinds::-webkit-scrollbar {
  display: none;
}
.kinds .group-label {
  margin-right: 6px;
}
.chip {
  flex: none;
  height: 32px;
  padding: 0 11px;
  border-radius: 999px;
  font-size: 13px;
  color: var(--ink-2);
  white-space: nowrap;
  border: 1px solid transparent;
}
.chip:hover {
  background: var(--hair);
}
.chip.on {
  background: var(--red-soft);
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
  font-weight: 600;
}
.avail {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-left: 14px;
  border-left: 1px solid var(--hair);
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
}
.via {
  display: flex;
  align-items: center;
  gap: 10px;
}
.count {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 16px;
  font-size: 12px;
  line-height: 18px;
  color: var(--ink-2);
  white-space: nowrap;
}
.tick {
  min-width: 4.5ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--ink-3);
}
.refresh {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--ink-2);
}
.refresh:hover {
  color: var(--red);
  background: var(--red-soft);
}
.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.sum-text {
  font-size: 13px;
  color: var(--ink-2);
}
.note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: var(--hair);
  font-size: 12.5px;
  color: var(--ink-2);
}

/* ---------- 列表与状态 ---------- */
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 变淡加在每一行上，不加在整个列表上：列表可能有几百行毛玻璃、几万像素高，
   整体设 opacity 要建一块超大的离屏图层，加载时下半截来不及画，会露出一片白 */
.list > * {
  transition: opacity 0.25s;
}
.list.stale {
  pointer-events: none;
}
.list.stale > * {
  opacity: 0.5;
}
.skeleton {
  display: grid;
  grid-template-columns: 76px 112px 120px 112px 1fr;
  gap: 16px;
  align-items: center;
  height: 76px;
  padding: 0 20px;
  border-radius: var(--radius-lg);
}
.sk {
  height: 14px;
  border-radius: 7px;
  background: var(--skeleton);
  animation: sk 1.2s ease-in-out infinite;
}
.w1 {
  width: 60%;
}
.w2 {
  width: 80%;
}
.w3 {
  width: 70%;
}
.w4 {
  width: 50%;
}
@keyframes sk {
  50% {
    opacity: 0.5;
  }
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 44px 24px;
  border-radius: var(--radius-lg);
  text-align: center;
}
.empty.intro {
  margin-top: 18px;
}
.empty-icon {
  color: var(--red);
  margin-bottom: 4px;
}
.empty h2 {
  margin: 0;
  font-size: 17px;
}
.empty p {
  margin: 0;
  max-width: 440px;
  font-size: 13px;
  color: var(--ink-3);
}
.btn {
  margin-top: 8px;
  padding: 9px 18px;
  border-radius: 999px;
  font-size: 13.5px;
  font-weight: 600;
}
.btn.primary {
  background: var(--primary-btn);
  color: #fff;
}

@media (max-width: 1024px) {
  .rail-page {
    --pad-l: 20px;
  }
  .filters {
    flex-wrap: wrap;
  }
}
@media (max-width: 640px) {
  /* 手机上表单有好几行，吸顶会占掉半屏 */
  .rail-page .rail-form {
    position: relative;
  }
  .rail-page {
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
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
  h1 {
    font-size: 22px;
  }
  .demo-long {
    display: none;
  }
  .demo-short {
    display: inline;
  }
  .filters {
    gap: 10px;
    margin: 14px 0 10px;
  }
  .filters .spacer {
    display: block;
  }
  .kinds {
    order: 5;
    flex-basis: 100%;
    margin: 0 -12px;
    padding: 0 12px;
  }
  .chip {
    height: 40px;
    padding: 0 14px;
  }
  .avail {
    order: 2;
    margin-left: auto;
    border-left: 0;
  }
  .via {
    flex: 1;
  }
  .skeleton {
    grid-template-columns: 1fr 1fr 1fr;
    height: 140px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
