import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 页面顶部的全局提示：任何地方都可以 toast('…') */
export const useToastStore = defineStore('toast', () => {
  const text = ref('')
  const show = ref(false)
  const key = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined

  function push(next: string, ms = 1800) {
    text.value = next
    key.value++
    show.value = true
    clearTimeout(timer)
    timer = setTimeout(() => (show.value = false), ms)
  }

  return { text, show, key, push }
})

/** 在任何地方弹提示（组件外也可以）：store 在调用时才取 */
export function toast(text: string, ms = 1800) {
  useToastStore().push(text, ms)
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
      toast('复制失败，请手动复制')
      return false
    }
  }
  toast('已复制到剪贴板')
  return true
}
