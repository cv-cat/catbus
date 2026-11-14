import { defineStore } from 'pinia'
import { ref } from 'vue'
import { t } from '@/i18n'

/** 页面顶部的全局提示：任何地方都可以 toast('…') */
export const useToastStore = defineStore('toast', () => {
  const text = ref('')
  const show = ref(false)
  const key = ref(0)
  /** 可选的一个按钮（如「去设置」「重试推送」），点了执行并收起 */
  const action = ref<ToastAction | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function push(next: string, ms = 1800, act: ToastAction | null = null) {
    text.value = next
    action.value = act
    key.value++
    show.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (show.value = false), ms)
  }

  function act() {
    const a = action.value
    show.value = false
    clearTimeout(timer)
    a?.run()
  }

  return { text, show, key, action, push, act }
})

export interface ToastAction {
  label: string
  run: () => void
}

/** 在任何地方弹提示（组件外也可以）：store 在调用时才取 */
export function toast(text: string, ms = 1800, action: ToastAction | null = null) {
  useToastStore().push(text, ms, action)
}

/** 复制文本到剪贴板并在页面顶部提示；失败时返回 false */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 非安全上下文等情况下退回 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (!ok) {
      toast(t('layout.copy.failed'))
      return false
    }
  }
  toast(t('layout.copy.done'))
  return true
}
