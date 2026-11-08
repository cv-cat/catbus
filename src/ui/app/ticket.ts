import { h } from './dom.js'
import { copyButton } from './ui.js'

/**
 * 车票：印着与当前表单等价的 CLI 命令（AGENTS 4.13「表单」），呼应吉祥物手里那张 `>_` 车票。
 */
export function ticket(): { element: HTMLElement; update(command: string, note: string | null): void } {
  let current = ''
  const text = h('code', { class: 'ticket-command' })
  const note = h('p', { class: 'ticket-note', hidden: true })
  const element = h(
    'div',
    { class: 'ticket' },
    h('div', { class: 'ticket-stub', 'aria-hidden': 'true' }, h('span', { class: 'ticket-glyph' }, '>_'), h('span', { class: 'ticket-stub-label' }, '终端')),
    h('div', { class: 'ticket-body' }, h('div', { class: 'ticket-head' }, h('span', { class: 'ticket-label' }, '在终端中运行'), copyButton(() => current, '复制命令')), text, note),
  )
  return {
    element,
    update(command, noteText) {
      current = command
      text.textContent = command
      note.hidden = noteText == null
      note.textContent = noteText ?? ''
    },
  }
}
