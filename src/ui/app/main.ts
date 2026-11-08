import { api } from './api.js'
import { h, replace } from './dom.js'
import { icon } from './icons.js'
import { currentRoute, type Route } from './router.js'
import { accountsOf, getMeta, onAccountsChange, refreshAccounts, setMeta } from './state.js'
import { callout, platformLogo } from './ui.js'
import { accountsView } from './views/accounts.js'
import { commandView } from './views/command.js'
import { doctorView } from './views/doctor.js'
import { homeView } from './views/home.js'
import { jobDetailView, jobsView } from './views/jobs.js'
import { loginView } from './views/login.js'
import { notFoundView } from './views/not-found.js'
import { platformView } from './views/platform.js'
import { settingsView } from './views/settings.js'

/**
 * 面板入口：外框（平台侧栏、顶栏导航、浅灰外框里的主面板）+ hash 路由。每个视图返回清理函数，离开时断开事件流、停止计时。
 */

export type Cleanup = (() => void) | void
export type View = (main: HTMLElement, route: Route) => Cleanup

const NAV: { path: string; label: string }[] = [
  { path: '', label: '首页' },
  { path: 'accounts', label: '账号' },
  { path: 'jobs', label: '任务' },
  { path: 'settings', label: '设置' },
  { path: 'doctor', label: '环境检查' },
]

let cleanup: Cleanup
let firstRender = true

/**
 * 路由 → 视图。
 */
function resolveView(route: Route): View {
  const [first, second, third, fourth] = route.path
  if (first == null) return homeView
  if (first === 'accounts' && second == null) return accountsView
  if (first === 'jobs') return second == null ? jobsView : jobDetailView
  if (first === 'settings' && second == null) return settingsView
  if (first === 'doctor' && second == null) return doctorView
  if (first === 'p' && second) {
    if (third == null) return platformView
    if (third === 'login' && fourth == null) return loginView
    if (third === 'auth' && fourth === 'login') return loginView
    if (fourth != null) return commandView
  }
  return notFoundView
}

/**
 * 导航的选中项（顶栏和侧栏）：与当前地址一致（aria-current）。
 */
function markCurrent(shell: HTMLElement, route: Route): void {
  const key = route.path[0] === 'p' ? `p/${route.path[1]}` : (route.path[0] ?? '')
  for (const link of shell.querySelectorAll<HTMLAnchorElement>('a[data-nav]')) {
    if (link.dataset.nav === key) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

/**
 * 顶栏：移动端的菜单按钮与品牌，居中的主导航胶囊。
 */
function appbar(toggle: HTMLButtonElement): HTMLElement {
  return h(
    'header',
    { class: 'appbar' },
    h('div', { class: 'appbar-start' }, toggle, h('a', { class: 'topbar-brand', href: '#/' }, h('img', { src: 'app/img/mascot.png', alt: '' }), 'catbus')),
    h('nav', { class: 'appnav', 'aria-label': '主导航' }, h('ul', null, NAV.map((n) => h('li', null, h('a', { href: `#/${n.path}`, class: 'appnav-link', 'data-nav': n.path }, n.label))))),
  )
}

/**
 * 侧栏：品牌、平台列表（带登录状态点）。
 */
function sidebar(): HTMLElement {
  const meta = getMeta()
  const dots = new Map<string, HTMLElement>()
  const platformLinks = meta.platforms.map((p) => {
    const dot = h('span', { class: 'nav-dot', hidden: true }, h('span', { class: 'sr-only' }, '（已登录）'))
    dots.set(p.id, dot)
    return h('li', null, h('a', { href: `#/p/${p.id}`, class: 'nav-link nav-platform', 'data-nav': `p/${p.id}` }, platformLogo(p.id, 'sm'), h('span', { class: 'nav-text' }, p.name), dot))
  })
  onAccountsChange(() => {
    for (const p of meta.platforms) dots.get(p.id)!.hidden = accountsOf(p.id, p.defaultEndpoint).length === 0
  })
  return h(
    'aside',
    { class: 'sidebar', id: 'sidebar' },
    h(
      'a',
      { class: 'brand', href: '#/' },
      h('span', { class: 'brand-avatar' }, h('img', { src: 'app/img/mascot.png', alt: '' })),
      h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'catbus'), h('span', { class: 'brand-sub' }, `控制台 · v${meta.version}`)),
    ),
    h('p', { class: 'nav-heading', id: 'nav-platforms' }, '平台'),
    h('nav', { 'aria-labelledby': 'nav-platforms', class: 'nav-scroll' }, h('ul', { class: 'nav' }, platformLinks)),
  )
}

/**
 * 渲染当前路由；非首次进入时把焦点移到页面标题，让读屏软件播报新页面。
 */
function render(main: HTMLElement, shell: HTMLElement, closeDrawer: () => void): void {
  if (typeof cleanup === 'function') cleanup()
  const route = currentRoute()
  markCurrent(shell, route)
  main.replaceChildren()
  cleanup = resolveView(route)(main, route)
  closeDrawer()
  if (!firstRender) {
    window.scrollTo({ top: 0 })
    const title = main.querySelector<HTMLElement>('h1')
    if (title) {
      title.tabIndex = -1
      title.focus({ preventScroll: true })
    }
  }
  firstRender = false
}

/**
 * 点外面或按 Esc 时收起打开的「更多」菜单和移动端侧栏。
 */
function installGlobalHandlers(closeDrawer: () => void): void {
  document.addEventListener('click', (e) => {
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('details.menu[open]')) if (!menu.contains(e.target as Node)) menu.open = false
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const open = document.querySelector<HTMLDetailsElement>('details.menu[open]')
    if (open) {
      open.open = false
      open.querySelector('summary')?.focus()
    } else if (document.body.classList.contains('nav-open')) {
      closeDrawer()
    }
  })
}

/**
 * 启动：取元数据、搭外框、读账号、开始路由。
 */
async function boot(): Promise<void> {
  const root = document.getElementById('app')!
  try {
    setMeta(await api.meta())
  } catch (err) {
    replace(root, h('main', { class: 'main boot-error' }, callout('danger', '面板没能启动', h('p', null, err instanceof Error ? err.message : String(err)), h('p', null, '确认终端里的 catbus ui 还在运行，然后刷新页面。'))))
    return
  }
  const side = sidebar()
  const main = h('main', { class: 'main', id: 'main' })
  const toggle = h('button', { type: 'button', class: 'menu-toggle', 'aria-controls': 'sidebar', 'aria-expanded': 'false', 'aria-label': '打开导航' }, icon('menu'))
  const close = h('button', { type: 'button', class: 'sidebar-close', 'aria-label': '关闭导航' }, icon('close'))
  const bar = appbar(toggle)
  const frame = h('div', { class: 'frame' }, main)
  const skip = h('a', { class: 'skip-link', href: '#main', on: { click: (e) => (e.preventDefault(), main.focus()) } }, '跳到主要内容')
  const mobile = window.matchMedia('(max-width: 860px)')
  const setDrawer = (requested: boolean, restoreFocus = true) => {
    const open = requested && mobile.matches
    const wasOpen = document.body.classList.contains('nav-open')
    document.body.classList.toggle('nav-open', open)
    toggle.setAttribute('aria-expanded', String(open))
    side.inert = mobile.matches && !open
    for (const background of [bar, frame, skip]) background.inert = open
    if (open) {
      side.setAttribute('role', 'dialog')
      side.setAttribute('aria-modal', 'true')
      side.setAttribute('aria-label', '选择平台')
      const current = side.querySelector<HTMLElement>('[aria-current="page"]') ?? close
      current.focus()
    } else {
      side.removeAttribute('role')
      side.removeAttribute('aria-modal')
      side.removeAttribute('aria-label')
      if (wasOpen && restoreFocus && mobile.matches) toggle.focus()
    }
  }
  toggle.addEventListener('click', () => setDrawer(true))
  close.addEventListener('click', () => setDrawer(false))
  // 抽屉作为模态导航时，Tab 留在可见的平台栏里；背景不能接收焦点或点击。
  side.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || !document.body.classList.contains('nav-open')) return
    const links = [...side.querySelectorAll<HTMLElement>('a[href], button')]
    const first = links[0]!
    const last = links[links.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  // 点击当前平台也要收起抽屉，此时 hash 不变，不会触发路由事件。
  side.addEventListener('click', (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
    if (link?.hash === location.hash && document.body.classList.contains('nav-open')) {
      setDrawer(false, false)
      main.focus()
    }
  })
  mobile.addEventListener('change', () => {
    const focusWasHidden = mobile.matches && side.contains(document.activeElement)
    const wasOpen = document.body.classList.contains('nav-open')
    setDrawer(false, false)
    if (mobile.matches && (focusWasHidden || document.activeElement === document.body)) toggle.focus()
    else if (!mobile.matches && wasOpen) {
      const current = side.querySelector<HTMLElement>('[aria-current="page"]') ?? side.querySelector<HTMLElement>('.brand')
      current?.focus()
    }
  })
  side.append(close)
  const scrim = h('div', { class: 'scrim', 'aria-hidden': 'true', on: { click: () => setDrawer(false) } })
  replace(root, skip, bar, side, scrim, frame)
  setDrawer(false, false)
  main.tabIndex = -1
  installGlobalHandlers(() => setDrawer(false))
  window.addEventListener('hashchange', () => render(main, root, () => setDrawer(false, false)))
  render(main, root, () => setDrawer(false, false))
  void refreshAccounts()
}

void boot()
