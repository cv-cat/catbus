<script lang="ts">
/**
 * 共享的弹层外壳（AGENTS.md 7.9「响应式」）：
 * - 手机（≤ 640px）：底部弹层。上方圆角、顶部拖动把手，下滑或点遮罩关闭；最高约 90dvh，内容区单独滚动，
 *   让开 --safe-bottom；软键盘弹出时按 visualViewport 抬起弹层，聚焦的输入框滚到中间。
 * - 平板 / 桌面：desktop="dialog"（默认）时是居中弹窗；desktop="inline" 时什么都不包，原样渲染默认插槽
 *   （调用方自己负责桌面上的弹出层，例如账号切换的气泡）。
 * 两种形态都会：锁住背后的滚动、打开时焦点进弹层（Tab 在弹层内循环）、Esc 关闭、关闭后焦点回到打开前的元素。
 *
 * 用法：
 *   <BottomSheet :open="x.open" label="登录小红书" width="420px" @close="x.open = false">
 *     <div class="my-content">…</div>   ← 自己的内边距、间距；外壳只负责背景、圆角、滚动
 *   </BottomSheet>
 *
 * Props：open、label / labelledby（无障碍名称，二选一）、width（居中弹窗的最大宽度，默认 420px）、
 *   z（层级，默认 50）、desktop（'dialog' | 'inline'）、closeOnEsc（默认 true；调用方自己处理 Esc 时传 false）、
 *   role（默认 dialog）。
 * 事件：close（遮罩、下滑、Esc 触发；由调用方把 open 置为 false）。
 * 插槽：default。插槽属性 { sheet }：当前是否底部弹层形态。
 */

/** 打开中的弹层（栈顶才响应 Esc） */
const stack: symbol[] = []
let locks = 0

function lockScroll() {
  if (locks++ === 0) document.documentElement.classList.add('bs-locked')
}
function unlockScroll() {
  if (locks > 0 && --locks === 0) document.documentElement.classList.remove('bs-locked')
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { prefersReducedMotion } from '@/composables/motion'

const props = withDefaults(
  defineProps<{
    open: boolean
    label?: string
    labelledby?: string
    width?: string
    z?: number
    desktop?: 'dialog' | 'inline'
    closeOnEsc?: boolean
    role?: 'dialog' | 'alertdialog'
  }>(),
  { width: '420px', z: 50, desktop: 'dialog', closeOnEsc: true, role: 'dialog' },
)
const emit = defineEmits<{ close: [] }>()

const bp = useBreakpoint()
const sheet = computed(() => bp.phone)
/** inline 且不是手机：外壳不参与 */
const passthrough = computed(() => props.desktop === 'inline' && !sheet.value)
const active = computed(() => props.open && !passthrough.value)

const panel = ref<HTMLElement>()
const body = ref<HTMLElement>()
const id = Symbol('sheet')
let opener: HTMLElement | null = null

// ---------- 软键盘：visualViewport ----------
const kb = ref(0)
const vh = ref(0)
function onViewport() {
  const v = window.visualViewport
  if (!v) return
  kb.value = Math.max(0, Math.round(innerHeight - v.height - v.offsetTop))
  vh.value = Math.round(v.height)
}
const layerStyle = computed(() => ({
  '--bs-z': String(props.z),
  '--bs-w': props.width,
  '--bs-kb': `${kb.value}px`,
  '--bs-vh': vh.value ? `${vh.value}px` : '100dvh',
}))

function onFocusIn(e: FocusEvent) {
  if (!sheet.value) return
  const t = e.target as HTMLElement
  if (!t.matches('input, textarea, select, [contenteditable]')) return
  // 等键盘弹出、visualViewport 变化之后再滚
  setTimeout(() => t.isConnected && t.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' }), 320)
}

// ---------- Esc 与焦点 ----------
function onKey(e: KeyboardEvent) {
  if (stack[stack.length - 1] !== id) return
  if (e.key === 'Escape' && props.closeOnEsc) {
    // 弹层里有展开的浮层菜单（AppSelect 等，带 data-esc-layer）：这次 Esc 归它，只收菜单
    if (document.querySelector('[data-esc-layer]')) return
    // 捕获阶段拦下：只关最上面这一层，不连带关掉下面的详情卡片等
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'Tab' && panel.value) {
    const els = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!els.length) return void (e.preventDefault(), panel.value.focus())
    const first = els[0]!
    const last = els[els.length - 1]!
    const cur = document.activeElement
    if (e.shiftKey && (cur === first || cur === panel.value)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault()
      first.focus()
    } else if (!panel.value.contains(cur)) {
      e.preventDefault()
      first.focus()
    }
  }
}

function activate() {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  stack.push(id)
  lockScroll()
  window.addEventListener('keydown', onKey, true)
  window.visualViewport?.addEventListener('resize', onViewport)
  window.visualViewport?.addEventListener('scroll', onViewport)
  onViewport()
  dragY.value = 0
  // 焦点进弹层：落在弹层本身，不自动聚焦输入框（手机上会直接弹出键盘）
  void nextTick(() => panel.value?.focus({ preventScroll: true }))
}
function deactivate() {
  const i = stack.indexOf(id)
  if (i < 0) return
  stack.splice(i, 1)
  unlockScroll()
  window.removeEventListener('keydown', onKey, true)
  window.visualViewport?.removeEventListener('resize', onViewport)
  window.visualViewport?.removeEventListener('scroll', onViewport)
  kb.value = 0
  const back = opener
  opener = null
  // 焦点回到打开前的元素：只在焦点还留在本弹层里（或已经掉到 body）时，
  // 不抢紧接着打开的另一个弹层（例如账号列表 → 重新登录）的焦点
  if (back?.isConnected) requestAnimationFrame(() => {
    const a = document.activeElement
    if (!a || a === document.body || panel.value?.contains(a)) back.focus({ preventScroll: true })
  })
}

watch(active, (v) => (v ? activate() : deactivate()), { immediate: true })
onBeforeUnmount(deactivate)

// ---------- 下滑关闭（只在底部弹层形态） ----------
const dragY = ref(0)
const dragging = ref(false)
let startY = 0
let startX = 0
let startT = 0
let tracking = false
let decided = false

function onTouchStart(e: TouchEvent) {
  if (!sheet.value || e.touches.length !== 1) return
  const t = e.target as HTMLElement
  const onHandle = Boolean(t.closest('.bs-grab'))
  // 内容区没滚到顶时交给内容区自己滚动
  if (!onHandle && (body.value?.scrollTop ?? 0) > 0) return
  if (!onHandle && t.closest('input, textarea, select')) return
  tracking = true
  decided = onHandle
  startY = e.touches[0]!.clientY
  startX = e.touches[0]!.clientX
  startT = performance.now()
}
function onTouchMove(e: TouchEvent) {
  if (!tracking) return
  const dy = e.touches[0]!.clientY - startY
  const dx = e.touches[0]!.clientX - startX
  if (!decided) {
    if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return
    // 向上或横向：不是下滑关闭
    if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
      tracking = false
      return
    }
    decided = true
  }
  dragging.value = true
  dragY.value = Math.max(0, dy)
  if (e.cancelable) e.preventDefault()
}
function onTouchEnd() {
  if (!tracking) return
  tracking = false
  if (!dragging.value) return
  dragging.value = false
  const h = panel.value?.offsetHeight ?? 400
  const v = dragY.value / Math.max(1, performance.now() - startT)
  if (dragY.value > Math.min(140, h * 0.3) || (v > 0.6 && dragY.value > 30)) {
    dragY.value = h
    emit('close')
  } else dragY.value = 0
}

const panelStyle = computed(() =>
  sheet.value && (dragY.value || dragging.value)
    ? { transform: `translateY(${dragY.value}px)`, transition: dragging.value ? 'none' : undefined }
    : undefined,
)
</script>

<template>
  <slot v-if="passthrough" :sheet="false" />
  <Teleport v-else to="body">
    <Transition name="bs" :duration="{ enter: 500, leave: 240 }">
      <div v-if="open" class="bs-layer" :class="{ sheet }" :style="layerStyle">
        <div class="bs-backdrop" @click="emit('close')" />
        <section
          ref="panel"
          class="bs-panel"
          :role="role"
          aria-modal="true"
          :aria-label="labelledby ? undefined : label"
          :aria-labelledby="labelledby"
          tabindex="-1"
          :style="panelStyle"
          @focusin="onFocusIn"
          @touchstart.passive="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchEnd"
        >
          <div v-if="sheet" class="bs-grab" aria-hidden="true"><span /></div>
          <div ref="body" class="bs-body">
            <slot :sheet="sheet" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bs-layer {
  position: fixed;
  inset: 0;
  z-index: var(--bs-z);
  display: grid;
  place-items: center;
  padding: 16px;
}
.bs-backdrop {
  position: absolute;
  inset: 0;
  background: #0b0d1a55;
  backdrop-filter: blur(6px);
  touch-action: none;
}
.bs-panel {
  position: relative;
  width: min(var(--bs-w), 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-xl);
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: 0 30px 80px #0b0d1a40;
  backdrop-filter: blur(40px) saturate(1.6);
  outline: none;
  overflow: hidden;
}
.bs-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* ---------- 手机：底部弹层 ---------- */
.bs-layer.sheet {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0;
}
.sheet .bs-panel {
  width: 100%;
  /* 键盘弹出时 --bs-vh 是可见区域的高度，--bs-kb 是键盘高度 */
  max-height: min(90dvh, calc(var(--bs-vh) - 12px - var(--safe-top)));
  margin-bottom: var(--bs-kb);
  border-radius: 24px 24px 0 0;
  border-bottom: none;
  box-shadow: 0 -12px 40px #0b0d1a33;
  transition: transform 0.24s var(--ease-out), margin-bottom 0.2s var(--ease-out);
}
.sheet .bs-body {
  padding-bottom: var(--safe-bottom);
  padding-left: var(--safe-left);
  padding-right: var(--safe-right);
}
.bs-grab {
  flex: none;
  display: grid;
  place-items: center;
  height: 22px;
  touch-action: none;
  cursor: grab;
}
.bs-grab span {
  width: 38px;
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}

/* ---------- 进出场 ---------- */
.bs-enter-active,
.bs-leave-active {
  transition: opacity 0.25s ease-out;
}
.bs-leave-active {
  transition-duration: 0.2s;
}
.bs-enter-active .bs-panel {
  transition: transform 0.5s var(--ease-out), opacity 0.3s ease-out;
}
.bs-leave-active .bs-panel {
  transition: transform 0.22s ease-in, opacity 0.2s ease-in;
}
.bs-enter-from,
.bs-leave-to {
  opacity: 0;
}
.bs-enter-from .bs-panel,
.bs-leave-to .bs-panel {
  transform: translateY(24px) scale(0.96);
}
.bs-enter-active.sheet .bs-panel {
  transition: transform 0.42s var(--ease-out);
}
.bs-enter-from.sheet .bs-panel {
  transform: translateY(100%);
}
.bs-leave-to.sheet .bs-panel:not([style]) {
  transform: translateY(100%);
}
@media (prefers-reduced-motion: reduce) {
  .bs-enter-active,
  .bs-leave-active {
    transition-duration: 0.18s;
  }
  .bs-enter-active .bs-panel,
  .bs-leave-active .bs-panel,
  .sheet .bs-panel {
    transition: opacity 0.18s;
  }
  .bs-enter-from .bs-panel,
  .bs-leave-to .bs-panel,
  .bs-enter-from.sheet .bs-panel,
  .bs-leave-to.sheet .bs-panel {
    transform: none;
  }
}

/* 打开时锁住页面滚动（发现页的滚动容器是 .discover） */
:global(html.bs-locked),
:global(html.bs-locked body),
:global(html.bs-locked .discover) {
  overflow: hidden !important;
}
</style>
