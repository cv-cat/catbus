import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeResponse, type HeaderPairs, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import * as rand from '../src/core/rand.js'
import { resolveCity, resolveProject } from '../src/platforms/maoyan/web/resolve.js'
import { mockGuard, PCLOGIN_UA } from '../src/platforms/maoyan/web/loginSign.js'
import { mtgsig, WEBDFPID } from '../src/platforms/maoyan/web/sign.js'
import { cli, useTempHome } from './helpers.js'
import { readCredential } from '../src/core/auth-store.js'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/maoyan', name), 'utf8')
const NOW = new Date('2026-11-01T12:00:00+08:00').getTime()
const json = (body: string) => fakeResponse(body, { headers: [['content-type', 'application/json']] })

interface CallRecord {
  url: string
  path: string
  query: [string, string][]
  headers: HeaderPairs
  cookies: [string, string][]
}

function mockMaoyan(overrides: Record<string, (p: PreparedRequest) => HttpResponse> = {}) {
  const routes: Record<string, (p: PreparedRequest) => HttpResponse> = {
    '/my/ianvs/movie/hotShows': () => json(fixture('hot_shows.json')),
    '/my/odea/project/detail': () => json(fixture('detail.json')),
    ...overrides,
  }
  const calls: CallRecord[] = []
  const restore = mockSender((p: PreparedRequest) => {
    const u = new URL(p.url)
    calls.push({ url: p.url, path: u.pathname, query: [...u.searchParams], headers: p.headers, cookies: p.cookies })
    const route = routes[u.pathname]
    if (!route) throw new Error(`未录制的请求：${u.pathname}`)
    return route(p)
  })
  return { calls, restore }
}

describe('maoyan 平台（web）', () => {
  useTempHome()
  let restoreClock: () => void
  let restoreSender: (() => void) | undefined

  beforeEach(() => {
    restoreClock = rand.deterministic({ now: NOW })
  })

  afterEach(() => {
    restoreSender?.()
    restoreSender = undefined
    restoreClock()
  })

  const mock = (overrides?: Parameters<typeof mockMaoyan>[0]) => {
    const m = mockMaoyan(overrides)
    restoreSender = m.restore
    return m
  }

  describe('feed list', () => {
    it('默认北京（cityId=2），游客态，免签名、不带 sellChannel 和 cookie', async () => {
      const { calls } = mock()
      const r = await cli('maoyan', 'feed', 'list')
      expect(r.code).toBe(0)
      expect(r.env).toMatchObject({ ok: true, platform: 'maoyan', resource: 'feed', action: 'list', account: 'guest', error: null })
      expect(r.env.page).toEqual({ cursor: null, has_more: false })
      expect(r.stderr).toContain('catbus maoyan auth login')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('https://yanchu.maoyan.com/my/ianvs/movie/hotShows?cityId=2')
      expect(calls[0]!.headers).toEqual([
        ['User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'],
        ['Accept-Encoding', 'gzip'],
      ])
      expect(calls[0]!.cookies).toEqual([])
    })

    it('归一化为 Item（kind 为 goods），演出者作 author，分类 / 开售写进 text', async () => {
      mock()
      const r = await cli('maoyan', 'feed', 'list')
      expect(r.env.data).toHaveLength(3)
      expect(r.env.data[0]).toEqual({
        id: '514992',
        kind: 'goods',
        url: 'https://show.maoyan.com/qqw#/detail/514992',
        title: '岳云鹏孙越相声专场演出',
        text: '分类：相声\n演出者：岳云鹏、孙越\n开售：已开售',
        author: {
          id: '11399',
          name: '岳云鹏',
          url: null,
          avatar: 'https://p0.pipi.cn/mediaplus/bigdata_crawler_media/e429585bc8b05172a96b1be1357007abe3e59.jpg?imageMogr2/thumbnail/2500x2500%3E',
        },
        created_at: null,
        cover: expect.stringContaining('https://p0.pipi.cn/'),
        media: [],
        stats: { views: null, likes: null, comments: null, collects: null, shares: null },
        price: { amount: 380, currency: 'CNY' },
        status: null,
      })
    })

    it('--city 接受城市名（可带「市」）和演出城市 ID；--category 在本地筛选', async () => {
      const { calls } = mock()
      await cli('maoyan', 'feed', 'list', '--city', '上海市')
      await cli('maoyan', 'feed', 'list', '--city', '13')
      expect(calls.map((c) => c.query)).toEqual([[['cityId', '1']], [['cityId', '13']]])
      const r = await cli('maoyan', 'feed', 'list', '--category', '1')
      expect(r.env.data.map((i: any) => i.id)).toEqual(['509565', '514571'])
    })

    it('找不到城市时报 USAGE，不发请求', async () => {
      const { calls } = mock()
      const r = await cli('maoyan', 'feed', 'list', '--city', '火星')
      expect(r.code).toBe(2)
      expect(r.env.error.code).toBe('USAGE')
      expect(calls).toHaveLength(0)
    })

    it('success 为 false 时报 UPSTREAM，原始错误码放在 detail', async () => {
      mock({ '/my/ianvs/movie/hotShows': () => json('{"success":false,"error":{"code":201,"message":"参数错误"}}') })
      const r = await cli('maoyan', 'feed', 'list', '--city', '99999')
      expect(r.code).toBe(7)
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '参数错误', detail: { code: 201 } })
    })

    it('HTTP 403 报 RISK_CONTROL', async () => {
      mock({ '/my/ianvs/movie/hotShows': () => fakeResponse('Forbidden', { status: 403 }) })
      const r = await cli('maoyan', 'feed', 'list')
      expect(r.code).toBe(5)
      expect(r.env.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked' } })
    })
  })

  describe('item get', () => {
    it('请求 dianping 详情接口：query 顺序、请求头顺序、mtgsig，不带 Cookie', async () => {
      const { calls } = mock()
      const r = await cli('maoyan', 'item', 'get', '514992')
      expect(r.code).toBe(0)
      const c = calls[0]!
      const uuid = c.headers.find(([k]) => k === 'uuid')![1]
      expect(uuid).toMatch(/^[a-z0-9]{64}$/)
      expect(c.url).toBe(
        'https://m.dianping.com/my/odea/project/detail?buyInstructionType=1&supportNewPromotion=true&projectId=514992&detailType=1' +
          `&optimus_risk_level=71&optimus_code=10&uuid=${uuid}` +
          '&clientPlatform=3&sellChannel=1&cityId=1&yodaReady=h5&csecplatform=4&csecversion=4.2.4',
      )
      expect(c.headers.map(([k]) => k)).toEqual(['User-Agent', 'Accept', 'Content-Type', 'Referer', 'Origin', 'uuid', 'mtgsig'])
      expect(c.cookies).toEqual([])
      const sig = JSON.parse(c.headers.find(([k]) => k === 'mtgsig')![1])
      expect(Object.keys(sig)).toEqual(expect.arrayContaining(['a1', 'a2', 'a3', 'a5', 'a6', 'a8', 'a9', 'a10', 'x0', 'd1']))
      expect(sig.a1).toBe('1.2')
      expect(sig.a3).toBe(WEBDFPID.split('-')[0])
    })

    it('uuid 每次请求都换', async () => {
      const { calls } = mock()
      await cli('maoyan', 'item', 'get', '514992')
      await cli('maoyan', 'item', 'get', '514992')
      const [a, b] = calls.map((c) => c.headers.find(([k]) => k === 'uuid')![1])
      expect(a).not.toBe(b)
    })

    it('归一化：场次时间、城市、场馆、票价档、状态逐行写进 text，介绍图片作 media', async () => {
      mock()
      const r = await cli('maoyan', 'item', 'get', '514992')
      expect(r.env.data).toMatchObject({
        id: '514992',
        kind: 'goods',
        url: 'https://show.maoyan.com/qqw#/detail/514992',
        title: expect.stringContaining('岳云鹏孙越相声专场演出'),
        text: '时间：2026.12.12 19:30 周六\n城市：北京\n场馆：北京展览馆剧场（官方售票）（西直门外大街135号）\n票价：380、1680\n状态：立即预定',
        author: null,
        price: { amount: 380, currency: 'CNY' },
        status: null,
      })
      expect(r.env.data.media).toEqual([expect.objectContaining({ type: 'image', url: expect.stringContaining('pipi.cn') })])
    })

    it('--raw 输出原始 data', async () => {
      mock()
      const r = await cli('maoyan', 'item', 'get', '514992', '--raw')
      expect(r.env.data).toMatchObject({ baseProjectVO: { cityId: 2 }, shopVO: { shopId: '2056138' } })
    })
  })

  it('演出参数：projectId、网页链接、App 跳转链接', () => {
    expect(resolveProject('514992')).toBe('514992')
    expect(resolveProject('https://show.maoyan.com/qqw#/detail/514992')).toBe('514992')
    expect(resolveProject('https://h5.dianping.com/app/myshow/#/detail/514992?isNewPage=true')).toBe('514992')
    expect(resolveProject('dianping://web?url=https%3A%2F%2Fh5.dianping.com%2Fapp%2Fmyshow%2F%23%2Fdetail%2F514992%3FisNewPage%3Dtrue')).toBe('514992')
    expect(() => resolveProject('abc')).toThrow(/无法识别/)
  })

  it('城市：同名时取官方核对过的 ID', () => {
    expect(resolveCity('北京').id).toBe('2')
    expect(resolveCity('上海').id).toBe('1')
    expect(resolveCity('无锡').id).toBe('13')
  })

  it('mtgsig 绑定 URL：不同 URL 签名不同', async () => {
    const a = JSON.parse(await mtgsig('https://m.dianping.com/a?x=1'))
    const b = JSON.parse(await mtgsig('https://m.dianping.com/a?x=2'))
    expect(a.a3).toBe(b.a3)
    expect(a.d1).not.toBe(b.d1)
  })

  it('feed categories、poi search 不联网', async () => {
    const { calls } = mock()
    const cats = await cli('maoyan', 'feed', 'categories')
    expect(cats.env.data[0]).toEqual({ id: '1', name: '演唱会', parent_id: null })
    const pois = await cli('maoyan', 'poi', 'search', '无锡')
    expect(pois.env.data).toEqual([{ id: '13', name: '无锡', address: null }])
    expect(calls).toHaveLength(0)
  })

  describe('登录', () => {
    const QRUUID = '11111111-2222-3333-4444-555555555555'
    const qrImage = () =>
      fakeResponse('jpeg', { headers: [['content-type', 'image/jpeg'], ['set-cookie', `qruuid=${QRUUID}; Path=/; Domain=.dianping.com; Max-Age=604800`]] })
    const status = (n: number, cookies: string[] = []) =>
      fakeResponse(`{"code":0,"data":{"status":${n},"description":""}}`, { headers: [['content-type', 'application/json'], ...cookies.map((c): [string, string] => ['set-cookie', c])] })
    const USER = () => json('{"success":true,"data":{"userId":12345,"nickName":"测试用户"}}')
    const loginRoutes = (check: (p: PreparedRequest) => HttpResponse) => ({
      '/mlogin/dp/api/v1/qrlogin/getQrCodeImg': qrImage,
      '/mlogin/dp/api/v1/qrlogin/check': check,
      '/api/account/v1/getUserInfoByToken': USER,
    })
    // 扫码接口走 pclogin 页的 H5guard 4.3.0：真实实现不好离线测（指纹与时间绑定），换桩
    const FP = 'H5dfp_4.3.0_tttt_test+/u=='
    /** h5_fingerprint 的编码值：buildUrl 用 urlencode（quote_plus），+、/、= 都要转义。 */
    const FP_Q = 'H5dfp_4.3.0_tttt_test%2B%2Fu%3D%3D'
    const LOGIN_HEADERS = ['User-Agent', 'Content-Type', 'Referer', 'mtgsig']
    let restoreGuard: (() => void) | undefined
    let signedUrls: string[] = []
    const installGuard = (): void => {
      signedUrls = []
      restoreGuard = mockGuard(() => ({
        fingerprint: FP,
        sign: async (url: string) => {
          signedUrls.push(url)
          return '{"a1":"1.2"}'
        },
        stop() {},
      }))
    }

    afterEach(() => {
      restoreGuard?.()
      restoreGuard = undefined
    })

    it('扫码：二维码内容由 qruuid 拼成，确认后保存 dper，凭证里不留 qruuid', async () => {
      const seq = [status(200), status(201), status(202, ['dper=fake-dper; Path=/; Domain=.dianping.com'])]
      const { calls } = mock(loginRoutes(() => seq.shift()!))
      installGuard()
      const r = await cli('maoyan', 'auth', 'login')
      expect(r.code).toBe(0)
      expect(r.env.data).toMatchObject({ platform: 'maoyan', account: 'default', method: 'qrcode', user: { id: '12345', name: '测试用户' } })
      expect(r.stderr).toContain('大众点评 App')
      expect(r.stderr).toContain('已扫码')
      // 请求照抄 account.dianping.com/pclogin 页：3 个 risk 参数 + 缓存整页的 h5_fingerprint + H5guard 公共参数，顺序一致
      expect(calls[0]!.url).toBe(
        `https://accountapi.dianping.com/mlogin/dp/api/v1/qrlogin/getQrCodeImg?risk_app=216&risk_partner=26&risk_platform=2&h5_fingerprint=${FP_Q}&yodaReady=h5&csecplatform=4&csecversion=4.3.0`,
      )
      expect(calls[1]!.url).toBe(
        `https://accountapi.dianping.com/mlogin/dp/api/v1/qrlogin/check?qruuid=${QRUUID}&risk_app=216&risk_partner=26&risk_platform=2&h5_fingerprint=${FP_Q}&yodaReady=h5&csecplatform=4&csecversion=4.3.0`,
      )
      // 头部顺序照抄网页的 GET：mtgsig 在最后，没有 Origin；轮询期间每个 check 的 URL 都重新出签
      expect(calls[0]!.headers.map(([k]) => k)).toEqual(LOGIN_HEADERS)
      expect(calls[0]!.headers).toContainEqual(['User-Agent', PCLOGIN_UA])
      expect(signedUrls).toEqual(calls.slice(0, -1).map((c) => c.url))
      expect(calls.at(-1)!.url).toBe('https://usercenter-inf.maoyan.com/api/account/v1/getUserInfoByToken?token=fake-dper')
      const saved = await readCredential('maoyan', 'web', 'default')
      expect(saved!.scopes.main!.cookies.map((c) => c.name)).toEqual(['dper'])
    })

    it('二维码过期报 AUTH_REQUIRED，有风险报 RISK_CONTROL', async () => {
      installGuard()
      mock(loginRoutes(() => json('{"error":{"code":101208,"message":"二维码不存在或过期"}}')))
      const expired = await cli('maoyan', 'auth', 'login')
      expect(expired.code).toBe(3)
      expect(expired.env.error.code).toBe('AUTH_REQUIRED')
      restoreSender!()
      mock(loginRoutes(() => json('{"error":{"code":101144,"message":"当前扫码登录存在风险"}}')))
      const risk = await cli('maoyan', 'auth', 'login')
      expect(risk.code).toBe(5)
      expect(risk.env.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked' } })
    })

    it('确认后响应里没有 dper 时报 UPSTREAM，不保存凭证', async () => {
      installGuard()
      mock(loginRoutes(() => status(202)))
      const r = await cli('maoyan', 'auth', 'login')
      expect(r.code).toBe(7)
      expect(await readCredential('maoyan', 'web', 'default').catch(() => null)).toBeNull()
    })

    it('cookie 导入要有 dper；令牌无效时不保存', async () => {
      mock(loginRoutes(() => status(200)))
      const none = await cli('maoyan', 'auth', 'login', '--method', 'cookie', '--cookie', 'a=b')
      expect(none.code).toBe(2)
      const ok = await cli('maoyan', 'auth', 'login', '--method', 'cookie', '--cookie', 'dper=fake-dper')
      expect(ok.env.data).toMatchObject({ method: 'cookie', user: { id: '12345' } })
      restoreSender!()
      mock({ '/api/account/v1/getUserInfoByToken': () => json('{"error":{"code":10010101,"message":"登录令牌无效"},"success":false}') })
      const bad = await cli('maoyan', 'auth', 'login', '-a', 'other', '--method', 'cookie', '--cookie', 'dper=bad')
      expect(bad.code).toBe(3)
      expect(await readCredential('maoyan', 'web', 'other').catch(() => null)).toBeNull()
    })

    it('auth status：未登录不联网；令牌失效时 logged_in 为 false', async () => {
      const { calls } = mock({ '/api/account/v1/getUserInfoByToken': USER })
      const guest = await cli('maoyan', 'auth', 'status')
      expect(guest.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
      expect(calls).toHaveLength(0)
      await cli('maoyan', 'auth', 'login', '--method', 'cookie', '--cookie', 'dper=fake-dper')
      const on = await cli('maoyan', 'auth', 'status')
      expect(on.env.data).toMatchObject({ logged_in: true, method: 'cookie', user: { id: '12345', avatar: null } })
      restoreSender!()
      mock({ '/api/account/v1/getUserInfoByToken': () => json('{"error":{"code":10010101,"message":"登录令牌无效"},"success":false}') })
      const off = await cli('maoyan', 'auth', 'status')
      expect(off.code).toBe(0)
      expect(off.env.data.logged_in).toBe(false)
    })
  })

  describe('item get --tickets', () => {
    const SHOWS = () => json('{"success":true,"data":{"showListVO":[{"showId":11,"showName":"2026-12-12 星期六 19:30"},{"showId":12,"showName":"2026-12-13 星期日 19:30"}]}}')
    const TICKETS = () =>
      json(
        '{"success":true,"data":{"ticketsVO":[{"ticketId":1,"ticketName":"380元","ticketPriceVO":{"sellPrice":342},"remainingStock":12,"showStatus":1,"shouldDisplay":true},' +
          '{"ticketId":2,"ticketName":"980元","ticketPriceVO":{"sellPrice":980},"remainingStock":0,"showStatus":2,"shouldDisplay":true},' +
          '{"ticketId":3,"ticketName":"隐藏","shouldDisplay":false}]}}',
      )
    const USER = () => json('{"success":true,"data":{"userId":12345,"nickName":"测试用户"}}')
    const onSale = () => json('{"success":false,"error":{"code":1007,"message":"该项目已经开售了~"}}')
    const login = () => cli('maoyan', 'auth', 'login', '--method', 'cookie', '--cookie', 'dper=fake-dper')

    it('未登录报 AUTH_REQUIRED，不发请求', async () => {
      const { calls } = mock()
      const r = await cli('maoyan', 'item', 'get', '514992', '--tickets')
      expect(r.code).toBe(3)
      expect(r.env.error).toMatchObject({ code: 'AUTH_REQUIRED', hint: 'catbus maoyan auth login' })
      expect(calls).toHaveLength(0)
    })

    it('已开售：preselect 返回 1007 后走带签名的 shows / tickets，token 在 query，不带 Cookie', async () => {
      const { calls } = mock({
        '/api/account/v1/getUserInfoByToken': USER,
        '/my/odea/project/shows/preselect': onSale,
        '/my/odea/project/shows': SHOWS,
        '/my/odea/show/tickets': TICKETS,
      })
      await login()
      const r = await cli('maoyan', 'item', 'get', '514992', '--tickets')
      expect(r.code).toBe(0)
      expect(r.env.data.text).toContain('状态：立即预定\n场次：2026-12-12 星期六 19:30\n票档：380元，实售价 342，余票 12\n票档：980元，实售价 980，余票 0，售罄\n场次：2026-12-13 星期日 19:30')
      expect(r.env.data.text).not.toContain('隐藏')
      expect(calls.filter((c) => c.path === '/my/odea/show/tickets').map((c) => new URL(c.url).searchParams.get('showId'))).toEqual(['11', '12'])

      const pre = calls.find((c) => c.path === '/my/odea/project/shows/preselect')!
      expect(pre.url).toBe('https://yanchu.maoyan.com/my/odea/project/shows/preselect?projectId=514992&cityId=2&token=fake-dper&cn_pt=RN')

      const shows = calls.find((c) => c.path === '/my/odea/project/shows')!
      const uuid = shows.headers.find(([k]) => k === 'uuid')![1]
      expect(shows.url).toBe(
        `https://m.dianping.com/my/odea/project/shows?optimus_risk_level=71&optimus_code=10&uuid=${uuid}&clientPlatform=3&sellChannel=1&cityId=2&token=fake-dper&yodaReady=h5&csecplatform=4&csecversion=4.2.4`,
      )
      expect(shows.headers.map(([k]) => k)).toEqual(['User-Agent', 'Accept', 'Content-Type', 'Referer', 'Origin', 'uuid', 'mtgsig'])
      expect(shows.cookies).toEqual([])

      const t = calls.find((c) => c.path === '/my/odea/show/tickets')!
      const tu = t.headers.find(([k]) => k === 'uuid')![1]
      expect(t.url).toBe(
        `https://m.dianping.com/my/odea/show/tickets?showId=11&projectId=514992&clientPlatform=3&supportNewPromotion=true&optimus_risk_level=71&optimus_code=10&uuid=${tu}&sellChannel=1&cityId=2&token=fake-dper&yodaReady=h5&csecplatform=4&csecversion=4.2.4`,
      )
    })

    it('未开售：走 preselect，不请求在售接口', async () => {
      const { calls } = mock({
        '/api/account/v1/getUserInfoByToken': USER,
        '/my/odea/project/shows/preselect': SHOWS,
        '/my/odea/show/tickets/preselect': TICKETS,
      })
      await login()
      const r = await cli('maoyan', 'item', 'get', '514992', '--tickets')
      expect(r.code).toBe(0)
      expect(r.env.data.text).toContain('票档：380元')
      expect(calls.map((c) => c.path)).not.toContain('/my/odea/project/shows')
    })

    it('--raw 带 shows；token 失效报 AUTH_EXPIRED', async () => {
      mock({
        '/api/account/v1/getUserInfoByToken': USER,
        '/my/odea/project/shows/preselect': onSale,
        '/my/odea/project/shows': SHOWS,
        '/my/odea/show/tickets': TICKETS,
      })
      await login()
      const raw = await cli('maoyan', 'item', 'get', '514992', '--tickets', '--raw')
      expect(raw.env.data.shows[0].tickets[0].remainingStock).toBe(12)
      restoreSender!()
      mock({ '/my/odea/project/shows/preselect': () => json('{"success":false,"error":{"code":403,"message":"请先登录！"}}') })
      const expired = await cli('maoyan', 'item', 'get', '514992', '--tickets')
      expect(expired.code).toBe(3)
      expect(expired.env.error.code).toBe('AUTH_EXPIRED')
    })
  })

  it('item search 是规划中的命令', async () => {
    const r = await cli('maoyan', 'item', 'search', '演唱会')
    expect(r.code).toBe(4)
    expect(r.env.error.code).toBe('NOT_IMPLEMENTED')
  })
})
