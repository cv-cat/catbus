import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, mockSender, type PreparedRequest, type HttpResponse } from '../src/core/http.js'
import { redact } from '../src/core/log.js'
import * as rand from '../src/core/rand.js'
import { shapeOf } from './e2e/shapes.js'
import { cli, useTempHome } from './helpers.js'
import { findPlatform } from '../src/platforms/index.js'
import { KEYS, start } from './tui-harness.js'

// 全部是合成数据，禁止把真实账号响应或种子元数据写入 fixture。
const KEY = 'fake-mteam-api-key-for-tests'
const profile = { id: '9007199254740993', username: 'test-member', avatarUrl: null, info: '测试账号', memberCount: { uploaded: '100000', downloaded: '1000' } }
const torrent = (id = '1001') => ({
  id, name: 'Synthetic test resource', smallDescr: '离线测试资源', createdDate: '2026-11-01 12:00:00',
  author: '7', anonymous: false, imageList: [], category: '419', size: '123456789', numfiles: '2',
  status: { views: '30', comments: '4', seeders: '12', leechers: '3', timesCompleted: '20', discount: 'FREE' },
})
const tracker = 'https://tracker.m-team.cc/test/secret'
const torrentBytes = Buffer.from(`d8:announce${tracker.length}:${tracker}4:infod4:name8:test.txtee`)
const ok = (data: unknown) => fakeResponse(JSON.stringify({ code: '0', message: 'SUCCESS', data }))
type Route = (request: PreparedRequest) => HttpResponse

describe('mteam：官方 API 适配', () => {
  const home = useTempHome()
  const requests: PreparedRequest[] = []
  let restore: (() => void) | undefined
  const keyFile = () => join(home.dir, 'key.txt')
  const credentialFile = () => join(home.dir, 'auth', 'mteam', 'web', 'default.json')

  function mock(routes: Record<string, Route | undefined> = {}) {
    restore?.()
    requests.length = 0
    restore = mockSender((request) => {
      requests.push(request)
      const path = new URL(request.url).pathname
      const route = routes[path]
      if (route) return route(request)
      if (path === '/api/member/profile') return ok(profile)
      if (path === '/api/torrent/search') return ok({ pageNumber: 1, pageSize: 20, total: 3, totalPages: 1, data: [torrent(), torrent('1002'), torrent('1003')] })
      if (path === '/api/torrent/detail') return ok({ ...torrent(), descr: '[b]合成详情[/b]' })
      if (path === '/api/torrent/categoryList') return ok({ movie: ['419'], list: [{ id: '100', nameChs: '电影', parent: null }, { id: '419', nameChs: '高清', parent: '100' }] })
      if (path === '/api/torrent/genDlToken') return ok('https://api.m-team.cc/api/rss/dl?token=fake-download-token')
      if (path === '/api/rss/dl') return fakeResponse(torrentBytes, { headers: [['content-type', 'application/x-bittorrent']] })
      throw new Error(`意外请求：${path}`)
    })
  }

  beforeEach(async () => {
    const credential = newCredential({ platform: 'mteam', endpoint: 'web', account: 'default', method: 'apikey', user: { id: profile.id, name: profile.username, url: null, avatar: null } })
    credential.scopes.main!.tokens.api_key = KEY
    await writeCredential(credential)
    await setCurrent('mteam', 'web', 'default')
    writeFileSync(keyFile(), KEY + '\n', { mode: 0o600 })
    mock()
  })
  afterEach(() => { restore?.(); restore = undefined })

  it('别名、帮助、能力和 planned 端遵守统一命令约定', async () => {
    for (const alias of ['mteam', 'mt', 'm-team', 'mantou']) {
      const result = await cli('platforms', alias)
      expect(result.env.data.id).toBe('mteam')
      expect(result.env.data.commands.find((c: any) => c.resource === 'item' && c.action === 'search').status).toBe('implemented')
    }
    const help = await cli('mt', 'auth', 'login', '--help')
    expect(help.stdout).toContain('--api-key-file')
    expect(help.stdout).not.toContain('--cookie')
    expect((await cli('mt', 'item', 'get', '1001', '-e', 'app')).env.error.code).toBe('NOT_IMPLEMENTED')
    expect(requests).toHaveLength(0)
  })

  it('从文件登录，先验证后保存，账号、类型和权限正确且 stdout/stderr 不泄露 Key', async () => {
    const result = await cli('mt', 'auth', 'login', '--api-key-file', keyFile(), '-a', 'work', '-v')
    expect(result.code).toBe(0)
    expect(result.env.data).toMatchObject({ platform: 'mteam', account: 'work', method: 'apikey', current: false })
    expect(result.stdout + result.stderr).not.toContain(KEY)
    const path = join(home.dir, 'auth/mteam/web/work.json')
    expect(JSON.parse(readFileSync(path, 'utf8')).scopes.main.tokens.api_key).toBe(KEY)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    const request = requests[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.m-team.cc/api/member/profile')
    expect(Object.fromEntries(request.headers)['x-api-key']).toBe(KEY)
    expect(request.cookies).toEqual([])
  })

  it('文件和 stdin 互斥；缺少、空白、带换行的 Key 都在联网前报 USAGE', async () => {
    expect((await cli('mt', 'auth', 'login', '--api-key-file', keyFile(), '--api-key-stdin')).env.error.code).toBe('USAGE')
    expect((await cli('mt', 'auth', 'login')).env.error.code).toBe('USAGE')
    for (const content of ['', 'bad\nkey']) {
      writeFileSync(keyFile(), content)
      expect((await cli('mt', 'auth', 'login', '--api-key-file', keyFile())).env.error.code).toBe('USAGE')
    }
    expect(requests).toHaveLength(0)
  })

  it('无效 Key 不写入新账号；已保存 Key 失效时 status 返回 false，业务查询报 AUTH_EXPIRED', async () => {
    mock({ '/api/member/profile': () => fakeResponse('{"code":1,"message":"API key無效"}') })
    const login = await cli('mt', 'auth', 'login', '--api-key-file', keyFile(), '-a', 'invalid')
    expect(login.env.error.code).toBe('AUTH_EXPIRED')
    expect(existsSync(join(home.dir, 'auth/mteam/web/invalid.json'))).toBe(false)
    expect((await cli('mt', 'auth', 'status')).env.data.logged_in).toBe(false)
    expect((await cli('mt', 'user', 'get', 'me')).env.error.code).toBe('AUTH_EXPIRED')
    expect(JSON.parse(readFileSync(credentialFile(), 'utf8')).scopes.main.tokens.api_key).toBe(KEY)
    mock({ '/api/member/profile': () => fakeResponse('{"code":1,"message":"invalid API key"}') })
    expect((await cli('mt', 'auth', 'status')).env.data.logged_in).toBe(false)
  })

  it('keyword 参数校验错误不能被误报为 API Key 失效', async () => {
    mock({ '/api/torrent/search': () => fakeResponse({ code: '1', message: 'Invalid parameter: keyword' }) })
    const result = await cli('mteam', 'item', 'search', '测试')
    expect(result.code).toBe(7)
    expect(result.env.error).toMatchObject({ code: 'UPSTREAM', message: 'M-Team：Invalid parameter: keyword' })
  })

  it.each(['請重新登入', 'API key 已失效，請重新登入', 'Token expired'])('auth status 能识别失效提示：%s', async (message) => {
    mock({ '/api/member/profile': () => fakeResponse({ code: '1', message }) })
    const result = await cli('mteam', 'auth', 'status')
    expect(result.code).toBe(0)
    expect(result.env.data).toMatchObject({ logged_in: false, method: 'apikey' })
  })

  it('API 重定向不跟随，不向别的主机转发 Key', async () => {
    mock({ '/api/member/profile': () => fakeResponse('', { status: 302, headers: [['location', 'https://other.example/collect']] }) })
    expect((await cli('mt', 'user', 'get', 'me')).env.error.code).toBe('UPSTREAM')
    expect(requests).toHaveLength(1)
  })

  it('搜索 JSON、筛选、Torrent 结构和 raw 都按契约输出', async () => {
    const result = await cli('mt', 'item', 'search', '测试资源', '--mode', 'movie', '--category', '419,439', '--free')
    expect(result.code).toBe(0)
    expect(JSON.parse(String(requests[0]!.body))).toEqual({ mode: 'movie', categories: ['419', '439'], keyword: '测试资源', discount: 'FREE', pageNumber: 1, pageSize: 20 })
    expect(shapeOf('Torrent[]').safeParse(result.env.data).success).toBe(true)
    expect(result.env.data[0]).toMatchObject({ id: '1001', kind: 'torrent', size: 123456789, file_count: 2, category_id: '419', seeders: 12, leechers: 3, completed: 20, discount: 'FREE' })
    const raw = await cli('mt', 'item', 'search', '测试', '--raw')
    expect(raw.env.data[0]).toEqual(torrent())
    expect((await cli('mt', 'feed', 'list')).code).toBe(0)
    expect(JSON.parse(String(requests.at(-1)!.body)).keyword).toBe('')
  })

  it('平台 JSON 中的数字形式 64 位 ID 不丢精度，详情仍可用输出的 ID 继续查询', async () => {
    const id = '9007199254740993'
    mock({
      '/api/member/profile': () => fakeResponse(`{"code":"0","data":{"id":${id},"username":"test-member"}}`),
      '/api/torrent/detail': () => fakeResponse(`{"code":"0","data":{"id":${id},"name":"Synthetic large ID","status":{}}}`),
    })
    const user = await cli('mt', 'user', 'get', 'me')
    expect(user.code).toBe(0)
    expect(user.env.data.id).toBe(id)
    const detail = await cli('mt', 'item', 'get', id)
    expect(detail.code).toBe(0)
    expect(detail.env.data.id).toBe(id)
    expect(detail.env.data.url).toBe(`https://kp.m-team.cc/detail/${id}`)
  })

  it('limit 截在一页中间时 cursor 可以续读；翻页拿到末页后停止', async () => {
    const restoreRand = rand.deterministic({ now: 1793505600000, seed: 1 })
    try {
      mock({ '/api/torrent/search': (request) => {
        const page = JSON.parse(String(request.body)).pageNumber
        return ok({ pageNumber: page, pageSize: 20, total: 4, totalPages: 2, data: page === 1 ? [torrent('1'), torrent('2'), torrent('3')] : [torrent('4')] })
      } })
      const first = await cli('mt', 'item', 'search', '测试', '--limit', '2')
      expect(first.env.data.map((v: any) => v.id)).toEqual(['1', '2'])
      expect(first.env.page).toEqual({ cursor: '#skip=2', has_more: true })
      const next = await cli('mt', 'item', 'search', '测试', '--cursor', first.env.page.cursor, '--all')
      expect(next.env.data.map((v: any) => v.id)).toEqual(['3', '4'])
      expect(next.env.page).toEqual({ cursor: null, has_more: false })
      expect(requests.map((r) => JSON.parse(String(r.body)).pageNumber)).toEqual([1, 1, 2])
    } finally { restoreRand() }
  })

  it('错误 cursor、分类和外部 URL 不会发请求', async () => {
    for (const args of [['item', 'search', '测试', '--cursor', 'bad'], ['item', 'search', '测试', '--category', 'bad'], ['item', 'get', 'https://evil.example/detail/1'], ['item', 'get', 'https://m-team.cc.evil.example/detail/1'], ['item', 'get', '../1']]) {
      expect((await cli('mt', ...args)).env.error.code).toBe('USAGE')
    }
    expect((await cli('mt', 'user', 'get', 'somebody')).env.error.code).toBe('UNSUPPORTED')
    expect(requests).toHaveLength(0)
  })

  it('详情接受官方 URL；分类保留父子层级，匿名发布不暴露 author', async () => {
    for (const input of ['1001', 'https://kp.m-team.cc/detail/1001', 'https://tp.m-team.io/details.php?id=1001', 'https://kp.m-team.cc/#/torrent/1001']) {
      const result = await cli('mt', 'item', 'get', input)
      expect(result.code).toBe(0)
      expect(requests.at(-1)!.body).toBe('id=1001')
      expect(result.env.data.text).toBe('[b]合成详情[/b]')
    }
    const categories = await cli('mt', 'item', 'categories')
    expect(categories.env.data).toEqual([{ id: '100', name: '电影', parent_id: null }, { id: '419', name: '高清', parent_id: '100' }])
    mock({ '/api/torrent/detail': () => ok({ ...torrent(), anonymous: true }) })
    expect((await cli('mt', 'item', 'get', '1001')).env.data.author).toBeNull()
  })

  it('详情的正文和创建时间为空字符串时使用有效备用字段', async () => {
    mock({ '/api/torrent/detail': () => ok({ ...torrent(), descr: '', createdDate: '', status: { ...torrent().status, createdDate: '2026-11-01 12:00:00' } }) })
    const result = await cli('mteam', 'item', 'get', '1001')
    expect(result.code).toBe(0)
    expect(result.env.data.text).toBe('离线测试资源')
    expect(result.env.data.created_at).toBe('2026-11-01T12:00:00+08:00')
  })

  it('风控、业务错误和坏响应有明确错误码，不把失败伪装为空列表', async () => {
    for (const [response, code, kind] of [
      [fakeResponse('', { status: 429 }), 'RISK_CONTROL', 'rate_limit'],
      [fakeResponse('', { status: 403 }), 'RISK_CONTROL', 'blocked'],
      [fakeResponse('', { status: 401 }), 'AUTH_EXPIRED', null],
      [fakeResponse('not json'), 'UPSTREAM', null],
      [ok({ data: [] }), 'UPSTREAM', null],
      [fakeResponse(JSON.stringify({ code: '1', message: `failed x-api-key=${KEY}` })), 'UPSTREAM', null],
    ] as const) {
      mock({ '/api/torrent/search': () => response })
      const result = await cli('mt', 'item', 'search', '测试', '-v')
      expect(result.env.error.code).toBe(code)
      if (kind) expect(result.env.error.detail.kind).toBe(kind)
      expect(result.stdout + result.stderr).not.toContain(KEY)
      expect(requests).toHaveLength(1)
    }
  })

  it('下载保存完整种子，文件 0600；输出、日志、下载请求都不泄露 API Key 或下载令牌', async () => {
    const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '-v')
    expect(result.code).toBe(0)
    const path = join(home.dir, 'mteam_1001_1.torrent')
    expect(readFileSync(path)).toEqual(torrentBytes)
    expect(result.env.data).toEqual([{ path, type: 'torrent', size: torrentBytes.length, url: null }])
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(Object.fromEntries(requests[1]!.headers)).not.toHaveProperty('x-api-key')
    expect(result.stdout + result.stderr).not.toContain('fake-download-token')
    expect(result.stdout + result.stderr).not.toContain(KEY)
    requests.length = 0
    expect((await cli('mt', 'item', 'download', '1001', '--dir', home.dir)).code).toBe(0)
    expect(requests).toHaveLength(0)
    expect((await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '--overwrite')).code).toBe(0)
    expect(requests).toHaveLength(2)
  })

  it('下载期间出现同名文件时默认保留它，返回被保留文件的大小', async () => {
    const path = join(home.dir, 'mteam_1001_1.torrent')
    const existing = 'another process published this file during the request'
    mock({ '/api/torrent/genDlToken': () => {
      writeFileSync(path, existing, { flag: 'wx', mode: 0o600 })
      return ok('https://api.m-team.cc/api/rss/dl?token=fake-download-token')
    } })
    const result = await cli('mteam', 'item', 'download', '1001', '--dir', home.dir)
    expect(result.code).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(existing)
    expect(result.env.data).toEqual([{ path, type: 'torrent', url: null, size: Buffer.byteLength(existing) }])
    expect(result.stderr).toContain('已存在，跳过')
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(home.dir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it.each([false, true])('种子下载超限时立即取消流，不整体缓冲也不落盘（Content-Length：%s）', async (declared) => {
    let pulls = 0
    let cancelled = false
    const block = new Uint8Array(4 * 1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls > 8) controller.close()
        else controller.enqueue(block)
      },
      cancel() { cancelled = true },
    }, { highWaterMark: 0 })
    const response = new Response(stream, { headers: declared ? { 'content-length': String(32 * 1024 * 1024) } : {} })
    const buffered = vi.spyOn(response, 'arrayBuffer').mockRejectedValue(new Error('unbounded buffering is forbidden'))
    mock({ '/api/rss/dl': () => response as unknown as HttpResponse })
    const result = await cli('mteam', 'item', 'download', '1001', '--dir', home.dir)
    expect(result.env.error.code).toBe('UPSTREAM')
    expect(result.env.error.message).toContain('16 MiB')
    expect(buffered).not.toHaveBeenCalled()
    expect(cancelled).toBe(true)
    expect(pulls).toBe(declared ? 0 : 5)
    expect(existsSync(join(home.dir, 'mteam_1001_1.torrent'))).toBe(false)
  })

  it('读取下载流失败时不把临时下载 URL 带进错误信封', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('read failed: https://api.m-team.cc/api/rss/dl?token=fake-download-token')) },
    }))
    mock({ '/api/rss/dl': () => response as unknown as HttpResponse })
    const result = await cli('mteam', 'item', 'download', '1001', '--dir', home.dir, '-v')
    expect(result.env.error.code).toBe('NETWORK')
    expect(result.stdout + result.stderr).not.toContain('fake-download-token')
    expect(existsSync(join(home.dir, 'mteam_1001_1.torrent'))).toBe(false)
  })

  it('拒绝外站下载或跳转、JSON/HTML 错误和截断种子，不留下目标文件', async () => {
    for (const routes of [
      { '/api/torrent/genDlToken': () => ok('https://evil.example/secret') },
      { '/api/rss/dl': () => fakeResponse('', { status: 302, headers: [['location', 'https://evil.example/secret']] }) },
      { '/api/rss/dl': () => fakeResponse('{"code":401}') },
      { '/api/rss/dl': () => fakeResponse('<html>login</html>') },
      { '/api/rss/dl': () => fakeResponse('d4:infod4:name8:test.txt') },
    ]) {
      mock(routes)
      const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir)
      expect(result.env.error.code).toBe('UPSTREAM')
      expect(existsSync(join(home.dir, 'mteam_1001_1.torrent'))).toBe(false)
      expect(requests.every((r) => new URL(r.url).hostname === 'api.m-team.cc')).toBe(true)
    }
  })

  it('下载时底层网络错误含完整 URL，也不会把临时令牌写进错误信封', async () => {
    mock({ '/api/rss/dl': () => { throw new Error('request failed https://api.m-team.cc/api/rss/dl?token=fake-download-token') } })
    const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '-v')
    expect(result.env.error.code).toBe('NETWORK')
    expect(result.stdout + result.stderr).not.toContain('fake-download-token')
    expect(existsSync(join(home.dir, 'mteam_1001_1.torrent'))).toBe(false)
  })

  it('登出清理本地账号；未登录命令不联网', async () => {
    expect((await cli('mt', 'auth', 'logout')).code).toBe(0)
    expect(existsSync(credentialFile())).toBe(false)
    expect((await cli('mt', 'auth', 'status')).env.data.logged_in).toBe(false)
    expect((await cli('mt', 'feed', 'list')).env.error.code).toBe('AUTH_REQUIRED')
    expect(requests).toHaveLength(0)
  })

  it('API Key 和 passkey 可被通用 logger 脱敏', () => {
    expect(redact({ 'x-api-key': KEY, api_key: KEY, passkey: KEY })).toEqual({ 'x-api-key': '***', api_key: '***', passkey: '***' })
    expect(redact(`x-api-key=${KEY}&passkey=${KEY}`)).toBe('x-api-key=***&passkey=***')
  })
})

describe('mteam：终端界面登录', () => {
  const home = useTempHome()
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('API Key 在界面里隐藏输入，屏幕上没有明文；校验通过后保存到账号', async () => {
    const seen: string[] = []
    restore = mockSender((request) => {
      const path = new URL(request.url).pathname
      seen.push(path)
      if (path === '/api/member/profile') return ok(profile)
      throw new Error(`意外请求：${path}`)
    })
    const s = await start({ platforms: [findPlatform('mteam')!], columns: 100, rows: 28 })
    try {
      await s.press('a', 'n', KEYS.enter) // 账号页 → 登录新账号 → 开始
      await s.waitForText('M-Team API Key')
      await s.type(KEY)
      expect(s.screen().join('\n')).not.toContain(KEY)
      expect(s.raw()).not.toContain(KEY)
      await s.press(KEYS.enter)
      await s.waitForText('已登录')
      expect(seen).toEqual(['/api/member/profile'])
      const saved = JSON.parse(readFileSync(join(home.dir, 'auth/mteam/web/default.json'), 'utf8'))
      expect(saved).toMatchObject({ method: 'apikey', user: { id: profile.id } })
      expect(saved.scopes.main.tokens.api_key).toBe(KEY)
    } finally {
      s.stop()
    }
  })
})
