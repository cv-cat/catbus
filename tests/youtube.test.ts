import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestError } from 'wreq-js'
import { CookieJar } from '../src/core/cookies.js'
import { fakeResponse, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { decode, int, str } from '../src/core/pb.js'
import * as rand from '../src/core/rand.js'
import youtube from '../src/platforms/youtube/index.js'
import { browser, findChrome, type OpenOptions } from '../src/platforms/youtube/web/browser.js'
import { count, relTime } from '../src/platforms/youtube/web/normalize.js'
import { cookieKey, syncCookies } from '../src/platforms/youtube/web/publish.js'
import type { Cookie } from '../src/core/schemas.js'
import {
  commentAction,
  createCommentParams,
  createReplyParams,
  playlistId,
  repliesToken,
  searchParams,
  videoId,
} from '../src/platforms/youtube/web/resolve.js'
import { cli, useTempHome } from './helpers.js'

// fixture 是 2026-10-24 游客态真实响应的裁剪（tests/fixtures/youtube），账号相关的响应用假数据
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/youtube', name), 'utf8')
const json = (name: string) => JSON.parse(fixture(`${name}.json`))

const HOME = `<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"2.20261023.01.00","VISITOR_DATA":"CgtGYWtlVmlzaXRvcg%3D%3D"});</script>`
const SAPISID = 'fake-sapisid/AbCdEf'
const COOKIE = `SID=fake-sid; HSID=fake-hsid; SSID=fake-ssid; APISID=fake-apisid; SAPISID=${SAPISID}; __Secure-3PAPISID=${SAPISID}; __Secure-3PSID=fake-3psid`
const ME = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const ACCOUNT_MENU = {
  actions: [
    {
      openPopupAction: {
        popup: {
          multiPageMenuRenderer: {
            header: { activeAccountHeaderRenderer: { accountName: { simpleText: 'Test User' }, channelHandle: { simpleText: '@testuser' } } },
            sections: [{ multiPageMenuSectionRenderer: { items: [{ compactLinkRenderer: { navigationEndpoint: { browseEndpoint: { browseId: ME } } } }] } }],
          },
        },
      },
    },
  ],
}

interface Call {
  path: string
  body: any
  headers: [string, string][]
  cookies: [string, string][]
}

type Route = (body: any, p: PreparedRequest) => HttpResponse | object | string

/** InnerTube 按路径分发；body 是解析后的 JSON 请求体。没录制的请求直接报错，测试默认不联网。 */
function mockYt(routes: Record<string, Route>) {
  const calls: Call[] = []
  const restore = mockSender((p) => {
    const u = new URL(p.url)
    const path = (u.hostname.startsWith('studio.') ? 'studio:' : '') + (u.hostname.startsWith('suggestqueries') ? 'suggest' : u.pathname.replace(/^\/youtubei\/v1\//, ''))
    const body = typeof p.body === 'string' && p.body ? JSON.parse(p.body) : null
    calls.push({ path, body, headers: p.headers, cookies: p.cookies })
    const route = path === '/' ? () => fakeResponse(HOME, { headers: [['content-type', 'text/html']] }) : routes[path]
    if (!route) throw new Error(`未录制的请求：${path}`)
    const out = route(body, p)
    return out instanceof Response ? (out as unknown as HttpResponse) : fakeResponse(out as object, { headers: [['content-type', 'application/json']] })
  })
  return { calls, restore }
}

async function withYt<T>(routes: Record<string, Route>, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const { calls, restore } = mockYt(routes)
  try {
    return await fn(calls)
  } finally {
    restore()
  }
}

async function login() {
  await withYt({ 'account/account_menu': () => ACCOUNT_MENU }, async () => {
    const r = await cli('youtube', 'auth', 'login', '--cookie', COOKIE)
    expect(r.code).toBe(0)
  })
}

describe('youtube 平台（web）', () => {
  const home = useTempHome()
  let restoreClock: () => void
  beforeEach(() => {
    restoreClock = rand.deterministic({ now: new Date('2026-10-24T12:00:00Z').getTime() })
  })
  afterEach(() => restoreClock())

  it('注册表：web 端支持游客态，读取命令免登录，账号操作需要登录', () => {
    const web = youtube.endpoints.web as Exclude<typeof youtube.endpoints.web, 'planned'>
    expect(web.guest).toBe(true)
    const auth = (k: string) => web.commands.get(k)!.auth
    for (const k of ['item get', 'item search', 'comment list', 'user get', 'series items', 'live listen', 'keyword suggest']) expect([k, auth(k)]).toEqual([k, 'optional'])
    for (const k of ['item like', 'user follow', 'comment add', 'comment delete', 'feed list', 'history list', 'notice list']) expect([k, auth(k)]).toEqual([k, 'required'])
  })

  describe('参数解析', () => {
    it('视频：ID 与各种链接', () => {
      for (const s of [
        'dQw4w9WgXcQ',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1',
        'youtu.be/dQw4w9WgXcQ',
        'https://m.youtube.com/shorts/dQw4w9WgXcQ',
        'https://www.youtube.com/live/dQw4w9WgXcQ?si=x',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      ]) {
        expect(videoId(s)).toBe('dQw4w9WgXcQ')
      }
      expect(() => videoId('https://example.com/watch?v=dQw4w9WgXcQ')).toThrow(/无法识别的视频/)
    })

    it('播放列表：ID、VL 前缀、带 list= 的链接', () => {
      expect(playlistId('PLaklDK5Yxuss')).toBe('PLaklDK5Yxuss')
      expect(playlistId('VLPLaklDK5Yxuss')).toBe('PLaklDK5Yxuss')
      expect(playlistId('https://www.youtube.com/watch?v=jICmkF585LA&list=PLaklDK5Yxuss')).toBe('PLaklDK5Yxuss')
      expect(() => playlistId('hello')).toThrow(/无法识别的播放列表/)
    })

    it('计数、相对时间', () => {
      expect(count('58,288,881 views')).toBe(58288881)
      expect(count('15.8M subscribers')).toBe(15800000)
      expect(count('1.8B views')).toBe(1800000000)
      expect(count('105K')).toBe(105000)
      expect(count('No views')).toBe(0)
      expect(relTime('4 years ago')).toBe(relTime('Streamed 4 years ago'))
      expect(relTime('6y ago')).toBe(relTime('6 years ago'))
      expect(relTime('3 days ago')).toBe('2026-10-21T20:00:00+08:00')
      expect(relTime('Premieres tomorrow')).toBeNull()
    })
  })

  describe('protobuf 参数与页面里的一致', () => {
    it('搜索筛选与搜索页筛选菜单的 params 相同', () => {
      // 2026-10-24 搜索页筛选菜单里的值
      expect(searchParams({ type: 'video' })).toBe('EgIQAQ==')
      expect(searchParams({ type: 'channel' })).toBe('EgIQAg==')
      expect(searchParams({ time: 'week' })).toBe('EgIIAw==')
      expect(searchParams({ live: true })).toBe('EgJAAQ==')
      expect(searchParams({ sort: 'popular' })).toBe('CAM=')
      expect(searchParams({})).toBeUndefined()
      expect(searchParams({ time: 'all', sort: 'general' })).toBeUndefined()
    })

    it('回复的 continuation 与「查看回复」按钮里的 token 逐字节相同', () => {
      const comments = json('comments')
      const thread = comments.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems[0].commentThreadRenderer
      const token = thread.replies.commentRepliesRenderer.contents[0].continuationItemRenderer.continuationEndpoint.continuationCommand.token
      const id = thread.commentViewModel.commentViewModel.commentId
      expect(repliesToken('dQw4w9WgXcQ', id, 'UCuAXFkgsw1L7xaCfnd5JJOw')).toBe(token)
    })

    it('评论框、回复框的参数与评论 action 与页面里的相同（URL 安全的 base64）', () => {
      // 2026-10-24 登录后评论区里的值
      expect(createCommentParams('dQw4w9WgXcQ')).toBe('EgtkUXc0dzlXZ1hjUSoCCABQB-gCAagDAA==')
      expect(createReplyParams('dQw4w9WgXcQ', 'UgwPwTibxdgqCHZxktd4AaABAg')).toBe(
        'EgtkUXc0dzlXZ1hjUSIaVWd3UHdUaWJ4ZGdxQ0haeGt0ZDRBYUFCQWcqAggAUAfYAQDoAQDaAgDoAgGoAwA=',
      )
      expect(commentAction('like', 'dQw4w9WgXcQ', 'UgwPwTibxdgqCHZxktd4AaABAg', 'UCuAXFkgsw1L7xaCfnd5JJOw')).toBe(
        'CAUQAhoaVWd3UHdUaWJ4ZGdxQ0haeGt0ZDRBYUFCQWcqC2RRdzR3OVdnWGNRMAA4AKgBDLoBGFVDdUFYRmtnc3cxTDd4YUNmbmQ1SkpPd_ABAPgCAbADAMADAsgDAA==',
      )
      const del = decode(Buffer.from(commentAction('delete', 'dQw4w9WgXcQ', 'Ugabc', 'UCuAXFkgsw1L7xaCfnd5JJOw'), 'base64url'))
      expect([int(del, 1), str(del, 3), str(del, 5), del.has(7), del.has(56)]).toEqual([6, 'Ugabc', 'dQw4w9WgXcQ', false, false])
      const unlike = decode(Buffer.from(commentAction('unlike', 'v', 'c', 'UC'), 'base64url'))
      expect(int(unlike, 7)).toBe(1)
    })
  })

  describe('游客读取', () => {
    it('item search：信封为游客态，视频、作者、播放量、翻页 cursor；搜索页的 Shorts 也算视频', async () => {
      const r = await withYt({ search: () => json('search') }, async (calls) => {
        const r = await cli('youtube', 'item', 'search', 'lofi', '--sort', 'popular', '--time', 'week')
        expect(calls.at(-1)!.body).toMatchObject({ query: 'lofi', params: searchParams({ sort: 'popular', time: 'week' }), context: { client: { clientName: 'WEB', hl: 'en' } } })
        expect(calls.at(-1)!.cookies.map(([k]) => k)).not.toContain('SAPISID')
        return r
      })
      expect(r.code).toBe(0)
      expect(r.env).toMatchObject({ ok: true, platform: 'youtube', account: 'guest', page: { has_more: true } })
      const sections = json('search').contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents
      expect(r.env.page.cursor).toBe(sections.at(-1).continuationItemRenderer.continuationEndpoint.continuationCommand.token)
      const [live, normal, short] = r.env.data
      expect(live).toMatchObject({ kind: 'video', author: { id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl' } })
      expect(normal.stats.views).toBeGreaterThan(1_000_000)
      expect(normal.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(short.url).toMatch(/\/shorts\//)
      expect(r.stderr).toContain('未登录 youtube')
    })

    it('item search：多人合作的视频署名是「Collaborators」列表，author 取第一个（上传者）', async () => {
      // 2026-10-24 搜索 podcast 时遇到的结构（裁剪）
      const collab = {
        videoId: 'collabVideo1',
        title: { runs: [{ text: 'Collab' }] },
        ownerText: { runs: [{ text: 'A and B', navigationEndpoint: { showDialogCommand: { panelLoadingStrategy: { inlineContent: { dialogViewModel: { customContent: { listViewModel: { listItems: [
          { listItemViewModel: { title: { content: 'Channel A' }, rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UCaaaaaaaaaaaaaaaaaaaaaa' } } } } } } },
          { listItemViewModel: { title: { content: 'Channel B' }, rendererContext: { commandContext: { onTap: { innertubeCommand: { browseEndpoint: { browseId: 'UCbbbbbbbbbbbbbbbbbbbbbb' } } } } } } },
        ] } } } } } } } }] },
      }
      const res = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ videoRenderer: collab }] } }] } } } } }
      const r = await withYt({ search: () => res }, () => cli('youtube', 'item', 'search', 'podcast'))
      expect(r.env.data[0].author).toEqual({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Channel A', url: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa' })
    })

    it('item search：按上传时间排序已下线，--sort latest 报 UNSUPPORTED', async () => {
      const r = await cli('youtube', 'item', 'search', 'lofi', '--sort', 'latest')
      expect(r.code).toBe(2)
      expect(r.env.error.code).toBe('UNSUPPORTED')
    })

    it('item get：player 给详情、精确发布时间与点赞数，next 给评论数', async () => {
      const r = await withYt({ player: () => json('player'), next: () => json('next') }, () => cli('youtube', 'item', 'get', 'https://youtu.be/dQw4w9WgXcQ'))
      expect(r.env.data).toMatchObject({
        id: 'dQw4w9WgXcQ',
        kind: 'video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        author: { id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Rick Astley' },
        created_at: '2009-10-25T14:57:33+08:00',
      })
      expect(r.env.data.stats.views).toBeGreaterThan(1e9)
      expect(r.env.data.stats.likes).toBeGreaterThan(1e7)
      expect(r.env.data.stats.comments).toBeGreaterThan(1e6)
    })

    it('item get：player 被人机验证拦下时，用 watch 页的数据兜底（日期精确到天、点赞数取自按钮）', async () => {
      const bot = { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }
      const r = await withYt({ player: () => bot, next: () => json('next') }, () => cli('youtube', 'item', 'get', 'dQw4w9WgXcQ'))
      expect(r.env.data).toMatchObject({ id: 'dQw4w9WgXcQ', author: { id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Rick Astley' }, created_at: '2009-10-24T08:00:00+08:00' })
      expect(r.env.data.title).toContain('Never Gonna Give You Up')
      expect(r.env.data.stats.views).toBeGreaterThan(1e9)
      expect(r.env.data.stats.likes).toBeGreaterThan(1e7)
      expect(r.env.data.text).toBeTruthy()
      expect(r.stderr).toContain('人机验证')
    })

    it('item get：视频不可用时报 UPSTREAM，带上 playabilityStatus', async () => {
      const r = await withYt(
        { player: () => ({ playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } }), next: () => ({}) },
        () => cli('youtube', 'item', 'get', 'aaaaaaaaaaa'),
      )
      expect(r.code).toBe(7)
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '视频不可用：Video unavailable', detail: { status: 'ERROR' } })
    })

    it('item related：只取右侧推荐，翻页 token 是推荐列表末尾的', async () => {
      const r = await withYt({ next: () => json('next') }, () => cli('youtube', 'item', 'related', 'dQw4w9WgXcQ'))
      expect(r.env.data).toHaveLength(2)
      expect(r.env.data[0].author.id).toMatch(/^UC/)
      const related = json('next').contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results
      expect(r.env.page.cursor).toBe(related.at(-1).continuationItemRenderer.continuationEndpoint.continuationCommand.token)
    })

    it('comment list：先取 watch 页的评论入口，再取评论；翻页 token 不是评论里「查看回复」的', async () => {
      const r = await withYt({ next: (b) => (b.videoId ? json('next') : json('comments')) }, async (calls) => {
        const r = await cli('youtube', 'comment', 'list', 'dQw4w9WgXcQ')
        expect(calls.filter((c) => c.path === 'next').map((c) => Object.keys(c.body).filter((k) => k !== 'context'))).toEqual([['videoId'], ['continuation']])
        return r
      })
      expect(r.env.data).toHaveLength(2)
      expect(r.env.data[0]).toMatchObject({ item_id: 'dQw4w9WgXcQ', parent_id: null })
      expect(r.env.data[0].stats.likes).toBeGreaterThan(1000)
      expect(r.env.data[0].stats.replies).toBeGreaterThan(0)
      const comments = json('comments')
      const items = comments.onResponseReceivedEndpoints[0].reloadContinuationItemsCommand.continuationItems
      expect(r.env.page.cursor).toBe(items.at(-1).continuationItemRenderer.continuationEndpoint.continuationCommand.token)
    })

    it('comment replies：自己拼回复 token；回复的 parent_id 是根评论', async () => {
      const root = 'UgzKYksqeQ5gA3t0g0F4AaABAg'
      // 视频所属频道取自 watch 页（不调 player），再拼回复 token
      const r = await withYt({ next: (b) => (b.videoId ? json('next') : json('replies')) }, async (calls) => {
        const r = await cli('youtube', 'comment', 'replies', 'dQw4w9WgXcQ', root)
        expect(calls.map((c) => c.path)).not.toContain('player')
        expect(calls.find((c) => c.path === 'next' && c.body.continuation)!.body.continuation).toBe(repliesToken('dQw4w9WgXcQ', root, 'UCuAXFkgsw1L7xaCfnd5JJOw'))
        return r
      })
      expect(r.env.data[0]).toMatchObject({ parent_id: root })
      expect(r.env.data[0].id.startsWith(`${root}.`)).toBe(true)
      const items = json('replies').onResponseReceivedEndpoints[0].appendContinuationItemsAction.continuationItems
      expect(r.env.page.cursor).toBe(items.at(-1).continuationItemRenderer.button.buttonRenderer.command.continuationCommand.token)
      const nested = await cli('youtube', 'comment', 'replies', 'dQw4w9WgXcQ', `${root}.xyz`)
      expect(nested.env.error).toMatchObject({ code: 'USAGE', hint: `根评论 ID 是 ${root}` })
    })

    it('user get：@handle 先 resolve_url 再 browse；订阅数、视频数、@handle', async () => {
      const r = await withYt({ 'navigation/resolve_url': () => json('resolve_handle'), browse: () => json('channel') }, async (calls) => {
        const r = await cli('youtube', 'user', 'get', '@LofiGirl')
        expect(calls.find((c) => c.path === 'navigation/resolve_url')!.body.url).toBe('https://www.youtube.com/@LofiGirl')
        expect(calls.find((c) => c.path === 'browse')!.body.browseId).toBe('UCSJ4gkVC6NrvII8umztf0Ow')
        return r
      })
      expect(r.env.data).toMatchObject({ id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl', handle: '@LofiGirl', url: 'https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow' })
      expect(r.env.data.stats.followers).toBeGreaterThan(1e7)
      expect(r.env.data.stats.items).toBeGreaterThan(100)
    })

    it('user get：不存在的 @handle 报「找不到频道」', async () => {
      const r = await withYt(
        { 'navigation/resolve_url': () => fakeResponse({ error: { code: 404, message: 'Requested entity was not found.' } }, { status: 404 }) },
        () => cli('youtube', 'user', 'get', '@no_such_handle_zz'),
      )
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '找不到频道：@no_such_handle_zz' })
    })

    it('user search：频道搜索的筛选，订阅数取自 videoCountText（新版页面放错了位置）', async () => {
      const r = await withYt({ search: () => json('search_channel') }, async (calls) => {
        const r = await cli('youtube', 'user', 'search', 'lofi')
        expect(calls.at(-1)!.body.params).toBe('EgIQAg==')
        return r
      })
      expect(r.env.data[0]).toMatchObject({ id: 'UCSJ4gkVC6NrvII8umztf0Ow', handle: '@LofiGirl' })
      expect(r.env.data[0].stats.followers).toBeGreaterThan(1e7)
    })

    it('user items：频道视频 tab；翻页 token 取视频列表末尾的，不取排序 chip 的', async () => {
      const r = await withYt({ browse: () => json('channel_videos') }, async (calls) => {
        const r = await cli('youtube', 'user', 'items', 'UCSJ4gkVC6NrvII8umztf0Ow')
        expect(calls.at(-1)!.body).toMatchObject({ browseId: 'UCSJ4gkVC6NrvII8umztf0Ow', params: 'EgZ2aWRlb3PyBgQKAjoA' })
        return r
      })
      const grid = json('channel_videos').contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents
      expect(r.env.data).toHaveLength(3)
      expect(r.env.data[0].author).toMatchObject({ id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl' })
      const cursor = JSON.parse(Buffer.from(r.env.page.cursor, 'base64url').toString('utf8'))
      expect(cursor).toEqual({ t: grid.at(-1).continuationItemRenderer.continuationEndpoint.continuationCommand.token, c: 'UCSJ4gkVC6NrvII8umztf0Ow', n: 'Lofi Girl' })
    })

    it('series list / items：频道的播放列表；播放列表翻页用新版 continuationItemViewModel', async () => {
      const list = await withYt({ browse: () => json('channel_playlists') }, () => cli('youtube', 'series', 'list', 'UCSJ4gkVC6NrvII8umztf0Ow'))
      expect(list.env.data[0]).toMatchObject({ id: 'PLaklDK5Yxuss', url: 'https://www.youtube.com/playlist?list=PLaklDK5Yxuss' })
      expect(list.env.data[0].count).toBeGreaterThan(0)
      const items = await withYt({ browse: () => json('playlist') }, async (calls) => {
        const r = await cli('youtube', 'series', 'items', 'https://www.youtube.com/playlist?list=PLaklDK5Yxuss')
        expect(calls.at(-1)!.body.browseId).toBe('VLPLaklDK5Yxuss')
        return r
      })
      expect(items.env.data).toHaveLength(2)
      expect(items.env.page.has_more).toBe(true)
    })

    it('keyword suggest：剥掉 JSONP 外壳', async () => {
      const r = await withYt({ suggest: () => fakeResponse(fixture('suggest.txt')) }, () => cli('youtube', 'keyword', 'suggest', 'lofi'))
      expect(r.env.data[0]).toEqual({ text: 'lofi', heat: null })
      expect(r.env.data.length).toBeGreaterThan(5)
    })

    it('live get / history：在看人数、聊天消息；不在直播的视频报错', async () => {
      const routes = { player: () => ({ videoDetails: { videoId: 'liveVideo01', title: 'Live', channelId: 'UCSJ4gkVC6NrvII8umztf0Ow', author: 'Lofi Girl', isLive: true } }), next: () => json('live_next'), 'live_chat/get_live_chat': () => json('live_chat') }
      // live get 只用 watch 页，不调 player
      const room = await withYt(routes, async (calls) => {
        const r = await cli('youtube', 'live', 'get', 'liveVideo01')
        expect(calls.map((c) => c.path)).not.toContain('player')
        return r
      })
      expect(room.env.data).toMatchObject({ id: 'liveVideo01', status: 'live', host: { id: expect.stringMatching(/^UC/) } })
      expect(room.env.data.title).toBeTruthy()
      expect(room.env.data.stats.viewers).toBeGreaterThan(0)
      const history = await withYt(routes, async (calls) => {
        const r = await cli('youtube', 'live', 'history', 'liveVideo01')
        // 先用 watch 页的默认 token（Top chat），再切到响应头视图菜单里的「Live chat」（全部消息）
        const first = json('live_next').contents.twoColumnWatchNextResults.conversationBar.liveChatRenderer.continuations[0].reloadContinuationData.continuation
        const views = json('live_chat').continuationContents.liveChatContinuation.header.liveChatHeaderRenderer.viewSelector.sortFilterSubMenuRenderer.subMenuItems
        const all = views.find((v: any) => v.title === 'Live chat')
        expect(calls.filter((c) => c.path === 'live_chat/get_live_chat').map((c) => c.body.continuation)).toEqual([first, all.continuation.reloadContinuationData.continuation])
        return r
      })
      expect(history.env.data).toHaveLength(2)
      expect(history.env.data[0]).toMatchObject({ type: 'chat', gift: null })
      expect(history.env.data[0].user.id).toMatch(/^UC/)
      const offline = await withYt({ next: () => json('next') }, () => cli('youtube', 'live', 'history', 'dQw4w9WgXcQ'))
      expect(offline.env.error.message).toContain('没有直播聊天')
    })
  })

  describe('媒体', () => {
    const vr = {
      playabilityStatus: { status: 'OK' },
      videoDetails: { videoId: 'dQw4w9WgXcQ', lengthSeconds: '213' },
      streamingData: {
        formats: [{ itag: 18, url: 'https://media.example/18', mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', width: 640, height: 360 }],
        adaptiveFormats: [
          { itag: 137, url: 'https://media.example/137', mimeType: 'video/mp4; codecs="avc1.640028"', width: 1920, height: 1080, bitrate: 4000000 },
          { itag: 248, url: 'https://media.example/248', mimeType: 'video/webm; codecs="vp9"', width: 1920, height: 1080, bitrate: 5000000 },
          { itag: 140, url: 'https://media.example/140', mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, approxDurationMs: '213061' },
          { itag: 251, url: 'https://media.example/251', mimeType: 'audio/webm; codecs="opus"', bitrate: 140000 },
        ],
      },
    }

    it('item media：VISIONOS 客户端、不带 cookie；同高度优先 mp4，音频优先 m4a', async () => {
      await login()
      const r = await withYt({ player: () => vr }, async (calls) => {
        const r = await cli('youtube', 'item', 'media', 'dQw4w9WgXcQ')
        const call = calls.find((c) => c.path === 'player')!
        expect(call.body.context.client.clientName).toBe('VISIONOS')
        expect(call.headers).toContainEqual(['X-Youtube-Client-Name', '101'])
        expect(call.cookies).toEqual([])
        expect(call.headers.map(([k]) => k)).not.toContain('Authorization')
        return r
      })
      expect(r.env.data.map((m: any) => [m.id, m.type, m.height])).toEqual([
        ['137', 'video', 1080],
        ['140', 'audio', null],
      ])
      expect(r.env.data[1].duration).toBeCloseTo(213.061)
    })

    it('item download：按 10 MB 一段用 range 参数分段下载，拼成一个文件（整文件 GET 会被 googlevideo 拒绝）', async () => {
      const MB = 1024 * 1024
      const vr2 = {
        playabilityStatus: { status: 'OK' },
        streamingData: {
          adaptiveFormats: [
            { itag: 137, url: 'https://media.example/v?id=1', mimeType: 'video/mp4; codecs="avc1"', height: 1080, contentLength: String(25 * MB) },
            { itag: 140, url: 'https://media.example/a?id=2', mimeType: 'audio/mp4; codecs="mp4a"', contentLength: '5' },
          ],
        },
      }
      const ranges: string[] = []
      const media = (_: unknown, p: PreparedRequest) => {
        const u = new URL(p.url)
        const range = u.searchParams.get('range')!
        ranges.push(`${u.pathname}:${range}`)
        return fakeResponse(`[${range}]`)
      }
      const dir = join(home.dir, 'dl')
      const r = await withYt({ player: () => vr2, '/v': media, '/a': media }, () => cli('youtube', 'item', 'download', 'dQw4w9WgXcQ', '--dir', dir))
      expect(r.env.ok).toBe(true)
      expect(ranges).toEqual([`/v:0-${10 * MB - 1}`, `/v:${10 * MB}-${20 * MB - 1}`, `/v:${20 * MB}-${25 * MB - 1}`, '/a:0-4'])
      expect(readFileSync(join(dir, 'youtube_dQw4w9WgXcQ_1.mp4'), 'utf8')).toBe(`[0-${10 * MB - 1}][${10 * MB}-${20 * MB - 1}][${20 * MB}-${25 * MB - 1}]`)
      expect(r.env.data.map((f: any) => basename(f.path))).toEqual(['youtube_dQw4w9WgXcQ_1.mp4', 'youtube_dQw4w9WgXcQ_2.m4a'])
    })

    it('item media：人机验证报 RISK_CONTROL', async () => {
      const r = await withYt(
        { player: () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }) },
        () => cli('youtube', 'item', 'media', 'dQw4w9WgXcQ'),
      )
      expect(r.code).toBe(5)
      expect(r.env.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
    })
  })

  describe('登录与账号', () => {
    it('auth login：cookie 里没有 SAPISID 报 USAGE', async () => {
      const r = await cli('youtube', 'auth', 'login', '--cookie', 'SID=x; HSID=y')
      expect(r.env.error).toMatchObject({ code: 'USAGE' })
      expect(r.env.error.message).toContain('SAPISID')
    })

    it('auth login：头像菜单校验后落盘；请求带 SAPISIDHASH 签名', async () => {
      const r = await withYt({ 'account/account_menu': () => ACCOUNT_MENU }, async (calls) => {
        const r = await cli('youtube', 'auth', 'login', '--cookie', COOKIE)
        const auth = new Map(calls.find((c) => c.path === 'account/account_menu')!.headers).get('Authorization')!
        const ts = String(rand.nowSeconds())
        const hash = createHash('sha1').update(`${ts} ${SAPISID} https://www.youtube.com`).digest('hex')
        expect(auth).toBe(`SAPISIDHASH ${ts}_${hash} SAPISID3PHASH ${ts}_${hash}`)
        return r
      })
      expect(r.env.data).toMatchObject({ account: 'default', current: true, method: 'cookie', user: { id: ME, name: 'Test User' } })
    })

    it('没有频道的账号：ID 用账号列表里的 obfuscatedGaiaId', async () => {
      const menu = { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: { accountName: { simpleText: 'No Channel' } } } } } } }] }
      const accounts = { contents: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: { isSelected: true, serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ accountStateToken: { hasChannel: false, obfuscatedGaiaId: '123456789012345678901' } }] } } } }] } }] } }] }
      const r = await withYt({ 'account/account_menu': () => menu, 'account/accounts_list': () => accounts }, () => cli('youtube', 'auth', 'login', '-a', 'nochannel', '--cookie', COOKIE))
      expect(r.env.data.user).toEqual({ id: '123456789012345678901', name: 'No Channel', url: null })
    })

    it('多账号：-a 选账号；只能看自己的列表时别人的报 UNSUPPORTED；游客做写操作报 AUTH_REQUIRED', async () => {
      await login()
      const likes = await withYt({ browse: (b) => (expect(b.browseId).toBe('VLLL'), json('playlist')) }, () => cli('youtube', 'user', 'likes', '-a', 'default'))
      expect(likes.env).toMatchObject({ ok: true, account: 'default' })
      const other = await cli('youtube', 'user', 'likes', '@LofiGirl')
      expect(other.env.error).toMatchObject({ code: 'UNSUPPORTED', hint: 'catbus youtube user likes me' })
      const guest = await cli('youtube', 'item', 'like', 'dQw4w9WgXcQ', '-a', 'guest')
      expect(guest.code).toBe(3)
      expect(guest.env.error.code).toBe('AUTH_REQUIRED')
    })
  })

  describe('审查补充', () => {
    it('读取类请求网络出错时重试一次；写操作不重试', async () => {
      const { RequestError } = await import('wreq-js')
      let searches = 0
      const r = await withYt(
        { search: () => (++searches === 1 ? (() => { throw new RequestError('connection reset') })() : json('search')) },
        () => cli('youtube', 'item', 'search', 'lofi'),
      )
      expect([r.env.ok, searches]).toEqual([true, 2])
      await login()
      let likes = 0
      const w = await withYt({ 'like/like': () => (++likes, (() => { throw new RequestError('connection reset') })()) }, () => cli('youtube', 'item', 'like', 'dQw4w9WgXcQ'))
      expect([w.env.error.code, likes]).toEqual(['NETWORK', 1])
    })

    it('auth status：在线校验；cookie 失效（401）时为 logged_in false，不报错', async () => {
      await login()
      const ok = await withYt({ 'account/account_menu': () => ACCOUNT_MENU }, () => cli('youtube', 'auth', 'status'))
      expect(ok.env.data).toMatchObject({ logged_in: true, method: 'cookie', user: { id: ME } })
      const expired = await withYt(
        { 'account/account_menu': () => fakeResponse({ error: { code: 401, message: 'Request is missing required authentication credential.' } }, { status: 401 }) },
        () => cli('youtube', 'auth', 'status'),
      )
      expect(expired.code).toBe(0)
      expect(expired.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
    })

    it('cookie 失效时需要登录的页面回 200 + 空内容（logged_in=0）：报 AUTH_EXPIRED，不返回空列表', async () => {
      await login()
      // 2026-10-24 真机：cookie 被浏览器轮换后，FEwhat_to_watch / FEhistory 都这样返回
      const out = { responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: '0' }] }] }, contents: {} }
      const r = await withYt({ browse: () => out }, () => cli('youtube', 'feed', 'list'))
      expect(r.code).toBe(3)
      expect(r.env.error.code).toBe('AUTH_EXPIRED')
      const status = await withYt({ 'account/account_menu': () => out }, () => cli('youtube', 'auth', 'status'))
      expect(status.env.data.logged_in).toBe(false)
      // 游客请求本来就是 logged_in=0，不算失效
      const guest = await withYt({ search: () => ({ ...json('search'), ...out }) }, () => cli('youtube', 'item', 'search', 'lofi', '-a', 'guest'))
      expect(guest.env.ok).toBe(true)
    })

    it('feed list / history list：--kind 对应的 browse 页', async () => {
      await login()
      await withYt({ browse: () => json('playlist') }, async (calls) => {
        await cli('youtube', 'feed', 'list')
        await cli('youtube', 'feed', 'list', '--kind', 'following')
        await cli('youtube', 'history', 'list')
        expect(calls.filter((c) => c.path === 'browse').map((c) => c.body.browseId)).toEqual(['FEwhat_to_watch', 'FEsubscriptions', 'FEhistory'])
      })
      const hot = await cli('youtube', 'feed', 'list', '--kind', 'hot')
      expect(hot.env.error.code).toBe('UNSUPPORTED')
    })

    it('notice list：翻页 token 是 getNotificationMenuEndpoint.ctoken，续页按 ctoken 请求', async () => {
      await login()
      const menu = {
        actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { sections: [{ multiPageMenuNotificationSectionRenderer: { items: [
          { notificationRenderer: { notificationId: '1', shortMessage: { simpleText: 'Lofi Girl uploaded: new video' }, sentTimeText: { simpleText: '2 hours ago' }, navigationEndpoint: { watchEndpoint: { videoId: 'dQw4w9WgXcQ' } } } },
          { notificationRenderer: { notificationId: '2', shortMessage: { simpleText: 'Someone replied to your comment' }, sentTimeText: { simpleText: '1 day ago' } } },
          { continuationItemRenderer: { continuationEndpoint: { getNotificationMenuEndpoint: { ctoken: 'NOTICE_NEXT' } } } },
        ] } }] } } } }],
      }
      await withYt({ 'notification/get_notification_menu': (b) => (b.ctoken ? { actions: [] } : menu) }, async (calls) => {
        const r = await cli('youtube', 'notice', 'list', '--limit', '5')
        expect(r.env.data.map((x: any) => [x.id, x.type, x.target?.id ?? null])).toEqual([
          ['1', 'system', 'dQw4w9WgXcQ'],
          ['2', 'comment', null],
        ])
        expect(calls.filter((c) => c.path.startsWith('notification')).map((c) => c.body.ctoken ?? null)).toEqual([null, 'NOTICE_NEXT'])
      })
    })

    it('user items：续页没有频道 metadata，author 来自 cursor 里带的频道', async () => {
      const grid = json('channel_videos').contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents
      const more = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: grid.slice(0, 2) } }] }
      const r = await withYt({ browse: (b) => (b.continuation ? more : json('channel_videos')) }, async (calls) => {
        const r = await cli('youtube', 'user', 'items', 'UCSJ4gkVC6NrvII8umztf0Ow', '--limit', '5')
        expect(calls.filter((c) => c.path === 'browse').at(-1)!.body.continuation).toBe(grid.at(-1).continuationItemRenderer.continuationEndpoint.continuationCommand.token)
        return r
      })
      expect(r.env.data).toHaveLength(5)
      for (const it of r.env.data) expect(it.author).toMatchObject({ id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl' })
      const bad = await cli('youtube', 'user', 'items', 'UCSJ4gkVC6NrvII8umztf0Ow', '--cursor', 'not-a-cursor')
      expect(bad.env.error.code).toBe('USAGE')
    })

    it('user get：频道不存在（没有 metadata）时报 UPSTREAM，不输出缺 id 的对象', async () => {
      const r = await withYt({ browse: () => ({ alerts: [{ alertRenderer: { text: { simpleText: 'This channel does not exist.' } } }] }) }, () => cli('youtube', 'user', 'get', 'UCzzzzzzzzzzzzzzzzzzzzzz'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM' })
      expect(r.env.error.message).toContain('频道不存在')
    })

    it('item get：player 要求人机验证时报 RISK_CONTROL；需要登录的视频报 AUTH_REQUIRED', async () => {
      const bot = await withYt(
        { player: () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }), next: () => ({}) },
        () => cli('youtube', 'item', 'get', 'dQw4w9WgXcQ'),
      )
      expect(bot.env.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
      const age = await withYt(
        { player: () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm your age' } }), next: () => ({}) },
        () => cli('youtube', 'item', 'get', 'dQw4w9WgXcQ'),
      )
      expect(age.env.error.code).toBe('AUTH_REQUIRED')
    })

    it('item get：已登录还要求登录（私享视频）报 UPSTREAM 并带上错误页的原因，不是登录失效', async () => {
      await login()
      // 2026-10-24 真机：搜索结果里的直播随后转为私享，player 只给 errorScreen
      const priv = { playabilityStatus: { status: 'LOGIN_REQUIRED', errorScreen: { playerErrorMessageRenderer: { reason: { simpleText: 'Private video' } } } } }
      const r = await withYt({ player: () => priv, next: () => ({}) }, () => cli('youtube', 'item', 'get', 'dQw4w9WgXcQ'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '视频不可用：Private video' })
    })

    it('comment list：关闭评论时带上页面提示；正在直播的视频提示用 live history', async () => {
      const off = { contents: { twoColumnWatchNextResults: { results: { results: { contents: [{ itemSectionRenderer: { sectionIdentifier: 'comment-item-section', contents: [{ messageRenderer: { text: { runs: [{ text: 'Comments are turned off' }] } } }] } }] } } } } }
      const r1 = await withYt({ next: () => off }, () => cli('youtube', 'comment', 'list', 'dQw4w9WgXcQ'))
      expect(r1.env.error.message).toBe('这个视频没有评论区：Comments are turned off')
      const r2 = await withYt({ next: () => json('live_next') }, () => cli('youtube', 'comment', 'list', 'liveVideo01'))
      expect(r2.env.error).toMatchObject({ message: '正在直播的视频没有评论区，只有直播聊天', hint: 'catbus youtube live history liveVideo01' })
    })

    it('item media：VISIONOS 响应的 Set-Cookie 不写回账号凭证', async () => {
      await login()
      const vr = { playabilityStatus: { status: 'OK' }, streamingData: { formats: [{ itag: 18, url: 'https://media.example/18', mimeType: 'video/mp4', height: 360 }] } }
      await withYt({ player: () => fakeResponse(vr, { headers: [['set-cookie', 'VISITOR_INFO1_LIVE=other-visitor; Domain=.youtube.com; Path=/']] }) }, () => cli('youtube', 'item', 'media', 'dQw4w9WgXcQ'))
      const saved = JSON.parse(readFileSync(join(home.dir, 'auth/youtube/web/default.json'), 'utf8'))
      expect(saved.scopes.main.cookies.map((c: any) => c.name)).not.toContain('VISITOR_INFO1_LIVE')
    })

    it('comment add：没有频道的账号或关闭评论的视频，YouTube 只回 showErrorAction，报 UPSTREAM 并列出常见原因', async () => {
      await login()
      // 2026-10-24 没有频道的测试账号发评论的真实返回
      const failed = { actions: [{ showErrorAction: { errorMessage: { messageRenderer: { text: { simpleText: 'Comment failed to post.' } } } } }] }
      const r = await withYt({ 'comment/create_comment': () => failed }, () => cli('youtube', 'comment', 'add', 'dQw4w9WgXcQ', 'hello'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '发表评论失败：Comment failed to post.' })
      expect(r.env.error.hint).toContain('频道')
    })

    it('comment add：create_comment 的 actionResult 为 STATUS_FAILED 时报 UPSTREAM', async () => {
      await login()
      const r = await withYt({ 'comment/create_comment': () => ({ actionResult: { status: 'STATUS_FAILED' } }) }, () => cli('youtube', 'comment', 'add', 'dQw4w9WgXcQ', 'hello'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '发表评论失败：STATUS_FAILED' })
    })

    it('user follow：按钮状态没变但登录态正常时报 UPSTREAM（不是登录失效）', async () => {
      await login()
      const r = await withYt(
        { 'subscription/subscribe': () => ({ actions: [{ updateSubscribeButtonAction: { subscribed: false } }] }), 'account/account_menu': () => ACCOUNT_MENU },
        () => cli('youtube', 'user', 'follow', 'UCuAXFkgsw1L7xaCfnd5JJOw'),
      )
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '订阅没有生效' })
    })

    it('live listen：跳过新 token 的第一批（历史），之后的消息逐条输出；聊天结束后不再输出', async () => {
      let polls = 0
      const ended = { continuationContents: { liveChatContinuation: { actions: [] } } }
      const r = await withYt(
        // 第 1、2 次是打开聊天（Top chat → Live chat，历史消息不输出），第 3 次是轮询到的新消息，之后聊天结束
        { next: () => json('live_next'), 'live_chat/get_live_chat': () => (++polls <= 3 ? json('live_chat') : ended) },
        () => cli('youtube', 'live', 'listen', 'liveVideo01', '--duration', '30'),
      )
      const lines = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      expect(lines).toHaveLength(2)
      expect(lines.every((e) => e.type === 'chat')).toBe(true)
    })
  })

  describe('写操作', () => {
    beforeEach(login)

    it('item like / unlike、collect / uncollect、user follow 的请求体', async () => {
      await withYt(
        {
          'like/like': () => ({}),
          'like/removelike': () => ({}),
          'browse/edit_playlist': () => ({ status: 'STATUS_SUCCEEDED' }),
          // 2026-10-30 真机：稍后观看列表的条目带 setVideoId，移出要用它
          browse: () => ({ contents: { playlistVideoRenderer: { videoId: 'dQw4w9WgXcQ', setVideoId: '56B44F6D10557CC6' } } }),
          'subscription/subscribe': () => ({ actions: [{ updateSubscribeButtonAction: { subscribed: true, channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw' } }] }),
        },
        async (calls) => {
          for (const argv of [
            ['item', 'like', 'dQw4w9WgXcQ'],
            ['item', 'unlike', 'dQw4w9WgXcQ'],
            ['item', 'collect', 'dQw4w9WgXcQ'],
            ['item', 'uncollect', 'dQw4w9WgXcQ'],
            ['user', 'follow', 'UCuAXFkgsw1L7xaCfnd5JJOw'],
          ]) {
            const r = await cli('youtube', ...argv)
            expect([argv.join(' '), r.env.ok]).toEqual([argv.join(' '), true])
          }
          const bodies = calls.filter((c) => c.path !== '/').map((c) => [c.path, Object.fromEntries(Object.entries(c.body).filter(([k]) => k !== 'context'))])
          expect(bodies).toEqual([
            ['like/like', { target: { videoId: 'dQw4w9WgXcQ' } }],
            ['like/removelike', { target: { videoId: 'dQw4w9WgXcQ' } }],
            ['browse/edit_playlist', { playlistId: 'WL', actions: [{ addedVideoId: 'dQw4w9WgXcQ', action: 'ACTION_ADD_VIDEO' }] }],
            ['browse', { browseId: 'VLWL' }],
            ['browse/edit_playlist', { playlistId: 'WL', actions: [{ setVideoId: '56B44F6D10557CC6', action: 'ACTION_REMOVE_VIDEO' }] }],
            ['subscription/subscribe', { channelIds: ['UCuAXFkgsw1L7xaCfnd5JJOw'] }],
          ])
        },
      )
    })

    it('登录态失效时订阅接口照样返回 200，但按钮状态没变：报 AUTH_EXPIRED', async () => {
      const r = await withYt(
        // 登录态失效：头像菜单里没有当前账号
        { 'navigation/resolve_url': () => json('resolve_handle'), 'subscription/subscribe': () => ({ actions: [{ updateSubscribeButtonAction: { subscribed: false } }] }), 'account/account_menu': () => ({ actions: [] }) },
        () => cli('youtube', 'user', 'follow', '@LofiGirl'),
      )
      expect(r.code).toBe(3)
      expect(r.env.error).toMatchObject({ code: 'AUTH_EXPIRED', message: '订阅没有生效：登录态已失效' })
    })

    it('写操作返回 STATUS_FAILED 时报 UPSTREAM', async () => {
      const r = await withYt({ 'browse/edit_playlist': () => ({ status: 'STATUS_FAILED' }) }, () => cli('youtube', 'item', 'collect', 'dQw4w9WgXcQ'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '加入稍后观看失败：STATUS_FAILED' })
    })

    it('登录后 403「Sorry, something went wrong」是业务失败，不是登录失效', async () => {
      const r = await withYt(
        { 'like/like': () => fakeResponse({ error: { code: 403, message: 'Sorry, something went wrong.' } }, { status: 403 }) },
        () => cli('youtube', 'item', 'like', 'dQw4w9WgXcQ'),
      )
      expect(r.env.error.code).toBe('UPSTREAM')
    })

    it('comment add：评论与 --reply-to 回复的参数；返回新评论', async () => {
      const created = json('replies').frameworkUpdates
      await withYt({ 'comment/create_comment': () => ({ actionResult: { status: 'STATUS_SUCCEEDED' }, frameworkUpdates: created }), 'comment/create_comment_reply': () => ({ frameworkUpdates: created }) }, async (calls) => {
        const r = await cli('youtube', 'comment', 'add', 'dQw4w9WgXcQ', 'hello')
        expect(r.env.data.item_id).toBe('dQw4w9WgXcQ')
        expect(calls.at(-1)!.body).toMatchObject({ commentText: 'hello', createCommentParams: createCommentParams('dQw4w9WgXcQ') })
        await cli('youtube', 'comment', 'add', 'dQw4w9WgXcQ', 'hi', '--reply-to', 'Ugroot.reply1')
        expect(calls.at(-1)!.body).toMatchObject({ commentText: 'hi', createReplyParams: createReplyParams('dQw4w9WgXcQ', 'Ugroot') })
      })
    })

    it('item list：Studio 的 creator/list_creator_videos，带频道的 delegationContext；状态按 privacy / draftStatus 归一', async () => {
      const studioHome = `<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261027.00.00","INNERTUBE_API_KEY":"fake-key","CHANNEL_ID":"${ME}"});</script>`
      // 2026-10-30 真机：网页上传后私享草稿的条目
      const videos = { videos: [{ videoId: 'iNZCn21Qa-s', title: 'test', privacy: 'VIDEO_PRIVACY_PRIVATE', draftStatus: 'DRAFT_STATUS_DRAFT', status: 'VIDEO_STATUS_PROCESSED', timeCreatedSeconds: '1793293166' }] }
      await withYt({ 'studio:/': () => fakeResponse(studioHome, { headers: [['content-type', 'text/html']] }), 'studio:creator/list_creator_videos': () => videos }, async (calls) => {
        const r = await cli('youtube', 'item', 'list')
        expect(r.env.data.map((v: any) => [v.id, v.title, v.status])).toEqual([['iNZCn21Qa-s', 'test', 'draft']])
        const call = calls.find((c) => c.path === 'studio:creator/list_creator_videos')!
        expect(call.body.context.client.clientName).toBe(62)
        expect(call.body.context.user.delegationContext.externalChannelId).toBe(ME)
        expect(call.headers.find(([k]) => k === 'Authorization')![1]).toMatch(/^SAPISIDHASH \d+_[0-9a-f]{40}/)
      })
    })

    describe('item publish / delete（Studio：BotGuard 在无头浏览器里算，其余请求由 Node 发出）', () => {
      const VIDEO_ID = 'NEWVID1234A'
      // 真实 att/get 返回的是 //www.google.com/js/th/...（实测抓包），必须在白名单里
      const INTERP = 'https://www.google.com/js/th/interp.js'
      const STUDIO_HOME = `<script>ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.20261030.00.00","INNERTUBE_API_KEY":"fake-key","CHANNEL_ID":"${ME}","INNERTUBE_CONTEXT_SERIALIZED_DELEGATION_CONTEXT":"FAKE_SDC"});</script>`
      const bgChallenge = (tag: string) => ({ program: `PROG-${tag}`, interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: INTERP } })
      const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      let savedBrowser: string | undefined
      let video: string
      let cover: string

      beforeEach(() => {
        savedBrowser = process.env.CATBUS_YOUTUBE_BROWSER
        // 浏览器由 fakeBrowser 替换，这里只需要一个存在的文件通过查找
        process.env.CATBUS_YOUTUBE_BROWSER = process.execPath
        video = join(home.dir, 'ytv.mp4')
        cover = join(home.dir, 'cover.png')
        writeFileSync(video, 'fake-video-bytes')
        writeFileSync(cover, PNG)
      })
      afterEach(() => {
        if (savedBrowser === undefined) delete process.env.CATBUS_YOUTUBE_BROWSER
        else process.env.CATBUS_YOUTUBE_BROWSER = savedBrowser
        vi.restoreAllMocks()
      })

      /** 假浏览器：记录每次 BotGuard 的 binding，返回按调用次序编号的 WEB<n>。 */
      function fakeBrowser(opts: { url?: string; fresh?: Cookie[] } = {}) {
        const attests: { binding: any }[] = []
        const opened: OpenOptions[] = []
        const state = { closed: 0 }
        vi.spyOn(browser, 'open').mockImplementation(async (o) => {
          opened.push(o)
          return {
            url: opts.url ?? `https://studio.youtube.com/channel/${ME}/videos/upload`,
            attest: async (req) => {
              attests.push({ binding: req.binding })
              return `WEB${attests.length}`
            },
            cookies: async () => opts.fresh ?? [],
            close: async () => {
              state.closed++
            },
          }
        })
        return { attests, opened, state }
      }

      /** Studio 路由：att/get 给两种挑战，esr 直接给令牌；上传按录制的形状给。 */
      function studioRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
        return {
          'studio:/': () => fakeResponse(STUDIO_HOME, { headers: [['content-type', 'text/html']] }),
          'studio:att/get': (body) =>
            body.engagementType === 'ENGAGEMENT_TYPE_UNBOUND' ? { challenge: 'CH2', bgChallenge: bgChallenge('unbound') } : { challenge: 'CH1', bgChallenge: bgChallenge('studio') },
          'studio:att/esr': () => ({ sessionToken: 'TOKEN1' }),
          '/js/th/interp.js': () => fakeResponse('/* interpreter */', { headers: [['content-type', 'text/javascript']] }),
          '/upload/studio': () => fakeResponse('', { headers: [['x-goog-upload-url', 'https://upload.youtube.com/session/1']] }),
          '/session/1': () => fakeResponse('{"scottyResourceId":"SCOTTY1"}', { headers: [['content-type', 'application/json']] }),
          'studio:upload/createvideo': () => ({ videoId: VIDEO_ID }),
          'studio:video/delete': () => ({ success: true }),
          ...extra,
        }
      }

      it('publish：Node 上传并建视频；浏览器只算两次 BotGuard；建视频带会话令牌与校验结果', async () => {
        const b = fakeBrowser()
        await withYt(studioRoutes(), async (calls) => {
          const r = await cli('youtube', 'item', 'publish', '--video', video, '--title', 'hello', '--text', 'desc', '--visibility', 'private')
          expect(r.env.ok).toBe(true)
          expect(r.env.data).toMatchObject({ id: VIDEO_ID, kind: 'video', title: 'hello', url: `https://www.youtube.com/watch?v=${VIDEO_ID}` })
          // 第一次是会话令牌的 atr_challenge，第二次是上传完成后 UNBOUND 挑战加 scottyResourceId
          expect(b.attests.map((a) => a.binding)).toEqual([{ atr_challenge: 'CH1' }, { c: 'CH2', e: 'ENGAGEMENT_TYPE_VIDEO_UPLOAD', scottyResourceId: 'SCOTTY1' }])
          const create = calls.find((c) => c.path === 'studio:upload/createvideo')!
          expect(create.body.resourceId).toEqual({ scottyResourceId: { id: 'SCOTTY1' } })
          expect(create.body.initialMetadata).toMatchObject({ title: { newTitle: 'hello' }, privacy: { newPrivacy: 'PRIVATE' }, description: { newDescription: 'desc' } })
          expect(create.body.context.request).toMatchObject({ sessionInfo: { token: 'TOKEN1' }, attestationResponseData: { challenge: 'CH2', webResponse: 'WEB2' } })
          expect(create.body.context.user.serializedDelegationContext).toBe('FAKE_SDC')
          const upload = calls.find((c) => c.path === '/upload/studio')!
          expect(upload.headers.find(([k]) => k.toLowerCase() === 'x-goog-upload-file-name')![1]).toBe('ytv.mp4')
          expect(b.opened[0]!.url).toBe(`https://studio.youtube.com/channel/${ME}/videos/upload?d=ud`)
          expect(b.state.closed).toBe(1)
        })
      })

      it('publish：标签、封面走 metadata_update；定时发布先建成私享，metadata_update 里转公开', async () => {
        fakeBrowser()
        const when = '2026-11-01T20:00:00+08:00'
        await withYt(studioRoutes({ 'studio:video_manager/metadata_update': () => ({ overallResult: { resultCode: 'UPDATE_SUCCESS' } }) }), async (calls) => {
          const r = await cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--tag', 'a', '--tag', 'b', '--cover', cover, '--schedule', when)
          expect(r.env.ok).toBe(true)
          expect(r.env.data.status).toBe('private')
          expect(calls.find((c) => c.path === 'studio:upload/createvideo')!.body.initialMetadata.privacy).toEqual({ newPrivacy: 'PRIVATE' })
          const meta = calls.find((c) => c.path === 'studio:video_manager/metadata_update')!
          expect(meta.body).toMatchObject({
            encryptedVideoId: VIDEO_ID,
            tags: { newTags: ['a', 'b'] },
            videoStill: { operation: 'UPLOAD_CUSTOM_THUMBNAIL', image: { dataUri: `data:image/png;base64,${PNG.toString('base64')}` } },
            scheduledPublishing: { set: { privacy: 'PUBLIC', timeSec: String(Date.parse(when) / 1000) } },
          })
          expect(meta.body.context.request.sessionInfo).toEqual({ token: 'TOKEN1' })
        })
      })

      it('publish：定时时间已经过去时报 USAGE，不上传', async () => {
        await withYt({}, async (calls) => {
          const r = await cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--schedule', '2020-01-01T00:00:00Z')
          expect(r.env.error.code).toBe('USAGE')
          expect(calls).toHaveLength(0)
        })
      })

      it('publish：视频已建好但元数据没设置成功时报 UPSTREAM，并给出视频 ID', async () => {
        fakeBrowser()
        const r = await withYt(studioRoutes({ 'studio:video_manager/metadata_update': () => ({ overallResult: { resultCode: 'UPDATE_FAILED_RETRY' } }) }), () =>
          cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--tag', 'a'),
        )
        expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: `视频 ${VIDEO_ID} 已建好，但标签 / 封面 / 定时发布没有设置成功（YouTube 返回 UPDATE_FAILED_RETRY）` })
      })

      it('publish：metadata_update 按字段返回 success，失败的字段名写进报错，并提示自定义封面的验证', async () => {
        fakeBrowser()
        const partial = { overallResult: { resultCode: 'SOME_ERRORS' }, tags: { success: true }, videoStill: { success: false }, scheduledPublishing: { success: true } }
        const r = await withYt(studioRoutes({ 'studio:video_manager/metadata_update': () => partial }), () =>
          cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--tag', 'catbustest', '--cover', cover),
        )
        expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: `视频 ${VIDEO_ID} 已建好，但封面没有设置成功（YouTube 返回 SOME_ERRORS）`, detail: { failed: ['封面'] } })
        expect(r.env.error.hint).toMatch(/自定义封面/)
      })

      it('publish：上传被拒（当天上传数超限）时报 RISK_CONTROL，并说明 YouTube 给的原因，不说「没有建成」', async () => {
        const b = fakeBrowser()
        const rejected = {
          contents: {
            uploadFeedbackItemRenderer: {
              contents: [
                {
                  uploadStatus: {
                    uploadStatus: 'REJECTED',
                    message: { runs: [{ text: 'Daily upload limit reached' }] },
                    detailedMessage: { runs: [{ text: 'Verification needed to upload more daily.' }] },
                    uploadStatusReason: 'UPLOAD_STATUS_REASON_RATE_LIMIT_EXCEEDED',
                  },
                },
              ],
            },
          },
        }
        const r = await withYt(studioRoutes({ 'studio:upload/createvideo': () => rejected }), () => cli('youtube', 'item', 'publish', '--video', video, '--title', 't'))
        expect(r.env.error).toMatchObject({
          code: 'RISK_CONTROL',
          message: 'YouTube 拒绝了这次上传：Daily upload limit reached：Verification needed to upload more daily.',
          detail: { kind: 'rate_limit', reason: 'UPLOAD_STATUS_REASON_RATE_LIMIT_EXCEEDED' },
        })
        expect(b.state.closed).toBe(1)
      })

      it('publish：metadata_update 网络出错时重试一次；仍失败时报错并带上视频 ID（视频已经建好了）', async () => {
        fakeBrowser()
        let n = 0
        const throwOnce = () => {
          if (++n === 1) throw new RequestError('connection reset')
          return { overallResult: { resultCode: 'UPDATE_SUCCESS' } }
        }
        const ok = await withYt(studioRoutes({ 'studio:video_manager/metadata_update': throwOnce }), () => cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--tag', 'a'))
        expect(ok.env.ok).toBe(true)
        expect(n).toBe(2)
        const alwaysFail = () => {
          throw new RequestError('connection reset')
        }
        const failed = await withYt(studioRoutes({ 'studio:video_manager/metadata_update': alwaysFail }), () => cli('youtube', 'item', 'publish', '--video', video, '--title', 't', '--tag', 'a'))
        // 视频已建好：不透传 NETWORK（否则调用方会以为能重试整条发布），统一报 UPSTREAM 并附上视频 ID
        expect(failed.env.error).toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining(`视频 ${VIDEO_ID} 已建好`), detail: { id: VIDEO_ID } })
      })

      it('publish：先拿到会话令牌再上传；createvideo 网络错误报 UPSTREAM 并提示可能已经生效，不重试', async () => {
        fakeBrowser()
        let creates = 0
        await withYt(
          studioRoutes({
            'studio:upload/createvideo': () => {
              creates++
              throw new RequestError('connection reset')
            },
          }),
          async (calls) => {
            const r = await cli('youtube', 'item', 'publish', '--video', video, '--title', 't')
            expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('没有确定结果') })
            expect(r.env.error.hint).toMatch(/可能已经生效.*不要直接重试/)
            expect(creates).toBe(1)
            // 顺序：会话令牌（att/esr）在上传之前
            const order = calls.map((c) => c.path)
            expect(order.indexOf('studio:att/esr')).toBeGreaterThan(-1)
            expect(order.indexOf('studio:att/esr')).toBeLessThan(order.indexOf('/upload/studio'))
          },
        )
      })

      it('publish：建视频没有返回 videoId 时报 UPSTREAM，不重试（请求可能已经生效）', async () => {
        const b = fakeBrowser()
        await withYt(studioRoutes({ 'studio:upload/createvideo': () => ({ responseContext: {} }) }), async (calls) => {
          const r = await cli('youtube', 'item', 'publish', '--video', video, '--title', 't')
          expect(r.env.error.code).toBe('UPSTREAM')
          expect(calls.filter((c) => c.path === 'studio:upload/createvideo')).toHaveLength(1)
          expect(b.state.closed).toBe(1)
        })
      })

      it('att/esr 要求 reauth 时，用 reauth 证明换会话令牌', async () => {
        const b = fakeBrowser()
        await withYt(
          studioRoutes({
            'studio:att/esr': () => ({ shouldFetchReauthSessionToken: true, ctx: 'IVCTX' }),
            'studio:security/get_web_reauth_url': () => ({ encodedReauthProofToken: 'PROOF', sessionRiskCtx: 'RISK' }),
            'studio:ars/grst': () => ({ sessionToken: 'TOKEN_REAUTH' }),
          }),
          async (calls) => {
            const r = await cli('youtube', 'item', 'delete', VIDEO_ID, '-y')
            expect(r.env.ok).toBe(true)
            expect(calls.find((c) => c.path === 'studio:security/get_web_reauth_url')!.body).toMatchObject({ ivctx: 'IVCTX', botguardResponse: 'WEB1', flow: 'REAUTH_FLOW_YT_STUDIO_COLD_LOAD' })
            expect(calls.find((c) => c.path === 'studio:ars/grst')!.body.ctx).toBe('RISK')
            expect(calls.find((c) => c.path === 'studio:ars/grst')!.body.context.request.reauthRequestInfo).toEqual({ encodedReauthProofToken: 'PROOF' })
            expect(calls.find((c) => c.path === 'studio:video/delete')!.body.context.request.sessionInfo).toEqual({ token: 'TOKEN_REAUTH' })
            expect(b.attests).toHaveLength(1)
          },
        )
      })

      it('reauth 被拒绝时报 RISK_CONTROL', async () => {
        const b = fakeBrowser()
        const r = await withYt(
          studioRoutes({
            'studio:att/esr': () => ({ shouldFetchReauthSessionToken: true, ctx: 'IVCTX' }),
            'studio:security/get_web_reauth_url': () => ({}),
          }),
          () => cli('youtube', 'item', 'delete', VIDEO_ID, '-y'),
        )
        expect(r.env.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked' } })
        expect(b.state.closed).toBe(1)
      })

      it('delete：删除请求带会话令牌；未确认时拒绝且不打开浏览器', async () => {
        const b = fakeBrowser()
        await withYt(studioRoutes(), async (calls) => {
          expect((await cli('youtube', 'item', 'delete', VIDEO_ID)).env.error.code).toBe('CONFIRM_REQUIRED')
          expect(b.opened).toHaveLength(0)
          const r = await cli('youtube', 'item', 'delete', VIDEO_ID, '-y')
          expect(r.env.data).toEqual({ id: VIDEO_ID })
          const del = calls.find((c) => c.path === 'studio:video/delete')!
          expect(del.body).toMatchObject({ videoId: VIDEO_ID })
          expect(del.body.context.request.sessionInfo).toEqual({ token: 'TOKEN1' })
          expect(b.attests.map((a) => a.binding)).toEqual([{ atr_challenge: 'CH1' }])
        })
      })

      it('delete：Studio 没有返回成功时报 UPSTREAM', async () => {
        fakeBrowser()
        const r = await withYt(studioRoutes({ 'studio:video/delete': () => ({}) }), () => cli('youtube', 'item', 'delete', VIDEO_ID, '-y'))
        expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: `删除视频 ${VIDEO_ID} 没有成功` })
      })

      it('Studio 跳到 Google 登录页时报 AUTH_EXPIRED，并关闭浏览器', async () => {
        const b = fakeBrowser({ url: 'https://accounts.google.com/ServiceLogin' })
        const r = await withYt(studioRoutes(), () => cli('youtube', 'item', 'publish', '--video', video, '--title', 't'))
        expect(r.env.error.code).toBe('AUTH_EXPIRED')
        expect(b.attests).toHaveLength(0)
        expect(b.state.closed).toBe(1)
      })

      it('找不到 Chromium：报 ERROR 并给出安装方式，不上传文件', async () => {
        delete process.env.CATBUS_YOUTUBE_BROWSER
        const savedHome = process.env.HOME
        process.env.HOME = join(home.dir, 'no-home') // 没有 Playwright 缓存
        try {
          const r = await withYt({}, (calls) => cli('youtube', 'item', 'publish', '--video', video, '--title', 't').then((x) => ({ ...x, calls: calls.length })))
          expect(r.env.error.code).toBe('ERROR')
          expect(r.env.error.message).toMatch(/找不到 Chromium/)
          expect(r.env.error.hint).toMatch(/playwright install chromium/)
          expect(r.calls).toBe(0)
        } finally {
          process.env.HOME = savedHome
        }
      })

      it('config 指定的浏览器不存在时报 ERROR，不回退到缓存', async () => {
        process.env.CATBUS_YOUTUBE_BROWSER = join(home.dir, 'nope', 'chrome')
        const r = await withYt({}, () => cli('youtube', 'item', 'delete', VIDEO_ID, '-y'))
        expect(r.env.error).toMatchObject({ code: 'ERROR', message: `CATBUS_YOUTUBE_BROWSER 指向的文件不存在或不能执行：${join(home.dir, 'nope', 'chrome')}` })
      })
    })

    describe('Chromium 查找与 cookie 回写', () => {
      // 造一个可执行的占位文件（findChrome 会检查 X_OK）
      const touch = (p: string) => {
        mkdirSync(dirname(p), { recursive: true })
        writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      }
      const ck = (name: string, value: string, extra: Partial<Cookie> = {}): Cookie => ({ name, value, domain: '.youtube.com', path: '/', expires: null, ...extra })

      it('darwin：取 Playwright 缓存里最新的 chromium-<版本>，忽略 headless shell', () => {
        const root = join(home.dir, 'Library', 'Caches', 'ms-playwright')
        const bin = (dir: string) => join(root, dir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
        touch(bin('chromium-1200'))
        touch(bin('chromium-1234'))
        touch(join(root, 'chromium_headless_shell-1300', 'chrome-mac-arm64', 'chrome-headless-shell'))
        expect(findChrome({ platform: 'darwin', home: home.dir, env: {} })).toBe(bin('chromium-1234'))
      })

      it('linux 与 win32 的目录布局；PLAYWRIGHT_BROWSERS_PATH 优先', () => {
        const linux = join(home.dir, '.cache', 'ms-playwright', 'chromium-1234', 'chrome-linux64', 'chrome')
        touch(linux)
        expect(findChrome({ platform: 'linux', home: home.dir, env: {} })).toBe(linux)
        const local = join(home.dir, 'AppData', 'Local')
        const win = join(local, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe')
        touch(win)
        expect(findChrome({ platform: 'win32', home: home.dir, env: { LOCALAPPDATA: local } })).toBe(win)
        const custom = join(home.dir, 'custom', 'chromium-9', 'chrome-linux', 'chrome')
        touch(custom)
        expect(findChrome({ platform: 'linux', home: home.dir, env: { PLAYWRIGHT_BROWSERS_PATH: join(home.dir, 'custom') } })).toBe(custom)
      })

      it('优先级：config > 环境变量 > 缓存；指定的文件不存在时报 ERROR', () => {
        const cache = join(home.dir, '.cache', 'ms-playwright', 'chromium-1234', 'chrome-linux64', 'chrome')
        const envExe = join(home.dir, 'env-chrome')
        const cfgExe = join(home.dir, 'cfg-chrome')
        touch(cache)
        touch(envExe)
        touch(cfgExe)
        expect(findChrome({ platform: 'linux', home: home.dir, env: {} })).toBe(cache)
        expect(findChrome({ platform: 'linux', home: home.dir, env: { CATBUS_YOUTUBE_BROWSER: envExe } })).toBe(envExe)
        expect(findChrome({ platform: 'linux', home: home.dir, env: { CATBUS_YOUTUBE_BROWSER: envExe }, configured: cfgExe })).toBe(cfgExe)
        expect(() => findChrome({ platform: 'linux', home: home.dir, env: {}, configured: join(home.dir, 'nope') })).toThrow(/youtube\.browser 指向的文件不存在/)
      })

      it('什么都找不到时报 ERROR，并给出安装命令与配置方式', () => {
        expect(() => findChrome({ platform: 'linux', home: join(home.dir, 'empty'), env: {} })).toThrow(/找不到 Chromium/)
      })

      it('syncCookies：只写回浏览器改过的值，覆盖所有域，Node 侧没改过的才被覆盖', () => {
        const other = (name: string, value: string) => ck(name, value, { domain: '.google.com' })
        const jar = [ck('__Secure-1PSIDTS', 'old'), ck('SAPISID', 'node-new'), ck('LOGIN_INFO', 'same'), other('NID', 'g-old')]
        const injected = new Map([
          [cookieKey(ck('__Secure-1PSIDTS', '')), 'old'],
          [cookieKey(ck('SAPISID', '')), 'old'],
          [cookieKey(ck('LOGIN_INFO', '')), 'same'],
          [cookieKey(other('NID', '')), 'g-old'],
        ])
        // SAPISID：Node 侧已经通过 Set-Cookie 改过，浏览器没有改，保留 Node 侧的值
        const fresh = [ck('__Secure-1PSIDTS', 'browser-new'), ck('SAPISID', 'old'), ck('LOGIN_INFO', 'same'), other('NID', 'g-browser')]
        expect(syncCookies(jar, injected, fresh)).toBe(2)
        expect(jar.find((c) => c.name === '__Secure-1PSIDTS')!.value).toBe('browser-new')
        expect(jar.find((c) => c.name === 'SAPISID')!.value).toBe('node-new')
        expect(jar.find((c) => c.name === 'LOGIN_INFO')!.value).toBe('same')
        expect(jar.find((c) => c.name === 'NID')!.value).toBe('g-browser')
      })

      it('syncCookies：两边都改过同一个 cookie 时，取 expires 较新的；expires 相同则保留 Node 侧', () => {
        const injected = new Map([[cookieKey(ck('__Secure-1PSIDCC', '')), 'v0']])
        // 浏览器的值更新（expires 更晚）→ 写回
        let jar = [ck('__Secure-1PSIDCC', 'node-v1', { expires: 100 })]
        expect(syncCookies(jar, injected, [ck('__Secure-1PSIDCC', 'browser-v1', { expires: 200 })])).toBe(1)
        expect(jar[0]).toMatchObject({ value: 'browser-v1', expires: 200 })
        // 浏览器的值 expires 更早 → 保留 Node 侧
        jar = [ck('__Secure-1PSIDCC', 'node-v1', { expires: 300 })]
        expect(syncCookies(jar, injected, [ck('__Secure-1PSIDCC', 'browser-v1', { expires: 200 })])).toBe(0)
        expect(jar[0]!.value).toBe('node-v1')
        // expires 相同 → 保留 Node 侧
        jar = [ck('__Secure-1PSIDCC', 'node-v1', { expires: 200 })]
        expect(syncCookies(jar, injected, [ck('__Secure-1PSIDCC', 'browser-v1', { expires: 200 })])).toBe(0)
        expect(jar[0]!.value).toBe('node-v1')
      })
    })

    it('live send：取登录后聊天输入框里的 params 发消息；被限制时报出 YouTube 的说明', async () => {
      const input = { actionPanel: { liveChatMessageInputRenderer: { sendButton: { buttonRenderer: { serviceEndpoint: { sendLiveChatMessageEndpoint: { params: 'SEND_PARAMS' } } } } } } }
      const sent = { actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'MSG1' } } } }] }
      await withYt({ next: () => json('live_next'), 'live_chat/get_live_chat': () => ({ continuationContents: { liveChatContinuation: input } }), 'live_chat/send_message': () => sent }, async (calls) => {
        const r = await cli('youtube', 'live', 'send', 'liveVideo01', 'hello')
        expect(r.env.data).toEqual({ id: 'MSG1' })
        expect(calls.at(-1)!.body).toMatchObject({ params: 'SEND_PARAMS', richMessage: { textSegments: [{ text: 'hello' }] } })
      })
      // 2026-10-30 真机：Lofi Girl 直播间只允许订阅者发言
      const restricted = { actionPanel: { liveChatRestrictedParticipationRenderer: { message: { runs: [{ text: 'Subscribers-only mode' }] } } } }
      const r = await withYt({ next: () => json('live_next'), 'live_chat/get_live_chat': () => ({ continuationContents: { liveChatContinuation: restricted } }) }, () => cli('youtube', 'live', 'send', 'liveVideo01', 'hello'))
      expect(r.env.error).toMatchObject({ code: 'UPSTREAM', message: '不能在这个直播间发消息：Subscribers-only mode' })
      const gift = await cli('youtube', 'live', 'send', 'liveVideo01', '--gift', '1')
      expect(gift.env.error.code).toBe('USAGE')
    })

    it('channel create：用表单里的 token、默认名称和推荐的 handle 开频道；已有频道时报 USAGE', async () => {
      // 2026-10-30 真机：get_channel_creation_form 的对话框结构；create_channel 只回 accountStateToken
      const form = {
        actions: [{ openPopupAction: { popup: { channelCreationDialogRenderer: {
          name: 'Test User',
          channelCreationEndpoint: { channelCreationServiceEndpoint: { channelCreationToken: 'TOKEN' } },
          channelHandleInput: { channelHandleInputRenderer: { handle: 'TestUser-w7k' } },
        } } } }],
      }
      await withYt({ 'channel/get_channel_creation_form': () => form, 'channel/create_channel': () => ({ accountStateToken: 'x' }), 'account/account_menu': () => ACCOUNT_MENU, browse: () => json('channel') }, async (calls) => {
        const r = await cli('youtube', 'channel', 'create', '--handle', '@mine')
        expect(r.env.ok).toBe(true)
        expect(calls.find((c) => c.path === 'channel/create_channel')!.body).toMatchObject({ channelCreationToken: 'TOKEN', givenName: 'Test User', handle: 'mine' })
      })
      const r = await withYt({ 'channel/get_channel_creation_form': () => ({}), 'account/account_menu': () => ACCOUNT_MENU }, () => cli('youtube', 'channel', 'create'))
      expect(r.env.error).toMatchObject({ code: 'USAGE', message: `这个账号已经有频道了：${ME}` })
    })

    it('comment like / delete：action 带上视频所属频道；delete 需要确认', async () => {
      await withYt({ next: () => json('next'), 'comment/perform_comment_action': () => ({}) }, async (calls) => {
        const like = await cli('youtube', 'comment', 'like', 'dQw4w9WgXcQ', 'Ugabc')
        expect(like.env.data).toEqual({ id: 'Ugabc' })
        expect(calls.at(-1)!.body.actions).toEqual([commentAction('like', 'dQw4w9WgXcQ', 'Ugabc', 'UCuAXFkgsw1L7xaCfnd5JJOw')])
        const unconfirmed = await cli('youtube', 'comment', 'delete', 'dQw4w9WgXcQ', 'Ugabc')
        expect(unconfirmed.env.error.code).toBe('CONFIRM_REQUIRED')
        await cli('youtube', 'comment', 'delete', 'dQw4w9WgXcQ', 'Ugabc', '-y')
        expect(calls.at(-1)!.body.actions).toEqual([commentAction('delete', 'dQw4w9WgXcQ', 'Ugabc', 'UCuAXFkgsw1L7xaCfnd5JJOw')])
      })
    })
  })
})
