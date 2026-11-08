import { append } from '../dom.js'
import type { Route } from '../router.js'
import { emptyState, linkButton } from '../ui.js'

/**
 * 地址不存在（平台或命令已不在注册表里、手输错地址）：给出回到有效位置的路径。
 */
export function notFoundView(main: HTMLElement, _route: Route): void {
  document.title = '找不到页面 · catbus'
  append(main, emptyState({ art: 'bus', title: '这一站不存在', text: '这个页面不存在，回到首页选择要使用的平台吧。', actions: [linkButton('回到首页', '#/', { variant: 'primary', icon: 'home' })] }))
}
