import { nextTick, shallowRef, type Component, type ShallowRef } from 'vue'
import { t } from '@/i18n'
import { toast } from '@/stores/toast'

/**
 * 按需加载的组件：只在用到的页面、弹窗第一次出现时才下载它的代码（首屏只带发现页）。
 * comp 加载好之前是 null；load() 可以反复调用，只请求一次，失败后下次再试。
 */
export interface LazyComponent {
  comp: ShallowRef<Component | null>
  load: () => Promise<Component>
}

export function lazyComponent(loader: () => Promise<{ default: Component }>): LazyComponent {
  const comp = shallowRef<Component | null>(null)
  let pending: Promise<Component> | null = null
  const load = () =>
    (pending ??= loader().then(
      (m) => (comp.value = m.default),
      (e) => {
        pending = null
        throw e
      },
    ))
  return { comp, load }
}

/**
 * 先确保组件的代码到了、并已挂上，再执行 fn（打开弹窗、详情卡片）。
 * 代码已经在了（通常空闲时已预取）时同步执行；否则等它加载、挂好之后再打开，
 * 组件看到的仍是「关 → 开」，进场动画照常。加载失败时提示一次，不打开。
 */
export function afterLoad(lz: LazyComponent, fn: () => void): void {
  if (lz.comp.value) return fn()
  lz.load()
    .then(() => nextTick())
    .then(fn, () => toast(t('layout.loadFailed')))
}

type IdleWindow = typeof globalThis & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

/** 浏览器空闲时执行；不支持 requestIdleCallback 时退回 setTimeout */
export function whenIdle(fn: () => void, timeout = 3000): void {
  const w = globalThis as IdleWindow
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout })
  else setTimeout(fn, 200)
}

/** 首屏之后空闲时依次预取：一个取完再取下一个，不和首屏的请求抢带宽；失败的静默跳过，用到时再取 */
export function prefetchWhenIdle(loads: Array<() => Promise<unknown>>): void {
  const next = (i: number) => {
    if (i >= loads.length) return
    whenIdle(() => {
      loads[i]!().catch(() => {}).finally(() => next(i + 1))
    })
  }
  next(0)
}
