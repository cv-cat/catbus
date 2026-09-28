import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import xPlatform from '../src/platforms/x/index.js'
import * as api from '../src/platforms/x/web/api.js'
import { XClient } from '../src/platforms/x/web/client.js'
import * as cmd from '../src/platforms/x/web/commands.js'
import { isUserId, parseScreenName, parseTweetId } from '../src/platforms/x/web/resolve.js'
import { transaction } from '../src/platforms/x/web/transaction.js'
import { expectRequests, loadCase, makeCtx, replay } from './golden.js'
import { type CliResult, cli, useTempHome } from './helpers.js'

const COOKIES = 'auth_token=fakeauthtoken000000000000000000000000000000; ct0=fakect0000000000000000000000000000000000000000; twid=u%3D10001; lang=en'
const TWEET_ID = '1585341984679469056'
const USER_ID = '44196397'
const MEDIA_ID = '1790000000000000100'

const loggedCtx = (extra: Parameters<typeof makeCtx>[0] = { platform: 'x' }) => makeCtx({ ...extra, platform: 'x', cookies: COOKIES, cookieDomain: '.x.com' })
const guestCtx = (extra: Parameters<typeof makeCtx>[0] = { platform: 'x' }) => makeCtx({ ...extra, platform: 'x', account: 'guest' })

async function logged<T>(fn: (x: XClient) => Promise<T>): Promise<T> {
  const x = new XClient(loggedCtx())
  await x.init()
  return fn(x)
}

const bytesOf = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

/** 用例名 → TS 侧的等价调用（与 scripts/golden/x/gen.py 一一对应）。 */
const CASES: Record<string, (input: any) => Promise<unknown>> = {
  guest_activate: async () => {
    const x = new XClient(guestCtx())
    await x.init()
    return x.guestToken()
  },
  tweet_detail: () => logged((x) => api.getWorkInfo(x, TWEET_ID)),
  tweet_detail_cursor: () => logged((x) => api.getWorkInfo(x, `https://twitter.com/elonmusk/status/${TWEET_ID}?s=20`, 'DETAIL_NEXT')),
  tweet_detail_referrer: () => logged((x) => api.getWorkInfo(x, TWEET_ID, undefined, 'home')),
  tweet_result: () => logged((x) => api.getWorkResult(x, TWEET_ID)),
  search_top: () => logged((x) => api.searchWork(x, '猫 & dog #tag')),
  search_latest_cursor: () => logged((x) => api.searchWork(x, 'python', 'SEARCH_NEXT', 'Latest')),
  search_people: () => logged((x) => api.searchWork(x, 'elon', undefined, 'People')),
  user_info: () => logged((x) => api.getUserInfo(x, 'https://x.com/ElonMusk')),
  user_by_id: () => logged((x) => api.getUserById(x, USER_ID)),
  user_originals: () => logged((x) => api.getUserPostNote(x, USER_ID)),
  user_originals_cursor: () => logged((x) => api.getUserPostNote(x, USER_ID, 'CURSOR_NEXT')),
  user_tweets: () => logged((x) => api.getUserPostNote(x, USER_ID, undefined, 20, 'UserTweets')),
  home: () => logged((x) => api.getHomeTimeline(x)),
  home_cursor: () => logged((x) => api.getHomeTimeline(x, 'HOME_NEXT')),
  home_seen: () => logged((x) => api.getHomeTimeline(x, undefined, 20, ['1001', '1002'])),
  viewer: () => logged((x) => api.getViewer(x)),

  create_tweet: () => logged((x) => api.createTweet(x, '你好 "x" & <b>\n第二行')),
  create_tweet_reply: () => logged((x) => api.createTweet(x, 'reply', [], 'https://x.com/a/status/20')),
  create_tweet_media: () => logged((x) => api.createTweet(x, 'pics', ['111', '222'], undefined, 'https://x.com/a/status/20')),
  delete_tweet: () => logged((x) => api.deleteTweet(x, TWEET_ID)),
  favorite: () => logged((x) => api.favoriteTweet(x, TWEET_ID)),
  unfavorite: () => logged((x) => api.unfavoriteTweet(x, TWEET_ID)),
  retweet: () => logged((x) => api.createRetweet(x, TWEET_ID)),
  unretweet: () => logged((x) => api.deleteRetweet(x, TWEET_ID)),
  bookmark: () => logged((x) => api.createBookmark(x, TWEET_ID)),
  unbookmark: () => logged((x) => api.deleteBookmark(x, TWEET_ID)),
  follow: () => logged((x) => api.followUser(x, USER_ID)),
  unfollow: () => logged((x) => api.unfollowUser(x, USER_ID)),

  media_init: () => logged((x) => api.mediaInit(x, 3, 'image/jpeg')),
  media_init_video: () => logged((x) => api.mediaInit(x, 1000, 'video/mp4')),
  media_append: () => logged((x) => api.mediaAppend(x, MEDIA_ID, new TextEncoder().encode('abc'), 0)),
  media_finalize: () => logged((x) => api.mediaFinalize(x, MEDIA_ID, createHash('md5').update('abc').digest('hex'))),
  media_status: () => logged((x) => api.mediaStatus(x, MEDIA_ID)),
  media_meta: () => logged((x) => api.mediaMetadataCreate(x, MEDIA_ID)),
  media_upload_image: (input) => logged(async (x) => (await api.upload(x, bytesOf(input.data), input.filename)).mediaId),
  media_upload_video: (input) => logged(async (x) => (await api.upload(x, bytesOf(input.data), input.filename)).mediaId),

  chat_initial: () => logged((x) => api.getInitialChatPage(x)),
  chat_conversation: () => logged((x) => api.getConversationPage(x, '10001:20002')),
}

describe('x 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('x', name)
      const { requests, result, error } = await replay(c, () => run(c.input))
      if (error) throw error
      expectRequests(requests, c.requests)
      if (name === 'guest_activate' || name.startsWith('media_upload')) expect(result).toBe(c.result)
    })
  }

  it('XCTID：固定时间与随机字节时与上游逐字节一致', () => {
    const c = loadCase('x', 'xctid')
    const path = '/i/api/graphql/KybxDj9RrADIITXlGG8kpw/UserByScreenName'
    const t = transaction()
    expect([t.generate('GET', path, 107075600, 0), t.generate('GET', path, 107075600, 58), t.generate('GET', path, 1, 255)]).toEqual(c.result)
  })
})

describe('x 对拍：命令流程', () => {
  it('游客 user get：换取 guest token（写入 gt cookie），带 x-guest-token 查用户', async () => {
    const c = loadCase('x', 'guest_user_get')
    const ctx = guestCtx({ platform: 'x', args: { user: 'elonmusk' } })
    const { requests, result, error } = await replay(c, () => cmd.userGet(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({
      id: USER_ID,
      name: 'Elon Musk',
      handle: 'elonmusk',
      avatar: 'https://pbs.twimg.com/profile_images/1/fake_normal.jpg',
      url: 'https://x.com/elonmusk',
      bio: '简介 & bio',
      stats: { followers: 241701251, following: 1412, items: 109119, likes: 249608 },
    })
    // guest token 缓存在游客凭证里：3 小时内不再换取
    const main = ctx.credential.scopes.main!
    expect(main.tokens).toMatchObject({ guest_token: '1790000000000000001', guest_at: c.now })
    expect(main.cookies.map((k) => k.name)).toEqual(['ct0', 'lang', 'gt'])
    const restore = [
      deterministic({ now: c.now + 3 * 3600_000 - 1 }),
      mockSender(() => {
        throw new Error('不应再请求 guest/activate')
      }),
    ]
    try {
      expect(await new XClient(ctx).guestToken()).toBe('1790000000000000001')
    } finally {
      for (const r of restore) r()
    }
  })

  it('游客 item get：TweetResultByRestId（游客可用），视频推文取码率最高的 mp4', async () => {
    const c = loadCase('x', 'guest_item_get')
    const ctx = guestCtx({ platform: 'x', args: { item: c.input.item } })
    const { requests, result, error } = await replay(c, () => cmd.itemGet(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any)[RAW]).toEqual(c.result.data.tweetResult.result)
    expect(result).toEqual({
      id: TWEET_ID,
      kind: 'video',
      url: `https://x.com/elonmusk/status/${TWEET_ID}`,
      title: null,
      text: '视频推文 https://t.co/v',
      author: { id: USER_ID, name: 'Elon Musk', url: 'https://x.com/elonmusk' },
      created_at: expect.stringMatching(/^2022-10-2[67]T\d\d:45:58/),
      cover: 'https://pbs.twimg.com/ext_tw_video_thumb/901/pu/img/thumb.jpg',
      media: [{ id: '901', type: 'video', url: 'https://video.twimg.com/ext_tw_video/901/pu/vid/1280x720/high.mp4', width: 1920, height: 1080, duration: 9.301 }],
      stats: { views: 12345, likes: 11, comments: 22, collects: 33, shares: 44 },
      price: null,
      status: null,
    })
  })

  it('游客 user items：先按用户名查 rest_id，未登录用 UserTweets；跳过广告，拆开 TweetWithVisibilityResults', async () => {
    const c = loadCase('x', 'guest_user_items')
    const ctx = guestCtx({ platform: 'x', args: { user: '@ElonMusk' } })
    const { requests, result, error } = await replay(c, () => cmd.userItems(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    const { data, page } = result as any
    expect(data.map((i: any) => [i.id, i.kind])).toEqual([
      ['1001', 'text'],
      ['1002', 'image'],
      ['1003', 'video'],
    ])
    expect(data[1].media).toEqual([{ id: '900', type: 'image', url: 'https://pbs.twimg.com/media/fake.jpg', width: 1200, height: 800, duration: null }])
    expect(page).toEqual({ cursor: 'CURSOR_NEXT', has_more: true })
  })

  it('comment list：TweetDetail 的对话串，直接回复 parent_id 为 null，楼中楼指向被回复的评论', async () => {
    const c = loadCase('x', 'tweet_detail')
    const ctx = loggedCtx({ platform: 'x', args: { item: `https://x.com/elonmusk/status/${TWEET_ID}` } })
    const { requests, result, error } = await replay(c, () => cmd.commentList(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    const { data, page } = result as any
    expect(data).toEqual([
      {
        id: '2001',
        item_id: TWEET_ID,
        parent_id: null,
        author: { id: '20002', name: 'Peer', url: 'https://x.com/peer_user' },
        text: '@elonmusk 第一条回复',
        created_at: expect.any(String),
        stats: { likes: 11, replies: 22 },
      },
      expect.objectContaining({ id: '2002', parent_id: '2001', author: { id: USER_ID, name: 'Elon Musk', url: 'https://x.com/elonmusk' } }),
    ])
    expect(page).toEqual({ cursor: 'DETAIL_NEXT', has_more: true })
  })

  it('item publish：传图（INIT → APPEND → FINALIZE → 元数据）后 CreateTweet', async () => {
    const c = loadCase('x', 'post_tweet')
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    const file = join(dir, c.input.filename)
    writeFileSync(file, bytesOf(c.input.data))
    const ctx = loggedCtx({ platform: 'x', options: { text: 'hello', image: [file], visibility: 'public' } })
    const { requests, result, error } = await replay(c, () => cmd.itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({
      id: '3001',
      kind: 'image',
      url: 'https://x.com/catbus_test/status/3001',
      text: 'hello',
      author: { id: '10001', name: '测试账号', url: 'https://x.com/catbus_test' },
      stats: { views: null },
    })
  })

  it('msg list：X Chat 收件箱，单聊的 peer 是对方，群聊没有 peer', async () => {
    const c = loadCase('x', 'chat_initial')
    const ctx = loggedCtx()
    const { requests, result, error } = await replay(c, () => cmd.msgList(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any).data).toEqual([
      { id: '10001:20002', peer: { id: '20002', name: 'Peer', url: 'https://x.com/peer_user' }, unread: null, last_message: null, updated_at: null },
      { id: 'g1790000000', peer: null, unread: null, last_message: null, updated_at: expect.stringMatching(/^2026-09-2[12]T/) },
    ])
  })

  it('msg history：消息端到端加密，只给出占位消息，原始事件挂在 raw 上', async () => {
    const c = loadCase('x', 'chat_conversation')
    const ctx = loggedCtx({ platform: 'x', args: { conversation: '10001:20002' } })
    const { requests, result, error } = await replay(c, () => cmd.msgHistory(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    const { data } = result as any
    expect(data.map((m: any) => [m.id, m.conversation_id, m.type, m.text, m[RAW]])).toEqual([
      ['0', '10001:20002', 'other', null, 'CAESBGZha2U='],
      ['1', '10001:20002', 'other', null, 'CAISBGZha2U='],
    ])
  })
})

describe('x 命令流程：cookie 登录', () => {
  useTempHome()

  it('auth login --cookie：Viewer 校验后落盘并设为当前账号；auth status 在线校验', async () => {
    const c = loadCase('x', 'viewer')
    const login = await replay(c, () => cli('x', 'auth', 'login', '--cookie', COOKIES))
    if (login.error) throw login.error
    expectRequests(login.requests, c.requests)
    const r = login.result as CliResult
    expect(r.code).toBe(0)
    // 没有当前账号时登录到 default，信封的 account 也是它
    expect(r.env.account).toBe('default')
    expect(r.env.data).toMatchObject({
      platform: 'x',
      endpoint: 'web',
      account: 'default',
      current: true,
      method: 'cookie',
      user: { id: '10001', name: '测试账号', url: 'https://x.com/catbus_test' },
    })
    const status = await replay(c, () => cli('x', 'auth', 'status'))
    if (status.error) throw status.error
    expectRequests(status.requests, c.requests)
    expect((status.result as CliResult).env.data).toMatchObject({ logged_in: true, user: { id: '10001' }, method: 'cookie' })
  })

  it('cookie 失效：Viewer 回 200 + code 32 → login 报 AUTH_REQUIRED 不落盘，status 为 logged_in false', async () => {
    const restore = mockSender(() =>
      fakeResponse({ data: { viewer: { has_community_memberships: false } }, errors: [{ code: 32, message: 'Authentication: Not authenticated' }] }),
    )
    try {
      const login = await cli('x', 'auth', 'login', '--cookie', COOKIES)
      expect(login.code).toBe(3)
      expect(login.env.error).toMatchObject({ code: 'AUTH_REQUIRED', message: '登录没有成功：cookie 无效或已过期' })
      expect((await cli('x', 'auth', 'list')).env.data).toEqual([])
      const status = await cmd.authStatus(loggedCtx())
      expect(status).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
    } finally {
      restore()
    }
  })
})

describe('x 命令与注册表', () => {
  it('默认 cookie 登录；账密登录报 NOT_IMPLEMENTED 并提示改用 cookie', async () => {
    const web = xPlatform.endpoints.web
    if (web === 'planned') throw new Error('web 端应当可用')
    expect(web.login).toMatchObject({ methods: ['password', 'cookie'], default: 'cookie' })
    const err = await cmd.authLogin(makeCtx({ platform: 'x', account: null, options: { method: 'password' } })).catch((e) => e)
    expect(err).toBeInstanceOf(CatbusError)
    expect(err).toMatchObject({ code: 'NOT_IMPLEMENTED', exitCode: 4, hint: 'catbus x auth login --method cookie --cookie "<cookie>"' })
  })

  it('cookie 登录缺 auth_token / ct0 时报 USAGE，不发请求', async () => {
    const err = await cmd.authLogin(makeCtx({ platform: 'x', account: null, options: { method: 'cookie', cookie: 'auth_token=a; twid=u%3D1' } })).catch((e) => e)
    expect(err).toMatchObject({ code: 'USAGE' })
  })

  it('游客 auth status：不发请求，logged_in 为 false', async () => {
    const restore = mockSender(() => {
      throw new Error('游客不应请求')
    })
    try {
      expect(await cmd.authStatus(guestCtx())).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
    } finally {
      restore()
    }
  })

  it('做不到的分支报 NOT_IMPLEMENTED：feed list --kind following；msg send 上游没有，是 planned', async () => {
    await expect(cmd.feedList(loggedCtx({ platform: 'x', options: { kind: 'following' } }))).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
    const web = xPlatform.endpoints.web
    if (web === 'planned') throw new Error('web 端应当可用')
    // 与 registry.test.ts 的「已移植」约定一致：✓ / ◐ 都有实现，○ 都是 planned
    for (const c of web.commands.values()) expect([c.key, c.status]).toEqual([c.key, c.upstream === 'none' ? 'planned' : 'implemented'])
    for (const key of ['item search', 'user search', 'comment list', 'feed list']) expect(web.commands.get(key)!.auth).toBe('required')
    expect(web.commands.get('msg send')!.status).toBe('planned')
  })

  it('发推选项：X 不支持的选项报 UNSUPPORTED，图片和视频不能同时带', async () => {
    await expect(cmd.itemPublish(loggedCtx({ platform: 'x', options: { text: 'a', title: 't', visibility: 'public' } }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(cmd.itemPublish(loggedCtx({ platform: 'x', options: { text: 'a', visibility: 'private' } }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    await expect(cmd.itemPublish(loggedCtx({ platform: 'x', options: { image: ['a.png'], video: 'b.mp4', visibility: 'public' } }))).rejects.toMatchObject({ code: 'USAGE' })
  })
})

describe('x 参数归一化', () => {
  it('推文 id：纯数字、x.com / twitter.com 链接', () => {
    expect(parseTweetId(TWEET_ID)).toBe(TWEET_ID)
    expect(parseTweetId(`https://x.com/elonmusk/status/${TWEET_ID}?s=20`)).toBe(TWEET_ID)
    expect(parseTweetId(`https://twitter.com/i/status/${TWEET_ID}`)).toBe(TWEET_ID)
    expect(() => parseTweetId('https://x.com/elonmusk')).toThrow(CatbusError)
  })

  it('用户：主页链接、@handle、裸用户名；纯数字按 rest_id', () => {
    expect(parseScreenName('https://x.com/ElonMusk/')).toBe('elonmusk')
    expect(parseScreenName('@ElonMusk')).toBe('elonmusk')
    expect(parseScreenName('elonmusk')).toBe('elonmusk')
    expect(isUserId(USER_ID)).toBe(true)
    expect(isUserId('@123')).toBe(false)
  })
})
