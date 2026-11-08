/**
 * 极简的 DOM 构建工具：所有文本都走 textContent，不拼 HTML，平台返回的内容不会被当成标记执行。
 */

type Handlers = { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void }
type AttrValue = string | number | boolean | null | undefined

export type Attrs = { on?: Handlers; [name: string]: AttrValue | Handlers }
export type Child = Node | string | number | null | undefined | false | Child[]

/** 作为 DOM 属性（property）设置、而不是 attribute 的键。 */
const PROPERTY_KEYS = ['value', 'checked']

/**
 * 把子节点（可嵌套数组）追加到元素上；空值跳过。
 */
export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue
    if (Array.isArray(child)) append(parent, ...child)
    else parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)))
  }
}

/**
 * 创建元素：attrs 里 `on` 是事件，`class` 是类名，true 表示布尔属性，null / false 跳过。
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === 'on') {
      for (const [event, handler] of Object.entries(value as Handlers)) el.addEventListener(event, handler as EventListener)
    } else if (PROPERTY_KEYS.includes(name)) {
      Object.assign(el, { [name]: value })
    } else if (value === true) el.setAttribute(name, '')
    else if (value != null && value !== false) el.setAttribute(name, String(value))
  }
  append(el, ...children)
  return el
}

/**
 * 清空元素并放入新的子节点。
 */
export function replace(parent: Element, ...children: Child[]): void {
  parent.replaceChildren()
  append(parent, ...children)
}

let idCounter = 0

/**
 * 页面内唯一的 id，用于 label 与输入框、描述的关联。
 */
export function uid(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

/**
 * 把文本里的 http(s) 链接变成可点击的链接（在新标签页打开）。
 */
export function linkify(text: string): Child[] {
  const parts: Child[] = []
  const re = /https?:\/\/[^\s"'<>，。]+/g
  let last = 0
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index))
    parts.push(h('a', { href: m[0], target: '_blank', rel: 'noreferrer noopener' }, m[0]))
    last = m.index + m[0].length
  }
  parts.push(text.slice(last))
  return parts
}
