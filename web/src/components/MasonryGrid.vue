<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { gsap, prefersReducedMotion } from '@/composables/motion'

/**
 * 瀑布流：按封面宽高比估算高度，依次放进当前最矮的一列。
 * 同样的顺序总是得到同样的分配，所以追加下一页时已有的卡片不会跳动。
 *
 * 每一格（`Cell`）外面包一层 `.cell`：格子的 key 不变时这层元素也不变，里面是卡片，或渠道还在加载时的骨架占位。
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
const width = ref(0)
let ro: ResizeObserver | undefined

onMounted(() => {
  ro = new ResizeObserver(([e]) => (width.value = e!.contentRect.width))
  ro.observe(root.value!)
})
onBeforeUnmount(() => ro?.disconnect())

const count = computed(() =>
  Math.min(6, Math.max(bp.phone ? 2 : 1, Math.floor((width.value + gap.value) / (minColumn.value + gap.value)))),
)

function ratioOf(item: Item): number {
  // 纯文字卡没有封面，高度跟着正文走：按每行约 14 字、最多 8 行估算（MediaCard 的 .face）
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
  return (item.cover ? 0.23 : 0) + meta
}

/** 骨架占位的宽高比：按格子的序号在这几个值里轮流取，同一格每次都一样 */
const SKELETONS = [0.75, 1, 0.8, 1.25, 0.7, 0.9, 1.1, 0.8, 0.75, 1, 0.66, 0.85]
const skeletonRatio = (key: string) => SKELETONS[(Number(key.slice(key.lastIndexOf('#') + 1)) || 0) % SKELETONS.length]!

/** 渠道图标依次弹出的间隔；只错开最前面的一屏，后面的一起出 */
const ICON_STAGGER_MS = 32
const ICON_STAGGER_MAX = 18

const columns = computed(() => {
  const cols = Array.from({ length: count.value }, () => ({ h: 0, cells: [] as { cell: Cell; ratio: number; delay: number }[] }))
  props.cells.forEach((cell, i) => {
    const ratio = cell.item ? ratioOf(cell.item) : skeletonRatio(cell.key)
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a))
    col.cells.push({ cell, ratio, delay: Math.min(i, ICON_STAGGER_MAX) * ICON_STAGGER_MS })
    col.h += 1 / ratio + (cell.item ? footer(cell.item) : 0.35) // 标题和作者行的大致高度（以列宽为单位）
  })
  return cols
})

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
  return root.value?.closest<HTMLElement>('.discover') ?? null
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
  const platform = discover.platformOf(item)
  return { platform, account: discover.accountFor(platform)?.account ?? null }
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
      loadMore: () => void discover.loadMore(),
      hasMore: () => discover.hasMore,
    },
  })
}

// ---------- 布局变化的动效（FLIP） ----------
// 换密度、聚合模式加减渠道、占位换成卡片时，格子的位置和高度会变：
// 更新前记下每一格在屏幕上的位置，更新后让它从旧位置滑到新位置。
// - 留下来的格子：平移（列宽变了时连同缩放）；
// - 占位换成了卡片、而且变高了：自上而下展开，和下面被挤下去的卡片同步；
// - 新出现的格子：依次浮现；
// - 聚合模式里被拿走的格子：留一个残影在原位淡出。
// 只动视口附近的格子，远处的直接到位。

type Shot = { el: HTMLElement; key: string; rect: DOMRect; skeleton: boolean }
let shots: { list: Shot[]; byEl: WeakMap<Element, Shot>; byKey: Map<string, Shot>; aggregate: boolean } | null = null

const flipKey = (cell: Cell) => (cell.item ? `${cell.platform}:${cell.item.id}` : cell.key)
const cellEls = () => [...(root.value?.querySelectorAll<HTMLElement>('.cell') ?? [])]
const layout = () => [settings.density, props.cells, count.value] as const
const MOVE = { duration: 0.75, ease: 'expo.out' }
const MAX_GHOSTS = 36

watch(
  layout,
  () => {
    shots = null
    if (prefersReducedMotion() || !root.value) return
    const list = cellEls().map((el) => ({
      el,
      key: el.dataset.flip!,
      rect: el.getBoundingClientRect(),
      skeleton: el.dataset.skeleton != null,
    }))
    shots = {
      list,
      byEl: new WeakMap(list.map((s) => [s.el, s])),
      byKey: new Map(list.map((s) => [s.key, s])),
      aggregate: !!props.aggregate,
    }
  },
  { flush: 'pre' },
)
watch(
  layout,
  () => {
    const old = shots
    shots = null
    if (!old || !root.value) return
    const els = cellEls()
    // 上一次的动效可能还没走完：先停掉、清掉变换，量到的才是新布局里的真实位置
    gsap.killTweensOf(els)
    gsap.set(els, { clearProps: 'transform,transformOrigin,clipPath,opacity,filter' })
    const view = scroller()?.getBoundingClientRect()
    const near = (r: DOMRect) => !view || (r.bottom > view.top - 240 && r.top < view.bottom + 240)
    const now = els.map((el) => ({ el, rect: el.getBoundingClientRect() }))
    const radius = bp.phone ? 14 : 20
    const fresh: HTMLElement[] = []
    let moved = false

    for (const { el, rect: b } of now) {
      const shot = old.byEl.get(el) ?? old.byKey.get(el.dataset.flip!)
      if (!shot) {
        if (near(b)) fresh.push(el)
        continue
      }
      const a = shot.rect
      if (!near(a) && !near(b)) continue
      const dx = a.left - b.left
      const dy = a.top - b.top
      const k = a.width / b.width
      // 占位换成卡片后多出来的高度：先裁掉，再随动效展开
      const grow = shot.skeleton && el.dataset.skeleton == null ? b.height - a.height / k : 0
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(k - 1) < 0.01 && grow <= 1) continue
      moved = true
      const from: gsap.TweenVars = { x: dx, y: dy, scaleX: k, scaleY: k, transformOrigin: '0 0' }
      const to: gsap.TweenVars = { x: 0, y: 0, scaleX: 1, scaleY: 1, ...MOVE, clearProps: 'transform,transformOrigin,clipPath' }
      if (grow > 1) {
        from.clipPath = `inset(0px 0px ${grow}px 0px round ${radius}px)`
        to.clipPath = `inset(0px 0px 0px 0px round ${radius}px)`
      }
      // 越靠下的越晚一点动身，整片像被依次推开
      if (view) to.delay = Math.min(1, Math.max(0, (b.top - view.top) / view.height)) * 0.1
      gsap.fromTo(el, from, to)
    }

    if (fresh.length) {
      const top = new Map(now.map((n) => [n.el, n.rect]))
      fresh.sort((x, y) => top.get(x)!.top - top.get(y)!.top || top.get(x)!.left - top.get(y)!.left)
      gsap.fromTo(
        fresh,
        { y: moved ? 0 : 26, scale: moved ? 0.86 : 0.96, opacity: 0, filter: 'blur(8px)' },
        {
          y: 0,
          scale: 1,
          opacity: 1,
          filter: 'blur(0px)',
          duration: 0.7,
          ease: 'power3.out',
          // 别的格子在让位时，新格子等它们动起来再出现
          delay: moved ? 0.1 : 0,
          stagger: Math.min(0.04, 0.6 / fresh.length),
          clearProps: 'transform,opacity,filter',
        },
      )
    }

    if (old.aggregate || props.aggregate) leaveGhosts(old.list, new Set(els.map((el) => el.dataset.flip!)), near)
  },
  { flush: 'post' },
)

/** 被拿走的格子：把旧元素的副本放回原位，淡出后移除（真正的元素已经不在了） */
function leaveGhosts(list: Shot[], kept: Set<string>, near: (r: DOMRect) => boolean) {
  const host = root.value
  if (!host) return
  const origin = host.getBoundingClientRect()
  const gone = list.filter((s) => !kept.has(s.key) && near(s.rect)).slice(0, MAX_GHOSTS)
  for (const { el, rect } of gone) {
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-flip')
    ghost.classList.replace('cell', 'ghost')
    ghost.setAttribute('aria-hidden', 'true')
    Object.assign(ghost.style, {
      left: `${rect.left - origin.left}px`,
      top: `${rect.top - origin.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
    host.appendChild(ghost)
    gsap.to(ghost, { opacity: 0, scale: 0.9, filter: 'blur(6px)', duration: 0.32, ease: 'power2.in', onComplete: () => ghost.remove() })
  }
}
onBeforeUnmount(() => root.value?.querySelectorAll('.ghost').forEach((g) => g.remove()))
</script>

<template>
  <div
    ref="root"
    class="masonry"
    :class="{ stale }"
    :style="{ gap: `${gap}px` }"
    :aria-busy="loading"
    :inert="stale || undefined"
    @pointerdown.capture="onDownCapture"
    @click.capture="onClickCapture"
    @contextmenu="onContextMenu"
  >
    <template v-if="loading && !cells.length">
      <div v-for="c in count" :key="`s${c}`" class="col" :style="{ gap: `${gap}px` }">
        <SkeletonCard v-for="(r, i) in SKELETONS.filter((_, j) => j % count === c - 1)" :key="i" :ratio="r" />
      </div>
    </template>
    <template v-else>
      <div v-for="(col, c) in columns" :key="c" class="col" :style="{ gap: `${gap}px` }">
        <div
          v-for="{ cell, ratio, delay } in col.cells"
          :key="cell.key"
          class="cell"
          :data-flip="flipKey(cell)"
          :data-skeleton="cell.item ? undefined : ''"
          :style="{ '--chan-delay': `${delay}ms` }"
        >
          <MediaCard
            v-if="cell.item"
            :key="cell.item.id"
            :item="cell.item"
            :ratio="ratio"
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
            <SkeletonCard v-if="!cell.item" :ratio="ratio" :channel="platformById(cell.platform)" busy />
          </Transition>
        </div>
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
.cell {
  position: relative;
  min-width: 0;
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
