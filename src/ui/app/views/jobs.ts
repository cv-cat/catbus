import type { JobSummary } from '../../shared/types.js'
import { api } from '../api.js'
import { taskTitle } from '../copy.js'
import { append, h, replace } from '../dom.js'
import { formatTime, relativeTime } from '../format.js'
import { icon } from '../icons.js'
import { attachJob } from '../job.js'
import { JOB_STATE_INFO } from '../labels.js'
import { ResultPanel } from '../result.js'
import type { Route } from '../router.js'
import { findCommand, findPlatform } from '../state.js'
import { callout, chip, copyButton, emptyState, linkButton, pageHeader, platformLogo, spinner } from '../ui.js'
import { editHref } from './command.js'

/**
 * 任务（AGENTS 4.13「任务」）：本次面板运行期间执行过的命令，离开页面后可以在这里找回结果。
 */

/** 列表里还有运行中的任务时，自动刷新的间隔。 */
const POLL_MS = 3000

/**
 * 任务列表的一行。
 */
function jobRow(job: JobSummary): HTMLElement {
  const info = JOB_STATE_INFO[job.state]!
  const platform = job.request.platform ? findPlatform(job.request.platform) : undefined
  return h(
    'li',
    { class: 'row' },
    platform ? platformLogo(platform.id, 'sm') : h('span', { class: 'row-icon' }, icon('terminal')),
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, h('a', { href: `#/jobs/${job.id}` }, taskTitle(job, platform))), h('p', { class: 'row-text' }, platform?.name ?? '工具与设置', ' · ', h('time', { datetime: job.started_at, title: formatTime(job.started_at) }, relativeTime(job.started_at)))),
    h('div', { class: 'row-side' }, job.state === 'running' ? h('span', { class: 'chip chip-info' }, spinner(), info.label) : chip(info.label, info.tone)),
  )
}

/**
 * 任务列表页。
 */
export function jobsView(main: HTMLElement, _route: Route): () => void {
  document.title = '任务 · catbus'
  const body = h('div', null, h('div', { class: 'loading-block' }, spinner(), '正在读取任务…'))
  append(main, pageHeader({ crumbs: [{ label: '首页', href: '#/' }, { label: '任务' }], title: '任务', subtitle: '查看本次使用期间的操作进度和结果。刷新页面不会丢失，停止运行 catbus 后清空。' }), body)
  let timer: number | null = null
  const load = async () => {
    try {
      const jobs = await api.jobs()
      replace(body, jobs.length ? h('ul', { class: 'rows card' }, jobs.map(jobRow)) : emptyState({ art: 'plane', title: '还没有任务', text: '搜索、发布或执行其他操作后，就可以在这里查看进度和结果。', actions: [linkButton('回到首页', '#/', { variant: 'primary', icon: 'home' })] }))
      timer = jobs.some((j) => j.state === 'running') ? window.setTimeout(load, POLL_MS) : null
    } catch (err) {
      replace(body, callout('danger', '读取任务失败', h('p', null, err instanceof Error ? err.message : String(err))))
    }
  }
  void load()
  return () => {
    if (timer != null) window.clearTimeout(timer)
  }
}

/**
 * 单个任务：重新接上事件流，展示结果；可以复制命令、回到表单再编辑。
 */
export function jobDetailView(main: HTMLElement, route: Route): () => void {
  const id = route.path[1]!
  document.title = '任务详情 · catbus'
  const box = h('div', null, h('div', { class: 'loading-block' }, spinner(), '正在读取任务…'))
  append(main, box)
  let panel: ResultPanel | null = null
  void attachJob(id).then(
    (handle) => {
      const summary = handle.snapshot.summary
      const platform = summary.request.platform ? findPlatform(summary.request.platform) : undefined
      const command = platform && summary.request.action ? findCommand(platform, summary.request.endpoint, summary.request.resource, summary.request.action) : undefined
      panel = new ResultPanel({ platform: platform ?? null, endpoint: summary.request.endpoint, account: summary.request.account, command: command ?? null, raw: summary.request.raw }, command ?? null)
      const edit = platform && command ? linkButton('回到表单', editHref(summary.request, command), { variant: 'secondary', icon: 'arrowLeft', size: 'sm' }) : null
      replace(
        box,
        pageHeader({
          crumbs: [{ label: '首页', href: '#/' }, { label: '任务', href: '#/jobs' }, { label: '任务详情' }],
          lead: platform ? platformLogo(platform.id, 'lg') : null,
          title: taskTitle(summary, platform),
          subtitle: h('span', { class: 'mono' }, summary.command),
          actions: [copyButton(() => summary.command, '复制命令'), edit],
        }),
        panel.element,
      )
      void panel.track(handle, false)
    },
    () => replace(box, emptyState({ art: 'bus', title: '找不到这个任务', text: '操作记录只在本次使用期间保留，重新启动 catbus 后会清空。', actions: [linkButton('全部任务', '#/jobs', { variant: 'primary', icon: 'tasks' })] })),
  )
  return () => panel?.dispose()
}
