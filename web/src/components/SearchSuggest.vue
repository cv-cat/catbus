<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CornerDownLeft, Flame, LoaderCircle, Search, Sparkles } from 'lucide-vue-next'
import type { Keyword } from '@/api/types'
import { platformById } from '@/data/platforms'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useDiscoverStore } from '@/stores/discover'
import { useSuggestStore } from '@/stores/suggest'

/**
 * 搜索框下方的联想 / 热搜面板（设计稿 Q / Q2，AGENTS.md 7.9「搜索联想与热搜」）。
 * 输入为空显示热搜，有输入显示联想；平台不支持、请求失败、结果为空时不出面板。
 * 键盘由 SearchBar 转给 onKey；面板本身不抢焦点（mousedown 阻止默认行为）。
 */
const props = defineProps<{
  /** 面板对齐的搜索框 */
  anchor: HTMLElement | undefined
  query: string
  /** 输入框聚焦中 */
  open: boolean
  /** 输入法组合输入中：不发请求 */
  composing: boolean
  inputId: string
}>()
const emit = defineEmits<{ pick: [text: string]; close: [] }>()

const d = useDiscoverStore()
const s = useSuggestStore()
const bp = useBreakpoint()

/** 聚合模式下 state.platform 就是最后点选的渠道 */
const platform = computed(() => d.state.platform)
const platformName = computed(() => platformById(platform.value)?.name ?? platform.value)
const prefix = computed(() => props.query.trim())
const mode = computed<'hot' | 'suggest'>(() => (prefix.value ? 'suggest' : 'hot'))
const supported = computed(() => s.support(platform.value)[mode.value])

const list = ref<Keyword[]>([])
/** list 对应的模式与前缀：切换模式时不把热搜当联想显示 */
const listFor = ref('')
const loading = ref(false)
const active = ref(-1)
/** 用户按了 Esc：再次输入或重新聚焦前不显示 */
const dismissed = ref(false)

const want = computed(() => `${platform.value}\n${mode.value}\n${prefix.value}`)
/** 联想结果没回来之前继续显示上一次的联想（同一平台），避免面板随输入闪烁 */
const shown = computed(() => {
  if (listFor.value === want.value) return list.value
  if (mode.value === 'suggest' && listFor.value.startsWith(`${platform.value}\nsuggest\n`)) return list.value
  return []
})
const visible = computed(
  () => props.open && !dismissed.value && supported.value && (shown.value.length > 0 || loading.value),
)

let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined

function apply(key: string, data: Keyword[] | null) {
  list.value = data ?? []
  listFor.value = key
  active.value = -1
  loading.value = false
}

watch(
  [() => props.open, want, () => props.composing, supported],
  () => {
    clearTimeout(timer)
    if (!props.open || !supported.value || props.composing) {
      if (!props.composing) loading.value = false
      return
    }
    const key = want.value
    const p = platform.value
    const q = prefix.value
    const id = ++seq
    if (mode.value === 'hot') {
      const hit = s.cachedHot(p)
      if (hit) return apply(key, hit)
      loading.value = true
      void s.hot(p).then((r) => id === seq && apply(key, r))
      return
    }
    const hit = s.cachedSuggest(p, q)
    if (hit) return apply(key, hit)
    // 防抖：输入停下 160ms 后才请求；只采用最后一次请求的结果（seq）
    timer = setTimeout(() => {
      if (id !== seq) return
      loading.value = true
      void s.suggest(p, q).then((r) => id === seq && apply(key, r))
    }, 160)
  },
  { immediate: true },
)

watch(
  () => props.query,
  () => (dismissed.value = false),
)
watch(
  () => props.open,
  (o) => {
    if (o) dismissed.value = false
    else active.value = -1
  },
)

/* ---------- 位置：传送到 body，按搜索框定位 ---------- */
const box = ref({ top: 0, left: 0, width: 0 })
function place() {
  const r = props.anchor?.getBoundingClientRect()
  if (!r) return
  if (bp.phone) box.value = { top: r.bottom + 8, left: 12, width: innerWidth - 24 }
  else box.value = { top: r.bottom + 8, left: r.left, width: r.width }
}
let raf = 0
const onMove = () => {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(place)
}
watch(
  visible,
  (v) => {
    if (v) {
      place()
      addEventListener('scroll', onMove, { capture: true, passive: true })
      addEventListener('resize', onMove, { passive: true })
    } else {
      removeEventListener('scroll', onMove, { capture: true })
      removeEventListener('resize', onMove)
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  cancelAnimationFrame(raf)
  removeEventListener('scroll', onMove, { capture: true })
  removeEventListener('resize', onMove)
})

/* ---------- 键盘与无障碍 ---------- */
const listboxId = computed(() => `${props.inputId}-suggest`)
const optionId = (i: number) => `${props.inputId}-suggest-${i}`
const activeId = computed(() => (visible.value && active.value >= 0 ? optionId(active.value) : undefined))

/** SearchBar 的 keydown 转过来；返回 true 表示已处理（调用方不再提交表单） */
function onKey(e: KeyboardEvent): boolean {
  if (!visible.value) return false
  const n = shown.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!n) return true
    const step = e.key === 'ArrowDown' ? 1 : -1
    active.value = active.value < 0 ? (step > 0 ? 0 : n - 1) : (active.value + step + n) % n
    return true
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    dismissed.value = true
    emit('close')
    return true
  }
  if (e.key === 'Enter' && active.value >= 0 && shown.value[active.value]) {
    e.preventDefault()
    pick(shown.value[active.value]!.text)
    return true
  }
  return false
}

function pick(text: string) {
  dismissed.value = true
  emit('pick', text)
}

/** 关闭面板（提交搜索后调用） */
function close() {
  dismissed.value = true
}

/* ---------- 显示 ---------- */
function heat(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return ''
  const f = (v: number) => v.toFixed(1).replace(/\.0$/, '')
  if (n >= 1e8) return `${f(n / 1e8)}亿`
  if (n >= 1e4) return `${f(n / 1e4)}万`
  return String(Math.round(n))
}
function split(text: string): [string, string] {
  const q = prefix.value
  if (q && text.toLowerCase().startsWith(q.toLowerCase())) return [text.slice(0, q.length), text.slice(q.length)]
  return ['', text]
}

/* ---------- 动效 ---------- */
const rows = ref<HTMLElement>()
function onEnter(el: Element, done: () => void) {
  if (prefersReducedMotion()) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, onComplete: done })
    return
  }
  gsap.fromTo(
    el,
    { opacity: 0, y: -4, scale: 0.98, transformOrigin: 'top center' },
    { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'expo.out', onComplete: done },
  )
}
function onLeave(el: Element, done: () => void) {
  gsap.to(el, { opacity: 0, duration: prefersReducedMotion() ? 0.08 : 0.12, ease: 'power2.in', onComplete: done })
}
// 联想结果替换：只淡入，不位移
watch(listFor, async () => {
  await nextTick()
  if (!rows.value || prefersReducedMotion()) return
  gsap.fromTo(rows.value, { opacity: 0.35 }, { opacity: 1, duration: 0.12, ease: 'power2.out' })
})

defineExpose({ onKey, close, visible, activeId, listboxId })
</script>

<template>
  <Teleport to="body">
    <Transition :css="false" @enter="onEnter" @leave="onLeave">
      <div
        v-if="visible"
        class="suggest"
        :class="{ phone: bp.phone }"
        :style="{ top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px` }"
        @mousedown.prevent
      >
        <div class="head">
          <Flame v-if="mode === 'hot'" :size="14" class="icon" aria-hidden="true" />
          <Sparkles v-else :size="14" class="icon" aria-hidden="true" />
          <span class="title">{{ mode === 'hot' ? '热搜' : '联想' }}</span>
          <span class="grow" />
          <LoaderCircle v-if="loading" :size="14" class="spin" aria-label="加载中" />
          <span v-else-if="mode === 'hot'" class="mono pname">{{ platformName }}</span>
        </div>

        <div v-if="!shown.length" class="rows" aria-hidden="true">
          <div v-for="w in [220, 160, 250]" :key="w" class="row skel">
            <i class="dot" /><i class="bar" :style="{ width: `${w}px` }" />
          </div>
        </div>
        <div
          v-else
          :id="listboxId"
          ref="rows"
          class="rows"
          role="listbox"
          :aria-label="mode === 'hot' ? `${platformName}热搜` : '搜索联想'"
        >
          <div
            v-for="(k, i) in shown"
            :id="optionId(i)"
            :key="`${i}:${k.text}`"
            class="row"
            :class="{ on: i === active }"
            role="option"
            :aria-selected="i === active"
            @mouseenter="active = i"
            @mouseleave="active = -1"
            @click="pick(k.text)"
          >
            <template v-if="mode === 'hot'">
              <span class="rank mono" :class="{ top: i < 3 }">{{ i + 1 }}</span>
              <span class="text">{{ k.text }}</span>
              <span v-if="heat(k.heat)" class="heat mono">{{ heat(k.heat) }}</span>
            </template>
            <template v-else>
              <Search :size="14" class="lead" aria-hidden="true" />
              <span class="text sugg"><b>{{ split(k.text)[0] }}</b>{{ split(k.text)[1] }}</span>
            </template>
            <CornerDownLeft v-if="i === active" :size="14" class="enter" aria-hidden="true" />
          </div>
        </div>

        <div v-if="!bp.phone" class="foot mono" aria-hidden="true">
          <span>↑↓ 选择</span><span>Enter 搜索</span><span>Esc 关闭</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.suggest {
  position: fixed;
  z-index: 50;
  padding: 8px;
  border-radius: 20px;
  border: 1px solid var(--glass-stroke);
  background: var(--glass-strong);
  backdrop-filter: blur(30px);
  box-shadow: 0 16px 40px #1b1f2e1a;
  color: var(--ink);
}
[data-theme='dark'] .suggest {
  box-shadow: 0 16px 40px #0b0e1a66;
}
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 6px;
}
.icon {
  color: var(--red);
  flex: none;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
}
.grow {
  flex: 1;
}
.pname {
  font-size: 11px;
  color: var(--ink-3);
}
.spin {
  color: var(--ink-3);
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s var(--ease-out);
}
.phone .row {
  height: 44px;
}
.row.on {
  background: var(--hair);
  font-weight: 500;
}
.rank {
  width: 18px;
  flex: none;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-3);
}
.rank.top {
  font-weight: 700;
  color: var(--red);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ink);
}
.sugg {
  font-weight: 400;
  color: var(--ink-2);
}
.sugg b {
  font-weight: 700;
  color: var(--ink);
}
.heat {
  flex: none;
  font-size: 11.5px;
  color: var(--ink-3);
}
.lead,
.enter {
  flex: none;
  color: var(--ink-3);
}
.row.skel {
  cursor: default;
}
.dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--hair);
  flex: none;
}
.bar {
  height: 10px;
  max-width: 70%;
  border-radius: 5px;
  background: var(--hair);
}
.foot {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  padding: 8px 12px 4px;
  border-top: 1px solid var(--hair);
  font-size: 11px;
  color: var(--ink-3);
}
@media (hover: none) and (pointer: coarse) {
  .foot {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 2.4s;
  }
}
</style>
