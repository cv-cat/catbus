import { type Child, h } from './dom.js'
import { icon } from './icons.js'
import { button } from './ui.js'

/**
 * 危险操作确认框（AGENTS 4.11、4.13）：原生 <dialog> 的模态，焦点进入、背景不可操作、Esc 等于取消。
 * 初始焦点放在安全的「取消」上，关闭后焦点回到触发它的元素。
 */
export function confirmDialog(options: { title: string; body: Child[]; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return new Promise((resolve) => {
    const titleId = `dialog-title-${Date.now()}`
    const cancel = button('取消', { variant: 'secondary' })
    const ok = button(options.confirmLabel, { variant: options.danger ? 'danger' : 'primary', icon: options.danger ? 'alert' : 'check' })
    const dialog = h(
      'dialog',
      { class: 'dialog', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'dialog-head' },
        h('span', { class: `dialog-badge ${options.danger ? 'dialog-badge-danger' : ''}` }, icon(options.danger ? 'alert' : 'info')),
        h('h2', { id: titleId, class: 'dialog-title' }, options.title),
      ),
      h('div', { class: 'dialog-body' }, ...options.body),
      h('div', { class: 'dialog-actions' }, cancel, ok),
    )
    let result = false
    cancel.addEventListener('click', () => dialog.close())
    ok.addEventListener('click', () => {
      result = true
      dialog.close()
    })
    dialog.addEventListener('close', () => {
      dialog.remove()
      trigger?.focus()
      resolve(result)
    })
    document.body.append(dialog)
    dialog.showModal()
    cancel.focus()
  })
}
