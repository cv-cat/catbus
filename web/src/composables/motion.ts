import { gsap } from 'gsap'
import { computed, effectScope, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

/** 系统的「减少动态效果」：实时跟随媒体查询 */
const mq = typeof window !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null
const systemReduce = ref(mq?.matches ?? false)
mq?.addEventListener('change', (e) => (systemReduce.value = e.matches))

/** 设置里的「减少动效」= 总是减少：等同系统开启 */
const forcedReduce = ref(false)
/** 设置里的「人浪动效」 */
const waveEnabled = ref(true)

/** 实际是否减少动效（响应式，供需要在切换时停 / 启动画的组件 watch） */
export const reducedMotion = computed(() => forcedReduce.value || systemReduce.value)
export const prefersReducedMotion = () => reducedMotion.value

let bound = false
/**
 * 把设置（reduceMotion、pixelBackground（背景和人浪动效是一个开关））接到这里，App 启动时调用一次。
 * 实际减少动效时 <html data-motion="reduce">，全局样式据此把 CSS 动画 / 过渡缩到接近 0。
 */
export function bindMotionSettings() {
  if (bound) return
  bound = true
  const store = useSettingsStore()
  effectScope(true).run(() => {
    watch(
      () => store.settings.reduceMotion,
      (v) => (forcedReduce.value = v === 'always'),
      { immediate: true },
    )
    watch(
      reducedMotion,
      (r) => {
        if (r) document.documentElement.dataset.motion = 'reduce'
        else delete document.documentElement.dataset.motion
      },
      { immediate: true },
    )
    watch(
      () => store.settings.pixelBackground,
      (on) => {
        waveEnabled.value = on
        // 加载中途关掉：让正在起的人浪停下
        if (!on) dispatchEvent(new CustomEvent('catbus:wave-loading', { detail: false }))
      },
      { immediate: true },
    )
  })
}

/** 动效统一入口：减少动态效果时直接跳到终态 */
export function animate(targets: gsap.TweenTarget, vars: gsap.TweenVars) {
  if (prefersReducedMotion()) return gsap.set(targets, { ...vars, duration: 0, delay: 0, stagger: 0 })
  return gsap.to(targets, vars)
}

export function animateFrom(targets: gsap.TweenTarget, from: gsap.TweenVars, to: gsap.TweenVars) {
  if (prefersReducedMotion()) return gsap.set(targets, to)
  return gsap.fromTo(targets, from, to)
}

export { gsap }

/** 像素背景从右上角往左下起一次人浪（PixelBackground 监听），用于点击反馈；设置里关了人浪时不起 */
export function wave() {
  if (!waveEnabled.value) return
  dispatchEvent(new CustomEvent('catbus:wave'))
}

/** 加载期间像素背景每隔一会儿起一浪，结束后停下；设置里关了人浪时只发「停」 */
export function waveWhileLoading(loading: boolean) {
  dispatchEvent(new CustomEvent('catbus:wave-loading', { detail: loading && waveEnabled.value }))
}
