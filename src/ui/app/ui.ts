import { type Attrs, type Child, h } from './dom.js'
import { icon, type IconName } from './icons.js'
import type { Tone } from './labels.js'

/**
 * 面板的通用界面元素：按钮、标签、提示块、空状态、平台图标、头像。样式全部来自 style.css 的语义 token。
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

/** 复制成功的提示保留时长。 */
const COPIED_FEEDBACK_MS = 1600

/**
 * 按钮：variant 决定层级，危险动作用 danger。
 */
export function button(label: Child, options: { variant?: ButtonVariant; icon?: IconName; attrs?: Attrs; size?: 'sm' | 'md' } = {}): HTMLButtonElement {
  const { variant = 'secondary', size = 'md' } = options
  return h(
    'button',
    { type: 'button', ...options.attrs, class: `btn btn-${variant} btn-${size} ${(options.attrs?.class as string | undefined) ?? ''}`.trim() },
    options.icon ? icon(options.icon) : null,
    h('span', { class: 'btn-label' }, label),
  )
}

/**
 * 看起来像按钮的链接：用于导航（保留链接语义）。
 */
export function linkButton(label: Child, target: string, options: { variant?: ButtonVariant; icon?: IconName; size?: 'sm' | 'md' } = {}): HTMLAnchorElement {
  const { variant = 'secondary', size = 'md' } = options
  return h('a', { href: target, class: `btn btn-${variant} btn-${size}` }, options.icon ? icon(options.icon) : null, h('span', { class: 'btn-label' }, label))
}

/**
 * 状态标签：颜色只是辅助，含义由文字表达。
 */
export function chip(label: Child, tone: Tone = 'neutral', iconName?: IconName): HTMLSpanElement {
  return h('span', { class: `chip chip-${tone}` }, iconName ? icon(iconName) : null, label)
}

/**
 * 提示块：说明、警告、错误。role=status 让辅助技术感知变化而不打断。
 */
export function callout(tone: Tone, title: Child, ...body: Child[]): HTMLElement {
  const iconName: IconName = tone === 'danger' || tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : 'info'
  return h('div', { class: `callout callout-${tone}`, role: tone === 'danger' ? 'alert' : 'status' }, icon(iconName, 'icon callout-icon'), h('div', { class: 'callout-body' }, h('p', { class: 'callout-title' }, title), ...body))
}

/**
 * 空状态 / 占位：吉祥物贴纸 + 说明 + 下一步。
 */
export function emptyState(options: { art?: 'bus' | 'plane' | 'mascot'; title: string; text?: Child; actions?: Child[] }): HTMLElement {
  return h(
    'div',
    { class: 'empty' },
    options.art ? h('img', { class: 'empty-art', src: `app/img/${options.art}.png`, alt: '' }) : null,
    h('p', { class: 'empty-title' }, options.title),
    options.text ? h('p', { class: 'empty-text' }, options.text) : null,
    options.actions?.length ? h('div', { class: 'empty-actions' }, options.actions) : null,
  )
}

/**
 * 加载指示（不定进度）。
 */
export function spinner(label = '加载中'): HTMLElement {
  return h('span', { class: 'spinner', role: 'status' }, h('span', { class: 'spinner-ring', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, label))
}

/**
 * 平台图标（随包分发的真实图标）。
 */
export function platformLogo(id: string, size: 'sm' | 'md' | 'lg' = 'md'): HTMLImageElement {
  return h('img', { class: `platform-logo platform-logo-${size}`, src: `app/img/platforms/${id}.jpg`, alt: '', loading: 'lazy' })
}

/** 头像底色的数量（style.css 里的 avatar-0 … avatar-5）。 */
const AVATAR_TONES = 6

/**
 * 头像：有图片时用图片（不带 Referer），否则用名字首字和稳定的底色。
 */
export function avatar(name: string | null, url: string | null = null, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const text = (name ?? '?').trim()
  const initial = [...text][0] ?? '?'
  let hash = 0
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  const box = h('span', { class: `avatar avatar-${size} avatar-${hash % AVATAR_TONES}`, 'aria-hidden': 'true' }, initial.toUpperCase())
  if (url) {
    const img = h('img', { src: url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', decoding: 'async' })
    img.addEventListener('error', () => img.remove())
    box.append(img)
  }
  return box
}

/**
 * 复制按钮：复制成功后在原位置提示，并通过 aria-live 播报。
 */
export function copyButton(getText: () => string, label = '复制'): HTMLButtonElement {
  const btn = button(label, { variant: 'ghost', icon: 'copy', size: 'sm' })
  const text = btn.querySelector('.btn-label')!
  btn.setAttribute('aria-live', 'polite')
  btn.addEventListener('click', () => {
    void navigator.clipboard.writeText(getText()).then(
      () => {
        text.textContent = '已复制'
        setTimeout(() => (text.textContent = label), COPIED_FEEDBACK_MS)
      },
      () => {
        text.textContent = '复制失败'
        setTimeout(() => (text.textContent = label), COPIED_FEEDBACK_MS)
      },
    )
  })
  return btn
}

/**
 * 页面标题区：面包屑、标题、副标题和右侧操作。
 */
export function pageHeader(options: { crumbs?: { label: string; href?: string }[]; title: Child; subtitle?: Child; lead?: Child; actions?: Child[] }): HTMLElement {
  const crumbs = options.crumbs?.length
    ? h(
        'nav',
        { class: 'crumbs', 'aria-label': '位置' },
        h(
          'ol',
          null,
          options.crumbs.map((c, i) =>
            h('li', null, c.href && i < options.crumbs!.length - 1 ? h('a', { href: c.href }, c.label) : h('span', { 'aria-current': 'page' }, c.label)),
          ),
        ),
      )
    : null
  return h(
    'header',
    { class: 'page-header' },
    crumbs,
    h(
      'div',
      { class: 'page-header-row' },
      options.lead ? h('div', { class: 'page-header-lead' }, options.lead) : null,
      h('div', { class: 'page-header-text' }, h('h1', { class: 'page-title' }, options.title), options.subtitle ? h('p', { class: 'page-subtitle' }, options.subtitle) : null),
      options.actions?.length ? h('div', { class: 'page-header-actions' }, options.actions) : null,
    ),
  )
}

/**
 * 卡片容器。
 */
export function card(attrs: Attrs | null, ...children: Child[]): HTMLElement {
  return h('section', { ...attrs, class: `card ${(attrs?.class as string | undefined) ?? ''}`.trim() }, ...children)
}
