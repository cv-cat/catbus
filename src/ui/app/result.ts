import type { CommandMeta } from '../shared/types.js'
import { api } from './api.js'
import { inputDescription } from './copy.js'
import { type Child, h, linkify, replace } from './dom.js'
import { formatCount, formatElapsed } from './format.js'
import { icon } from './icons.js'
import type { JobHandle, JobSnapshot } from './job.js'
import { type Envelope, type EnvelopeError, type Json, type Page, prettyJson } from './json.js'
import { ERROR_INFO, JOB_STATE_INFO } from './labels.js'
import { eventRow, isReadAction, messageRow, outputBase, type RenderContext, renderData } from './render.js'
import { href } from './router.js'
import { button, callout, chip, emptyState, linkButton, spinner } from './ui.js'

/**
 * 结果面板：状态、计时、结果 / 日志 / JSON 三个标签页、停止、加载更多、错误与恢复路径（intent-ui 状态与反馈）。
 */

type Tab = 'result' | 'logs' | 'json'

export interface ResultHooks {
  /** 分页命令：用上一页的 cursor 取下一页。 */
  onLoadMore?(cursor: string): void
  /** 只读命令网络出错后重试。 */
  onRetry?(): void
}

/** 计时刷新间隔。 */
const TICK_MS = 1000
/** JSON 标签页里最多展示的流式条目，避免长连接把页面拖慢。 */
const MAX_JSON_ITEMS = 200
/** 离底部多近算「在底部」：在底部时新事件自动滚动。 */
const STICKY_BOTTOM_PX = 48
/** 骨架屏的占位块数。 */
const SKELETON_BLOCKS = 3

/**
 * 最后一行包含关键字的日志（例如「请用 App 扫码」），没有时为 null。
 */
export function lastMatching(lines: string[], keyword: string): string | null {
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.includes(keyword)) return lines[i]!.replace(/^\[catbus\] /, '').replace(/。二维码图片：.*$/, '')
  return null
}

/**
 * 登录二维码：随任务更新。
 */
export function qrcodeBlock(jobId: string, version: number, hint: string | null): HTMLElement {
  return h(
    'figure',
    { class: 'qrcode' },
    h('div', { class: 'qrcode-frame' }, h('img', { src: api.qrcodeUrl(jobId, version), alt: '登录二维码', width: 220, height: 220 })),
    h('figcaption', null, icon('scan'), hint ?? '请用手机 App 扫码，并在手机上确认'),
  )
}

/**
 * 错误码对应的说明与下一步。
 */
export function errorView(error: EnvelopeError, options: { loginHref: string | null; readOnly: boolean; onRetry?: () => void }): HTMLElement {
  const info = ERROR_INFO[error.code] ?? ERROR_INFO.ERROR!
  const unknownResult = error.code === 'NETWORK' && !options.readOnly
  const explainFirst = ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'NETWORK', 'UNSUPPORTED', 'NOT_IMPLEMENTED', 'RISK_CONTROL'].includes(error.code)
  const commandHint = error.hint != null && /^catbus /.test(error.hint)
  const actions: Child[] = []
  if ((error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_EXPIRED') && options.loginHref) actions.push(linkButton('去登录', options.loginHref, { variant: 'primary', icon: 'key', size: 'sm' }))
  if (error.code === 'NETWORK' && options.readOnly && options.onRetry) {
    const retry = button('重试', { variant: 'secondary', icon: 'refresh', size: 'sm' })
    retry.addEventListener('click', options.onRetry)
    actions.push(retry)
  }
  return callout(
    unknownResult ? 'warning' : 'danger',
    unknownResult ? '结果未知' : info.title,
    h('p', { class: 'error-message' }, explainFirst ? info.description : inputDescription(error.message)),
    unknownResult ? h('p', null, '操作可能已经生效。先到平台上确认，再决定要不要重新执行，避免重复操作。') : explainFirst ? null : h('p', { class: 'muted' }, info.description),
    error.hint && !commandHint ? h('p', { class: 'error-hint' }, h('span', { class: 'muted' }, '建议：'), inputDescription(error.hint)) : null,
    actions.length ? h('div', { class: 'callout-actions' }, actions) : null,
    h('details', { class: 'error-detail' }, h('summary', null, '排查详情'), h('p', null, error.message), commandHint ? h('pre', { class: 'dialog-command' }, error.hint) : null, error.detail != null ? prettyJson(JSON.stringify(error.detail)) : null),
  )
}

export class ResultPanel {
  readonly element: HTMLElement
  private readonly status = h('div', { class: 'result-status', 'aria-live': 'polite' })
  private readonly actions = h('div', { class: 'result-actions' })
  private readonly tabs: Record<Tab, HTMLButtonElement>
  private readonly panel = h('div', { class: 'result-panel', role: 'tabpanel', tabindex: '0' })
  private readonly footer = h('footer', { class: 'result-footer' })
  private tab: Tab = 'result'
  private current: JobSnapshot | null = null
  private handle: JobHandle | null = null
  /** 已成功的各页数据（分页命令「加载更多」时累加）。 */
  private pages: { data: Json; envelopeText: string | null }[] = []
  private lastPage: Page | null = null
  private appendError: Envelope | null = null
  private timer: number | null = null
  private cancelled = false
  private streamList: HTMLOListElement | null = null
  private renderedItems = 0
  private stickToBottom = true

  constructor(
    private readonly ctx: RenderContext,
    private readonly command: CommandMeta | null,
    private readonly hooks: ResultHooks = {},
  ) {
    const tabIds = { result: '结果', logs: '运行记录', json: '原始数据' } as const
    const panelId = `result-panel-${Math.random().toString(36).slice(2)}`
    this.panel.id = panelId
    this.tabs = Object.fromEntries(
      (Object.keys(tabIds) as Tab[]).map((t) => [
        t,
        h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-controls': panelId, id: `${panelId}-${t}`, on: { click: () => this.select(t) } }, tabIds[t]),
      ]),
    ) as Record<Tab, HTMLButtonElement>
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': '结果视图' }, Object.values(this.tabs))
    tablist.addEventListener('keydown', (e) => this.onTabKey(e))
    this.element = h('section', { class: 'card result', 'aria-label': '执行结果' }, h('header', { class: 'result-head' }, this.status, this.actions), tablist, this.panel, this.footer)
    this.select('result', false)
    this.idle()
  }

  /**
   * 标签页的方向键切换（APG Tabs，内容是本地的，自动激活）。
   */
  private onTabKey(e: KeyboardEvent): void {
    const order: Tab[] = ['result', 'logs', 'json']
    const index = order.indexOf(this.tab)
    const next = e.key === 'ArrowRight' ? order[(index + 1) % order.length] : e.key === 'ArrowLeft' ? order[(index + order.length - 1) % order.length] : e.key === 'Home' ? order[0] : e.key === 'End' ? order.at(-1) : null
    if (!next) return
    e.preventDefault()
    this.select(next)
    this.tabs[next].focus()
  }

  /**
   * 切换标签页。
   */
  private select(tab: Tab, render = true): void {
    this.tab = tab
    for (const [t, el] of Object.entries(this.tabs)) {
      el.setAttribute('aria-selected', String(t === tab))
      el.tabIndex = t === tab ? 0 : -1
    }
    this.panel.setAttribute('aria-labelledby', this.tabs[tab].id)
    this.streamList = null
    this.renderedItems = 0
    if (render) this.render()
  }

  /**
   * 还没有执行时的占位。
   */
  idle(): void {
    this.current = null
    this.pages = []
    replace(this.status, chip('等待出发', 'neutral', 'ticket'))
    replace(this.actions)
    replace(this.footer)
    replace(this.panel, emptyState({ art: 'plane', title: '准备好后，点「运行」开始', text: '先填写标为“必填”的内容，完成后可在这里查看结果。' }))
  }

  /**
   * 用户取消了危险操作的确认：说明没有执行。
   */
  showCancelled(message: string): void {
    this.cancelled = true
    replace(this.status, chip('已取消', 'neutral'))
    replace(this.panel, callout('info', '已取消，没有执行', h('p', null, message)))
  }

  /**
   * 跟踪一个任务直到结束。append 为 true 时，成功的数据接在已有结果后面（加载更多）。
   */
  async track(handle: JobHandle, append: boolean): Promise<JobSnapshot> {
    this.handle?.detach()
    this.handle = handle
    this.current = handle.snapshot
    this.cancelled = false
    if (!append) {
      this.pages = []
      this.lastPage = null
      this.streamList = null
      this.renderedItems = 0
    }
    this.appendError = null
    this.startTimer()
    // 有些操作连接成功前没有任何输出，不能等第一条日志才显示运行状态。
    this.render()
    let scheduled = false
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        this.render()
      })
    }
    await handle.follow((snapshot) => {
      this.current = snapshot
      schedule()
    })
    const snapshot = handle.snapshot
    this.current = snapshot
    this.stopTimer()
    if (snapshot.envelope?.ok) {
      this.pages.push({ data: snapshot.envelope.data, envelopeText: snapshot.envelopeText })
      this.lastPage = snapshot.envelope.page
    } else if (append) this.appendError = snapshot.envelope
    this.render()
    return snapshot
  }

  /**
   * 停止前确认任务可以停止（长连接、等待中的登录）。
   */
  private stopButton(): HTMLButtonElement | null {
    const handle = this.handle
    const s = this.current
    if (!handle || !s || s.state !== 'running' || !s.summary.stoppable) return null
    const btn = button(this.command?.stream ? '停止接收' : '停止', { variant: 'secondary', icon: 'stop', size: 'sm' })
    btn.addEventListener('click', () => {
      btn.disabled = true
      void handle.stop().catch(() => (btn.disabled = false))
    })
    return btn
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = window.setInterval(() => this.renderStatus(), TICK_MS)
  }

  private stopTimer(): void {
    if (this.timer != null) window.clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 状态行：状态、耗时、使用的账号。
   */
  private renderStatus(): void {
    const s = this.current
    if (!s) return
    const info = JOB_STATE_INFO[s.state]!
    const start = new Date(s.summary.started_at).getTime()
    const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now()
    const account = s.envelope?.account ?? s.summary.request.account
    replace(
      this.status,
      s.state === 'running' ? h('span', { class: 'chip chip-info' }, spinner('运行中'), info.label) : chip(info.label, info.tone, s.state === 'succeeded' ? 'check' : s.state === 'failed' ? 'alert' : undefined),
      h('span', { class: 'muted' }, formatElapsed(Math.max(0, end - start))),
      account ? h('span', { class: 'muted' }, account === 'guest' ? '未登录浏览' : `账号 ${account}`) : null,
    )
    replace(this.actions, this.stopButton())
  }

  /**
   * 按当前标签页重画。长连接的结果页只追加新条目，不整页重画。
   */
  private render(): void {
    this.renderStatus()
    const s = this.current
    this.tabs.logs.textContent = s?.logs.length ? `运行记录 ${s.logs.length}` : '运行记录'
    if (this.cancelled) return
    if (!s) return this.idle()
    if (this.tab === 'logs') return this.renderLogs(s)
    if (this.tab === 'json') return this.renderJson(s)
    if (this.command?.stream) return this.renderStream(s)
    this.renderResult(s)
  }

  /**
   * 登录页链接（AUTH_REQUIRED / AUTH_EXPIRED 的下一步）。
   */
  private loginHref(): string | null {
    const p = this.ctx.platform
    return p ? href(['p', p.id, 'login'], { e: this.ctx.endpoint, acct: this.ctx.account }) : null
  }

  /**
   * 普通命令的结果页。
   */
  private renderResult(s: JobSnapshot): void {
    const nodes: Child[] = []
    const qr = s.state === 'running' && s.qrcodeVersion != null ? qrcodeBlock(s.summary.id, s.qrcodeVersion, lastMatching(s.logs, '扫码')) : null
    if (s.state === 'running' && !this.pages.length) {
      nodes.push(qr ?? this.skeleton(s))
    } else if (this.pages.length) {
      const data = this.mergedData()
      nodes.push(renderData(data, this.command?.output ?? 'unknown', this.ctx))
      if (s.state === 'running') nodes.push(h('div', { class: 'loading-more' }, spinner(), '正在加载下一页…'))
    } else if (s.envelope?.error) {
      nodes.push(errorView(s.envelope.error, { loginHref: this.loginHref(), readOnly: isReadAction(this.command), onRetry: this.hooks.onRetry }))
      if (s.envelope.data != null) nodes.push(renderData(s.envelope.data, this.command?.output ?? 'unknown', this.ctx))
    } else if (s.state === 'stopped') {
      nodes.push(callout('info', '已停止', h('p', null, '任务已按要求停止。')))
    } else {
      nodes.push(callout('danger', '操作意外中断', h('p', null, '没有获得完整结果，可以展开详情查看原因。'), h('details', { class: 'error-detail' }, h('summary', null, '查看详情'), h('p', null, `退出码：${s.summary.exit_code ?? '未知'}`), h('pre', { class: 'logs' }, s.logs.slice(-5).join('\n') || '没有留下运行记录。'))))
    }
    if (this.appendError?.error) nodes.push(errorView(this.appendError.error, { loginHref: this.loginHref(), readOnly: true, onRetry: this.hooks.onRetry }))
    replace(this.panel, nodes)
    this.renderFooter(s)
  }

  /**
   * 分页累加后的数据。
   */
  private mergedData(): Json {
    if (this.pages.length === 1) return this.pages[0]!.data
    return this.pages.flatMap((p) => (Array.isArray(p.data) ? p.data : [p.data]))
  }

  /**
   * 运行中的骨架屏，附上最新一行进度。
   */
  private skeleton(s: JobSnapshot): HTMLElement {
    const last = s.logs.at(-1)
    return h(
      'div',
      { class: 'skeleton-wrap' },
      h('div', { class: 'skeleton-grid', 'aria-hidden': 'true' }, Array.from({ length: SKELETON_BLOCKS }, () => h('div', { class: 'skeleton' }))),
      h('p', { class: 'muted progress-line' }, last ? linkify(last.replace(/^\[catbus\] /, '')) : '正在执行…'),
    )
  }

  /**
   * 底部：已加载数量与「加载更多」。
   */
  private renderFooter(s: JobSnapshot): void {
    const data = this.mergedData()
    const count = Array.isArray(data) && this.pages.length ? data.length : null
    const more = this.lastPage?.has_more && this.lastPage.cursor && s.state !== 'running' && this.hooks.onLoadMore ? button('加载更多', { variant: 'secondary', icon: 'chevronDown' }) : null
    more?.addEventListener('click', () => this.hooks.onLoadMore!(this.lastPage!.cursor!))
    replace(this.footer, count != null ? h('span', { class: 'muted' }, `已加载 ${formatCount(count)} 条${this.lastPage?.has_more ? '' : '，没有更多了'}`) : null, more)
  }

  /**
   * 长连接：事件流增量追加，停在底部时自动滚动。
   */
  private renderStream(s: JobSnapshot): void {
    const { base } = outputBase(this.command?.output ?? '')
    if (!this.streamList || !this.panel.contains(this.streamList)) {
      this.streamList = h('ol', { class: base === 'Message' ? 'messages stream' : 'events stream', 'aria-live': 'off' })
      this.renderedItems = 0
      const header = h('p', { class: 'stream-note muted' })
      replace(this.panel, header, this.streamList)
      this.panel.addEventListener('scroll', () => {
        this.stickToBottom = this.panel.scrollHeight - this.panel.scrollTop - this.panel.clientHeight < STICKY_BOTTOM_PX
      })
    }
    const list = this.streamList
    for (const item of s.items.slice(this.renderedItems)) list.append(base === 'Message' ? messageRow(item) : eventRow(item))
    this.renderedItems = s.items.length
    const note = this.panel.querySelector('.stream-note')!
    note.textContent = s.state === 'running' ? `实时接收中，已收到 ${formatCount(s.items.length)} 条${s.dropped ? `（更早的 ${s.dropped} 条已省略）` : ''}` : `已结束，共收到 ${formatCount(s.items.length)} 条`
    if (s.state !== 'running' && s.envelope?.error) this.panel.append(errorView(s.envelope.error, { loginHref: this.loginHref(), readOnly: true }))
    if (!s.items.length && s.state === 'running') note.textContent = '正在等待实时消息，连接进度可在“运行记录”中查看。'
    if (this.stickToBottom) this.panel.scrollTop = this.panel.scrollHeight
    replace(this.footer)
  }

  /**
   * 日志标签页：stderr 的提示与进度（已脱敏）。
   */
  private renderLogs(s: JobSnapshot): void {
    replace(
      this.panel,
      this.command?.stream ? h('p', { class: 'muted' }, `已收到 ${formatCount(s.items.length)} 条实时消息。消息内容显示在“结果”中，这里显示连接与运行进度。`) : null,
      s.dropped ? h('p', { class: 'muted' }, `更早的 ${s.dropped} 条记录已省略`) : null,
      s.logs.length ? h('pre', { class: 'logs' }, s.logs.map((l) => [linkify(l), '\n'])) : h('p', { class: 'muted' }, s.state === 'running' ? '任务正在运行，等待新的运行记录…' : '这次任务没有额外的运行记录。'),
    )
  }

  /**
   * JSON 标签页：信封原文（保留大整数），流式条目逐行列出。
   */
  private renderJson(s: JobSnapshot): void {
    const blocks: Child[] = [h('p', { class: 'json-command' }, h('code', null, s.summary.command))]
    if (s.itemTexts.length) {
      blocks.push(h('p', { class: 'muted' }, `实时收到的数据（最近 ${Math.min(s.itemTexts.length, MAX_JSON_ITEMS)} 条）`))
      blocks.push(h('pre', { class: 'json' }, s.itemTexts.slice(-MAX_JSON_ITEMS).join('\n')))
    }
    const envelopes = this.pages.length > 1 ? this.pages.map((p) => p.envelopeText) : [s.envelopeText]
    envelopes.forEach((text, i) => {
      if (!text) return
      if (envelopes.length > 1) blocks.push(h('p', { class: 'muted' }, `第 ${i + 1} 页`))
      blocks.push(prettyJson(text))
    })
    if (blocks.length === 1) blocks.push(h('p', { class: 'muted' }, s.state === 'running' ? '操作还在进行，完成后会显示完整数据。' : '这次操作没有提供原始数据。'))
    replace(this.panel, blocks)
  }

  /**
   * 离开页面：停止计时、断开事件流（任务本身继续运行，可以在「任务」里找回）。
   */
  dispose(): void {
    this.stopTimer()
    this.handle?.detach()
  }
}
