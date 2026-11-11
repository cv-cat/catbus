import { reactive, readonly } from 'vue'

/** 断点上限（含）。与 styles/tokens.css 的说明一致，CSS 里写死同样的数值 */
export const BREAKPOINTS = { phone: 640, tablet: 1024 } as const

export const MQ = {
  phone: `(max-width: ${BREAKPOINTS.phone}px)`,
  tablet: `(min-width: ${BREAKPOINTS.phone + 1}px) and (max-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.tablet + 1}px)`,
  /** 主要输入是手指：不能悬停、指针不精确 */
  touch: '(hover: none) and (pointer: coarse)',
  landscape: '(orientation: landscape)',
} as const

type Key = keyof typeof MQ
const state = reactive({ phone: false, tablet: false, desktop: true, touch: false, landscape: true, width: 0, height: 0 })
let bound = false

function bind() {
  if (bound || typeof window === 'undefined') return
  bound = true
  for (const k of Object.keys(MQ) as Key[]) {
    const m = matchMedia(MQ[k])
    state[k] = m.matches
    m.addEventListener('change', (e) => (state[k] = e.matches))
  }
  const size = () => {
    state.width = innerWidth
    state.height = innerHeight
  }
  size()
  addEventListener('resize', size, { passive: true })
}

/** 全局共享的断点状态（只读、响应式）。组件里：`const bp = useBreakpoint(); bp.phone` */
export function useBreakpoint() {
  bind()
  return readonly(state)
}
