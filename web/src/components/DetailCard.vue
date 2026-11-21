<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link2, Braces, Check, ChevronDown, ChevronUp, CircleAlert, Download, ExternalLink, X } from 'lucide-vue-next'
import DetailMedia from './DetailMedia.vue'
import DetailAuthor from './detail/DetailAuthor.vue'
import DetailFooter from './detail/DetailFooter.vue'
import PlainBody from './detail/PlainBody.vue'
import TorrentBody from './detail/TorrentBody.vue'
import ShowBody from './detail/ShowBody.vue'
import DetailMeta from './detail/DetailMeta.vue'
import { torrentInfo } from '@/composables/torrent'
import { showInfo } from '@/composables/show'
import CatbusLoader from './CatbusLoader.vue'
import { listMedia } from '@/api/extras'
import { useDiscoverStore } from '@/stores/discover'
import { copyText, toast as toastMsg } from '@/stores/toast'
import GlassButton from '@/components/ui/GlassButton.vue'
import { toCommand } from '@/composables/command'
import { getRawItem } from '@/api/raw'
import { useSettingsStore } from '@/stores/settings'
import { getItem, isAbort, listComments, imgSrc } from '@/api/client'
import BookmarkButton from '@/components/local/BookmarkButton.vue'
import { useLocalStore } from '@/stores/local'
import { flyToDownloads } from '@/composables/flyToDownloads'
import type { CatbusError, Comment, Item } from '@/api/types'
import { platformById } from '@/data/platforms'
import { errorTitle } from '@/i18n/errors'
import { resetReplyQueue } from '@/composables/replyQueue'
import { cancelRelated } from '@/composables/useRelated'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { storeToRefs } from 'pinia'
import { useDetailStore, type DetailTarget } from '@/stores/detail'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useDetailSwipe } from '@/composables/useDetailSwipe'
import { useDownloadsStore } from '@/stores/downloads'
import DownloadMenu from './DownloadMenu.vue'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { openVerify, useVerifyStore, verifyUrlOf } from '@/stores/verify'

// 原始 JSON 视图只在打开实验性设置、点了 {} 之后才用到
const RawJsonView = defineAsyncComponent(() => import('./RawJsonView.vue'))

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
// ---------- 本地收藏（AGENTS.md 7.9「本地收藏与稍后看」） ----------
const local = useLocalStore()
/** 取详情时这些错误表示原内容已经不可用 */
const GONE_CODES = ['UPSTREAM']
const localGroups = computed(() => {
  const c = cur.value
  const e = c ? local.entry(c.platform, c.item.id) : null
  return e ? local.allGroups.filter((g) => e.groups.includes(g.id)) : null
})
function openLocalMenu(e: MouseEvent) {
  const c = cur.value
  if (c) local.openMenu(c.platform, item.value ?? c.item, e.currentTarget as Element)
}
/**
 * 三套内容（AGENTS.md 7.9）：普通条目（PlainBody：作者、正文、评论、互动数）、
 * 种子（TorrentBody，M-Team，设计稿 L）、演出（ShowBody，猫眼演出，设计稿 N）。
 * 头部左侧（DetailAuthor）和底部（DetailFooter）也按这三种换内容；本组件只管外壳、动效、数据和切换。
 */
const torrent = computed(() => torrentInfo(item.value, cur.value?.item))
const show = computed(() => showInfo(item.value, cur.value?.item, cur.value?.platform))
/** 正文组件：换条目时复位它自己的状态（评论筛选、加载失败的图片） */
const content = ref<{ reset: () => void }>()
/** 演出的 media 是详情长图，放在正文里；左侧只放海报 */
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
  const from = document.activeElement
  try {
    // 种子：item get 的 text 是整段简介，中文名取列表里那一条的 text
    const target = it.kind === 'torrent' ? { ...it, text: c.item.text ?? it.text } : it
    await downloads.start(c.platform, c.account, [target], commentsSupported(c.platform))
    // 投递动画：从媒体区飞进下载列表按钮；纯文字的从下载按钮飞出（AGENTS.md 7.9「下载投递动画与角标」）
    const el = (media.value?.$el as Element | undefined) ?? from
    void flyToDownloads([el && { el, cover: it.cover ? imgSrc(it.cover) : undefined }])
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
const landscape = computed(() => !textOnly.value && ratio.value >= 1.2)
/** 头部放一行：只有浮在页面上、宽度够的纯文字卡（作者名还能留出约 20 个字），其余分两行 */
const headOneRow = computed(() => textOnly.value && !isCompact.value && geo.value.width >= 600)
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
  content.value?.reset()
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
    else {
      itemError.value = env.error
      // 本地收藏里的条目在平台上已经取不到：卡片上标出「原内容已不可用」（AGENTS.md 7.9「本地收藏与稍后看」）
      if (env.error && GONE_CODES.includes(env.error.code)) local.markGone(t.platform, t.item.id)
    }
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

/** 评论区的滚动容器：浮动卡片是 .body，全屏是整个面板（PlainBody 在里面观察滚到底） */
const scroller = computed(() => (isCompact.value ? sheet.value : body.value))

function verifyComments() {
  const t = cur.value
  if (!t || !commentError.value) return
  openVerify({ platform: t.platform, url: verifyUrlOf(commentError.value), message: errorTitle(commentError.value), retry: loadComments })
}

// ---------- 展示 ----------
const title = computed(() => {
  const t = item.value?.title?.trim()
  const x = item.value?.text?.trim()
  if (!t) return null
  // 抖音的 title 只是正文开头，和正文重复时只显示正文
  return x && x !== t && x.startsWith(t) ? null : t
})

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
  tl?.kill()
})

/** 这一条所属平台的能力（字幕、弹幕、媒体链接，AGENTS.md 7.9） */
const discoverStore = useDiscoverStore()
const caps = computed(() => (cur.value ? (discoverStore.filters?.[cur.value.platform] ?? null) : null))
const mediaBusy = ref(false)
/** 取不到链接时的原因：写在菜单里按钮下面（带警示图标），菜单不收起 */
const mediaNote = ref('')
watch(dlMenu, (open) => {
  if (open) mediaNote.value = ''
})
async function copyMediaLinks() {
  const c = cur.value
  if (!c || mediaBusy.value) return
  mediaBusy.value = true
  mediaNote.value = ''
  let done = false
  try {
    const env = await listMedia(c.platform, c.item, c.account)
    const urls = env.ok ? (env.data ?? []).map((m) => m.url).filter((u): u is string => !!u) : []
    if (!env.ok) mediaNote.value = t('detail.extras.mediaFailed', { error: errorTitle(env.error!) })
    else if (!urls.length) mediaNote.value = t('detail.extras.noMedia')
    else if (await copyText(urls.join('\n'))) {
      toastMsg(t('detail.extras.mediaCopied', { n: urls.length }, urls.length), 4200)
      done = true
    }
  } catch (e) {
    mediaNote.value = (e as Error).message
  } finally {
    mediaBusy.value = false
    if (done) dlMenu.value = false
  }
}

/** 复制等价命令（AGENTS.md 7.9「复制等价命令」）：这一条的 item get */
const detailCommand = computed(() => {
  const c = cur.value
  if (!c) return ''
  const argv = [c.platform, 'item', 'get', c.item.url || c.item.id]
  if (c.account) argv.push('-a', c.account)
  return toCommand(argv, 1)
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
        <DetailMedia v-if="!textOnly" ref="media" :item="mediaItem" :platform="cur.platform" :active="active" :loading="loadingItem" :fullscreen="isCompact" :account="cur.account" />

        <section ref="panel" class="panel">
   <header class="head rv" :class="{ 'one-row': headOneRow }">
     <DetailAuthor :item="item" :platform="cur.platform" :platform-name="platform?.name" :torrent="torrent" :show="show" />
     <!-- 操作按钮：信息栏窄，单独占第二行，第一行留给作者和关闭（AGENTS.md 7.9「详情卡片 · 布局」） -->
     <div class="acts">
     <GlassButton
       v-if="rawEnabled"
       icon
       :pressed="rawView"
       :aria-label="t('detail.head.raw')"
       :title="rawView ? t('detail.head.rawBack') : t('detail.head.rawOpen')"
       @click="toggleRaw"
     >
       <Braces :size="14" />
     </GlassButton>
     <span class="split lg-split">
     <GlassButton
       class="sp-l"
       :class="{ 'is-done': dl === 'done' }"
       :aria-label="dl === 'done' ? t('detail.head.downloaded') : t('common.action.download')"
       :disabled="dl === 'busy'"
       :title="dl === 'done' ? t('detail.head.downloadedTip') : t('detail.head.downloadTip')"
       @click="download"
     >
       <CatbusLoader v-if="dl === 'busy'" :size="14" :label="t('detail.head.downloading')" />
       <Check v-else-if="dl === 'done'" :size="14" />
       <Download v-else :size="14" />
     </GlassButton>
     <!-- 原生 button：ref 要给 DownloadMenu 当定位锚点（HTMLElement） -->
     <button
       ref="dlMenuBtn"
       class="lg-btn sp-r"
       type="button"
       :aria-label="t('download.panel.open')"
       :title="t('download.panel.open')"
       :aria-expanded="dlMenu"
       @click="dlMenu = !dlMenu"
     >
       <ChevronDown :size="13" />
     </button>
     </span>
     <DownloadMenu :open="dlMenu" :anchor="dlMenuBtn ?? null" :platforms="cur ? [cur.platform] : []" @close="dlMenu = false" @download="download">
       <template v-if="caps?.media" #extra>
         <GlassButton tone="quiet" class="media-links" :disabled="mediaBusy" @click="copyMediaLinks">
           <Link2 :size="14" aria-hidden="true" />{{ mediaBusy ? t('common.state.loading') : t('detail.extras.copyMedia') }}
         </GlassButton>
         <p v-if="mediaNote" class="media-note" role="status"><CircleAlert :size="14" aria-hidden="true" />{{ mediaNote }}</p>
       </template>
     </DownloadMenu>
     <BookmarkButton v-if="cur" :platform="cur.platform" :item="item" variant="detail" />
     <a class="lg-btn lg-icon" :href="item.url" target="_blank" rel="noopener noreferrer" :aria-label="t('detail.head.origin')" :title="t('detail.head.openOn', { platform: platform?.name ?? t('detail.head.platform') })">
       <ExternalLink :size="14" />
     </a>
     </div>
     <button v-if="!isCompact || textOnly" ref="closeBtn" class="lg-btn lg-icon hd-close" type="button" :aria-label="t('common.action.close')" :title="t('detail.closeTip')" @click="close"><X :size="18" /></button>
          </header>

   <div ref="body" class="body">
     <RawJsonView v-if="rawView" :value="raw" :loading="rawLoading" :error="rawError" @retry="loadRaw" />
     <template v-else>
     <!-- 已在本地收藏：列出所在分组（设计稿 Z7） -->
     <div v-if="localGroups" class="local-tags rv">
       <span class="lt-label">{{ t('local.detail.saved') }}</span>
       <GlassButton v-for="g in localGroups" :key="g.id" tone="accent" size="sm" @click="openLocalMenu">{{ g.name }}</GlassButton>
       <GlassButton v-if="!localGroups.length" size="sm" @click="openLocalMenu">{{ t('local.toast.toGroup') }}</GlassButton>
     </div>
     <!-- 正文按种类换：种子（设计稿 L）、演出（设计稿 N）、普通条目；等价命令和错误提示在正文之后 -->
     <TorrentBody v-if="torrent" ref="content" :torrent="torrent" :detail="detail" :loading="loadingItem">
       <DetailMeta :command="detailCommand" :error="itemError" />
     </TorrentBody>
     <ShowBody
       v-else-if="show"
       ref="content"
       :show="show"
       :item="item"
       :platform="cur.platform"
       :list-item="cur.item"
       :account="cur.account"
       :loading="loadingItem"
     >
       <DetailMeta :command="detailCommand" :error="itemError" />
     </ShowBody>
     <PlainBody
       v-else
       ref="content"
       :target="cur"
       :item="item"
       :detail="detail"
       :title="title"
       :text-only="textOnly"
       :loading="loadingItem"
       :comments="comments"
       :loading-comments="loadingComments"
       :comment-more="commentMore"
       :comment-error="commentError"
       :caps="caps"
       :open="Boolean(target)"
       :scroller="scroller ?? undefined"
       @more="loadComments"
       @verify="verifyComments"
       @pick="jump"
     >
       <DetailMeta :command="detailCommand" :error="itemError" />
     </PlainBody>
     </template>
          </div>

          <DetailFooter v-if="show || !textOnly || torrent" :item="item" :torrent="torrent" :show="show" />
        </section>
      </article>
      <!-- 上一条 / 下一条：浮动卡片右侧；全屏时不显示（键盘仍可切换） -->
      <div v-if="!isCompact && cur.nav" class="step" :class="{ shown: navShown }" :style="stepStyle">
        <GlassButton icon size="lg" :aria-label="t('detail.nav.prev')" :title="t('detail.nav.prevTip')" :disabled="!hasPrev" @click="go(-1)"><ChevronUp :size="20" /></GlassButton>
        <GlassButton icon size="lg" :aria-label="t('detail.nav.next')" :title="t('detail.nav.nextTip')" :disabled="!hasNext" @click="go(1)"><ChevronDown :size="20" /></GlassButton>
      </div>
      <!-- 全屏时关闭按钮浮在媒体上（不随面板滚动），深色半透明底在亮暗主题下都看得清 -->
      <button v-if="isCompact && !textOnly" ref="floatClose" class="lg-btn lg-icon lg-media float-close" type="button" :aria-label="t('common.action.close')" :title="t('detail.closeTip')" @click="close">
        <X :size="20" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.media-links {
  --lg-h: 36px;
  justify-content: flex-start;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 0 12px;
}
.media-note {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 6px 12px 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-2);
}
.media-note svg {
  flex: none;
  margin-top: 2px;
  color: var(--warn);
}
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
/* 关闭：外观来自 lg-btn，悬停时 × 转半圈 */
.hd-close svg {
  transition: transform 0.25s var(--ease-out);
}
.hd-close:hover svg {
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
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--hair);
}
/* 操作按钮换到第二行（order 排在关闭按钮之后），作者名就有整行的宽度 */
.acts {
  order: 1;
  flex: 1 0 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
/* 浮在页面上、够宽的纯文字单栏卡片：按钮和作者放在一行 */
.head.one-row .acts {
  order: 0;
  flex: none;
}
.local-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.lt-label {
  font-size: 12px;
  color: var(--ink-3);
}
/* 下载分体按钮：外形来自 lg-split（styles/glass-button.css），这里只定两半的宽度 */
.split .lg-btn {
  padding: 0;
}
.split .sp-l {
  width: 34px;
}
.split .sp-l.is-done {
  --lg-fg: var(--lg-accent-ink);
}
.split .sp-l:disabled {
  cursor: progress;
}
.split .sp-r {
  width: 24px;
  min-width: 24px;
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
/* 横屏：信息栏窄一些 */
.landscape .head {
  padding: 16px 18px;
}
.landscape .body {
  padding: 18px 18px 10px;
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
.compact.text-only .sheet {
  display: block;
  max-height: none;
  margin: 0;
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
.step .lg-btn {
  --lg-h: 44px;
  --lg-fg: var(--ink);
}
.step .lg-btn:hover:not(:disabled) {
  --lg-fg: var(--red);
}
.float-close {
  position: absolute;
  z-index: 3;
  top: calc(var(--safe-top) + 8px);
  left: calc(var(--safe-left) + 10px);
  --lg-h: var(--tap);
}

/* 触屏：没有悬停，可点区域至少 --tap */
@media (hover: none) and (pointer: coarse) {
  .split .sp-l {
    width: var(--tap);
  }
  .split .sp-r {
    width: 32px;
    min-width: 32px;
  }
  .hd-close:hover svg {
    transform: none;
  }
}
</style>
