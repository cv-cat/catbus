import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import type { HandlerContext } from '../src/core/registry.js'
import { withRaw } from '../src/core/schemas.js'
import { cli, useTempHome } from './helpers.js'

// 在真实注册表后面加一个带 handler 的演示平台，测试 core 的执行流程：身份、确认、分页、长连接、--raw。
vi.mock('../src/platforms/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/platforms/index.js')>()
  const { definePlatform } = await import('../src/core/registry.js')
  const { reconnecting } = await import('../src/core/stream.js')
  const { CatbusError } = await import('../src/core/errors.js')
  const h = (fn: (ctx: HandlerContext) => unknown) => async () => fn as any

  const demo = definePlatform({
    id: 'demo',
    name: '演示',
    aliases: ['dm0'],
    item: '条目',
    pageInterval: 0,
    endpoints: {
      web: {
        login: { methods: ['cookie'], default: 'cookie' },
        // 演示游客态（真实平台的 web 端都不支持，留给 app / pc 端）
        guest: true,
        commands: {
          'user get': {
            upstream: 'full',
            handler: h(async (ctx) => ({ id: ctx.args.user, account: ctx.account, cookie: ctx.credential?.scopes.main?.cookies[0]?.value ?? null })),
          },
          'user followers': { upstream: 'full', handler: h(async () => ({ data: [], page: { cursor: null, has_more: false } })) },
          'item get': { upstream: 'full', handler: h(async (ctx) => withRaw({ id: ctx.args.item }, { raw_id: ctx.args.item })) },
          'item list': { upstream: 'full', handler: h(async () => ({ data: [], page: { cursor: null, has_more: false } })) },
          'item search': {
            upstream: 'full',
            // 每页 2 条，共 3 页
            handler: h(async (ctx) => {
              const n = Number(ctx.cursor ?? 0)
              return { data: [n * 2, n * 2 + 1], page: { cursor: String(n + 1), has_more: n < 2 } }
            }),
          },
          // 服务端把同一个游标又返回一遍（真实平台遇到过），--all 不能死循环
          'feed list': { upstream: 'full', handler: h(async () => ({ data: ['x'], page: { cursor: 'same', has_more: true } })) },
          'item delete': { upstream: 'full', handler: h(async (ctx) => ({ id: ctx.args.item })) },
          'item publish': { upstream: 'full', supports: ['text', 'image'], handler: h(async (ctx) => ({ text: ctx.options.text })) },
          // 重连解决不了的错误（登录态失效）不能无限重连
          'msg listen': {
            upstream: 'full',
            handler: h((ctx) => reconnecting(ctx, async function* () {
              yield* []
              throw new CatbusError('AUTH_EXPIRED', '登录态失效')
            })),
          },
          'live listen': {
            upstream: 'full',
            handler: h(async function* (ctx) {
              for (let i = 0; ; i++) {
                if (ctx.options.duration == null && i === 3) return
                yield { type: 'chat', text: String(i) }
                await new Promise((r) => setTimeout(r, 5))
              }
            }),
          },
          'auth status': {
            upstream: 'full',
            handler: h(async (ctx) => {
              const c = ctx.credential!
              c.extra.touched = true
              await ctx.saveCredential(c)
              return { account: ctx.account }
            }),
          },
        },
      },
      app: 'planned',
      pc: 'planned',
    },
  })
  // 不支持游客态的端（真实平台的 web 端都这样）：auth status 没有账号时用内存里的空凭证，不写 guest.json
  const demo2 = definePlatform({
    id: 'demo2',
    name: '演示 2',
    aliases: [],
    item: '条目',
    endpoints: {
      web: {
        login: { methods: ['cookie'], default: 'cookie' },
        commands: {
          'auth status': {
            upstream: 'full',
            handler: h(async (ctx) => {
              ctx.credential.extra.device = 'generated'
              return { logged_in: false, user: null, method: null, expires_at: null }
            }),
          },
        },
      },
      app: 'planned',
      pc: 'planned',
    },
  })
  const PLATFORMS = [...real.PLATFORMS, demo, demo2]
  return { PLATFORMS, findPlatform: (n: string) => PLATFORMS.find((p) => p.id === n || p.aliases.includes(n)) }
})

const home = useTempHome()

const PROMPT = '[catbus] 未登录 demo (web)，本次以游客身份访问，结果可能不完整；很多操作需要登录。登录：catbus demo auth login\n'

async function login(account = 'work', current = true) {
  const c = newCredential({ platform: 'demo', endpoint: 'web', account, method: 'cookie' })
  c.scopes.main!.cookies.push({ name: 'sid', value: `fake-${account}`, domain: '.demo.test', path: '/', expires: null })
  await writeCredential(c)
  if (current) await setCurrent('demo', 'web', account)
}

describe('身份与游客态', () => {
  it('optional 命令以游客执行，stderr 提示登录', async () => {
    const r = await cli('demo', 'user', 'get', 'u1')
    expect(r.code).toBe(0)
    expect(r.env).toMatchObject({ ok: true, platform: 'demo', account: 'guest', data: { id: 'u1', account: 'guest' } })
    expect(r.stderr).toBe(PROMPT)
  })

  it('-q 或 -a guest 时不提示', async () => {
    expect((await cli('demo', 'user', 'get', 'u1', '-q')).stderr).toBe('')
    expect((await cli('demo', 'user', 'get', 'u1', '-a', 'guest')).stderr).toBe('')
  })

  it('required 命令、me、不存在的 -a 账号都报 AUTH_REQUIRED（退出码 3）', async () => {
    const required = await cli('demo', 'item', 'list')
    expect(required.code).toBe(3)
    expect(required.env.error).toMatchObject({ code: 'AUTH_REQUIRED', hint: 'catbus demo auth login' })
    expect((await cli('demo', 'user', 'get', 'me')).code).toBe(3)
    expect((await cli('demo', 'user', 'followers')).env.error.message).toContain('me')
    const missing = await cli('demo', 'user', 'get', 'u1', '-a', 'nobody')
    expect(missing.env.error.hint).toBe('catbus demo auth login -a nobody')
  })

  it('-a > _current > 游客', async () => {
    await login('work')
    await login('alt', false)
    const current = await cli('demo', 'user', 'get', 'me')
    expect(current.env.account).toBe('work')
    expect(current.env.data.cookie).toBe('fake-work')
    expect(current.stderr).toBe('')
    expect((await cli('demo', 'user', 'get', 'x', '-a', 'alt')).env.data.cookie).toBe('fake-alt')
    expect((await cli('demo', 'user', 'get', 'x', '-a', 'guest')).env.account).toBe('guest')
  })

  it('凭证由 core 落盘', async () => {
    await login('work')
    expect((await cli('demo', 'auth', 'status')).env.data).toEqual({ account: 'work' })
    expect((await readCredential('demo', 'web', 'work'))!.extra).toEqual({ touched: true })
  })
})

describe('危险操作确认', () => {
  it('非 TTY 且没有 -y → CONFIRM_REQUIRED（退出码 2）', async () => {
    await login()
    const r = await cli('demo', 'item', 'delete', 'i1')
    expect(r.code).toBe(2)
    expect(r.env.error.code).toBe('CONFIRM_REQUIRED')
    expect((await cli('demo', 'item', 'delete', 'i1', '-y')).env.data).toEqual({ id: 'i1' })
  })
})

describe('分页', () => {
  it('默认只取一页，page 带 cursor', async () => {
    const r = await cli('demo', 'item', 'search', 'kw', '-q')
    expect(r.env.data).toEqual([0, 1])
    expect(r.env.page).toEqual({ cursor: '1', has_more: true })
  })

  it('--all：游标没有变化时停止翻页，page.has_more 为 false', async () => {
    const r = await cli('demo', 'feed', 'list', '-q', '--all')
    expect(r.env.data).toEqual(['x', 'x'])
    expect(r.env.page).toEqual({ cursor: 'same', has_more: false })
  })

  it('--limit 翻到取满 N 条；--all 翻到没有更多；--cursor 继续', async () => {
    expect((await cli('demo', 'item', 'search', 'kw', '-q', '--limit', '3')).env.data).toEqual([0, 1, 2])
    const all = await cli('demo', 'item', 'search', 'kw', '-q', '--all')
    expect(all.env.data).toEqual([0, 1, 2, 3, 4, 5])
    expect(all.env.page).toEqual({ cursor: '3', has_more: false })
    expect((await cli('demo', 'item', 'search', 'kw', '-q', '--cursor', '2')).env.data).toEqual([4, 5])
  })

  it('--limit 截在一页中间：page.cursor 指回这一页，续翻时跳过已输出的，不丢数据', async () => {
    const first = await cli('demo', 'item', 'search', 'kw', '-q', '--limit', '3')
    expect(first.env.data).toEqual([0, 1, 2])
    expect(first.env.page).toEqual({ cursor: '1#skip=1', has_more: true })
    const next = await cli('demo', 'item', 'search', 'kw', '-q', '--limit', '3', '--cursor', first.env.page.cursor)
    expect(next.env.data).toEqual([3, 4, 5])
    expect(next.env.page).toEqual({ cursor: '3', has_more: false })
    // 截在第一页：游标是 #skip=N
    const one = await cli('demo', 'item', 'search', 'kw', '-q', '--limit', '1')
    expect(one.env.page).toEqual({ cursor: '#skip=1', has_more: true })
    expect((await cli('demo', 'item', 'search', 'kw', '-q', '--cursor', '#skip=1')).env.data).toEqual([1])
  })

  it('jsonl：stdout 每行一条，stderr 一行摘要信封', async () => {
    const r = await cli('demo', 'item', 'search', 'kw', '-q', '--all', '-o', 'jsonl')
    expect(r.stdout).toBe('0\n1\n2\n3\n4\n5\n')
    expect(JSON.parse(r.stderr)).toMatchObject({ ok: true, data: null, page: { cursor: '3', has_more: false }, error: null })
  })
})

describe('长连接', () => {
  it('重连解决不了的错误（登录态失效）直接报错退出，不无限重连', async () => {
    await login()
    const r = await cli('demo', 'msg', 'listen', '-q')
    expect(r.code).toBe(3)
    expect(JSON.parse(r.stderr)).toMatchObject({ ok: false, error: { code: 'AUTH_EXPIRED' } })
  })

  it('总是输出 jsonl，结束时 stderr 写摘要', async () => {
    const r = await cli('demo', 'live', 'listen', 'room', '-q')
    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n').map((l) => JSON.parse(l).text)).toEqual(['0', '1', '2'])
    expect(JSON.parse(r.stderr)).toMatchObject({ ok: true, resource: 'live', action: 'listen', data: null })
  })

  it('--duration 到期正常退出（退出码 0）', async () => {
    const r = await cli('demo', 'live', 'listen', 'room', '-q', '--duration', '0.1')
    expect(r.code).toBe(0)
    expect(r.stdout.trim().split('\n').length).toBeGreaterThan(1)
    expect((await cli('demo', 'live', 'listen', 'room', '--duration', '10x')).env.error.code).toBe('USAGE')
  })
})

describe('输出', () => {
  it('--raw 用原始对象代替归一化对象', async () => {
    expect((await cli('demo', 'item', 'get', 'i1', '-q')).env.data).toEqual({ id: 'i1' })
    expect((await cli('demo', 'item', 'get', 'i1', '-q', '--raw')).env.data).toEqual({ raw_id: 'i1' })
  })

  it('--text @file 从文件读取', async () => {
    await login()
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = join(process.env.CATBUS_HOME!, 'post.txt')
    writeFileSync(file, '正文')
    expect((await cli('demo', 'item', 'publish', '--text', `@${file}`)).env.data).toEqual({ text: '正文' })
  })
})

describe('发布选项（supports）', () => {
  it('没声明支持的标准选项报 UNSUPPORTED，hint 列出可用的；声明了的照常执行', async () => {
    await login()
    const r = await cli('demo', 'item', 'publish', '--text', 'hi', '--visibility', 'private')
    expect(r.code).toBe(2)
    expect(r.env.error).toMatchObject({ code: 'UNSUPPORTED', message: 'demo 的 item publish 不支持 --visibility', hint: '可用的选项：--text、--image' })
    expect((await cli('demo', 'item', 'publish', '--text', 'hi')).env.data).toEqual({ text: 'hi' })
  })
})

describe('不支持游客态的端', () => {
  it('auth status 没有账号时凭证只在内存里，不写 guest.json', async () => {
    const r = await cli('demo2', 'auth', 'status')
    expect(r.env.data).toMatchObject({ logged_in: false })
    expect(existsSync(join(home.dir, 'auth', 'demo2', 'web', 'guest.json'))).toBe(false)
  })
})
