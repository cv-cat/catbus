import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCredential } from '../src/core/auth-store.js'
import { md5Hex } from '../src/core/hash.js'
import { fakeResponse, type HeaderPairs, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { images } from '../src/platforms/zhihu/web/normalize.js'
import { resolveFolder, resolveItem, resolveQuestion } from '../src/platforms/zhihu/web/resolve.js'
import { encrypt, signSource, zse96 } from '../src/platforms/zhihu/web/sign.js'
import { cli, useTempHome } from './helpers.js'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/zhihu', name), 'utf8')

const DC0 = 'AFBfakeDc0Value0000000000000000000000=|1790000000'
const XSRF = 'fakexsrf0000'
const COOKIE = `_xsrf=${XSRF}; d_c0=${DC0}; z_c0=2|1:0|10:1790000000|4:z_c0|92:fakeZc0; _zap=fakezap`

type Route = (p: PreparedRequest, u: URL) => HttpResponse

const json = (name: string) => fakeResponse(fixture(name), { headers: [['content-type', 'application/json']] })

/** 按路径回放 fixture；记录每个请求。 */
function mockZhihu(overrides: Record<string, Route> = {}) {
  const routes: Record<string, Route> = {
    '/api/v4/me': () => json('me.json'),
    '/api/v4/members/catbus-tester': () => json('member.json'),
    '/api/v4/members/catbus-tester/answers': () => json('member_answers.json'),
    '/api/v4/members/catbus-tester/articles': () => json('member_articles.json'),
    '/api/v4/members/catbus-tester/followers': (p) => (p.method === 'GET' ? json('followers.json') : fakeResponse({ follower_count: 4322 })),
    '/api/v4/members/catbus-tester/followees': () => json('followers.json'),
    '/api/v4/answers/1234567890': () => json('answer.json'),
    '/api/v4/answers/1234567890/voters': () => fakeResponse({ voting: 1, voteup_count: 1025 }),
    '/api/v4/articles/26319034': () => json('article.json'),
    '/api/v4/articles/26319034/voters': () => fakeResponse({ voting: 1, voteup_count: 89 }),
    '/api/v4/pins/2092973041173251769': () => json('pin.json'),
    '/api/v4/pins/2092973041173251769/voters/up': () => fakeResponse({ success: true, reaction_state: true, reaction_count: 17 }),
    '/api/v4/questions/19550225': () => json('question.json'),
    '/api/v4/questions/19550225/feeds': () => json('question_feeds.json'),
    '/api/v4/comment_v5/answers/1234567890/root_comment': () => json('root_comment.json'),
    '/api/v4/comment_v5/articles/26319034/root_comment': () => json('root_comment.json'),
    '/api/v4/comment_v5/comment/10001/child_comment': () => json('child_comment.json'),
    '/api/v4/search_v3': (_p, u) => json(`search_${u.searchParams.get('t')}.json`),
    '/api/v4/search/suggest': () => json('suggest.json'),
    '/api/v4/search/top_search': () => json('top_search.json'),
    '/api/v3/feed/topstory/recommend': () => json('recommend.json'),
    '/api/v3/feed/topstory/hot-lists/total': () => json('hot.json'),
    '/api/v3/moments': () => json('moments.json'),
    '/api/v4/people/catbus-tester/collections': () => json('collections.json'),
    '/api/v4/collections/777/items': () => json('collection_items.json'),
    ...overrides,
  }
  const calls: PreparedRequest[] = []
  const restore = mockSender((p) => {
    calls.push(p)
    const u = new URL(p.url)
    const route = routes[u.pathname]
    if (!route) throw new Error(`未录制的请求：${p.method} ${u.pathname}`)
    return route(p, u)
  })
  return { calls, restore }
}

const header = (headers: HeaderPairs, name: string) => headers.find(([k]) => k.toLowerCase() === name)?.[1]

/** x-zse-96 是对这个请求的签名：枚举 127 个随机首字节，恰好有一个能对上。 */
function expectSigned(p: PreparedRequest, dc0 = DC0) {
  expect(header(p.headers, 'x-zse-93')).toBe('101_3_3.0')
  const sig = header(p.headers, 'x-zse-96')!
  expect(sig).toMatch(/^2\.0_[0-9A-Za-z+/=]{64}$/)
  const u = new URL(p.url)
  const md5 = md5Hex(signSource(u.pathname + u.search, dc0, typeof p.body === 'string' ? p.body : undefined))
  const seeds = [...Array(127).keys()].filter((s) => encrypt(md5, s) === sig.slice(4))
  expect(seeds).toHaveLength(1)
}

async function login() {
  const { restore } = mockZhihu()
  try {
    const r = await cli('zhihu', 'auth', 'login', '--cookie', COOKIE)
    expect(r.env.ok).toBe(true)
  } finally {
    restore()
  }
}

/** 先登录，再执行一条命令。 */
async function run(argv: string[], overrides: Record<string, Route> = {}) {
  await login()
  const mock = mockZhihu(overrides)
  try {
    const r = await cli('zhihu', ...argv)
    return { ...r, calls: mock.calls }
  } finally {
    mock.restore()
  }
}

describe('zhihu 签名（x-zse-96）', () => {
  /** 知乎线上 JS（模块 1514，2026-10-14）在 node vm 里固定 Math.random 算出的值。vm 里前端把第二个字节标成 10。 */
  const VECTORS = [
    { md5: '4479ab8dd17d0ae67998cb8cd9d8e0ec', seed: 15, out: 'VeHqHY=ebOT1THypgQV758Jpd9+HFR9FQmUAKqDiU/hOn=P3aF5MTPzqps4VsLgG' },
    { md5: '98f80a1d12826bebfad47d04f344c91b', seed: 63, out: 'rOWgWFzQdNkch8rM92KzbwnhkqiPJoW9Mq83hLDv4btb0uMAPBk3xJ63lXOCMALn' },
  ]

  it('加密与知乎前端逐字节一致', () => {
    for (const v of VECTORS) expect(encrypt(v.md5, v.seed, 10)).toBe(v.out)
  })

  it('签名源串：x-zse-93、路径、d_c0、请求体依次用 + 连接；超过 4096 字节的请求体不参与', () => {
    expect(signSource('/api/v4/me?include=a', 'dc0')).toBe('101_3_3.0+/api/v4/me?include=a+dc0')
    expect(signSource('/api/v4/answers/1/voters', 'dc0', '{"type":"up"}')).toBe('101_3_3.0+/api/v4/answers/1/voters+dc0+{"type":"up"}')
    expect(signSource('/p', 'dc0', 'x'.repeat(4097))).toBe('101_3_3.0+/p+dc0')
  })

  it('x-zse-96 的格式', () => {
    expect(zse96('/api/v4/me', 'dc0')).toMatch(/^2\.0_[0-9A-Za-z+/=]{64}$/)
  })
})

describe('zhihu 参数归一化', () => {
  it('item：回答 ID、带类型前缀的 ID、各种链接', () => {
    expect(resolveItem('1234567890')).toEqual({ type: 'answer', id: '1234567890' })
    expect(resolveItem('article:26319034')).toEqual({ type: 'article', id: '26319034' })
    expect(resolveItem('pin:2092973041173251769')).toEqual({ type: 'pin', id: '2092973041173251769' })
    expect(resolveItem('https://www.zhihu.com/question/19550225/answer/1234567890?utm=x')).toEqual({ type: 'answer', id: '1234567890' })
    expect(resolveItem('www.zhihu.com/answer/1234567890')).toEqual({ type: 'answer', id: '1234567890' })
    expect(resolveItem('https://zhuanlan.zhihu.com/p/26319034')).toEqual({ type: 'article', id: '26319034' })
    expect(resolveItem('https://www.zhihu.com/pin/2092973041173251769')).toEqual({ type: 'pin', id: '2092973041173251769' })
  })

  it('item：问题不是 item，提示用 question 命令', () => {
    for (const s of ['question:19550225', 'https://www.zhihu.com/question/19550225']) {
      expect(() => resolveItem(s)).toThrow(expect.objectContaining({ code: 'USAGE', hint: expect.stringContaining('question get') }))
    }
    expect(() => resolveItem('https://example.com/answer/1')).toThrow(expect.objectContaining({ code: 'USAGE' }))
  })

  it('item：视频（zvideo）→ UNSUPPORTED', () => {
    expect(() => resolveItem('https://www.zhihu.com/zvideo/1242411507792953344')).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }))
  })

  it('正文图片：src 不会匹配到 data-src', () => {
    expect(images('<img data-src="https://pic1.zhimg.com/lazy.jpg" src="https://pic1.zhimg.com/real.jpg">').map((m) => m.url)).toEqual(['https://pic1.zhimg.com/real.jpg'])
  })

  it('问题与收藏夹', () => {
    expect(resolveQuestion('19550225')).toBe('19550225')
    expect(resolveQuestion('question:19550225')).toBe('19550225')
    expect(resolveQuestion('https://www.zhihu.com/question/19550225/answer/1')).toBe('19550225')
    expect(resolveFolder('https://www.zhihu.com/collection/777')).toBe('777')
  })
})

describe('zhihu 平台（web）', () => {
  const home = useTempHome()

  describe('auth', () => {
    it('cookie 登录：调 /api/v4/me 校验，保存 url_token，设为当前账号', async () => {
      const { calls, restore } = mockZhihu()
      try {
        const r = await cli('zhihu', 'auth', 'login', '--cookie', COOKIE)
        expect(r.code).toBe(0)
        expect(r.env.data).toMatchObject({
          platform: 'zhihu',
          account: 'default',
          current: true,
          method: 'cookie',
          user: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: '猫巴士', url: 'https://www.zhihu.com/people/catbus-tester' },
        })
        expect(calls).toHaveLength(1)
        expect(new URL(calls[0]!.url).pathname).toBe('/api/v4/me')
        expectSigned(calls[0]!)
        expect(calls[0]!.cookies.map(([k]) => k)).toEqual(['_xsrf', 'd_c0', 'z_c0', '_zap'])
        const saved = await readCredential('zhihu', 'web', 'default')
        expect(saved!.extra.url_token).toBe('catbus-tester')
        expect(home.dir).toBeTruthy()
      } finally {
        restore()
      }
    })

    it('cookie 里没有 z_c0 → USAGE', async () => {
      const r = await cli('zhihu', 'auth', 'login', '--cookie', `d_c0=${DC0}`)
      expect([r.env.error.code, r.code]).toEqual(['USAGE', 2])
    })

    it('没有 d_c0 时先 POST /udid 拿一个，再签名', async () => {
      const { calls, restore } = mockZhihu({
        '/udid': () => fakeResponse('', { headers: [['set-cookie', 'd_c0=NEWdc0|1790000001; Domain=zhihu.com; Path=/']] }),
      })
      try {
        const r = await cli('zhihu', 'auth', 'login', '--cookie', 'z_c0=fake; _xsrf=x')
        expect(r.env.ok).toBe(true)
        expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /udid', 'GET /api/v4/me'])
        expectSigned(calls[1]!, 'NEWdc0|1790000001')
      } finally {
        restore()
      }
    })

    it('d_c0 已过期：不拿它签名（请求里不会带它），重新 POST /udid', async () => {
      const { calls, restore } = mockZhihu({
        '/udid': () => fakeResponse('', { headers: [['set-cookie', 'd_c0=NEWdc0|1790000001; Domain=zhihu.com; Path=/']] }),
      })
      try {
        const cookies = [
          { name: 'z_c0', value: 'fake', domain: '.zhihu.com', path: '/' },
          { name: 'd_c0', value: 'EXPIREDdc0|1', domain: '.zhihu.com', path: '/', expirationDate: 1000 },
        ]
        const r = await cli('zhihu', 'auth', 'login', '--cookie', JSON.stringify(cookies))
        expect(r.env.ok).toBe(true)
        expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /udid', 'GET /api/v4/me'])
        expectSigned(calls[1]!, 'NEWdc0|1790000001')
      } finally {
        restore()
      }
    })

    it('cookie 失效：登录报 AUTH_REQUIRED；auth status 返回 logged_in false', async () => {
      const expired = { '/api/v4/me': () => fakeResponse({ error: { code: 100, message: '请求头或参数封装错误', name: 'AuthenticationInvalidRequest' } }, { status: 401 }) }
      let mock = mockZhihu(expired)
      try {
        const r = await cli('zhihu', 'auth', 'login', '--cookie', COOKIE)
        expect([r.env.error.code, r.code]).toEqual(['AUTH_REQUIRED', 3])
      } finally {
        mock.restore()
      }
      await login()
      mock = mockZhihu(expired)
      try {
        const r = await cli('zhihu', 'auth', 'status')
        expect(r.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
      } finally {
        mock.restore()
      }
    })
  })

  describe('user', () => {
    it('user get me：用保存的 url_token，不再请求 /me', async () => {
      const r = await run(['user', 'get', 'me'])
      expect(r.calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/v4/members/catbus-tester'])
      expect(new URL(r.calls[0]!.url).searchParams.get('include')).toContain('follower_count')
      expectSigned(r.calls[0]!)
      expect(r.env.data).toEqual({
        id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        name: '猫巴士',
        handle: 'catbus-tester',
        avatar: 'https://pic1.zhimg.com/v2-fakeavatar_xl.jpg?source=32738c0c&needBackground=1',
        url: 'https://www.zhihu.com/people/catbus-tester',
        bio: '上车，开往任何平台',
        stats: { followers: 4321, following: 56, items: 87, likes: 10000 },
      })
    })

    it('user items：默认回答、按时间；--type article --sort popular 取文章、按赞同', async () => {
      let r = await run(['user', 'items', 'https://www.zhihu.com/people/catbus-tester'])
      let u = new URL(r.calls[0]!.url)
      expect([u.pathname, u.searchParams.get('sort_by'), u.searchParams.get('limit')]).toEqual(['/api/v4/members/catbus-tester/answers', 'created', '20'])
      expect(r.env.data.map((x: any) => [x.id, x.kind])).toEqual([
        ['1234567890', 'text'],
        ['1234567891', 'text'],
      ])
      expect(r.env.page).toEqual({ cursor: '/api/v4/members/catbus-tester/answers?include=data%5B%2A%5D.content&limit=20&offset=20&sort_by=created', has_more: true })

      r = await run(['user', 'items', 'catbus-tester', '--type', 'article', '--sort', 'popular'])
      u = new URL(r.calls[0]!.url)
      expect([u.pathname, u.searchParams.get('sort_by')]).toEqual(['/api/v4/members/catbus-tester/articles', 'voteups'])
      expect(r.env.data.map((x: any) => x.id)).toEqual(['article:26319034'])
      expect(r.env.page).toEqual({ cursor: null, has_more: false })
    })

    it('--cursor 原样请求下一页；不是这个接口的 cursor → USAGE', async () => {
      const next = '/api/v4/members/catbus-tester/answers?include=data%5B%2A%5D.content&limit=20&offset=20&sort_by=created'
      let r = await run(['user', 'items', 'catbus-tester', '--cursor', next])
      expect(r.calls[0]!.url).toBe(`https://www.zhihu.com${next}`)
      expectSigned(r.calls[0]!)
      r = await run(['user', 'items', 'catbus-tester', '--cursor', '/api/v4/me'])
      expect([r.env.error.code, r.code]).toEqual(['USAGE', 2])
      r = await run(['user', 'items', 'catbus-tester', '--cursor', 'https://evil.example.com/api/v4/members/x'])
      expect(r.env.error.code).toBe('USAGE')
    })

    it('中文 url_token 原样发出（路径编码参与签名）；机构号的主页链接是 /org/', async () => {
      const r = await run(['user', 'get', '张三'], {
        [`/api/v4/members/${encodeURIComponent('张三')}`]: () => fakeResponse({ ...JSON.parse(fixture('member.json')), user_type: 'organization', is_org: true }),
      })
      expect(new URL(r.calls[0]!.url).pathname).toBe(`/api/v4/members/${encodeURIComponent('张三')}`)
      expectSigned(r.calls[0]!)
      expect(r.env.data.url).toBe('https://www.zhihu.com/org/catbus-tester')
      const org = await run(['user', 'get', 'https://www.zhihu.com/org/catbus-tester'])
      expect(new URL(org.calls[0]!.url).pathname).toBe('/api/v4/members/catbus-tester')
    })

    it('粉丝、关注、搜索用户', async () => {
      let r = await run(['user', 'followers', 'catbus-tester'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/members/catbus-tester/followers')
      expect(r.env.data[0]).toMatchObject({ id: 'ffff0000ffff0000ffff0000ffff0000', handle: 'reader-1', url: 'https://www.zhihu.com/people/reader-1' })
      r = await run(['user', 'following'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/members/catbus-tester/followees')
      r = await run(['user', 'search', '猫巴士'])
      expect(new URL(r.calls[0]!.url).searchParams.get('t')).toBe('people')
      expect(r.env.data).toHaveLength(1)
      expect(r.env.data[0]).toMatchObject({ name: '猫巴士', handle: 'catbus-tester', stats: { followers: 4321, items: 87 } })
    })

    it('关注 / 取消关注：先查用户，再 POST / DELETE（带 x-xsrftoken）；返回与 user get 相同的 id', async () => {
      let r = await run(['user', 'follow', 'https://www.zhihu.com/people/catbus-tester'])
      expect(r.env.data).toEqual({ id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' })
      expect(r.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /api/v4/members/catbus-tester', 'POST /api/v4/members/catbus-tester/followers'])
      expect(header(r.calls[1]!.headers, 'x-xsrftoken')).toBe(XSRF)
      expect(header(r.calls[1]!.headers, 'origin')).toBe('https://www.zhihu.com')
      expectSigned(r.calls[1]!)
      r = await run(['user', 'unfollow', 'catbus-tester'])
      expect(r.calls[1]!.method).toBe('DELETE')
    })
  })

  describe('item', () => {
    it('回答：正文转纯文本，图片取原图并去重，跳过 data: 占位图', async () => {
      const r = await run(['item', 'get', 'https://www.zhihu.com/question/19550225/answer/1234567890'])
      expect(new URL(r.calls[0]!.url).searchParams.get('include')).toContain('content')
      expect(r.env.data).toEqual({
        id: '1234567890',
        kind: 'text',
        url: 'https://www.zhihu.com/question/19550225/answer/1234567890',
        title: '如何评价猫巴士？',
        text: '猫巴士是一个命令行工具。一个命令开往 & 任何平台。',
        author: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: '猫巴士', url: 'https://www.zhihu.com/people/catbus-tester' },
        created_at: '2026-09-21T22:13:20+08:00',
        cover: 'https://pic1.zhimg.com/v2-img1_r.jpg',
        media: [{ id: null, type: 'image', url: 'https://pic1.zhimg.com/v2-img1_r.jpg', width: 800, height: 600, duration: null }],
        stats: { views: null, likes: 1024, comments: 32, collects: 15, shares: null },
        price: null,
        status: null,
      })
    })

    it('文章与想法：id 带类型前缀', async () => {
      let r = await run(['item', 'get', 'https://zhuanlan.zhihu.com/p/26319034'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/articles/26319034')
      expect(r.env.data).toMatchObject({
        id: 'article:26319034',
        kind: 'article',
        url: 'https://zhuanlan.zhihu.com/p/26319034',
        title: '猫巴士的设计',
        text: '这篇文章介绍猫巴士的设计。',
        cover: 'https://pic3.zhimg.com/v2-cover_r.jpg',
        stats: { likes: 88, comments: 6, collects: 233 },
      })
      r = await run(['item', 'get', 'pin:2092973041173251769'])
      expect(r.env.data).toMatchObject({
        id: 'pin:2092973041173251769',
        kind: 'image',
        url: 'https://www.zhihu.com/pin/2092973041173251769',
        text: '今天的猫巴士<准点>发车。',
        media: [{ type: 'image', url: 'https://pic3.zhimg.com/50/v2-pin_qhd.jpg', width: 1125, height: 1500 }],
        stats: { likes: 16, comments: 2, shares: 3 },
      })
    })

    it('--raw 输出知乎原始对象', async () => {
      const r = await run(['item', 'get', '1234567890', '--raw'])
      expect(r.env.data).toMatchObject({ id: 1234567890, type: 'answer', voteup_count: 1024 })
    })

    it('item get 传问题 → USAGE，提示 question 命令', async () => {
      const r = await run(['item', 'get', 'https://www.zhihu.com/question/19550225'])
      expect([r.env.error.code, r.code]).toEqual(['USAGE', 2])
      expect(r.env.error.hint).toContain('question get')
      expect(r.calls).toHaveLength(0)
    })

    it('item search：带筛选时 search_source=Filter，后面依次是 vertical、sort、time_interval（不换 Filter 知乎会忽略筛选）', async () => {
      const r = await run(['item', 'search', '猫巴士', '--sort', 'popular', '--time', 'week', '--type', 'article'])
      const u = new URL(r.calls[0]!.url)
      expect(u.pathname).toBe('/api/v4/search_v3')
      expect([...u.searchParams.keys()]).toEqual([
        'gk_version', 't', 'q', 'correction', 'offset', 'limit', 'filter_fields', 'lc_idx', 'show_all_topics', 'search_source', 'vertical', 'sort', 'time_interval',
      ])
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ t: 'general', q: '猫巴士', search_source: 'Filter', vertical: 'article', sort: 'upvoted_count', time_interval: 'a_week' })
      expectSigned(r.calls[0]!)
    })

    it('item search：只输出回答、文章、想法，同一页里重复的去掉；搜索结果带浏览数、收藏数', async () => {
      const r = await run(['item', 'search', '猫巴士'])
      expect(r.env.data.map((x: any) => x.id)).toEqual(['1234567890', 'article:26319034'])
      expect(r.env.data[0].text).toBe('猫巴士是一个命令行工具')
      expect(r.env.data[0].stats).toMatchObject({ views: 54544, likes: 1024, collects: 17 })
    })

    it('item search 翻页：next 指向 api.zhihu.com 时换成网页接口，lc_idx 用 search_action_info 里的（否则翻页会重复）', async () => {
      let r = await run(['item', 'search', '猫巴士'])
      const cursor = r.env.page.cursor as string
      const u = new URL(cursor, 'https://www.zhihu.com')
      expect(u.pathname).toBe('/api/v4/search_v3')
      expect(Object.fromEntries(u.searchParams)).toMatchObject({ offset: '20', lc_idx: '20', search_hash_id: 'fakehash' })
      r = await run(['item', 'search', '猫巴士', '--cursor', cursor])
      expect(r.calls[0]!.url).toBe(`https://www.zhihu.com${cursor}`)
      expectSigned(r.calls[0]!)
    })

    it('默认筛选不带 sort / time_interval / vertical；平台不支持的取值 → UNSUPPORTED', async () => {
      let r = await run(['item', 'search', '猫巴士'])
      const q = new URL(r.calls[0]!.url).searchParams
      expect([q.has('sort'), q.has('time_interval'), q.has('vertical'), q.get('search_source')]).toEqual([false, false, false, 'Normal'])
      r = await run(['item', 'search', '猫巴士', '--sort', 'sales'])
      expect([r.env.error.code, r.code]).toEqual(['UNSUPPORTED', 2])
    })

    it('赞同：回答 POST {"type":"up"}，文章 {"voting":1}，想法 POST / DELETE voters/up；请求体参与签名', async () => {
      let r = await run(['item', 'like', '1234567890'])
      expect(r.env.data).toEqual({ id: '1234567890' })
      expect([r.calls[0]!.method, r.calls[0]!.body]).toEqual(['POST', '{"type":"up"}'])
      expect(header(r.calls[0]!.headers, 'content-type')).toBe('application/json')
      expect(header(r.calls[0]!.headers, 'x-xsrftoken')).toBe(XSRF)
      expectSigned(r.calls[0]!)
      r = await run(['item', 'unlike', '1234567890'])
      expect(r.calls[0]!.body).toBe('{"type":"neutral"}')
      r = await run(['item', 'like', 'https://zhuanlan.zhihu.com/p/26319034'])
      expect(r.env.data).toEqual({ id: 'article:26319034' })
      expect([new URL(r.calls[0]!.url).pathname, r.calls[0]!.body]).toEqual(['/api/v4/articles/26319034/voters', '{"voting":1}'])
      r = await run(['item', 'like', 'pin:2092973041173251769'])
      expect(r.env.data).toEqual({ id: 'pin:2092973041173251769' })
      expect([r.calls[0]!.method, new URL(r.calls[0]!.url).pathname, r.calls[0]!.body]).toEqual(['POST', '/api/v4/pins/2092973041173251769/voters/up', '{"not_sync_moments":true}'])
      expectSigned(r.calls[0]!)
      r = await run(['item', 'unlike', 'https://www.zhihu.com/pin/2092973041173251769'])
      expect([r.calls[0]!.method, r.calls[0]!.body]).toEqual(['DELETE', '{"not_sync_moments":true}'])
    })

    it('没有 _xsrf 时先打开首页拿一个', async () => {
      await login()
      // 换成没有 _xsrf 的凭证
      const mock = mockZhihu({
        '/': () => fakeResponse('<html></html>', { headers: [['set-cookie', '_xsrf=fromhome; Domain=.zhihu.com; Path=/']] }),
      })
      try {
        await cli('zhihu', 'auth', 'login', '-a', 'noxsrf', '--cookie', `d_c0=${DC0}; z_c0=fake`)
        mock.calls.length = 0
        const r = await cli('zhihu', 'item', 'like', '1234567890', '-a', 'noxsrf')
        expect(r.env.ok).toBe(true)
        expect(mock.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /', 'POST /api/v4/answers/1234567890/voters'])
        expect(header(mock.calls[1]!.headers, 'x-xsrftoken')).toBe('fromhome')
      } finally {
        mock.restore()
      }
    })
  })

  describe('question（扩展）', () => {
    it('question get：Question 类型', async () => {
      const r = await run(['question', 'get', 'https://www.zhihu.com/question/19550225'])
      expect(r.env.data).toEqual({
        id: 'question:19550225',
        url: 'https://www.zhihu.com/question/19550225',
        title: '如何评价猫巴士？',
        text: '一个命令开往\n任何平台',
        author: { id: '0', name: '匿名用户', url: null },
        created_at: '2023-11-15T06:13:20+08:00',
        stats: { views: 987654, answers: 321, followers: 4567, comments: 12 },
      })
    })

    it('question answers：feeds 接口，--sort latest → order=updated，翻页用 paging.next', async () => {
      const r = await run(['question', 'answers', 'question:19550225', '--sort', 'latest'])
      const u = new URL(r.calls[0]!.url)
      expect([u.pathname, u.searchParams.get('order'), u.searchParams.get('limit')]).toEqual(['/api/v4/questions/19550225/feeds', 'updated', '5'])
      expect(r.env.data.map((x: any) => [x.id, x.author?.url ?? null])).toEqual([
        ['1234567890', 'https://www.zhihu.com/people/catbus-tester'],
        ['1234567892', null],
      ])
      expect(r.env.page.cursor).toMatch(/^\/api\/v4\/questions\/19550225\/feeds\?cursor=fakecursor123/)
    })
  })

  describe('comment', () => {
    it('一级评论与楼中楼', async () => {
      let r = await run(['comment', 'list', '1234567890'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/comment_v5/answers/1234567890/root_comment')
      expect(r.env.data[0]).toEqual({
        id: '10001',
        item_id: '1234567890',
        parent_id: null,
        author: { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: '猫巴士', url: 'https://www.zhihu.com/people/catbus-tester' },
        text: '好用！ 支持一下',
        created_at: '2026-09-21T22:23:20+08:00',
        stats: { likes: 5, replies: 2 },
      })
      expect(r.env.page).toEqual({ cursor: '/api/v4/comment_v5/answers/1234567890/root_comment?limit=20&offset=fake_offset_2&order_by=score', has_more: true })

      expect(new URL(r.calls[0]!.url).searchParams.get('order_by')).toBe('score')
      r = await run(['comment', 'list', '1234567890', '--sort', 'latest'])
      expect(new URL(r.calls[0]!.url).searchParams.get('order_by')).toBe('ts')

      r = await run(['comment', 'list', 'article:26319034'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/comment_v5/articles/26319034/root_comment')
      expect(r.env.data[0].item_id).toBe('article:26319034')

      r = await run(['comment', 'replies', '1234567890', '10001'])
      expect(r.env.data.map((c: any) => [c.id, c.parent_id])).toEqual([
        ['20001', '10001'],
        ['20002', '20001'],
      ])
    })
  })

  describe('feed / keyword / folder / topic', () => {
    it('推荐、热榜、关注', async () => {
      let r = await run(['feed', 'list'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v3/feed/topstory/recommend')
      expect(r.env.data.map((x: any) => x.id)).toEqual(['1234567890', 'article:26319034'])
      expect(r.env.page.cursor).toContain('page_number=2')

      r = await run(['feed', 'list', '--kind', 'hot'])
      // 现行格式：标题、摘要、配图在 *_area 里，问题 ID 在 card_id / link
      expect(r.env.data[0]).toMatchObject({
        id: 'question:2093427934316814825',
        url: 'https://www.zhihu.com/question/2093427934316814825',
        title: '猫巴士上热榜了？',
        text: '一个命令开往任何平台。',
        cover: 'https://picx.zhimg.com/80/v2-hot_1440w.webp?source=1def8aca',
      })
      // 旧格式：target 上直接带 id、title、excerpt
      expect(r.env.data.slice(1)).toEqual([
        {
          id: 'question:19550225',
          kind: 'text',
          url: 'https://www.zhihu.com/question/19550225',
          title: '如何评价猫巴士？',
          text: '一个命令开往任何平台',
          author: { id: '0', name: '匿名用户', url: null },
          created_at: '2023-11-15T06:13:20+08:00',
          cover: 'https://pic1.zhimg.com/hot_thumb.jpg',
          media: [],
          stats: { views: null, likes: null, comments: 12, collects: null, shares: null },
          price: null,
          status: null,
        },
      ])
      expect(r.env.page).toEqual({ cursor: null, has_more: false })

      r = await run(['feed', 'list', '--kind', 'following'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v3/moments')
      expect(r.env.data.map((x: any) => x.id)).toEqual(['pin:2092973041173251769'])
    })

    it('联想词与热搜', async () => {
      let r = await run(['keyword', 'suggest', '知'])
      expect(new URL(r.calls[0]!.url).searchParams.get('q')).toBe('知')
      expect(r.env.data).toEqual([{ text: '知乎直答', heat: null }])
      r = await run(['keyword', 'hot'])
      expect(r.env.data).toEqual([
        { text: '猫巴士 0.2 发布', heat: null },
        { text: '开往任何平台', heat: null },
      ])
    })

    it('收藏夹列表与内容、话题搜索', async () => {
      let r = await run(['folder', 'list'])
      expect(new URL(r.calls[0]!.url).pathname).toBe('/api/v4/people/catbus-tester/collections')
      expect(r.env.data).toEqual([{ id: '777', name: '命令行工具', count: 5, url: 'https://www.zhihu.com/collection/777' }])
      r = await run(['folder', 'items', 'https://www.zhihu.com/collection/777'])
      expect(r.env.data.map((x: any) => x.id)).toEqual(['1234567890', 'pin:2092973041173251769'])
      expect(r.env.page.cursor).toBe('/api/v4/collections/777/items?offset=20&limit=20')
      r = await run(['topic', 'search', '命令行'])
      expect(new URL(r.calls[0]!.url).searchParams.get('t')).toBe('topic')
      expect(r.env.data).toEqual([{ id: '19550517', name: '命令行', url: 'https://www.zhihu.com/topic/19550517', stats: { views: null, items: 2000 } }])
    })
  })

  describe('错误映射（AGENTS 6.4）', () => {
    it('账号存在但没有 z_c0（或被服务端清掉）：不发请求，直接 AUTH_EXPIRED', async () => {
      await login()
      const path = join(home.dir, 'auth/zhihu/web/default.json')
      const cred = JSON.parse(readFileSync(path, 'utf8'))
      cred.scopes.main.cookies = cred.scopes.main.cookies.filter((c: any) => c.name !== 'z_c0')
      writeFileSync(path, JSON.stringify(cred))
      const mock = mockZhihu()
      try {
        const r = await cli('zhihu', 'user', 'get', 'me')
        expect([r.env.error.code, r.code, r.env.error.hint]).toEqual(['AUTH_EXPIRED', 3, 'catbus zhihu auth login -a default'])
        expect(mock.calls).toHaveLength(0)
      } finally {
        mock.restore()
      }
    })

    const error = (status: number, body: object): Record<string, Route> => ({ '/api/v4/answers/1234567890': () => fakeResponse(body, { status }) })

    it('登录墙 → AUTH_EXPIRED，退出码 3，hint 是重新登录', async () => {
      const r = await run(['item', 'get', '1234567890'], error(403, { error: { need_login: true, code: 40353, message: '请您登录后查看更多专业优质内容。' } }))
      expect([r.env.error.code, r.code, r.env.error.hint]).toEqual(['AUTH_EXPIRED', 3, 'catbus zhihu auth login -a default'])
    })

    it('人机验证 40352 → RISK_CONTROL captcha，带验证链接；40362 → blocked；429 → rate_limit', async () => {
      const verify = 'https://www.zhihu.com/account/unhuman?type=S6E3V1&need_login=true'
      let r = await run(['item', 'get', '1234567890'], error(403, { error: { need_login: true, redirect: verify, code: 40352, message: '系统监测到您的网络环境存在异常' } }))
      expect([r.env.error.code, r.code, r.env.error.detail.kind, r.env.error.detail.verify_url]).toEqual(['RISK_CONTROL', 5, 'captcha', verify])
      r = await run(['item', 'get', '1234567890'], error(403, { error: { code: 40362, message: '您当前请求存在异常' } }))
      expect([r.env.error.code, r.env.error.detail.kind]).toEqual(['RISK_CONTROL', 'blocked'])
      r = await run(['item', 'get', '1234567890'], { '/api/v4/answers/1234567890': () => fakeResponse('Too Many Requests', { status: 429 }) })
      expect([r.env.error.code, r.env.error.detail.kind]).toEqual(['RISK_CONTROL', 'rate_limit'])
    })

    it('签名被拒 10003 → UPSTREAM，退出码 7；404 → UPSTREAM', async () => {
      let r = await run(['item', 'get', '1234567890'], error(403, { error: { code: 10003, message: '请求参数异常，请升级客户端后重试。' } }))
      expect([r.env.error.code, r.code, r.env.error.detail.code]).toEqual(['UPSTREAM', 7, 10003])
      r = await run(['item', 'get', '1234567890'], error(404, { error: { code: 404, message: '回答不存在' } }))
      expect([r.env.error.code, r.env.error.message]).toEqual(['UPSTREAM', '回答不存在'])
    })
  })
})
