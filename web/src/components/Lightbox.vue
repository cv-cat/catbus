<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { closeLightbox, useLightboxStore } from '@/stores/lightbox'
import { imgSrc } from '@/api/client'

/**
 * 看大图：Esc / 点空白关闭，← / → 切换。键盘事件在捕获阶段拦下，不让底下的详情卡片也响应。
 * 触屏（AGENTS.md 7.9「响应式」）：左右滑动切换、双指缩放和拖动查看（放大时不切换）、双击放大 / 还原、下滑关闭。
 */
const lb = useLightboxStore()

function go(step: number) {
  const n = lb.images.length
  if (n > 1) lb.index = (lb.index + step + n) % n
}

function onKey(e: KeyboardEvent) {
  if (!lb.open) return
  if (e.key === 'Escape') closeLightbox()
  else if (e.key === 'ArrowLeft') go(-1)
  else if (e.key === 'ArrowRight') go(1)
  else return
  e.preventDefault()
  e.stopImmediatePropagation()
}
onMounted(() => addEventListener('keydown', onKey, true))
onBeforeUnmount(() => removeEventListener('keydown', onKey, true))

// ---------- 触屏手势 ----------
const MAX_SCALE = 5
const ZOOM = 2.5
const view = reactive({ scale: 1, tx: 0, ty: 0, swipeX: 0, dragY: 0 })
/** 手指按着时不加过渡，松手后再平滑回位 */
const gesturing = ref(false)
const big = ref<HTMLImageElement>()

function resetView() {
  Object.assign(view, { scale: 1, tx: 0, ty: 0, swipeX: 0, dragY: 0 })
}
watch(() => [lb.open, lb.index], resetView)

const imgStyle = computed(() => ({
  transform: `translate3d(${view.tx + view.swipeX}px, ${view.ty + view.dragY}px, 0) scale(${view.scale})`,
  transition: gesturing.value ? 'none' : undefined,
}))
const bgStyle = computed(() => (view.dragY ? { backgroundColor: `rgb(11 13 20 / ${Math.max(0.15, 0.9 * (1 - view.dragY / 480))})` } : undefined))

type Pt = { x: number; y: number }
const pts = new Map<number, Pt>()
let mode: 'none' | 'pending' | 'pan' | 'pinch' | 'swipe' | 'dismiss' = 'none'
let start = { x: 0, y: 0, t: 0, tx: 0, ty: 0, moved: false }
let pinch = { d: 1, s: 1, cx: 0, cy: 0 }
let lastTap = { t: 0, x: 0, y: 0 }
let lastType = 'mouse'

const center = () => ({ x: innerWidth / 2, y: innerHeight / 2 })
const two = () => [...pts.values()] as [Pt, Pt]
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) || 1

/** 放大后平移不超过图片边缘 */
function clampPan() {
  const el = big.value
  if (!el || view.scale <= 1) {
    view.tx = view.ty = 0
    return
  }
  const mx = Math.max(0, (el.offsetWidth * view.scale - innerWidth) / 2)
  const my = Math.max(0, (el.offsetHeight * view.scale - innerHeight) / 2)
  view.tx = Math.min(mx, Math.max(-mx, view.tx))
  view.ty = Math.min(my, Math.max(-my, view.ty))
}

/** 以屏幕上的点 (px, py) 为中心缩放到 s */
function zoomAt(s: number, px: number, py: number, from = { s: view.scale, tx: view.tx, ty: view.ty }) {
  const c = center()
  const cx = (px - c.x - from.tx) / from.s
  const cy = (py - c.y - from.ty) / from.s
  view.scale = s
  view.tx = px - c.x - cx * s
  view.ty = py - c.y - cy * s
}

function beginSingle(p: Pt, t: number) {
  start = { x: p.x, y: p.y, t, tx: view.tx, ty: view.ty, moved: false }
  mode = view.scale > 1 ? 'pan' : 'pending'
}

function onDown(e: PointerEvent) {
  lastType = e.pointerType
  if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  gesturing.value = true
  if (pts.size === 2) {
    const [a, b] = two()
    pinch = { d: dist(a, b), s: view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
    start = { ...start, tx: view.tx, ty: view.ty, moved: true }
    view.swipeX = view.dragY = 0
    mode = 'pinch'
  } else if (pts.size === 1) beginSingle({ x: e.clientX, y: e.clientY }, e.timeStamp)
}

function onMove(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (mode === 'pinch' && pts.size >= 2) {
    const [a, b] = two()
    const s = Math.min(MAX_SCALE, Math.max(0.8, (pinch.s * dist(a, b)) / pinch.d))
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    // 缩放中心跟着两指的中点走：同时完成缩放和拖动
    zoomAt(s, pinch.cx, pinch.cy, { s: pinch.s, tx: start.tx, ty: start.ty })
    view.tx += mx - pinch.cx
    view.ty += my - pinch.cy
    return
  }
  const dx = e.clientX - start.x
  const dy = e.clientY - start.y
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) start.moved = true
  if (mode === 'pan') {
    view.tx = start.tx + dx
    view.ty = start.ty + dy
  } else if (mode === 'pending') {
    if (!start.moved) return
    if (Math.abs(dx) > Math.abs(dy)) mode = lb.images.length > 1 ? 'swipe' : 'none'
    else mode = dy > 0 ? 'dismiss' : 'none'
  }
  if (mode === 'swipe') {
    const edge = (dx > 0 && lb.index === 0) || (dx < 0 && lb.index === lb.images.length - 1)
    view.swipeX = edge ? dx * 0.3 : dx
  } else if (mode === 'dismiss') {
    view.dragY = Math.max(0, dy)
  }
}

function onUp(e: PointerEvent) {
  if (!pts.has(e.pointerId)) return
  pts.delete(e.pointerId)
  const dt = e.timeStamp - start.t
  if (mode === 'pinch') {
    if (pts.size === 1) {
      // 抬起一指：剩下那只手指接着拖
      const [p] = [...pts.values()] as [Pt]
      if (view.scale < 1) resetView()
      beginSingle(p, e.timeStamp)
      start.moved = true
      return
    }
    if (view.scale <= 1.02) resetView()
    else clampPan()
  } else if (mode === 'swipe') {
    const dx = view.swipeX
    view.swipeX = 0
    if (Math.abs(dx) > innerWidth / 5 || (Math.abs(dx) > 30 && dt < 250)) {
      const next = lb.index + (dx < 0 ? 1 : -1)
      if (next >= 0 && next < lb.images.length) lb.index = next
    }
  } else if (mode === 'dismiss') {
    const dy = view.dragY
    if (dy > 120 || (dy > 40 && dt < 250)) {
      pts.clear()
      gesturing.value = false
      mode = 'none'
      return closeLightbox()
    }
    view.dragY = 0
  } else if (mode === 'pan') {
    clampPan()
  }
  if (!start.moved && dt < 300 && !pts.size) tap(e)
  if (!pts.size) {
    gesturing.value = false
    mode = 'none'
  }
}

/** 双击放大 / 还原；单击空白处关闭（单击图片不关，留给双击） */
function tap(e: PointerEvent) {
  const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30
  if (e.timeStamp - lastTap.t < 300 && near) {
    lastTap.t = 0
    gesturing.value = false
    if (view.scale > 1) resetView()
    else {
      zoomAt(ZOOM, e.clientX, e.clientY)
      clampPan()
    }
    return
  }
  lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY }
  if (!(e.target as HTMLElement).closest('.big') && view.scale <= 1) closeLightbox()
}

/** 鼠标点空白（或图片）关闭，与原来一致；触屏的点按由手势处理 */
function onClick(e: MouseEvent) {
  if (lastType !== 'mouse') return
  if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('big')) closeLightbox()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="lb">
      <div
        v-if="lb.open"
        class="lightbox"
        :style="bgStyle"
        role="dialog"
        aria-modal="true"
        aria-label="查看大图"
        @click="onClick"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <img
          :key="lb.images[lb.index]"
          ref="big"
          class="big"
          :class="{ zoomed: view.scale > 1 }"
          :style="imgStyle"
          :src="imgSrc(lb.images[lb.index])"
          alt=""
          referrerpolicy="no-referrer"
          draggable="false"
        />
        <button class="close" type="button" aria-label="关闭" title="关闭（Esc）" @click="closeLightbox"><X :size="20" /></button>
        <template v-if="lb.images.length > 1">
          <button class="nav prev" type="button" aria-label="上一张" @click="go(-1)"><ChevronLeft :size="22" /></button>
          <button class="nav next" type="button" aria-label="下一张" @click="go(1)"><ChevronRight :size="22" /></button>
          <span class="counter mono">{{ lb.index + 1 }} / {{ lb.images.length }}</span>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 48px 72px;
  background: #0b0d14e6;
  backdrop-filter: blur(6px);
}
/* 用视口单位限制尺寸：grid 项目的百分比高度相对的是被图片自身撑开的格子，限不住大图 */
.big {
  max-width: calc(100vw - 144px);
  max-height: calc(100vh - 96px);
  max-height: calc(100dvh - 96px);
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 60px #0008;
  animation: lb-pop 0.28s var(--ease-out);
  transition: transform 0.28s var(--ease-out);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
@keyframes lb-pop {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
.close,
.nav {
  position: absolute;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #ffffff1f;
  transition: background 0.2s;
}
.close:hover,
.nav:hover {
  background: #ffffff38;
}
.close {
  top: 18px;
  right: 18px;
  width: 40px;
  height: 40px;
}
.nav {
  top: 50%;
  width: 44px;
  height: 44px;
  margin-top: -22px;
}
.prev {
  left: 16px;
}
.next {
  right: 16px;
}
.counter {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 12px;
  color: #fff;
  background: #ffffff1f;
}
.lb-enter-active,
.lb-leave-active {
  transition: opacity 0.2s;
}
.lb-enter-from,
.lb-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .big {
    animation: none;
    transition: none;
  }
}

/* 触屏：手势全由页面处理；箭头隐藏，用滑动切换 */
@media (hover: none) and (pointer: coarse) {
  .lightbox {
    touch-action: none;
  }
  .nav {
    display: none;
  }
  .close {
    width: var(--tap);
    height: var(--tap);
  }
}
/* 手机：大图铺满屏幕，按钮让开安全区 */
@media (max-width: 640px) {
  .lightbox {
    padding: 0;
  }
  .big {
    max-width: 100vw;
    max-height: 100vh;
    max-height: 100dvh;
    border-radius: 0;
    box-shadow: none;
  }
  .close {
    top: calc(var(--safe-top) + 10px);
    right: calc(var(--safe-right) + 10px);
    width: var(--tap);
    height: var(--tap);
    background: #ffffff26;
  }
  .counter {
    bottom: calc(var(--safe-bottom) + 18px);
  }
}
</style>
