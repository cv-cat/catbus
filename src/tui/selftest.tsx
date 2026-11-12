import { EventEmitter } from 'node:events'
import { render } from 'ink'
import { App } from './App.js'
import { LogBuffer } from './logs.js'
import { pickLook } from './theme.js'

// 界面自检（AGENTS 7.5 的冒烟测试用）：在没有真实终端的环境里（Windows、Alpine、CI），
// 用假的 TTY 输入输出把真实的 App 跑一遍：能渲染、Yoga 能算出布局、能响应按键。
// 不联网，不读写数据目录以外的东西；用法见 scripts/smoke.mjs。

class FakeOut extends EventEmitter {
  isTTY = true
  columns = 120
  rows = 34
  frames: string[] = []
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

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface SelfTest {
  ok: boolean
  checks: { name: string; ok: boolean; message: string }[]
}

export async function selfTest(): Promise<SelfTest> {
  const checks: SelfTest['checks'] = []
  const out = new FakeOut()
  const input = new FakeIn()
  const screen = (): string => {
    for (let i = out.frames.length - 1; i >= 0; i--) {
      const f = out.frames[i]!.replace(ANSI, '')
      if (f.trim()) return f
    }
    return ''
  }
  const check = (name: string, ok: boolean, message: string) => checks.push({ name, ok, message })
  const app = render(<App look={pickLook({ CATBUS_TUI_ANIMATE: '0' })} logs={new LogBuffer()} />, {
    stdout: out as unknown as NodeJS.WriteStream,
    stdin: input as unknown as NodeJS.ReadStream,
    // Ink 卸载时会往 stderr 写“显示光标”；默认是真的 process.stderr，doctor 的 stderr 会多出转义序列
    stderr: new FakeOut() as unknown as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
    interactive: true,
    maxFps: 60,
  })
  try {
    await wait(300)
    const first = screen()
    check('渲染首页', first.includes('平台') && first.includes('小红书') && first.includes('12306'), first.includes('平台') ? '平台栏、命令栏都画出来了' : '首页没有画出来')
    const widest = Math.max(...first.split('\n').map((l) => l.length))
    check('布局', first.split('\n').length >= 20 && widest > 60, `${first.split('\n').length} 行，最宽 ${widest} 个字符`)
    input.send('/')
    await wait(150)
    check('响应按键', screen().includes('命令面板'), screen().includes('命令面板') ? '按 / 打开了命令面板' : '按 / 没有反应')
    input.send('\x1b')
    await wait(150)
    check('返回', screen().includes('命令 ›'), '按 Esc 回到首页')
  } finally {
    app.unmount()
  }
  return { ok: checks.every((c) => c.ok), checks }
}
