import { nextTick } from 'vue'
import { useDownloadsStore } from '@/stores/downloads'
import { prefersReducedMotion } from '@/composables/motion'

/*
 * 下载投递动画（AGENTS.md 7.9「下载投递动画与角标」）：像加入购物车一样，从卡片（或详情卡片的媒体）
 * 飞出一张缩略图，沿抛物线落进下载列表按钮，按钮回弹、角标出现。
 * 目标是页面上「看得见」的下载列表按钮（带 data-dl-target）：吸顶时顶栏的按钮在视口外，
 * 先把 flying 加一，让发现页吸顶的筛选栏里出现下载列表按钮，等它过渡出来再飞。
 */

/** 最多飞几张：批量下载选了很多时只飞前几张，错开出发 */
const MAX = 6
const STAGGER = 70
const DURATION = 720
/** 吸顶筛选栏里的下载列表按钮出现的过渡时长（DiscoverView 的 .mini-dl），等它到位再飞 */
const APPEAR = 260

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 看得见的下载列表按钮：在视口里、没被藏起来（被盖住的发现页是 inert + visibility: hidden） */
export function findTarget(): HTMLElement | null {
  const vw = innerWidth
  const vh = innerHeight
  for (const el of document.querySelectorAll<HTMLElement>('[data-dl-target]')) {
    if (el.closest('[inert]')) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue
    const visible = typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      : getComputedStyle(el).visibility !== 'hidden'
    if (visible) return el
  }
  return null
}

/** 二次贝塞尔上的点：控制点在起点和终点上方，形成抛物线 */
export function arc(from: { x: number; y: number }, to: { x: number; y: number }, steps = 24) {
  const lift = Math.max(80, Math.abs(to.x - from.x) * 0.25)
  const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift }
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pts.push({ x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y })
  }
  return pts
}

/** 起飞用的缩略图：取源元素里的封面图，没有封面时是一块品牌红的圆角方块 */
function ghostOf(source: Element, size: number, cover?: string): HTMLElement {
  const img = source.querySelector('img') as HTMLImageElement | null
  const src = cover || img?.currentSrc || img?.src
  const g = document.createElement(src ? 'img' : 'div')
  if (g instanceof HTMLImageElement) {
    g.src = src!
    g.alt = ''
    g.referrerPolicy = 'no-referrer'
    g.decoding = 'sync'
  }
  Object.assign(g.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${size}px`,
    height: `${size}px`,
    objectFit: 'cover',
    borderRadius: '14px',
    background: 'var(--red)',
    boxShadow: '0 10px 28px #23283840',
    pointerEvents: 'none',
    zIndex: '10000',
    willChange: 'transform, opacity',
  } satisfies Partial<CSSStyleDeclaration>)
  g.setAttribute('aria-hidden', 'true')
  return g
}

function flyOne({ el: source, cover }: Source, target: HTMLElement, delay: number, onLand: () => void): Promise<void> {
  const sr = source.getBoundingClientRect()
  const tr = target.getBoundingClientRect()
  // 缩略图从源元素中心出发，不超过 120px；落到按钮中心时缩到约 18px
  const size = Math.max(36, Math.min(120, sr.width * 0.6, sr.height * 0.6))
  const from = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 }
  const to = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 }
  const end = 18 / size
  const pts = arc(from, to)
  const g = ghostOf(source, size, cover)
  document.body.appendChild(g)
  const n = pts.length - 1
  const frames: Keyframe[] = pts.map((p, i) => {
    const t = i / n
    // 先略微放大（被拿起来），再一路缩小，最后几帧淡出
    const s = t < 0.15 ? 1 + t * 0.6 : 1.09 + (end - 1.09) * ((t - 0.15) / 0.85)
    return {
      offset: t,
      transform: `translate(${p.x - size / 2}px, ${p.y - size / 2}px) scale(${s}) rotate(${t * -12}deg)`,
      opacity: t > 0.88 ? (1 - t) / 0.12 : 1,
      borderRadius: `${14 + t * 40}%`,
    }
  })
  frames[0]!.borderRadius = '14px'
  const anim = g.animate(frames, { duration: DURATION, delay, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'both' })
  return anim.finished
    .catch(() => undefined)
    .then(() => {
      g.remove()
      onLand()
    })
}

/** 起飞的元素；cover 给出时用它当缩略图（详情卡片的视频没有 <img>） */
export type Source = { el: Element; cover?: string }

/**
 * 从这些元素（卡片、详情卡片的媒体）投递到下载列表按钮。下载已经提交之后调用。
 * 减少动效、或者页面上没有看得见的下载列表按钮时不飞，角标照常出现。
 */
export async function flyToDownloads(sources: (Element | Source | null | undefined)[]): Promise<void> {
  const dl = useDownloadsStore()
  const list = sources
    .map((s) => (s instanceof Element ? { el: s } : s))
    .filter((s): s is Source => !!s && s.el.isConnected)
    .slice(0, MAX)
  if (!list.length || prefersReducedMotion()) return
  dl.flying++
  dl.hold = true
  try {
    let target = findTarget()
    if (!target) {
      // 吸顶时筛选栏里的下载列表按钮因 flying 出现：等它渲染、过渡到位
      await nextTick()
      await wait(APPEAR)
      target = findTarget()
    }
    if (!target) return
    let landed = false
    await Promise.all(
      list.map((s, i) =>
        flyOne(s, target!, i * STAGGER, () => {
          if (!landed) {
            landed = true
            dl.hold = false
          }
          dl.landTick++
        }),
      ),
    )
  } finally {
    dl.hold = false
    dl.flying--
  }
}

const inView = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
}

/**
 * 批量下载：从选中的卡片里在视口内的那几张飞出（封面优先，纯文字卡用整张卡）；
 * 选中的卡片都滚出了视口时，从点下的下载按钮（from）飞出。
 */
export function flyItems(items: { id: string }[], from?: Element | null): Promise<void> {
  const ids = new Set(items.map((it) => it.id))
  const cards = [...document.querySelectorAll<HTMLElement>('.card[data-id]')].filter(
    (el) => ids.has(el.dataset.id!) && !el.closest('[inert]') && inView(el),
  )
  const sources = cards.map((el) => el.querySelector('.cover') ?? el)
  if (!sources.length && from && inView(from)) sources.push(from)
  return flyToDownloads(sources)
}
