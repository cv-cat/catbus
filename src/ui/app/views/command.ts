import { displayCommand } from '../../shared/request.js'
import { ENDPOINT_NAMES, type CommandMeta, type EndpointName, type PlatformMeta, type RunRequest } from '../../shared/types.js'
import { commandNote, commandTitle, endpointLabel } from '../copy.js'
import { confirmDialog } from '../dialog.js'
import { append, h } from '../dom.js'
import { commandForm, type Collected, type FieldValue } from '../form.js'
import { attachJob, type JobHandle, startJob } from '../job.js'
import { autoRuns } from '../render.js'
import { ResultPanel } from '../result.js'
import { ARG_PARAM, href, OPTION_PARAM, type Route } from '../router.js'
import { findCommand, findPlatform, getMemory, getMeta, getSelection, onAccountsChange, refreshAccounts, setMemory, setSelection } from '../state.js'
import { ticket } from '../ticket.js'
import { button, callout, card, chip, pageHeader, platformLogo } from '../ui.js'
import { notFoundView } from './not-found.js'
import { accountPicker, resourceLabel } from './platform.js'

/**
 * 从链接里取预填值（下一步链接、任务页「再编辑」）。
 */
function prefillFromQuery(command: CommandMeta, query: URLSearchParams): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  command.args.forEach((arg, i) => {
    const v = query.get(`${ARG_PARAM}${i}`)
    if (v != null) values[`arg:${arg.name}`] = v
  })
  for (const option of command.options) {
    const all = query.getAll(`${OPTION_PARAM}${option.flag}`)
    if (!all.length) continue
    values[option.flag] = option.kind === 'array' ? all : option.kind === 'boolean' ? all[0] === 'true' : all[0]!
  }
  return values
}

/**
 * 链接到某条命令、带上已有请求的值（任务页「再编辑」用）。
 */
export function editHref(request: RunRequest, command: CommandMeta): string {
  const query: Record<string, string | null> = { e: request.endpoint, acct: request.account }
  request.args.forEach((a, i) => (query[`${ARG_PARAM}${i}`] = a))
  const params = new URLSearchParams()
  for (const [flag, value] of Object.entries(request.options)) {
    if (flag === 'cursor') continue
    for (const v of Array.isArray(value) ? value : [String(value)]) params.append(`${OPTION_PARAM}${flag}`, v)
  }
  const base = href(['p', request.platform!, command.resource, command.action], query)
  const extra = params.toString()
  return extra ? `${base}${base.includes('?') ? '&' : '?'}${extra}` : base
}

/**
 * 命令的特征标签：需要登录、需要确认、实时、分页。
 */
function commandBadges(platform: PlatformMeta, endpoint: EndpointName, command: CommandMeta): HTMLElement {
  const ep = platform.endpoints[endpoint]
  return h(
    'div',
    { class: 'badges' },
    ep.status === 'available' && ep.guest ? chip(command.auth === 'required' ? '需要登录' : '游客可用', command.auth === 'required' ? 'neutral' : 'info', command.auth === 'required' ? 'lock' : undefined) : null,
    command.confirm === 'always' ? chip('危险操作 · 执行前确认', 'warning', 'alert') : command.confirm === 'conditional' ? chip('部分情况需确认', 'warning', 'alert') : null,
    command.stream ? chip('实时 · 可停止', 'info', 'bolt') : null,
    command.paged ? chip('可加载更多', 'neutral') : null,
  )
}

/**
 * 命令页：左边表单与车票，右边结果。危险操作先不带 -y 执行，CLI 要求确认时弹框，确认后带 -y 重跑（AGENTS 4.13）。
 */
export function commandView(main: HTMLElement, route: Route): (() => void) | void {
  const platform = findPlatform(route.path[1]!)
  const [, , resource, action] = route.path
  const queryEndpoint = route.query.get('e') as EndpointName | null
  if (platform && queryEndpoint && ENDPOINT_NAMES.includes(queryEndpoint)) setSelection(platform.id, { ...getSelection(platform.id), endpoint: queryEndpoint })
  if (platform && route.query.has('acct')) setSelection(platform.id, { ...getSelection(platform.id), account: route.query.get('acct') || null })
  if (!platform) return notFoundView(main, route)
  const endpoint = getSelection(platform.id).endpoint
  const command = findCommand(platform, endpoint, resource!, action!)
  if (!command) return notFoundView(main, route)
  const title = commandTitle(command)
  const note = commandNote(platform.id, command)
  document.title = `${title} · ${platform.name} · catbus`

  const memoryKey = `${platform.id}/${endpoint}/${command.resource}/${command.action}`
  const form = commandForm(command, { cwd: getMeta().cwd })
  const memory = getMemory(memoryKey)
  const prefill = prefillFromQuery(command, route.query)
  if (Object.keys(prefill).length) form.restore(prefill)
  else if (memory) form.restore(memory.values)

  const ctx = () => ({ platform, endpoint, account: getSelection(platform.id).account, command, raw: false })
  let jobIds: string[] = Object.keys(prefill).length ? [] : (memory?.jobIds ?? [])
  let lastCollected: Collected | null = null
  let running = false

  const requestFrom = (collected: Collected, extra: { yes?: boolean; cursor?: string } = {}): RunRequest => ({
    platform: platform.id,
    endpoint,
    resource: command.resource,
    action: command.action,
    args: collected.args,
    options: extra.cursor ? { ...collected.options, cursor: extra.cursor } : collected.options,
    account: getSelection(platform.id).account,
    raw: collected.raw,
    verbose: collected.verbose,
    proxy: collected.proxy,
    yes: extra.yes ?? false,
  })

  const tk = ticket()
  const updateTicket = () => {
    const collected = form.collect(false)
    if (!collected) return
    tk.update(displayCommand(requestFrom(collected), platform.defaultEndpoint), collected.stdin != null ? '密码、密钥等内容不会显示在这条命令或任务记录中。' : null)
  }
  form.element.addEventListener('input', updateTicket)
  form.element.addEventListener('change', updateTicket)
  form.element.addEventListener('click', () => requestAnimationFrame(updateTicket))

  const result = new ResultPanel(ctx(), command, {
    onLoadMore: (cursor) => void run({ cursor }),
    onRetry: () => void run({}),
  })

  const runButton = button(command.status === 'planned' ? '暂未开放' : '运行', { variant: command.confirm === 'always' ? 'danger' : 'primary', icon: command.confirm === 'always' ? 'alert' : 'play', attrs: { class: 'run-button', disabled: command.status === 'planned' } })
  const runHint = h('p', { class: 'run-hint muted' }, command.status === 'planned' ? '这项功能暂时无法使用。' : command.confirm === 'always' ? '此操作执行前会请你再次确认。' : h('span', null, h('kbd', null, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'), ' + ', h('kbd', null, 'Enter'), ' 也可以运行'))

  /**
   * 执行一次：校验 → 起任务 → 跟踪 → 需要确认时弹框重跑。
   */
  const run = async (extra: { cursor?: string; yes?: boolean }) => {
    if (running || command.status === 'planned') return
    const collected = extra.cursor && lastCollected ? lastCollected : form.collect(true)
    if (!collected) return
    lastCollected = collected
    running = true
    runButton.disabled = true
    runButton.querySelector('.btn-label')!.textContent = '运行中…'
    try {
      if (command.resource === 'auth' && command.action === 'logout' && !extra.yes) {
        const confirmed = await confirmDialog({
          title: `退出 ${platform.name} 登录？`,
          danger: true,
          confirmLabel: '退出登录',
          body: [h('p', null, '将移除这个账号在本机保存的登录信息，之后使用时需要重新登录。这不会注销平台账号。'), h('pre', { class: 'dialog-command' }, displayCommand(requestFrom(collected), platform.defaultEndpoint))],
        })
        if (!confirmed) {
          result.showCancelled('已取消退出，账号仍保持登录。')
          return
        }
        extra = { ...extra, yes: true }
      }
      const handle = await startJob(requestFrom(collected, extra), collected.stdin)
      jobIds = extra.cursor ? [...jobIds, handle.id] : [handle.id]
      setMemory(memoryKey, { values: form.values(), jobIds })
      const snapshot = await result.track(handle, extra.cursor != null)
      if (snapshot.envelope?.error?.code === 'CONFIRM_REQUIRED' && !extra.yes) {
        const ok = await confirmDialog({
          title: '确认执行这个操作？',
          danger: true,
          confirmLabel: title.split(/[，；]/)[0]!,
          body: [h('p', null, `即将执行“${title}”，请核对下面的操作和对象：`), h('pre', { class: 'dialog-command' }, displayCommand(requestFrom(collected), platform.defaultEndpoint)), h('p', { class: 'muted' }, '确认后立即执行。删除、撤回等操作通常不能恢复。')],
        })
        running = false
        if (ok) return void (await run({ ...extra, yes: true }))
        result.showCancelled('你取消了确认，这个操作没有执行。')
      }
      if (command.resource === 'auth' && snapshot.envelope?.ok) void refreshAccounts()
    } catch (err) {
      append(result.element, callout('danger', '没能开始执行', h('p', null, err instanceof Error ? err.message : String(err))))
    } finally {
      running = false
      runButton.disabled = false
      runButton.querySelector('.btn-label')!.textContent = '运行'
    }
  }

  runButton.addEventListener('click', () => void run({}))
  form.element.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing) {
      e.preventDefault()
      void run({})
    }
  })

  const identity = h('div', { class: 'identity' })
  const renderIdentity = () => {
    const ep = platform.endpoints[endpoint]
    identity.replaceChildren(
      ep.status === 'available' && ep.login.methods.length ? accountPicker(platform, { endpoint, account: getSelection(platform.id).account }, (account) => {
        setSelection(platform.id, { endpoint, account })
        updateTicket()
      }) : h('span', { class: 'muted' }, '不需要登录'),
      h('span', { class: 'chip chip-neutral' }, endpointLabel(endpoint, platform)),
    )
  }
  renderIdentity()

  append(
    main,
    pageHeader({
      crumbs: [{ label: '首页', href: '#/' }, { label: platform.name, href: `#/p/${platform.id}` }, { label: resourceLabel(platform, command.resource), href: `#/p/${platform.id}` }, { label: title }],
      lead: platformLogo(platform.id, 'lg'),
      title,
      actions: [commandBadges(platform, endpoint, command)],
    }),
    note ? callout('info', '使用说明', h('p', null, note)) : null,
    h(
      'div',
      { class: 'command-layout' },
      card({ class: 'command-form' }, identity, form.element, tk.element, h('div', { class: 'run-bar' }, runButton, runHint)),
      h('div', { class: 'command-result' }, result.element),
    ),
  )
  updateTicket()

  const unsubscribe = onAccountsChange(renderIdentity)
  let attached: JobHandle[] = []
  if (jobIds.length) {
    void (async () => {
      for (const [i, id] of jobIds.entries()) {
        const handle = await attachJob(id).catch(() => null)
        if (!handle) break
        attached.push(handle)
        await result.track(handle, i > 0)
      }
    })()
  } else if (route.query.get('run') === '1' && autoRuns(command)) void run({})

  return () => {
    setMemory(memoryKey, { values: form.values(), jobIds })
    unsubscribe()
    result.dispose()
    for (const handle of attached) handle.detach()
    attached = []
  }
}
