import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { finishLogin, freshCredential } from '../src/core/login.js'
import { definePlatform, type Command, type HandlerContext, type Platform } from '../src/core/registry.js'
import { invoke, prepare, splitCursor } from '../src/cli/exec.js'
import { findPlatform, PLATFORMS } from '../src/platforms/index.js'
import { READ_ACTIONS, runnable } from '../src/tui/model.js'
import { loginFields } from '../src/tui/login.js'
import { cli, mockTrain, useTempHome } from './helpers.js'

// src/cli/exec.ts 是终端界面运行命令的入口（AGENTS 4.13）：它按 dispatch.runPlatform 的顺序把同一批函数串起来。
// 这里守住两件事：
//   1. 同一条命令，经 exec 和经 CLI 得到的 data、落盘的凭证一致；
//   2. runPlatform 里新增一步时，这个文件里的检查会失败，提醒在 exec.ts 补上同一步。

const log = { debug() {}, info() {}, warn() {} }
const NONE: Record<string, unknown> = {}
const signal = () => new AbortController().signal
const cmd = (p: Platform, key: string): Command => (p.endpoints.web as Exclude<Platform['endpoints']['web'], 'planned'>).commands.get(key)!
const SRC = join(import.meta.dirname, '../src/cli')

describe('exec 与 CLI 的结果一致', () => {
  const home = useTempHome()

  it('读取命令：12306 station search 的 data 与 CLI 信封里的 data 相同', async () => {
    const { restore } = mockTrain()
    try {
      const p = findPlatform('12306')!
      const viaCli = await cli('12306', 'station', 'search', '北京')
      expect(viaCli.code).toBe(0)
      const viaExec = await invoke({ platform: p, command: cmd(p, 'station search'), words: ['北京'], given: {}, log, signal: signal() })
      expect(JSON.parse(JSON.stringify(viaExec.data))).toEqual(viaCli.env.data)
      expect(viaExec.account).toBe(viaCli.env.account)
    } finally {
      restore()
    }
  })

  it('校验与错误码相同：缺参数、多余选项、未登录', async () => {
    const p = findPlatform('bilibili')!
    const cases: [string, string[], Record<string, unknown>, string[]][] = [
      ['item get', [], NONE, ['bilibili', 'item', 'get']],
      ['item get', ['BV1xx411c7mD'], { nope: true }, ['bilibili', 'item', 'get', 'BV1xx411c7mD', '--nope']],
      ['item get', ['BV1xx411c7mD'], NONE, ['bilibili', 'item', 'get', 'BV1xx411c7mD']],
      ['item search', ['猫'], { sort: 'price_asc' }, ['bilibili', 'item', 'search', '猫', '--sort', 'price_asc']],
    ]
    for (const [key, words, given, argv] of cases) {
      const viaCli = await cli(...argv)
      const err = await invoke({ platform: p, command: cmd(p, key), words, given, log, signal: signal() }).then(
        () => null,
        (e) => e,
      )
      expect(err, argv.join(' ')).not.toBeNull()
      // --nope 这样的未知选项 CLI 在解析 argv 时就拒绝了，文案不同；错误码仍应一致
      expect(err.code, argv.join(' ')).toBe(viaCli.env.error.code)
      if (!('nope' in given)) expect({ message: err.message, hint: err.hint }).toEqual({ message: viaCli.env.error.message, hint: viaCli.env.error.hint })
    }
  })

  it('auth status：在线校验拿到的新昵称 / 头像合并回凭证并落盘（与 CLI 相同）', async () => {
    const viewer = (name: string, avatar: string) => ({
      data: { viewer: { user_results: { result: { __typename: 'User', rest_id: '10001', core: { name, screen_name: 'catbus_test' }, avatar: { image_url: avatar }, legacy: {} } } } },
    })
    const cookies = 'auth_token=fakeauthtoken000000000000000000000000000000; ct0=fakect0000000000000000000000000000000000000000; twid=u%3D10001; lang=en'
    let res = viewer('原来的名字', 'https://pbs.twimg.com/profile_images/1/a_normal.jpg')
    const restore = mockSender(() => fakeResponse(res))
    try {
      expect((await cli('x', 'auth', 'login', '--cookie', cookies)).code).toBe(0)
      const file = join(home.dir, 'auth', 'x', 'web', 'default.json')
      res = viewer('改过的名字', 'https://pbs.twimg.com/profile_images/2/b_normal.jpg')
      const p = findPlatform('x')!
      const { data } = await invoke({ platform: p, command: cmd(p, 'auth status'), words: [], given: NONE, log, signal: signal() })
      expect(data).toMatchObject({ logged_in: true, user: { id: '10001', name: '改过的名字' } })
      expect(JSON.parse(readFileSync(file, 'utf8')).user).toMatchObject({ name: '改过的名字', avatar: 'https://pbs.twimg.com/profile_images/2/b_normal.jpg' })
    } finally {
      restore()
    }
  })
})

describe('exec：凭证落盘的规则', () => {
  const home = useTempHome()
  const state = { seen: [] as string[] }
  const demo = definePlatform({
    id: 'demo2',
    name: '演示站二',
    aliases: [],
    item: '帖子',
    endpoints: {
      web: {
        login: { methods: ['cookie'], default: 'cookie' },
        commands: {
          'auth login': {
            upstream: 'full',
            handler: async () => async (ctx: HandlerContext) => {
              // 模拟平台在登录过程中往目标账号的旧凭证上写了东西：结束时不能把它写回去盖掉新凭证
              ctx.credential.extra.touched = true
              return finishLogin(ctx, freshCredential(ctx, 'cookie'), { id: String(ctx.options.cookie), name: '用户', url: null, avatar: null })
            },
          },
          'item get': {
            upstream: 'full',
            handler: async () => async (ctx: HandlerContext) => {
              state.seen.push(String(ctx.account))
              ctx.credential.extra.refreshed = (Number(ctx.credential.extra.refreshed) || 0) + 1
              return { id: String(ctx.args.item) }
            },
          },
          'item delete': { upstream: 'full', handler: async () => async () => ({ id: 'x' }) },
          'item list': 'none',
        },
      },
      app: 'planned',
      pc: 'planned',
    },
  })
  const run = (key: string, words: string[], given: Record<string, unknown> = {}, account?: string) => {
    const inv = { platform: demo, command: cmd(demo, key), words, given, log, signal: signal() }
    return invoke(account ? { ...inv, account } : inv)
  }

  it('命令里更新过的凭证落盘；没变就不写', async () => {
    const c = newCredential({ platform: 'demo2', endpoint: 'web', account: 'default', method: 'cookie' })
    c.user = { id: 'u1', name: '用户', url: null, avatar: null }
    await writeCredential(c)
    await setCurrent('demo2', 'web', 'default')
    await run('item get', ['1'])
    await run('item get', ['2'])
    expect((await readCredential('demo2', 'web', 'default'))?.extra.refreshed).toBe(2)
  })

  it('auth login：新凭证由 finishLogin 落盘，结束时不把目标账号的旧凭证写回去（master #50 的规则）', async () => {
    await run('auth login', [], { method: 'cookie', cookie: 'u1' })
    expect((await readCredential('demo2', 'web', 'default'))?.user?.id).toBe('u1')
    // 同一个用户重新登录：handler 改过旧凭证对象（extra.touched）。旧凭证若在结束时落盘，会盖掉刚保存的新凭证
    await run('auth login', [], { method: 'cookie', cookie: 'u1' })
    expect((await readCredential('demo2', 'web', 'default'))?.extra.touched).toBeUndefined()
    // 换成另一个用户：视为先登出再登录，旧凭证被替换
    const { data } = await run('auth login', [], { method: 'cookie', cookie: 'u2' })
    expect(data).toMatchObject({ account: 'default', user: { id: 'u2' } })
    const saved = await readCredential('demo2', 'web', 'default')
    expect(saved?.user?.id).toBe('u2')
    expect(saved?.extra.touched).toBeUndefined()
  })

  it('auth login --auto-bind：与 -a、--scope 冲突时报 USAGE（与 CLI 的检查是同一个函数）', async () => {
    await expect(run('auth login', [], { method: 'cookie', cookie: 'u1', autoBind: true }, 'work')).rejects.toMatchObject({ code: 'USAGE' })
    const { data } = await run('auth login', [], { method: 'cookie', cookie: 'u9', autoBind: true })
    expect(data).toMatchObject({ user: { id: 'u9' } })
  })

  it('-a 指定账号；账号不存在报 AUTH_REQUIRED；规划中的命令报 NOT_IMPLEMENTED', async () => {
    for (const a of ['one', 'two']) {
      const c = newCredential({ platform: 'demo2', endpoint: 'web', account: a, method: 'cookie' })
      c.user = { id: a, name: a, url: null, avatar: null }
      await writeCredential(c)
    }
    await setCurrent('demo2', 'web', 'one')
    state.seen = []
    await run('item get', ['1'])
    await run('item get', ['1'], {}, 'two')
    expect(state.seen).toEqual(['one', 'two'])
    await expect(run('item get', ['1'], {}, 'nobody')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(run('item list', [])).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })

  it('--cookie -（从 stdin 读）在进程内报 USAGE，不去读 stdin；@文件 照常读取', async () => {
    await expect(run('auth login', [], { method: 'cookie', cookie: '-' })).rejects.toMatchObject({ code: 'USAGE', message: expect.stringContaining('stdin') })
    expect(await readCredential('demo2', 'web', 'default')).toBeNull()
    const file = join(home.dir, 'cookie.txt')
    writeFileSync(file, 'u7')
    const { data } = await run('auth login', [], { method: 'cookie', cookie: '@' + file })
    expect(data).toMatchObject({ user: { id: 'u7' } })
  })

  it('prepare 不运行 handler，finish 才落盘（监听用）', async () => {
    const c = newCredential({ platform: 'demo2', endpoint: 'web', account: 'default', method: 'cookie' })
    await writeCredential(c)
    await setCurrent('demo2', 'web', 'default')
    const r = await prepare({ platform: demo, command: cmd(demo, 'item get'), words: ['1'], given: {}, log, signal: signal() })
    expect((await readCredential('demo2', 'web', 'default'))?.extra.refreshed).toBeUndefined()
    await r.handler(r.ctx)
    await r.finish()
    expect((await readCredential('demo2', 'web', 'default'))?.extra.refreshed).toBe(1)
  })
})

describe('exec 与 dispatch.runPlatform 保持同步', () => {
  // runPlatform 里“校验之后、调用 handler 之前”的每一步，以及 handler 返回之后的加工，都必须是 dispatch.ts 导出的函数，
  // 并且在 exec.ts 里也调用。这样 CLI 新增一条规则（像 master 加 --auto-bind、auth status 回写头像那样）时，
  // 要么写成导出函数并在 exec.ts 里补上（界面跟着生效），要么这里失败。
  const dispatch = readFileSync(join(SRC, 'dispatch.ts'), 'utf8')
  const exec = readFileSync(join(SRC, 'exec.ts'), 'utf8')
  const body = /async function runPlatform\([\s\S]*?\n}\n/.exec(dispatch)![0]
  const afterValidate = body.slice(body.indexOf('validate(platform, command'))

  it('runPlatform 调用的 dispatch 内部函数，exec.ts 都用到了（CLI 独有的几步除外）', () => {
    const local = new Set([...dispatch.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)].map((m) => m[1]!))
    const called = new Set([...afterValidate.matchAll(/\b(\w+)\(/g)].map((m) => m[1]!).filter((n) => local.has(n)))
    // 输出方式是 CLI 自己的事：信封、按 --limit 翻页、jsonl 流
    const cliOnly = new Set(['runPaged', 'runStream'])
    const shared = [...called].filter((n) => !cliOnly.has(n)).sort()
    expect(shared).toEqual(['checkAutoBind', 'createHandlerContext', 'credentialSnapshot', 'persistCredential', 'readFileOptions', 'resolveIdentity', 'settle', 'validate'])
    for (const name of shared) expect(exec, `exec.ts 没有调用 ${name}`).toMatch(new RegExp(`\\b${name}\\(`))
  })

  it('runPlatform 里按命令名做的特殊处理只有已知的这几处', () => {
    // 新增 `key === '...'` 分支时，想一想界面（exec.ts）要不要同样处理，再更新这里
    const special = [...afterValidate.matchAll(/key === '([a-z]+ [a-z]+)'/g)].map((m) => m[1]!)
    expect(special).toEqual(['auth login', 'auth login', 'auth login'])
  })

  it('splitCursor 两边是同一个函数', async () => {
    const d = await import('../src/cli/dispatch.js')
    expect(splitCursor).toBe(d.splitCursor)
    expect(splitCursor('abc#skip=3')).toEqual({ cursor: 'abc', skip: 3 })
  })
})

describe('界面里能运行的命令（AGENTS 4.13）', () => {
  const all = PLATFORMS.flatMap((p) => {
    const ep = p.endpoints.web
    return ep === 'planned' ? [] : [...ep.commands.values()].map((c) => ({ p, c }))
  })

  it('读取类动作的集合与规范、在线测试里的那份一致', () => {
    const agents = readFileSync(join(import.meta.dirname, '../AGENTS.md'), 'utf8')
    const line = /\*\*能在界面里运行的命令\*\*：读取类（动作是 ([^）]+)）/.exec(agents)![1]!
    expect([...READ_ACTIONS].sort()).toEqual([...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!).sort())
    const e2e = readFileSync(join(import.meta.dirname, 'e2e/live.e2e.ts'), 'utf8')
    const set = /const READ_ACTIONS = new Set\(\[([\s\S]*?)\]\)/.exec(e2e)![1]!
    const online = [...set.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!)
    // 在线测试只跑内容平台的通用读取命令；它认定只读的动作，界面必须也认
    for (const a of online) expect(READ_ACTIONS.has(a), `在线测试当作只读的 ${a} 不在界面的读取类动作里`).toBe(true)
  })

  it('需要确认的命令、长连接、auth 之外的写入都不会被判成可运行', () => {
    for (const { p, c } of all) {
      if (!runnable(c)) continue
      expect(c.confirm, `${p.id} ${c.key}`).toBeFalsy()
      expect(c.stream, `${p.id} ${c.key}`).toBeFalsy()
      expect(c.status).toBe('implemented')
    }
  })

  it('每个已实现命令的动作都有归属：新增动作时在这里登记它是读取还是写入', () => {
    // 界面按动作名判断能不能运行（白名单）。新动作默认不能在界面里运行，这是安全的一侧；
    // 这个用例只是不让它被悄悄漏掉：只读的加进 READ_ACTIONS（并改 AGENTS 4.13），其余加进下面这份。
    const WRITE = new Set([
      'add', 'coin', 'collect', 'create', 'delete', 'download', 'edit', 'follow', 'like', 'login', 'logout', 'pin', 'publish', 'read', 'repost',
      'revoke', 'send', 'start', 'stop', 'triple', 'uncollect', 'unfollow', 'unlike', 'unpin', 'unrepost', 'update', 'upload', 'use', 'listen',
    ])
    const unknown = [...new Set(all.map(({ c }) => c.action))].filter((a) => !READ_ACTIONS.has(a) && !WRITE.has(a))
    expect(unknown, '这些动作还没有登记是读取还是写入').toEqual([])
    for (const a of WRITE) expect(READ_ACTIONS.has(a), a).toBe(false)
  })
})

describe('登录页的表单从注册表生成', () => {
  it('各平台、各登录方式的字段', () => {
    const names = (id: string, method: Parameters<typeof loginFields>[1]) => loginFields(findPlatform(id)!, method).map((f) => (f.required ? '*' : '') + f.name)
    expect(names('bilibili', 'qrcode')).toEqual(['autoBind'])
    expect(names('bilibili', 'sms')).toEqual(['phone', 'autoBind'])
    expect(names('bilibili', 'password')).toEqual(['*username', 'autoBind'])
    expect(names('bilibili', 'cookie')).toEqual(['*cookie', 'autoBind'])
    // 平台私有选项按说明末尾标注的方式出现
    expect(names('douyin', 'sms')).toEqual(['phone', 'autoBind', 'sso'])
    expect(names('douyin', 'qrcode')).toEqual(['autoBind'])
    expect(names('mteam', 'apikey')).toEqual(['apiKeyFile'])
    expect(names('mteam', 'password')).toEqual(['*username', 'email'])
    // 平台声明不支持的标准选项不出现
    expect(names('jimeng', 'oauth')).toEqual([])
  })

  it('从 stdin 读取的选项、分步登录用的 --code / --user 不进表单；cookie 隐藏输入', () => {
    for (const p of PLATFORMS) {
      const ep = p.endpoints.web
      if (ep === 'planned') continue
      for (const m of ep.login.methods) {
        const fields = loginFields(p, m)
        for (const f of fields) {
          expect(f.name.endsWith('Stdin'), `${p.id} ${m} ${f.name}`).toBe(false)
          expect(['method', 'scope', 'code', 'user']).not.toContain(f.name)
          expect(f.label).toMatch(/^--[a-z][a-z-]*$/)
        }
        expect(fields.find((f) => f.name === 'cookie')?.hidden ?? true).toBe(true)
      }
    }
  })

  it('平台新增一个登录选项，表单里自动出现', () => {
    const p = definePlatform({
      id: 'demo3',
      name: '演示站三',
      aliases: [],
      item: '帖子',
      endpoints: {
        web: {
          login: { methods: ['qrcode', 'sms'], default: 'qrcode' },
          commands: {
            'auth login': {
              upstream: 'full',
              options: { region: z.string().optional().describe('登录区域（sms）'), trustDevice: z.boolean().optional().describe('记住这台设备') },
              handler: async () => async () => ({}),
            },
          },
        },
        app: 'planned',
        pc: 'planned',
      },
    })
    expect(loginFields(p, 'sms').map((f) => [f.name, f.kind, f.hint])).toEqual([
      ['phone', 'text', '手机号'],
      ['autoBind', 'toggle', '按登录的用户自动选账号：已保存过就刷新那个账号，否则新增（default 空着时用 default）'],
      ['region', 'text', '登录区域'],
      ['trustDevice', 'toggle', '记住这台设备'],
    ])
    expect(loginFields(p, 'qrcode').map((f) => f.name)).toEqual(['autoBind', 'trustDevice'])
  })
})
