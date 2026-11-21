import { computed, effectScope, readonly, ref, watch } from 'vue'
import { useSettingsStore, type ThemePref } from '@/stores/settings'
import { prefersReducedMotion } from '@/composables/motion'

/** 实际生效的主题（写在 <html data-theme>） */
export type Theme = 'light' | 'dark'

const media = typeof window !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null
/** 系统当前是不是暗色：实时跟随 prefers-color-scheme */
const systemDark = ref(media?.matches ?? false)
media?.addEventListener('change', (e) => (systemDark.value = e.matches))

const theme = ref<Theme>((document.documentElement.dataset.theme as Theme) || 'light')

function resolve(pref: ThemePref): Theme {
  return pref === 'system' ? (systemDark.value ? 'dark' : 'light') : pref
}

/**
 * 把主题画到页面上。支持 View Transitions 时，从 origin（默认右上角）画一个圆展开新主题；
 * 否则直接切换（颜色本身有 CSS 过渡）。
 */
async function paint(next: Theme, origin?: { x: number; y: number }) {
  if (next === theme.value) return
  const apply = () => {
    theme.value = next
    document.documentElement.dataset.theme = next
  }
  const reduce = prefersReducedMotion()
  if (!document.startViewTransition || reduce) return apply()

  const x = origin?.x ?? innerWidth - 40
  const y = origin?.y ?? 40
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const vt = document.startViewTransition(apply)
  await vt.ready
  document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
    { duration: 620, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
  )
}

let bound = false
/** 下一次主题变化从哪里展开（点击位置）；用一次就清掉 */
let pendingOrigin: { x: number; y: number } | undefined

/**
 * 主题偏好存在设置里（theme: light | dark | system）。system 时跟随系统，系统切换时实时变化。
 * 第一次调用时开始监听；之后各处共享同一份状态。
 */
export function useTheme() {
  const store = useSettingsStore()
  const effective = computed(() => resolve(store.settings.theme))
  if (!bound) {
    bound = true
    // 独立的 effect scope：不随第一个调用它的组件卸载而停止
    effectScope(true).run(() =>
      watch(
        () => resolve(store.settings.theme),
        (t) => {
          const o = pendingOrigin
          pendingOrigin = undefined
          void paint(t, o)
        },
        { immediate: true },
      ),
    )
  }

  /** 顶栏按钮：在亮色 / 暗色之间切换实际主题（设成固定值，不再跟随系统） */
  function toggle(origin?: { x: number; y: number }) {
    pendingOrigin = origin
    store.set('theme', effective.value === 'light' ? 'dark' : 'light')
  }

  function set(pref: ThemePref, origin?: { x: number; y: number }) {
    pendingOrigin = resolve(pref) === effective.value ? undefined : origin
    store.set('theme', pref)
  }

  return { theme: readonly(theme), preference: computed(() => store.settings.theme), toggle, set }
}
