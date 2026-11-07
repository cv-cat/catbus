import type { Logger } from '../core/log.js'

// TUI 运行期间的日志（AGENTS 4.13）：全屏界面里，任何直接写到终端的字节都会打乱画面，
// 所以 ctx.log 和直接写 process.stderr 的提示都收进这里，界面在状态栏显示最新一行。

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export class LogBuffer {
  readonly lines: string[] = []
  private subs = new Set<() => void>()

  push(text: string): void {
    for (const raw of text.replace(ANSI, '').split(/\r?\n/)) {
      const line = raw.trim()
      if (line) this.lines.push(line)
    }
    if (this.lines.length > 200) this.lines.splice(0, this.lines.length - 200)
    for (const fn of this.subs) fn()
  }

  last(): string | null {
    return this.lines.at(-1) ?? null
  }

  subscribe(fn: () => void): () => void {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }
}

export function bufferLogger(buf: LogBuffer): Logger {
  return {
    debug() {},
    info: (m) => buf.push(`[catbus] ${m}`),
    warn: (m) => buf.push(`[catbus] 警告：${m}`),
  }
}

/** 把 process.stderr.write 改道进缓冲区；返回恢复函数。 */
export function captureStderr(buf: LogBuffer): () => void {
  const original = process.stderr.write
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: unknown, cb?: unknown) => {
    buf.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    const done = typeof encoding === 'function' ? encoding : typeof cb === 'function' ? cb : null
    if (done) (done as () => void)()
    return true
  }) as typeof process.stderr.write
  return () => {
    process.stderr.write = original
  }
}
