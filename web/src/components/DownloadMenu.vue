<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BottomSheet from '@/components/BottomSheet.vue'
import DownloadOptions from '@/components/DownloadOptions.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { platformById } from '@/data/platforms'
import { useSettingsStore } from '@/stores/settings'
import { QBIT_PLATFORMS } from '@/api/download'

/**
 * 下载按钮旁的下拉面板（AGENTS.md 7.9「批量选择与下载」）：桌面、平板上是传送到 body 的玻璃面板，
 * 按 anchor 的位置定位（下方放不下时向上弹出）；手机上是底部弹层。
 * platforms：这次要下载的条目所属的平台，都没有评论时评论置灰。
 */
const props = defineProps<{ open: boolean; anchor: HTMLElement | null; platforms: string[]; count?: number }>()
const emit = defineEmits<{ close: []; download: [] }>()
const { t } = useI18n()
const bp = useBreakpoint()
const settings = useSettingsStore()

const W = 300
const GAP = 8
const EDGE = 8
const panel = ref<HTMLElement>()
const pos = ref({ top: 0, left: 0 })

const commentsDisabled = computed(() => {
  if (!props.platforms.length || props.platforms.some((p) => commentsSupported(p))) return null
  const names = props.platforms.map((p) => platformById(p)?.name ?? p).join(t('download.panel.listSep'))
  return t('download.panel.commentsUnsupported', { platform: names })
})

/** 这次有 M-Team 的条目：面板里多一节「推送到 qBittorrent」 */
const qbit = computed(() => props.platforms.some((p) => QBIT_PLATFORMS.includes(p)))

function place() {
  const r = props.anchor?.getBoundingClientRect()
  if (!r) return
  const h = panel.value?.offsetHeight ?? 420
  const left = Math.max(EDGE, Math.min(r.right - W, innerWidth - W - EDGE))
  let top = r.bottom + GAP
  if (top + h > innerHeight - EDGE && r.top - GAP - h >= EDGE) top = r.top - GAP - h
  pos.value = { top: Math.max(EDGE, top), left }
}

function close(returnFocus = false) {
  emit('close')
  if (returnFocus) props.anchor?.focus()
}

function onOutside(e: PointerEvent) {
  const target = e.target as Node
  if (props.anchor?.contains(target) || panel.value?.contains(target)) return
  close()
}
function onScroll(e: Event) {
  if (panel.value?.contains(e.target as Node)) return
  close()
}
const onResize = () => close()
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  close(true)
}

const popover = computed(() => props.open && !bp.phone)
watch(popover, async (v) => {
  const fn = v ? addEventListener : removeEventListener
  fn('pointerdown', onOutside as EventListener, true)
  fn('scroll', onScroll, true)
  fn('resize', onResize)
  if (!v) return
  place()
  await nextTick()
  place()
  panel.value?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  removeEventListener('pointerdown', onOutside as EventListener, true)
  removeEventListener('scroll', onScroll, true)
  removeEventListener('resize', onResize)
})

function download() {
  emit('close')
  emit('download')
}
function toSettings() {
  emit('close')
  settings.show('download')
}

function enter(el: Element, done: () => void) {
  if (prefersReducedMotion()) return void gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, onComplete: done })
  gsap.fromTo(el, { opacity: 0, y: -4, scale: 0.98, transformOrigin: 'top right' }, { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'expo.out', onComplete: done })
}
function leave(el: Element, done: () => void) {
  gsap.to(el, { opacity: 0, duration: prefersReducedMotion() ? 0.08 : 0.12, ease: 'power2.in', onComplete: done })
}
</script>

<template>
  <BottomSheet v-if="bp.phone" :open="open" :label="t('download.panel.title')" :z="70" @close="emit('close')">
    <div class="sheet">
      <h2 class="title">{{ t('download.panel.title') }}</h2>
      <DownloadOptions :comments-disabled="commentsDisabled" :count="count" :qbit="qbit" @download="download" @settings="toSettings" />
    </div>
  </BottomSheet>
  <Teleport v-else to="body">
    <Transition :css="false" @enter="enter" @leave="leave">
      <div
        v-if="open"
        ref="panel"
        class="dl-menu"
        role="dialog"
        :aria-label="t('download.panel.title')"
        data-esc-layer
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${W}px` }"
        @keydown="onKey"
      >
        <DownloadOptions :comments-disabled="commentsDisabled" :count="count" :qbit="qbit" @download="download" @settings="toSettings" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dl-menu {
  position: fixed;
  z-index: 70;
  padding: 12px;
  border-radius: 18px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 16px 40px #1b1f2e1a;
  outline: none;
  /* 多了推送一节后可能放不下：面板内部滚动 */
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
[data-theme='dark'] .dl-menu {
  box-shadow: 0 16px 40px #0b0e1a66;
}
.sheet {
  padding: 4px 20px 20px;
}
.title {
  margin: 0 0 12px;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}
</style>
