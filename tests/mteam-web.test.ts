import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, mockSender, type HttpResponse, type PreparedRequest } from '../src/core/http.js'
import { shapeOf } from './e2e/shapes.js'
import { cli, useTempHome } from './helpers.js'

// 网页会话（账密登录）相关能力。全部是合成数据和假令牌。
const PASSWORD = 'fake-password-for-tests'
const JWT = `eyJhbGciOiJIUzUxMiJ9.${Buffer.from(JSON.stringify({ sub: 'tester', uid: 4242, exp: 1796306408 })).toString('base64url')}.fake-signature`
const RENEWED = JWT.replace('fake-signature', 'renewed-signature')
const DID = 'fakedid0000000000000000000000001'
const UID = '4242'
const profile = { id: UID, username: 'tester', avatarUrl: null, info: null, memberCount: { bonus: '1.0' } }
const torrent = (id = '1001') => ({
  id, name: `Synthetic ${id}`, smallDescr: '合成资源', createdDate: '2026-11-01 12:00:00', author: '7', anonymous: false, imageList: [],
  category: '419', size: '2147483648', numfiles: '1', status: { views: '1', comments: '0', seeders: '5', leechers: '1', timesCompleted: '9', discount: 'FREE' },
})
const tracker = 'https://tracker.m-team.cc/test/secret'
const torrentBytes = Buffer.from(`d8:announce${tracker.length}:${tracker}4:infod4:name8:test.txtee`)
const ok = (data: unknown, headers: [string, string][] = []) => fakeResponse(JSON.stringify({ code: '0', message: 'SUCCESS', data }), { headers })
const page = (data: unknown[], totalPages = 1) => ({ pageNumber: '1', pageSize: '20', total: String(data.length), totalPages: String(totalPages), data })
type Route = (request: PreparedRequest) => HttpResponse

function form(request: PreparedRequest): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(request.body)))
}
function body(request: PreparedRequest): Record<string, any> {
  return String(request.body).startsWith('{') ? JSON.parse(String(request.body)) : form(request)
}
/** 解析 multipart 请求体，返回 [字段名, 值] 列表。 */
function parseMultipart(request: PreparedRequest): Array<[string, Buffer]> {
  const type = Object.fromEntries(request.headers)['content-type'] ?? ''
  const boundary = /boundary=(.+)$/.exec(type)?.[1]
  if (!boundary) throw new Error('不是 multipart 请求')
  const raw = Buffer.from(request.body as Uint8Array).toString('latin1')
  return raw.split(`--${boundary}`).slice(1, -1).map((chunk) => {
    const [head, ...rest] = chunk.replace(/^\r\n/, '').split('\r\n\r\n')
    const name = /name="([^"]+)"/.exec(head!)![1]!
    return [name, Buffer.from(rest.join('\r\n\r\n').replace(/\r\n$/, ''), 'latin1')]
  })
}
const header = (request: PreparedRequest, name: string) => Object.fromEntries(request.headers)[name]

describe('mteam：网页账密会话', () => {
  const home = useTempHome()
  const requests: PreparedRequest[] = []
  let restore: (() => void) | undefined
  let loginReplies: Array<() => HttpResponse> = []
  const credentialFile = (account = 'default') => join(home.dir, 'auth', 'mteam', 'web', `${account}.json`)

  function mock(routes: Record<string, Route | undefined> = {}) {
    restore?.()
    requests.length = 0
    restore = mockSender((request) => {
      requests.push(request)
      const url = new URL(request.url)
      const route = routes[url.pathname]
      if (route) return route(request)
      if (url.origin === 'http://127.0.0.1:25254') {
        if (url.pathname === '/api/v2/torrents/categories') return fakeResponse({ other: {} })
        if (url.pathname === '/api/v2/torrents/createCategory') return fakeResponse('')
        if (url.pathname === '/api/v2/torrents/add') return fakeResponse('Ok.')
      }
      switch (url.pathname) {
        case '/api/login': return loginReplies.shift()!()
        case '/api/member/sendLoginEmailVerifyCode': return ok(null)
        case '/api/member/profile': return ok(profile, [['authorization', RENEWED]])
        case '/api/torrent/search': return ok(page([torrent('2001')]))
        case '/api/torrent/collection': return ok(null)
        case '/api/torrent/genDlToken': return ok('https://api.m-team.cc/api/rss/dl?token=fake-download-token')
        case '/api/rss/dl': return fakeResponse(torrentBytes, { headers: [['content-type', 'application/x-bittorrent']] })
        case '/api/member/getUserTorrentList': return ok(page([
          { torrent: torrent('3001'), peer: { uploaded: '3221225472', downloaded: '1073741824' } },
          { torrent: null, torrentId: '3002', peer: { uploaded: '0', downloaded: '0' } },
        ], 2))
        case '/api/credit/logs': return ok(page([
          { id: '9', operation: 'TRACKER', bonus: '12.5', uploaded: '0', downloaded: '0', text: '做种奖励', createdDate: '2026-11-02 08:00:00' },
          { id: '10', operation: 'TORRENT', bonus: '-100', uploaded: '1073741824', downloaded: '0', text: '购买', createdDate: '2026-11-02 09:00:00', relatedId: '3001' },
        ]))
        case '/api/examine/getMyActiveList': return ok([{ id: '5', title: '新人考核', status: 'ONGOING', startDate: '2026-11-03 21:40:30', endDate: '2026-12-01 21:40:30', descr: '合成说明',
          downloaed: '16106127360', downloadTarget: '16106127360', uploaed: '1073741824', uploadTarget: '32212254720', bonuses: '12.5', bonusTarget: '6000' }])
        case '/api/tracker/mybonus': return ok({ formulaParams: { finalBs: '3.25', A: '12.0', count: '4', caGb: '55.5', enable2fa: false }, bonus: {} })
        case '/api/tracker/myPeerStatus': return ok({ seeder: '4', leecher: '1' })
        case '/api/msg/search': return ok(page([{ id: '77', title: '您的登入通知', context: '合成正文', createdDate: '2026-11-03 22:00:08', sender: '0', receiver: UID, unread: true }]))
        case '/api/msg/read': return ok({ id: form(request).msgId, title: '您的登入通知', context: '合成正文', createdDate: '2026-11-03 22:00:08', sender: '0', receiver: UID, unread: true })
      }
      throw new Error(`意外请求：${url.pathname}`)
    })
  }

  function stdin(text: string) {
    const stream = Object.assign(Readable.from([text]), { isTTY: false })
    return vi.spyOn(process, 'stdin', 'get').mockReturnValue(stream as unknown as typeof process.stdin)
  }

  async function webAccount() {
    const credential = newCredential({ platform: 'mteam', endpoint: 'web', account: 'default', method: 'password', user: { id: UID, name: 'tester', url: null, avatar: null } })
    Object.assign(credential.scopes.main!.tokens, { auth: JWT, did: DID, visitor_id: 'ab'.repeat(16) })
    await writeCredential(credential)
    await setCurrent('mteam', 'web', 'default')
  }

  beforeEach(() => { loginReplies = []; mock() })
  afterEach(() => { restore?.(); restore = undefined; vi.restoreAllMocks() })

  it('帮助里有账密登录和私有选项', async () => {
    const help = await cli('mt', 'auth', 'login', '--help')
    for (const flag of ['--username', '--password-stdin', '--code', '--email', '--api-key-file']) expect(help.stdout).toContain(flag)
    expect((await cli('mt', 'item', 'download', '--help')).stdout).toContain('--qbit')
    expect((await cli('mt', 'msg', 'list', '--help')).stdout).toContain('--box')
  })

  it('不需要两步验证时一次登录：请求带网页签名，令牌和 did 写入凭证，密码不落盘', async () => {
    loginReplies = [() => ok(Number(UID), [['authorization', JWT], ['did', DID]])]
    stdin(PASSWORD + '\n')
    const result = await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin', '-a', 'web')
    expect(result.code).toBe(0)
    expect(result.env.data).toMatchObject({ platform: 'mteam', account: 'web', method: 'password' })
    const login = requests[0]!
    expect(login.url).toBe('https://api.m-team.cc/api/login')
    const f = form(login)
    expect(f).toMatchObject({ username: 'tester', password: PASSWORD, turnstile: '' })
    expect(f._sgin).toBe(createHmac('sha1', 'HLkPcWmycL57mfJt').update(`POST&/api/login&${f._timestamp}`).digest('base64'))
    expect(header(login, 'visitorid')).toMatch(/^[0-9a-f]{32}$/)
    expect(header(login, 'x-api-key')).toBeUndefined()
    // 校验资料时带上新令牌；profile 响应下发的续期令牌也写回
    expect(header(requests[1]!, 'authorization')).toBe(JWT)
    expect(header(requests[1]!, 'did')).toBe(DID)
    const saved = readFileSync(credentialFile('web'), 'utf8')
    expect(JSON.parse(saved).scopes.main.tokens).toMatchObject({ auth: RENEWED, did: DID })
    expect(saved).not.toContain(PASSWORD)
    expect(result.stdout + result.stderr).not.toContain(JWT)
  })

  it('邮箱两步验证：非 TTY 先发码并保存中间态，再带 --code 完成，沿用同一个 visitorId', async () => {
    loginReplies = [() => fakeResponse({ code: 1001, data: ['email'], message: '需要兩步驗證驗' })]
    stdin(PASSWORD)
    const missing = await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin')
    expect(missing.env.error.code).toBe('USAGE')
    expect(missing.env.error.hint).toContain('--email')

    loginReplies = [() => fakeResponse({ code: 1001, data: ['email'], message: '需要兩步驗證驗' })]
    stdin(PASSWORD)
    requests.length = 0
    const first = await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin', '--email', 'tester@example.com')
    expect(first.code).toBe(0)
    expect(first.env.data).toEqual({ sent: true, verify: 'email' })
    expect(first.stderr).toContain('--code')
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/api/login', '/api/member/sendLoginEmailVerifyCode'])
    expect(form(requests[1]!)).toMatchObject({ username: 'tester', email: 'tester@example.com' })
    const visitor = header(requests[0]!, 'visitorid')
    expect(existsSync(credentialFile())).toBe(false)

    loginReplies = [() => ok(Number(UID), [['authorization', JWT], ['did', DID]])]
    stdin(PASSWORD)
    requests.length = 0
    const second = await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin', '--code', '123456')
    expect(second.code).toBe(0)
    expect(form(requests[0]!)).toMatchObject({ emailCode: '123456', username: 'tester' })
    expect(header(requests[0]!, 'visitorid')).toBe(visitor)
    expect(JSON.parse(readFileSync(credentialFile(), 'utf8')).scopes.main.tokens.visitor_id).toBe(visitor)
  })

  it('验证码错误、要求验证邮箱、密码错误分别报错，不保存凭证', async () => {
    for (const [reply, code] of [
      [fakeResponse({ code: 1001, data: ['email'], message: '驗證碼錯誤' }), 'USAGE'],
      [fakeResponse({ code: 1002, data: null, message: '請驗證郵箱' }), 'RISK_CONTROL'],
      [fakeResponse({ code: 1, data: null, message: '帳號或密碼錯誤' }), 'UPSTREAM'],
    ] as const) {
      loginReplies = [() => reply]
      stdin(PASSWORD)
      const result = await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin', '--code', '123456')
      expect(result.env.error.code).toBe(code)
      expect(existsSync(credentialFile())).toBe(false)
    }
    expect((await cli('mt', 'auth', 'login', '--method', 'password', '--username', 'tester', '--password-stdin', '--code', 'abc')).env.error.code).toBe('USAGE')
  })

  it('auth status 返回 password 方式和令牌到期时间；令牌失效报 AUTH_EXPIRED', async () => {
    await webAccount()
    const status = await cli('mt', 'auth', 'status')
    expect(status.env.data).toMatchObject({ logged_in: true, method: 'password', expires_at: new Date(1796306408 * 1000).toISOString() })
    mock({ '/api/member/profile': () => fakeResponse({ code: 401, message: 'Full authentication is required' }) })
    expect((await cli('mt', 'user', 'get', 'me')).env.error.code).toBe('AUTH_EXPIRED')
  })

  it('收藏、取消收藏、收藏列表', async () => {
    await webAccount()
    expect((await cli('mt', 'item', 'collect', 'https://kp.m-team.cc/detail/2001')).env.data).toEqual({ id: '2001' })
    expect(form(requests[0]!)).toMatchObject({ id: '2001', make: 'true' })
    expect(header(requests[0]!, 'authorization')).toBe(JWT)
    expect((await cli('mt', 'item', 'uncollect', '2001')).code).toBe(0)
    expect(form(requests.at(-1)!).make).toBe('false')
    const list = await cli('mt', 'user', 'collects', '--mode', 'adult')
    expect(body(requests.at(-1)!)).toMatchObject({ onlyFav: 1, mode: 'adult', keyword: '' })
    expect(shapeOf('Torrent[]').safeParse(list.env.data).success).toBe(true)
    expect((await cli('mt', 'user', 'collects', 'someone')).env.error.code).toBe('UNSUPPORTED')
  })

  it('seed list：按类型查询，上传下载写进 text，已删除的种子不报错；可翻页', async () => {
    await webAccount()
    const result = await cli('mt', 'seed', 'list', '--status', 'leeching')
    expect(result.code).toBe(0)
    expect(body(requests[0]!)).toMatchObject({ userid: UID, type: 'LEECHING', pageNumber: 1, pageSize: 20 })
    expect(shapeOf('Torrent[]').safeParse(result.env.data).success).toBe(true)
    expect(result.env.data[0]).toMatchObject({ id: '3001', size: 2147483648, seeders: 5 })
    expect(result.env.data[0].text).toContain('上传：3.00 GiB')
    expect(result.env.data[0].text).toContain('分享率：3.000')
    expect(result.env.data[1]).toMatchObject({ id: '3002', title: null })
    expect(result.env.page).toEqual({ cursor: '2', has_more: true })
  })

  it('bonus history 输出 BonusRecord', async () => {
    await webAccount()
    const result = await cli('mt', 'bonus', 'history')
    expect(body(requests[0]!)).toMatchObject({ uid: UID, pageNumber: 1, type: null })
    expect(shapeOf('BonusRecord[]').safeParse(result.env.data).success).toBe(true)
    expect(result.env.data[0]).toMatchObject({ id: '9', type: 'TRACKER', change: 12.5, before: null, after: null, note: '做种奖励', url: null })
    expect(result.env.data[1]).toMatchObject({ change: -100, note: '购买；上传：1.00 GiB', url: 'https://kp.m-team.cc/detail/3001' })
  })

  it('站内信：列表按信箱查询，读取不调用 markRead；API Key 会话报 UNSUPPORTED 且不联网', async () => {
    await webAccount()
    const list = await cli('mt', 'msg', 'list', '--box', 'system')
    expect(form(requests[0]!)).toMatchObject({ box: '-2', pageNumber: '1' })
    expect(list.env.data[0]).toMatchObject({ id: '77', peer: { id: '0', name: '系统' }, unread: 1, last_message: '您的登入通知' })
    const read = await cli('mt', 'msg', 'history', '77')
    expect(form(requests.at(-1)!).msgId).toBe('77')
    expect(read.env.data[0]).toMatchObject({ id: '77', from: { id: '0' }, text: '您的登入通知\n合成正文' })
    expect(requests.some((r) => r.url.includes('markRead'))).toBe(false)

    const keyCredential = newCredential({ platform: 'mteam', endpoint: 'web', account: 'key', method: 'apikey', user: { id: UID, name: 'tester', url: null, avatar: null } })
    keyCredential.scopes.main!.tokens.api_key = 'fake-key'
    await writeCredential(keyCredential)
    requests.length = 0
    expect((await cli('mt', 'msg', 'list', '-a', 'key')).env.error.code).toBe('UNSUPPORTED')
    expect(requests).toHaveLength(0)
  })

  it('下载 --qbit 推送 multipart 到本机 qBittorrent；已存在时只警告', async () => {
    await webAccount()
    const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '--qbit', '--qbit-category', 'pt', '--qbit-paused')
    expect(result.code).toBe(0)
    const paths = requests.map((r) => new URL(r.url).pathname)
    expect(paths).toEqual(['/api/torrent/genDlToken', '/api/rss/dl', '/api/v2/torrents/categories', '/api/v2/torrents/createCategory', '/api/v2/torrents/add'])
    expect(header(requests[1]!, 'authorization')).toBeUndefined()
    const add = requests.at(-1)!
    const parts = parseMultipart(add)
    expect(parts.map(([name, value]) => [name, name === 'torrents' ? 'bytes' : value.toString()])).toEqual([['torrents', 'bytes'], ['category', 'pt'], ['paused', 'true'], ['stopped', 'true']])
    expect(parts[0]![1]).toEqual(torrentBytes)
    // 结尾边界后带 CRLF（qBittorrent 需要）
    expect(Buffer.from(add.body as Uint8Array).subarray(-4).toString()).toBe('--\r\n')
    mock({ '/api/v2/torrents/add': () => fakeResponse('Fails.') })
    const dup = await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '--qbit')
    expect(dup.code).toBe(0)
    expect(dup.stderr).toContain('已经在任务列表')
    expect(requests.some((r) => r.url.includes('genDlToken'))).toBe(false)
  })

  it('exam get、bonus get、seed stats', async () => {
    await webAccount()
    const exam = await cli('mt', 'exam', 'get')
    expect(exam.env.data[0]).toMatchObject({ id: '5', title: '新人考核', status: 'ONGOING', end_at: '2026-12-01T21:40:30+08:00' })
    expect(exam.env.data[0].items).toEqual([
      { name: 'download', current: 16106127360, target: 16106127360, done: true },
      { name: 'upload', current: 1073741824, target: 32212254720, done: false },
      { name: 'bonus', current: 12.5, target: 6000, done: false },
    ])
    mock({ '/api/examine/getMyActiveList': () => ok(null) })
    expect((await cli('mt', 'exam', 'get')).env.data).toEqual([])
    expect((await cli('mt', 'bonus', 'get')).env.data).toEqual({ per_hour: 3.25, a: 12, seeding_count: 4, seeding_size_gb: 55.5, two_factor: false })
    expect((await cli('mt', 'seed', 'stats')).env.data).toEqual({ seeding: 4, leeching: 1 })
  })

  it('下载地址跳转到下载节点 *.halomt.com 时跟随；genDlToken 直接给出 halomt 地址则拒绝', async () => {
    await webAccount()
    mock({ '/api/rss/dl': () => fakeResponse('', { status: 302, headers: [['location', 'https://fr1.halomt.com/?app_id=1&sign=fake']] }), '/': () => fakeResponse(torrentBytes) })
    const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir)
    expect(result.code).toBe(0)
    expect(new URL(requests.at(-1)!.url).hostname).toBe('fr1.halomt.com')
    expect(header(requests.at(-1)!, 'authorization')).toBeUndefined()
    mock({ '/api/torrent/genDlToken': () => ok('https://fr1.halomt.com/?sign=fake') })
    expect((await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '--overwrite')).env.error.code).toBe('UPSTREAM')
  })

  it('搜索 --order-by / --asc 转成站点的 sortField / sortDirection', async () => {
    await webAccount()
    await cli('mt', 'feed', 'list', '--free', '--order-by', 'leechers')
    expect(body(requests.at(-1)!)).toMatchObject({ discount: 'FREE', sortField: 'LEECHERS', sortDirection: 'DESC' })
    await cli('mt', 'item', 'search', 'x', '--order-by', 'seeders', '--asc')
    expect(body(requests.at(-1)!)).toMatchObject({ keyword: 'x', sortField: 'SEEDERS', sortDirection: 'ASC' })
    await cli('mt', 'feed', 'list')
    expect(body(requests.at(-1)!)).not.toHaveProperty('sortField')
  })

  it('--qbit-savepath 作为 savepath 字段推送', async () => {
    await webAccount()
    const result = await cli('mt', 'item', 'download', '1001', '--dir', home.dir, '--qbit', '--qbit-savepath', '/data/盒/mteam')
    expect(result.code).toBe(0)
    const add = requests.at(-1)!
    expect(parseMultipart(add).find(([name]) => name === 'savepath')?.[1].toString()).toBe('/data/盒/mteam')
    expect(result.stderr).toContain('保存到 /data/盒/mteam')
  })
})
