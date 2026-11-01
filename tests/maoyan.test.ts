import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeResponse, type HeaderPairs, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import * as rand from '../src/core/rand.js'
import { resolveCity, resolveProject } from '../src/platforms/maoyan/web/resolve.js'
import { mtgsig, WEBDFPID } from '../src/platforms/maoyan/web/sign.js'
import { cli, useTempHome } from './helpers.js'

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
      expect(r.stderr).toBe('')
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
        author: { id: '11399', name: '岳云鹏', url: null },
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

  it('item search 是规划中的命令', async () => {
    const r = await cli('maoyan', 'item', 'search', '演唱会')
    expect(r.code).toBe(4)
    expect(r.env.error.code).toBe('NOT_IMPLEMENTED')
  })
})
