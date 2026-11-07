import { afterEach, describe, expect, it, vi } from 'vitest'

// 回归：GitHub Actions 等环境会设 CI=true，Ink 默认据此认为“非交互”——不进备用屏幕、不处理窗口缩放，
// 界面会直接打在滚动区里（CI 的冒烟测试因此失败）。runTui 已经确认过 stdin / stdout 都是 TTY，必须显式传 interactive: true。

describe('runTui 与 CI 环境变量', () => {
  const original = { ci: process.env.CI, stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY }
  afterEach(() => {
    if (original.ci === undefined) delete process.env.CI
    else process.env.CI = original.ci
    Object.defineProperty(process.stdin, 'isTTY', { value: original.stdinTTY, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: original.stdoutTTY, configurable: true })
    vi.resetModules()
    vi.doUnmock('ink')
  })

  it.each(['true', '1', undefined])('CI=%s 时传给 ink 的 render 选项是 interactive: true、alternateScreen: true', async (ci) => {
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    let seen: Record<string, unknown> | null = null
    vi.resetModules()
    vi.doMock('ink', async (importOriginal) => {
      const real = await importOriginal<typeof import('ink')>()
      return {
        ...real,
        render: (_node: unknown, options: Record<string, unknown>) => {
          seen = options
          return { waitUntilExit: async () => undefined, unmount() {}, rerender() {}, clear() {}, cleanup() {}, waitUntilRenderFlush: async () => undefined }
        },
      }
    })
    const { runTui } = await import('../src/tui/index.js')
    expect(await runTui()).toBe(0)
    expect(seen).toMatchObject({ interactive: true, alternateScreen: true, exitOnCtrlC: false })
  })

  it('非 TTY 时仍然报 USAGE（不因为 interactive: true 而硬起界面）', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    vi.resetModules()
    const { runTui } = await import('../src/tui/index.js')
    await expect(runTui()).rejects.toMatchObject({ code: 'USAGE' })
  })
})
