import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestError } from 'wreq-js'
import { fakeResponse, type HeaderPairs, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { resetSession } from '../src/platforms/12306/web/client.js'
import { hasTicket, parseStations, parseYp } from '../src/platforms/12306/web/normalize.js'
import { cli, useTempHome } from './helpers.js'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/12306', name), 'utf8')
const DATE = '2026-10-10'

interface CallRecord {
  path: string
  url: string
  query: Record<string, string>
  headers: HeaderPairs
  cookies: [string, string][]
}

function mockTrain(overrides: Record<string, (p: PreparedRequest, u: URL) => HttpResponse> = {}) {
  const routes: Record<string, (p: PreparedRequest, u: URL) => HttpResponse> = {
    '/otn/leftTicket/init': () =>
      fakeResponse(`<script>var ${fixture('init.html.txt')};</script>`, {
        headers: [
          ['content-type', 'text/html'],
          ['set-cookie', 'JSESSIONID=fake; Path=/otn'],
        ],
      }),
    '/otn/resources/js/framework/station_name.js': () =>
      fakeResponse(fixture('station_name.js'), { headers: [['content-type', 'application/javascript']] }),
    '/otn/leftTicket/queryG': () =>
      fakeResponse(fixture('left_ticket.json'), { headers: [['content-type', 'application/json']] }),
    '/otn/leftTicket/queryTicketPrice': () =>
      fakeResponse(fixture('price.json'), { headers: [['content-type', 'application/json']] }),
    '/otn/czxx/queryByTrainNo': () =>
      fakeResponse(fixture('route.json'), { headers: [['content-type', 'application/json']] }),
    '/lcquery/queryG': () =>
      fakeResponse(fixture('transfer.json'), { headers: [['content-type', 'application/json']] }),
    ...overrides,
  }
  const calls: CallRecord[] = []
  const restore = mockSender((p: PreparedRequest) => {
    const u = new URL(p.url)
    calls.push({
      path: u.pathname,
      url: p.url,
      query: Object.fromEntries(u.searchParams),
      headers: p.headers,
      cookies: p.cookies,
    })
    const route = routes[u.pathname]
    if (!route) throw new Error(`未录制的请求：${u.pathname}`)
    return route(p, u)
  })
  return { calls, restore }
}

describe('12306 平台（web）', () => {
  useTempHome()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-07T10:00:00+08:00') })
    resetSession()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('信封（catbus AGENTS 6.1）', () => {
    it('成功时字段齐全且顺序固定，为游客态', async () => {
      const { restore } = mockTrain()
      try {
        const r = await cli('12306', 'station', 'search', '杭州')
        expect(Object.keys(r.env)).toEqual(['ok', 'platform', 'endpoint', 'resource', 'action', 'account', 'data', 'page', 'error'])
        expect(r.env).toMatchObject({
          ok: true,
          platform: '12306',
          endpoint: 'web',
          resource: 'station',
          action: 'search',
          account: 'guest',
          page: null,
          error: null,
        })
        expect(r.code).toBe(0)
      } finally {
        restore()
      }
    })

    it('失败时 data 为 null，error 带 code / message / hint / detail', async () => {
      const { restore } = mockTrain()
      try {
        const r = await cli('12306', 'ticket', 'search', '火星', '上海', '--date', DATE)
        expect(r.env.ok).toBe(false)
        expect(r.env.data).toBeNull()
        expect(Object.keys(r.env.error)).toEqual(['code', 'message', 'hint', 'detail'])
        expect(r.env.error.code).toBe('USAGE')
        expect(r.code).toBe(2)
      } finally {
        restore()
      }
    })
  })

  describe('退出码（catbus AGENTS 6.4）', () => {
    const cases = [
      ['参数不足', ['12306', 'route', 'get', '240000G53106'], 'USAGE', 2],
      ['日期格式', ['12306', 'ticket', 'search', '北京', '上海', '--date', '20261010'], 'USAGE', 2],
      ['日期已过', ['12306', 'ticket', 'search', '北京', '上海', '--date', '2026-10-06'], 'USAGE', 2],
      ['limit 非法', ['12306', 'transfer', 'search', '北京', '杭州', '--limit', '0'], 'USAGE', 2],
      ['票价缺选项', ['12306', 'ticket', 'price', '240000G53106'], 'USAGE', 2],
    ]
    for (const [name, argv, code, exit] of cases) {
      it(name as string, async () => {
        const { restore } = mockTrain()
        try {
          const r = await cli(...(argv as string[]))
          expect([r.env.error?.code, r.code]).toEqual([code, exit])
        } finally {
          restore()
        }
      })
    }

    it('302 / 429 → RISK_CONTROL rate_limit，403 → blocked，退出码 5', async () => {
      for (const [status, kind] of [
        [302, 'rate_limit'],
        [429, 'rate_limit'],
        [403, 'blocked'],
      ] as const) {
        resetSession()
        const { restore } = mockTrain({
          '/otn/leftTicket/queryG': () =>
            fakeResponse('', {
              status,
              headers: status === 302 ? [['location', '/mormhweb/logFiles/error.html']] : [],
            }),
        })
        try {
          const r = await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)
          expect([r.env.error?.code, r.env.error?.detail?.kind, r.code]).toEqual(['RISK_CONTROL', kind, 5])
        } finally {
          restore()
        }
      }
    })

    it('网络错误 → NETWORK，退出码 6', async () => {
      const { restore } = mockTrain({
        '/otn/leftTicket/init': () => {
          throw new RequestError('connection reset')
        },
      })
      try {
        const r = await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)
        expect([r.env.error?.code, r.code]).toEqual(['NETWORK', 6])
      } finally {
        restore()
      }
    })

    it('返回 HTML（超出预售期）→ UPSTREAM，退出码 7', async () => {
      const { restore } = mockTrain({
        '/otn/leftTicket/queryG': () => fakeResponse('<html>error</html>', { headers: [['content-type', 'text/html']] }),
      })
      try {
        const r = await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)
        expect([r.env.error?.code, r.code]).toEqual(['UPSTREAM', 7])
        expect(r.env.error.hint).toContain('预售期')
      } finally {
        restore()
      }
    })
  })

  describe('车站', () => {
    it('解析字典', () => {
      const s = parseStations(fixture('station_name.js'))
      expect(s.find((x) => x.code === 'VNP')).toEqual({
        id: 'VNP',
        name: '北京南',
        code: 'VNP',
        pinyin: 'beijingnan',
        abbr: 'bjn',
        city: '北京',
        url: null,
      })
    })

    it('搜索支持中文、拼音前缀、电报码；结果缓存', async () => {
      const { calls, restore } = mockTrain()
      try {
        const r1 = await cli('12306', 'station', 'search', 'hz')
        expect(r1.env.data.map((x: any) => x.code)).toEqual(['HGH', 'HZH'])
        const r2 = await cli('12306', 'station', 'search', 'aoh')
        expect(r2.env.data.map((x: any) => x.name)).toEqual(['上海虹桥'])
        resetSession()
        await cli('12306', 'station', 'search', '北京')
        expect(calls.filter((c) => c.path.endsWith('station_name.js'))).toHaveLength(1)
      } finally {
        restore()
      }
    })
  })

  describe('余票', () => {
    it('城市名解析为同名站，请求参数正确，带上 init 拿到的 cookie', async () => {
      const { calls, restore } = mockTrain()
      try {
        await cli('12306', 'ticket', 'search', '北京', 'shanghai', '--date', DATE)
        const q = calls.find((c) => c.path === '/otn/leftTicket/queryG')!
        expect(q.query).toEqual({
          'leftTicketDTO.train_date': DATE,
          'leftTicketDTO.from_station': 'BJP',
          'leftTicketDTO.to_station': 'SHH',
          purpose_codes: 'ADULT',
        })
        expect(q.cookies).toContainEqual(['JSESSIONID', 'fake'])
      } finally {
        restore()
      }
    })

    it('解析车次、座位与下单链接', async () => {
      const { restore } = mockTrain()
      try {
        const { data } = (await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)).env
        const g531 = data.find((x: any) => x.id === 'G531')
        expect(g531).toMatchObject({
          train_no: '240000G53106',
          type: 'G',
          from: { code: 'VNP', name: '北京南', no: '01' },
          to: { code: 'AOH', name: '上海虹桥', no: '13' },
          depart: '06:08',
          arrive: '12:04',
          duration: '05:56',
          date: DATE,
          bookable: true,
          has_ticket: true,
          seat_types: '9MOO',
        })
        expect(g531.seats['二等座']).toBe('有')
        expect(g531.url).toBe(
          'https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=%E5%8C%97%E4%BA%AC%E5%8D%97%2CVNP&ts=%E4%B8%8A%E6%B5%B7%E8%99%B9%E6%A1%A5%2CAOH&date=2026-10-10&flag=N%2CN%2CY',
        )
      } finally {
        restore()
      }
    })

    it('--type 与 --available 过滤', async () => {
      const { restore } = mockTrain()
      try {
        const all = (await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)).env.data
        expect((await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE, '--type', 'D')).env.data).toEqual([])
        const avail = (await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE, '--available')).env.data
        expect(avail.length).toBe(all.filter((x: any) => x.has_ticket).length)
      } finally {
        restore()
      }
    })

    it('返回 c_url 时切换到新路径重试', async () => {
      const { calls, restore } = mockTrain({
        '/otn/leftTicket/queryG': () => fakeResponse(JSON.stringify({ c_url: 'leftTicket/queryZ', status: false })),
        '/otn/leftTicket/queryZ': () => fakeResponse(fixture('left_ticket.json'), { headers: [['content-type', 'application/json']] }),
      })
      try {
        const r = await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)
        expect(r.env.ok).toBe(true)
        expect(calls.map((c) => c.path)).toContain('/otn/leftTicket/queryZ')
      } finally {
        restore()
      }
    })

    it('remaining：≤20 给数字，封顶 21 给 {min: 21}，无座不封顶；prices 与票价接口一致', async () => {
      const { restore } = mockTrain()
      try {
        const { data } = (await cli('12306', 'ticket', 'search', '北京', '上海', '--date', DATE)).env
        const g531 = data.find((x: any) => x.id === 'G531')
        expect(g531.remaining).toEqual({ 商务座: 0, 一等座: 0, 二等座: { min: 21 }, 无座: 0 })
        expect(g531.prices['二等座']).toEqual({ amount: 525, currency: 'CNY' })
        expect(data.find((x: any) => x.id === 'G7').remaining['优选一等座']).toBe(1)
      } finally {
        restore()
      }
    })

    it('parseYp', () => {
      expect(parseYp('4042250009302685002110156530171015650000')).toEqual({
        remaining: { 软卧: 9, 硬卧: { min: 21 }, 无座: 17, 硬座: 0 },
        prices: {
          软卧: { amount: 422.5, currency: 'CNY' },
          硬卧: { amount: 268.5, currency: 'CNY' },
          无座: { amount: 156.5, currency: 'CNY' },
          硬座: { amount: 156.5, currency: 'CNY' },
        },
      })
      expect(parseYp('O012303216').remaining).toEqual({ 无座: 216 })
      expect(parseYp('')).toEqual({ remaining: {}, prices: {} })
    })

    it('hasTicket', () => {
      expect(['有', '12', '无', '候补', '*', ''].map(hasTicket)).toEqual([true, true, false, false, false, false])
    })
  })

  describe('票价 / 经停 / 中转', () => {
    it('票价输出 Price（catbus 6.2）', async () => {
      const { restore } = mockTrain()
      try {
        const { data } = (
          await cli(
            '12306',
            'ticket',
            'price',
            '240000G53106',
            '--from-no',
            '01',
            '--to-no',
            '13',
            '--seat-types',
            '9MOO',
            '--date',
            DATE,
          )
        ).env
        expect(data.prices['二等座']).toEqual({ amount: 525, currency: 'CNY' })
        expect(data.prices['商务座']).toEqual({ amount: 1870, currency: 'CNY' })
      } finally {
        restore()
      }
    })

    it('经停', async () => {
      const { restore } = mockTrain()
      try {
        const { data } = (await cli('12306', 'route', 'get', '240000G53106', '北京南', '上海虹桥', '--date', DATE)).env
        expect(data[0]).toMatchObject({ id: '01', station: '北京南', depart: '06:08' })
        expect(data.at(-1).station).toBe('上海虹桥')
      } finally {
        restore()
      }
    })

    it('中转：--via 传电报码，--limit 截断', async () => {
      const { calls, restore } = mockTrain()
      try {
        const { data } = (
          await cli('12306', 'transfer', 'search', '北京', '杭州', '--via', '南京南', '--limit', '1', '--date', DATE)
        ).env
        expect(calls.find((c) => c.path === '/lcquery/queryG')!.query.middle_station).toBe('NKH')
        expect(data).toHaveLength(1)
        expect(data[0].via).toBe('南京南')
        expect(data[0].legs).toHaveLength(2)
        expect(data[0].id).toMatch(/^\w+\+\w+@南京南$/)
        expect(data[0].kind).toBe(data[0].same_train ? '同车换座' : '换乘')
        expect(data[0].legs[0].remaining).toBeTypeOf('object')
      } finally {
        restore()
      }
    })
  })
})
