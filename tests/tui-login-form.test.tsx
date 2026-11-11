import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CatbusError } from '../src/core/errors.js'
import { claimStdin, finishLogin, freshCredential, interactive, prompt, setLoginUi } from '../src/core/login.js'
import { definePlatform, type HandlerContext } from '../src/core/registry.js'
import { newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { LogBuffer } from '../src/tui/logs.js'
import { KEYS, type Session, start } from './tui-harness.js'
import { useTempHome } from './helpers.js'

// 登录页从注册表生成表单、提问页显示平台给的说明、stdin 归界面的守卫、平台栏滚动。平台是假的，不联网。

/** 假平台：auth login 多了一个私有文本选项和一个私有开关；handler 把收到的选项记下来。 */
const seen: Record<string, unknown>[] = []
const fake = definePlatform({
  id: 'demo4',
  name: '演示站四',
  aliases: [],
  item: '帖子',
  endpoints: {
    web: {
      login: { methods: ['sms', 'cookie'], default: 'sms' },
      commands: {
        'auth login': {
          upstream: 'full',
          options: {
            region: z.string().optional().describe('登录区域（sms）'),
            trustDevice: z.boolean().optional().describe('记住这台设备'),
          },
          handler: async () => async (ctx: HandlerContext) => {
            seen.push({ ...ctx.options })
            if (ctx.options.method === 'sms') {
              ctx.log.info('该手机号下有多个账号，选择要登录的：')
              ctx.log.info('  1) 大号  1001')
              ctx.log.info('  2) 小号  1002')
              const pick = await prompt('输入序号：')
              if (pick !== '2') throw new CatbusError('USAGE', '没有选小号')
            }
            return finishLogin(ctx, freshCredential(ctx, ctx.options.method as never), { id: '1002', name: '小号', url: null, avatar: null })
          },
        },
        'item get': {
          upstream: 'full',
          // 一个读取命令的 handler 误用了 prompt：界面里不能去抢 stdin
          handler: async () => async () => ({ id: await prompt('要看哪一条：') }),
        },
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})

describe('tui 登录页：表单从注册表生成', () => {
  useTempHome()
  let s: Session | null = null
  afterEach(() => {
    s?.stop()
    s = null
    seen.length = 0
  })
  const text = () => s!.screen().join('\n')

  it('平台私有的登录选项自动出现：文本可填、开关可切，值原样传给 handler', async () => {
    s = await start({ columns: 120, rows: 34, platforms: [fake] })
    await s.press('a', 'n')
    const first = text()
    // sms 方式：词表的 --phone、--auto-bind，加上平台私有的 --region（标注了 sms）和 --trust-device（不标注，各方式通用）
    for (const label of ['--phone', '--auto-bind', '--region', '--trust-device']) expect(first).toContain(label)
    // 分步登录用的 --code / --user、从 stdin 读的选项不进表单
    for (const label of ['--code', '--user ', '--password-stdin', '--cookie']) expect(first).not.toContain(label)
    await s.press(KEYS.down, KEYS.down) // 账号名 → --phone
    expect(text()).toContain('手机号') // 焦点所在字段的说明
    await s.type('13800000000')
    await s.press(KEYS.down, KEYS.down) // --auto-bind → --region
    await s.type('cn')
    await s.press(KEYS.down) // --trust-device
    expect(text()).toContain('[ ] 记住这台设备')
    await s.press(' ')
    expect(text()).toContain('[x] 记住这台设备')
    await s.press(KEYS.enter)
    await s.waitForText('输入序号')
    // 提问之前平台打的说明（待选账号）要留在页面上，不能只在状态栏闪一下
    expect(text()).toContain('该手机号下有多个账号')
    expect(text()).toContain('2) 小号  1002')
    await s.type('2')
    await s.press(KEYS.enter)
    await s.waitForText('已登录')
    expect(seen[0]).toMatchObject({ method: 'sms', phone: '13800000000', region: 'cn', trustDevice: true })
    expect(seen[0]).not.toHaveProperty('autoBind')
    expect((await readCredential('demo4', 'web', 'default'))?.user?.id).toBe('1002')
  })

  it('换登录方式后字段跟着变；必填的没填时不开始登录', async () => {
    s = await start({ columns: 120, rows: 34, platforms: [fake] })
    await s.press('a', 'n')
    await s.press(KEYS.right) // cookie
    const t = text()
    expect(t).toContain('--cookie')
    expect(t).toContain('必填')
    expect(t).not.toContain('--phone')
    expect(t).not.toContain('--region') // 只标注了 sms
    expect(t).toContain('--trust-device')
    await s.press(KEYS.enter)
    expect(text()).toContain('先填 --cookie')
    expect(seen).toEqual([])
  })
})

describe('stdin 归界面（claimStdin）', () => {
  useTempHome()

  it('界面运行期间，钩子之外不可交互、提问直接报 USAGE；撤销后恢复', async () => {
    const before = interactive()
    const release = claimStdin()
    try {
      expect(interactive()).toBe(false)
      await expect(prompt('验证码：')).rejects.toMatchObject({ code: 'USAGE', message: expect.stringContaining('验证码') })
      // 登录页设了钩子时照常可以提问
      const undo = setLoginUi({ interactive: true, signal: new AbortController().signal, qrcode() {}, link() {}, prompt: async () => 'ok' })
      expect(interactive()).toBe(true)
      expect(await prompt('验证码：')).toBe('ok')
      undo()
      expect(interactive()).toBe(false)
    } finally {
      release()
    }
    expect(interactive()).toBe(before)
  })

  it('读取命令的 handler 在界面里提问：显示错误页，不挂住、不读 stdin', async () => {
    // 这个端不支持游客态，读取命令要先有账号
    const c = newCredential({ platform: 'demo4', endpoint: 'web', account: 'default', method: 'cookie' })
    c.user = { id: '1002', name: '小号', url: null, avatar: null }
    await writeCredential(c)
    await setCurrent('demo4', 'web', 'default')
    const release = claimStdin()
    const s = await start({ columns: 120, rows: 34, platforms: [fake] })
    try {
      await s.press(KEYS.enter, KEYS.down, KEYS.enter) // 进命令栏（item 组默认展开）→ item get → 表单
      await s.type('1')
      await s.press(KEYS.enter)
      await s.waitForText('USAGE')
      expect(s.screen().join('\n')).toContain('不能在界面里完成')
    } finally {
      s.stop()
      release()
    }
  })
})

describe('账号页：操作成功但刷新列表失败', () => {
  const home = useTempHome()

  // 用目录权限模拟“读不出账号列表”：Windows 上 chmod 不限制读取，root 不受权限限制，这两种环境跳过
  const cannotSimulate = process.platform === 'win32' || process.getuid?.() === 0

  it.skipIf(cannotSimulate)('切换账号成功后列表读不出来：提示里既有“当前账号”也有失败原因，不会被成功提示盖掉', async () => {
    const c = newCredential({ platform: 'demo4', endpoint: 'web', account: 'default', method: 'cookie' })
    c.user = { id: '1002', name: '小号', url: null, avatar: null }
    await writeCredential(c)
    await setCurrent('demo4', 'web', 'default')
    const dir = join(home.dir, 'auth', 'demo4', 'web')
    const s = await start({ columns: 120, rows: 34, platforms: [fake] })
    try {
      await s.press('a')
      await s.waitForText('小号')
            // 目录可写、可进入，但不可列出：写 _current 能成功，之后列出账号会失败
      chmodSync(dir, 0o300)
      await s.press(KEYS.enter) // 设为当前账号
      await s.waitForText('读取账号列表失败')
      expect(s.screen().join('|')).toContain('当前账号：default')
    } finally {
      chmodSync(dir, 0o700)
      s.stop()
    }
  })
})

describe('日志缓冲：since', () => {
  it('取某个时刻之后的行；缓冲截断后也不越界', () => {
    const buf = new LogBuffer()
    buf.push('a\nb')
    const mark = buf.count
    expect(buf.since(mark)).toEqual([])
    buf.push('c')
    buf.push('d\n\ne')
    expect(buf.since(mark)).toEqual(['c', 'd', 'e'])
    for (let i = 0; i < 300; i++) buf.push(`x${i}`)
    expect(buf.lines).toHaveLength(200)
    expect(buf.since(mark)).toHaveLength(200)
    expect(buf.since(buf.count - 2)).toEqual(['x298', 'x299'])
  })
})

describe('平台栏', () => {
  useTempHome()

  it('平台多到一屏放不下时滚动：最后一个平台也选得到、看得见', async () => {
    // 现有平台数在 24 行里还放得下；以后会更多，用 30 个假平台验证
    const many = Array.from({ length: 30 }, (_, i) =>
      definePlatform({
        id: `p${i}`,
        name: `平台${String(i).padStart(2, "0")}`,
        aliases: [],
        item: '帖子',
        endpoints: { web: { login: { methods: [] }, guest: true, commands: { 'item get': { upstream: 'full', handler: async () => async () => ({ id: '1' }) } } }, app: 'planned', pc: 'planned' },
      }),
    )
    const s = await start({ columns: 100, rows: 24, platforms: many })
    try {
      const left = () => s.screen().map((line) => line.slice(0, 22)).join('|')
      expect(left()).toContain('平台00')
      expect(left()).not.toContain('平台29')
      expect(left()).toMatch(/1-\d+ \/ 30/)
      for (let i = 0; i < many.length - 1; i++) await s.press(KEYS.down)
      expect(s.screen().join('|')).toContain('命令 › 平台29')
      // 选中的平台要出现在左边的平台栏里，而不只是右边的标题里；图例还在
      expect(left()).toContain('平台29')
      expect(left()).not.toContain('平台00')
      expect(left()).toContain('/ 30')
      expect(left()).toContain('免登录可用')
    } finally {
      s.stop()
    }
  })
})
