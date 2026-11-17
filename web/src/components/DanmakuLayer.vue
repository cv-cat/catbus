<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DanmakuItem, DanmakuKind } from '@/composables/danmakuOverlay'

/**
 * 叠在视频上的弹幕（AGENTS.md 7.9「详情卡片」的「媒体」）。位置按视频的当前时间逐帧算，
 * 暂停、拖动、倍速都跟着画面；只在播放时逐帧更新。元素是命令式建的，用完放回池子里复用。
 */
const props = defineProps<{ video?: HTMLVideoElement; items: readonly DanmakuItem[] }>()
const root = ref<HTMLDivElement>()

/** 滚动弹幕从右边进来到完全出去的时长、顶部 / 底部弹幕停留的时长（秒） */
const SCROLL = 8
const FIXED = 4
/** 同一行前后两条之间至少留的空隙（px） */
const GAP = 24
/** 屏上最多同时有多少条 */
const MAX_LIVE = 220

interface Live {
  el: HTMLSpanElement
  kind: DanmakuKind
  start: number
  w: number
  /** 滚动速度（px / 秒） */
  v: number
  lane: number
}

let W = 0
let H = 0
let font = 22
let lineH = 29
let scrollLanes: (Live | null)[] = []
let topLanes: (Live | null)[] = []
let bottomLanes: (Live | null)[] = []
let live: Live[] = []
let next = 0
let lastT = -1
let raf = 0
/**
 * 这么久以前的弹幕不再出（秒）。拖动、弹幕列表晚到时放宽到一整趟滚动的时长：
 * 位置按弹幕自己的时间算，所以这时该在屏上走到一半的弹幕会出现在半路上。
 */
let late = 1
const pool: HTMLSpanElement[] = []
const measure = document.createElement('canvas').getContext('2d')

function layout() {
  const r = root.value
  if (!r) return
  W = r.clientWidth
  H = r.clientHeight
  font = Math.min(30, Math.max(14, Math.round(H / 24)))
  lineH = Math.round(font * 1.3)
  // 滚动弹幕占上方四分之三；顶部、底部各最多占一半
  const resize = (lanes: (Live | null)[], n: number) => Array.from({ length: Math.max(1, n) }, (_, i) => lanes[i] ?? null)
  scrollLanes = resize(scrollLanes, Math.floor((H * 0.75) / lineH))
  topLanes = resize(topLanes, Math.floor((H * 0.5) / lineH))
  bottomLanes = resize(bottomLanes, Math.floor((H * 0.5) / lineH))
}

const sizeOf = (d: DanmakuItem) => Math.round(font * Math.min(1.4, Math.max(0.7, d.size / 25)))
const bottomMargin = () => Math.max(lineH, Math.round(H * 0.1))

function release(l: Live) {
  l.el.remove()
  if (pool.length < 64) pool.push(l.el)
}
function clear() {
  for (const l of live) release(l)
  live = []
  scrollLanes.fill(null)
  topLanes.fill(null)
  bottomLanes.fill(null)
}
/** 第一条时间不早于 t 的弹幕 */
function lowerBound(t: number): number {
  let lo = 0
  let hi = props.items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (props.items[mid]!.t < t) lo = mid + 1
    else hi = mid
  }
  return lo
}
function reset(t: number) {
  clear()
  next = lowerBound(Math.max(0, t - SCROLL))
  late = SCROLL
  lastT = t
}

/** 这一行能不能接一条宽 w 的新弹幕：前一条的尾巴已经进来、而且新的追不上它 */
function scrollFree(occ: Live | null, t: number, v: number): boolean {
  if (!occ) return true
  const tail = W - (t - occ.start) * occ.v + occ.w
  if (tail > W - GAP) return false
  return (occ.start + SCROLL - t) * v <= W
}

function emit(d: DanmakuItem, t: number) {
  if (live.length >= MAX_LIVE) return
  const px = sizeOf(d)
  if (measure) measure.font = `600 ${px}px system-ui, sans-serif`
  const w = Math.ceil(measure ? measure.measureText(d.text).width : d.text.length * px) + 4
  let lane = -1
  let v = 0
  if (d.kind === 'scroll') {
    v = (W + w) / SCROLL
    lane = scrollLanes.findIndex((occ) => scrollFree(occ, t, v))
  } else {
    const lanes = d.kind === 'top' ? topLanes : bottomLanes
    lane = lanes.findIndex((occ) => !occ || t - occ.start >= FIXED)
  }
  // 排不下就丢掉
  // 顶部、底部弹幕只停 FIXED 秒：已经过了的不出
  if (lane < 0 || (d.kind !== 'scroll' && t - d.t >= FIXED)) return
  const el = pool.pop() ?? document.createElement('span')
  el.className = 'dm-item'
  el.textContent = d.text
  el.style.color = d.color
  el.style.fontSize = `${px}px`
  const l: Live = { el, kind: d.kind, start: d.t, w, v, lane }
  if (d.kind === 'scroll') scrollLanes[lane] = l
  else (d.kind === 'top' ? topLanes : bottomLanes)[lane] = l
  live.push(l)
  root.value!.appendChild(el)
}

function place(l: Live, t: number): boolean {
  if (l.kind === 'scroll') {
    const x = W - (t - l.start) * l.v
    if (x + l.w < 0) return false
    l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${l.lane * lineH}px, 0)`
    return true
  }
  if (t - l.start >= FIXED || t < l.start) return false
  const y = l.kind === 'top' ? l.lane * lineH : H - bottomMargin() - (l.lane + 1) * lineH
  l.el.style.transform = `translate3d(${((W - l.w) / 2).toFixed(1)}px, ${y}px, 0)`
  return true
}

function render() {
  const v = props.video
  if (!v || !root.value) return
  const t = v.currentTime
  // 往回跳，或者跳得太远（标签页在后台时 rAF 停着）：当作拖动
  if (t < lastT - 0.05 || t - lastT > 1.5) reset(t)
  lastT = t
  while (next < props.items.length && props.items[next]!.t <= t) {
    const d = props.items[next++]!
    // 来不及在它的时间点出现的就不出了，免得一下子涌出一片
    if (t - d.t <= late) emit(d, t)
  }
  late = 1
  live = live.filter((l) => {
    if (place(l, t)) return true
    release(l)
    if (l.kind === 'scroll') {
      if (scrollLanes[l.lane] === l) scrollLanes[l.lane] = null
    } else {
      const lanes = l.kind === 'top' ? topLanes : bottomLanes
      if (lanes[l.lane] === l) lanes[l.lane] = null
    }
    return false
  })
}

function loop() {
  render()
  raf = requestAnimationFrame(loop)
}
function play() {
  if (!raf) raf = requestAnimationFrame(loop)
}
function stop() {
  cancelAnimationFrame(raf)
  raf = 0
}
function onSeeking() {
  if (props.video) reset(props.video.currentTime)
}
function onSeeked() {
  render()
}

let ro: ResizeObserver | null = null
let bound: HTMLVideoElement | null = null
function bind(v: HTMLVideoElement | undefined) {
  if (bound) {
    bound.removeEventListener('play', play)
    bound.removeEventListener('pause', stop)
    bound.removeEventListener('seeking', onSeeking)
    bound.removeEventListener('seeked', onSeeked)
  }
  stop()
  bound = v ?? null
  if (!v) return
  v.addEventListener('play', play)
  v.addEventListener('pause', stop)
  v.addEventListener('seeking', onSeeking)
  v.addEventListener('seeked', onSeeked)
  reset(v.currentTime)
  if (!v.paused) play()
}

onMounted(() => {
  layout()
  ro = new ResizeObserver(() => {
    layout()
    render()
  })
  if (root.value) ro.observe(root.value)
  bind(props.video)
})
watch(
  () => props.video,
  (v) => bind(v),
)
// 弹幕列表换了（换条目、取到了）：从当前位置接着出
watch(
  () => props.items,
  () => {
    const v = props.video
    if (!v) return
    reset(v.currentTime)
    render()
  },
)
onBeforeUnmount(() => {
  bind(undefined)
  ro?.disconnect()
  clear()
})
</script>

<template>
  <div ref="root" class="dm" aria-hidden="true" />
</template>

<style scoped>
.dm {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
}
.dm :deep(.dm-item) {
  position: absolute;
  top: 0;
  left: 0;
  white-space: pre;
  font-family: system-ui, sans-serif;
  font-weight: 600;
  line-height: 1.3;
  opacity: 0.92;
  text-shadow:
    1px 0 1px #000,
    -1px 0 1px #000,
    0 1px 1px #000,
    0 -1px 1px #000;
  will-change: transform;
}
</style>
