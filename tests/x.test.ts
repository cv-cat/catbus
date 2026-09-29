import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { RAW } from '../src/core/schemas.js'
import xPlatform from '../src/platforms/x/index.js'
import * as api from '../src/platforms/x/web/api.js'
import { markdownToContentState, splitTitle } from '../src/platforms/x/web/article.js'
import { XClient } from '../src/platforms/x/web/client.js'
import * as cmd from '../src/platforms/x/web/commands.js'
import { isUserId, parseArticleId, parseScreenName, parseTweetId } from '../src/platforms/x/web/resolve.js'
import { transaction } from '../src/platforms/x/web/transaction.js'
import { expectRequests, loadCase, makeCtx, replay } from './golden.js'
import { type CliResult, cli, useTempHome } from './helpers.js'

const COOKIES = 'auth_token=fakeauthtoken000000000000000000000000000000; ct0=fakect0000000000000000000000000000000000000000; twid=u%3D10001; lang=en'
const TWEET_ID = '1585341984679469056'
const USER_ID = '44196397'
const MEDIA_ID = '1790000000000000100'
const ARTICLE_ID = '1790000000000000200'

const loggedCtx = (extra: Parameters<typeof makeCtx>[0] = { platform: 'x' }) => makeCtx({ ...extra, platform: 'x', cookies: COOKIES, cookieDomain: '.x.com' })
/** 没有账号时 auth 命令拿到的空凭证（web 端不支持游客态，只有 auth status 会用到）。 */
const guestCtx = () => makeCtx({ platform: 'x', account: 'guest' })

async function logged<T>(fn: (x: XClient) => Promise<T>): Promise<T> {
  const x = new XClient(loggedCtx())
  await x.init()
  return fn(x)
}

const bytesOf = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

/** 用例名 → TS 侧的等价调用（与 scripts/golden/x/gen.py 一一对应）。 */
const CASES: Record<string, (input: any) => Promise<unknown>> = {
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
  chat_members: (input) => logged((x) => api.getUsersByIds(x, input.ids)),

  create_note_tweet: (input) => logged((x) => api.createNoteTweet(x, input.text, [], input.reply_to, input.quote)),
  search_media: () => logged((x) => api.searchWork(x, 'cat', undefined, 'Media')),
  search_media_cursor: () => logged((x) => api.searchWork(x, 'cat', 'MEDIA_NEXT', 'Media')),

  article_draft: () => logged((x) => api.articleCreateDraft(x)),
  article_title: (input) => logged((x) => api.articleUpdateTitle(x, input.article, input.title)),
  article_content: (input) => logged((x) => api.articleUpdateContent(x, input.article, input.state)),
  article_cover: (input) => logged((x) => api.articleUpdateCover(x, input.article, input.media)),
  article_publish: (input) => logged((x) => api.articlePublish(x, input.article)),
  article_delete: (input) => logged((x) => api.articleDelete(x, input.article)),
  article_upload_image: (input) => logged((x) => api.articleUploadImage(x, bytesOf(input.data), input.filename)),
}

describe('x 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('x', name)
      const { requests, result, error } = await replay(c, () => run(c.input))
      if (error) throw error
      expectRequests(requests, c.requests)
      if (name.startsWith('media_upload') || name === 'article_upload_image') expect(result).toBe(c.result)
    })
  }

  it('推文权重：twitter-text v3（拉丁 1、CJK / emoji 2、链接 23，emoji 修饰符不计），与上游 tweet_weight 一致', () => {
    const c = loadCase('x', 'tweet_weight')
    expect(c.input.texts.map(api.tweetWeight)).toEqual(c.result)
    expect(api.tweetWeight('a'.repeat(280))).toBe(api.TWEET_WEIGHT_LIMIT)
  })

  it('文章正文：Markdown → Draft.js content_state，块 key / 媒体实体 uuid 在同样的随机序列下与上游一致', async () => {
    const c = loadCase('x', 'article_markdown')
    const media = ['9001', '9002', '9003'][Symbol.iterator]()
    const { result, error } = await replay(c, async () => {
      const [title, body] = splitTitle(c.input.markdown)
      return {
        split: [title, body],
        split_none: splitTitle(c.input.markdown_no_title),
        state: await markdownToContentState(body, async () => media.next().value!),
        state_no_title: await markdownToContentState(c.input.markdown_no_title),
        state_edge: await markdownToContentState(c.input.markdown_edge, async () => media.next().value!),
      }
    })
    if (error) throw error
    expect(result).toEqual(c.result)
    // 正文有图片却没有上传方式时报错，不静默丢图
    await expect(markdownToContentState('![](a.png)')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('XCTID：固定时间与随机字节时与上游逐字节一致', () => {
    const c = loadCase('x', 'xctid')
    const path = '/i/api/graphql/KybxDj9RrADIITXlGG8kpw/UserByScreenName'
    const t = transaction()
    expect([t.generate('GET', path, 107075600, 0), t.generate('GET', path, 107075600, 58), t.generate('GET', path, 1, 255)]).toEqual(c.result)
  })
})

describe('x 对拍：命令流程', () => {
  it('user get：按用户名查 UserByScreenName，接受主页链接', async () => {
    const c = loadCase('x', 'user_info')
    const ctx = loggedCtx({ platform: 'x', args: { user: 'https://x.com/ElonMusk' } })
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
  })

  it('item get：TweetResultByRestId，视频推文取码率最高的 mp4', async () => {
    const c = loadCase('x', 'tweet_result')
    const ctx = loggedCtx({ platform: 'x', args: { item: TWEET_ID } })
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

  it('item get：推文已删除 / 不可见（tombstone、TweetUnavailable）时报 UPSTREAM，带上原因', async () => {
    const c = loadCase('x', 'tweet_result')
    for (const [result, reason] of [
      [{ __typename: 'TweetTombstone', tombstone: { text: { text: 'This Post was deleted by the Post author.' } } }, 'This Post was deleted by the Post author.'],
      [{ __typename: 'TweetUnavailable', reason: 'Protected' }, 'Protected'],
      [undefined, null],
    ] as const) {
      const gone = structuredClone(c)
      gone.responses[0]!.body = { data: { tweetResult: result ? { result } : {} } }
      const { error } = await replay(gone, () => cmd.itemGet(loggedCtx({ platform: 'x', args: { item: TWEET_ID } })))
      expect(error).toMatchObject({ code: 'UPSTREAM', message: `推文 ${TWEET_ID} 不存在或不可见${reason ? `：${reason}` : ''}` })
    }
  })

  it('user items：先按用户名查 rest_id，再取 UserOriginalsTimeline；跳过广告，拆开 TweetWithVisibilityResults', async () => {
    const c = loadCase('x', 'user_items')
    const ctx = loggedCtx({ platform: 'x', args: { user: '@ElonMusk' } })
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

  it('msg list：参与者只有 rest_id 时，用 GetUsersByIdsForXChat 补上对方的名字', async () => {
    const c = loadCase('x', 'chat_list_members')
    const { requests, result, error } = await replay(c, () => cmd.msgList(loggedCtx()))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any).data.map((v: any) => v.peer)).toEqual([
      { id: '20002', name: 'Peer', url: 'https://x.com/peer_user' },
      { id: '30003', name: '第三人', url: 'https://x.com/third_user' },
    ])
    expect((result as any).page).toEqual({ cursor: null, has_more: false })
  })

  it('item publish：正文超过 280 权重时自动改发长推（CreateNoteTweet），text 取 note_tweet 里的全文', async () => {
    const c = loadCase('x', 'post_long_tweet')
    const ctx = loggedCtx({ platform: 'x', options: { text: c.input.text, visibility: 'public' } })
    const { requests, result, error } = await replay(c, () => cmd.itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ id: '3001', kind: 'text', url: 'https://x.com/catbus_test/status/3001', text: c.input.text })
  })

  it('item publish --quote：给的是 ID 时先查出推文链接，作为 attachment_url 发推', async () => {
    const c = loadCase('x', 'post_quote')
    const ctx = loggedCtx({ platform: 'x', options: { text: c.input.text, quote: c.input.quote, visibility: 'public' } })
    const { requests, result, error } = await replay(c, () => cmd.itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ id: '3001' })
  })

  function threadCtx(c: ReturnType<typeof loadCase>) {
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    const file = join(dir, c.input.filename)
    writeFileSync(file, bytesOf(c.input.data))
    const [text, ...thread] = c.input.texts as string[]
    return loggedCtx({ platform: 'x', options: { text, image: [file], thread, visibility: 'public' } })
  }

  it('item publish --thread：第一条带图，之后每条回复上一条，超长的那条自动长推；返回第一条', async () => {
    const c = loadCase('x', 'post_thread')
    const { requests, result, error } = await replay(c, () => cmd.itemPublish(threadCtx(c)))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ id: '3001', kind: 'image' })
    expect(c.result).toEqual([true, '成功', ['3001', '3002', '3003']])
  })

  it('item publish --thread：中途失败时报错，detail 里给出已发出的各条', async () => {
    const c = loadCase('x', 'post_thread')
    const failed = structuredClone(c)
    failed.responses[5]!.body = { errors: [{ code: 186, message: 'Tweet needs to be a bit shorter.' }] }
    const { error } = await replay(failed, () => cmd.itemPublish(threadCtx(c)))
    expect(error).toBeInstanceOf(CatbusError)
    expect(error).toMatchObject({
      code: 'UPSTREAM',
      message: 'thread 第 2 条失败：CreateNoteTweet: Tweet needs to be a bit shorter.',
      detail: { posted: [{ id: '3001', url: 'https://x.com/catbus_test/status/3001' }] },
    })
  })

  it('item search --type image / video：媒体搜索（product=Media），推文在 search-grid 宫格模块里，按类型过滤；翻页从 TimelineAddToModule 取', async () => {
    const first = loadCase('x', 'search_media')
    const ctx = loggedCtx({ platform: 'x', args: { keyword: 'cat' }, options: { type: 'image' } })
    const r1 = await replay(first, () => cmd.itemSearch(ctx))
    if (r1.error) throw r1.error
    expectRequests(r1.requests, first.requests)
    expect((r1.result as any).data.map((i: any) => [i.id, i.kind])).toEqual([['1002', 'image']])
    expect((r1.result as any).page).toEqual({ cursor: 'MEDIA_NEXT', has_more: true })
    const video = await replay(first, () => cmd.itemSearch({ ...ctx, options: { type: 'video' } }))
    expect((video.result as any).data.map((i: any) => [i.id, i.kind])).toEqual([['1003', 'video']])

    // 第二页只有一张图：--type video 过滤后这一页是空的，但后面还有，has_more 仍为 true
    const next = loadCase('x', 'search_media_cursor')
    const r2 = await replay(next, () => cmd.itemSearch({ ...ctx, options: { type: 'video' }, cursor: 'MEDIA_NEXT' }))
    if (r2.error) throw r2.error
    expectRequests(r2.requests, next.requests)
    expect((r2.result as any).data).toEqual([])
    expect((r2.result as any).page).toEqual({ cursor: 'MEDIA_NEXT_2', has_more: true })
    const r3 = await replay(next, () => cmd.itemSearch({ ...ctx, cursor: 'MEDIA_NEXT' }))
    expect((r3.result as any).data.map((i: any) => i.id)).toEqual(['1005'])
  })

  function articleCtx(c: ReturnType<typeof loadCase>) {
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    const file = join(dir, c.input.filename)
    writeFileSync(file, bytesOf(c.input.data))
    // 正文里的 ![](photo.png) 按 Markdown 文件所在目录解析（上游 base_dir）；textFile 由 dispatch 读 --text @file 时给出
    return loggedCtx({ platform: 'x', options: { text: c.input.markdown, textFile: join(dir, 'post.md'), cover: file } })
  }

  it('article publish：传插图 → 建草稿 → 标题（取正文第一行 # 标题）→ 正文 → 传封面、设封面 → 发布', async () => {
    const c = loadCase('x', 'post_article')
    const ctx = articleCtx(c)
    const info = vi.spyOn(ctx.log, 'info')
    const { requests, result, error } = await replay(c, () => cmd.articlePublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ id: ARTICLE_ID, url: `https://x.com/i/article/${ARTICLE_ID}` })
    // 发布时生成的文章推文（上游 extract_tweet_id）只在 stderr 提示
    expect(info).toHaveBeenCalledWith('文章推文：https://x.com/i/status/4001')
  })

  it('article publish：草稿建好后失败时，detail 里给出草稿 id，提示删除', async () => {
    const c = loadCase('x', 'post_article')
    const failed = structuredClone(c)
    failed.responses.at(-1)!.body = { errors: [{ code: 399, message: 'Premium required' }] }
    const { error } = await replay(failed, () => cmd.articlePublish(articleCtx(c)))
    expect(error).toMatchObject({
      code: 'UPSTREAM',
      hint: `到 https://x.com/compose/articles/edit/${ARTICLE_ID} 查看，或 catbus x article delete ${ARTICLE_ID}`,
      detail: { article_id: ARTICLE_ID },
    })
  })

  it('article publish：没有 --title、正文第一行也不是 # 标题时报 USAGE，不发请求', async () => {
    const ctx = loggedCtx({ platform: 'x', options: { text: '正文\n\n## 小标题' } })
    await expect(cmd.articlePublish(ctx)).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('article delete：接受文章链接', async () => {
    const c = loadCase('x', 'article_delete')
    const ctx = loggedCtx({ platform: 'x', args: { article: `https://x.com/i/article/${ARTICLE_ID}` } })
    const { requests, result, error } = await replay(c, () => cmd.articleDelete(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ id: ARTICLE_ID })
  })
})

/** 时间线响应的骨架：一组 entry，末尾接底部游标。 */
const timelineOf = (entries: object[], bottom: string) => ({
  instructions: [{ type: 'TimelineAddEntries', entries: [...entries, { entryId: `cursor-bottom-${bottom}`, content: { cursorType: 'Bottom', value: bottom } }] }],
})

describe('x 命令流程：其余读写命令', () => {
  it('comment add：回复推文；正文超过 280 权重时和发推一样自动改发长推（CreateNoteTweet）', async () => {
    const c = loadCase('x', 'comment_add_long')
    const ctx = loggedCtx({ platform: 'x', args: { item: `https://x.com/elonmusk/status/${TWEET_ID}`, text: c.input.text } })
    const { requests, result, error } = await replay(c, () => cmd.commentAdd(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(requests[0]!.url).toContain('/CreateNoteTweet')
    expect(result).toMatchObject({ id: '3001', item_id: TWEET_ID, author: { id: '10001' }, text: c.input.text })
  })

  it('comment add --reply-to：短评论走 CreateTweet，回复那条评论', async () => {
    const c = loadCase('x', 'create_tweet_reply')
    const created = { data: { create_tweet: { tweet_results: { result: { rest_id: '3001', legacy: { id_str: '3001', full_text: 'reply', in_reply_to_status_id_str: '20' } } } } } }
    const ok = { ...c, responses: [{ ...c.responses[0]!, body: created }] }
    const ctx = loggedCtx({ platform: 'x', args: { item: TWEET_ID, text: 'reply' }, options: { replyTo: 'https://x.com/a/status/20' } })
    const { requests, result, error } = await replay(ok, () => cmd.commentAdd(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ id: '3001', item_id: TWEET_ID, parent_id: '20', text: 'reply' })
  })

  it('user search：SearchTimeline product=People，取 user- 条目', async () => {
    const c = loadCase('x', 'search_people')
    const user = { rest_id: USER_ID, core: { name: 'Elon Musk', screen_name: 'elonmusk' } }
    const entries = [{ entryId: `user-${USER_ID}`, content: { itemContent: { user_results: { result: user } } } }]
    const body = { data: { search_by_raw_query: { search_timeline: { timeline: timelineOf(entries, 'PEOPLE_NEXT') } } } }
    const ctx = loggedCtx({ platform: 'x', args: { keyword: 'elon' } })
    const { requests, result, error } = await replay({ ...c, responses: [{ ...c.responses[0]!, body }] }, () => cmd.userSearch(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any).data.map((u: any) => [u.id, u.handle, u.url])).toEqual([[USER_ID, 'elonmusk', 'https://x.com/elonmusk']])
    expect((result as any).page).toEqual({ cursor: 'PEOPLE_NEXT', has_more: true })
  })

  it('feed list：HomeTimeline，冷启动不带 cursor，翻页带 cursor；游标没变时算翻到底', async () => {
    const home = loadCase('x', 'home')
    const tweet = { rest_id: '1001', legacy: { id_str: '1001', full_text: '推荐' } }
    const entries = [{ entryId: 'tweet-1001', content: { itemContent: { tweet_results: { result: tweet } } } }]
    const body = { data: { home: { home_timeline_urt: timelineOf(entries, 'HOME_NEXT') } } }
    const ctx = loggedCtx({ platform: 'x' })
    const r1 = await replay({ ...home, responses: [{ ...home.responses[0]!, body }] }, () => cmd.feedList(ctx))
    if (r1.error) throw r1.error
    expectRequests(r1.requests, home.requests)
    expect(r1.result).toMatchObject({ data: [{ id: '1001', kind: 'text', text: '推荐' }], page: { cursor: 'HOME_NEXT', has_more: true } })

    const next = loadCase('x', 'home_cursor')
    const r2 = await replay({ ...next, responses: [{ ...next.responses[0]!, body }] }, () => cmd.feedList({ ...ctx, cursor: 'HOME_NEXT' }))
    if (r2.error) throw r2.error
    expectRequests(r2.requests, next.requests)
    expect((r2.result as any).page).toEqual({ cursor: null, has_more: false })
  })

  it('item download：视频取码率最高的 mp4，文件名 x_<id>_<序号>.mp4', async () => {
    const c = loadCase('x', 'tweet_result')
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    const video = { status: 200, headers: { 'content-type': 'video/mp4' }, body: { base64: Buffer.from('fake-mp4').toString('base64') } }
    const ctx = loggedCtx({ platform: 'x', args: { item: TWEET_ID }, options: { dir } })
    const { requests, result, error } = await replay({ ...c, responses: [...c.responses, video] }, () => cmd.itemDownload(ctx))
    if (error) throw error
    expectRequests(requests.slice(0, 1), c.requests)
    expect(requests[1]).toMatchObject({ method: 'GET', url: 'https://video.twimg.com/ext_tw_video/901/pu/vid/1280x720/high.mp4', cookies: [] })
    const path = join(dir, `x_${TWEET_ID}_1.mp4`)
    expect(result).toEqual([{ path, type: 'video', url: 'https://video.twimg.com/ext_tw_video/901/pu/vid/1280x720/high.mp4', size: 8 }])
    expect(readFileSync(path, 'utf8')).toBe('fake-mp4')
  })

  it('media upload：INIT → APPEND → FINALIZE → 登记元数据，返回 media_id 和图片尺寸', async () => {
    const c = loadCase('x', 'media_upload_image')
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    const file = join(dir, c.input.filename)
    writeFileSync(file, bytesOf(c.input.data))
    const { requests, result, error } = await replay(c, () => cmd.mediaUpload(loggedCtx({ platform: 'x', args: { file } })))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual({ id: MEDIA_ID, type: 'image', url: '', width: 1, height: 1, duration: null })
  })

  it('msg list：cookie 里没有 twid 时，查一次 Viewer 取自己的 id，不把自己当成对方', async () => {
    const c = loadCase('x', 'chat_initial')
    const viewer = loadCase('x', 'viewer')
    const cookies = COOKIES.replace(' twid=u%3D10001;', '')
    const ctx = makeCtx({ platform: 'x', cookies, cookieDomain: '.x.com' })
    const urls: string[] = []
    const restore = mockSender((p) => {
      urls.push(p.url.split('?')[0]!)
      return fakeResponse((p.url.includes('/Viewer') ? viewer : c).responses[0]!.body as object)
    })
    try {
      const { data } = await cmd.msgList(ctx)
      expect(data[0]!.peer).toEqual({ id: '20002', name: 'Peer', url: 'https://x.com/peer_user' })
    } finally {
      restore()
    }
    expect(urls.map((u) => u.split('/').at(-1))).toEqual(['GetInitialXChatPageQuery', 'Viewer'])
  })
})

describe('x 错误映射（AGENTS 6.4）', () => {
  const follow = loadCase('x', 'follow')
  const tweet = loadCase('x', 'favorite')
  const run = async (c: ReturnType<typeof loadCase>, status: number, body: unknown, fn: (ctx: ReturnType<typeof loggedCtx>) => Promise<unknown>) => {
    const r = await replay({ ...c, responses: [{ status, headers: { 'content-type': 'application/json' }, body }] }, () => fn(loggedCtx({ platform: 'x', args: { user: USER_ID, item: TWEET_ID } })))
    return r.error as CatbusError
  }

  it('REST 的业务拒绝也是 403：按 errors 里的错误码报 UPSTREAM，不当成登录态失效', async () => {
    const err = await run(follow, 403, { errors: [{ code: 160, message: "You've already requested to follow." }] }, cmd.userFollow)
    expect(err).toMatchObject({ code: 'UPSTREAM', message: "/1.1/friendships/create.json: You've already requested to follow.", detail: { code: 160, status: 403 } })
  })

  it('401 / 403 带会话类错误码（32、353）或没有错误码 → AUTH_EXPIRED', async () => {
    expect(await run(follow, 403, { errors: [{ code: 353, message: 'This request requires a matching csrf cookie and header.' }] }, cmd.userFollow)).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(await run(tweet, 401, { errors: [{ code: 32, message: 'Could not authenticate you.' }] }, cmd.itemLike)).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(await run(tweet, 403, '', cmd.itemLike)).toMatchObject({ code: 'AUTH_EXPIRED', hint: 'catbus x auth login -a default' })
  })

  it('限流 / 风控：429 或 errors 里的 88 / 226 / 344 → RISK_CONTROL；其余 → UPSTREAM', async () => {
    expect(await run(tweet, 429, { errors: [{ code: 88, message: 'Rate limit exceeded' }] }, cmd.itemLike)).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'rate_limit', code: 88, status: 429 } })
    expect(await run(tweet, 429, 'Too Many Requests', cmd.itemLike)).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'rate_limit', status: 429 } })
    // mutation 在 200 里回 errors 也算失败（上游 graphql_post）
    expect(await run(tweet, 200, { errors: [{ code: 226, message: 'This request looks like it might be automated.' }] }, cmd.itemLike)).toMatchObject({
      code: 'RISK_CONTROL',
      detail: { kind: 'blocked', code: 226 },
    })
    expect(await run(tweet, 200, { errors: [{ code: 144, message: 'No status found with that ID.' }] }, cmd.itemLike)).toMatchObject({
      code: 'UPSTREAM',
      message: 'FavoriteTweet: No status found with that ID.',
      detail: { code: 144, operation: 'FavoriteTweet' },
    })
    expect(await run(tweet, 500, 'oops', cmd.itemLike)).toMatchObject({ code: 'UPSTREAM', detail: { status: 500, body: 'oops' } })
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

  it('article publish --text @file：正文里 ![](相对路径) 按 Markdown 文件所在目录解析（上游 base_dir），不按当前目录', async () => {
    const viewer = loadCase('x', 'viewer')
    const login = await replay(viewer, () => cli('x', 'auth', 'login', '--cookie', COOKIES))
    expect((login.result as CliResult).code).toBe(0)
    const c = loadCase('x', 'post_article')
    const dir = mkdtempSync(join(tmpdir(), 'catbus-x-'))
    writeFileSync(join(dir, c.input.filename), bytesOf(c.input.data))
    const md = join(dir, 'post.md')
    writeFileSync(md, c.input.markdown)
    // 封面是命令行参数，按当前目录解析，这里给绝对路径
    const { requests, result, error } = await replay(c, () => cli('x', 'article', 'publish', '--text', `@${md}`, '--cover', join(dir, c.input.filename), '-q'))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as CliResult).env).toMatchObject({ ok: true, data: { id: ARTICLE_ID, url: `https://x.com/i/article/${ARTICLE_ID}` } })
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
  useTempHome()

  it('只支持 cookie 登录：账密登录不移植，--method password 报 UNSUPPORTED', async () => {
    const web = xPlatform.endpoints.web
    if (web === 'planned') throw new Error('web 端应当可用')
    expect(web.login).toEqual({ methods: ['cookie'], default: 'cookie' })
    const r = await cli('x', 'auth', 'login', '--method', 'password')
    expect([r.code, r.env.error?.code]).toEqual([2, 'UNSUPPORTED'])
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

  it('item search：--type video / image 不能和 --sort latest 一起用；--type 只有 all / video / image', async () => {
    const ctx = loggedCtx({ platform: 'x', args: { keyword: 'cat' }, options: { type: 'video', sort: 'latest' } })
    await expect(cmd.itemSearch(ctx)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    const r = await cli('x', 'item', 'search', 'cat', '--type', 'article')
    expect([r.code, r.env.error?.code]).toEqual([2, 'UNSUPPORTED'])
  })

  it('扩展命令 article publish / delete；--quote、--thread 只挂在 x 的 item publish 上', () => {
    const web = xPlatform.endpoints.web
    if (web === 'planned') throw new Error('web 端应当可用')
    expect(web.commands.get('article publish')).toMatchObject({ extension: true, output: '{id url}', status: 'implemented' })
    expect(web.commands.get('article delete')).toMatchObject({ extension: true, output: '{id}', confirm: true })
    expect(Object.keys(web.commands.get('item publish')!.options)).toEqual(expect.arrayContaining(['quote', 'thread']))
    expect(web.commands.get('msg list')).toMatchObject({ upstream: 'partial', status: 'implemented' })
  })

  it('发推选项：X 不支持的选项报 UNSUPPORTED，图片和视频不能同时带', async () => {
    expect((await cli('x', 'item', 'publish', '--text', 'a', '--title', 't')).env.error).toMatchObject({ code: 'UNSUPPORTED', message: 'x 的 item publish 不支持 --title' })
    expect((await cli('x', 'item', 'publish', '--text', 'a', '--visibility', 'private')).env.error).toMatchObject({ code: 'UNSUPPORTED', hint: '可选：public' })
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

  it('文章：纯数字、文章链接、编辑页链接', () => {
    expect(parseArticleId(ARTICLE_ID)).toBe(ARTICLE_ID)
    expect(parseArticleId(`https://x.com/i/article/${ARTICLE_ID}`)).toBe(ARTICLE_ID)
    expect(parseArticleId(`https://x.com/compose/articles/edit/${ARTICLE_ID}`)).toBe(ARTICLE_ID)
    expect(() => parseArticleId(`https://x.com/a/status/${TWEET_ID}`)).toThrow(CatbusError)
  })
})
