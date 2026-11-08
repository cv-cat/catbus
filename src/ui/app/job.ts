import type { JobState, JobSummary, RunRequest } from '../shared/types.js'
import { api, followJob } from './api.js'
import { type Envelope, type Json, parseEnvelope, parseJson } from './json.js'

/**
 * 浏览器这一侧的任务：订阅事件流，累积日志、流式条目、二维码和最终信封，供页面渲染。
 */

export interface JobSnapshot {
  summary: JobSummary
  state: JobState
  logs: string[]
  /** 长连接的条目（已解析）与原文。 */
  items: Json[]
  itemTexts: string[]
  /** 缓存上限之外被丢掉的早期事件数。 */
  dropped: number
  qrcodeVersion: number | null
  envelope: Envelope | null
  envelopeText: string | null
  endedAt: string | null
}

export class JobHandle {
  readonly snapshot: JobSnapshot
  private readonly controller = new AbortController()
  private following: Promise<void> | null = null

  constructor(summary: JobSummary) {
    this.snapshot = {
      summary,
      state: summary.state,
      logs: [],
      items: [],
      itemTexts: [],
      dropped: 0,
      qrcodeVersion: null,
      envelope: null,
      envelopeText: null,
      endedAt: summary.ended_at,
    }
  }

  get id(): string {
    return this.snapshot.summary.id
  }

  /**
   * 订阅事件直到任务结束；每个事件后回调一次。重复调用返回同一个 Promise。
   */
  follow(onUpdate: (snapshot: JobSnapshot) => void): Promise<void> {
    this.following ??= followJob(
      this.id,
      (event) => {
        const s = this.snapshot
        if (event.type === 'log') s.logs.push(event.text)
        else if (event.type === 'item') {
          s.itemTexts.push(event.text)
          s.items.push(parseJson(event.text))
        } else if (event.type === 'qrcode') s.qrcodeVersion = event.version
        else if (event.type === 'dropped') s.dropped = event.count
        else {
          s.state = event.state
          s.envelopeText = event.envelope
          s.envelope = parseEnvelope(event.envelope)
          s.endedAt = event.ended_at
          s.summary = { ...s.summary, state: event.state, exit_code: event.exit_code, ended_at: event.ended_at }
        }
        onUpdate(s)
      },
      this.controller.signal,
    ).catch((err: unknown) => {
      if (!this.controller.signal.aborted) throw err
    })
    return this.following
  }

  /**
   * 请求停止（长连接、等待扫码的登录）。
   */
  async stop(): Promise<void> {
    await api.stopJob(this.id)
  }

  /**
   * 页面离开时断开事件流；任务本身继续在服务端运行。
   */
  detach(): void {
    this.controller.abort()
  }
}

/**
 * 新建任务并返回句柄。
 */
export async function startJob(request: RunRequest, stdin: string | null, track = true): Promise<JobHandle> {
  return new JobHandle(await api.createJob({ request, stdin, track }))
}

/**
 * 接上已有的任务（刷新页面、从「任务」页进入）。
 */
export async function attachJob(id: string): Promise<JobHandle> {
  return new JobHandle(await api.job(id))
}
