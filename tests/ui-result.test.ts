/// <reference lib="dom" />
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobHandle } from '../src/ui/app/job.js'
import { ResultPanel } from '../src/ui/app/result.js'
import type { CommandMeta, JobSummary } from '../src/ui/shared/types.js'

const command: CommandMeta = {
  resource: 'msg', action: 'listen', summary: '实时接收新消息', args: [], options: [],
  auth: 'required', output: 'Message[]', paged: false, stream: true, confirm: 'never',
  status: 'implemented', upstream: 'full', note: null, extension: false,
}

function pendingJob() {
  const summary: JobSummary = {
    id: 'test-stream', command: 'catbus discord msg listen', state: 'running',
    started_at: new Date().toISOString(), ended_at: null, exit_code: null, stoppable: true, track: true,
    request: { platform: 'discord', endpoint: 'pc', resource: 'msg', action: 'listen', args: [], options: {}, account: null, raw: false, verbose: false, proxy: null, yes: false },
  }
  const handle = new JobHandle(summary)
  let update = () => {}
  let resolve!: () => void
  const ended = new Promise<void>((done) => { resolve = done })
  vi.spyOn(handle, 'follow').mockImplementation((onUpdate) => {
    update = () => onUpdate(handle.snapshot)
    return ended
  })
  return {
    handle,
    log(text: string) { handle.snapshot.logs.push(text); update() },
    item(text: string) { handle.snapshot.items.push({ text, type: 'text' }); update() },
    finish() { handle.snapshot.state = 'stopped'; resolve() },
  }
}

describe('实时任务的结果与运行记录', () => {
  let panel: ResultPanel
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0))
    panel = new ResultPanel({ platform: null, endpoint: 'pc', account: null, command, raw: false }, command)
    document.body.append(panel.element)
  })
  afterEach(() => {
    panel.dispose()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const records = () => [...panel.element.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.startsWith('运行记录'))!

  it('首条输出到来前立即显示运行状态、停止按钮和等待提示', async () => {
    const job = pendingJob()
    const done = panel.track(job.handle, false)
    expect(panel.element.querySelector('.result-status')?.textContent).toContain('运行中')
    expect(panel.element.querySelector('.result-actions')?.textContent).toContain('停止接收')
    expect(panel.element.textContent).not.toContain('已连接')
    records().click()
    expect(panel.element.querySelector('.result-panel')?.textContent).toContain('任务正在运行')
    job.finish()
    await done
  })

  it('任务未结束时逐条显示日志及已收到的消息数量', async () => {
    const job = pendingJob()
    const done = panel.track(job.handle, false)
    records().click()
    job.log('正在连接平台')
    await vi.advanceTimersByTimeAsync(1)
    expect(panel.element.querySelector('.logs')?.textContent).toContain('正在连接平台')
    job.log('连接已就绪')
    job.item('实时消息')
    await vi.advanceTimersByTimeAsync(1)
    expect(panel.element.querySelector('.logs')?.textContent).toContain('连接已就绪')
    expect(panel.element.querySelector('.result-panel')?.textContent).toContain('已收到 1 条实时消息')
    expect(panel.element.querySelector('.result-status')?.textContent).toContain('运行中')
    job.finish()
    await done
  })

  it('再次运行实时任务时清除旧消息，新消息从第一条开始展示', async () => {
    const first = pendingJob()
    const done = panel.track(first.handle, false)
    first.item('上次的消息')
    await vi.advanceTimersByTimeAsync(1)
    expect(panel.element.querySelector('.stream')?.textContent).toContain('上次的消息')
    first.finish()
    await done
    const next = pendingJob()
    const nextDone = panel.track(next.handle, false)
    expect(panel.element.querySelector('.stream')?.textContent).not.toContain('上次的消息')
    next.item('本次的第一条消息')
    await vi.advanceTimersByTimeAsync(1)
    expect(panel.element.querySelector('.stream')?.textContent).toContain('本次的第一条消息')
    next.finish()
    await nextDone
  })
})
