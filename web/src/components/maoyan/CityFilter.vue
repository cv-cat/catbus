<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, MapPin } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import CityPanel from './CityPanel.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { rememberCity } from '@/data/cities'

/**
 * 猫眼演出的城市 chip（AGENTS.md 7.9「猫眼演出的城市」，设计稿 W1–W4）：定位图标、城市名、箭头，始终是中性的玻璃样式。
 * 桌面和平板上点开是传送到 body 的玻璃面板（筛选栏是横向滚动容器，放在里面会被裁掉），手机上是底部弹层。
 */
const props = defineProps<{ city: string }>()
const emit = defineEmits<{ pick: [name: string] }>()
const { t } = useI18n()
const bp = useBreakpoint()

const PANEL_W = 364
const GAP = 8
const EDGE = 8

const chip = ref<HTMLButtonElement>()
const panel = ref<HTMLElement>()
const open = ref(false)
const pos = ref({ top: 0, left: 0 })
const panelId = `catbus-city-${Math.random().toString(36).slice(2, 8)}`

function place() {
  const r = chip.value?.getBoundingClientRect()
  if (!r) return
  pos.value = { top: r.bottom + GAP, left: Math.max(EDGE, Math.min(r.left, innerWidth - PANEL_W - EDGE)) }
}

function show() {
  place()
  open.value = true
}
function close(returnFocus = false) {
  if (!open.value) return
  open.value = false
  if (returnFocus) void nextTick(() => chip.value?.focus())
}
const toggle = () => (open.value ? close() : show())

function pick(name: string) {
  rememberCity(name)
  close(true)
  if (name !== props.city) emit('pick', name)
}

/** 桌面面板：点外面、页面滚动、窗口缩放时收起（面板是 fixed 定位，跟不上滚动） */
function onOutside(e: PointerEvent) {
  const el = e.target as Node
  if (chip.value?.contains(el) || panel.value?.contains(el)) return
  close()
}
function onScroll(e: Event) {
  if (panel.value?.contains(e.target as Node)) return
  close()
}
const onResize = () => close()
function listen(on: boolean) {
  const fn = on ? addEventListener : removeEventListener
  fn('pointerdown', onOutside as EventListener, true)
  fn('scroll', onScroll, true)
  fn('resize', onResize)
}
watch(
  () => open.value && !bp.phone,
  (v) => listen(v),
)
onBeforeUnmount(() => listen(false))

function enter(el: Element, done: () => void) {
  if (prefersReducedMotion()) return void gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, onComplete: done })
  gsap.fromTo(
    el,
    { opacity: 0, y: -4, scale: 0.98, transformOrigin: 'top left' },
    { opacity: 1, y: 0, scale: 1, duration: 0.2, ease: 'expo.out', onComplete: done },
  )
}
function leave(el: Element, done: () => void) {
  gsap.to(el, { opacity: 0, duration: prefersReducedMotion() ? 0.08 : 0.12, ease: 'power2.in', onComplete: done })
}
</script>

<template>
  <button
    ref="chip"
    type="button"
    class="city-chip glass"
    :class="{ open }"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="open ? panelId : undefined"
    :aria-label="t('maoyan.city.chip', { city })"
    @click="toggle"
    @keydown.down.prevent="show"
  >
    <MapPin :size="15" class="pin" aria-hidden="true" />
    <span class="name">{{ city }}</span>
    <component :is="open ? ChevronUp : ChevronDown" :size="14" class="chev" aria-hidden="true" />
  </button>

  <Teleport v-if="!bp.phone" to="body">
    <Transition :css="false" @enter="enter" @leave="leave">
      <div
        v-if="open"
        :id="panelId"
        ref="panel"
        class="city-pop"
        role="dialog"
        :aria-label="t('maoyan.city.title')"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${PANEL_W}px` }"
      >
        <CityPanel :current="city" @pick="pick" @close="close(true)" />
      </div>
    </Transition>
  </Teleport>

  <BottomSheet v-else :open="open" :label="t('maoyan.city.title')" @close="close(true)">
    <div v-if="open" :id="panelId" class="city-sheet">
      <h2 class="sheet-title">{{ t('maoyan.city.title') }}<small>{{ t('maoyan.city.current', { city }) }}</small></h2>
      <CityPanel :current="city" sheet @pick="pick" />
    </div>
  </BottomSheet>
</template>

<style scoped>
.city-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 160px;
  padding: 7px 10px 7px 12px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--ink);
  border: 1px solid var(--glass-stroke);
  transition: border-color 0.25s, transform 0.2s var(--ease-out);
}
.city-chip .pin {
  flex: none;
  color: var(--red);
}
.city-chip .name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.city-chip .chev {
  flex: none;
  color: var(--ink-3);
}
.city-chip:hover {
  transform: translateY(-1px);
}
/* 城市没有「不限」，不像时间筛选那样变红；展开时描红边 */
.city-chip.open {
  border-color: #e8414f80;
}
.city-pop {
  position: fixed;
  z-index: 60;
  padding: 16px;
  border-radius: 18px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 16px 40px #1b1f2e1f;
}
[data-theme='dark'] .city-pop {
  box-shadow: 0 16px 40px #0b0e1a66;
}
.city-sheet {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 6px 16px calc(16px + var(--safe-bottom));
}
.sheet-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.sheet-title small {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-3);
}
@media (hover: none) {
  .city-chip:hover {
    transform: none;
  }
}
@media (pointer: coarse) {
  .city-chip {
    min-height: 40px;
  }
}
/* 手机：chip 高 44（设计稿 W3） */
@media (max-width: 640px) {
  .city-chip {
    height: 44px;
    padding: 0 12px 0 14px;
    border-radius: 22px;
    font-size: 14px;
  }
}
</style>
