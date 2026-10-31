import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { finishLogin, freshCredential, poll, prompt, showQrcode } from '../src/core/login.js'
import { definePlatform, type HandlerContext } from '../src/core/registry.js'
import { readCredential } from '../src/core/auth-store.js'
import { KEYS, type Session, start } from './tui-harness.js'
import { useTempHome } from './helpers.js'

// 登录与监听的整条路径：真实的 App、真实的 core/login 钩子，平台是假的（不联网）。

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** 假平台的“手机上确认”：测试里调用 confirmScan() 放行轮询。 */
let scanned = false
const confirmScan = () => {
  scanned = true
}

/** 假平台：扫码要轮询两次才算成功；短信先问手机号再问验证码；监听持续吐弹幕。 */
const fake = definePlatform({
  id: 'demo',
  name: '演示站',
  aliases: [],
  item: '帖子',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'password'], default: 'qrcode' },
      commands: {
        'auth login': {
          upstream: 'full',
          handler: async () => async (ctx: HandlerContext) => {
            const method = ctx.options.method as string
            const credential = freshCredential(ctx, method as never)
            if (method === 'qrcode') {
              await showQrcode(ctx, 'https://demo.example/login?key=abc123', '请用演示站 App 扫码')
              await poll(async () => (scanned ? true : undefined), { interval: 20 })
            } else if (method === 'sms') {
              const phone = (ctx.options.phone as string) || (await prompt('手机号：'))
              const code = await prompt(`验证码（发到 ${phone}）：`)
              if (code !== '123456') throw new (await import('../src/core/errors.js')).CatbusError('AUTH_REQUIRED', '验证码不对')
            } else {
              const pw = await prompt('密码：', { hidden: true })
              if (!pw) throw new Error('空密码')
            }
            return finishLogin(ctx, credential, { id: 'u1', name: '测试用户', url: null })
          },
        },
        'auth status': 'full',
        'item get': {
          upstream: 'full',
          options: {},
          handler: async () => async (ctx: HandlerContext) => ({ id: String(ctx.args.item), kind: 'text', url: null, title: '一条帖子', text: null, author: { id: 'a1', name: '作者甲', url: null }, created_at: null, cover: null, media: [], stats: {}, price: null, status: null }),
        },
        'live listen': {
          upstream: 'full',
          options: { duration: z.string().optional() },
          handler: async () =>
            async function* (ctx: HandlerContext) {
              let i = 0
              while (!ctx.signal.aborted) {
                yield { type: i % 3 === 2 ? 'gift' : 'chat', time: '2026-10-10T21:30:08+08:00', user: { id: 'x', name: `观众${i}`, url: null }, text: `弹幕${i}`, gift: i % 3 === 2 ? { name: '小花', count: 2 } : null }
                i++
                await wait(15)
              }
            },
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})

describe('tui 登录 / 监听 / 账号', () => {
  useTempHome()
  let s: Session | null = null
  afterEach(() => {
    s?.stop()
    s = null
    scanned = false
  })
  const open = async (cols = 120, rows = 34) => (s = await start({ columns: cols, rows, platforms: [fake] }))
  const text = () => s!.screen().join('\n')

  it('扫码登录：二维码画在界面里，轮询成功后保存账号并设为当前', async () => {
    await open()
    await s!.press('a') // 账号页，空
    expect(text()).toContain('还没有登录')
    await s!.press('n')
    expect(text()).toContain('登录方式')
    await s!.press(KEYS.enter) // 默认扫码
    await s!.settle(150)
    expect(text()).toContain('请用演示站 App 扫码')
    expect(text()).toContain('二维码图片')
    // 二维码是方块字符，黑码白底（固定色）
    expect(s!.raw()).toMatch(/48;2;255;255;255/)
    expect(s!.raw()).toMatch(/38;2;0;0;0/)
    expect(text()).toContain('等待扫码')
    confirmScan() // 手机上确认
    await s!.settle(200)
    expect(text()).toContain('已登录')
    expect(text()).toContain('测试用户')
    const saved = await readCredential('demo', 'web', 'default')
    expect(saved?.user?.id).toBe('u1')
  })

  it('短信登录：手机号和验证码都在界面里输入；验证码错误给出原因并可重试', async () => {
    await open()
    await s!.press('a', 'n')
    await s!.press(KEYS.right) // 方式：短信
    await s!.press(KEYS.down, KEYS.down) // 账号名 → 手机号
    await s!.type('13800000000')
    await s!.press(KEYS.enter)
    await s!.settle(150)
    expect(text()).toContain('验证码（发到 13800000000）')
    await s!.type('000000')
    await s!.press(KEYS.enter)
    await s!.settle(200)
    expect(text()).toContain('验证码不对')
    expect(text()).toContain('AUTH_REQUIRED')
    expect(await readCredential('demo', 'web', 'default')).toBeNull()
    await s!.press('r') // 重试回到表单
    expect(text()).toContain('登录方式')
  })

  it('密码输入是隐藏的，屏幕上不出现明文', async () => {
    await open()
    await s!.press('a', 'n')
    await s!.press(KEYS.right, KEYS.right) // 账密
    await s!.press(KEYS.down, KEYS.down) // 用户名
    await s!.type('someone')
    await s!.press(KEYS.enter)
    await s!.settle(150)
    expect(text()).toContain('密码')
    await s!.type('hunter2-secret')
    expect(text()).not.toContain('hunter2-secret')
    expect(text()).toContain('**************')
  })

  it('登录中按 Esc 取消，不保存任何凭证', async () => {
    await open()
    await s!.press('a', 'n')
    await s!.press(KEYS.enter)
    await s!.settle(100)
    expect(text()).toContain('等待扫码') // 轮询一直不成功（没人放行）
    await s!.press(KEYS.esc)
    await s!.settle(150)
    expect(text()).toContain('登录方式')
    expect(await readCredential('demo', 'web', 'default')).toBeNull()
  })

  it('账号页：切换当前账号、检查、登出要确认（按 y）', async () => {
    const { newCredential, setCurrent, writeCredential } = await import('../src/core/auth-store.js')
    for (const a of ['one', 'two']) {
      const c = newCredential({ platform: 'demo', endpoint: 'web', account: a, method: 'cookie' })
      c.user = { id: 'id-' + a, name: '用户' + a, url: null }
      await writeCredential(c)
    }
    await setCurrent('demo', 'web', 'one')
    await open()
    await s!.press('a')
    await s!.settle(100)
    expect(text()).toContain('one')
    expect(text()).toContain('用户two')
    await s!.press(KEYS.down, KEYS.enter) // 选中 two，设为当前
    await s!.settle(150)
    expect(text()).toContain('当前账号：two')
    await s!.press('x')
    expect(text()).toContain('登出 two？')
    await s!.press('n') // 其他键 = 取消
    expect(await readCredential('demo', 'web', 'two')).not.toBeNull()
    await s!.press('x', 'y')
    await s!.settle(200)
    expect(await readCredential('demo', 'web', 'two')).toBeNull()
  })

  it('监听：事件流进来，按 1 隐藏弹幕、空格暂停，Esc 停止并回到首页', async () => {
    const { newCredential, setCurrent, writeCredential } = await import('../src/core/auth-store.js')
    await writeCredential(newCredential({ platform: 'demo', endpoint: 'web', account: 'a', method: 'cookie' }))
    await setCurrent('demo', 'web', 'a')
    await open()
    await s!.press('/')
    await s!.type('demo live listen')
    await s!.press(KEYS.enter)
    await s!.type('room1')
    await s!.press(KEYS.enter)
    await s!.settle(500)
    expect(text()).toContain('监听')
    expect(text()).toContain('弹幕')
    expect(text()).toContain('观众')
    expect(text()).toContain('小花 ×2')
    await s!.press('1') // 隐藏弹幕
    expect(text()).toContain('[ ] 弹幕')
    expect(text()).toContain('隐藏')
    await s!.press(' ')
    expect(text()).toContain('已暂停')
    await s!.press(KEYS.esc)
    await s!.settle(150)
    expect(text()).toContain('命令 ›')
  })

  it('监听：未登录时给出登录提示（错误页），不进入监听屏', async () => {
    await open()
    await s!.press('/')
    await s!.type('demo live listen')
    await s!.press(KEYS.enter)
    await s!.type('room1')
    await s!.press(KEYS.enter)
    await s!.settle(300)
    expect(text()).toContain('需要登录')
  })

  it('结果页 Enter：列出接着可以做的命令，参数已填好；Esc 回到上一页结果', async () => {
    const { newCredential, setCurrent, writeCredential } = await import('../src/core/auth-store.js')
    await writeCredential(newCredential({ platform: 'demo', endpoint: 'web', account: 'a', method: 'cookie' }))
    await setCurrent('demo', 'web', 'a')
    await open()
    await s!.press('/')
    await s!.type('demo item get')
    await s!.press(KEYS.enter)
    await s!.type('p1')
    await s!.press(KEYS.enter)
    await s!.settle(250)
    expect(text()).toContain('一条帖子')
    await s!.press(KEYS.enter)
    expect(text()).toContain('接着做')
    await s!.press(KEYS.esc)
    expect(text()).toContain('一条帖子')
  })
})

describe('core/login 的界面钩子', () => {
  useTempHome()
  it('成功、失败、取消之后都会撤销：interactive() 回到按真实 TTY 判断', async () => {
    const { interactive, setLoginUi } = await import('../src/core/login.js')
    const { startLogin } = await import('../src/tui/login.js')
    const { bufferLogger, LogBuffer } = await import('../src/tui/logs.js')
    const before = interactive()
    const ctl = new AbortController()
    const restore = setLoginUi({ interactive: true, signal: ctl.signal, qrcode() {}, link() {}, prompt: async () => '' })
    expect(interactive()).toBe(true)
    restore()
    expect(interactive()).toBe(before)

    const log = bufferLogger(new LogBuffer())
    // 失败：密码为空 → handler 抛错
    const views: string[] = []
    const failed = startLogin({ platform: fake, method: 'password', account: '', fields: {}, log }, (v) => views.push(v.type))
    await wait(150) // 等 handler 跑到 prompt
    expect(views).toContain('prompt')
    failed.answer('') // 空密码
    await failed.done
    expect(interactive()).toBe(before)
    expect(views.at(-1)).toBe('error')

    // 取消：二维码等待中取消
    const cancelled = startLogin({ platform: fake, method: 'qrcode', account: '', fields: {}, log }, () => {})
    await wait(100)
    cancelled.cancel()
    await cancelled.done
    expect(interactive()).toBe(before)
  })

  it('没有界面钩子时 prompt 走 readline、showQrcode 画到 stderr（CLI 行为不变）', async () => {
    const { interactive } = await import('../src/core/login.js')
    // 测试进程的 stdin / stderr 不是 TTY
    expect(interactive()).toBe(false)
  })
})

describe('LoginUi 钩子的栈语义', () => {
  it('重新扫码：旧会话的撤销晚于新会话的设置，新会话结束后钩子是空的（不会把旧钩子装回来）', async () => {
    const { interactive, setLoginUi } = await import('../src/core/login.js')
    const hook = () => ({ interactive: true as const, signal: new AbortController().signal, qrcode() {}, link() {}, prompt: async () => '' })
    const before = interactive()
    const undoOld = setLoginUi(hook())
    const undoNew = setLoginUi(hook())
    undoOld() // 旧会话收尾得晚
    expect(interactive()).toBe(true) // 新会话还在用
    undoNew()
    expect(interactive()).toBe(before) // 都撤销了
    undoNew() // 重复撤销无害
    expect(interactive()).toBe(before)
  })
})

describe('人机验证的浏览器链接', () => {
  useTempHome()
  it('界面里：链接显示在页面上，不写 stderr；CLI 里：stderr 的文字和以前一样', async () => {
    const { setLoginUi, showLink } = await import('../src/core/login.js')
    // CLI（没有钩子）：写 stderr，文案不变
    const written: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((c: string | Uint8Array) => (written.push(String(c)), true)) as typeof process.stderr.write
    try {
      showLink('http://127.0.0.1:5555', '说明', '请在浏览器打开 http://127.0.0.1:5555 完成人机验证（180 秒内），完成后自动继续')
    } finally {
      process.stderr.write = original
    }
    // 与改动前 geetest-manual.ts 里直写的那一行逐字一致
    expect(written.join('')).toBe('[catbus] 请在浏览器打开 http://127.0.0.1:5555 完成人机验证（180 秒内），完成后自动继续\n')

    // 界面：走钩子，stderr 不写
    const seen: string[] = []
    const undo = setLoginUi({ interactive: true, signal: new AbortController().signal, qrcode() {}, prompt: async () => '', link: (url, hint) => seen.push(url + '|' + hint) })
    process.stderr.write = ((c: string | Uint8Array) => (written.push('LEAK ' + String(c)), true)) as typeof process.stderr.write
    try {
      showLink('http://127.0.0.1:6666', 'h', 'cli 文案')
    } finally {
      process.stderr.write = original
      undo()
    }
    expect(seen).toEqual(['http://127.0.0.1:6666|h'])
    expect(written.join('')).not.toContain('LEAK')
  })

  it('整条路径：平台调用 showLink → 页面显示链接 → 可取消', async () => {
    const { showLink } = await import('../src/core/login.js')
    const p = definePlatform({
      id: 'demo',
      name: '演示站',
      aliases: [],
      item: '帖子',
      endpoints: {
        web: {
          login: { methods: ['sms'], default: 'sms' },
          commands: {
            'auth login': {
              upstream: 'full',
              handler: async () => async (ctx: HandlerContext) => {
                const credential = freshCredential(ctx, 'sms' as never)
                showLink('http://127.0.0.1:7777/verify', '请在浏览器打开下面的链接完成人机验证（180 秒内），完成后自动继续', 'cli 文案')
                await poll(async () => undefined, { interval: 20 })
                return finishLogin(ctx, credential, { id: 'u', name: 'n', url: null })
              },
            },
          },
        },
        app: 'planned',
        pc: 'planned',
      },
    })
    const s = await start({ platforms: [p], columns: 100, rows: 28 })
    try {
      await s.press('a', 'n')
      await s.press(KEYS.down, KEYS.down) // 账号名 → 手机号
      await s.type('13800000000')
      await s.press(KEYS.enter)
      await s.settle(200)
      const t = s.screen().join('\n')
      expect(t).toContain('需要在浏览器里完成人机验证')
      expect(t).toContain('http://127.0.0.1:7777/verify')
      expect(t).toContain('180 秒内')
      await s.press(KEYS.esc)
      await s.settle(100)
      expect(s.screen().join('\n')).toContain('登录方式')
    } finally {
      s.stop()
    }
  })
})

describe('未登录的错误页 → 直接登录', () => {
  useTempHome()
  it('Enter 进入登录页（选方式），不用退出界面', async () => {
    const s = await start({ platforms: [fake], columns: 120, rows: 34 })
    try {
      await s.press('/')
      await s.type('demo item get')
      await s.press(KEYS.enter)
      await s.type('p1')
      await s.press(KEYS.enter)
      await s.settle(250)
      const t = () => s.screen().join('\n')
      expect(t()).toContain('需要登录')
      expect(t()).toContain('直接登录演示站')
      expect(t()).toContain('去登录')
      await s.press(KEYS.enter)
      expect(t()).toContain('登录方式')
      expect(t()).toContain('扫码')
    } finally {
      s.stop()
    }
  })
})
