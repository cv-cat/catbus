import type { JobSummary, PlatformMeta } from '../../shared/types.js'
import { api } from '../api.js'
import { endpointLabel, taskTitle } from '../copy.js'
import { append, h, replace } from '../dom.js'
import { relativeTime } from '../format.js'
import { icon } from '../icons.js'
import { JOB_STATE_INFO } from '../labels.js'
import type { Route } from '../router.js'
import { accountsOf, getAccounts, getMeta, onAccountsChange } from '../state.js'
import { chip, linkButton, platformLogo } from '../ui.js'

/** 首页「最近任务」显示的条数。 */
const RECENT_JOBS = 5

/**
 * 平台默认端的登录状况标签。
 */
export function loginChip(platform: PlatformMeta): HTMLElement {
  const endpoint = platform.endpoints[platform.defaultEndpoint]
  if (endpoint.status !== 'available') return chip('暂未开放', 'neutral')
  if (!endpoint.login.methods.length) return chip('免登录', 'info', 'check')
  if (getAccounts() == null) return chip('读取中…', 'neutral')
  const accounts = accountsOf(platform.id, platform.defaultEndpoint)
  const current = accounts.find((a) => a.current) ?? accounts[0]
  if (current) return chip(`已登录 · ${current.userName ?? current.account}`, 'success', 'check')
  return endpoint.guest ? chip('可游客浏览', 'info') : chip('未登录', 'neutral')
}

/**
 * 平台卡片。
 */
function platformCard(platform: PlatformMeta): HTMLElement {
  const status = h('span', { class: 'platform-card-status' }, loginChip(platform))
  const endpoint = platform.endpoints[platform.defaultEndpoint]
  const card = h(
    'a',
    { class: 'platform-card', href: `#/p/${platform.id}` },
    platformLogo(platform.id, 'md'),
    h('span', { class: 'platform-card-text' }, h('span', { class: 'platform-card-name' }, platform.name), h('span', { class: 'platform-card-sub' }, endpoint.status === 'available' ? `${endpoint.label ? `${endpointLabel(platform.defaultEndpoint, platform)} · ` : ''}${endpoint.commands.filter((c) => c.status === 'implemented').length} 项可用功能` : '暂未开放')),
    status,
  )
  card.dataset.platform = platform.id
  return card
}

/**
 * 最近任务。
 */
function recentJobs(jobs: JobSummary[]): HTMLElement {
  return h(
    'ul',
    { class: 'rows' },
    jobs.slice(0, RECENT_JOBS).map((job) => {
      const info = JOB_STATE_INFO[job.state]!
      return h(
        'li',
        { class: 'row' },
        job.request.platform ? platformLogo(job.request.platform, 'sm') : h('span', { class: 'row-icon' }, icon('terminal')),
        h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, h('a', { href: `#/jobs/${job.id}` }, taskTitle(job, getMeta().platforms.find((p) => p.id === job.request.platform))))),
        h('div', { class: 'row-side' }, chip(info.label, info.tone), h('span', { class: 'muted' }, relativeTime(job.started_at))),
      )
    }),
  )
}

/**
 * 首页：问候、吉祥物、平台网格、最近任务。
 */
export function homeView(main: HTMLElement, _route: Route): () => void {
  document.title = 'catbus 控制台'
  const meta = getMeta()
  const loggedIn = h('strong', null, '…')
  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'hero-text' },
      h('p', { class: 'hero-eyebrow' }, icon('ticket'), 'catbus 控制台'),
      h('h1', { class: 'hero-title' }, h('span', null, '上车，'), h('span', { class: 'hero-title-serif' }, '开往任何平台')),
      h('p', { class: 'hero-lead' }, '在一个地方搜索内容、管理账号、发布作品和查看消息。选择平台，找到你想做的事。'),
      h('ul', { class: 'hero-stats' }, h('li', null, h('strong', null, String(meta.platforms.length)), ' 个平台'), h('li', null, loggedIn, ' 个已登录'), h('li', null, h('strong', null, `v${meta.version}`))),
      h('div', { class: 'hero-actions' }, linkButton('管理账号', '#/accounts', { variant: 'primary', icon: 'users' }), linkButton('环境检查', '#/doctor', { variant: 'secondary', icon: 'pulse' })),
    ),
    h('div', { class: 'hero-art', 'aria-hidden': 'true' }, h('img', { src: 'app/img/mascot.png', alt: '' })),
  )
  const grid = h('div', { class: 'platform-grid' }, meta.platforms.map(platformCard))
  const jobsBox = h('div', null)
  append(
    main,
    hero,
    h('section', { class: 'section', 'aria-labelledby': 'home-platforms' }, h('h2', { class: 'section-title', id: 'home-platforms' }, '选择平台'), grid),
    h('section', { class: 'section', 'aria-labelledby': 'home-jobs' }, h('div', { class: 'section-head' }, h('h2', { class: 'section-title', id: 'home-jobs' }, '最近任务'), h('a', { href: '#/jobs', class: 'section-link' }, '全部任务', icon('chevronRight'))), jobsBox),
  )

  const update = () => {
    for (const card of grid.querySelectorAll<HTMLElement>('.platform-card')) {
      const platform = meta.platforms.find((p) => p.id === card.dataset.platform)!
      replace(card.querySelector('.platform-card-status')!, loginChip(platform))
    }
    const accounts = getAccounts()
    loggedIn.textContent = accounts == null ? '…' : String(new Set(accounts.map((a) => a.platform)).size)
  }
  update()
  const unsubscribe = onAccountsChange(update)
  void api.jobs().then(
    (jobs) => replace(jobsBox, jobs.length ? recentJobs(jobs) : h('p', { class: 'muted' }, '还没有执行过任务。选一个平台，从搜索开始吧。')),
    () => replace(jobsBox, h('p', { class: 'muted' }, '读取任务失败。')),
  )
  return unsubscribe
}
