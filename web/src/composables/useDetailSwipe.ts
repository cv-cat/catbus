import { onBeforeUnmount, watch, type Ref } from 'vue'
import { gsap } from '@/composables/motion'

/**
 * 全屏详情的下滑关闭（AGENTS.md 7.9「响应式 · 弹层」）：面板滚到顶时向下拖，面板跟手下移、遮罩变淡；
 * 超过阈值（120px）或松手时速度够快就关闭，否则弹回。
 * 横向为主的拖动（图文轮播）和视频控件上的拖动（进度条）不接管。
 */
export function useDetailSwipe(opts: {
  sheet: Ref<HTMLElement | undefined>
  scrim: Ref<HTMLElement | undefined>
  /** 跟着面板一起移动的元素（浮在面板外的关闭按钮） */
  follow?: Ref<HTMLElement | undefined>
  enabled: () => boolean
  onClose: () => void
}) {
  const THRESHOLD = 120
  const VELOCITY = 0.6 // px/ms
  let x0 = 0
  let y0 = 0
  let t0 = 0
  let lastY = 0
  let lastT = 0
  let speed = 0
  /** null：还没判断方向；true：接管为下滑；false：放给浏览器 / 轮播 */
  let dragging: boolean | null = null
  let tracking = false

  const movers = () => [opts.sheet.value, opts.follow?.value].filter(Boolean) as HTMLElement[]

  function set(dy: number) {
    gsap.set(movers(), { y: dy })
    const s = opts.scrim.value
    if (s) gsap.set(s, { opacity: Math.max(0.2, 1 - dy / (innerHeight * 0.75)) })
  }

  function reset() {
    tracking = false
    dragging = null
    gsap.killTweensOf(movers())
    gsap.set(movers(), { y: 0 })
  }

  function onStart(e: TouchEvent) {
    const s = opts.sheet.value
    tracking = false
    if (!s || !opts.enabled() || e.touches.length !== 1) return
    const el = e.target as HTMLElement | null
    if (el?.closest('.controls, .bar, input, textarea, [data-no-swipe]')) return
    if (s.scrollTop > 0) return
    const p = e.touches[0]!
    x0 = p.clientX
    y0 = p.clientY
    t0 = lastT = e.timeStamp
    lastY = y0
    speed = 0
    dragging = null
    tracking = true
  }

  function onMove(e: TouchEvent) {
    if (!tracking) return
    const s = opts.sheet.value
    const p = e.touches[0]
    if (!s || !p || e.touches.length !== 1) return cancel()
    const dx = p.clientX - x0
    const dy = p.clientY - y0
    if (dragging === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      // 只在面板顶部、竖直向下时接管
      dragging = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && s.scrollTop <= 0
      if (!dragging) {
        tracking = false
        return
      }
      y0 = p.clientY // 从这里开始跟手，避免起步跳一下
    }
    if (e.cancelable) e.preventDefault()
    const dt = e.timeStamp - lastT
    if (dt > 0) speed = speed * 0.4 + ((p.clientY - lastY) / dt) * 0.6
    lastY = p.clientY
    lastT = e.timeStamp
    set(Math.max(0, p.clientY - y0))
  }

  function onEnd() {
    if (!tracking) return
    tracking = false
    if (!dragging) return
    dragging = null
    const dy = Number(gsap.getProperty(opts.sheet.value!, 'y')) || 0
    if (dy > THRESHOLD || (speed > VELOCITY && dy > 24) || (dy > 40 && lastT - t0 < 160)) {
      opts.onClose()
      return
    }
    gsap.to(movers(), { y: 0, duration: 0.35, ease: 'power3.out' })
    const sc = opts.scrim.value
    if (sc) gsap.to(sc, { opacity: 1, duration: 0.35, ease: 'power3.out' })
  }

  function cancel() {
    if (dragging) {
      dragging = true
      onEnd()
    }
    tracking = false
  }

  let bound: HTMLElement | null = null
  function unbind() {
    if (!bound) return
    bound.removeEventListener('touchstart', onStart)
    bound.removeEventListener('touchmove', onMove)
    bound.removeEventListener('touchend', onEnd)
    bound.removeEventListener('touchcancel', onEnd)
    bound = null
  }
  watch(
    opts.sheet,
    (el) => {
      unbind()
      if (!el) return
      bound = el
      el.addEventListener('touchstart', onStart, { passive: true })
      // 非 passive：接管下滑后要 preventDefault，拦住面板自己的滚动和回弹
      el.addEventListener('touchmove', onMove, { passive: false })
      el.addEventListener('touchend', onEnd)
      el.addEventListener('touchcancel', onEnd)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(unbind)

  return { reset }
}
