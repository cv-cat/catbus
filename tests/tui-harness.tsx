import { EventEmitter } from 'node:events'
import { render } from 'ink'
import type { ReactElement } from 'react'
import type { Platform } from '../src/core/registry.js'
import { App } from '../src/tui/App.js'
import { LogBuffer } from '../src/tui/logs.js'
import { type Env, pickLook } from '../src/tui/theme.js'

// 离屏渲染工具：假的 TTY 输出和输入，驱动真实的 App，读出屏幕（供 tests/tui.test.tsx 和人工检查用）。

class FakeOut extends EventEmitter {
  isTTY = true
  frames: string[] = []
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super()
  }
  write(s: string): boolean {
    this.frames.push(s)
    return true
  }
  getColorDepth(): number {
    return 24
  }
  hasColors(): boolean {
    return true
  }
  cursorTo(): void {}
  clearLine(): void {}
  moveCursor(): void {}
  resize(columns: number, rows: number): void {
    this.columns = columns
    this.rows = rows
    this.emit('resize')
  }
}

class FakeIn extends EventEmitter {
  isTTY = true
  private queue: string[] = []
  setRawMode(): this {
    return this
  }
  setEncoding(): this {
    return this
  }
  ref(): this {
    return this
  }
  unref(): this {
    return this
  }
  resume(): this {
    return this
  }
  pause(): this {
    return this
  }
  read(): string | null {
    return this.queue.shift() ?? null
  }
  send(data: string): void {
    this.queue.push(data)
    this.emit('readable')
  }
}

export const KEYS = {
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  enter: '\r',
  esc: '\x1b',
  tab: '\t',
  backspace: '\x7f',
  ctrlC: '\x03',
}

// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/g

export interface Session {
  /** 当前屏幕的纯文字（去掉颜色），按行。 */
  screen(): string[]
  /** 带颜色序列的最后一帧。 */
  raw(): string
  press(...keys: string[]): Promise<void>
  type(text: string): Promise<void>
  resize(columns: number, rows: number): Promise<void>
  settle(ms?: number): Promise<void>
  logs: LogBuffer
  stop(): void
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function start(options: { columns?: number; rows?: number; env?: Env; platforms?: Platform[] } = {}): Promise<Session> {
  const out = new FakeOut(options.columns ?? 120, options.rows ?? 34)
  const input = new FakeIn()
  const logs = new LogBuffer()
  // 默认关掉启动动画和吉祥物动画，让测试读到稳定的第一屏；专门的动画测试自己传 CATBUS_TUI_ANIMATE=1
  const look = pickLook({ CATBUS_TUI_ANIMATE: '0', ...(options.env ?? {}) })
  const el: ReactElement = <App look={look} logs={logs} {...(options.platforms ? { platforms: options.platforms } : {})} />
  const app = render(el, {
    stdout: out as unknown as NodeJS.WriteStream,
    stdin: input as unknown as NodeJS.ReadStream,
    stderr: new FakeOut(80, 24) as unknown as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
    alternateScreen: false,
    interactive: true,
    maxFps: 60,
  })
  const settle = (ms = 60) => wait(ms)
  await settle(120)
  return {
    screen: () => lastFrame(out).replace(SGR, '').split('\n'),
    raw: () => lastFrame(out),
    async press(...keys) {
      for (const k of keys) {
        input.send(k)
        await settle(40)
      }
      await settle(40)
    },
    async type(text) {
      for (const ch of text) {
        input.send(ch)
        await settle(15)
      }
      await settle(40)
    },
    async resize(columns, rows) {
      out.resize(columns, rows)
      await settle(80)
    },
    settle,
    logs,
    stop: () => app.unmount(),
  }
}

/** Ink 每次重绘写一整块；取最后一个非空的帧，并去掉清屏用的转义序列。 */
function lastFrame(out: FakeOut): string {
  for (let i = out.frames.length - 1; i >= 0; i--) {
    // eslint-disable-next-line no-control-regex
    const f = out.frames[i]!.replace(/\x1b\[\?[0-9;]*[hl]/g, '').replace(/\x1b\[[0-9;]*[ABCDEFGHJKSTfm]/g, (m) => (m.endsWith('m') ? m : ''))
    if (f.replace(/\x1b\[[0-9;]*m/g, '').trim()) return f
  }
  return ''
}
