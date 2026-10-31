import { render } from 'ink'
import { CatbusError } from '../core/errors.js'
import { App } from './App.js'
import { captureStderr, LogBuffer } from './logs.js'
import { pickLook } from './theme.js'
import { MIN_COLS, MIN_ROWS } from './state.js'

// `catbus tui` 的入口（AGENTS 4.13）。

/** 启动条件：stdin 和 stdout 都是 TTY。终端比 80 × 24 小时不报错，进界面后提示放大（可以随时调整窗口）。 */
export function checkTerminal(stdin: { isTTY?: boolean }, stdout: { isTTY?: boolean }): void {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new CatbusError('USAGE', 'catbus tui 需要在交互式终端里运行（stdin 和 stdout 都是 TTY）', {
      hint: '在脚本或管道里请直接用命令行：catbus --help',
    })
  }
}

export async function runTui(): Promise<number> {
  checkTerminal(process.stdin, process.stdout)
  const logs = new LogBuffer()
  const restoreStderr = captureStderr(logs)
  const look = pickLook(process.env)
  // 在 render 之前提前开启 raw mode，消除"首页画出来但还不能收键"的时间窗口。
  // Ink 会在 useInput 挂载时再开一次（引用计数），卸载时关掉。这里开的这一次会在 render 返回前被 Ink 接管。
  if (process.stdin.setRawMode) process.stdin.setRawMode(true)
  try {
    const app = render(<App look={look} logs={logs} />, {
      alternateScreen: true,
      // 上面 checkTerminal 已经确认 stdin 和 stdout 都是 TTY。Ink 默认还会因为环境变量 CI 非空就当作非交互：
      // 那样既没有备用屏幕、光标控制，也不处理窗口缩放，界面会直接打在滚动区里。有些容器和开发环境会常设 CI=true，
      // 这里不让它覆盖我们已经做过的判断。
      interactive: true,
      exitOnCtrlC: false,
      patchConsole: false,
      // Windows 控制台整屏时 Ink 每帧都会清屏重绘，所以限制帧率，避免闪烁
      maxFps: process.platform === 'win32' ? 12 : 24,
      incrementalRendering: process.platform !== 'win32',
    })
    await app.waitUntilExit()
    return 0
  } finally {
    restoreStderr()
  }
}

export { MIN_COLS, MIN_ROWS }
