import { describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/bilibili/web/api.js'
import { Bili } from '../src/platforms/bilibili/web/client.js'
import * as commands from '../src/platforms/bilibili/web/commands.js'
import { CANVAS_1 } from '../src/platforms/bilibili/web/gaia.js'
import * as geetest from '../src/platforms/bilibili/web/geetest.js'
import * as norm from '../src/platforms/bilibili/web/normalize.js'
import { resolveReplyTarget, resolveRoom } from '../src/platforms/bilibili/web/resolve.js'
import { av2bv, bv2av, encWbi, mixinKey, murmur3Hex } from '../src/platforms/bilibili/web/sign.js'
import { expectRequests, loadCase, makeCtx, replay } from './golden.js'

const COOKIES =
  'buvid3=FAKE-BUVID3-0000infoc; b_nut=1789990000; _uuid=FAKE-UUID-0000infoc; buvid4=FAKE-BUVID4-0000; ' +
  'buvid_fp=0123456789abcdef0123456789abcdef; SESSDATA=fake-sessdata; bili_jct=fakecsrf0123456789abcdef01234567; ' +
  'DedeUserID=10001; DedeUserID__ckMd5=fakeckmd5; bili_ticket=fake.ticket; bili_ticket_expires=1790259200; rpdid=fake|rpdid'
const MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
const BVID = 'BV1GJ411x7h7'
const NOW = 1790000000123

/** 登录态：与 gen.py 的 BiliAuth.from_cookie + 预置 mixin_key 一致。 */
function loggedCtx(withMixin = true) {
  return makeCtx({ platform: 'bilibili', cookies: COOKIES, cookieDomain: '.bilibili.com', extra: withMixin ? { wbi: { key: MIXIN, at: NOW } } : {} })
}

async function logged<T>(fn: (b: Bili) => Promise<T>, withMixin = true): Promise<T> {
  const b = new Bili(loggedCtx(withMixin))
  await b.init()
  return fn(b)
}

/** 用例名 → TS 侧的等价调用。 */
const CASES: Record<string, () => Promise<unknown>> = {
  search_video: () => logged((b) => api.searchType(b, '编程 入门', 'click', 2, 'video')),
  search_user: () => logged((b) => api.searchType(b, 'bilibili', 'totalrank', 1, 'bili_user')),
  search_article: () => logged((b) => api.searchType(b, '专栏 写作', 'pubdate', 2, 'article')),
  video_info_nav: () => logged((b) => api.videoInfo(b, BVID), false),
  video_detail: () => logged((b) => api.videoDetail(b, BVID)),
  user_info: () => logged((b) => api.userInfo(b, '2')),
  user_videos: () => logged((b) => api.userVideos(b, '2', 3, 42, 'click')),
  user_videos_keyword: () => logged((b) => api.userVideos(b, '2', 1, 42, 'pubdate', '教程 入门')),
  replies_p1: () => logged((b) => api.replies(b, 80433022)),
  replies_p2: () => logged((b) => api.replies(b, 80433022, 1, 2)),
  replies_article_latest: () => logged((b) => api.replies(b, 12345, 12, 1, 2)),
  replies_dynamic_p2: () => logged((b) => api.replies(b, '987654321098765432', 17, 2)),
  rcmd_feed: () => logged((b) => api.rcmdFeed(b, 2)),
  rcmd_feed_showlist: () => logged((b) => api.rcmdFeed(b, 3, 12, 'av_113,av_114')),
  popular: () => logged((b) => api.popular(b, 3)),
  play_url: () => logged((b) => api.playUrl(b, BVID, 137649199)),
  player_info: () => logged((b) => api.playerInfo(b, 80433022, 137649199)),
  danmaku_seg: () => logged((b) => api.danmakuSeg(b, 80433022, 137649199, 2)),
  nav: () => logged((b) => api.nav(b)),
  like: () => logged((b) => api.like(b, BVID, true)),
  unlike: () => logged((b) => api.like(b, BVID, false)),
  coin: () => logged((b) => api.addCoin(b, BVID, 2)),
  coin_like: () => logged((b) => api.addCoin(b, BVID, 1, true)),
  favour_add: () => logged((b) => api.favour(b, '80433022', '123')),
  favour_del: () => logged((b) => api.favour(b, '80433022', '', '123,456')),
  fav_folders: () => logged((b) => api.favFolders(b)),
  triple: () => logged((b) => api.triple(b, BVID)),
  reply_add: () => logged((b) => api.addReply(b, '80433022', '好看！ & ok')),
  reply_add_sub: () => logged((b) => api.addReply(b, '80433022', '回复', 1, 555, 555)),
  reply_add_nested: () => logged((b) => api.addReply(b, '80433022', '楼中楼', 1, 555, 666)),
  reply_add_article: () => logged((b) => api.addReply(b, '12345', '专栏评论', 12)),
  reply_delete: () => logged((b) => api.deleteReply(b, '80433022', '555')),
  reply_delete_dynamic: () => logged((b) => api.deleteReply(b, '987654321098765432', '777', 17)),
  video_danmaku: () => logged((b) => api.sendVideoDanmaku(b, '80433022', 137649199, '弹幕', 12500)),
  // 会话内的 rnd 序号接着上一条（第 2 条），与 gen.py 的顺序一致
  video_danmaku_style: () => logged((b) => api.sendVideoDanmaku(b, '80433022', 137649199, '顶部红字', 1000, { color: 16711680, fontsize: 18, mode: 5 })),
  archive_pre: () => logged((b) => api.archivePre(b)),
  my_archives: () => logged((b) => api.myArchives(b, 2)),
  submit_archive: () =>
    logged((b) =>
      api.submitArchive(b, { videos: [{ filename: 'n230101abc', biz_id: 999 }], title: '标题', tid: 17, tag: 'a,b', cover: 'https://x/c.jpg', desc: '描述', private: false }),
    ),
  submit_archive_repost: () =>
    logged((b) =>
      api.submitArchive(b, {
        videos: [
          { filename: 'n230101abc', biz_id: 999 },
          { filename: 'n230101def', title: 'P2', biz_id: 1000 },
        ],
        title: '标题',
        tid: 17,
        tag: 'a',
        copyright: 2,
        source: 'https://example.com/v',
        private: false,
        dynamic: '同步到动态',
        noReprint: 0,
      }),
    ),
  delete_archive: () => logged((b) => api.deleteArchive(b, '80433022')),
  delete_archive_validate: () => logged((b) => api.deleteArchive(b, '80433022', { validate: 'va', challenge: 'ch' })),
  remove_dynamic: () => logged((b) => api.removeDynamic(b, '987654321')),
  post_dynamic: () => logged((b) => api.createDynamic(b, '动态正文', [])),
  article_draft: () => logged((b) => api.saveArticleDraft(b, { title: '专栏', content: '<p>正文</p>', category: 2 })),
  article_submit: () => logged((b) => api.submitArticle(b, '777', { title: '专栏', content: '<p>正文</p>', category: 2 })),
  article_draft_full: () =>
    logged((b) => api.saveArticleDraft(b, { title: '专栏', content: '<p>正文</p>', category: 2, tags: 'a,b', summary: '摘要' }, '777')),
  article_submit_full: () =>
    logged((b) => api.submitArticle(b, '777', { title: '专栏', content: '<p>正文</p>', category: 2, tags: 'a,b', summary: '摘要' })),
  article_draft_view: () => logged((b) => api.articleDraft(b, '777')),
  article_draft_delete: () => logged((b) => api.deleteArticleDraft(b, '777')),
  room_init: () => logged((b) => api.roomInit(b, '6')),
  room_by_mid: () => logged((b) => api.roomByMid(b, '10001')),
  room_info: () => logged((b) => api.roomInfo(b, 21452505)),
  room_play_info: () => logged((b) => api.roomPlayInfo(b, 21452505)),
  danmu_info: () => logged((b) => api.danmuInfo(b, 21452505)),
  danmaku_history: () => logged((b) => api.danmakuHistory(b, 21452505)),
  gift_list: () => logged((b) => api.giftList(b, 21452505, 2, 86, 10002)),
  area_list: () => logged((b) => api.areaList(b)),
  bag_list: () => logged((b) => api.bagList(b, 21452505)),
  send_gift_gold: () => logged((b) => api.sendGift(b, 21452505, 10002, 31036, 2, 0, 'gold', 100)),
  send_gift_bag: () => logged((b) => api.sendGift(b, 21452505, 10002, 1, 1, 555)),
  live_danmaku: () => logged((b) => api.sendLiveDanmaku(b, 21452505, '直播弹幕')),
  live_danmaku_style: () =>
    logged((b) => api.sendLiveDanmaku(b, 21452505, '回复你', { color: 65280, fontsize: 18, mode: 4, replyMid: 10003, replyUname: '观众' })),
  start_live: () => logged((b) => api.startLive(b, 21452505, 86)),
  stop_live: () => logged((b) => api.stopLive(b, 21452505)),
  qrcode_generate: () => logged((b) => api.qrcodeGenerate(b)),
  qrcode_poll: () => logged((b) => api.qrcodePoll(b, 'fakeqrkey', CANVAS_1)),
  captcha: () => logged((b) => api.captcha(b)),
  sms_send: () => logged((b) => api.smsSend(b, '13800000000', { token: 'tk', challenge: 'ch', validate: 'va' })),
  login_key: () => logged((b) => api.loginKey(b)),
  cookie_info: () => logged((b) => api.cookieInfo(b)),
  confirm_refresh: () => logged((b) => api.confirmRefresh(b, 'old-refresh-token')),
  logout: () => logged((b) => api.logout(b)),
}

describe('bilibili 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('bilibili', name)
      const { requests, error } = await replay(c, run)
      if (error) throw error
      expectRequests(requests, c.requests)
    })
  }
})

describe('bilibili 对拍：命令流程', () => {
  it('游客 item get：匿名设备初始化（spi → bili_ticket → 指纹上报）后取稿件详情', async () => {
    const c = loadCase('bilibili', 'guest_item_get')
    const { itemGet } = await import('../src/platforms/bilibili/web/commands.js')
    const ctx = makeCtx({ platform: 'bilibili', account: 'guest', args: { item: BVID } })
    const { requests, result, error } = await replay(c, () => itemGet(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any)[RAW]).toEqual(c.result.data)
    expect(result).toMatchObject({ id: BVID, kind: 'video', url: `https://www.bilibili.com/video/${BVID}`, title: '测试视频', author: { id: '10001', name: 'UP' } })
    // 设备 cookie 留在游客凭证里，下次直接复用
    expect(ctx.credential.scopes.main!.cookies.map((x) => x.name)).toContain('buvid3')
  })
})

/** 登录态下跑一条命令，按 URL 路由回复假响应，返回结果与发出的请求 URL。 */
async function runCommand(
  name: keyof typeof commands,
  init: { args?: Record<string, string>; options?: Record<string, unknown>; cursor?: string | null },
  route: (url: string, body: unknown) => unknown,
) {
  const urls: string[] = []
  const bodies: unknown[] = []
  const restoreRand = deterministic({ now: NOW })
  const restore = mockSender((p) => {
    urls.push(p.url)
    bodies.push(p.body == null ? null : Buffer.from(p.body).toString('utf8'))
    return fakeResponse(route(p.url, p.body) as object, { headers: [['content-type', 'application/json']], url: p.url })
  })
  try {
    const ctx = { ...loggedCtx(), args: init.args ?? {}, options: init.options ?? {}, cursor: init.cursor ?? null }
    const run = commands[name] as (c: typeof ctx) => Promise<any>
    let result: any
    let error: unknown
    try {
      result = await run(ctx)
    } catch (err) {
      error = err
    }
    return { result, error, urls, bodies }
  } finally {
    restore()
    restoreRand()
  }
}

const ok = (data: unknown) => ({ code: 0, message: '0', data })

describe('bilibili 命令：本次补齐的能力', () => {
  it('item related：取 view/detail 的 Related，归一化成稿件', async () => {
    const related = { bvid: 'BV17x411w7KC', aid: 170001, title: '相关', pic: 'http://i0.hdslb.com/r.jpg', owner: { mid: 3, name: 'R' }, stat: { view: 9 }, pubdate: 1 }
    const { result, urls } = await runCommand('itemRelated', { args: { item: BVID } }, () => ok({ View: {}, Related: [related, { aid: 1 }] }))
    expect(urls[0]).toContain('/x/web-interface/wbi/view/detail?aid=80433022&p=1')
    expect(result.page).toEqual({ cursor: null, has_more: false })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: 'BV17x411w7KC', kind: 'video', title: '相关', cover: 'https://i0.hdslb.com/r.jpg', author: { id: '3', name: 'R' } })
  })

  it('item search --type article：走专栏搜索，id 为 cv 号', async () => {
    const v = { type: 'article', id: 42, mid: 7, title: '<em class="keyword">专栏</em>标题', desc: 'a &amp; b', image_urls: ['//i0.hdslb.com/c.jpg'], pub_time: 1700000000, view: 5, like: 6, reply: 7 }
    const { result, urls } = await runCommand('itemSearch', { args: { keyword: '专栏' }, options: { type: 'article', sort: 'latest' } }, () => ok({ result: [v], numPages: 1 }))
    expect(urls[0]).toMatch(/order=pubdate&.*search_type=article/)
    expect(result.data[0]).toMatchObject({
      id: 'cv42',
      kind: 'article',
      url: 'https://www.bilibili.com/read/cv42',
      title: '专栏标题',
      text: 'a & b',
      author: { id: '7' },
      cover: 'https://i0.hdslb.com/c.jpg',
      stats: { views: 5, likes: 6, comments: 7 },
    })
  })

  it('comment list：按参数识别评论区类型，--sort latest 用 mode=2', async () => {
    const { result, urls } = await runCommand('commentList', { args: { item: 'https://www.bilibili.com/read/cv12345' }, options: { sort: 'latest' } }, () =>
      ok({ replies: [{ rpid: 1, content: { message: 'hi' }, member: { mid: 2, uname: 'u' } }], cursor: { is_end: true } }),
    )
    expect(urls[0]).toContain('/x/v2/reply/wbi/main?oid=12345&type=12&mode=2&')
    expect(result.data[0]).toMatchObject({ id: '1', item_id: 'cv12345', text: 'hi' })
  })

  it('comment add --reply-to --root：root 与 parent 分开', async () => {
    const { bodies } = await runCommand('commentAdd', { args: { item: 'https://t.bilibili.com/987654321098765432', text: '回' }, options: { replyTo: '666', root: '555' } }, () =>
      ok({ rpid: 9 }),
    )
    expect(bodies[0]).toContain('oid=987654321098765432&type=17&')
    expect(bodies[0]).toContain('&root=555&parent=666&')
  })

  it('item collect / uncollect --folder：指定收藏夹，不再查收藏夹列表', async () => {
    const add = await runCommand('itemCollect', { args: { item: BVID }, options: { folder: '11,22' } }, () => ok({}))
    expect(add.urls).toHaveLength(1)
    expect(add.bodies[0]).toContain('rid=80433022&type=2&add_media_ids=11%2C22&')
    const del = await runCommand('itemUncollect', { args: { item: BVID }, options: { folder: '33' } }, () => ok({}))
    expect(del.urls).toHaveLength(1)
    expect(del.bodies[0]).toContain('&del_media_ids=33&')
  })

  it('item delete：人机验证时报 RISK_CONTROL，hint 说明原因', async () => {
    const { error } = await runCommand('itemDelete', { args: { item: BVID } }, () => ({ code: 340022, message: '验证码错误' }))
    expect(error).toBeInstanceOf(CatbusError)
    expect((error as CatbusError).code).toBe('RISK_CONTROL')
    expect((error as CatbusError).detail).toMatchObject({ kind: 'captcha', code: 340022 })
    expect((error as CatbusError).hint).toContain('极验')
  })

  it('live get：传主播空间链接时先按 get_room_by_mid 换成房间号', async () => {
    const { result, urls } = await runCommand('liveGet', { args: { room: 'https://space.bilibili.com/10002' } }, (url) => {
      if (url.includes('getRoomInfoOld')) return ok({ roomid: 21452505, roomStatus: 1 })
      if (url.includes('room_init')) return ok({ room_id: 21452505, uid: 10002, live_status: 1 })
      return ok({ room_info: { title: '直播', live_status: 1 }, anchor_info: { base_info: { uname: '主播' } } })
    })
    expect(urls[0]).toBe('https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=10002')
    expect(urls[1]).toBe('https://api.live.bilibili.com/room/v1/Room/room_init?id=21452505')
    expect(result).toMatchObject({ id: '21452505', status: 'live', host: { id: '10002', name: '主播' } })
  })

  it('live get：主播没开通直播间时报 UPSTREAM', async () => {
    const { error } = await runCommand('liveGet', { args: { room: 'uid:10002' } }, () => ok({ roomStatus: 0 }))
    expect((error as CatbusError).code).toBe('UPSTREAM')
  })

  it('feed list：游标带上一批的 last_showlist', async () => {
    const items = [
      { goto: 'av', id: 113, bvid: 'BV1a', is_followed: 0, owner: {} },
      { goto: 'av', id: 114, bvid: 'BV1b', is_followed: 1, owner: {} },
      { goto: 'live', id: 5, owner: {} },
    ]
    const first = await runCommand('feedList', {}, () => ok({ item: items }))
    expect(first.urls[0]).toContain('last_showlist=&')
    expect(first.result.page.cursor).toBe('2:av_113,av_n_114')
    expect(first.result.data.map((v: any) => v.id)).toEqual(['BV1a', 'BV1b'])
    const next = await runCommand('feedList', { cursor: first.result.page.cursor }, () => ok({ item: [] }))
    expect(next.urls[0]).toContain('fresh_idx=2&brush=2&')
    expect(next.urls[0]).toContain('last_showlist=av_113%2Cav_n_114&')
  })

  it('article publish --draft：只存草稿；draft get 归一化成 Item', async () => {
    const pub = await runCommand('articlePublish', { options: { title: 'T', text: '<p>x</p>', tag: ['a', 'b'], summary: 'S', draft: true } }, () => ok({ aid: 777 }))
    expect(pub.urls).toHaveLength(1)
    expect(pub.bodies[0]).toContain('summary=S&banner_url=&category=0&tags=a%2Cb&')
    expect(pub.result).toEqual({ id: '777', url: null })
    const got = await runCommand('draftGet', { args: { id: '777' } }, () => ok({ id: 777, title: 'T', content: '<p>x</p>', summary: 'S', ctime: 1700000000 }))
    expect(got.result).toMatchObject({ id: '777', kind: 'article', title: 'T', text: '<p>x</p>', status: 'draft', author: { id: '10001' } })
  })
})

describe('bilibili 纯算', () => {
  it('评论区类型：稿件 1、专栏 12、动态 17', async () => {
    const b = new Bili(loggedCtx())
    const t = (s: string) => resolveReplyTarget(b, s)
    expect(await t(BVID)).toEqual({ type: 1, oid: '80433022', itemId: BVID })
    expect(await t('av170001')).toEqual({ type: 1, oid: '170001', itemId: 'BV17x411w7KC' })
    expect(await t('cv12345')).toEqual({ type: 12, oid: '12345', itemId: 'cv12345' })
    expect(await t('https://www.bilibili.com/read/cv12345?spm=1')).toEqual({ type: 12, oid: '12345', itemId: 'cv12345' })
    expect(await t('https://www.bilibili.com/read/mobile?id=12345')).toMatchObject({ type: 12, oid: '12345' })
    expect(await t('https://t.bilibili.com/987654321098765432')).toEqual({ type: 17, oid: '987654321098765432', itemId: '987654321098765432' })
    expect(await t('https://www.bilibili.com/opus/987654321098765432')).toMatchObject({ type: 17 })
    expect(await t('987654321098765432')).toMatchObject({ type: 17 })
    expect(await t('2251799813685247')).toMatchObject({ type: 1, oid: '2251799813685247' })
    await expect(t('什么')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('直播间：纯数字与直播间链接不查主播', async () => {
    const b = new Bili(loggedCtx())
    expect(await resolveRoom(b, '6')).toBe('6')
    expect(await resolveRoom(b, 'https://live.bilibili.com/h5/21452505?x=1')).toBe('21452505')
    await expect(resolveRoom(b, 'abc')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('弹幕样式：颜色、字号、位置', () => {
    expect(commands.danmakuStyle({})).toEqual({})
    expect(commands.danmakuStyle({ color: '#FF0000', fontSize: 18, position: 'top' })).toEqual({ color: 16711680, fontsize: 18, mode: 5 })
    expect(commands.danmakuStyle({ color: '65280', position: 'bottom' })).toEqual({ color: 65280, mode: 4 })
  })

  it('推荐流游标：兼容只有页号的旧游标', () => {
    expect(commands.parseFeedCursor(null)).toEqual({ page: 1, showlist: '' })
    expect(commands.parseFeedCursor('3')).toEqual({ page: 3, showlist: '' })
    expect(commands.parseFeedCursor('4:av_1,av_n_2')).toEqual({ page: 4, showlist: 'av_1,av_n_2' })
  })

  it('直播长连：人气值与未映射的 cmd 输出为 other', () => {
    expect(norm.popularityEvent(1234)).toMatchObject({ type: 'other', text: '人气值 1234', user: null })
    expect(norm.liveEvent({ cmd: 'WATCHED_CHANGE', data: { num: 12000, text_large: '1.2万人看过' } })).toMatchObject({ type: 'other', text: '1.2万人看过' })
    expect(norm.liveEvent({ cmd: 'ONLINE_RANK_COUNT', data: { count: 3 } })).toMatchObject({ type: 'other', text: 'ONLINE_RANK_COUNT', user: null })
    expect(norm.liveEvent({ cmd: 'GUARD_BUY', data: { uid: 5, username: 'g', gift_name: '舰长', num: 1, start_time: 1700000000 } })).toMatchObject({
      type: 'gift',
      user: { id: '5', name: 'g' },
      gift: { name: '舰长', count: 1 },
    })
    expect(norm.liveEvent({ cmd: 'DANMU_MSG:4:0:2:2:2:0', info: [[0, 1, 25, 16777215, 1700000000000], '弹幕', [7, '观众']] })).toMatchObject({
      type: 'chat',
      text: '弹幕',
      user: { id: '7', name: '观众' },
    })
  })

  it('av / bv 互转', () => {
    expect(av2bv(170001)).toBe('BV17x411w7KC')
    expect(bv2av('BV17x411w7KC')).toBe('170001')
    expect(bv2av(av2bv('80433022'))).toBe('80433022')
  })

  it('WBI：签名串排序、剔除 !\'()*，发出的参数保持原顺序', () => {
    const key = mixinKey('https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png')
    expect(key).toBe(MIXIN)
    const signed = encWbi(
      [
        ['foo', '114'],
        ['bar', '514'],
        ['zab', 1919810],
      ],
      key,
      1702204169,
    )
    expect(signed).toEqual([
      ['foo', '114'],
      ['bar', '514'],
      ['zab', 1919810],
      ['w_rid', '8f6f2b5b3d485fe1886cec6a0be8c5d4'],
      ['wts', 1702204169],
    ])
  })

  it('murmur3_x64_128', () => {
    expect(murmur3Hex('')).toBe(murmur3Hex(''))
    expect(murmur3Hex('hello world', 31)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('极验自定义 base64 与 tt 混淆', () => {
    expect(geetest.customB64(Buffer.from('abc'))).toHaveLength(4)
    expect(geetest.customB64(Buffer.from('ab')).endsWith('.')).toBe(true)
    expect(geetest.csCipher('abcdef', null, '')).toBe('abcdef')
  })
})
