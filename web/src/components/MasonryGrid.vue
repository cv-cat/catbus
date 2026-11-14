<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MediaCard from './MediaCard.vue'
import SkeletonCard from './SkeletonCard.vue'
import type { Item } from '@/api/types'
import type { Cell } from '@/stores/lanes'
import { platformById } from '@/data/platforms'
import { useSelectionStore } from '@/stores/selection'
import { useDiscoverStore } from '@/stores/discover'
import { useDetailStore } from '@/stores/detail'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useSettingsStore, type Density } from '@/stores/settings'
import { prefersReducedMotion } from '@/composables/motion'

/**
 * 瀑布流：按封面宽高比估算高度，依次放进当前最矮的一列。
 * 同样的顺序总是得到同样的分配，所以追加下一页时已有的卡片不会跳动。
 *
 * 每一格（`Cell`）外面包一层 `.cell`：格子的 key 不变时这层元素也不变，里面是卡片，或渠道还在加载时的骨架占位。
 * 所有 `.cell` 都是 `.masonry` 下的同级节点（一个扁平的 keyed 列表），绝对定位：
 * 列由上面的估算决定，每列里的 top 按量到的真实高度（ResizeObserver）累加，容器高度取最高的一列。
 * 所以格子换列、换顺序时组件实例和 DOM 节点都不变，只改 left / top。
 * 格子换了位置（聚合模式加、减渠道，换密度）时，从旧位置平滑移到新位置（FLIP）。
 */
const props = defineProps<{
  cells: Cell[]
  loading?: boolean
  /** 聚合模式：卡片左上角显示渠道图标 */
  aggregate?: boolean
  /** 同一渠道里重新请求中：旧卡片变淡、不可点击、不可选择，新结果回来后淡回 */
  stale?: boolean
  minColumn?: number
  gap?: number
  /** 列表不是发现页的（作者页）：详情卡片的平台、账号和翻页按它来；不给时用发现页的 */
  feed?: { targetOf: (item: Item) => { platform: string; account: string | null }; loadMore: () => void; hasMore: () => boolean }
}>()

/**
 * 最小列宽和列间距随断点和卡片密度（设置 › 显示 › density）变：
 * 标准档即原来的值（手机稳定 2 列，平板 3 列左右，桌面 240）；紧凑档列更多、间距更小，宽松档反之。
 */
const bp = useBreakpoint()
const settings = useSettingsStore().settings
const COLUMN: Record<Density, { phone: number; tablet: number; desktop: number }> = {
  compact: { phone: 104, tablet: 150, desktop: 190 },
  standard: { phone: 140, tablet: 190, desktop: 240 },
  cozy: { phone: 220, tablet: 240, desktop: 300 },
}
const GAP: Record<Density, { phone: number; tablet: number; desktop: number }> = {
  compact: { phone: 8, tablet: 10, desktop: 12 },
  standard: { phone: 10, tablet: 14, desktop: 16 },
  cozy: { phone: 12, tablet: 18, desktop: 20 },
}
const size = computed(() => (bp.phone ? 'phone' : bp.tablet ? 'tablet' : 'desktop'))
const gap = computed(() => props.gap ?? GAP[settings.density][size.value])
const minColumn = computed(() => props.minColumn ?? COLUMN[settings.density][size.value])

const root = ref<HTMLElement>()
/** 量宽度用的零高度元素：直接量 .masonry 的话，它的高度随排版变，会在 ResizeObserver 里引出一轮多余的通知 */
const sizer = ref<HTMLElement>()
const width = ref(0)
let ro: ResizeObserver | undefined

onMounted(() => {
  width.value = sizer.value!.clientWidth
  ro = new ResizeObserver(([e]) => (width.value = e!.contentRect.width))
  ro.observe(sizer.value!)
  void nextTick(() => relayout(false))
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cellRo.disconnect()
})

const count = computed(() =>
  Math.min(6, Math.max(bp.phone ? 2 : 1, Math.floor((width.value + gap.value) / (minColumn.value + gap.value)))),
)
const colWidth = computed(() => Math.max(0, (width.value - gap.value * (count.value - 1)) / count.value))

function ratioOf(item: Item, platform?: string): number {
  if (platform === 'maoyan' && item.cover) return 0.72 // 演出海报
  // 纯文字卡没有封面，高度跟着正文走：按每行约 14 字、最多 8 行估算（MediaCard 的 .face）
  if (item.kind === 'torrent') return item.cover ? 0.68 : 1 / 0.12 // 种子：海报 2:3；没有封面时只有标签一行（MediaCard 的 .tags）
  if (!item.cover) {
    const len = (item.title || item.text || '').length
    const lines = len <= 24 ? 2 : Math.min(8, Math.ceil(len / 14))
    return 1 / (0.28 + lines * 0.085)
  }
  const m = item.media.find((x) => x.width && x.height)
  const r = m ? m.width! / m.height! : item.kind === 'video' ? 0.75 : 0.8
  return Math.min(1.6, Math.max(0.6, r)) // 极端比例收一收，避免一张图占满一列
}

/** 卡片底部（标题 + 作者 / 互动行）的大致高度；纯文字卡没有标题行，作者和互动都关掉时整行不占位 */
function footer(item: Item): number {
  const meta = 0.12
  if (item.kind === 'torrent') return 0.34 + meta // 中文名 + 两行种子名
  return (item.cover ? 0.23 : 0) + meta
}

/** 骨架占位的宽高比：按格子的序号在这几个值里轮流取，同一格每次都一样 */
const SKELETONS = [0.75, 1, 0.8, 1.25, 0.7, 0.9, 1.1, 0.8, 0.75, 1, 0.66, 0.85]
const skeletonRatio = (key: string) => SKELETONS[(Number(key.slice(key.lastIndexOf('#') + 1)) || 0) % SKELETONS.length]!

/** 每一格放在哪一列、封面比例和估算高度（以列宽为单位）：只由顺序和条目决定，不看量到的高度 */
const placement = computed(() => {
  const h = Array.from({ length: count.value }, () => 0)
  const out = new Map<string, { col: number; ratio: number; est: number }>()
  for (const cell of props.cells) {
    const ratio = cell.item ? ratioOf(cell.item, cell.platform) : skeletonRatio(cell.key)
    let col = 0
    for (let c = 1; c < h.length; c++) if (h[c]! < h[col]!) col = c
    const est = 1 / ratio + (cell.item ? footer(cell.item) : 0.35) // 标题和作者行的大致高度
    out.set(cell.key, { col, ratio, est })
    h[col]! += est
  }
  return out
})
const ratioFor = (key: string) => placement.value.get(key)?.ratio ?? 1

/**
 * DOM 里的顺序：已有的格子保持原来的先后，新格子接在最后。
 * 聚合模式重排时只改 left / top，不挪动节点（挪动节点会让里面的 CSS 动画重播、图片重新解码）。
 * 单一模式里一直是追加，DOM 顺序就是显示顺序。
 */
let domOrder: string[] = []
const rendered = computed(() => {
  const by = new Map(props.cells.map((c) => [c.key, c]))
  const out: Cell[] = []
  for (const k of domOrder) {
    const c = by.get(k)
    if (c) {
      out.push(c)
      by.delete(k)
    }
  }
  for (const c of props.cells) if (by.has(c.key)) out.push(c)
  domOrder = out.map((c) => c.key)
  return out
})

/**
 * 渠道图标依次弹出的延迟：格子第一次在聚合模式里出现时按这一批里的先后定下来，之后不再变
 * （变了的话 CSS 动画会按新的延迟重播）；离开聚合模式时清空。只错开最前面的一屏，后面的一起出。
 */
const ICON_STAGGER_MS = 32
const ICON_STAGGER_MAX = 18
const chanDelay = new Map<string, string>()
watch(
  () => [props.cells, props.aggregate] as const,
  ([cells, aggregate]) => {
    if (!aggregate) return chanDelay.clear()
    const keep = new Set(cells.map((c) => c.key))
    for (const k of chanDelay.keys()) if (!keep.has(k)) chanDelay.delete(k)
    let n = 0
    for (const c of cells) if (!chanDelay.has(c.key)) chanDelay.set(c.key, `${Math.min(n++, ICON_STAGGER_MAX) * ICON_STAGGER_MS}ms`)
  },
  { immediate: true, flush: 'pre' },
)

/** 列表里的条目（不含骨架占位），顺序即显示顺序：连选、详情的上一条 / 下一条都按它 */
const items = computed(() => props.cells.flatMap((c) => (c.item ? [c.item] : [])))

// ---------- 多选 ----------
// 鼠标：按下选择框单击切换，按住拖动按条目顺序连续选择（同 iOS 相册）；选择模式下按下卡片也一样。
// 触屏：点选择框切换；长按卡片进入选择模式并选中它；选择模式下点卡片切换。不做拖动连选（会和滚动冲突）。

const sel = useSelectionStore()
const indexOf = computed(() => new Map(items.value.map((it, i) => [it.id, i])))

/** 拖动中：起点、起点要变成的状态、按下时的选择快照、指针位置 */
let drag: { anchor: number; on: boolean; base: Set<string>; x: number; y: number; last: number } | null = null
let raf = 0
/** 拖动刚结束时吞掉紧跟着的 click，避免打开链接 */
let swallowUntil = 0

function scroller(): HTMLElement | null {
  return root.value?.closest<HTMLElement>('.discover, .author-page') ?? null
}

function apply(current: number) {
  if (!drag || current === drag.last) return
  drag.last = current
  const [lo, hi] = drag.anchor < current ? [drag.anchor, current] : [current, drag.anchor]
  const next = new Set(drag.base)
  for (let i = lo; i <= hi; i++) {
    const id = items.value[i]!.id
    drag.on ? next.add(id) : next.delete(id)
  }
  sel.set(next)
}

function hitTest() {
  if (!drag) return
  const el = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('.card[data-id]')
  const i = el && root.value?.contains(el) ? indexOf.value.get(el.dataset.id!) : undefined
  if (i != null) apply(i)
}

/** 指针靠近滚动区上下边缘时自动滚动，越靠边越快 */
function autoScroll() {
  const box = scroller()
  if (!drag || !box) return
  const r = box.getBoundingClientRect()
  const EDGE = 80
  let v = 0
  if (drag.y > r.bottom - EDGE) v = Math.min(1, (drag.y - (r.bottom - EDGE)) / EDGE)
  else if (drag.y < r.top + EDGE) v = -Math.min(1, (r.top + EDGE - drag.y) / EDGE)
  if (v) {
    box.scrollTop += v * 22
    hitTest()
  }
  raf = requestAnimationFrame(autoScroll)
}

function onMove(e: PointerEvent) {
  if (!drag) return
  drag.x = e.clientX
  drag.y = e.clientY
  hitTest()
}

function onUp() {
  drag = null
  cancelAnimationFrame(raf)
  swallowUntil = performance.now() + 400
  document.documentElement.classList.remove('drag-selecting')
  removeEventListener('pointermove', onMove)
  removeEventListener('pointerup', onUp)
  removeEventListener('pointercancel', onUp)
}

function onPick(item: Item, e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  const anchor = indexOf.value.get(item.id)
  if (anchor == null) return
  e.preventDefault()
  const base = new Set(sel.selected)
  drag = { anchor, on: !base.has(item.id), base, x: e.clientX, y: e.clientY, last: -1 }
  apply(anchor)
  document.documentElement.classList.add('drag-selecting')
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onUp)
  raf = requestAnimationFrame(autoScroll)
}

/** 最近一次按下用的指针：click 事件本身不一定带 pointerType */
let lastPointer = ''
function onDownCapture(e: PointerEvent) {
  lastPointer = e.pointerType
}

// 长按：约 450ms 不动（移动不超过 10px）进入选择模式并选中；滚动开始时浏览器发 pointercancel，长按随之取消
const LONG_PRESS_MS = 450
const LONG_PRESS_SLOP = 10
let press: { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null

function endPress() {
  if (!press) return
  clearTimeout(press.timer)
  press = null
  removeEventListener('pointermove', onPressMove)
  removeEventListener('pointerup', endPress)
  removeEventListener('pointercancel', endPress)
}
function onPressMove(e: PointerEvent) {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) endPress()
}
function onPress(item: Item, e: PointerEvent) {
  if (e.pointerType === 'mouse' || !e.isPrimary) return
  endPress()
  press = {
    id: item.id,
    x: e.clientX,
    y: e.clientY,
    timer: setTimeout(() => {
      const id = press!.id
      endPress()
      if (!sel.has(id)) sel.toggle(id)
      navigator.vibrate?.(10)
      // 松手后紧跟着的 click 不打开详情、也不再切换一次
      swallowUntil = performance.now() + 700
    }, LONG_PRESS_MS),
  }
  addEventListener('pointermove', onPressMove, { passive: true })
  addEventListener('pointerup', endPress)
  addEventListener('pointercancel', endPress)
}

/**
 * 点击：拖动 / 长按刚结束时吞掉；选择模式下点卡片不打开链接。
 * 触屏上点选择框、或选择模式下点卡片，在这里切换（鼠标在按下时已经切换过了）。
 */
function onClickCapture(e: MouseEvent) {
  const target = e.target as HTMLElement
  const card = target.closest<HTMLElement>('.card[data-id]')
  if (!card) return
  if (performance.now() < swallowUntil) {
    e.preventDefault()
    e.stopPropagation()
    return
  }
  const touchLike = lastPointer !== '' && lastPointer !== 'mouse' && e.detail !== 0
  const onCheck = !!target.closest('.check')
  if (touchLike && (onCheck || sel.active)) {
    e.preventDefault()
    e.stopPropagation()
    sel.toggle(card.dataset.id!)
    return
  }
  if (sel.active) e.preventDefault()
}
/** 触屏长按会弹出系统的链接菜单：在卡片上屏蔽 */
function onContextMenu(e: MouseEvent) {
  if (lastPointer !== 'mouse' && (e.target as HTMLElement).closest('.card')) e.preventDefault()
}
onBeforeUnmount(() => {
  onUp()
  endPress()
})

const discover = useDiscoverStore()
const detail = useDetailStore()
/** 条目所属的平台和浏览它用的账号（聚合模式下每条都可能不同） */
function targetOf(item: Item) {
  if (props.feed) return props.feed.targetOf(item)
  const platform = discover.platformOf(item)
  return { platform, account: discover.accountOf(item, platform) }
}
function onOpen(item: Item, el: HTMLElement) {
  detail.open({
    item,
    ...targetOf(item),
    source: el,
    nav: {
      items: () => items.value,
      targetOf,
      sourceOf: (id) => root.value?.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(id)}"]`) ?? null,
      loadMore: () => void (props.feed ? props.feed.loadMore() : discover.loadMore()),
      hasMore: () => (props.feed ? props.feed.hasMore() : discover.hasMore),
    },
  })
}

// ---------- 排版 ----------
// relayout()：量新格子（或列宽变了时全部格子）的真实高度，按 placement 的列逐列累加出 top，写进 left / top。
// 高度只取决于列宽，和 top 无关，所以写位置不会再触发 ResizeObserver，不会量 → 排 → 再量地循环。
// 之后高度再变（字体、互动数据开关、图片失败换成纯文字卡等），由 cellRo 量到后重排（不做动效）。

type Pos = { x: number; y: number; w: number; h: number }
type Placed = Pos & { el: HTMLElement; key: string; flip: string; skeleton: boolean }

const flipKey = (cell: Cell) => (cell.item ? `${cell.platform}:${cell.item.id}` : cell.key)

/** key → 元素（模板里的函数 ref 维护） */
const elOf = new Map<string, HTMLElement>()
/** key → 量到的高度和量的时候格子里装的是什么（条目 id，占位为空串）；列宽变了全部作废 */
const heights = new Map<string, { h: number; sig: string }>()
const sigOf = (cell: Cell) => cell.item?.id ?? ''
let measuredAt = -1
/** 上一次排好的位置（不含动效里的位移），按 key 和 flipKey 都能找 */
let prev: { byKey: Map<string, Placed>; byFlip: Map<string, Placed>; aggregate: boolean } | null = null

const cellRo = new ResizeObserver((entries) => {
  let changed = false
  for (const e of entries) {
    const key = (e.target as HTMLElement).dataset.key
    if (!key || !elOf.has(key)) continue
    const h = e.borderBoxSize?.[0]?.blockSize ?? (e.target as HTMLElement).offsetHeight
    const old = heights.get(key)
    if (old && Math.abs(old.h - h) >= 1) {
      old.h = h
      changed = true
    }
  }
  if (changed) relayout(false)
})

function bindCell(key: string, el: unknown) {
  if (el instanceof HTMLElement) {
    if (elOf.get(key) === el) return
    const old = elOf.get(key)
    if (old) cellRo.unobserve(old)
    elOf.set(key, el)
    cellRo.observe(el)
  } else {
    const old = elOf.get(key)
    if (old) cellRo.unobserve(old)
    elOf.delete(key)
    heights.delete(key)
  }
}

// ---------- 布局变化的动效（FLIP） ----------
// 换密度、聚合模式加减渠道、占位换成卡片时，格子的位置和高度会变：位置是自己算的，旧位置就在 prev 里，不用读 DOM。
// - 留下来的格子：平移（列宽变了时连同缩放）；
// - 占位换成了卡片、而且变高了：自上而下展开，和下面被挤下去的卡片同步；
// - 新出现的格子：依次浮现；
// - 聚合模式里被拿走的格子：留一个残影在原位淡出。
// 只动视口附近的格子，远处的直接到位；只在末尾追加、已有格子都没动时不做位移。
// 动效用 Web Animations（el.animate），不往元素上写内联样式，结束后什么都不用清；
// 下一次排版只取消上一次动过的那些。

const EXPO_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const POWER3_OUT = 'cubic-bezier(0.215, 0.61, 0.355, 1)'
const POWER2_IN = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)'
const MOVE_MS = 750
const MAX_GHOSTS = 36
const NEAR = 240

/** 上一次动过的格子：位移动效（打断时要接着当前的位置走）和浮现动效 */
const moving = new Map<HTMLElement, Animation>()
const appearing = new Set<Animation>()

function relayout(animate: boolean) {
  const host = root.value
  if (!host) return
  const cells = props.cells
  if (!cells.length) {
    host.style.height = ''
    prev = { byKey: new Map(), byFlip: new Map(), aggregate: !!props.aggregate }
    return
  }
  animate = animate && !!prev && !prefersReducedMotion()
  const colW = colWidth.value
  const g = gap.value

  // 1. 打断进行中的位移：记下它现在实际在哪（只读上一次动过的那些），再停掉
  const inflight = new Map<HTMLElement, { dx: number; dy: number; k: number }>()
  if (animate)
    for (const [el, anim] of moving) {
      if (anim.playState !== 'running' || !el.isConnected) continue
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
      if (!m.isIdentity) inflight.set(el, { dx: m.m41, dy: m.m42, k: m.a })
    }
  for (const a of moving.values()) a.cancel()
  moving.clear()
  for (const a of appearing) a.cancel()
  appearing.clear()

  // 2. 量高度：列宽变了全部重量，否则只量还没量过的和换了内容的（占位换成卡片等；先读完再写）
  if (Math.abs(colW - measuredAt) > 0.01) {
    heights.clear()
    measuredAt = colW
  }
  const place = placement.value
  for (const cell of cells) {
    const sig = sigOf(cell)
    if (heights.get(cell.key)?.sig === sig) continue
    const el = elOf.get(cell.key)
    heights.set(cell.key, { h: el ? el.offsetHeight : (place.get(cell.key)?.est ?? 1) * colW, sig })
  }

  // 3. 逐列累加
  const tops = Array.from({ length: count.value }, () => 0)
  const now: Placed[] = []
  for (const cell of cells) {
    const el = elOf.get(cell.key)
    const p = place.get(cell.key)
    if (!el || !p) continue
    const h = heights.get(cell.key)!.h
    const col = Math.min(p.col, tops.length - 1)
    now.push({ el, key: cell.key, flip: flipKey(cell), skeleton: !cell.item, x: col * (colW + g), y: tops[col]!, w: colW, h })
    tops[col]! += h + g
  }
  const total = Math.max(0, Math.max(...tops) - g)

  // 4. 视口在网格里的范围（排版前读，读完再写）
  let view: { top: number; bottom: number } | null = null
  const old = prev
  if (animate) {
    const box = scroller()?.getBoundingClientRect()
    const r = host.getBoundingClientRect()
    if (box) view = { top: box.top - r.top, bottom: box.bottom - r.top }
  }
  const near = (p: { y: number; h: number }) => !view || (p.y + p.h > view.top - NEAR && p.y < view.bottom + NEAR)

  // 5. 写位置
  for (const p of now) {
    const s = p.el.style
    const left = `${p.x}px`
    const top = `${p.y}px`
    if (s.left !== left) s.left = left
    if (s.top !== top) s.top = top
  }
  host.style.height = `${total}px`

  prev = {
    byKey: new Map(now.map((p) => [p.key, p])),
    byFlip: new Map(now.map((p) => [p.flip, p])),
    aggregate: !!props.aggregate,
  }
  if (!animate || !old) return

  // 6. 动效
  const radius = bp.phone ? 14 : 20
  const fresh: Placed[] = []
  let moved = false
  for (const b of now) {
    const a = old.byKey.get(b.key) ?? old.byFlip.get(b.flip)
    if (!a) {
      if (near(b)) fresh.push(b)
      continue
    }
    if (!near(a) && !near(b)) continue
    // 上一次的位移被打断：从它当时实际所在的位置接着走
    const cur = a.el === b.el ? inflight.get(b.el) : undefined
    const ax = a.x + (cur?.dx ?? 0)
    const ay = a.y + (cur?.dy ?? 0)
    const aw = a.w * (cur?.k ?? 1)
    const dx = ax - b.x
    const dy = ay - b.y
    const k = aw / b.w
    // 占位换成卡片后多出来的高度：先裁掉，再随动效展开
    const grow = a.skeleton && !b.skeleton ? b.h - a.h / k : 0
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(k - 1) < 0.01 && grow <= 1) continue
    moved = true
    const from: Keyframe = { transform: `translate(${dx}px, ${dy}px) scale(${k})`, transformOrigin: '0 0' }
    const to: Keyframe = { transform: 'none', transformOrigin: '0 0' }
    if (grow > 1) {
      from.clipPath = `inset(0px 0px ${grow}px 0px round ${radius}px)`
      to.clipPath = `inset(0px 0px 0px 0px round ${radius}px)`
    }
    // 越靠下的越晚一点动身，整片像被依次推开
    const delay = view ? Math.min(1, Math.max(0, (b.y - view.top) / (view.bottom - view.top || 1))) * 100 : 0
    moving.set(b.el, b.el.animate([from, to], { duration: MOVE_MS, easing: EXPO_OUT, delay, fill: 'backwards' }))
  }

  if (fresh.length) {
    fresh.sort((x, y) => x.y - y.y || x.x - y.x)
    const stagger = Math.min(40, 600 / fresh.length)
    const lift = moved ? 0 : 26
    const scale = moved ? 0.86 : 0.96
    fresh.forEach((p, i) => {
      const anim = p.el.animate(
        [
          { transform: `translateY(${lift}px) scale(${scale})`, opacity: 0, filter: 'blur(8px)' },
          { transform: 'none', opacity: 1, filter: 'blur(0px)' },
        ],
        // 别的格子在让位时，新格子等它们动起来再出现
        { duration: 700, easing: POWER3_OUT, delay: (moved ? 100 : 0) + i * stagger, fill: 'backwards' },
      )
      appearing.add(anim)
      anim.onfinish = () => appearing.delete(anim)
    })
  }

  if (old.aggregate || props.aggregate) leaveGhosts(host, [...old.byKey.values()], near)
}

/** 被拿走的格子：把旧元素的副本放回原位，淡出后移除（真正的元素已经不在了） */
function leaveGhosts(host: HTMLElement, list: Placed[], near: (p: Pos) => boolean) {
  const kept = prev!.byFlip
  const keptKeys = prev!.byKey
  const gone = list.filter((s) => !keptKeys.has(s.key) && !kept.has(s.flip) && near(s)).slice(0, MAX_GHOSTS)
  for (const s of gone) {
    const ghost = s.el.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-key')
    ghost.classList.replace('cell', 'ghost')
    ghost.setAttribute('aria-hidden', 'true')
    Object.assign(ghost.style, { left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px` })
    host.appendChild(ghost)
    ghost
      .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.9)', filter: 'blur(6px)' }], {
        duration: 320,
        easing: POWER2_IN,
        fill: 'forwards',
      })
      .finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      )
  }
}

watch(
  () => [props.cells, colWidth.value, gap.value, count.value] as const,
  () => relayout(true),
  { flush: 'post' },
)
onBeforeUnmount(() => root.value?.querySelectorAll('.ghost').forEach((g) => g.remove()))
</script>

<template>
  <div
    ref="root"
    class="masonry"
    :class="{ stale, flat: !(loading && !cells.length) }"
    :style="{ gap: `${gap}px`, '--col-w': `${colWidth}px` }"
    :aria-busy="loading"
    :inert="stale || undefined"
    @pointerdown.capture="onDownCapture"
    @click.capture="onClickCapture"
    @contextmenu="onContextMenu"
  >
    <div ref="sizer" class="sizer" aria-hidden="true" />
    <template v-if="loading && !cells.length">
      <div v-for="c in count" :key="`s${c}`" class="col" :style="{ gap: `${gap}px` }">
        <SkeletonCard v-for="(r, i) in SKELETONS.filter((_, j) => j % count === c - 1)" :key="i" :ratio="r" />
      </div>
    </template>
    <template v-else>
      <div
        v-for="cell in rendered"
        :key="cell.key"
        :ref="(el) => bindCell(cell.key, el)"
        class="cell"
        :data-key="cell.key"
        :data-skeleton="cell.item ? undefined : ''"
        :style="{ '--chan-delay': chanDelay.get(cell.key) }"
      >
        <MediaCard
          v-if="cell.item"
          :key="cell.item.id"
          :item="cell.item"
          :ratio="ratioFor(cell.key)"
          :platform="cell.platform"
          :channel="aggregate ? platformById(cell.platform) : undefined"
          :selected="sel.selected.has(cell.item.id)"
          :selecting="sel.active"
          @pick="onPick(cell.item, $event)"
          @press="onPress(cell.item, $event)"
          @open="onOpen(cell.item, $event)"
        />
        <!-- 占位换成卡片：骨架盖在卡片上淡出 -->
        <Transition name="sk">
          <SkeletonCard v-if="!cell.item" :ratio="ratioFor(cell.key)" :channel="platformById(cell.platform)" busy />
        </Transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.masonry {
  position: relative;
  display: flex;
  align-items: flex-start;
}
/* 扁平排版：格子绝对定位，left / top 由脚本写（relayout），容器高度取最高的一列 */
.masonry.flat {
  display: block;
  /* 格子都脱离了文档流，父元素是 flex 列（作者页）时不能被压扁 */
  flex-shrink: 0;
}
.sizer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 0;
  pointer-events: none;
  visibility: hidden;
}
.cell {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--col-w);
  min-width: 0;
  /* 位置的过渡由脚本（FLIP）做；减少动效时全局样式给所有元素一个极短的 transition-duration，
     默认的 transition-property: all 会让每次改 left / top 都生成一个过渡，这里关掉 */
  transition-property: none;
}
.sk-leave-active {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  transition: opacity 0.45s ease-out;
}
.sk-leave-to {
  opacity: 0;
}
/* 被拿走的格子的残影（脚本里克隆出来的，见 leaveGhosts） */
.ghost {
  position: absolute;
  z-index: 1;
  margin: 0;
  pointer-events: none;
}
.masonry {
  transition: opacity 0.25s ease-out;
}
/* 旧结果：整体变淡，暂时不能点、不能选（inert 同时挡住键盘焦点） */
.masonry.stale {
  opacity: 0.5;
  pointer-events: none;
  transition-duration: 0.2s;
}
@media (prefers-reduced-motion: reduce) {
  .masonry {
    transition: none;
  }
}
.col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
:global(html.drag-selecting),
:global(html.drag-selecting *) {
  user-select: none !important;
  cursor: grabbing !important;
}
</style>
