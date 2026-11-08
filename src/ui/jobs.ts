import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { qrcodeFile } from '../core/login.js'
import { findPlatform } from '../platforms/index.js'
import { displayCommand, toArgv } from './shared/request.js'
import type { JobEvent, JobState, JobSummary } from './shared/types.js'
import { isStoppable, type ResolvedRequest } from './validate.js'

/**
 * 面板的任务（AGENTS 4.13「任务」）：每次执行起一个 catbus 子进程，输出转成事件，保存在内存里供页面重新接上。
 */

/** 每个任务最多缓存的事件数；长连接超出时丢掉最早的，并告诉页面丢了多少。 */
const MAX_BUFFERED_EVENTS = 2000
/** 内存里最多保留的任务数，超出时先清掉最早结束的。 */
const MAX_JOBS = 200
/** 停止任务时，SIGINT 之后等这么久还没退出就强制结束。 */
const STOP_GRACE_MS = 5000
/** 文件系统的 mtime 精度可能是秒级：二维码的修改时间允许比任务开始早这么多。 */
const QRCODE_MTIME_SLACK_MS = 2000
/** 终端二维码字符画的一行（只由半块字符和空白组成）；页面上直接显示 PNG，日志里不再重复。 */
const QR_ART_LINE = /^[\s█▀▄]+$/

type Listener = (event: JobEvent) => void

interface Job {
  summary: JobSummary
  events: JobEvent[]
  dropped: number
  listeners: Set<Listener>
  child: ChildProcess
  stopRequested: boolean
  qrcodeVersion: number | null
  startedAtMs: number
}

export interface JobRunnerOptions {
  /** catbus 的入口脚本（dist/cli/main.js）；测试里换成假的 CLI。 */
  cliEntry: string
  /** 子进程的工作目录。 */
  cwd: string
}

export class JobConflictError extends Error {}

/**
 * 把流按行交给 onLine：最后一段没有换行的留到下次，流结束时补交。
 */
function readLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) onLine(line.replace(/\r$/, ''))
  })
  stream.on('end', () => {
    if (rest) onLine(rest)
    rest = ''
  })
}

/**
 * 一行文本是否是 catbus 的信封（jsonl 时写在 stderr 的摘要）。
 */
function isEnvelope(line: string): boolean {
  if (!line.startsWith('{')) return false
  try {
    const value = JSON.parse(line) as unknown
    return typeof value === 'object' && value !== null && 'ok' in value && 'error' in value
  } catch {
    return false
  }
}

/**
 * 从信封原文判断成败；没有信封视为失败。
 */
function envelopeOk(text: string | null): boolean {
  if (text == null) return false
  try {
    return (JSON.parse(text) as { ok?: unknown }).ok === true
  } catch {
    return false
  }
}

export class JobRunner {
  private readonly jobs = new Map<string, Job>()

  constructor(private readonly options: JobRunnerOptions) {}

  /**
   * 新建并启动任务。同一平台同时只能有一个 auth login（二维码文件是同一个）。
   */
  start(resolved: ResolvedRequest): JobSummary {
    const { request, command } = resolved
    const isLogin = command?.key === 'auth login'
    if (isLogin && [...this.jobs.values()].some((j) => j.summary.state === 'running' && j.summary.request.platform === request.platform && j.summary.request.resource === 'auth' && j.summary.request.action === 'login')) {
      throw new JobConflictError('这个平台已经有一个正在进行的登录，先完成或停止它')
    }
    const id = randomBytes(8).toString('hex')
    const defaultEndpoint = request.platform ? findPlatform(request.platform)?.defaultEndpoint : undefined
    const child = spawn(process.execPath, [this.options.cliEntry, ...toArgv(request, defaultEndpoint), '-o', 'json'], {
      cwd: this.options.cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const job: Job = {
      summary: {
        id,
        request,
        command: displayCommand(request, defaultEndpoint),
        state: 'running',
        started_at: new Date().toISOString(),
        ended_at: null,
        exit_code: null,
        stoppable: isStoppable(command),
        track: resolved.track,
      },
      events: [],
      dropped: 0,
      listeners: new Set(),
      child,
      stopRequested: false,
      qrcodeVersion: null,
      startedAtMs: Date.now(),
    }
    this.jobs.set(id, job)
    this.prune()

    const stdoutLines: string[] = []
    let summaryEnvelope: string | null = null
    const streaming = command?.stream === true
    child.once('spawn', () => {
      if (resolved.track) this.emit(job, { type: 'log', text: streaming ? '实时接收任务已启动，正在建立连接。' : '任务已启动，正在执行。' })
    })
    readLines(child.stdout!, (line) => {
      if (!line.trim()) return
      if (streaming) this.emit(job, { type: 'item', text: line })
      else stdoutLines.push(line)
    })
    readLines(child.stderr!, (line) => {
      if (isEnvelope(line)) summaryEnvelope = line
      else if (line.trim() && !QR_ART_LINE.test(line)) this.emit(job, { type: 'log', text: line })
      if (isLogin) void this.checkQrcode(job)
    })
    child.stdin!.on('error', () => {})
    child.stdin!.end(resolved.stdin ?? '')
    child.on('error', (err) => this.emit(job, { type: 'log', text: `无法启动 catbus：${err.message}` }))
    child.on('close', (code) => {
      const envelope = streaming ? summaryEnvelope : (stdoutLines.at(-1) ?? null)
      const state: JobState = job.stopRequested ? 'stopped' : envelopeOk(envelope) ? 'succeeded' : 'failed'
      job.summary.state = state
      job.summary.exit_code = code
      job.summary.ended_at = new Date().toISOString()
      if (resolved.track) this.emit(job, { type: 'log', text: state === 'stopped' ? '任务已停止。' : state === 'succeeded' ? '任务已完成。' : '任务未能完成，请查看结果中的原因。' })
      this.emit(job, { type: 'end', state, exit_code: code, envelope, ended_at: job.summary.ended_at })
      job.listeners.clear()
    })
    return job.summary
  }

  /**
   * 登录任务：本次任务生成或更新了二维码时，通知页面去取。
   */
  private async checkQrcode(job: Job): Promise<void> {
    const platform = job.summary.request.platform
    if (platform == null) return
    const info = await stat(qrcodeFile(platform)).catch(() => null)
    if (!info || info.mtimeMs < job.startedAtMs - QRCODE_MTIME_SLACK_MS || info.mtimeMs === job.qrcodeVersion) return
    if (job.summary.state !== 'running') return
    job.qrcodeVersion = info.mtimeMs
    this.emit(job, { type: 'qrcode', version: info.mtimeMs })
  }

  /**
   * 记录事件并推给正在看的页面；超出缓存上限时丢掉最早的。
   */
  private emit(job: Job, event: JobEvent): void {
    job.events.push(event)
    if (job.events.length > MAX_BUFFERED_EVENTS) {
      job.events.shift()
      job.dropped++
    }
    for (const listener of job.listeners) listener(event)
  }

  /**
   * 结束最早完成的任务记录，直到数量不超过上限。
   */
  private prune(): void {
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) break
      if (job.summary.state !== 'running') this.jobs.delete(id)
    }
  }

  get(id: string): JobSummary | null {
    return this.jobs.get(id)?.summary ?? null
  }

  /**
   * 「任务」页列出的任务：用户发起的，最新的在前。
   */
  list(): JobSummary[] {
    return [...this.jobs.values()].map((j) => j.summary).filter((s) => s.track).reverse()
  }

  /**
   * 本次任务当前的二维码版本（mtime），没有时为 null。
   */
  qrcode(id: string): { platform: string; version: number } | null {
    const job = this.jobs.get(id)
    const platform = job?.summary.request.platform
    if (!job || platform == null || job.qrcodeVersion == null) return null
    return { platform, version: job.qrcodeVersion }
  }

  /**
   * 订阅任务事件：先重放已缓存的，再推新的。返回取消订阅的函数；任务已结束时重放完即止。
   */
  subscribe(id: string, listener: Listener): (() => void) | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.dropped) listener({ type: 'dropped', count: job.dropped })
    for (const event of job.events) listener(event)
    if (job.summary.state !== 'running') return () => {}
    job.listeners.add(listener)
    return () => job.listeners.delete(listener)
  }

  /**
   * 停止任务：发 SIGINT（等同于 Ctrl-C），超时未退出再强制结束。
   */
  stop(id: string): JobSummary | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (!job.summary.stoppable) throw new JobConflictError('这个任务开始后不能取消')
    if (job.summary.state !== 'running') return job.summary
    job.stopRequested = true
    job.child.kill('SIGINT')
    setTimeout(() => {
      if (job.child.exitCode == null && job.child.signalCode == null) job.child.kill('SIGKILL')
    }, STOP_GRACE_MS).unref()
    return job.summary
  }

  /**
   * 面板退出时结束所有还在运行的子进程。
   */
  shutdown(): void {
    for (const job of this.jobs.values()) {
      if (job.summary.state === 'running') {
        job.stopRequested = true
        job.child.kill('SIGTERM')
      }
    }
  }
}
