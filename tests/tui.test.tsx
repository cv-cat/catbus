import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as rand from '../src/core/rand.js'
import { resetSession } from '../src/platforms/12306/web/client.js'
import { PLATFORMS } from '../src/platforms/index.js'
import { mockTrain, useTempHome } from './helpers.js'
import { KEYS, type Session, start } from './tui-harness.js'

// 驱动真实的 App：假 TTY 输入，读离屏渲染的屏幕。网络用 12306 的录制响应（tests/fixtures/12306），不联网。

const text = (s: Session) => s.screen().join('\n')

describe('catbus tui', () => {
  useTempHome()
  let restoreClock: () => void
  let session: Session | null = null

  beforeEach(() => {
    restoreClock = rand.deterministic({ now: new Date('2026-10-07T10:00:00+08:00').getTime() })
    resetSession()
  })
  afterEach(() => {
    session?.stop()
    session = null
    restoreClock()
  })

  const open = async (columns = 120, rows = 34, env = {}) => (session = await start({ columns, rows, env }))

  it('首页：平台列表读自注册表，命令栏默认展开主内容', async () => {
    const s = await open()
    const screen = text(s)
    for (const p of PLATFORMS) expect(screen, p.id).toContain(p.name)
    expect(screen).toContain('命令 › 小红书')
    expect(screen).toContain('▾ item')
    expect(screen).toContain('等价命令')
  })

  it('没有任何一行超过终端宽度', async () => {
    for (const [cols, rows] of [[80, 24], [100, 30], [120, 34], [160, 44]] as const) {
      const s = await open(cols, rows)
      const { default: sw } = await import('string-width')
      for (const line of s.screen()) expect(sw(line), `${cols}x${rows}: ${line}`).toBeLessThanOrEqual(cols)
      s.stop()
      session = null
    }
  })

  it('小于 80 × 24 时提示放大，不画界面', async () => {
    const s = await open(70, 20)
    expect(text(s)).toContain('终端太小了')
    expect(text(s)).toContain('70 × 20')
    await s.resize(120, 34)
    expect(text(s)).toContain('平台')
  })

  it('跑通一条命令：12306 车站搜索（免登录）', async () => {
    const { restore } = mockTrain()
    try {
      const s = await open()
      // 平台栏移到 12306（按 id 找下标，平台增减不影响），进入命令栏，展开 station，选 search
      for (let i = 0; i < PLATFORMS.findIndex((p) => p.id === '12306'); i++) await s.press(KEYS.down)
      expect(text(s)).toContain('命令 › 12306 铁路')
      await s.press(KEYS.right)
      expect(text(s)).toContain('station')
      await s.press(KEYS.down, KEYS.right) // 展开后移到 search，→ 进入表单
      expect(text(s)).toContain('<keyword>')
      await s.type('杭州')
      expect(text(s)).toContain('catbus 12306 station search 杭州')
      await s.press(KEYS.enter)
      await s.settle(400)
      const screen = text(s)
      expect(screen).toContain('杭州')
      expect(screen).toContain('电报码')
    } finally {
      restore()
    }
  })

  it('错误：未登录的平台给出登录命令，Esc 回到首页', async () => {
    const s = await open()
    await s.press(KEYS.right) // 小红书的命令栏，item 已展开
    await s.press(KEYS.down, KEYS.down, KEYS.right) // 行序：user、item、get……；移到 get，→ 进入表单（它也要登录）
    await s.type('键盘')
    await s.press(KEYS.enter)
    await s.settle(300)
    expect(text(s)).toContain('需要登录')
    expect(text(s)).toContain('catbus xhs auth login')
    expect(text(s)).toContain('直接登录')
    await s.press(KEYS.esc)
    expect(text(s)).toContain('命令 › 小红书')
  })

  it('不在界面里运行的命令：写入类显示提示，Enter 不执行', async () => {
    const s = await open()
    await s.press(KEYS.right)
    // 行序：user、item、get、search、related、list、media、download……；下 7 次落在 download，它不是读取类命令
    for (let i = 0; i < 7; i++) await s.press(KEYS.down)
    await s.press(KEYS.right)
    expect(text(s)).toContain('复制到终端执行')
    await s.press(KEYS.enter)
    await s.settle(100)
    expect(text(s)).not.toContain('正在运行')
  })

  it('命令面板：/ 搜到跨平台的命令，Enter 直达表单', async () => {
    const s = await open()
    await s.press('/')
    expect(text(s)).toContain('命令面板')
    await s.type('12306 ticket')
    expect(text(s)).toContain('12306 ticket search')
    expect(text(s)).not.toContain('xhs item get')
    await s.press(KEYS.enter)
    expect(text(s)).toContain('<from>')
    expect(text(s)).toContain('catbus 12306 ticket search <from> <to>')
  })

  it('命令面板：没有匹配时给出提示', async () => {
    const s = await open()
    await s.press('/')
    await s.type('zzzzqqq')
    expect(text(s)).toContain('没有匹配的命令')
    await s.press(KEYS.esc)
    expect(text(s)).toContain('命令 ›')
  })

  it('NO_COLOR：屏幕里没有颜色序列（对照：不设时有）', async () => {
    const colored = await open(120, 34)
    // eslint-disable-next-line no-control-regex
    const COLOR = /\x1b\[(3[0-79]|4[0-79]|9[0-7]|10[0-7]|38;|48;)/
    expect(colored.raw()).toMatch(COLOR)
    colored.stop()
    session = null
    const s = await open(120, 34, { NO_COLOR: '1' })
    expect(s.raw()).not.toMatch(COLOR)
    expect(text(s)).toContain('平台')
  })

  it('CATBUS_TUI_ASCII：边框和标记全是 ASCII', async () => {
    const s = await open(120, 34, { CATBUS_TUI_ASCII: '1' })
    const screen = text(s)
    expect(screen).toContain('+- 平台')
    for (const ch of '╭╮╰╯│─●○▌▾▸') expect(screen, ch).not.toContain(ch)
  })

  it('T 键切换浅色 / 深色：色值真的变了，再按一次变回来', async () => {
    const s = await open()
    const dark = s.raw()
    expect(dark).toContain('48;2;49;50;68') // Mocha 的选中行底色 #313244
    await s.press('T')
    const light = s.raw()
    expect(light).toContain('48;2;220;224;232') // Latte 的选中行底色 #dce0e8
    expect(light).not.toContain('48;2;49;50;68')
    await s.press('T')
    expect(s.raw()).toContain('48;2;49;50;68')
  })

  it('Ctrl-C 退出', async () => {
    const s = await open()
    await s.press(KEYS.ctrlC)
    await s.settle(100)
    // 退出后再按键没有任何反应，也不抛错
    await s.press(KEYS.down)
  })
})
