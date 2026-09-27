import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { newCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { cli, useTempHome } from './helpers.js'

const home = useTempHome()

describe('全局命令', () => {
  it('version', async () => {
    const r = await cli('version')
    expect(r.code).toBe(0)
    expect(r.env).toMatchObject({
      ok: true,
      platform: null,
      endpoint: null,
      resource: 'version',
      action: null,
      account: null,
      data: { node: process.versions.node, platform: process.platform, arch: process.arch },
      page: null,
      error: null,
    })
    expect((await cli('--version')).env.data).toEqual(r.env.data)
  })

  it('信封字段顺序固定', async () => {
    const r = await cli('version')
    expect(Object.keys(r.env)).toEqual(['ok', 'platform', 'endpoint', 'resource', 'action', 'account', 'data', 'page', 'error'])
  })

  it('platforms 列出全部平台，带参数时返回单个对象（接受别名）', async () => {
    const all = await cli('platforms')
    expect(all.env.data.map((p: any) => p.id)).toEqual(['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'weibo', 'xianyu', 'taobao', 'jd', 'x'])
    const one = await cli('platforms', 'rednote')
    expect(one.env.data.id).toBe('xhs')
    expect(one.env.data.endpoints).toEqual({ web: 'available', app: 'planned', pc: 'planned' })
    expect(one.env.data.commands).toContainEqual({
      endpoint: 'web',
      resource: 'feed',
      action: 'list',
      auth: 'optional',
      status: 'planned',
      upstream: 'partial',
      note: 'following 规划中',
    })
    expect((await cli('platforms', 'nope')).code).toBe(2)
  })

  it('config set / get / unset / list，平台段接受别名', async () => {
    expect((await cli('config', 'set', 'rednote.proxy', 'socks5://127.0.0.1:1080')).env.data).toEqual({
      key: 'xhs.proxy',
      value: 'socks5://127.0.0.1:1080',
    })
    expect((await cli('config', 'set', 'timeout', '12')).env.data).toEqual({ key: 'timeout', value: 12 })
    expect((await cli('config', 'get', 'xhs.proxy')).env.data).toBe('socks5://127.0.0.1:1080')
    expect((await cli('config', 'get', 'proxy')).env.data).toBeNull()
    expect((await cli('config', 'list')).env.data).toEqual({ timeout: 12, 'xhs.proxy': 'socks5://127.0.0.1:1080' })
    expect((await cli('config', 'unset', 'xhs.proxy')).env.data).toEqual({ key: 'xhs.proxy', value: null })
    expect((await cli('config', 'list')).env.data).toEqual({ timeout: 12 })
  })

  it('config 校验键和值', async () => {
    expect((await cli('config', 'set', 'proxy', 'ftp://x')).env.error.code).toBe('USAGE')
    expect((await cli('config', 'set', 'timeout', '0')).env.error.code).toBe('USAGE')
    expect((await cli('config', 'set', 'nope.proxy', 'http://x')).env.error.code).toBe('USAGE')
    expect((await cli('config', 'get', 'foo')).code).toBe(2)
    expect(existsSync(join(home.dir, 'config.toml'))).toBe(false)
  })

  it('auth list 列出所有平台所有端的账号', async () => {
    await writeCredential(newCredential({ platform: 'xhs', endpoint: 'web', account: 'work', method: 'cookie' }))
    await writeCredential(newCredential({ platform: 'bilibili', endpoint: 'web', account: 'default', method: 'qrcode' }))
    await setCurrent('bilibili', 'web', 'default')
    const r = await cli('auth', 'list')
    expect(r.env.resource).toBe('auth')
    expect(r.env.action).toBe('list')
    expect(r.env.data.map((a: any) => [a.platform, a.account, a.current])).toEqual([
      ['xhs', 'work', false],
      ['bilibili', 'default', true],
    ])
    expect((await cli('auth', 'login')).env.error.hint).toBe('catbus <platform> auth login')
  })

  it('doctor 的数据结构', async () => {
    const r = await cli('doctor')
    expect(r.env.data.map((c: any) => c.name)).toEqual(['node', 'home', 'vm', 'http', 'canvas', 'onnx', 'assets-jd'])
    for (const c of r.env.data) expect(c).toEqual({ name: c.name, ok: expect.any(Boolean), message: expect.any(String) })
    expect(r.env.ok).toBe(r.env.data.every((c: any) => c.ok))
    expect(r.code).toBe(r.env.ok ? 0 : 1)
  }, 30_000)
})

describe('帮助', () => {
  it('不带参数等同 --help，写到 stdout，退出码 0', async () => {
    const bare = await cli()
    expect(bare.code).toBe(0)
    expect(bare.stdout).toContain('catbus <platform> <resource> <action>')
    expect((await cli('--help')).stdout).toBe(bare.stdout)
  })

  it('四层帮助', async () => {
    expect((await cli('xhs')).stdout).toContain('端:   web ✓ · app ○ planned · pc ○ planned')
    expect((await cli('xhs', 'item')).stdout).toContain('item（笔记）')
    const cmd = await cli('xhs', 'item', 'get', '--help')
    expect(cmd.code).toBe(0)
    expect(cmd.stdout).toContain('用法: catbus xhs item get <item>')
    expect(cmd.stdout).toContain('端:   web ○ planned · app ○ planned · pc ○ planned')
    expect(cmd.stdout).toContain('登录: 可选')
  })

  it('-h 输出已到达的最深层级', async () => {
    expect((await cli('xhs', 'nope', 'get', '-h')).stdout).toContain('小红书 (xhs)')
    expect((await cli('xhs', 'item', 'nope', '-h')).stdout).toContain('item（笔记）')
  })
})

describe('命令判定', () => {
  it('端为 planned 时，词表内的命令报 NOT_IMPLEMENTED（退出码 4）', async () => {
    const r = await cli('xianyu', 'item', 'get', 'x', '-e', 'app')
    expect(r.code).toBe(4)
    expect(r.env).toMatchObject({ ok: false, platform: 'xianyu', endpoint: 'app', data: null })
    expect(r.env.error.code).toBe('NOT_IMPLEMENTED')
  })

  it('端为 planned 时，该平台的扩展命令也报 NOT_IMPLEMENTED，别的平台的扩展报 UNSUPPORTED', async () => {
    expect((await cli('xhs', 'kol', 'list', '-e', 'pc')).code).toBe(4)
    expect((await cli('bilibili', 'kol', 'list', '-e', 'pc')).code).toBe(2)
  })

  it('○ 的命令报 NOT_IMPLEMENTED，detail 带 upstream', async () => {
    const r = await cli('xhs', 'item', 'like', 'x')
    expect(r.code).toBe(4)
    expect(r.env.error.detail).toEqual({ upstream: 'none' })
  })

  it('— 的命令报 UNSUPPORTED（退出码 2）', async () => {
    const r = await cli('xhs', 'item', 'repost', 'x')
    expect(r.code).toBe(2)
    expect(r.env.error.code).toBe('UNSUPPORTED')
    expect(r.env.error.hint).toBe('catbus xhs item --help')
  })

  it('平台别名输出规范 id', async () => {
    expect((await cli('rednote', 'item', 'get', 'x')).env.platform).toBe('xhs')
  })

  it('原生叫法提示规范词', async () => {
    const hint = async (...a: string[]) => (await cli(...a)).env.error.hint
    expect(await hint('xhs', 'note', 'get', 'x')).toBe('用规范词：catbus xhs item get')
    expect(await hint('douyin', 'item', 'digg', 'x')).toBe('用规范词：catbus douyin item like')
    expect(await hint('x', 'tweet', 'unretweet', 'x')).toBe('用规范词：catbus x item unrepost')
    expect(await hint('x', 'item', 'favorite', 'x')).toBe('用规范词：catbus x item like')
    expect(await hint('xhs', 'item', 'playurl', 'x')).toBe('用规范词：catbus xhs item media')
    expect(await hint('tiktok', 'collection', 'list')).toBe('用规范词：catbus tiktok folder list')
    expect(await hint('xhs', 'collection', 'list')).toBe('规范词是 folder 或 series')
  })

  it('筛选：标准值但平台不支持 → UNSUPPORTED；不是标准值 → USAGE', async () => {
    const hot = await cli('xhs', 'feed', 'list', '--kind', 'hot')
    expect(hot.env.error.code).toBe('UNSUPPORTED')
    expect(hot.env.error.hint).toBe('可选：recommend、following')
    expect((await cli('xhs', 'feed', 'list', '--kind', 'nope')).env.error.code).toBe('USAGE')
    expect((await cli('xhs', 'feed', 'list', '--kind', 'following')).code).toBe(4)
  })

  it('参数与选项校验先于 NOT_IMPLEMENTED', async () => {
    expect((await cli('xhs', 'item', 'get')).env.error.message).toBe('缺少参数 <item>')
    expect((await cli('xhs', 'item', 'get', 'a', 'b')).env.error.message).toBe('多余的参数：b')
    expect((await cli('xhs', 'item', 'get', 'a', '--limit', '3')).env.error.code).toBe('USAGE')
    expect((await cli('xhs', 'user', 'search', 'kw', '--limit', 'abc')).env.error.code).toBe('USAGE')
    expect((await cli('xhs', 'user', 'search', 'kw', '--limit', '0')).env.error.code).toBe('USAGE')
    expect((await cli('bilibili', 'item', 'coin', 'BV1', '--count', '3')).env.error.code).toBe('USAGE')
    expect((await cli('xhs', 'live', 'send', 'room')).env.error.message).toBe('需要 <text> 或 --gift，二选一')
    expect((await cli('xhs', 'msg', 'send', 'hi')).env.error.message).toBe('--to、--conversation、--item 需要且只能用一个')
    expect((await cli('xhs', 'folder', 'update', 'f1')).env.error.code).toBe('USAGE')
  })

  it('未知选项、未知平台、未知端、未知输出格式都是 USAGE', async () => {
    expect((await cli('xhs', 'item', 'get', 'x', '--nope')).env.error.code).toBe('USAGE')
    expect((await cli('nope', 'item', 'get')).env.error.code).toBe('USAGE')
    expect((await cli('xhs', 'item', 'get', 'x', '-e', 'tv')).env.error.code).toBe('USAGE')
    expect((await cli('version', '-o', 'yaml')).env.error.code).toBe('USAGE')
  })

  it('-- 之后的内容一律按参数处理', async () => {
    expect((await cli('xhs', 'item', 'get', '--', '--not-an-option')).code).toBe(4)
  })
})

describe('auth（core 实现）', () => {
  it('use / list / logout', async () => {
    await writeCredential(newCredential({ platform: 'xhs', endpoint: 'web', account: 'work', method: 'cookie' }))
    const use = await cli('xhs', 'auth', 'use', 'work')
    expect(use.env.data).toMatchObject({ platform: 'xhs', endpoint: 'web', account: 'work', current: true })
    expect(readFileSync(join(home.dir, 'auth', 'xhs', 'web', '_current'), 'utf8').trim()).toBe('work')

    const list = await cli('xhs', 'auth', 'list', '-o', 'jsonl')
    expect(list.stdout.trim().split('\n').map((l) => JSON.parse(l).account)).toEqual(['work'])
    expect(JSON.parse(list.stderr)).toMatchObject({ ok: true, data: null, resource: 'auth', action: 'list' })

    const logout = await cli('xhs', 'auth', 'logout')
    expect(logout.env.data).toMatchObject({ account: 'work', current: false })
    expect(existsSync(join(home.dir, 'auth', 'xhs', 'web', 'work.json'))).toBe(false)
    expect(existsSync(join(home.dir, 'auth', 'xhs', 'web', '_current'))).toBe(false)
  })

  it('use 不存在的账号 → AUTH_REQUIRED；guest 不能 use；没有账号时 logout → USAGE', async () => {
    const r = await cli('xhs', 'auth', 'use', 'nobody')
    expect(r.code).toBe(3)
    expect(r.env.error.hint).toBe('catbus xhs auth login -a nobody')
    expect((await cli('xhs', 'auth', 'use', 'guest')).code).toBe(2)
    expect((await cli('xhs', 'auth', 'use', 'Bad Name')).code).toBe(2)
    expect((await cli('xhs', 'auth', 'logout')).env.error.code).toBe('USAGE')
  })

  it('auth login / status 是 planned', async () => {
    expect((await cli('xhs', 'auth', 'login')).code).toBe(4)
    expect((await cli('xhs', 'auth', 'login', '--method', 'password')).env.error.code).toBe('UNSUPPORTED')
    expect((await cli('xhs', 'auth', 'login', '--scope', 'nope')).env.error.code).toBe('USAGE')
    expect((await cli('tiktok', 'auth', 'login', '--scope', 'creator')).env.error.code).toBe('USAGE')
  })
})
