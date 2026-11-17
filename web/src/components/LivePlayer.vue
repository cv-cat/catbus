<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Maximize, Minimize, Pause, Play, RefreshCw, RotateCw, Tv, Volume2, VolumeX } from 'lucide-vue-next'
import AppSelect from '@/components/AppSelect.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { listLiveMedia } from '@/api/extras'
import type { Media } from '@/api/types'
import { isDemo } from '@/stores/source'

/**
 * 直播页的播放器（AGENTS.md 7.9「直播弹幕」）：`live media` 取直播流地址，只播 FLV（mpegts.js），
 * 经 /api/media 转发（B 站的直播 CDN 校验 Referer，地址还绑定取流时的 IP）。静音自动播放。
 * 控制栏自己画：直播没有进度条，只有播放 / 暂停、刷新、音量和全屏。
 */
/** `fill`：桌面上撑满所在的格子（直播页左侧），否则按 16:9 */
const props = defineProps<{ platform: string; room: string; account: string | null; fill?: boolean }>()
const open = defineModel<boolean>('open', { default: true })
const { t } = useI18n()

interface Quality {
  key: string
  label: string
  height: number
  urls: string[]
}

const video = ref<HTMLVideoElement>()
const stage = ref<HTMLElement>()
const paused = ref(false)
const muted = ref(true)
const volume = ref(1)
const fullscreen = ref(false)
const showCtl = ref(false)
const refreshing = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined
let clickTimer: ReturnType<typeof setTimeout> | undefined
let lastPointer = 'mouse'
const state = ref<'loading' | 'playing' | 'none' | 'failed' | 'unsupported' | 'demo'>('loading')
const qualities = shallowRef<Quality[]>([])
const quality = ref('')
let player: import('mpegts.js').default.Player | null = null
let abort: AbortController | null = null
let tries = 0
let refetched = false

/** 抖音的清晰度后缀；B 站的 qn（原画 10000、蓝光 400、超清 250、高清 150、流畅 80） */
const DOUYIN_Q = ['origin', 'uhd', 'hd', 'sd', 'ld', 'md']
const BILI_QN: Record<string, string> = { '10000': 'origin', '400': 'uhd', '250': 'hd', '150': 'sd', '80': 'md' }
/** 快手的 qualityType（蓝光质臻、蓝光 4M、超清、高清） */
const KS_Q: Record<string, string> = { blue_ray: 'origin', super: 'uhd', high: 'hd', standard: 'sd' }

function qualityKey(id: string): string {
  if (props.platform === 'bilibili') return BILI_QN[id.split('-').pop() ?? ''] ?? id
  const k = id.replace(/\.flv$/, '')
  return props.platform === 'kuaishou' ? (KS_Q[k] ?? k) : k
}

/** 只留浏览器能放的 FLV：去掉纯音频（抖音的 ao）和 HEVC，同一清晰度的多个地址作为备用 */
function toQualities(list: Media[]): Quality[] {
  const map = new Map<string, Quality>()
  for (const m of list) {
    const id = m.id ?? ''
    if (!m.url || !/flv/i.test(id) || /hevc|h265/i.test(id) || /^ao\./.test(id)) continue
    const key = qualityKey(id)
    const q = map.get(key) ?? { key, label: DOUYIN_Q.includes(key) ? t(`live.player.q.${key}`) : key, height: m.height ?? 0, urls: [] }
    // 抖音的直播 CDN 也接受 https；媒体代理只转发 https
    q.urls.push(m.url.replace(/^http:\/\//, 'https://'))
    map.set(key, q)
  }
  const rank = (k: string) => (DOUYIN_Q.includes(k) ? DOUYIN_Q.indexOf(k) : 99)
  return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || b.height - a.height)
}

const options = computed(() => qualities.value.map((q) => ({ value: q.key, label: q.label })))
const proxied = (url: string) => `/api/media?${new URLSearchParams({ platform: props.platform, url })}`

function destroy() {
  if (!player) return
  try {
    player.pause()
    player.unload()
    player.detachMediaElement()
    player.destroy()
  } catch {}
  player = null
}

async function fetchStreams() {
  abort?.abort()
  abort = new AbortController()
  const env = await listLiveMedia(props.platform, props.room, props.account, abort.signal).catch(() => null)
  if (abort.signal.aborted) return false
  qualities.value = toQualities(env?.data ?? [])
  // 默认不选原画：原画码率高，经本机转发时最容易卡
  const pick = qualities.value.find((q) => q.key !== 'origin') ?? qualities.value[0]
  if (!quality.value || !qualities.value.some((q) => q.key === quality.value)) quality.value = pick?.key ?? ''
  return true
}

async function play() {
  destroy()
  const q = qualities.value.find((x) => x.key === quality.value)
  const url = q?.urls[tries % Math.max(1, q.urls.length)]
  if (!url || !video.value) return void (state.value = 'none')
  const { default: mpegts } = await import('mpegts.js')
  if (!mpegts.isSupported()) return void (state.value = 'unsupported')
  state.value = 'loading'
  const p = mpegts.createPlayer(
    { type: 'flv', isLive: true, url: proxied(url) },
    { enableStashBuffer: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 3, liveBufferLatencyMinRemain: 0.5 },
  )
  player = p
  p.on(mpegts.Events.ERROR, () => void onError())
  p.attachMediaElement(video.value)
  p.load()
  const el = video.value
  el.volume = volume.value
  el.muted = muted.value
  paused.value = false
  try {
    await (p.play() as Promise<void> | undefined)
  } catch {
    // 浏览器不允许带声音自动播放时退回静音
    if (player === p && !el.muted) {
      el.muted = muted.value = true
      try {
        await (p.play() as Promise<void> | undefined)
      } catch {}
    }
  }
  if (player === p) {
    state.value = 'playing'
    flashControls()
  }
}

/** 出错时先换同一清晰度的备用地址，再重新取一次流地址（地址带签名会过期），仍不行才提示 */
async function onError() {
  tries++
  const q = qualities.value.find((x) => x.key === quality.value)
  if (q && tries < q.urls.length) return play()
  if (!refetched) {
    refetched = true
    tries = 0
    if (await fetchStreams()) return play()
    return
  }
  destroy()
  state.value = 'failed'
}

async function start() {
  if (isDemo()) return void (state.value = 'demo')
  tries = 0
  refetched = false
  state.value = 'loading'
  if (!(await fetchStreams())) return
  await play()
}

/** 刷新：重新取一次流地址，从最新的画面接着放，保持当前画质 */
async function refresh() {
  if (refreshing.value || isDemo()) return
  refreshing.value = true
  tries = 0
  refetched = false
  try {
    if (await fetchStreams()) await play()
  } finally {
    refreshing.value = false
  }
}

/** 直播的暂停不接着放缓冲：再播放时重新拉流，从最新的画面开始 */
function togglePlay() {
  if (state.value !== 'playing') return
  if (paused.value) return void play()
  player?.pause()
  paused.value = true
  showCtl.value = true
}

function toggleMute() {
  if (!video.value) return
  muted.value = !muted.value
  if (!muted.value && volume.value === 0) volume.value = 0.5
  video.value.muted = muted.value
  video.value.volume = volume.value
}

function onVolume(e: Event) {
  volume.value = Number((e.target as HTMLInputElement).value)
  muted.value = volume.value === 0
  if (video.value) {
    video.value.volume = volume.value
    video.value.muted = muted.value
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {})
  const el = stage.value as (HTMLElement & { webkitRequestFullscreen?: () => void }) | undefined
  const v = video.value as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | undefined
  if (el?.requestFullscreen) el.requestFullscreen().catch(() => {})
  else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen()
  else v?.webkitEnterFullscreen?.() // iOS Safari 只能让 video 全屏
}
const onFullscreenChange = () => (fullscreen.value = document.fullscreenElement === stage.value)

/** 鼠标在画面上移动时显示控制栏，停下 2.5 秒后隐藏；暂停时一直显示 */
function flashControls() {
  showCtl.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (!paused.value && !stage.value?.matches(':focus-within')) showCtl.value = false
  }, 2500)
}
function onPointerMove(e: PointerEvent) {
  lastPointer = e.pointerType
  if (e.pointerType === 'mouse') flashControls()
}
function onPointerLeave(e: PointerEvent) {
  if (e.pointerType !== 'mouse' || paused.value) return
  clearTimeout(hideTimer)
  showCtl.value = false
}
/** 点画面：鼠标是播放 / 暂停（等一下，双击时不切），触屏是显示 / 隐藏控制栏 */
function onSurfaceClick() {
  if (state.value !== 'playing') return
  if (lastPointer !== 'mouse') {
    if (showCtl.value) showCtl.value = false
    else flashControls()
    return
  }
  clearTimeout(clickTimer)
  clickTimer = setTimeout(togglePlay, 220)
}
function onSurfaceDblClick() {
  clearTimeout(clickTimer)
  toggleFullscreen()
}

watch(quality, (k, old) => {
  if (!old || !k || state.value === 'loading') return
  tries = 0
  refetched = false
  void play()
})
watch(open, (v) => {
  if (!v) destroy()
  else if (state.value === 'playing') void play()
})

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  void start()
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  clearTimeout(hideTimer)
  clearTimeout(clickTimer)
  abort?.abort()
  destroy()
})
</script>

<template>
  <section class="player glass" :class="{ closed: !open, fill }">
    <header class="bar">
      <Tv :size="15" />
      <span class="title">{{ t('live.player.title') }}</span>
      <span v-if="open && state === 'playing' && muted" class="hint">{{ t('live.player.muted') }}</span>
      <div class="spacer" />
      <AppSelect v-if="open && options.length > 1" v-model="quality" class="q" :options="options" :label="t('live.player.quality')" :title="t('live.player.quality')" />
      <GlassButton icon size="sm" tone="quiet" :aria-label="open ? t('live.player.hide') : t('live.player.show')" v-tip="open ? t('live.player.hide') : t('live.player.show')" :aria-expanded="open" @click="open = !open">
        <ChevronUp v-if="open" :size="15" /><ChevronDown v-else :size="15" />
      </GlassButton>
    </header>
    <div v-show="open" ref="stage" class="stage" :class="{ idle: state === 'playing' && !showCtl && !paused }" @pointermove="onPointerMove" @pointerdown="lastPointer = $event.pointerType" @pointerleave="onPointerLeave">
      <video ref="video" class="video" :class="{ on: state === 'playing' }" playsinline muted @click="onSurfaceClick" @dblclick="onSurfaceDblClick" />
      <div v-if="state === 'playing'" class="ctl" :class="{ show: showCtl || paused }" @focusin="flashControls">
        <button type="button" class="cb" :aria-label="paused ? t('live.player.play') : t('live.player.pause')" v-tip="paused ? t('live.player.play') : t('live.player.pause')" @click="togglePlay">
          <Play v-if="paused" :size="18" /><Pause v-else :size="18" />
        </button>
        <span class="badge"><i />{{ t('live.player.live') }}</span>
        <button type="button" class="cb" :class="{ spin: refreshing }" :disabled="refreshing" :aria-label="t('live.player.refresh')" v-tip="t('live.player.refresh')" @click="refresh">
          <RotateCw :size="17" />
        </button>
        <div class="grow" />
        <div class="vol">
          <button type="button" class="cb" :aria-label="muted ? t('live.player.unmute') : t('live.player.mute')" v-tip="muted ? t('live.player.unmute') : t('live.player.mute')" @click="toggleMute">
            <VolumeX v-if="muted" :size="18" /><Volume2 v-else :size="18" />
          </button>
          <input class="range" type="range" min="0" max="1" step="0.05" :value="muted ? 0 : volume" :aria-label="t('live.player.volume')" :style="{ '--v': `${(muted ? 0 : volume) * 100}%` }" @input="onVolume" />
        </div>
        <button type="button" class="cb" :aria-label="fullscreen ? t('live.player.exitFullscreen') : t('live.player.fullscreen')" v-tip="fullscreen ? t('live.player.exitFullscreen') : t('live.player.fullscreen')" @click="toggleFullscreen">
          <Minimize v-if="fullscreen" :size="17" /><Maximize v-else :size="17" />
        </button>
      </div>
      <div v-if="state !== 'playing'" class="over">
        <template v-if="state === 'loading'"><CatbusLoader :size="18" />{{ t('live.player.loading') }}</template>
        <template v-else-if="state === 'failed'">
          <span>{{ t('live.player.failed') }}</span>
          <GlassButton size="sm" tone="media" @click="start()"><RefreshCw :size="14" />{{ t('live.player.retry') }}</GlassButton>
        </template>
        <span v-else>{{ t(`live.player.${state}`) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.player {
  border-radius: var(--radius-lg, 16px);
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.player.closed {
  padding-bottom: 10px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2, var(--ink));
  font-size: 13px;
}
.title {
  font-weight: 600;
  color: var(--ink);
}
.hint {
  color: var(--ink-3, var(--ink-2));
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.stage {
  position: relative;
  aspect-ratio: 16 / 9;
  max-height: 56dvh;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}
@media (min-width: 1025px) {
  .player.fill:not(.closed) {
    min-height: 0;
    height: 100%;
  }
  .player.fill .stage {
    flex: 1;
    min-height: 0;
    aspect-ratio: auto;
    max-height: none;
  }
}
.video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.3s;
}
.video.on {
  opacity: 1;
}
.stage.idle {
  cursor: none;
}
.stage:fullscreen {
  border-radius: 0;
  max-height: none;
}
/* 自己画的控制栏：直播没有进度条 */
.ctl {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 28px 10px 8px;
  background: linear-gradient(to top, #000000b3, #00000000);
  color: #fff;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}
.ctl.show,
.ctl:focus-within {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.cb {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cb:hover {
  background: #ffffff26;
}
.cb:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 1px;
}
.cb:disabled {
  cursor: default;
}
.cb.spin :deep(svg) {
  animation: live-spin 0.8s linear infinite;
}
@keyframes live-spin {
  to {
    transform: rotate(360deg);
  }
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.badge i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--red, #e8414f);
  box-shadow: 0 0 0 3px #e8414f40;
}
.grow {
  flex: 1;
}
.vol {
  display: flex;
  align-items: center;
}
.range {
  width: 84px;
  height: 4px;
  margin: 0 6px 0 2px;
  appearance: none;
  border-radius: 2px;
  background: linear-gradient(to right, #fff var(--v), #ffffff4d var(--v));
  cursor: pointer;
}
.range::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
}
.range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}
.range:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 4px;
}
@media (hover: none) and (pointer: coarse) {
  .cb {
    width: 44px;
    height: 44px;
  }
  /* 触屏上音量交给系统按键 */
  .range {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ctl {
    transition: none;
    transform: none;
  }
  .cb.spin :deep(svg) {
    animation: none;
  }
}
:root[data-motion='reduce'] .ctl {
  transition: none;
  transform: none;
}
.over {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #ffffffcc;
  font-size: 13px;
  text-align: center;
  padding: 16px;
}
</style>
