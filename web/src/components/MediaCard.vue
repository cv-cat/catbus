<script lang="ts">
/** 已经加载并显示过的封面地址（所有卡片共用，所以放在模块里而不是 setup 里） */
const shownCovers = new Set<string>()
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp, Check, HardDrive, Heart, ImageOff, MessageCircle, Play, Star } from 'lucide-vue-next'
import UserAvatar from '@/components/UserAvatar.vue'
import type { Item } from '@/api/types'
import type { PlatformMeta } from '@/data/platforms'
import { compact, duration } from '@/composables/format'
import { torrentInfo } from '@/composables/torrent'
import { showInfo } from '@/composables/show'
import { releaseVideo, useHoverPreview } from '@/composables/useHoverPreview'
import { useSettingsStore } from '@/stores/settings'
import { useAuthorStore } from '@/stores/author'
import { gsap, prefersReducedMotion } from '@/composables/motion'

const props = defineProps<{
  item: Item
  ratio: number
  platform?: string
  /** 聚合模式：左上角显示这个渠道的图标 */
  channel?: PlatformMeta
  selected?: boolean
  selecting?: boolean
}>()
const settings = useSettingsStore().settings
/**
 * pick：鼠标按下选择框（或选择模式下按下卡片），开始一次单选 / 拖动连选；
 * press：手指 / 笔按下卡片，瀑布流据此判断长按。都由瀑布流处理。
 */
const emit = defineEmits<{ pick: [e: PointerEvent]; press: [e: PointerEvent]; open: [el: HTMLElement] }>()

/** 点击打开详情卡片；⌘ / Ctrl / Shift / 中键仍在新标签页打开原链接（AGENTS.md 7.9） */
function onClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  emit('open', e.currentTarget as HTMLElement)
}

function onCardDown(e: PointerEvent) {
  if (e.pointerType !== 'mouse') emit('press', e)
  else if (props.selecting && e.button === 0) emit('pick', e)
}
/** 选择框：鼠标按下即选（并可拖动连选）；触屏在点击时切换，由瀑布流处理 */
function onCheckDown(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  e.stopPropagation()
  e.preventDefault()
  emit('pick', e)
}

// 已经显示过的封面：卡片换列时会重建，重建后直接显示，不再淡入一遍
const loaded = ref(!!props.item.cover && shownCovers.has(props.item.cover))
const failed = ref(false)
function onCoverLoad() {
  loaded.value = true
  if (props.item.cover) shownCovers.add(props.item.cover)
}
const video = computed(() => props.item.kind === 'video' || props.item.media.some((m) => m.type === 'video'))
const dur = computed(() => duration(props.item.media.find((m) => m.duration)?.duration))
/** 种子（M-Team，设计稿 K）：标题、角标和底部换一套内容，见 composables/torrent.ts */
const torrent = computed(() => torrentInfo(props.item))
/** 演出（猫眼演出，设计稿 M）：角标放分类和开售，底部放演出者和起价，见 composables/show.ts */
const show = computed(() => showInfo(props.item, null, props.platform))
const title = computed(() => torrent.value?.title ?? (props.item.title || props.item.text || '（无标题）'))
/** 没有封面（纯文字推文、微博等）或封面加载失败：正文本身当封面，不画占位图标（设计稿 H） */
const textOnly = computed(() => !props.item.cover || failed.value)
const short = computed(() => [...title.value].length <= 24)
const author = computed(() => props.item.author?.name ?? '')

// ---------- 作者区：点了进入站内的作者页（AGENTS.md 7.9「作者页」） ----------
const authors = useAuthorStore()
/** 平台的 user get、user items 都已实现，作者有 url 或 id，才做成站内入口；否则作者区和卡片其他地方一样 */
const authorLink = computed(() => Boolean(props.platform && authors.refOf(props.item.author) && authors.canOpen(props.platform)))
/** 新标签页打开平台原主页（⌘ / Ctrl / Shift / 中键）；作者没有 url 时交给卡片，打开条目原链接 */
function openAuthorTab(e: MouseEvent): boolean {
  const url = props.item.author?.url
  if (!url) return false
  e.preventDefault()
  e.stopPropagation()
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
function onAuthorClick(e: MouseEvent) {
  // 选择模式（瀑布流已经切换过选中、拦下了默认行为）：交给卡片，只切换选中
  if (!authorLink.value || e.defaultPrevented || props.selecting) return
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return void openAuthorTab(e)
  // 不打开详情，也不跟随卡片的链接
  e.preventDefault()
  e.stopPropagation()
  authors.open(props.platform!, props.item.author)
}
function onAuthorAux(e: MouseEvent) {
  if (e.button === 1 && authorLink.value && !props.selecting) openAuthorTab(e)
}
function onAuthorKey(e: KeyboardEvent) {
  if (!authorLink.value) return
  e.preventDefault()
  e.stopPropagation()
  authors.open(props.platform!, props.item.author)
}
// 作者头像点与封面占位色：按 id 哈希取设计稿里的四种品牌色
const PALETTE = ['#E8414F', '#232838', '#F0B429', '#5A6BD8']
const seed = computed(() => {
  let h = 2166136261
  for (const c of props.item.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
})
const tint = computed(() => PALETTE[seed.value % PALETTE.length])



// ---------- 悬停视频预览（设置 › 实验性 › hoverPreview） ----------
// 浮层传送到 body：起点正好盖住封面，拿到视频尺寸后长成视频的比例（不推挤别的卡片），开始播放后视频淡入
const preview = useHoverPreview(() => props.platform ?? '', () => props.item)
const cardEl = ref<HTMLElement>()
const coverEl = ref<HTMLElement>()
const popEl = ref<HTMLElement>()
const previewEl = ref<HTMLVideoElement>()
const previewing = ref(false)
const grown = ref(false)
let tween: gsap.core.Tween | null = null

type Box = { left: number; top: number; width: number; height: number }
const coverBox = (): Box | null => {
  const r = coverEl.value?.getBoundingClientRect()
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}
/** 目标尺寸：面积约为封面的 1.5 倍、比例是视频的比例，以封面中心为中心，留在内容区（不盖住侧栏）和视口内 */
function targetBox(from: Box, ratio: number): Box {
  const m = 12
  const area = cardEl.value?.closest('main')?.getBoundingClientRect()
  const minX = Math.max(area?.left ?? 0, 0) + m
  const maxX = Math.min(area?.right ?? innerWidth, innerWidth) - m
  let w = Math.max(Math.sqrt(from.width * from.height * 1.5 * ratio), from.width * 1.08)
  let h = w / ratio
  const k = Math.min(1, (innerHeight * 0.82) / h, ((maxX - minX) * 0.7) / w)
  w *= k
  h *= k
  const left = Math.min(Math.max(from.left + from.width / 2 - w / 2, minX), maxX - w)
  const top = Math.min(Math.max(from.top + from.height / 2 - h / 2, m), innerHeight - h - m)
  return { left, top, width: w, height: h }
}

// 出现：先原样盖住封面
watch(preview.src, async (u) => {
  if (!u) {
    tween?.kill()
    releaseVideo(previewEl.value)
    previewing.value = false
    grown.value = false
    return
  }
  await nextTick()
  const from = coverBox()
  if (popEl.value && from) gsap.set(popEl.value, { ...from, opacity: 1 })
}, { flush: 'pre' })

/** 拿到视频尺寸：长成视频的比例，同时开始播放 */
function grow() {
  const v = previewEl.value
  const pop = popEl.value
  const from = coverBox()
  if (!v || !pop || !from) return
  const ratio = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : from.width / from.height
  const to = targetBox(from, ratio)
  grown.value = true
  tween?.kill()
  tween = gsap.to(pop, { ...to, duration: prefersReducedMotion() ? 0 : 0.8, ease: 'power3.out' })
  v.muted = true
  void v.play().catch(() => {})
}

/** 收起：缩回封面的位置和比例，再卸载 */
function stop() {
  const pop = popEl.value
  const to = coverBox()
  if (!pop || !to || !preview.src.value || prefersReducedMotion()) return preview.leave()
  tween?.kill()
  previewing.value = false
  tween = gsap.to(pop, { ...to, duration: 0.38, ease: 'power3.inOut', onComplete: () => preview.leave() })
}

const inside = (el: HTMLElement | undefined, t: EventTarget | null) => !!el && t instanceof Node && el.contains(t)
function onCardLeave(e: PointerEvent) {
  if (!inside(popEl.value, e.relatedTarget)) stop()
}
function onPopLeave(e: PointerEvent) {
  if (!inside(cardEl.value, e.relatedTarget)) stop()
}
/** 点浮层等于点卡片：打开详情 */
function onPopClick(e: MouseEvent) {
  preview.leave()
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
    window.open(props.item.url, '_blank', 'noopener,noreferrer')
    return
  }
  if (cardEl.value) emit('open', cardEl.value)
}

// 页面滚动、窗口缩放时浮层会和卡片错开：直接收掉
const dismiss = () => preview.src.value && preview.leave()
watch(preview.src, (u) => {
  if (u) {
    addEventListener('scroll', dismiss, { capture: true, passive: true })
    addEventListener('resize', dismiss)
  } else {
    removeEventListener('scroll', dismiss, { capture: true })
    removeEventListener('resize', dismiss)
  }
})
onBeforeUnmount(() => {
  tween?.kill()
  removeEventListener('scroll', dismiss, { capture: true })
  removeEventListener('resize', dismiss)
})
</script>

<template>
  <a
    class="card"
    :class="{ selected, selecting, 'with-chan': !!channel }"
    :href="item.url"
    target="_blank"
    rel="noopener noreferrer"
    draggable="false"
    :data-id="item.id"
    @pointerdown="onCardDown"
    @click="onClick"
    ref="cardEl"
    @pointerenter="preview.enter"
    @pointerleave="onCardLeave"
  >
    <span
      class="check"
      role="checkbox"
      :aria-checked="!!selected"
      aria-label="选择"
      @pointerdown="onCheckDown"
      @click.stop.prevent
    >
      <Check :size="14" :stroke-width="3" aria-hidden="true" />
    </span>
    <!-- 渠道图标：由小到大弹出；瀑布流按位置给 --chan-delay，依次出现 -->
    <Transition name="chan" appear>
      <img v-if="channel" class="chan" :src="channel.logo" :alt="channel.name" :title="channel.name" draggable="false" />
    </Transition>
    <div v-if="textOnly && !torrent" class="face" :class="{ short }" :style="{ '--tint': tint }">
      <span class="quote" aria-hidden="true">“</span>
      <p class="face-text">{{ title }}</p>
    </div>
    <div v-else-if="!textOnly" ref="coverEl" class="cover" :class="{ pending: preview.pending.value }" :style="{ aspectRatio: String(ratio), '--tint': tint }">
      <img
        v-if="item.cover && !failed"
        :src="item.cover"
        :alt="title"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        :class="{ loaded }"
        @load="onCoverLoad"
        @error="failed = true"
      />
      <ImageOff v-else class="fallback" :size="22" aria-hidden="true" />
      <span v-if="video" class="badge">
        <Play :size="11" fill="currentColor" aria-hidden="true" />
        <span class="mono">{{ dur ?? '视频' }}</span>
      </span>
      <template v-if="torrent">
        <span v-if="torrent.discount" class="badge discount" :class="{ free: torrent.free }">
          <span class="mono">{{ torrent.discount }}</span>
        </span>
        <span v-if="torrent.size" class="badge size">
          <HardDrive :size="11" aria-hidden="true" />
          <span class="mono">{{ torrent.size }}</span>
        </span>
      </template>
      <template v-if="show">
        <span v-if="show.category" class="badge">{{ show.category }}</span>
        <span v-if="show.upcoming" class="badge sale">{{ show.upcoming }}</span>
      </template>
    </div>
    <div class="body" :class="{ bare: torrent && textOnly }">
      <!-- 种子没有封面：优惠和体积挪到标题上方 -->
      <div v-if="torrent && textOnly && (torrent.discount || torrent.size)" class="tags">
        <span v-if="torrent.discount" class="tag discount" :class="{ free: torrent.free }">
          <span class="mono">{{ torrent.discount }}</span>
        </span>
        <span v-if="torrent.size" class="tag">
          <HardDrive :size="11" aria-hidden="true" />
          <span class="mono">{{ torrent.size }}</span>
        </span>
      </div>
      <p v-if="!textOnly || torrent" class="title">{{ title }}</p>
      <p v-if="torrent?.name" class="sub mono">{{ torrent.name }}</p>
      <div v-if="torrent" class="meta peers">
        <template v-if="settings.cardStats">
          <span class="stat seed" :class="{ dead: torrent.seeders === 0 }" :aria-label="`${torrent.seeders ?? 0} 人做种`">
            <ArrowUp :size="13" aria-hidden="true" />
            <span class="mono">{{ compact(torrent.seeders) }}</span>
          </span>
          <span class="stat" :aria-label="`${torrent.leechers ?? 0} 人下载`">
            <ArrowDown :size="13" aria-hidden="true" />
            <span class="mono">{{ compact(torrent.leechers) }}</span>
          </span>
        </template>
        <span class="time">{{ torrent.time }}</span>
      </div>
      <div v-else-if="show" class="meta">
        <UserAvatar v-if="item.author" class="ava" :user="item.author" :letter="false" :style="{ '--tint': tint }" />
        <span class="author" :class="{ dim: !item.author }">{{ show.performers ?? show.saleText ?? '' }}</span>
        <span v-if="show.price" class="price"><strong class="mono">{{ show.price }}</strong><small>起</small></span>
      </div>
      <div v-else class="meta">
        <span
          class="by"
          :class="{ link: authorLink }"
          :role="authorLink ? 'link' : undefined"
          :tabindex="authorLink ? 0 : undefined"
          :aria-label="authorLink ? `${author}的作者页` : undefined"
          @click="onAuthorClick"
          @auxclick="onAuthorAux"
          @keydown.enter="onAuthorKey"
        >
          <UserAvatar class="ava" :user="item.author" :letter="false" :style="{ '--tint': tint }" />
          <span class="author">{{ author }}</span>
        </span>
        <template v-if="settings.cardStats">
        <span class="stat" :aria-label="`${item.stats.likes ?? 0} 赞`">
          <Heart :size="13" aria-hidden="true" />
          <span class="mono">{{ compact(item.stats.likes) }}</span>
        </span>
        <!-- 收藏、评论：渠道给了数才显示 -->
        <span v-if="item.stats.collects != null" class="stat extra" :aria-label="`${item.stats.collects} 收藏`">
          <Star :size="13" aria-hidden="true" />
          <span class="mono">{{ compact(item.stats.collects) }}</span>
        </span>
        <span v-if="item.stats.comments != null" class="stat extra" :aria-label="`${item.stats.comments} 评论`">
          <MessageCircle :size="13" aria-hidden="true" />
          <span class="mono">{{ compact(item.stats.comments) }}</span>
        </span>
        </template>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="preview.src.value"
        ref="popEl"
        class="hover-pop"
        :class="{ grown, playing: previewing }"
        @pointerleave="onPopLeave"
        @click="onPopClick"
      >
        <img v-if="item.cover && !failed" class="pop-cover" :src="item.cover" alt="" referrerpolicy="no-referrer" />
        <video
          ref="previewEl"
          class="pop-video"
          :src="preview.src.value"
          muted
          loop
          playsinline
          preload="auto"
          disablepictureinpicture
          disableremoteplayback
          aria-hidden="true"
          tabindex="-1"
          @loadedmetadata="grow"
          @playing="previewing = true"
          @error="preview.leave()"
        />
      </div>
    </Teleport>
  </a>
</template>

<style scoped>
.card {
  display: block;
  border-radius: var(--radius-lg);
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  backdrop-filter: blur(24px);
  transition: transform 0.35s var(--ease-out), box-shadow 0.35s var(--ease-out), background 0.5s;
}
@media (hover: hover) {
  .card:hover {
    transform: translateY(-4px) scale(1.01);
    box-shadow: var(--shadow-card-hover);
  }
  .card:hover .check {
    opacity: 1;
    transform: none;
  }
  .card:hover .cover img.loaded {
    transform: scale(1.04);
  }
  .check:hover {
    background: #ffffff70;
  }
}
.card {
  position: relative;
}
/* 选择框：悬停或进入选择模式时出现，选中时红底白勾 */
.check {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: transparent;
  background: #ffffff40;
  border: 1.5px solid #ffffffd9;
  box-shadow: 0 2px 8px #1b1f2e33;
  backdrop-filter: blur(8px);
  cursor: pointer;
  touch-action: none;
  opacity: 0;
  transform: scale(0.8);
  transition: opacity 0.2s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, border-color 0.2s;
}
.card.selecting .check,
.check:focus-visible {
  opacity: 1;
  transform: none;
}
.card.selected .check {
  color: #fff;
  background: var(--red);
  border-color: var(--red);
  transform: scale(1);
  animation: check-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}
@keyframes check-pop {
  0% { transform: scale(0.7); }
  100% { transform: scale(1); }
}
/* 触屏：选择框一直显示，点按区域放大到 44px；长按不弹系统菜单、不选中文字 */
@media (hover: none) {
  .card {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .card:active:not(.selecting) {
    transform: scale(0.985);
    transition-duration: 0.15s;
  }
  .check {
    opacity: 1;
    transform: none;
    touch-action: manipulation;
  }
  .check::after {
    content: '';
    position: absolute;
    inset: -10px;
  }
}
/* 渠道图标（聚合模式）：和右上角的选择框对称 */
.chan {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  box-shadow: 0 0 0 1.5px #ffffffd9, 0 4px 12px #1b1f2e40;
  pointer-events: none;
  transform-origin: 50% 50%;
}
.chan-enter-active {
  transition: transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) var(--chan-delay, 0ms), opacity 0.25s ease-out var(--chan-delay, 0ms);
}
.chan-leave-active {
  transition: transform 0.22s ease-in, opacity 0.22s ease-in;
}
.chan-enter-from,
.chan-leave-to {
  opacity: 0;
  transform: scale(0.2);
}
/* 给图标让位：视频角标右移，纯文字卡的引号右移 */
.badge,
.quote {
  transition: transform 0.45s var(--ease-out);
}
.card.with-chan .badge {
  transform: translateX(32px);
}
.card.with-chan .quote {
  transform: translateX(30px);
}
.card.selecting {
  cursor: pointer;
  user-select: none;
}
.card.selected {
  box-shadow: 0 0 0 2.5px var(--red), var(--shadow-card-hover);
}
.card.selected .cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: #1b1f2e1f;
  pointer-events: none;
}
.cover {
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 22%, transparent), color-mix(in srgb, var(--tint) 8%, transparent));
}
.cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transform: scale(1.04);
  transition: opacity 0.6s, transform 0.8s var(--ease-out), filter 0.45s var(--ease-out);
}
.cover img.loaded {
  opacity: 1;
  transform: scale(1);
}
.face {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 18px 6px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 14%, transparent), color-mix(in srgb, var(--tint) 4%, transparent));
}
[data-theme='dark'] .face {
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 22%, transparent), color-mix(in srgb, var(--tint) 7%, transparent));
}
.quote {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  font-size: 44px;
  font-weight: 700;
  line-height: 0.9;
  height: 26px;
  color: color-mix(in srgb, var(--tint) 72%, transparent);
}
.face-text {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  line-height: 1.6;
  white-space: pre-line;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.face.short .face-text {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.45;
  padding-bottom: 12px;
}
[data-theme='dark'] .quote {
  color: color-mix(in srgb, var(--tint) 55%, #c9cee6);
}
.card.selected .face {
  box-shadow: inset 0 0 0 999px #1b1f2e0f;
}
.fallback {
  color: var(--ink-3);
}
.badge {
  position: absolute;
  top: 12px;
  left: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 10px;
  background: #1b1f2e66;
  color: #fff;
  font-size: 11px;
  backdrop-filter: blur(12px);
}
.badge.discount {
  background: #232838cc;
  font-weight: 600;
}
.badge.discount.free,
.tag.discount.free {
  background: var(--red);
  color: #fff;
}
.badge.size,
.badge.sale {
  top: auto;
  bottom: 12px;
  background: #1b1f2e99;
}
/* 体积、开售角标在左下角，不用给渠道图标让位 */
.card.with-chan .badge.size,
.card.with-chan .badge.sale {
  transform: none;
}
/* 作者区：占满统计数字左边的空间；能进作者页时悬停变红 */
.by {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.by.link {
  cursor: pointer;
}
.by.link:hover .author,
.by.link:focus-visible .author {
  color: var(--red);
}
.by.link:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
  border-radius: 6px;
}
.author.dim {
  color: var(--ink-3);
}
.price {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
}
.price strong {
  color: var(--red);
  font-size: 13px;
  font-weight: 700;
}
.price small {
  font-size: 11px;
  color: var(--ink-3);
}
.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
}
.body.bare {
  padding-top: 16px;
}
.tags {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 右上角是选择框 */
  padding-right: 28px;
  transition: padding 0.45s var(--ease-out);
}
.card.with-chan .tags {
  padding-left: 32px;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 10px;
  background: var(--hair);
  color: var(--ink-2);
  font-size: 11px;
}
.tag.discount {
  background: #232838;
  color: #fff;
  font-weight: 600;
}
.sub {
  margin: -2px 0 0;
  color: var(--ink-3);
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta.peers {
  gap: 10px;
}
.stat.seed {
  color: var(--ink);
  font-weight: 600;
}
.stat.seed svg {
  color: var(--ink-2);
}
.stat.seed.dead,
.stat.seed.dead svg {
  color: var(--red);
}
.meta.peers .stat + .stat {
  margin-left: 0;
}
.time {
  margin-left: auto;
  white-space: nowrap;
  font-size: 11.5px;
}
.title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
  font-size: 12px;
}
.ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--tint);
  box-shadow: inset 0 0 0 1.5px #ffffff40;
  flex: none;
}
.author {
  flex: 1;
  min-width: 0;
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
}
.stat + .stat {
  margin-left: 4px;
}
/* 悬停预览：正在取视频地址时封面上扫过一道柔光，告诉用户「马上就播」 */
.cover.pending::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 35%, #ffffff33 50%, transparent 65%);
  background-size: 250% 100%;
  animation: pending-sheen 1.1s ease-in-out infinite;
  pointer-events: none;
}
@keyframes pending-sheen {
  from { background-position: 120% 0; }
  to { background-position: -120% 0; }
}
/* 浮层（传送到 body）：起点和封面重合，长大后浮在卡片之上 */
.hover-pop {
  position: fixed;
  z-index: 30;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: #000;
  cursor: pointer;
  box-shadow: 0 0 0 transparent;
  transition: box-shadow 0.5s var(--ease-out), border-radius 0.5s var(--ease-out);
  will-change: left, top, width, height;
}
/* 视频还在加载（还没拿到尺寸）时，浮层上同样扫过柔光 */
.hover-pop:not(.grown)::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(105deg, transparent 35%, #ffffff33 50%, transparent 65%);
  background-size: 250% 100%;
  animation: pending-sheen 1.1s ease-in-out infinite;
  pointer-events: none;
}
.hover-pop.grown {
  border-radius: calc(var(--radius-lg) + 4px);
  box-shadow: 0 28px 70px #0b0d1a59, 0 0 0 1px #ffffff1f;
}
.pop-cover,
.pop-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.pop-video {
  opacity: 0;
  transition: opacity 0.45s var(--ease-out);
}
.hover-pop.playing .pop-video {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .pop-video,
  .chan-enter-active,
  .chan-leave-active,
  .badge,
  .quote {
    transition: none;
  }
  .cover.pending::after,
  .hover-pop:not(.grown)::after {
    animation: none;
  }
}
/* 手机：两列，字号、内边距收小，统计只留点赞 */
@media (max-width: 640px) {
  .card {
    border-radius: var(--radius-md);
  }
  .check {
    top: 8px;
    right: 8px;
  }
  .chan {
    top: 8px;
    left: 8px;
    width: 22px;
    height: 22px;
    border-radius: 7px;
  }
  .card.with-chan .badge {
    transform: translateX(28px);
  }
  .card.with-chan .quote {
    transform: translateX(24px);
  }
  .badge {
    top: 8px;
    left: 8px;
    padding: 3px 6px;
    font-size: 10px;
  }
  .badge.size,
  .badge.sale {
    top: auto;
    bottom: 8px;
  }
  .sub {
    font-size: 10px;
    -webkit-line-clamp: 1;
  }
  .meta.peers {
    gap: 8px;
  }
  .time {
    font-size: 10.5px;
  }
  .body {
    gap: 7px;
    padding: 9px 10px 10px;
  }
  .face {
    padding: 14px 12px 4px;
  }
  .quote {
    font-size: 34px;
    height: 20px;
  }
  .face-text {
    font-size: 14px;
    -webkit-line-clamp: 7;
  }
  .face.short .face-text {
    font-size: 17px;
  }
  .title {
    font-size: 13px;
    line-height: 1.4;
  }
  .meta {
    gap: 5px;
    font-size: 11px;
  }
  .ava {
    width: 16px;
    height: 16px;
  }
  .stat {
    font-size: 11px;
  }
  .stat.extra {
    display: none;
  }
}
</style>
