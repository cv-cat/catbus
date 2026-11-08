import { displayCommand } from '../../shared/request.js'
import { ENDPOINT_NAMES, type EndpointName, type OptionMeta, type RunRequest } from '../../shared/types.js'
import { commandNote, endpointLabel } from '../copy.js'
import { append, h, replace, uid } from '../dom.js'
import { collectFields, type Field, optionField } from '../form.js'
import { withName } from '../format.js'
import { icon } from '../icons.js'
import { type JobHandle, type JobSnapshot, startJob } from '../job.js'
import { field, str } from '../json.js'
import { METHOD_INFO } from '../labels.js'
import { errorView, lastMatching, qrcodeBlock } from '../result.js'
import type { Route } from '../router.js'
import { accountsOf, findCommand, findPlatform, getMeta, getSelection, refreshAccounts, setSelection } from '../state.js'
import { ticket } from '../ticket.js'
import { button, callout, card, emptyState, linkButton, pageHeader, platformLogo, spinner } from '../ui.js'
import { notFoundView } from './not-found.js'

/**
 * 登录（AGENTS 5.3）：按登录方式只显示相关字段；扫码时显示二维码；短信、mteam 邮箱验证码分两步（非 TTY 流程）。
 */

/** 每种登录方式用到的选项（AGENTS 5.3 的表格）；平台没有声明的选项不显示。 */
const METHOD_FIELDS: Record<string, string[]> = {
  qrcode: [],
  sms: ['phone', 'code', 'sso'],
  password: ['username', 'password-stdin', 'email', 'code', 'mfa-method', 'captcha', 'undelete'],
  cookie: ['cookie'],
  oauth: [],
  apikey: ['api-key-stdin'],
  token: ['token-stdin'],
}
/** 只在验证码发出之后才出现的字段。 */
const SECOND_STEP_FIELDS: Record<string, string[]> = { sms: ['code'] }
/** 第一步用来发验证码的字段，第二步不再提交（AGENTS 5.3「sms」与 mteam 的两步验证）。 */
const SEND_FIELDS = ['phone', 'email']
/** 不放进表单的选项：方式、子站点单独处理；文件形式的凭证在面板里用输入框代替。 */
const HIDDEN_FLAGS = ['method', 'scope', 'api-key-file', 'token-file']
const DEFAULT_ACCOUNT = 'default'
const ACCOUNT_PATTERN = '[a-z0-9][a-z0-9_-]{0,31}'

/**
 * 登录方式卡片（单选组）。
 */
function methodCards(methods: string[], selected: string, onChange: (method: string) => void): HTMLElement {
  const name = uid('method')
  return h(
    'div',
    { class: 'method-cards', role: 'radiogroup', 'aria-label': '登录方式' },
    methods.map((m) => {
      const info = METHOD_INFO[m] ?? { label: m, description: '', icon: 'key' as const }
      const input = h('input', { type: 'radio', name, value: m, class: 'method-input', checked: m === selected })
      input.addEventListener('change', () => onChange(m))
      return h('label', { class: 'method-card' }, input, h('span', { class: 'method-icon' }, icon(info.icon)), h('span', { class: 'method-text' }, h('span', { class: 'method-label' }, info.label), h('span', { class: 'method-desc' }, info.description)))
    }),
  )
}

/**
 * 登录成功后的结果卡。
 */
function successCard(platformId: string, platformName: string, snapshot: JobSnapshot): HTMLElement {
  const data = snapshot.envelope?.data ?? null
  const user = field(data, 'user')
  return h(
    'div',
    { class: 'login-success' },
    h('span', { class: 'login-success-badge', 'aria-hidden': 'true' }, icon('sparkle'), icon('check')),
    h('h2', { class: 'login-success-title' }, withName('已登录', platformName)),
    h('p', null, `${str(user, 'name') ?? str(user, 'id') ?? '（未知用户）'} · 账号备注 `, h('code', null, str(data, 'account') ?? '')),
    h('div', { class: 'callout-actions' }, linkButton(withName('去使用', platformName), `#/p/${platformId}`, { variant: 'primary', icon: 'chevronRight' }), linkButton('查看所有账号', '#/accounts', { variant: 'secondary', icon: 'users' })),
  )
}

/**
 * 登录页。
 */
export function loginView(main: HTMLElement, route: Route): (() => void) | void {
  const platform = findPlatform(route.path[1]!)
  if (!platform) return notFoundView(main, route)
  const queryEndpoint = route.query.get('e') as EndpointName | null
  if (queryEndpoint && ENDPOINT_NAMES.includes(queryEndpoint)) setSelection(platform.id, { ...getSelection(platform.id), endpoint: queryEndpoint })
  const endpoint = getSelection(platform.id).endpoint
  const command = findCommand(platform, endpoint, 'auth', 'login')
  document.title = `${withName('登录', platform.name)} · catbus`
  const header = pageHeader({ crumbs: [{ label: '首页', href: '#/' }, { label: platform.name, href: `#/p/${platform.id}` }, { label: '登录' }], lead: platformLogo(platform.id, 'lg'), title: withName('登录', platform.name), subtitle: `${endpointLabel(endpoint, platform)} · 登录信息会保存在这台电脑上。` })
  const ep = platform.endpoints[endpoint]
  if (!command || ep.status !== 'available') {
    append(main, header, emptyState({ art: 'bus', title: ep.status === 'available' ? '这个平台不需要登录' : `${endpointLabel(endpoint, platform)}暂未开放`, actions: [linkButton(withName('去使用', platform.name), `#/p/${platform.id}`, { variant: 'primary' })] }))
    return
  }

  const options = new Map(command.options.map((o) => [o.flag, o]))
  const fields = new Map<string, Field>()
  for (const o of command.options) if (!HIDDEN_FLAGS.includes(o.flag)) fields.set(o.flag, optionField(o, { cwd: getMeta().cwd }))
  const methodFlags = new Set(Object.values(METHOD_FIELDS).flat())
  const otherFlags = [...fields.keys()].filter((f) => !methodFlags.has(f))

  let method = route.query.get('method') ?? ep.login.default ?? ep.login.methods[0]!
  let step: 'start' | 'verify' = 'start'
  let running: JobHandle | null = null

  const current = accountsOf(platform.id, endpoint).find((a) => a.current)
  const accountId = uid('account')
  const accountInput = h('input', { id: accountId, class: 'input', value: route.query.get('acct') ?? current?.account ?? DEFAULT_ACCOUNT, pattern: ACCOUNT_PATTERN, autocomplete: 'off', spellcheck: 'false' })
  const accountField = h('div', { class: 'field' }, h('div', { class: 'field-label-row' }, h('label', { class: 'field-label', for: accountId }, '账号备注')), accountInput, h('p', { class: 'field-help' }, '用来区分同一平台的多个账号，不会修改平台昵称。1～32 位，以小写字母或数字开头，可包含 _ 和 -。'))
  const scopeSelect = ep.login.scopes.length ? h('select', { class: 'input select', id: uid('scope') }, h('option', { value: '' }, '普通浏览'), ep.login.scopes.map((s) => h('option', { value: s }, s === 'creator' ? '创作者中心' : s))) : null
  const scopeField = scopeSelect ? h('div', { class: 'field' }, h('div', { class: 'field-label-row' }, h('label', { class: 'field-label', for: scopeSelect.id }, '登录用途')), scopeSelect, h('p', { class: 'field-help' }, '创作者中心可能需要单独登录，按这次要使用的功能选择。')) : null

  const fieldsBox = h('div', { class: 'form-grid' })
  const moreBox = otherFlags.length ? h('details', { class: 'advanced' }, h('summary', null, icon('chevronRight', 'icon advanced-chevron'), '更多选项'), h('div', { class: 'form-grid' }, otherFlags.map((f) => fields.get(f)!.element))) : null
  const tk = ticket()
  const startButton = button('开始登录', { variant: 'primary', icon: 'play', attrs: { class: 'run-button' } })
  const stepNote = h('p', { class: 'run-hint muted', 'aria-live': 'polite' })
  const statusBox = h('div', { class: 'login-status', 'aria-live': 'polite' })

  /**
   * 当前方式、当前步骤下显示的字段。
   */
  const visibleFlags = (): string[] => {
    const all = (METHOD_FIELDS[method] ?? []).filter((f) => fields.has(f))
    const later = SECOND_STEP_FIELDS[method] ?? []
    return step === 'start' ? all.filter((f) => !later.includes(f)) : all
  }

  /**
   * 组装请求：第二步不再提交发码用的字段。
   */
  const buildRequest = (validate: boolean): { request: RunRequest; stdin: string | null } | null => {
    const flags = visibleFlags().filter((f) => step === 'start' || !SEND_FIELDS.includes(f))
    const shown = [...flags, ...otherFlags].map((f) => fields.get(f)!)
    const metas = [...flags, ...otherFlags].map((f) => options.get(f)!).filter((o): o is OptionMeta => o != null)
    const collected = collectFields(shown, metas, validate)
    if (!collected) return null
    const account = accountInput.value.trim()
    if (validate && !new RegExp(`^${ACCOUNT_PATTERN}$`).test(account)) {
      accountInput.setAttribute('aria-invalid', 'true')
      accountInput.focus()
      stepNote.textContent = '账号备注需为 1～32 位，只能用小写字母、数字、_ 和 -，并以字母或数字开头。'
      return null
    }
    accountInput.removeAttribute('aria-invalid')
    const opts = { ...collected.options }
    if (method !== ep.login.default) opts.method = method
    if (scopeSelect?.value) opts.scope = scopeSelect.value
    return {
      request: { platform: platform.id, endpoint, resource: 'auth', action: 'login', args: [], options: opts, account: account || null, raw: false, verbose: false, proxy: null, yes: false },
      stdin: collected.stdin,
    }
  }

  const updateTicket = () => {
    const built = buildRequest(false)
    if (built) tk.update(displayCommand(built.request, platform.defaultEndpoint), built.stdin != null ? '密码、密钥等内容不会显示在这条命令或任务记录中。' : null)
  }

  const renderFields = () => {
    replace(fieldsBox, visibleFlags().map((f) => fields.get(f)!.element))
    const label = step === 'verify' ? '完成登录' : method === 'sms' ? '发送验证码' : '开始登录'
    startButton.querySelector('.btn-label')!.textContent = label
    stepNote.textContent = step === 'verify' ? '验证码已发送，收到后填进来完成登录（10 分钟内有效）。' : method === 'qrcode' ? '点击后会生成二维码，用手机 App 扫码确认。' : ''
    updateTicket()
  }

  const renderIdle = () =>
    replace(statusBox, emptyState({ art: 'mascot', title: '准备好就出发', text: method === 'qrcode' ? '二维码会出现在这里。' : '登录进度会显示在这里。' }))

  /**
   * 跟踪登录任务：二维码、进度、两步验证、成功、失败。
   */
  const follow = async (handle: JobHandle) => {
    const stop = button('取消登录', { variant: 'secondary', icon: 'stop', size: 'sm' })
    stop.addEventListener('click', () => {
      stop.disabled = true
      void handle.stop()
    })
    await handle.follow((s) => {
      if (s.state !== 'running') return
      const hint = lastMatching(s.logs, '扫码') ?? lastMatching(s.logs, '浏览器')
      replace(
        statusBox,
        s.qrcodeVersion != null ? qrcodeBlock(s.summary.id, s.qrcodeVersion, hint) : h('div', { class: 'login-waiting' }, spinner(), h('p', null, s.logs.at(-1)?.replace(/^\[catbus\] /, '') ?? '正在连接平台…')),
        h('div', { class: 'login-status-actions' }, stop),
      )
    })
    const s = handle.snapshot
    const data = s.envelope?.data ?? null
    if (s.envelope?.ok && field(data, 'sent') === true) {
      step = 'verify'
      renderFields()
      replace(statusBox, callout('success', '验证码已发送', h('p', null, `发送到 ${str(data, 'phone') ?? str(data, 'verify') ?? '你的手机或邮箱'}。填写验证码后点「完成登录」。`)))
      fields.get('code')?.focus()
    } else if (s.envelope?.ok) {
      step = 'start'
      renderFields()
      replace(statusBox, successCard(platform.id, platform.name, s))
      void refreshAccounts()
    } else if (s.state === 'stopped') {
      replace(statusBox, callout('info', '已取消登录', h('p', null, '没有保存新的登录信息。')))
    } else if (s.envelope?.error) {
      replace(statusBox, errorView(s.envelope.error, { loginHref: null, readOnly: true }))
    } else {
      replace(statusBox, callout('danger', '登录没有完成', h('pre', { class: 'logs' }, s.logs.slice(-5).join('\n'))))
    }
  }

  startButton.addEventListener('click', async () => {
    if (running) return
    const built = buildRequest(true)
    if (!built) return
    startButton.disabled = true
    try {
      running = await startJob(built.request, built.stdin)
      await follow(running)
    } catch (err) {
      replace(statusBox, callout('danger', '没能开始登录', h('p', null, err instanceof Error ? err.message : String(err))))
    } finally {
      running = null
      startButton.disabled = false
    }
  })

  const methods = methodCards(ep.login.methods, method, (m) => {
    method = m
    step = 'start'
    renderFields()
    renderIdle()
  })
  const form = card(
    { class: 'command-form' },
    h('h2', { class: 'card-title' }, '登录方式'),
    methods,
    h('div', { class: 'form-grid' }, accountField, scopeField),
    fieldsBox,
    moreBox,
    tk.element,
    h('div', { class: 'run-bar' }, startButton, stepNote),
  )
  form.addEventListener('input', updateTicket)
  form.addEventListener('change', updateTicket)
  const note = commandNote(platform.id, command)
  append(main, header, note ? callout('info', '登录说明', h('p', null, note)) : null, h('div', { class: 'command-layout' }, form, h('div', { class: 'command-result' }, card({ class: 'login-panel' }, statusBox))))
  renderFields()
  renderIdle()
  return () => running?.detach()
}
