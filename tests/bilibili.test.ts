import { describe, expect, it } from 'vitest'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/bilibili/web/api.js'
import { Bili } from '../src/platforms/bilibili/web/client.js'
import { CANVAS_1 } from '../src/platforms/bilibili/web/gaia.js'
import * as geetest from '../src/platforms/bilibili/web/geetest.js'
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
  video_info_nav: () => logged((b) => api.videoInfo(b, BVID), false),
  user_info: () => logged((b) => api.userInfo(b, '2')),
  user_videos: () => logged((b) => api.userVideos(b, '2', 3, 42, 'click')),
  replies_p1: () => logged((b) => api.replies(b, 80433022)),
  replies_p2: () => logged((b) => api.replies(b, 80433022, 1, 2)),
  rcmd_feed: () => logged((b) => api.rcmdFeed(b, 2)),
  popular: () => logged((b) => api.popular(b, 3)),
  play_url: () => logged((b) => api.playUrl(b, BVID, 137649199)),
  player_info: () => logged((b) => api.playerInfo(b, 80433022, 137649199)),
  danmaku_seg: () => logged((b) => api.danmakuSeg(b, 80433022, 137649199, 2)),
  nav: () => logged((b) => api.nav(b)),
  like: () => logged((b) => api.like(b, BVID, true)),
  unlike: () => logged((b) => api.like(b, BVID, false)),
  coin: () => logged((b) => api.addCoin(b, BVID, 2)),
  favour_add: () => logged((b) => api.favour(b, '80433022', '123')),
  favour_del: () => logged((b) => api.favour(b, '80433022', '', '123,456')),
  fav_folders: () => logged((b) => api.favFolders(b)),
  triple: () => logged((b) => api.triple(b, BVID)),
  reply_add: () => logged((b) => api.addReply(b, '80433022', '好看！ & ok')),
  reply_add_sub: () => logged((b) => api.addReply(b, '80433022', '回复', 1, 555, 555)),
  reply_delete: () => logged((b) => api.deleteReply(b, '80433022', '555')),
  video_danmaku: () => logged((b) => api.sendVideoDanmaku(b, '80433022', 137649199, '弹幕', 12500)),
  archive_pre: () => logged((b) => api.archivePre(b)),
  my_archives: () => logged((b) => api.myArchives(b, 2)),
  submit_archive: () =>
    logged((b) =>
      api.submitArchive(b, { videos: [{ filename: 'n230101abc', biz_id: 999 }], title: '标题', tid: 17, tag: 'a,b', cover: 'https://x/c.jpg', desc: '描述', private: false }),
    ),
  delete_archive: () => logged((b) => api.deleteArchive(b, '80433022')),
  remove_dynamic: () => logged((b) => api.removeDynamic(b, '987654321')),
  post_dynamic: () => logged((b) => api.createDynamic(b, '动态正文', [])),
  article_draft: () => logged((b) => api.saveArticleDraft(b, '专栏', '<p>正文</p>', 2)),
  article_submit: () => logged((b) => api.submitArticle(b, '777', '专栏', '<p>正文</p>', 2)),
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

describe('bilibili 纯算', () => {
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
