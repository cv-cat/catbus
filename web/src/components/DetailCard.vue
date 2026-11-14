<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Calendar, Files, MapPin, Tags, Braces, Check, ChevronDown, ChevronUp, Download, ExternalLink, Heart, MessageCircle, Share2, ShieldAlert, Star, X } from 'lucide-vue-next'
import DetailMedia from './DetailMedia.vue'
import CommentThread from './CommentThread.vue'
import UserAvatar from './UserAvatar.vue'
import EmojiText from './EmojiText.vue'
import { linkSegments } from '@/composables/linkify'
import { bbcodeBlocks } from '@/composables/bbcode'
import { torrentInfo } from '@/composables/torrent'
import { showInfo } from '@/composables/show'
import SaleCountdown from './SaleCountdown.vue'
import ShowTickets from './maoyan/ShowTickets.vue'
import { ticketCache, ticketKey } from '@/composables/ticketCache'
import CommentMedia from './CommentMedia.vue'
import CatbusLoader from './CatbusLoader.vue'
import RawJsonView from './RawJsonView.vue'
import RelatedRail from './RelatedRail.vue'
import { getRawItem } from '@/api/raw'
import { useSettingsStore } from '@/stores/settings'
import { getItem, isAbort, listComments, imgSrc } from '@/api/client'
import type { CatbusError, Comment, Item } from '@/api/types'
import { platformById } from '@/data/platforms'
import { compact, number, since, tintOf } from '@/composables/format'
import { errorDetail, errorTitle } from '@/i18n/errors'
import { resetReplyQueue } from '@/composables/replyQueue'
import { cancelRelated } from '@/composables/useRelated'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { storeToRefs } from 'pinia'
import { useDetailStore, type DetailTarget } from '@/stores/detail'
import { useAuthorStore } from '@/stores/author'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useDetailSwipe } from '@/composables/useDetailSwipe'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadMenu from './DownloadMenu.vue'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { openVerify, useVerifyStore, verifyUrlOf } from '@/stores/verify'

/**
 * 详情卡片（AGENTS.md 7.9，设计稿 web-desgin.pen 的 E / F / G）。
 * 打开：封面从瀑布流卡片的位置放大到媒体区，信息栏随后展开；关闭：缩回原卡片。
 * 只读：不能评论、点赞、收藏，互动数只显示数量。
 */
const { t } = useI18n()
const detailStore = useDetailStore()
const { target } = storeToRefs(detailStore)
const { close, step, canStep, jump } = detailStore
const { verify } = useVerifyStore()
const downloads = useDownloadsStore()

const cur = shallowRef<DetailTarget | null>(null)
const detail = shallowRef<Item | null>(null)
const item = computed(() => detail.value ?? cur.value?.item ?? null)
const platform = computed(() => platformById(cur.value?.platform ?? ''))
/** 种子（M-Team，设计稿 L）：头部、正文、底部换一套内容，没有评论区 */
const torrent = computed(() => torrentInfo(item.value, cur.value?.item))
/** 简介是 BBCode：详情回来后拆成图片、引用、代码和普通文字（列表里的 text 只是副标题，不渲染） */
const descr = computed(() => (torrent.value && detail.value ? bbcodeBlocks(detail.value.text) : []))
const badImgs = ref(new Set<string>())
/** 演出（猫眼演出，设计稿 N）：头部是演出者，正文是时间、场馆、票价和详情长图，底部是起价和开售倒计时，没有评论区 */
const show = computed(() => showInfo(item.value, cur.value?.item, cur.value?.platform))
/** 普通条目（不是种子、演出）：作者、正文、评论、互动数 */
const plain = computed(() => !torrent.value && !show.value)
/** 演出的 media 是详情长图，放在正文里；左侧只放海报 */
const showImages = computed(() => (show.value ? (item.value?.media ?? []).filter((m) => m.type === 'image' && m.url).map((m) => m.url!) : []))
/** 演出查到了场次（AGENTS.md 7.9「猫眼演出的场次与票档」）：隐藏原来的「票价」一行，票档表里已经有了 */
const ticketsShown = computed(() => {
  const c = cur.value
  return !!c && (ticketCache.get(ticketKey(c.platform, c.item.id))?.sessions.length ?? 0) > 0
})
const mediaItem = computed(() => (show.value && item.value?.cover ? { ...item.value, media: [] } : item.value!))
const loadingItem = ref(false)
const itemError = ref<CatbusError | null>(null)
const comments = shallowRef<Comment[]>([])
const commentCursor = ref<string | null>(null)
const commentMore = ref(false)
const loadingComments = ref(false)
const commentError = ref<CatbusError | null>(null)
/** 打开动效结束后才开始播放 */
const active = ref(false)
const settled = ref(false)

// ---------- 原始 JSON（设置「实验性」→ 显示原始 JSON）：点 {} 切换，第一次切过去时才取 item get --raw ----------
const settingsStore = useSettingsStore()
const rawEnabled = computed(() => settingsStore.settings.rawJson)
const rawView = ref(false)
const raw = shallowRef<unknown>(undefined)
const rawLoading = ref(false)
const rawError = ref<CatbusError | null>(null)
/** 关掉设置时立即退回普通视图 */
watch(rawEnabled, (on) => !on && (rawView.value = false))
function resetRaw() {
  rawView.value = false
  raw.value = undefined
  rawLoading.value = false
  rawError.value = null
}
async function loadRaw() {
  const t = cur.value
  if (!t || rawLoading.value) return
  const my = token
  rawLoading.value = true
  rawError.value = null
  try {
    const env = await getRawItem(t.platform, t.item, t.account, loads.signal)
    if (my !== token) return
    if (env.ok) raw.value = env.data
    else rawError.value = env.error
  } catch (e) {
    if (my === token && !isAbort(e)) rawError.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    if (my === token) rawLoading.value = false
  }
}
function toggleRaw() {
  rawView.value = !rawView.value
  if (rawView.value && raw.value === undefined && !rawError.value) void loadRaw()
  if (body.value) body.value.scrollTop = 0
}

// ---------- 下载：与瀑布流的批量下载走同一个接口，这一条算一批 ----------
const dl = ref<'idle' | 'busy' | 'done'>('idle')
/** 下载按钮旁的下载面板：选内容和格式，选择记进设置 */
const dlMenu = ref(false)
const dlMenuBtn = ref<HTMLElement>()
let dlTimer = 0
async function download() {
  const c = cur.value
  const it = item.value
  if (!c || !it || dl.value === 'busy') return
  dl.value = 'busy'
  try {
    await downloads.start(c.platform, c.account, [it], commentsSupported(c.platform))
    dl.value = 'done'
    clearTimeout(dlTimer)
    dlTimer = window.setTimeout(() => (dl.value = 'idle'), 2400)
  } catch (e) {
    dl.value = 'idle'
    alert((e as Error).message)
  }
}

const scrim = ref<HTMLElement>()
const sheet = ref<HTMLElement>()
const ghost = ref<HTMLImageElement>()
const panel = ref<HTMLElement>()
const body = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
const closeBtn = ref<HTMLButtonElement>()
/** 全屏时浮在媒体左上角的关闭按钮 */
const floatClose = ref<HTMLButtonElement>()
const media = ref<InstanceType<typeof DetailMedia>>()

// ---------- 布局：横屏（宽高比 ≥ 1.2）/ 竖屏 / 全屏（手机，以及放不下浮动卡片时） ----------
const bp = useBreakpoint()
const vw = computed(() => bp.width || innerWidth)
const vh = computed(() => bp.height || innerHeight)
/** 搜索结果没有媒体尺寸时，用卡片里封面图的原始尺寸 */
const natural = ref<number | null>(null)
const ratio = computed(() => {
  const m = item.value?.media.find((x) => x.width && x.height)
  if (m) return m.width! / m.height!
  return natural.value ?? (item.value?.kind === 'torrent' ? 0.68 : item.value?.kind === 'video' ? 0.75 : 0.8)
})
/** 没有封面也没有媒体（纯文字推文、微博等）：不留黑色媒体区，单栏居中（设计稿 I） */
const textOnly = computed(() => Boolean(item.value && !item.value.cover && !item.value.media.length))
const TEXT_W = 660
/** 与列表里纯文字卡同一种底色：按条目 id 哈希（MediaCard 的 PALETTE） */
const CARD_TINTS = ['#E8414F', '#232838', '#F0B429', '#5A6BD8']
const faceTint = computed(() => {
  let h = 2166136261
  for (const c of item.value?.id ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return CARD_TINTS[(h >>> 0) % CARD_TINTS.length]
})
const landscape = computed(() => !textOnly.value && ratio.value >= 1.2)
const MARGIN = 40
/** 浮动卡片放得下：媒体区至少留出这么宽（横屏 420 / 竖屏 320），高度至少 400 */
const fits = computed(() => {
  if (textOnly.value) return vw.value - 2 * MARGIN >= 420 && vh.value - 2 * MARGIN >= 320
  const room = vw.value - 2 * MARGIN - (landscape.value ? 368 : 420)
  return room >= (landscape.value ? 420 : 320) && vh.value - 2 * MARGIN >= 400
})
/** 全屏：手机一律全屏；平板和桌面在浮动卡片放不下时（例如竖屏平板）全屏 */
const isCompact = computed(() => bp.phone || !fits.value)

interface Geo {
  left: number
  top: number
  width: number
  height: number
  mediaW: number
  mediaH: number
}
const geo = computed<Geo>(() => {
  const W = vw.value
  const H = vh.value
  const r = ratio.value
  if (isCompact.value) {
    // 竖图 / 竖视频最高约 70% 视口，横的按宽度
    const mh = Math.round(Math.min(W / Math.max(r, 9 / 16), H * 0.7))
    return { left: 0, top: 0, width: W, height: H, mediaW: W, mediaH: mh }
  }
  if (textOnly.value) {
    const w = Math.min(TEXT_W, W - 2 * MARGIN)
    return { left: Math.round((W - w) / 2), top: MARGIN, width: w, height: H - 2 * MARGIN, mediaW: 0, mediaH: 0 }
  }
  if (landscape.value) {
    const panelW = 368
    const rr = Math.min(r, 2.4)
    let mw = Math.min(1360, W - 2 * MARGIN) - panelW
    let mh = mw / rr
    if (mh > H - 2 * MARGIN) {
      mh = H - 2 * MARGIN
      mw = mh * rr
    }
    // 太扁的视频上下留黑边，保证信息栏有足够高度
    const h = Math.round(Math.max(mh, Math.min(560, H - 2 * MARGIN)))
    mw = Math.round(mw)
    return { left: Math.round((W - mw - panelW) / 2), top: Math.round((H - h) / 2), width: mw + panelW, height: h, mediaW: mw, mediaH: h }
  }
  const panelW = 420
  const rr = Math.min(3 / 4, Math.max(9 / 16, r))
  const mh = Math.round(Math.min(H - 2 * MARGIN, 1100))
  const mw = Math.round(Math.max(280, Math.min(mh * rr, W - 2 * MARGIN - panelW)))
  return { left: Math.round((W - mw - panelW) / 2), top: Math.round((H - mh) / 2), width: mw + panelW, height: mh, mediaW: mw, mediaH: mh }
})
const sheetStyle = computed(() => {
  const g = geo.value
  if (textOnly.value) {
    // 高度随内容：上下各留 MARGIN，margin:auto 垂直居中（.text-only .sheet），最高到视口 - 2×MARGIN
    if (isCompact.value) return {}
    return { left: `${g.left}px`, width: `${g.width}px`, top: `${MARGIN}px`, bottom: `${MARGIN}px` }
  }
  if (isCompact.value) {
    // 全屏：媒体在上、信息栏在下，整个面板一起滚动；信息栏至少撑满剩下的高度
    return { gridTemplateColumns: '100%', gridTemplateRows: `${g.mediaH}px minmax(${Math.max(0, g.height - g.mediaH)}px, auto)` }
  }
  return {
    left: `${g.left}px`,
    top: `${g.top}px`,
    width: `${g.width}px`,
    height: `${g.height}px`,
    gridTemplateColumns: `${g.mediaW}px 1fr`,
    gridTemplateRows: '1fr',
  }
})

/** 上下切换按钮：贴在卡片右侧，放不下时贴视口右边 */
const stepStyle = computed(() => {
  const g = geo.value
  return { left: `${Math.min(g.left + g.width + 16, vw.value - 60)}px` }
})

/** 媒体区里按宽高比完整显示的封面位置：放大动画的终点 / 缩回的起点 */
function mediaRect(coverRatio: number) {
  const g = geo.value
  const bw = g.mediaW
  const bh = g.mediaH
  const [w, h] = bw / bh > coverRatio ? [bh * coverRatio, bh] : [bw, bw / coverRatio]
  return { left: g.left + (bw - w) / 2, top: g.top + (bh - h) / 2, width: w, height: h }
}

// ---------- 打开 / 关闭动效 ----------
function sourceCover(t: DetailTarget | null): HTMLElement | null {
  return t?.source?.querySelector<HTMLElement>('.cover') ?? null
}
function visible(r: DOMRect) {
  return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
}
const rectOf = (r: { left: number; top: number; width: number; height: number }) => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
})

let tl: gsap.core.Timeline | null = null

async function playOpen(t: DetailTarget) {
  const coverEl = sourceCover(t)
  const img = coverEl?.querySelector('img')
  natural.value = img?.naturalWidth ? img.naturalWidth / img.naturalHeight : null
  await nextTick()
  const s = sheet.value!
  const g = ghost.value!
  const content = panel.value!.querySelectorAll('.rv')
  tl?.kill()
  if (t.source) t.source.style.visibility = 'hidden'
  swipe.reset()
  s.scrollTop = 0

  const src = coverEl?.getBoundingClientRect()
  if (prefersReducedMotion() || !src || !visible(src)) {
    gsap.set(g, { display: 'none' })
    tl = gsap
      .timeline({ onComplete: opened })
      .fromTo(scrim.value!, { opacity: 0 }, { opacity: 1, duration: 0.18 })
      .fromTo(s, { opacity: 0, scale: prefersReducedMotion() ? 1 : 0.96 }, { opacity: 1, scale: 1, duration: 0.18 }, 0)
    if (floatClose.value) tl.fromTo(floatClose.value, { opacity: 0 }, { opacity: 1, duration: 0.18 }, 0)
    return
  }
  const coverRatio = src.width / src.height
  const end = mediaRect(coverRatio)
  gsap.set(g, { display: 'block', ...rectOf(src), borderRadius: '20px 20px 0 0', opacity: 1 })
  gsap.set(s, { opacity: 0, scale: 1 })
  gsap.set(panel.value!, { clipPath: isCompact.value ? 'inset(0 0 100% 0)' : 'inset(0 100% 0 0)' })
  gsap.set(content, { opacity: 0, y: 8 })
  tl = gsap
    .timeline()
    .fromTo(scrim.value!, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0)
    .to(g, { ...end, borderRadius: isCompact.value ? '0px' : '14px', duration: 0.48, ease: 'expo.out' }, 0)
    .to(s, { opacity: 1, duration: 0.18, ease: 'none' }, 0.16)
    .to(panel.value!, { clipPath: 'inset(0 0% 0% 0)', duration: 0.42, ease: 'expo.out', clearProps: 'clipPath' }, 0.2)
    .to(content, { opacity: 1, y: 0, duration: 0.36, ease: 'power3.out', stagger: 0.04, clearProps: 'opacity,transform' }, 0.3)
    .to(g, { opacity: 0, duration: 0.16, ease: 'none' }, 0.44)
  if (floatClose.value) tl.fromTo(floatClose.value, { opacity: 0 }, { opacity: 1, duration: 0.24, ease: 'none' }, 0.3)
  tl
    // 放大结束就开始播放，不等信息栏的内容淡入完
    .call(opened, [], 0.6)
}

function opened() {
  gsap.set(ghost.value!, { display: 'none' })
  navShown.value = true
  busy = false
  active.value = true
  settled.value = true
  // 鼠标打开时不显示焦点圈，Tab 之后才出现
  ;(floatClose.value ?? closeBtn.value)?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
}

function playClose(t: DetailTarget): Promise<void> {
  return new Promise((resolve) => {
    tl?.kill()
    switching++
    active.value = false
    settled.value = false
    navShown.value = false
    busy = false
    clearTimeout(loadTimer)
    const done = () => {
      if (t.source) t.source.style.visibility = ''
      t.source?.focus?.({ preventScroll: true, focusVisible: false } as FocusOptions)
      resolve()
    }
    const coverEl = sourceCover(t)
    const src = coverEl?.getBoundingClientRect()
    const s = sheet.value!
    const fc = floatClose.value
    const start = mediaRect(src ? src.width / src.height : 1)
    if (isCompact.value) {
      // 全屏时媒体随面板滚动、随下滑移动：从它现在的位置缩回
      start.top += Number(gsap.getProperty(s, 'y')) - s.scrollTop
    }
    if (prefersReducedMotion() || !src || !visible(src) || start.top + start.height <= 0) {
      if (t.source) t.source.style.visibility = ''
      tl = gsap
        .timeline({ onComplete: done })
        .to(s, { opacity: 0, scale: prefersReducedMotion() ? 1 : 0.96, duration: 0.18, ease: 'power2.in' })
        .to(scrim.value!, { opacity: 0, duration: 0.18 }, 0)
      if (fc) tl.to(fc, { opacity: 0, duration: 0.14 }, 0)
      return
    }
    const g = ghost.value!
    gsap.set(g, { display: 'block', ...start, borderRadius: isCompact.value ? '0px' : '14px', opacity: 1 })
    tl = gsap
      .timeline({ onComplete: done })
      .to(s, { opacity: 0, duration: 0.16, ease: 'power1.in' }, 0)
      .to(scrim.value!, { opacity: 0, duration: 0.36, ease: 'power2.inOut' }, 0)
      .to(g, { ...rectOf(src), borderRadius: '20px 20px 0 0', duration: 0.36, ease: 'power3.inOut' }, 0)
    if (fc) tl.to(fc, { opacity: 0, duration: 0.12, ease: 'none' }, 0)
  })
}

// ---------- 上一条 / 下一条：旧的往切换方向滑出，新的从另一侧滑入 ----------
/** 上下切换按钮：打开动效结束后出现，关闭时先隐去 */
const navShown = ref(false)
const hasPrev = computed(() => Boolean(target.value && canStep(-1)))
const hasNext = computed(() => Boolean(target.value && canStep(1)))
let switching = 0
/** 正在切换（滑出 / 滑入中）：这时可以继续切，打开动效进行中则不行 */
let busy = false
/** 连续快速切换时只给最后停下的那条发请求，避免对平台连发 */
const LOAD_DELAY = 280
let loadTimer = 0

function tween(vars: gsap.TweenVars, el: gsap.TweenTarget): Promise<void> {
  return new Promise((resolve) => {
    tl = gsap.timeline({ onComplete: () => resolve() }).to(el, vars)
  })
}

/** dir 为 0：从相关推荐切过来，卡片不动，媒体区和信息栏交叉淡入（AGENTS.md 7.9「相关推荐」） */
async function playSwitch(t: DetailTarget, dir: 1 | -1 | 0) {
  const my = ++switching
  busy = true
  const s = sheet.value!
  tl?.kill()
  active.value = false
  settled.value = false
  const dist = Math.min(80, vh.value * 0.08)
  const reduced = prefersReducedMotion()
  const parts = () => Array.from(s.children)
  if (dir === 0) await tween({ opacity: 0, duration: reduced ? 0.06 : 0.125, ease: 'power3.inOut' }, parts())
  else await tween({ y: reduced ? 0 : -dir * dist, opacity: 0, duration: reduced ? 0.1 : 0.2, ease: 'power2.in' }, s)
  if (my !== switching) return

  // 卡片的隐藏状态跟着换：关闭时缩回新的这一条
  const prev = cur.value
  if (prev?.source) prev.source.style.visibility = ''
  if (t.source) {
    t.source.style.visibility = 'hidden'
    t.source.scrollIntoView({ block: 'nearest' })
  }
  const img = sourceCover(t)?.querySelector('img')
  natural.value = img?.naturalWidth ? img.naturalWidth / img.naturalHeight : null
  cur.value = t
  dl.value = 'idle'
  clearTimeout(dlTimer)
  reset()
  loadingItem.value = true
  const tk = token
  clearTimeout(loadTimer)
  loadTimer = window.setTimeout(() => tk === token && void load(t), LOAD_DELAY)
  await nextTick()
  s.scrollTop = 0
  if (body.value) body.value.scrollTop = 0
  if (my !== switching) return

  if (dir === 0) {
    tl = gsap.timeline({ onComplete: opened }).fromTo(
      parts(),
      { opacity: 0 },
      { opacity: 1, duration: reduced ? 0.06 : 0.125, ease: 'power3.inOut', clearProps: 'opacity' },
    )
    return
  }
  tl = gsap.timeline({ onComplete: opened }).fromTo(
    s,
    { y: reduced ? 0 : dir * dist, opacity: 0 },
    { y: 0, opacity: 1, duration: reduced ? 0.12 : 0.42, ease: 'expo.out', clearProps: 'transform' },
  )
}

function go(dir: 1 | -1) {
  if (!settled.value && !busy) return
  step(dir)
}

watch(target, async (t, before) => {
  if (t && before && (t.dir || t.related) && cur.value) {
    await playSwitch(t, t.dir ?? 0)
  } else if (t) {
    switching++
    clearTimeout(loadTimer)
    cur.value = t
    dl.value = 'idle'
    clearTimeout(dlTimer)
    reset()
    void load(t)
    await playOpen(t)
  } else if (before && cur.value) {
    // 关闭：还在路上的详情、评论、回复、相关推荐都不要了
    token++
    abortLoads()
    const c = cur.value
    await playClose(c)
    if (!target.value) cur.value = null
  }
})

// ---------- 数据：先显示搜索结果，再用 item get 补全、comment list 取评论 ----------
let token = 0
/**
 * 这一条（token）的请求共用的取消器：换条目、关闭卡片时中止，bridge 随之结束子进程，
 * 过期的 item get / comment list / raw / 回复预取 / 相关推荐不再打到平台。
 * 取消只发生在 token 变了之后，结果本来就会被丢弃；catch 里另外按 isAbort 跳过，不显示成错误。
 */
let loads = new AbortController()
function abortLoads() {
  loads.abort()
  loads = new AbortController()
  resetReplyQueue()
  cancelRelated()
}
function reset() {
  token++
  abortLoads()
  detail.value = null
  itemError.value = null
  badImgs.value = new Set()
  comments.value = []
  resetRaw()
  commentCursor.value = null
  commentMore.value = false
  commentError.value = null
  // 上一条的请求可能还没回来：它的 finally 因 token 已变不会复位，这里先复位，否则新卡片的 loadComments 直接 return
  loadingComments.value = false
  active.value = false
  settled.value = false
}

async function load(t: DetailTarget) {
  const my = token
  loadingItem.value = true
  try {
    const env = await getItem(t.platform, t.item, t.account, loads.signal)
    if (my !== token) return
    if (env.ok && env.data) detail.value = { ...env.data, url: env.data.url || t.item.url }
    else itemError.value = env.error
  } catch (e) {
    if (my === token && !isAbort(e)) itemError.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    if (my === token) loadingItem.value = false
  }
  // 评论在详情之后再取，避免同一时刻对平台发两次请求；种子没有评论
  if (my === token && t.item.kind !== 'torrent' && t.platform !== 'maoyan') await loadComments()
}

async function loadComments() {
  const t = cur.value
  if (!t || loadingComments.value) return
  const my = token
  loadingComments.value = true
  commentError.value = null
  try {
    const env = await listComments(t.platform, detail.value ?? t.item, commentCursor.value, t.account, loads.signal)
    if (my !== token) return
    if (env.ok && env.data) {
      const seen = new Set(comments.value.map((c) => c.id))
      comments.value = [...comments.value, ...env.data.filter((c) => !seen.has(c.id))]
      commentCursor.value = env.page?.cursor ?? null
      commentMore.value = Boolean(env.page?.has_more && env.page.cursor)
    } else commentError.value = env.error
  } catch (e) {
    if (my === token && !isAbort(e)) commentError.value = { code: 'BRIDGE', message: (e as Error).message, hint: null, detail: null }
  } finally {
    if (my === token) loadingComments.value = false
  }
}

/** 评论区的滚动容器：浮动卡片是 .body，全屏是整个面板 */
const scroller = computed(() => (isCompact.value ? sheet.value : body.value))
let io: IntersectionObserver | undefined
watch([sentinel, scroller], ([s, b]) => {
  io?.disconnect()
  if (!s || !b) return
  io = new IntersectionObserver(([e]) => e?.isIntersecting && commentMore.value && !commentError.value && void loadComments(), {
    root: b,
    rootMargin: '200px',
  })
  io.observe(s)
})

function verifyComments() {
  const t = cur.value
  if (!t || !commentError.value) return
  openVerify({ platform: t.platform, url: verifyUrlOf(commentError.value), message: errorTitle(commentError.value), retry: loadComments })
}

// ---------- 展示 ----------
/** 正文：去掉小红书的 `[话题]` 标记，话题高亮 */
function segments(text: string | null | undefined) {
  if (!text) return []
  const clean = text.replace(/#([^#\n[]+?)\[话题\]#/g, '#$1 ') // i18n-ignore：解析小红书的话题标记
  // 链接整段交给 EmojiText 渲染，链接里的 `#` 不当成话题
  return linkSegments(clean).flatMap((l) =>
    l.href
      ? [{ t: l.t, tag: false }]
      : l.t.split(/(#[^\s#]+)/).filter(Boolean).map((t) => ({ t, tag: t.startsWith('#') && t.length > 1 })),
  )
}
const title = computed(() => {
  const t = item.value?.title?.trim()
  const x = item.value?.text?.trim()
  if (!t) return null
  // 抖音的 title 只是正文开头，和正文重复时只显示正文
  return x && x !== t && x.startsWith(t) ? null : t
})
const textSegs = computed(() => {
  const x = item.value?.text
  if (x && title.value && x.trim() === title.value) return []
  return segments(x)
})
const published = computed(() => {
  const iso = item.value?.created_at
  if (!iso) return ''
  const s = since(iso)
  // 一个月以上 since 给的是日期（同 format.ts 的 since）
  return Date.now() - Date.parse(iso) >= 43_200 * 60_000 ? t('detail.published.on', { date: s }) : t('detail.published.ago', { time: s })
})
const stats = computed(() => {
  const s = item.value?.stats
  const tor = torrent.value
  if (tor) {
    return [
      { key: 'seeders', label: t('detail.stat.seeders'), icon: ArrowUp, v: tor.seeders },
      { key: 'leechers', label: t('detail.stat.leechers'), icon: ArrowDown, v: tor.leechers },
      { key: 'files', label: t('detail.stat.files'), icon: Files, v: tor.files },
    ]
  }
  return [
    { key: 'likes', label: t('detail.stat.likes'), icon: Heart, v: s?.likes },
    { key: 'collects', label: t('detail.stat.collects'), icon: Star, v: s?.collects },
    { key: 'comments', label: t('detail.stat.comments'), icon: MessageCircle, v: s?.comments },
    { key: 'shares', label: t('detail.stat.shares'), icon: Share2, v: s?.shares },
  ]
})
/** 纯文字底板里的时间（本地时间到分）与计数；评论数已在评论区标题里 */
const faceTime = computed(() => {
  const iso = item.value?.created_at
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})
const faceStats = computed(() => stats.value.filter((s) => s.key !== 'comments' && s.v != null))
const authorHandle = computed(() => [platform.value?.name, published.value].filter(Boolean).join(' · '))
/** 头部的作者：平台支持时点了关闭详情、进入站内的作者页（AGENTS.md 7.9「作者页」）；⌘ / Ctrl / Shift / 中键仍是原主页外链 */
const authors = useAuthorStore()
const authorLink = computed(() => Boolean(cur.value && authors.refOf(item.value?.author) && authors.canOpen(cur.value.platform)))
function onAuthor(e: MouseEvent | KeyboardEvent) {
  if (!authorLink.value || !cur.value) return
  if (e instanceof MouseEvent && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
  e.preventDefault()
  const platform = cur.value.platform
  const author = item.value?.author
  close()
  authors.open(platform, author)
}

// ---------- 键盘：Esc 关闭；W / S、↑ / ↓ 上一条 / 下一条；A / D、← / → 切图或快退快进；空格播放 ----------
const modified = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey
function onKey(e: KeyboardEvent) {
  if (!cur.value || !target.value || verify.open || dlMenu.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, [contenteditable="true"]')) return
  if (e.key === ' ' && el?.closest('button, a')) return
  if (modified(e)) return
  const up = e.code === 'KeyW' || e.key === 'ArrowUp'
  if (up || e.code === 'KeyS' || e.key === 'ArrowDown') {
    e.preventDefault()
    if (!e.repeat) go(up ? -1 : 1)
    return
  }
  if (media.value?.keydown(e)) e.preventDefault()
}
function onKeyUp(e: KeyboardEvent) {
  if (!cur.value || !target.value) return
  if (media.value?.keyup(e)) e.preventDefault()
}

// ---------- 全屏时下滑关闭 ----------
const swipe = useDetailSwipe({
  sheet,
  scrim,
  follow: floatClose,
  enabled: () => isCompact.value && settled.value,
  onClose: () => close(),
})

onMounted(() => {
  addEventListener('keydown', onKey)
  addEventListener('keyup', onKeyUp)
})
onBeforeUnmount(() => {
  removeEventListener('keydown', onKey)
  removeEventListener('keyup', onKeyUp)
  clearTimeout(loadTimer)
  token++
  abortLoads()
  io?.disconnect()
  tl?.kill()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="cur && item" class="detail" :class="{ compact: isCompact, landscape, 'text-only': textOnly }">
      <div ref="scrim" class="scrim" @click="close" />
      <img ref="ghost" class="ghost" :src="imgSrc(item.cover ?? undefined)" alt="" referrerpolicy="no-referrer" />

      <article
        ref="sheet"
        class="sheet"
 :class="{ settled }"
        :style="sheetStyle"
 role="dialog"
        aria-modal="true"
        :aria-label="title ?? item.text ?? t('detail.dialog')"
      >
        <DetailMedia v-if="!textOnly" ref="media" :item="mediaItem" :platform="cur.platform" :active="active" :loading="loadingItem" :fullscreen="isCompact" />

        <section ref="panel" class="panel">
   <header class="head rv">
     <div v-if="torrent" class="author nolink">
       <span v-if="torrent.discount" class="t-badge mono" :class="{ free: torrent.free }">{{ torrent.discount }}</span>
       <span class="who">
         <strong>{{ torrent.size ?? t('detail.torrent.fallback') }}</strong>
         <small>{{ published || platform?.name }}</small>
       </span>
     </div>
     <div v-else-if="show" class="author nolink">
       <UserAvatar v-if="show.author" class="ava" :user="show.author" :style="{ background: tintOf(show.author.id) }" />
       <span class="who">
         <strong>{{ show.performers ?? show.category ?? t('detail.show.fallback') }}</strong>
         <small>{{ [show.performers ? show.category : null, show.city].filter(Boolean).join(' · ') || platform?.name }}</small>
       </span>
     </div>
     <a
       v-else
       class="author"
       :href="item.author?.url ?? undefined"
       target="_blank"
       rel="noopener noreferrer"
       :class="{ nolink: !item.author?.url && !authorLink }"
       :role="authorLink && !item.author?.url ? 'link' : undefined"
       :tabindex="authorLink && !item.author?.url ? 0 : undefined"
       @click="onAuthor"
       @keydown.enter="onAuthor"
     >
       <UserAvatar class="ava" :user="item.author" :style="{ background: tintOf(item.author?.id) }" />
       <span class="who">
  <strong>{{ item.author?.name ?? t('detail.author.unknown') }}</strong>
         <small>{{ authorHandle }}</small>
       </span>
            </a>
     <button
       v-if="rawEnabled"
       class="origin icon"
       :class="{ on: rawView }"
       type="button"
       :aria-pressed="rawView"
       :aria-label="t('detail.head.raw')"
       :title="rawView ? t('detail.head.rawBack') : t('detail.head.rawOpen')"
       @click="toggleRaw"
     >
       <Braces :size="14" />
     </button>
     <span class="split">
     <button
       class="origin icon left"
       type="button"
       :aria-label="dl === 'done' ? t('detail.head.downloaded') : t('common.action.download')"
       :disabled="dl === 'busy'"
       :title="dl === 'done' ? t('detail.head.downloadedTip') : t('detail.head.downloadTip')"
       @click="download"
     >
       <CatbusLoader v-if="dl === 'busy'" :size="14" :label="t('detail.head.downloading')" />
       <Check v-else-if="dl === 'done'" :size="14" />
       <Download v-else :size="14" />
     </button>
     <button
       ref="dlMenuBtn"
       class="origin icon right"
       type="button"
       :aria-label="t('download.panel.open')"
       :title="t('download.panel.open')"
       :aria-expanded="dlMenu"
       @click="dlMenu = !dlMenu"
     >
       <ChevronDown :size="13" />
     </button>
     </span>
     <DownloadMenu :open="dlMenu" :anchor="dlMenuBtn ?? null" :platforms="cur ? [cur.platform] : []" @close="dlMenu = false" @download="download" />
     <a class="origin icon" :href="item.url" target="_blank" rel="noopener noreferrer" :aria-label="t('detail.head.origin')" :title="t('detail.head.openOn', { platform: platform?.name ?? t('detail.head.platform') })">
       <ExternalLink :size="14" />
     </a>
     <button v-if="!isCompact || textOnly" ref="closeBtn" class="close" type="button" :aria-label="t('common.action.close')" :title="t('detail.closeTip')" @click="close"><X :size="18" /></button>
          </header>

   <div ref="body" class="body">
     <RawJsonView v-if="rawView" :value="raw" :loading="rawLoading" :error="rawError" @retry="loadRaw" />
     <template v-else>
     <!-- 纯文字：正文放进与列表卡同色的引号底板，时间和计数也在底板里（设计稿 I） -->
     <div v-if="textOnly && plain" class="face rv" :class="{ short: [...(item.text ?? '')].length <= 40 }" :style="{ '--tint': faceTint }">
<span class="quote" aria-hidden="true">“</span>
       <h2 v-if="title" class="title">{{ title }}</h2>
       <p v-if="textSegs.length" class="text">
         <template v-for="(s, i) in textSegs" :key="i">
           <span v-if="s.tag" class="tag">{{ s.t }}</span>
    <EmojiText v-else :platform="cur?.platform ?? ''" :text="s.t" />
  </template>
       </p>
<div class="face-meta">
  <span class="mono">{{ faceTime }}</span>
         <span class="grow" />
         <span v-for="s in faceStats" :key="s.key" class="f-stat" :aria-label="t('detail.stat.aria', { n: s.v ?? 0, label: s.label })">
    <component :is="s.icon" :size="14" aria-hidden="true" />
    <span class="mono">{{ compact(s.v) }}</span>
  </span>
       </div>
     </div>
     <!-- 种子：中文名 + 种子名，简介按 BBCode 拆块渲染 -->
     <template v-if="torrent">
       <h2 class="title t-title rv">{{ torrent.title }}</h2>
       <p v-if="torrent.name" class="t-name mono rv">{{ torrent.name }}</p>
       <div v-if="descr.length" class="bb">
         <template v-for="(b, i) in descr" :key="i">
           <a v-if="b.type === 'img'" v-show="!badImgs.has(b.url)" class="bb-img" :href="b.url" target="_blank" rel="noopener noreferrer">
             <img :src="imgSrc(b.url)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="badImgs = new Set(badImgs).add(b.url)" />
           </a>
           <pre v-else-if="b.type === 'code'" class="bb-code mono">{{ b.text }}</pre>
           <blockquote v-else-if="b.type === 'quote'" class="bb-quote"><EmojiText platform="" :text="b.text" /></blockquote>
           <p v-else class="text"><EmojiText platform="" :text="b.text" /></p>
         </template>
       </div>
       <div v-else-if="loadingItem" class="lines rv" aria-hidden="true">
         <span /><span /><span class="short" />
       </div>
     </template>
     <!-- 演出：时间、场馆、票价各一行，下面是详情长图；不显示站点的售卖状态文案 -->
     <template v-if="show">
       <h2 v-if="item.title" class="title rv">{{ item.title }}</h2>
       <ul v-if="show.time || show.venue || show.city || show.prices.length" class="s-rows">
         <li v-if="show.time">
           <span class="s-ico"><Calendar :size="16" aria-hidden="true" /></span>
           <span class="s-col"><small>{{ t('detail.show.time') }}</small><strong>{{ show.time }}</strong></span>
         </li>
         <li v-if="show.venue || show.city">
           <span class="s-ico"><MapPin :size="16" aria-hidden="true" /></span>
           <span class="s-col">
             <small>{{ t('detail.show.venue') }}</small>
             <strong>{{ show.venue ?? show.city }}</strong>
             <span v-if="show.venue && (show.city || show.address)">{{ [show.city, show.address].filter(Boolean).join(' · ') }}</span>
           </span>
         </li>
         <li v-if="show.prices.length && !ticketsShown">
           <span class="s-ico"><Tags :size="16" aria-hidden="true" /></span>
           <span class="s-col">
             <small>{{ t('detail.show.prices') }}</small>
             <span class="s-chips"><b v-for="p in show.prices" :key="p" class="mono">¥{{ p }}</b></span>
           </span>
         </li>
       </ul>
       <div v-else-if="loadingItem" class="lines rv" aria-hidden="true">
         <span /><span /><span class="short" />
       </div>
       <!-- 场次与票档：点了才查（item get --tickets，需要登录） -->
       <div class="divider" />
       <ShowTickets :platform="cur.platform" :item="cur.item" :account="cur.account" />
       <template v-if="showImages.length">
         <div class="divider" />
         <p class="count">{{ t('detail.show.images') }}</p>
         <div class="bb">
           <a v-for="u in showImages" v-show="!badImgs.has(u)" :key="u" class="bb-img" :href="u" target="_blank" rel="noopener noreferrer">
             <img :src="imgSrc(u)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="badImgs = new Set(badImgs).add(u)" />
           </a>
         </div>
       </template>
     </template>
     <h2 v-if="!textOnly && plain && title" class="title rv">{{ title }}</h2>
     <p v-if="!textOnly && plain && textSegs.length" class="text rv">
       <template v-for="(s, i) in textSegs" :key="i">
  <span v-if="s.tag" class="tag">{{ s.t }}</span>
         <EmojiText v-else :platform="cur?.platform ?? ''" :text="s.t" />
       </template>
     </p>
     <div v-else-if="!textOnly && plain && loadingItem" class="lines rv" aria-hidden="true">
<span /><span /><span class="short" />
     </div>
     <p v-if="itemError" class="inline-error rv" :title="errorDetail(itemError) ?? undefined">{{ t('detail.itemError', { error: errorTitle(itemError) }) }}</p>

     <RelatedRail
       v-if="plain"
       :platform="cur.platform"
       :id="cur.item.id"
       :item="detail ?? cur.item"
       :account="cur.account"
       :ready="!loadingItem && !loadingComments"
       :open="Boolean(target)"
       @pick="jump"
     />

            <template v-if="plain">
            <div v-if="!textOnly" class="divider rv" />
            <p class="count rv">
       {{ item.stats.comments != null ? t('comment.count', { n: number(item.stats.comments) }, item.stats.comments) : t('comment.title') }}
     </p>

     <ul class="comments">
       <li v-for="c in comments" :key="c.id" class="comment">
         <UserAvatar class="ava sm" :user="c.author" :style="{ background: tintOf(c.author?.id) }" />
         <div class="c-body">
    <span class="c-name">{{ c.author?.name ?? t('comment.anonymous') }}</span>
    <p v-if="c.text" class="c-text"><EmojiText :platform="cur?.platform ?? ''" :text="c.text" /></p>
    <CommentMedia :media="c.media" />
    <div class="c-meta">
      <span>{{ since(c.created_at) }}</span>
      <span class="grow" />
      <span v-if="c.stats.likes != null" class="c-like"><Heart :size="13" />{{ compact(c.stats.likes) }}</span>
    </div>
           <CommentThread :comment="c" :item="item" :platform="cur.platform" :account="cur.account" />
  </div>
       </li>
     </ul>

     <div v-if="loadingComments || (loadingItem && !comments.length)" class="c-skeleton" :aria-label="t('comment.loading')">
       <div v-for="i in comments.length ? 1 : 3" :key="i" class="sk-row"><span class="sk-ava" /><span class="sk-lines"><span /><span /></span></div>
     </div>
     <div v-else-if="commentError" class="c-error">
       <ShieldAlert :size="16" />
<span :title="errorDetail(commentError) ?? undefined">{{ errorTitle(commentError) }}</span>
       <button v-if="verifyUrlOf(commentError)" type="button" @click="verifyComments">{{ t('comment.verify') }}</button>
<button v-else type="button" @click="loadComments">{{ t('common.action.retry') }}</button>
     </div>
     <p v-else-if="!comments.length" class="c-empty">{{ t('comment.empty') }}</p>
     <p v-else-if="!commentMore" class="c-end mono">{{ t('comment.end') }}</p>
            <div ref="sentinel" class="sentinel" aria-hidden="true" />
            </template>
     </template>
          </div>

          <footer v-if="show" class="stats show rv">
     <span class="s-price"><template v-if="show.price"><strong class="mono">{{ show.price }}</strong><small>{{ t('detail.show.priceFrom') }}</small></template></span>
     <SaleCountdown :at="show.saleAt" :text="show.saleText" />
   </footer>
          <footer v-else-if="!textOnly || torrent" class="stats rv" :class="{ torrent: !!torrent }">
     <span v-for="s in stats" :key="s.key" class="stat" :aria-label="t('detail.stat.aria', { n: s.v ?? 0, label: s.label })">
       <component :is="s.icon" :size="18" aria-hidden="true" />
       <span class="mono">{{ compact(s.v) }}</span>
       <small v-if="torrent">{{ s.label }}</small>
     </span>
   </footer>
        </section>
      </article>
      <!-- 上一条 / 下一条：浮动卡片右侧；全屏时不显示（键盘仍可切换） -->
      <div v-if="!isCompact && cur.nav" class="step" :class="{ shown: navShown }" :style="stepStyle">
        <button type="button" :aria-label="t('detail.nav.prev')" :title="t('detail.nav.prevTip')" :disabled="!hasPrev" @click="go(-1)"><ChevronUp :size="20" /></button>
        <button type="button" :aria-label="t('detail.nav.next')" :title="t('detail.nav.nextTip')" :disabled="!hasNext" @click="go(1)"><ChevronDown :size="20" /></button>
      </div>
      <!-- 全屏时关闭按钮浮在媒体上（不随面板滚动），深色半透明底在亮暗主题下都看得清 -->
      <button v-if="isCompact && !textOnly" ref="floatClose" class="float-close" type="button" :aria-label="t('common.action.close')" :title="t('detail.closeTip')" @click="close">
        <X :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.detail {
  position: fixed;
  inset: 0;
  z-index: 40;
}
.scrim {
  position: absolute;
  inset: 0;
  background: var(--detail-scrim);
  backdrop-filter: blur(8px);
}
.close {
  flex: none;
  width: 34px;
  height: 34px;
  margin-right: -6px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  transition: color 0.2s, background 0.2s, transform 0.25s var(--ease-out);
}
.close:hover {
  color: var(--ink);
  background: var(--detail-chip);
  transform: rotate(90deg);
}
.ghost {
  position: fixed;
  z-index: 2;
  display: none;
  object-fit: cover;
  pointer-events: none;
  box-shadow: 0 24px 64px #0b0e1a40;
  will-change: left, top, width, height;
}
.sheet {
  position: fixed;
  z-index: 1;
  display: grid;
  overflow: hidden;
  border-radius: 24px;
  background: var(--detail-bg);
  color: var(--ink);
  box-shadow: var(--detail-shadow);
}
/* 打开之后详情补全导致横竖屏切换时，平滑过渡到新尺寸 */
.sheet.settled {
  transition: left 0.45s var(--ease-out), top 0.45s var(--ease-out), width 0.45s var(--ease-out), height 0.45s var(--ease-out),
    grid-template-columns 0.45s var(--ease-out);
}
.panel {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--hair);
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--hair);
}
.author {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}
.author.nolink {
  pointer-events: none;
}
.author:hover strong {
  color: var(--red);
}
.ava {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 600;
  font-size: 16px;
  box-shadow: inset 0 0 0 2px #ffffff33;
}
.ava.sm {
  width: 32px;
  height: 32px;
  font-size: 13px;
}
.who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who strong {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}
.who small {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.origin {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border-radius: 18px;
  font-size: 13px;
  color: var(--ink-2);
  text-decoration: none;
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  transition: color 0.2s, border-color 0.2s;
}
.origin.icon {
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
}
.origin.icon.on {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 55%, transparent);
  background: color-mix(in srgb, var(--red) 10%, var(--detail-chip));
}
.origin.icon:has(.lucide-check) {
  color: var(--red);
}
.split {
  flex: none;
  display: inline-flex;
}
.split .left {
  border-radius: 18px 0 0 18px;
  border-right-width: 0;
}
.split .right {
  width: 22px;
  border-radius: 0 18px 18px 0;
  color: var(--ink-3);
}
.origin:disabled {
  cursor: progress;
}
.origin:hover {
  color: var(--red);
  border-color: var(--red);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 22px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
  overscroll-behavior: contain;
}
.title {
  margin: 0 0 10px;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.text {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.tag {
  color: var(--link);
}
/* ---------- 种子（M-Team，设计稿 L） ---------- */
.t-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--navy);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.t-badge.free {
  background: var(--red);
}
.t-title {
  margin-bottom: 6px;
}
.t-name {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
.bb {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.bb-img {
  display: block;
  overflow: hidden;
  border-radius: 12px;
  background: var(--hair);
}
.bb-img img {
  display: block;
  width: 100%;
  height: auto;
}
.bb-quote {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--red);
  border-radius: 10px;
  background: var(--hair);
  color: var(--ink-2);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bb-code {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--hair);
  border-radius: 10px;
  background: color-mix(in srgb, var(--hair) 50%, transparent);
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre;
  overflow-x: auto;
}
.stats.torrent {
  padding-inline: 40px;
}
.stat small {
  font-size: 12px;
  font-weight: 400;
  color: var(--ink-3);
}
/* ---------- 演出（猫眼演出，设计稿 N） ---------- */
.s-rows {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.s-rows li {
  display: flex;
  gap: 12px;
}
.s-ico {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--hair);
  color: var(--ink-2);
}
.s-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}
.s-col small {
  font-size: 12px;
  color: var(--ink-3);
}
.s-col strong {
  font-size: 14px;
  font-weight: 500;
}
.s-col > span {
  font-size: 12px;
  color: var(--ink-2);
}
.s-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.s-chips b {
  padding: 5px 10px;
  border: 1px solid var(--hair);
  border-radius: 8px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}
.stats.show {
  align-items: center;
  padding: 12px 22px;
}
.s-price {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.s-price strong {
  color: var(--red);
  font-size: 22px;
  font-weight: 700;
}
.s-price small {
  font-size: 12px;
  color: var(--ink-3);
}
.lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
}
.lines span,
.sk-lines span,
.sk-ava {
  display: block;
  height: 12px;
  border-radius: 6px;
  background: var(--skeleton);
  animation: shimmer 1.4s ease-in-out infinite;
}
.lines .short {
  width: 60%;
}
@keyframes shimmer {
  50% {
    opacity: 0.45;
  }
}
.inline-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.divider {
  height: 1px;
  margin: 18px 0 14px;
  background: var(--hair);
}
.count {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--ink-2);
}
.comments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.comment {
  display: flex;
  gap: 10px;
}
.c-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.c-name {
  font-size: 13px;
  color: var(--ink-3);
}
.c-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.c-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.c-like {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
}
.grow {
  flex: 1;
}
.c-skeleton {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 18px;
}
.comments:empty + .c-skeleton {
  margin-top: 0;
}
.sk-row {
  display: flex;
  gap: 10px;
}
.sk-ava {
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.sk-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 2px;
}
.sk-lines span:last-child {
  width: 70%;
}
.c-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--ink-2);
  background: var(--red-soft);
}
.c-error svg {
  flex: none;
  color: var(--red);
}
.c-error span {
  flex: 1;
  min-width: 0;
}
.c-error button {
  flex: none;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: #fff;
  background: var(--red);
}
.c-empty,
.c-end {
  margin: 20px 0 8px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
.sentinel {
  height: 1px;
}

.stats {
  display: flex;
  justify-content: space-between;
  padding: 16px 28px;
  border-top: 1px solid var(--hair);
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.stat svg {
  color: var(--ink-2);
}

/* 横屏：信息栏窄一些 */
.landscape .head {
  padding: 16px 18px;
}
.landscape .body {
  padding: 18px 18px 10px;
}
.landscape .stats {
  padding: 14px 20px;
}

/* 全屏（手机、竖屏平板等放不下浮动卡片时）：媒体在上，信息栏在下，整个面板一起滚动 */
.compact .sheet {
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: 0;
  box-shadow: none;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.compact .sheet::-webkit-scrollbar {
  display: none;
}
.compact .sheet.settled {
  transition: grid-template-rows 0.45s var(--ease-out);
}
.compact .panel {
  border-left: 0;
  border-top: 1px solid var(--hair);
}
.compact .head {
  padding: 14px max(16px, var(--safe-right)) 14px max(16px, var(--safe-left));
}
.compact .body {
  flex: 1 0 auto;
  min-height: auto;
  overflow: visible;
  padding: 16px max(16px, var(--safe-right)) 12px max(16px, var(--safe-left));
}
.compact .stats {
  position: sticky;
  bottom: 0;
  z-index: 1;
  padding: 12px max(24px, var(--safe-right)) calc(12px + var(--safe-bottom)) max(24px, var(--safe-left));
  background: var(--detail-bg);
}
/* 纯文字（设计稿 I）：单栏，高度随内容，上下 margin:auto 居中 */
.text-only .sheet {
  display: flex;
  flex-direction: column;
  height: fit-content;
  max-height: calc(100% - 80px);
  margin: auto 0;
}
.text-only .panel {
  flex: 1 1 auto;
  border-left: 0;
}
.text-only .head {
  padding: 20px 24px 16px;
  border-bottom: 0;
}
.text-only .body {
  flex: 1 1 auto;
  padding: 4px 24px 24px;
}
.face {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 22px 30px 20px;
  border-radius: 20px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 15%, transparent), color-mix(in srgb, var(--tint) 3%, transparent));
}
[data-theme='dark'] .face {
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 24%, transparent), color-mix(in srgb, var(--tint) 6%, transparent));
}
.face .quote {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  font-size: 64px;
  font-weight: 700;
  line-height: 0.8;
  height: 34px;
  color: color-mix(in srgb, var(--tint) 70%, transparent);
}
[data-theme='dark'] .face .quote {
  color: color-mix(in srgb, var(--tint) 55%, #c9cee6);
}
.face .title {
  margin: 0;
  font-size: 20px;
}
.face .text {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.7;
}
.face.short .text {
  font-size: 22px;
  line-height: 1.6;
}
.face-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.face-meta .grow {
  flex: 1;
}
.f-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-2);
}
.compact.text-only .sheet {
  display: block;
  max-height: none;
  margin: 0;
}
.compact .face {
  padding: 18px 20px 16px;
}
.compact .face.short .text {
  font-size: 19px;
}
.step {
  position: absolute;
  z-index: 2;
  top: 50%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  opacity: 0;
  pointer-events: none;
  transform: translate(6px, -50%);
  transition: opacity 0.25s, transform 0.35s var(--ease-out), left 0.45s var(--ease-out);
}
.step.shown {
  opacity: 1;
  pointer-events: auto;
  transform: translate(0, -50%);
}
.step button {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink);
  background: var(--detail-bg);
  border: 1px solid var(--hair);
  box-shadow: 0 6px 20px #0b0e1a33;
  transition: color 0.2s, border-color 0.2s, transform 0.2s var(--ease-out), opacity 0.2s;
}
.step button:hover:not(:disabled) {
  color: var(--red);
  border-color: var(--red);
  transform: scale(1.06);
}
.step button:disabled {
  opacity: 0.4;
  cursor: default;
}
.float-close {
  position: absolute;
  z-index: 3;
  top: calc(var(--safe-top) + 8px);
  left: calc(var(--safe-left) + 10px);
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: #0b0d148c;
  border: 1px solid #ffffff26;
  backdrop-filter: blur(12px);
  box-shadow: 0 2px 10px #0004;
}
.float-close:active {
  background: #0b0d14b3;
}

/* 手机：头像、字号略收 */
@media (max-width: 640px) {
  .title {
    font-size: 17px;
  }
  .text {
    font-size: 14px;
  }
  .ava {
    width: 36px;
    height: 36px;
  }
  .ava.sm,
  .sk-ava {
    width: 28px;
    height: 28px;
  }
  .comment {
    gap: 8px;
  }
  .comments {
    gap: 16px;
  }
  .c-name {
    overflow-wrap: anywhere;
  }
}

/* 触屏：没有悬停，可点区域至少 --tap */
@media (hover: none) and (pointer: coarse) {
  .origin {
    min-height: var(--tap);
  }
  .origin.icon {
    width: var(--tap);
    height: var(--tap);
  }
  .close {
    width: var(--tap);
    height: var(--tap);
  }
  .close:hover {
    transform: none;
  }
  .c-error button {
    min-height: 36px;
    padding: 6px 14px;
  }
}
</style>
