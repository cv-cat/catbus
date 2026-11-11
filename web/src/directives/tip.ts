import type { Directive } from 'vue'
import { MQ } from '@/composables/useBreakpoint'

/**
 * v-tip：鼠标移入 / 键盘聚焦时显示的提示。全页只有一个浮层，挂在 body 上，不受父级 overflow 裁剪。
 * - `v-tip="文字"`：总是显示
 * - `v-tip.overflow="文字"`：只有元素里的文字被截断（显示省略号）时才显示
 * 默认在元素上方，放不下时翻到下方，并收在视口里。
 * 触屏（MQ.touch）上不显示：手指点按会模拟出 mouseenter / focus，不能让浮层残留。
 */

type Value = string | null | undefined
interface State {
  text: Value
  overflow: boolean
  enter: () => void
  leave: () => void
}

const DELAY = 280
const GAP = 8
const EDGE = 8

let el: HTMLDivElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let owner: HTMLElement | null = null
const states = new WeakMap<HTMLElement, State>()

/** 主要输入是手指的设备，或者刚刚用手指点过（混合设备）：不显示提示 */
let touchMq: MediaQueryList | null = null
let lastTouch = 0
const touchLike = () => {
  touchMq ??= typeof matchMedia === 'function' ? matchMedia(MQ.touch) : null
  return Boolean(touchMq?.matches) || performance.now() - lastTouch < 800
}

function bubble(): HTMLDivElement {
  if (el) return el
  el = document.createElement('div')
  el.className = 'catbus-tip'
  el.setAttribute('role', 'tooltip')
  el.id = 'catbus-tip'
  document.body.appendChild(el)
  return el
}

const truncated = (target: HTMLElement) =>
  target.scrollWidth > target.clientWidth + 1 || target.scrollHeight > target.clientHeight + 1

function show(target: HTMLElement) {
  if (touchLike()) return
  const s = states.get(target)
  const text = s?.text?.trim()
  if (!s || !text || (s.overflow && !truncated(target))) return
  const tip = bubble()
  tip.textContent = text
  tip.dataset.show = ''
  owner = target
  target.setAttribute('aria-describedby', tip.id)
  // 先量尺寸再定位
  const r = target.getBoundingClientRect()
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  const below = r.top - GAP - h < EDGE
  const top = below ? r.bottom + GAP : r.top - GAP - h
  const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE), innerWidth - w - EDGE)
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  tip.dataset.side = below ? 'bottom' : 'top'
  tip.dataset.visible = 'true'
}

function hide() {
  clearTimeout(timer)
  if (owner) owner.removeAttribute('aria-describedby')
  owner = null
  if (el) el.dataset.visible = 'false'
}

// 滚动、按键时收起，避免提示停在原地
if (typeof window !== 'undefined') {
  addEventListener('scroll', hide, true)
  addEventListener('keydown', (e) => e.key === 'Escape' && hide())
  // 手指一碰就收起，并在随后的模拟鼠标事件里不再弹出
  addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return
      lastTouch = performance.now()
      hide()
    },
    { capture: true, passive: true },
  )
}

export const tip: Directive<HTMLElement, Value> = {
  mounted(target, binding) {
    const s: State = {
      text: binding.value,
      overflow: Boolean(binding.modifiers.overflow),
      enter: () => {
        clearTimeout(timer)
        if (touchLike()) return
        // 已经有提示在显示时立即切换，不再等
        if (el?.dataset.visible === 'true') return show(target)
        timer = setTimeout(() => show(target), DELAY)
      },
      leave: hide,
    }
    states.set(target, s)
    target.addEventListener('mouseenter', s.enter)
    target.addEventListener('mouseleave', s.leave)
    target.addEventListener('focusin', s.enter)
    target.addEventListener('focusout', s.leave)
    target.addEventListener('pointerdown', s.leave)
  },
  updated(target, binding) {
    const s = states.get(target)
    if (!s) return
    s.text = binding.value
    if (owner === target) {
      if (s.text) show(target)
      else hide()
    }
  },
  beforeUnmount(target) {
    const s = states.get(target)
    if (!s) return
    target.removeEventListener('mouseenter', s.enter)
    target.removeEventListener('mouseleave', s.leave)
    target.removeEventListener('focusin', s.enter)
    target.removeEventListener('focusout', s.leave)
    target.removeEventListener('pointerdown', s.leave)
    if (owner === target) hide()
    states.delete(target)
  },
}

declare module 'vue' {
  interface GlobalDirectives {
    vTip: typeof tip
  }
}
