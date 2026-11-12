<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink, FastForward, Maximize, Pause, Play, RotateCw, Volume2, VolumeX } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import type { Item } from '@/api/types'
import { mediaSrc, imgSrc } from '@/api/client'
import { duration as fmt } from '@/composables/format'
import { useBreakpoint } from '@/composables/useBreakpoint'

/**
 * 详情卡片的媒体区（AGENTS.md 7.9）：视频自动播放、B 站 / YouTube 用官方嵌入播放器、图文轮播。
 * `active` 在打开动效结束后才为 true，之后再开始播放，避免和放大动画抢帧。
 */
const props = defineProps<{
  item: Item
  platform: string
  active: boolean
  loading: boolean
  /** 详情全屏（手机等）：顶部的浮层让开安全区和左上角的关闭按钮 */
  fullscreen?: boolean
}>()
const bp = useBreakpoint()

const videoUrl = computed(() => props.item.media.find((m) => m.type === 'video' && m.url)?.url ?? null)
const images = computed(() => {
  const list = props.item.media.filter((m) => m.type === 'image' && m.url).map((m) => m.url!)
  return list.length ? list : props.item.cover ? [props.item.cover] : []
})
/** 同一个视频文件：快手等平台每次请求都换一次签名参数（tag=…），路径不变 */
function sameFile(a: string, b: string): boolean {
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.origin + x.pathname === y.origin + y.pathname
  } catch {
    return a === b
  }
}
/**
 * 实际交给 <video> 的地址。item get 补全时同一个文件只是换了签名，不换 src，
 * 否则正在播的视频会被重新加载、停在封面上。
 */
const src = ref<string | null>(videoUrl.value)
watch(videoUrl, (u) => {
  if (u && src.value && sameFile(u, src.value)) return
  src.value = u
})
const isVideo = computed(() => props.item.kind === 'video' || props.item.media.some((m) => m.type === 'video'))

/** 官方嵌入播放器：B 站是音视频分离的 DASH，<video> 放不了 */
const embed = computed(() => {
  if (!isVideo.value) return null
  if (props.platform === 'bilibili' && /^BV[0-9A-Za-z]{10}$/.test(props.item.id)) {
    return `https://player.bilibili.com/player.html?bvid=${props.item.id}&autoplay=1&high_quality=1&danmaku=1}`
  }
  if (props.platform === 'youtube' && /^[\w-]{11}$/.test(props.item.id)) {
    return `https://www.youtube.com/embed/${props.item.id}?autoplay=1&rel=0&playsinline=1`
  }
  return null
})
const mode = computed<'embed' | 'video' | 'images' | 'pending' | 'unplayable'>(() => {
  if (embed.value) return 'embed'
  if (isVideo.value) return videoUrl.value ? 'video' : props.loading ? 'pending' : 'unplayable'
  return 'images'
})

// ---------- 视频 ----------
const video = ref<HTMLVideoElement>()
const box = ref<HTMLElement>()
const paused = ref(true)
const muted = ref(false)
const current = ref(0)
const total = ref(0)
const buffered = ref(0)
const failed = ref(false)
const ready = ref(false)
/** 浏览器不允许带声音自动播放时静音播放，并提示开声音 */
const mutedByPolicy = ref(false)
const idle = ref(false)
let idleTimer = 0

async function start() {
  const v = video.value
  if (!v || !props.active) return
  try {
    v.muted = false
    await v.play()
  } catch (e) {
    const name = (e as DOMException).name
    // 换了 src 时上一次 play() 会被 load() 打断，等新地址能播了再来一次
    if (name === 'AbortError') return void v.addEventListener('canplay', () => void start(), { once: true })
    if (name !== 'NotAllowedError') return
    v.muted = true
    mutedByPolicy.value = true
    await v.play().catch(() => {})
  }
}
watch(
  () => [props.active, src.value, video.value] as const,
  ([a, u, v]) => {
    if (a && u && v) void start()
  },
  // 等 DOM 上的 src 换好再播，不然 play() 打在旧地址上
  { flush: 'post' },
)
function toggle() {
  const v = video.value
  if (!v) return
  v.paused ? void v.play() : v.pause()
}
function toggleMute() {
  const v = video.value
  if (!v) return
  v.muted = !v.muted
  mutedByPolicy.value = false
}
function onTime() {
  const v = video.value
  if (!v) return
  current.value = v.currentTime
  const b = v.buffered
  buffered.value = b.length ? b.end(b.length - 1) : 0
}
function onMeta() {
  const v = video.value
  if (v) total.value = v.duration || 0
}
function onVolume() {
  const v = video.value
  if (v) muted.value = v.muted
}

/**
 * 出错后自动重试：代理或 CDN 的偶发错误（连接中断、签名地址刚好轮换）不该让整张卡片都放不了。
 * 从出错时的进度接着放，最多两次；还不行才提示，提示里可以手动重试。
 */
const MAX_RETRY = 2
let retries = 0
function reload() {
  const v = video.value
  if (!v) return
  // 出错可能是签名过期：有更新的地址就换上（src 变了会重新开始播放）
  if (videoUrl.value && src.value !== videoUrl.value) return void (src.value = videoUrl.value)
  const at = v.currentTime
  const resume = !v.paused || !ready.value
  failed.value = false
  v.load()
  if (at > 0) v.addEventListener('loadedmetadata', () => (v.currentTime = at), { once: true })
  if (resume && props.active) v.addEventListener('canplay', () => void v.play().catch(() => {}), { once: true })
}
function onError() {
  if (retries < MAX_RETRY) {
    retries++
    window.setTimeout(reload, 400 * retries)
    return
  }
  failed.value = true
}
function retry() {
  retries = 0
  reload()
}
// 换成另一个视频文件时状态跟着重置
watch(src, () => {
  retries = 0
  failed.value = false
  ready.value = false
  current.value = 0
  total.value = 0
  buffered.value = 0
})

function fullscreen() {
  if (document.fullscreenElement) return void document.exitFullscreen()
  if (box.value?.requestFullscreen) return void box.value.requestFullscreen().catch(() => {})
  // iOS Safari 只能让 <video> 自己全屏
  ;(video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | undefined)?.webkitEnterFullscreen?.()
}
/** 点视频：触屏上控件藏起来时先把控件叫出来，再点才是播放 / 暂停 */
function onVideoClick() {
  if (bp.touch && idle.value) return poke()
  toggle()
}
function poke() {
  idle.value = false
  clearTimeout(idleTimer)
  idleTimer = window.setTimeout(() => (idle.value = !paused.value), 2400)
}

// 进度条：按下即跳转，拖动跟随
const bar = ref<HTMLElement>()
let seeking = false
function seekTo(e: PointerEvent) {
  const v = video.value
  const r = bar.value?.getBoundingClientRect()
  if (!v || !r || !total.value) return
  const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  v.currentTime = p * total.value
  current.value = v.currentTime
}
function onBarDown(e: PointerEvent) {
  seeking = true
  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  seekTo(e)
}
function onBarMove(e: PointerEvent) {
  if (seeking) seekTo(e)
}
function onBarUp() {
  seeking = false
}
const pct = (n: number) => (total.value ? `${(n / total.value) * 100}%` : '0%')

// ---------- 图文轮播 ----------
const index = ref(0)
watch(images, () => (index.value = Math.min(index.value, Math.max(0, images.value.length - 1))))
function go(step: number) {
  const n = images.value.length
  if (n > 1) index.value = (index.value + step + n) % n
}

// 手指左右滑动：跟手，超过 1/5 宽度或甩得够快就翻页，两端回弹（不循环）
const dragX = ref(0)
const swiping = ref(false)
let sx = 0
let sy = 0
let st = 0
let sid = -1
let axis: 'x' | 'y' | null = null
function onSwipeDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' || images.value.length < 2 || (e.target as HTMLElement).closest('button')) return
  sid = e.pointerId
  sx = e.clientX
  sy = e.clientY
  st = e.timeStamp
  axis = null
}
function onSwipeMove(e: PointerEvent) {
  if (e.pointerId !== sid) return
  const dx = e.clientX - sx
  const dy = e.clientY - sy
  if (!axis) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    if (axis === 'y') return void (sid = -1)
    swiping.value = true
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const atEdge = (dx > 0 && index.value === 0) || (dx < 0 && index.value === images.value.length - 1)
  dragX.value = atEdge ? dx * 0.3 : dx
}
function onSwipeUp(e: PointerEvent) {
  if (e.pointerId !== sid) return
  sid = -1
  if (!swiping.value) return
  const w = box.value?.clientWidth || 1
  const dx = dragX.value
  const fast = Math.abs(dx) > 30 && e.timeStamp - st < 250
  swiping.value = false
  dragX.value = 0
  if (Math.abs(dx) > w / 5 || fast) {
    const next = index.value + (dx < 0 ? 1 : -1)
    if (next >= 0 && next < images.value.length) index.value = next
  }
}
const trackStyle = computed(() => ({
  transform: `translateX(calc(${-index.value * 100}% + ${dragX.value}px))`,
  transition: swiping.value ? 'none' : undefined,
}))

// ---------- 视频快退 / 快进：A / D、左右按钮；长按 D 或右按钮倍速 ----------
const SEEK = 15
const { t } = useI18n()
const HOLD_MS = 320
const FAST_RATE = 2
const fast = ref(false)
const flash = ref<{ text: string; n: number } | null>(null)
let flashTimer = 0
let holdTimer = 0
let flashN = 0
function showFlash(text: string, sticky = false) {
  flash.value = { text, n: ++flashN }
  clearTimeout(flashTimer)
  if (!sticky) flashTimer = window.setTimeout(() => (flash.value = null), 700)
}
function seek(d: number) {
  const v = video.value
  if (!v) return
  const end = v.duration || total.value
  v.currentTime = Math.max(0, end ? Math.min(end - 0.1, v.currentTime + d) : v.currentTime + d)
  current.value = v.currentTime
  showFlash(t('detail.media.seek', { sign: d > 0 ? '+' : '−', n: Math.abs(d) }, Math.abs(d)))
  poke()
}
/** 按下：短按（抬起时还没到 HOLD_MS）快进 15 秒，按住超过 HOLD_MS 改为倍速播放直到松开 */
function holdStart() {
  if (holdTimer || fast.value) return
  holdTimer = window.setTimeout(() => {
    holdTimer = 0
    const v = video.value
    if (!v) return
    fast.value = true
    v.playbackRate = FAST_RATE
    if (v.paused) void v.play().catch(() => {})
    showFlash(t('detail.media.fast', { rate: FAST_RATE }), true)
  }, HOLD_MS)
}
function holdEnd(commit = true) {
  if (holdTimer) {
    clearTimeout(holdTimer)
    holdTimer = 0
    if (commit) seek(SEEK)
  } else if (fast.value) {
    fast.value = false
    if (video.value) video.value.playbackRate = 1
    flash.value = null
  }
}
const holdCancel = () => holdEnd(false)
/** 键盘（Enter / 空格）触发的按钮点击：没有按下 / 抬起，直接快进 */
function onFwdClick(e: MouseEvent) {
  if (e.detail === 0) seek(SEEK)
}

// 详情里切到另一条时组件复用：轮播回到第一张，视频状态清掉
watch(
  () => props.item.id,
  () => {
    index.value = 0
    dragX.value = 0
    swiping.value = false
    holdCancel()
    flash.value = null
    paused.value = true
    mutedByPolicy.value = false
    idle.value = false
  },
)

/**
 * 由 DetailCard 转发的键盘事件：A / D、← / → 切图；视频上 A / D、← / → 后退 / 快进 15 秒，
 * 长按 D / → 倍速播放；空格播放 / 暂停。
 */
function keydown(e: KeyboardEvent): boolean {
  const back = e.code === 'KeyA' || e.key === 'ArrowLeft'
  const fwd = e.code === 'KeyD' || e.key === 'ArrowRight'
  if (mode.value === 'images' && (back || fwd)) {
    if (!e.repeat) go(back ? -1 : 1)
    return true
  }
  if (mode.value === 'video' && !failed.value) {
    if (back) {
      if (!e.repeat) seek(-SEEK)
      return true
    }
    if (fwd) {
      if (!e.repeat) holdStart()
      return true
    }
    if (e.key === ' ') {
      toggle()
      return true
    }
  }
  return false
}
function keyup(e: KeyboardEvent): boolean {
  if (mode.value === 'video' && (e.code === 'KeyD' || e.key === 'ArrowRight')) {
    holdEnd()
    return true
  }
  return false
}
defineExpose({ keydown, keyup })

addEventListener('blur', holdCancel)
onBeforeUnmount(() => {
  removeEventListener('blur', holdCancel)
  clearTimeout(idleTimer)
  clearTimeout(flashTimer)
  clearTimeout(holdTimer)
  video.value?.pause()
})
</script>

<template>
  <div ref="box" class="media" :class="[`is-${mode}`, { fs: fullscreen }]">
    <!-- 封面始终垫在底下：放大动画结束、视频首帧出来之前都看得到 -->
    <img v-if="item.cover && mode !== 'images' && !(mode === 'video' && ready && !failed)" class="poster" :src="imgSrc(item.cover)" alt="" referrerpolicy="no-referrer" />

    <iframe
      v-if="mode === 'embed' && active"
      class="embed"
      :src="embed!"
      :title="item.title ?? t('detail.media.video')"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
    />

    <template v-else-if="mode === 'video'">
      <video
 v-show="!failed"
 ref="video"
        class="video"
        :class="{ ready }"
 :src="mediaSrc(platform, src!)"
 :poster="imgSrc(item.cover)"
        playsinline
        preload="auto"
 loop
 @click="onVideoClick"
 @play="paused = false; poke()"
 @pause="paused = true; idle = false"
        @volumechange="onVolume"
        @timeupdate="onTime"
        @progress="onTime"
        @loadedmetadata="onMeta"
        @loadeddata="ready = true"
        @error="onError"
 @mousemove="poke"
      />
      <div v-if="failed" class="notice">
        <p>{{ t('detail.media.failed') }}</p>
 <div class="notice-actions">
          <button type="button" @click="retry"><RotateCw :size="14" />{{ t('common.action.retry') }}</button>
          <a :href="item.url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="14" />{{ t('detail.media.openOrigin') }}</a>
        </div>
      </div>
      <button v-if="mutedByPolicy && !failed" class="unmute" type="button" @click="toggleMute">
        <VolumeX :size="15" />{{ t('detail.media.unmute') }}
      </button>
      <template v-if="!failed">
        <button class="nav prev" type="button" :aria-label="t('detail.media.back', { n: SEEK }, SEEK)" :title="t('detail.media.backTip', { n: SEEK }, SEEK)" @click="seek(-SEEK)"><ChevronsLeft :size="20" /></button>
        <button
          class="nav next"
          type="button"
          :aria-label="t('detail.media.forward', { n: SEEK }, SEEK)"
          :title="t('detail.media.forwardTip', { n: SEEK }, SEEK)"
          @pointerdown="(e: PointerEvent) => e.button === 0 && holdStart()"
          @pointerup="holdEnd()"
          @pointerleave="holdCancel"
          @pointercancel="holdCancel"
          @contextmenu.prevent
          @click="onFwdClick"
        >
          <ChevronsRight :size="20" />
        </button>
      </template>
      <Transition name="flash">
        <div v-if="flash" :key="flash.n" class="flash" role="status">
          <FastForward v-if="fast" :size="15" fill="currentColor" />{{ flash.text }}
        </div>
      </Transition>
      <button v-if="paused && ready && !failed" class="big-play" type="button" :aria-label="t('detail.media.play')" @click="toggle">
        <Play :size="26" fill="currentColor" />
      </button>
      <div v-if="!failed" class="controls" :class="{ idle }" @mousemove="poke" @pointerdown="poke">
 <div
   ref="bar"
          class="bar"
   role="slider"
   :aria-label="t('detail.media.progress')"
          :aria-valuenow="Math.round(current)"
          :aria-valuemax="Math.round(total)"
          @pointerdown="onBarDown"
   @pointermove="onBarMove"
   @pointerup="onBarUp"
   @pointercancel="onBarUp"
        >
   <span class="buffered" :style="{ width: pct(buffered) }" />
   <span class="played" :style="{ width: pct(current) }" />
   <span class="knob" :style="{ left: pct(current) }" />
        </div>
 <div class="row">
          <button type="button" :aria-label="paused ? t('detail.media.play') : t('detail.media.pause')" @click="toggle">
            <Play v-if="paused" :size="17" fill="currentColor" />
     <Pause v-else :size="17" fill="currentColor" />
   </button>
   <span class="time mono">{{ fmt(current) ?? '00:00' }} / {{ fmt(total) ?? '--:--' }}</span>
   <span class="grow" />
   <button type="button" :aria-label="muted ? t('detail.media.soundOn') : t('detail.media.mute')" @click="toggleMute">
     <VolumeX v-if="muted" :size="17" />
     <Volume2 v-else :size="17" />
          </button>
          <button type="button" :aria-label="t('detail.media.fullscreen')" @click="fullscreen"><Maximize :size="16" /></button>
        </div>
      </div>
    </template>

    <CatbusLoader v-else-if="mode === 'pending'" class="pending-loader" :size="40" />

    <div v-else-if="mode === 'unplayable'" class="notice">
      <p>{{ t('detail.media.noSource') }}</p>
      <div class="notice-actions">
          <button type="button" @click="retry"><RotateCw :size="14" />{{ t('common.action.retry') }}</button>
          <a :href="item.url" target="_blank" rel="noopener noreferrer"><ExternalLink :size="14" />{{ t('detail.media.openOrigin') }}</a>
        </div>
    </div>

    <template v-else-if="mode === 'images'">
      <img v-if="images[index]" class="backdrop" :src="imgSrc(images[index])" alt="" referrerpolicy="no-referrer" />
      <div
        class="track"
        :style="trackStyle"
        @pointerdown="onSwipeDown"
        @pointermove="onSwipeMove"
        @pointerup="onSwipeUp"
        @pointercancel="onSwipeUp"
      >
 <div v-for="(src, i) in images" :key="src + i" class="slide">
   <img :src="imgSrc(src)" :alt="t('detail.image.nth', { n: i + 1 })" referrerpolicy="no-referrer" :loading="i === 0 ? 'eager' : 'lazy'" />
        </div>
      </div>
      <template v-if="images.length > 1">
 <button class="nav prev" type="button" :aria-label="t('detail.image.prev')" @click="go(-1)"><ChevronLeft :size="20" /></button>
 <button class="nav next" type="button" :aria-label="t('detail.image.next')" @click="go(1)"><ChevronRight :size="20" /></button>
        <div class="dots" aria-hidden="true">
          <span v-for="(_, i) in images" :key="i" :class="{ on: i === index }" />
        </div>
        <span class="counter mono">{{ index + 1 }} / {{ images.length }}</span>
      </template>
    </template>
  </div>
</template>

<style scoped>
.media {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--detail-media-bg);
  color: #fff;
}
.poster,
.video,
.embed {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.poster {
  object-fit: contain;
}
.video {
  object-fit: contain;
  background: transparent;
  cursor: pointer;
}
/* 首帧出来前透明，露出底下的封面 */
.video:not(.ready) {
  opacity: 0;
}
.embed {
  background: #000;
}

.notice {
  position: absolute;
  inset: auto 0 0;
  padding: 48px 20px 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  background: linear-gradient(#0b0d1400, #0b0d14d9);
  font-size: 14px;
}
.notice p {
  margin: 0;
}
.notice-actions {
  display: flex;
  gap: 8px;
}
.notice a,
.notice button {
  display: inline-flex;
  font-size: 14px;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 18px;
  color: #fff;
  background: #ffffff26;
  text-decoration: none;
  backdrop-filter: blur(12px);
}
.notice a:hover,
.notice button:hover {
  background: #ffffff40;
}

.pending-loader {
  position: absolute;
  left: 50%;
  top: 50%;
  color: #fff;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 2px 10px #0006);
}

.big-play {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: #0b0d1480;
  backdrop-filter: blur(10px);
  transition: transform 0.25s var(--ease-out), background 0.2s;
}
.big-play:hover {
  transform: scale(1.08);
  background: #0b0d14b3;
}
.big-play svg {
  margin-left: 3px;
}
.unmute {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 16px;
  font-size: 13px;
  color: #fff;
  background: #0b0d1499;
  backdrop-filter: blur(12px);
}

.controls {
  position: absolute;
  inset: auto 0 0;
  padding: 36px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: linear-gradient(#0b0d1400, #0b0d14b3);
  transition: opacity 0.3s;
}
.controls.idle {
  opacity: 0;
}
.bar {
  position: relative;
  height: 16px;
  cursor: pointer;
  touch-action: none;
}
.bar::before,
.buffered,
.played {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  height: 4px;
  border-radius: 2px;
}
.bar::before {
  right: 0;
  background: #ffffff40;
}
.buffered {
  background: #ffffff59;
}
.played {
  background: var(--red);
}
.knob {
  position: absolute;
  top: 2px;
  width: 12px;
  height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px #0006;
  transform: scale(0);
  transition: transform 0.2s var(--ease-out);
}
.bar:hover .knob,
.bar:active .knob {
  transform: scale(1);
}
.row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.row button {
  display: grid;
  place-items: center;
  color: #fff;
  opacity: 0.9;
}
.row button:hover {
  opacity: 1;
}
.time {
  font-size: 12px;
  color: #ffffffd9;
}
.grow {
  flex: 1;
}

/* 图文：模糊的同一张图垫底，主图完整显示 */
.backdrop {
  position: absolute;
  inset: -40px;
  width: calc(100% + 80px);
  height: calc(100% + 80px);
  object-fit: cover;
  filter: blur(40px) brightness(0.7) saturate(1.2);
  transform: scale(1.1);
}
.track {
  position: absolute;
  inset: 0;
  display: flex;
  transition: transform 0.45s var(--ease-out);
}
.slide {
  flex: none;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.slide img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.nav {
  position: absolute;
  top: 50%;
  width: 40px;
  height: 40px;
  margin-top: -20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
  background: var(--detail-bg);
  box-shadow: 0 4px 16px #0003;
  opacity: 0;
  transition: opacity 0.2s, transform 0.2s var(--ease-out);
}
.media:hover .nav,
.nav:focus-visible {
  opacity: 0.92;
}
.nav:hover {
  transform: scale(1.06);
}
.prev {
  left: 14px;
}
.next {
  right: 14px;
}
/* 触屏：用手指滑动切图，左右箭头隐藏，保留指示点；视频控件放大到 --tap */
.track {
  touch-action: pan-y;
}
@media (hover: none) and (pointer: coarse) {
  .nav {
    display: none;
  }
  .controls {
    padding: 28px 10px 6px;
    gap: 2px;
  }
  .bar {
    height: 28px;
  }
  .bar::before,
  .buffered,
  .played {
    top: 12px;
  }
  .knob {
    top: 8px;
    transform: scale(1);
  }
  .row {
    gap: 4px;
  }
  .row button {
    width: var(--tap);
    height: var(--tap);
  }
  .big-play:hover {
    transform: none;
  }
}
@media (hover: none) and (pointer: fine) {
  .nav {
    opacity: 0.85;
  }
}
/* 全屏详情：顶部浮层让开刘海；左上角留给关闭按钮 */
.fs .counter {
  top: calc(var(--safe-top) + 18px);
  right: calc(var(--safe-right) + 14px);
}
.fs .unmute {
  top: calc(var(--safe-top) + 14px);
}
.fs .controls {
  padding-left: max(10px, var(--safe-left));
  padding-right: max(10px, var(--safe-right));
}
.dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 16px;
  display: flex;
  justify-content: center;
  gap: 6px;
}
.dots span {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: #ffffff80;
  transition: width 0.3s var(--ease-out), background 0.3s;
}
.dots span.on {
  width: 16px;
  background: #fff;
}
.flash {
  position: absolute;
  top: 18px;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 16px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #0b0d14a6;
  backdrop-filter: blur(12px);
  transform: translateX(-50%);
  pointer-events: none;
}
.fs .flash {
  top: calc(var(--safe-top) + 16px);
}
.flash-enter-active {
  transition: opacity 0.18s, transform 0.25s var(--ease-out);
}
.flash-leave-active {
  transition: opacity 0.25s;
}
.flash-enter-from {
  opacity: 0;
  transform: translate(-50%, -6px);
}
.flash-leave-to {
  opacity: 0;
}
.counter {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 4px 9px;
  border-radius: 10px;
  font-size: 11px;
  background: #0b0d1466;
  backdrop-filter: blur(12px);
}
</style>
