import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliCompressSync, deflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import type { Logger } from '../src/core/log.js'
import * as pb from '../src/core/pb.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import bilibili from '../src/platforms/bilibili/index.js'
import * as api from '../src/platforms/bilibili/web/api.js'
import { Bili, bili, check } from '../src/platforms/bilibili/web/client.js'
import * as commands from '../src/platforms/bilibili/web/commands.js'
import { CANVAS_1 } from '../src/platforms/bilibili/web/gaia.js'
import * as geetest from '../src/platforms/bilibili/web/geetest.js'
import * as norm from '../src/platforms/bilibili/web/normalize.js'
import { resolveDynamic, resolveFolder, resolveReplyTarget, resolveRoom } from '../src/platforms/bilibili/web/resolve.js'
import { av2bv, bv2av, encWbi, mixinKey, murmur3Hex } from '../src/platforms/bilibili/web/sign.js'
import { uploadVideo } from '../src/platforms/bilibili/web/upos.js'
import { expectRequests, type GoldenRequest, loadCase, makeCtx, replay } from './golden.js'

const COOKIES =
  'buvid3=FAKE-BUVID3-0000infoc; b_nut=1789990000; _uuid=FAKE-UUID-0000infoc; buvid4=FAKE-BUVID4-0000; ' +
  'buvid_fp=0123456789abcdef0123456789abcdef; SESSDATA=fake-sessdata; bili_jct=fakecsrf0123456789abcdef01234567; ' +
  'DedeUserID=10001; DedeUserID__ckMd5=fakeckmd5; bili_ticket=fake.ticket; bili_ticket_expires=1790259200; rpdid=fake|rpdid'
const MIXIN = 'ea1db124af3c7062474693fa704f4ff8'
const BVID = 'BV1GJ411x7h7'
const NOW = 1790000000123

/** 上传类用例的本地文件，内容与 gen.py 的 UPLOAD_DIR 一致。 */
const FIXTURES = mkdtempSync(join(tmpdir(), 'catbus-bili-'))
const COVER_FILE = join(FIXTURES, 'cover.JPG')
const IMAGE_FILE = join(FIXTURES, 'pic.png')
writeFileSync(COVER_FILE, 'fake-jpeg-bytes')
writeFileSync(IMAGE_FILE, Buffer.from('\x89PNG\r\n\x1a\nfake-png', 'latin1'))
afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }))

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
  // 上传：upos 三段、投稿封面（扩展名 .JPG → data:image/jpg，同上游）
  upos_upload: () => logged((b) => uploadVideo(b, { data: new Uint8Array(Buffer.from('0123456789')), filename: 'demo.mp4', contentType: 'video/mp4' })),
  upload_cover: () => logged((b) => commands.uploadCover(b, COVER_FILE)),
  // 续期的两步（correspond 的路径是 RSA-OAEP 随机加密，这里用定值）与短信 / 账密登录
  refresh_csrf: () => logged((b) => api.refreshCsrf(b, 'fakecorrespondpath')),
  cookie_refresh: () => logged((b) => api.cookieRefresh(b, 'fake-refresh-csrf', 'old-refresh-token')),
  sms_login: () => logged((b) => api.smsLogin(b, '13800000000', '123456', 'fake-captcha-key')),
  // 账密：gen.py 把 RSA-OAEP 加密换成定值 enc(salt+password)，这里照同样的值传入
  password_login: () =>
    logged(async (b) => {
      const key = await api.loginKey(b)
      return api.passwordLogin(b, 'user@example.com', `enc(${key.data.hash}+fake-password)`, { token: 'tk', challenge: 'ch', validate: 'va' })
    }),
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

/**
 * 上游 CurlMime.addpart 没给 content_type，libcurl 按文件扩展名补上（Curl_mime_contenttype：.png → image/png）；
 * catbus 显式给出同一个值。比较前把用例里文件段的 contentType 补成 libcurl 实际发的值。
 */
function withCurlContentType(requests: GoldenRequest[]): GoldenRequest[] {
  return requests.map((r) => (r.multipart ? { ...r, multipart: r.multipart.map((m) => (m.filename?.endsWith('.png') && m.contentType == null ? { ...m, contentType: 'image/png' } : m)) } : r))
}

describe('bilibili 对拍：上传的结果与动态配图', () => {
  it('upos_upload：返回投稿用的 filename、biz_id、key', async () => {
    const c = loadCase('bilibili', 'upos_upload')
    const { result } = await replay(c, CASES.upos_upload!)
    expect(result).toEqual(c.result)
  })

  it('upload_cover / refresh_csrf：取出上游同样的字段', async () => {
    const cover = loadCase('bilibili', 'upload_cover')
    expect((await replay(cover, CASES.upload_cover!)).result).toBe('https://archive.biliimg.com/bfs/archive/fakecover.jpg')
    const csrf = loadCase('bilibili', 'refresh_csrf')
    expect((await replay(csrf, CASES.refresh_csrf!)).result).toBe(csrf.result)
  })

  it('upload_dynamic_image：multipart 的字段与顺序', async () => {
    const c = loadCase('bilibili', 'upload_dynamic_image')
    const { requests, error } = await replay(c, () =>
      logged((b) => api.uploadDynamicImage(b, new Uint8Array(Buffer.from('\x89PNG\r\n\x1a\nfake-png', 'latin1')), 'pic.png', 'image/png')),
    )
    if (error) throw error
    expectRequests(requests, withCurlContentType(c.requests))
  })

  it('post_dynamic_image：dynamic publish --image 先传配图再发动态（上游 post_dynamic）', async () => {
    const c = loadCase('bilibili', 'post_dynamic_image')
    const ctx = { ...loggedCtx(), options: { text: '带图动态', image: [IMAGE_FILE] } }
    const { requests, result, error } = await replay(c, () => commands.dynamicPublish(ctx))
    if (error) throw error
    expectRequests(requests, withCurlContentType(c.requests))
    expect(result).toEqual({ id: '987654321098765432', url: 'https://t.bilibili.com/987654321098765432' })
  })
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

const web = () => {
  const ep = bilibili.endpoints.web
  if (ep === 'planned') throw new Error('web 是 planned')
  return ep
}

const ROOM = { room_id: 21452505, uid: 10002, live_status: 1 }
const GIFTS = {
  gift_data: { room_gift_list: { gold_list: [{ gift_id: 1 }, { gift_id: 31036 }] } },
  gift_config: {
    base_config: {
      list: [
        { id: 1, name: '辣条', price: 100, coin_type: 'silver' },
        { id: 31036, name: '小花花', price: 100, coin_type: 'gold' },
        { id: 9, name: '别的房间', price: 1000, coin_type: 'gold' },
      ],
    },
  },
}

/** 直播间命令的路由：room_init、getInfoByRoom、礼物面板，其余交给 extra。 */
function liveRoute(extra: (url: string) => unknown = () => ok({})) {
  return (url: string) => {
    if (url.includes('room_init')) return ok(ROOM)
    if (url.includes('getInfoByRoom')) return ok({ room_info: { parent_area_id: 2, area_id: 86 } })
    if (url.includes('roomGiftList')) return ok(GIFTS)
    return extra(url)
  }
}

describe('bilibili 命令：审查修复', () => {
  it('comment list 动态：业务错误带上「动态只支持纯文字和转发」', async () => {
    const { error } = await runCommand('commentList', { args: { item: 'https://t.bilibili.com/987654321098765432' } }, () => ({ code: 12002, message: '评论区已关闭' }))
    expect(error).toMatchObject({ code: 'UPSTREAM', hint: expect.stringContaining('动态只支持纯文字和转发') })
    // 稿件的评论区不带这条 hint
    const video = await runCommand('commentList', { args: { item: BVID } }, () => ({ code: 12002, message: '评论区已关闭' }))
    expect((video.error as CatbusError).hint).toBeNull()
  })

  it('comment list / add / delete：注册表标 ◐，note 说明动态的限制', () => {
    for (const key of ['comment list', 'comment add', 'comment delete']) {
      expect(web().commands.get(key)).toMatchObject({ upstream: 'partial', note: expect.stringContaining('动态只支持纯文字和转发') })
    }
  })

  it('dynamic delete：接受 dynamic publish 输出的 url', async () => {
    const { result, bodies } = await runCommand('dynamicDelete', { args: { id: 'https://t.bilibili.com/987654321098765432' } }, () => ok({}))
    expect(bodies[0]).toBe('{"dyn_id_str":"987654321098765432"}')
    expect(result).toEqual({ id: '987654321098765432' })
  })

  it('folder items：接受 folder list 输出的 url，只留稿件（非上游，没有对拍）', async () => {
    const media = { id: 1, type: 2, bvid: BVID, title: 'T', intro: 'I', upper: { mid: 2, name: 'U' }, pubtime: 1700000000, cover: 'http://i0.hdslb.com/c.jpg', cnt_info: { play: 3, collect: 4 } }
    const { result, urls } = await runCommand('folderItems', { args: { folder: 'https://space.bilibili.com/10001/favlist?fid=123456' }, cursor: '2' }, () =>
      ok({ medias: [media, { id: 2, type: 12, title: '音频' }], has_more: true }),
    )
    expect(urls).toEqual(['https://api.bilibili.com/x/v3/fav/resource/list?media_id=123456&pn=2&ps=20&keyword=&order=mtime&type=0&tid=0&platform=web&web_location=333.1387'])
    expect(result.page).toEqual({ cursor: '3', has_more: true })
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ id: BVID, kind: 'video', title: 'T', author: { id: '2', name: 'U' }, cover: 'https://i0.hdslb.com/c.jpg', stats: { views: 3, collects: 4 } })
    expect(web().commands.get('folder items')).toMatchObject({ upstream: 'partial', note: expect.stringContaining('非上游') })
  })

  it('item uncollect 不带 --folder：按 fav_state 找收着它的收藏夹', async () => {
    const { urls, bodies, result } = await runCommand('itemUncollect', { args: { item: BVID } }, (url) =>
      url.includes('list-all') ? ok({ list: [{ id: 11, fav_state: 0 }, { id: 22, fav_state: 1 }, { id: 33, fav_state: 1 }] }) : ok({}),
    )
    expect(urls[0]).toBe('https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=10001&type=2&rid=80433022&web_location=333.999')
    expect(bodies[1]).toContain('rid=80433022&type=2&del_media_ids=22%2C33&')
    expect(result).toEqual({ id: BVID })
  })

  it('item uncollect 不带 --folder：没有 fav_state 时从全部收藏夹移出；都没收着时不发请求', async () => {
    const all = await runCommand('itemUncollect', { args: { item: BVID } }, (url) => (url.includes('list-all') ? ok({ list: [{ id: 11 }, { id: 22 }] }) : ok({})))
    expect(all.bodies[1]).toContain('&del_media_ids=11%2C22&')
    const none = await runCommand('itemUncollect', { args: { item: BVID } }, () => ok({ list: [{ id: 11, fav_state: 0 }] }))
    expect(none.urls).toHaveLength(1)
    expect(none.result).toEqual({ id: BVID })
  })

  it('item collect：一个收藏夹都没有时报 UPSTREAM', async () => {
    const { error } = await runCommand('itemCollect', { args: { item: BVID } }, () => ok({ list: [] }))
    expect(error).toMatchObject({ code: 'UPSTREAM', message: '没有可用的收藏夹' })
  })

  it('item search --type article --sort collects：专栏没有「收藏多」，报 UNSUPPORTED 不发请求', async () => {
    const { error, urls } = await runCommand('itemSearch', { args: { keyword: '专栏' }, options: { type: 'article', sort: 'collects' } }, () => ok({}))
    expect(error).toMatchObject({ code: 'UNSUPPORTED' })
    expect(urls).toHaveLength(0)
    const video = await runCommand('itemSearch', { args: { keyword: '视频' }, options: { sort: 'collects' } }, () => ok({ result: [], numPages: 0 }))
    expect(video.urls[0]).toMatch(/order=stow&.*search_type=video/)
  })

  it('feed list：推荐流这一批为空时 has_more 为 false', async () => {
    const { result } = await runCommand('feedList', { cursor: '3:av_1' }, () => ok({ item: [] }))
    expect(result.page).toEqual({ cursor: null, has_more: false })
  })

  it('item media：DASH 取最高画质的视频轨（同画质取码率高的）和码率最高的音频轨（含 flac）', async () => {
    const dash = {
      duration: 10,
      video: [
        { id: 64, bandwidth: 900, baseUrl: 'https://v/64' },
        { id: 80, bandwidth: 100, baseUrl: 'https://v/80-low' },
        { id: 80, bandwidth: 300, base_url: 'https://v/80-high', width: 1920, height: 1080 },
      ],
      audio: [
        { id: 30216, bandwidth: 10, baseUrl: 'https://a/64k' },
        { id: 30280, bandwidth: 30, baseUrl: 'https://a/192k' },
      ],
      flac: { audio: { id: 30251, bandwidth: 900, baseUrl: 'https://a/flac' } },
    }
    const { result } = await runCommand('itemMedia', { args: { item: BVID } }, (url) => (url.includes('/wbi/view') ? ok({ bvid: BVID, cid: 1 }) : ok({ dash })))
    expect(result).toMatchObject([
      { id: '80', type: 'video', url: 'https://v/80-high', width: 1920, height: 1080, duration: 10 },
      { id: '30251', type: 'audio', url: 'https://a/flac', duration: 10 },
    ])
    const old = await runCommand('itemMedia', { args: { item: BVID } }, (url) =>
      url.includes('/wbi/view') ? ok({ bvid: BVID, cid: 1 }) : ok({ durl: [{ order: 1, url: 'https://v/1.flv', length: 5000 }] }),
    )
    expect(old.result).toMatchObject([{ id: '1', type: 'video', url: 'https://v/1.flv', duration: 5 }])
  })

  it('item subtitles：字幕 JSON 按行归一化', async () => {
    const { result } = await runCommand('itemSubtitles', { args: { item: BVID } }, (url) => {
      if (url.includes('/wbi/view')) return ok({ bvid: BVID, cid: 1 })
      if (url.includes('/player/wbi/v2')) return ok({ subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//aisubtitle.hdslb.com/bfs/x.json' }] } })
      return { body: [{ from: 0, to: 1.5, content: '你好' }] }
    })
    expect(result).toEqual([{ lang: 'zh-CN', name: '中文', url: 'https://aisubtitle.hdslb.com/bfs/x.json', lines: [{ from: 0, to: 1.5, text: '你好' }] }])
  })

  it('live gifts：只留本房间的礼物，金瓜子按 1000:1 换成元，银瓜子原样', async () => {
    const { result } = await runCommand('liveGifts', { args: { room: '21452505' } }, liveRoute())
    expect(result.map((g: any) => [g.id, g.name, g.price])).toEqual([
      ['1', '辣条', { amount: 100, currency: 'BILI_SILVER' }],
      ['31036', '小花花', { amount: 0.1, currency: 'CNY' }],
    ])
  })

  it('live send：弹幕和送礼都返回直播间 id', async () => {
    const chat = await runCommand('liveSend', { args: { room: '21452505', text: '你好' } }, liveRoute(() => ok({ mode_info: { extra: '{"id_str":"abc"}' } })))
    expect(chat.result).toEqual({ id: '21452505' })
  })

  it('live send --gift：背包里够数时走背包，否则按礼物面板的价格付费送', async () => {
    const bag = await runCommand('liveSend', { args: { room: '21452505' }, options: { gift: '1', count: 2 } }, liveRoute((url) =>
      url.includes('bag_list') ? ok({ list: [{ gift_id: 1, gift_num: 1, bag_id: 111 }, { gift_id: 1, gift_num: 5, bag_id: 555 }] }) : ok({}),
    ))
    expect(bag.urls.at(-1)).toContain('/xlive/revenue/v2/gift/sendBagMultiUser?')
    expect(bag.urls.at(-1)).toContain('gift_id=1&ruid=10002&send_ruid=0&gift_num=2&coin_type=silver&bag_id=555&')
    expect(bag.result).toEqual({ id: '21452505' })

    const paid = await runCommand('liveSend', { args: { room: '21452505' }, options: { gift: '31036' } }, liveRoute((url) => (url.includes('bag_list') ? ok({ list: [] }) : ok({}))))
    expect(paid.urls.at(-1)).toContain('/xlive/revenue/v2/gift/sendGoldMultiUser?')
    expect(paid.urls.at(-1)).toContain('gift_id=31036&ruid=10002&send_ruid=0&gift_num=1&coin_type=gold&bag_id=0&')
    expect(paid.urls.at(-1)).toContain('&price=100&')
    expect(paid.result).toEqual({ id: '21452505' })

    const missing = await runCommand('liveSend', { args: { room: '21452505' }, options: { gift: '404' } }, liveRoute((url) => (url.includes('bag_list') ? ok({ list: [] }) : ok({}))))
    expect(missing.error).toMatchObject({ code: 'USAGE' })
  })

  it('live start / stop：自己的直播间用 resolveRoom(me)', async () => {
    const { result, urls } = await runCommand('liveStart', { options: { category: '86' } }, (url) =>
      url.includes('getRoomInfoOld') ? ok({ roomid: 6, roomStatus: 1 }) : ok({ rtmp: { addr: 'rtmp://live-push/', code: 'k' } }),
    )
    expect(urls[0]).toBe('https://api.live.bilibili.com/room/v1/Room/getRoomInfoOld?mid=10001')
    expect(result).toEqual({ id: '6', push: { url: 'rtmp://live-push/', key: 'k' } })
    const none = await runCommand('liveStop', {}, () => ok({ roomStatus: 0 }))
    expect(none.error).toMatchObject({ code: 'UPSTREAM', message: '这个账号还没有开通直播间' })
  })

  it('article publish：没有 --cover（上游没有专栏封面），--category 是数字的专栏分区', () => {
    const cmd = web().commands.get('article publish')!
    expect(Object.keys(cmd.options)).not.toContain('cover')
    expect(cmd.options.category!.safeParse('3').success).toBe(true)
    expect(cmd.options.category!.safeParse('abc').success).toBe(false)
  })
})

/** 捕获 warn / info 的 logger。 */
function captureLog(): Logger & { lines: string[] } {
  const lines: string[] = []
  return { lines, debug() {}, info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`) }
}

describe('bilibili 续期（上游 refresh_cookies）', () => {
  /** 按 URL 回复续期链路；refresh 为 cookie/refresh 的回复。 */
  async function run(refresh: { setCookie: boolean; token?: string }, confirmCode = 0) {
    const ctx = loggedCtx()
    ctx.credential.scopes.main!.tokens.refresh_token = 'old-refresh-token'
    const log = captureLog()
    ctx.log = log
    const urls: string[] = []
    const bodies: (string | null)[] = []
    const restoreRand = deterministic({ now: NOW })
    const json = (body: object, headers: [string, string][] = []) => fakeResponse(body, { headers: [['content-type', 'application/json'], ...headers] })
    const restore = mockSender((p) => {
      urls.push(p.url)
      bodies.push(p.body == null ? null : Buffer.from(p.body).toString('utf8'))
      if (p.url.includes('cookie/info')) return json({ code: 0, data: { refresh: true, timestamp: NOW } })
      if (p.url.includes('/correspond/1/')) return fakeResponse('<div id="1-name">fake-refresh-csrf</div>', { headers: [['content-type', 'text/html']] })
      if (p.url.includes('cookie/refresh')) {
        const cookies: [string, string][] = refresh.setCookie
          ? [
              ['set-cookie', 'SESSDATA=new-sessdata; Path=/; Domain=bilibili.com'],
              ['set-cookie', 'bili_jct=newcsrf; Path=/; Domain=bilibili.com'],
            ]
          : []
        return json({ code: 0, data: refresh.token ? { refresh_token: refresh.token } : {} }, cookies)
      }
      return json({ code: confirmCode, message: confirmCode ? '确认失败' : '0' })
    })
    try {
      const b = await bili(ctx)
      return { b, ctx, log, urls, bodies }
    } finally {
      restore()
      restoreRand()
    }
  }

  it('换到新 SESSDATA 后用新 csrf、旧 refresh_token 确认，保存新的 refresh_token', async () => {
    const { b, ctx, log, urls, bodies } = await run({ setCookie: true, token: 'new-refresh-token' })
    expect(urls.map((u) => new URL(u).pathname)).toEqual([
      '/x/passport-login/web/cookie/info',
      expect.stringMatching(/^\/correspond\/1\/[0-9a-f]+$/),
      '/x/passport-login/web/cookie/refresh',
      '/x/passport-login/web/confirm/refresh',
    ])
    expect(bodies[2]).toBe('csrf=fakecsrf0123456789abcdef01234567&refresh_csrf=fake-refresh-csrf&source=main_web&refresh_token=old-refresh-token')
    expect(bodies[3]).toBe('csrf=newcsrf&refresh_token=old-refresh-token')
    expect(b.jar.get('SESSDATA')).toBe('new-sessdata')
    expect(ctx.credential.scopes.main!.tokens.refresh_token).toBe('new-refresh-token')
    expect(log.lines).toEqual(['info 登录态已自动续期'])
  })

  it('响应没带新 SESSDATA：不确认、不动 refresh_token，只警告', async () => {
    const { ctx, log, urls } = await run({ setCookie: false, token: 'new-refresh-token' })
    expect(urls).toHaveLength(3)
    expect(ctx.credential.scopes.main!.tokens.refresh_token).toBe('old-refresh-token')
    expect(log.lines).toEqual([expect.stringMatching(/^warn 登录态续期失败：.*没有带新的 SESSDATA/)])
  })

  it('确认失败：新 Cookie 照样保存，警告旧会话没有失效；响应没有新 refresh_token 时删掉旧的', async () => {
    const { ctx, log } = await run({ setCookie: true }, -101)
    expect(ctx.credential.scopes.main!.tokens.refresh_token).toBeUndefined()
    expect(log.lines).toEqual([expect.stringContaining('warn 续期响应没有新的 refresh_token'), expect.stringContaining('warn 登录态已续期，但确认更新失败')])
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
    await expect(t('什么')).rejects.toMatchObject({ code: 'USAGE', hint: expect.stringContaining('动态只支持纯文字和转发') })
  })

  it('动态与收藏夹参数：ID、链接都接受', async () => {
    const b = new Bili(loggedCtx())
    for (const s of ['987654321098765432', 'https://t.bilibili.com/987654321098765432?share=1', 'https://www.bilibili.com/opus/987654321098765432', 'dyn:987654321098765432']) {
      expect(await resolveDynamic(b, s)).toBe('987654321098765432')
    }
    await expect(resolveDynamic(b, 'abc')).rejects.toMatchObject({ code: 'USAGE' })
    for (const s of ['123456', 'https://space.bilibili.com/10001/favlist?fid=123456&ftype=create', 'https://www.bilibili.com/medialist/detail/ml123456', 'ml123456']) {
      expect(await resolveFolder(b, s)).toBe('123456')
    }
    await expect(resolveFolder(b, 'https://space.bilibili.com/10001/favlist')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('业务码：请求过于频繁和 -412 为 rate_limit，-352 为 blocked', () => {
    const kind = (code: number) => {
      try {
        check(loggedCtx(), { code, message: 'x', data: null })
      } catch (err) {
        return [(err as CatbusError).code, ((err as CatbusError).detail as { kind: string }).kind]
      }
    }
    expect(kind(-509)).toEqual(['RISK_CONTROL', 'rate_limit'])
    expect(kind(-799)).toEqual(['RISK_CONTROL', 'rate_limit'])
    expect(kind(-412)).toEqual(['RISK_CONTROL', 'rate_limit'])
    expect(kind(-352)).toEqual(['RISK_CONTROL', 'blocked'])
    expect(kind(340022)).toEqual(['RISK_CONTROL', 'captcha'])
  })

  it('稿件审核状态：state ≥ 0 已发布，打回 / 审核中按码表，其余为 null', () => {
    const status = (state: number) => norm.archive({ Archive: { bvid: BVID, state } }).status
    expect([0, 1].map(status)).toEqual(['published', 'published'])
    expect([-2, -4, -16, -100].map(status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected'])
    expect([-1, -6, -30, -40].map(status)).toEqual(['reviewing', 'reviewing', 'reviewing', 'reviewing'])
    expect(status(-999)).toBeNull()
  })

  it('视频弹幕 protobuf：idStr 优先，offset 为秒，按 ctime 出时间', () => {
    const W = pb.protobuf.Writer
    const elem = (id: number, progress: number, text: string, ctime: number, idStr?: string) => {
      const w = W.create().uint32(8).int64(id).uint32(16).int32(progress).uint32(58).string(text).uint32(64).int64(ctime)
      if (idStr) w.uint32(98).string(idStr)
      return w.finish()
    }
    const reply = W.create()
    for (const e of [elem(1, 12500, '第一条', 1700000000, '1234567890123456789'), elem(42, 0, '第二条', 1700000001)]) reply.uint32(10).bytes(e)
    expect(commands.decodeDanmaku(reply.finish(), BVID)).toEqual([
      { id: '1234567890123456789', item_id: BVID, offset: 12.5, text: '第一条', created_at: '2023-11-15T06:13:20+08:00' },
      { id: '42', item_id: BVID, offset: 0, text: '第二条', created_at: '2023-11-15T06:13:21+08:00' },
    ])
  })

  it('直播长连 pack / unpack：头 16 字节；zlib（ver 2）、brotli（ver 3）嵌套解开，op 3 为人气值', () => {
    const head = commands.pack(Buffer.from('ab'), 7, 0)
    expect([...head.subarray(0, 16)]).toEqual([0, 0, 0, 18, 0, 16, 0, 0, 0, 0, 0, 7, 0, 0, 0, 1])
    const chat = { cmd: 'DANMU_MSG', info: [[0, 1, 25, 16777215, 1700000000000], '弹幕', [7, '观众']] }
    const like = { cmd: 'LIKE_INFO_V3_CLICK', data: { uid: 8, uname: '点赞的' } }
    const plain = Buffer.concat([commands.pack(Buffer.from(JSON.stringify(chat)), 5, 0), commands.pack(Buffer.from(JSON.stringify(like)), 5, 0)])
    const zlib = commands.pack(deflateSync(plain), 5, 2)
    const brotli = commands.pack(brotliCompressSync(zlib), 5, 3)
    const heartbeat = commands.pack(Buffer.from([0, 0, 0x30, 0x39]), 3, 1)
    expect(commands.unpack(Buffer.concat([brotli, heartbeat]))).toEqual([
      [5, chat],
      [5, like],
      [3, 12345],
    ])
  })

  it('直播进场消息 INTERACT_WORD：1 进场，2 / 4 / 5 关注，3 分享为 other', () => {
    const t = (msg_type: number) => norm.liveEvent({ cmd: 'INTERACT_WORD', data: { msg_type, uid: 1, uname: 'u', timestamp: 1700000000 } })
    expect([1, 2, 4, 5].map((x) => t(x).type)).toEqual(['enter', 'follow', 'follow', 'follow'])
    expect(t(3)).toMatchObject({ type: 'other', text: '分享直播间', user: { id: '1' } })
    expect(t(9)).toMatchObject({ type: 'other', text: 'INTERACT_WORD' })
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
