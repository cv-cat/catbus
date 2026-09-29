import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as rand from '../src/core/rand.js'
import type { LocalMedia } from '../src/core/files.js'
import { fakeResponse, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/douyin/web/api.js'
import { Douyin } from '../src/platforms/douyin/web/client.js'
import * as creator from '../src/platforms/douyin/web/creator.js'
import { crc32Hex } from '../src/platforms/douyin/web/crypto.js'
import { buildBlob, computedFeatures, defaultProfile, murmur3 } from '../src/platforms/douyin/web/dtrait.js'
import * as im from '../src/platforms/douyin/web/im.js'
import * as live from '../src/platforms/douyin/web/live.js'
import { Passport } from '../src/platforms/douyin/web/passport.js'
import * as proto from '../src/platforms/douyin/web/proto.js'
import { commonBehavior, commonReport, strDataReport } from '../src/platforms/douyin/web/mssdk.js'
import { ABogus, fakeWebid, liveSignature, randomMsToken, signedUrl, sm3, spliceUrl, svWebId, XBogus } from '../src/platforms/douyin/web/sign.js'
import { type GoldenCase, type GoldenRequest, loadCase, makeCtx, normalize, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

const NOW = 1790000000123
const SEC_UID = 'MS4wLjABAAAAfakeSecUid0123456789abcdef'
const AWEME = '7433523124836060416'

/** 请求序列逐字节比较（cookie 的顺序也比较）。私信的 protobuf body 解码后比较：上游 upb 的 map 按哈希顺序序列化。 */
function expectReqs(actual: GoldenRequest[], expected: GoldenRequest[]): void {
  const view = (r: GoldenRequest) => (r.url.startsWith('https://imapi.douyin.com/') && r.body && typeof r.body === 'object' ? { ...r, body: pbBody(r.body.base64) } : r)
  actual.slice(0, expected.length).forEach((r, i) => expect(view(r), `第 ${i + 1} 个请求：${r.method} ${r.url}`).toEqual(view(expected[i]!)))
  expect(actual.map((r) => `${r.method} ${r.url}`)).toEqual(expected.map((r) => `${r.method} ${r.url}`))
}

function pbBody(b64: string): unknown {
  return proto.decode('Request', 'Request', Buffer.from(b64, 'base64'))
}

/** golden.ts 的 replay 加上二进制响应（{base64}）的支持。 */
async function replayBin<T>(c: GoldenCase, run: () => Promise<T>): Promise<{ requests: GoldenRequest[]; result?: T; error?: unknown }> {
  const requests: GoldenRequest[] = []
  const restoreRand = rand.deterministic({ seed: c.seed, now: c.now })
  const restoreSender = mockSender((p) => {
    requests.push(normalize(p))
    const r = c.responses[requests.length - 1]
    if (!r) throw new Error(`TS 实现多发了请求：${p.method} ${p.url}`)
    return goldenReply(r, p.url)
  })
  try {
    return { requests, result: await run() }
  } catch (error) {
    return { requests, error }
  } finally {
    restoreSender()
    restoreRand()
  }
}

const media = (b64: string, filename = 'file.bin'): LocalMedia => ({ data: new Uint8Array(Buffer.from(b64, 'base64')), filename, contentType: 'application/octet-stream' })

/** 登录态：与 gen.py 的 logged_auth 一致（msToken、webid、uid 已缓存）。 */
function loggedCtx(c: GoldenCase) {
  const ctx = makeCtx({ platform: 'douyin', cookies: c.input.cookies, cookieDomain: '.douyin.com' })
  const tokens = ctx.credential.scopes.main!.tokens
  Object.assign(tokens, { ticket: c.input.ticket, ts_sign: c.input.ts_sign, client_cert: c.input.client_cert, webid: c.input.webid, uid: c.input.uid })
  tokens.msToken = { value: c.input.ms_token, at: NOW }
  Object.assign(ctx.credential.device, { private_key: c.input.private_key, dtrait_blob: c.input.dtrait_blob })
  if (c.input.dtrait_profile) ctx.credential.device.dtrait_profile = c.input.dtrait_profile
  return ctx
}

async function logged<T>(c: GoldenCase, fn: (d: Douyin) => Promise<T>): Promise<T> {
  const d = new Douyin(loggedCtx(c))
  await d.init()
  return fn(d)
}

type Run = (c: GoldenCase) => Promise<unknown>

const CASES: Record<string, Run> = {
  work_info: (c) => logged(c, (d) => api.workInfo(d, AWEME)),
  user_works: (c) => logged(c, (d) => api.userWorks(d, SEC_UID, '0')),
  user_works_p2: (c) => logged(c, (d) => api.userWorks(d, SEC_UID, '1735660800000')),
  comments: (c) => logged(c, (d) => api.comments(d, AWEME, '10')),
  replies: (c) => logged(c, (d) => api.replies(d, AWEME, c.input.cid, '0', '10')),
  user_info: (c) => logged(c, (d) => api.userInfo(d, SEC_UID)),
  search_general: (c) => logged(c, (d) => api.searchGeneral(d, '美食 探店', '15')),
  search_user: (c) => logged(c, (d) => api.searchUser(d, '巴旦木公主')),
  search_live: (c) => logged(c, (d) => api.searchLive(d, '三角洲', '15')),
  user_favorite: (c) => logged(c, (d) => api.userFavorite(d, SEC_UID)),
  collect_list: (c) => logged(c, (d) => api.collectList(d)),
  followers: (c) => logged(c, (d) => api.followers(d, c.input.user_id, SEC_UID)),
  following: (c) => logged(c, (d) => api.following(d, c.input.user_id, SEC_UID, '1735660800')),
  notices: (c) => logged(c, (d) => api.notices(d, '1735660000', '1735660800')),
  feed: (c) => logged(c, (d) => api.feed(d, '20', '3')),
  my_uid: (c) => logged(c, (d) => api.myUid(d)),
  device_id: (c) => logged(c, (d) => api.deviceId(d)),
  my_sec_uid: (c) => logged(c, (d) => api.mySecUid(d)),
  digg: (c) => logged(c, (d) => api.digg(d, AWEME, '1')),
  undigg: (c) => logged(c, (d) => api.digg(d, AWEME, '0')),
  collect: (c) => logged(c, (d) => api.collect(d, AWEME, '1')),
  uncollect: (c) => logged(c, (d) => api.collect(d, AWEME, '0')),
  comment_publish: (c) => logged(c, (d) => api.publishComment(d, AWEME, '好看！ & ok')),
  comment_reply: (c) => logged(c, (d) => api.publishComment(d, AWEME, '回复', c.input.reply_id)),
  digg_uid: (c) =>
    logged(c, (d) => {
      delete d.tokens.uid
      return api.digg(d, AWEME, '1')
    }),
  live_info: (c) => logged(c, (d) => api.liveInfo(d, c.input.web_rid)),
  live_room_enter: (c) => logged(c, (d) => api.liveRoomEnter(d, c.input.web_rid)),
  live_rank: (c) => logged(c, (d) => api.liveRank(d, c.input.room_id, c.input.anchor_id, c.input.sec_uid, c.input.web_rid)),
  live_production: (c) => logged(c, (d) => api.liveProduction(d, c.input.url, c.input.room_id, c.input.anchor_id)),
  product_detail: (c) => logged(c, (d) => api.productDetail(d, 'https://live.douyin.com/', c.input.promotion_id)),
  product_comments: (c) => logged(c, (d) => api.productComments(d, c.input.product_id, c.input.shop_id, '10')),
  webcast_fetch: (c) => logged(c, (d) => api.webcastFetch(d, c.input.user_id, c.input.room_id, `https://live.douyin.com/852953608964`)),
  live_like: (c) => logged(c, (d) => api.liveLike(d, c.input.room_id, '1')),
  live_chat: (c) => logged(c, (d) => api.liveChat(d, c.input.room_id, c.input.content, c.input.web_rid)),
  mstoken_renew: (c) =>
    logged(c, (d) => {
      ;(d.tokens.msToken as any).at = 0
      return d.msToken()
    }),
  mstoken_common: (c) => logged(c, (d) => api.commonMstoken(d, c.input.ms_token, commonReport())),
  mstoken_common_sms: (c) => logged(c, (d) => api.commonMstoken(d, c.input.ms_token, commonReport(6383, 6241, true))),
  mstoken_behavior: (c) => logged(c, (d) => api.commonMstoken(d, c.input.ms_token, commonBehavior())),
  server_cert: (c) => logged(c, (d) => api.serverCert(d, 2906, c.input.cookies, 'https://creator.douyin.com')),
  im_create: (c) => logged(c, (d) => im.createConversation(d, c.input.to_uid)),
  im_send_text: (c) =>
    logged(c, (d) => im.sendMessage(d, { conversationId: c.input.conversation_id, shortId: c.input.short_id, ticket: c.input.conv_ticket }, 7, im.textContent(c.input.text))),
  comment_publish_ecdsa: (c) => logged(c, (d) => api.publishComment(d, AWEME, 'ecdsa')),
  im_upload_image: (c) => logged(c, (d) => im.uploadImage(d, media(c.input.png))),
  im_send_image: (c) =>
    logged(c, async (d) => {
      const content = await im.uploadImage(d, media(PNG))
      return im.sendMessage(d, { conversationId: CONV_ID, shortId: '7400000000000000123', ticket: 'fake-conv-ticket' }, 27, content)
    }),
  post_images: (c) => logged(c, (d) => creator.postImages(d, [media(PNG), media(PNG)], { title: c.input.title, desc: c.input.desc, visibility: 0 })),
  post_video_cover: (c) => logged(c, (d) => creator.postVideo(d, media(c.input.video), media(PNG), { title: c.input.title, desc: c.input.desc, visibility: 2 })),
  post_video: (c) => logged(c, (d) => creator.postVideo(d, media(c.input.video), null, { title: c.input.title, desc: c.input.desc, visibility: 0, timing: c.input.timing })),
  media_upload_image: (c) =>
    logged(c, async (d) => {
      await creator.bootstrap(d)
      const sts = await creator.uploadAuth(d, creator.POST_IMAGE_REFERER)
      const info = await creator.uploadImage(d, sts, media(PNG), '')
      return [info, await creator.mediaUrl(d, info.uri)]
    }),

  // ---------------------------------------------------------------- 第三部分（gen_gap.py）
  search_general_filter: (c) =>
    logged(c, (d) => api.searchGeneral(d, '美食', '0', '', { sortType: '2', publishTime: '7', filterDuration: '1-5', searchRange: '3', contentType: '2' })),
  search_video: (c) => logged(c, (d) => api.searchVideo(d, '美食 探店', '0', '16', { sortType: '1', publishTime: '180', filterDuration: '0-1', searchRange: '1' })),
  search_video_p2: (c) => logged(c, (d) => api.searchVideo(d, '美食', '16', '16', { sortType: '0', publishTime: '0', filterDuration: '', searchRange: '0' }, c.input.search_id)),
  search_user_filter: (c) => logged(c, (d) => api.searchUser(d, '巴旦木公主', '0', '25', '1w_10w', 'enterprise_user')),
  work_list: (c) =>
    logged(c, async (d) => {
      await creator.bootstrap(d)
      return creator.workList(d)
    }),
  post_images_extra: (c) =>
    logged(c, (d) =>
      creator.postImages(d, [media(PNG), media(PNG)], {
        title: '标题',
        desc: '正文 #话题 @好友',
        visibility: 1,
        allowDownload: false,
        timing: 1790086400,
        coverIndex: 1,
        poi: POI,
        mixId: MIX,
        hotSpot: { word: '热点词' },
      }),
    ),
  post_video_extra: (c) =>
    logged(c, (d) =>
      creator.postVideo(d, media(c.input.video), 'tos-cn-i-fake/mycover', {
        title: '视频标题',
        desc: '视频描述',
        visibility: 0,
        allowDownload: false,
        poi: POI,
        mixId: MIX,
        hotSpot: { word: '热点词' },
      }),
    ),
  collect_move: (c) => logged(c, (d) => api.collectMove(d, AWEME, '我的收藏夹', c.input.folder)),
  collect_remove: (c) => logged(c, (d) => api.collectRemove(d, AWEME, '我的收藏夹', c.input.folder)),
  im_send_file: (c) => logged(c, async (d) => im.sendMessage(d, CONV, im.IM_FILE, await im.uploadFile(d, media(c.input.file, 'file.bin')))),
  im_share_aweme: (c) =>
    logged(c, async (d) => {
      const detail = (await api.workInfo(d, AWEME)).aweme_detail
      return im.sendMessage(d, CONV, im.IM_SHARE_AWEME, im.shareAwemeContent(detail, await d.uid()))
    }),
  im_share_photos: (c) =>
    logged(c, async (d) => {
      const detail = (await api.workInfo(d, '7433523124836060417')).aweme_detail
      return im.sendMessage(d, CONV, im.IM_SHARE_PHOTOS, im.sharePhotosContent(detail, await d.uid()))
    }),
  im_user_card: (c) => logged(c, (d) => im.sendMessage(d, CONV, im.IM_SHARE_USER, im.userCardContent({ uid: '5550001', secUid: SEC_UID, name: '作者', avatar: c.input.avatar }))),
  im_share_web: (c) => logged(c, (d) => im.sendMessage(d, CONV, im.IM_SHARE_WEB, im.shareWebContent(c.input.url))),
  live_rank_thousand: (c) => logged(c, (d) => api.liveThousandRank(d, c.input.room_id, c.input.web_rid)),
  live_like_count: (c) => logged(c, (d) => api.liveLike(d, c.input.room_id, '10')),
  product_comment_counter: (c) => logged(c, (d) => api.productCommentCounter(d, '3622058069401408999', 'fakeShop01')),
  product_comments_tag: (c) => logged(c, (d) => api.productComments(d, '3622058069401408999', 'fakeShop01', '0', '10', '0', '7')),
  notices_group: (c) => logged(c, (d) => api.notices(d, '0', '0', '10', '401')),

  // ---------------------------------------------------------------- dtrait 设备档案（上游 fix-dtrait-blob）：没有导入 dtrait_blob 时按档案现算
  comment_publish_profile: (c) => logged(c, (d) => api.publishComment(d, AWEME, c.input.text)),
  comment_publish_custom_profile: (c) => logged(c, (d) => api.publishComment(d, AWEME, c.input.text)),
  post_images_profile: (c) => logged(c, (d) => creator.postImages(d, [media(PNG), media(PNG)], { title: c.input.title, desc: c.input.desc, visibility: 0 })),
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGNgYGD4z8DAwMAAAAwAAf8v0Mo8AAAAAElFTkSuQmCC'
const CONV_ID = '0:1:97872126662:1234567890'
const CONV = { conversationId: CONV_ID, shortId: '7400000000000000123', ticket: 'fake-conv-ticket' }
const POI = { poi_id: '6601136811511474183', poi_name: '北京·天安门' }
const MIX = '7400000000000000888'

describe('douyin 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('douyin', name)
      const { requests, error } = await replayBin(c, () => run(c))
      if (error) throw error
      expectReqs(requests, c.requests)
    })
  }
})

describe('douyin 对拍：命令流程', () => {
  it('游客 item get：注册 ttwid → 设备号 → mssdk 换 msToken → 作品详情', async () => {
    const c = loadCase('douyin', 'guest_item_get')
    const { itemGet } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = makeCtx({ platform: 'douyin', account: 'guest', args: { item: `https://www.douyin.com/video/${AWEME}` } })
    const { requests, result, error } = await replay(c, () => itemGet(ctx))
    if (error) throw error
    expectReqs(requests, c.requests)
    expect((result as any)[RAW]).toEqual(c.result.aweme_detail)
    expect(result).toMatchObject({ id: AWEME, kind: 'video', url: `https://www.douyin.com/video/${AWEME}`, author: { id: SEC_UID, name: '作者' } })
    // 设备数据留在游客凭证里，下次直接复用
    const tokens = ctx.credential.scopes.main!.tokens
    expect(tokens.webid).toBe('7400000000000000001')
    expect((tokens.msToken as any).value).toBe('guest-mstoken-from-mssdk')
    expect(ctx.credential.scopes.main!.cookies.map((x) => x.name)).toEqual(['s_v_web_id', 'ttwid'])
  })

  it('live products：直播间页面 → pop/v3 商品，输出带 product_id / shop_id 的商品 url', async () => {
    const c = loadCase('douyin', 'live_products')
    const { liveProducts } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = loggedCtx(c)
    ctx.args = { room: c.input.web_rid }
    const { requests, result, error } = await replay(c, () => liveProducts(ctx))
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result).toMatchObject([{ id: '3622058069401408240', kind: 'goods', title: '测试商品', price: { amount: 19.9, currency: 'CNY' } }])
    expect((result as any)[0].url).toContain('shop_id=fakeShop01')
  })
})

describe('douyin 纯算', () => {
  it('sm3 / a_bogus / X-Bogus / secsdk / mssdk 与上游一致', () => {
    const c = loadCase('douyin', 'pure')
    const restore = rand.deterministic({ seed: c.seed, now: c.now })
    try {
      const signer = new ABogus()
      const xb = new XBogus()
      const queries = ['device_platform=webapp&aid=6383', 'a=%E4%B8%AD&b=', '']
      const hosts = ['www.douyin.com', 'live.douyin.com', 'creator.douyin.com', 'login.douyin.com']
      const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
      const md5 = (s: string) => createHash('md5').update(s).digest('hex')
      expect({
        sm3: [hex(sm3('abc')), hex(sm3('abcd'.repeat(16))), hex(sm3('中文'))],
        abogus: queries.flatMap((q, i) => hosts.map((h) => signer.sign(q, i === 1 ? 'x=1' : '', h))),
        counter: signer.counter,
        xbogus: [xb.sign(md5('stub')), xb.sign(md5('stub2'))],
        signature: liveSignature(new XBogus(), '7400000000000000000', '111222333'),
        sign_url: [
          signedUrl('https://www.douyin.com/aweme/v1/web/aweme/detail/', 'aweme_id=1&keyword=a+b;c&x=100%&e=&k', 'fake-uifid'),
          signedUrl('https://www.douyin.com/aweme/v1/web/aweme/post/', 'uifid=u%20v&a=中文'),
        ],
        mstoken: randomMsToken(),
        webid: fakeWebid(),
        sv_web_id: svWebId(),
        report: strDataReport(),
        splice: spliceUrl([
          ['a', 'x/y z'],
          ['b', null],
          ['c', 1],
          ['中', '文'],
        ]),
      }).toEqual(c.result)
    } finally {
      restore()
    }
  })
})

describe('douyin 对拍：登录', () => {
  function loginCtx(c: GoldenCase) {
    const ctx = makeCtx({ platform: 'douyin', account: 'guest' })
    ctx.credential.device.dtrait_blob = c.input.dtrait_blob
    return ctx
  }

  it('扫码：页面 bootstrap（acrawler、challenge template、client_data_v2）→ 取码 → new / scanned / confirmed → 跟随重定向', async () => {
    const c = loadCase('douyin', 'login_qrcode')
    const d = new Douyin(loginCtx(c))
    const p = new Passport(d)
    const shown: string[] = []
    const { requests, error } = await replayBin(c, () => p.qrcodeLogin(async (url) => void shown.push(url)))
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(shown).toHaveLength(1)
    expect(Object.fromEntries(d.cookies())).toEqual(c.result.cookies)
    expect(d.tokens).toMatchObject({ ticket: c.result.ticket, ts_sign: c.result.ts_sign, client_cert: c.result.client_cert })
  }, 60_000)

  it('短信（严格）：bootstrap → 发验证码 → 验证码登录', async () => {
    const c = loadCase('douyin', 'login_sms')
    const d = new Douyin(loginCtx(c))
    const p = new Passport(d)
    const { requests, error } = await replayBin(c, async () => {
      await p.bootstrap(true)
      await p.sendSmsCode(c.input.phone)
      await p.phoneLogin(c.input.phone, c.input.code)
    })
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(Object.fromEntries(d.cookies())).toEqual(c.result.cookies)
    expect(d.tokens).toMatchObject({ ticket: c.result.ticket, ts_sign: c.result.ts_sign })
  }, 60_000)

  it('短信（严格）：没有导入 dtrait_blob 时按默认设备档案现算 x-tt-session-dtrait，不再本地拒绝', async () => {
    const c = loadCase('douyin', 'login_sms_profile')
    const d = new Douyin(loginCtx(c))
    const p = new Passport(d)
    const { requests, error } = await replayBin(c, async () => {
      await p.bootstrap(true)
      await p.sendSmsCode(c.input.phone)
      await p.phoneLogin(c.input.phone, c.input.code)
    })
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(Object.fromEntries(d.cookies())).toEqual(c.result.cookies)
  }, 60_000)
})

describe('douyin 对拍：长连接', () => {
  it('直播弹幕：直播间页面 → im/fetch → wss 地址（X-Bogus signature）与握手头', async () => {
    const c = loadCase('douyin', 'live_ws')
    const { requests, result, error } = await replayBin(c, () =>
      logged(c, async (d) => live.liveSocket(d, (await api.liveInfo(d, c.input.web_rid))!, c.input.web_rid)),
    )
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result!.url).toBe(c.result.url)
    const { Cookie, Origin, ...headers } = result!.headers
    expect(headers).toEqual(Object.fromEntries(Object.entries(c.result.header).filter(([k]) => !['Upgrade', 'Connection'].includes(k))))
    expect([Cookie, Origin]).toEqual([c.result.cookie, c.result.origin])
  })

  it('直播推送帧：gzip 解压、needAck 回 ack，聊天 / 礼物 / 进场 / 关注转成 Event', () => {
    const c = loadCase('douyin', 'live_frame')
    const { events, ack } = live.liveFrame(new Uint8Array(Buffer.from(c.result.frame, 'base64')))
    expect(Buffer.from(ack!).toString('base64')).toBe(c.result.sent[0])
    expect(events.map((e) => [e.type, e.user?.name, e.text, e.gift])).toEqual([
      ['chat', '观众A', '主播好！', null],
      ['gift', '观众B', null, { name: '小心心', count: 3 }],
      ['enter', '观众C', null, null],
      ['follow', '观众D', null, null],
    ])
    expect(events[0]!.user).toEqual({ id: 'MS4wLjABAAAAviewerA', name: '观众A', url: 'https://www.douyin.com/user/MS4wLjABAAAAviewerA' })
  })

  it('私信：设备号 → frontier-im 地址（access_key）与握手头；推送帧转成 Message', async () => {
    const c = loadCase('douyin', 'recv_ws')
    const { requests, result, error } = await replayBin(c, () => logged(c, (d) => live.frontierSocket(d)))
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result!.url).toBe(c.result.url)
    const { Cookie, Origin, ...headers } = result!.headers
    expect(headers).toEqual(Object.fromEntries(Object.entries(c.result.header).filter(([k]) => k !== 'Sec-WebSocket-Extensions')))
    expect([Cookie, Origin]).toEqual([c.result.cookie, c.result.origin])
    const msg = live.imFrame(new Uint8Array(Buffer.from(loadCase('douyin', 'im_push').result.frame, 'base64')))
    expect(msg).toMatchObject({ id: '7400000000000000777', conversation_id: CONV_ID, from: { id: '1234567890' }, type: 'text', text: '你好呀' })
  })
})

describe('douyin 归一化（真实响应的结构）', () => {
  it('通知类型按通知体的字段判断：comment → 评论，digg → 点赞，interactive_notice → 系统', async () => {
    const norm = await import('../src/platforms/douyin/web/normalize.js')
    const user = { uid: '1', sec_uid: SEC_UID, nickname: '粉丝' }
    const aweme = { aweme_id: '7600000000000000001' }
    const comment = norm.notice({ nid_str: '1', type: 31, create_time: 1790399397, comment: { comment: { text: '好看', user }, aweme } })
    expect(comment).toMatchObject({ type: 'comment', user: { id: SEC_UID, name: '粉丝' }, target: { id: aweme.aweme_id }, text: '好看' })
    const like = norm.notice({ nid_str: '2', type: 41, create_time: 1790399397, digg: { from_user: [user], aweme, content: '赞了你的作品' } })
    expect(like).toMatchObject({ type: 'like', user: { id: SEC_UID }, target: { id: aweme.aweme_id }, text: '赞了你的作品' })
    const other = norm.notice({ nid_str: '3', type: 9009, create_time: 1790399397, aweme_id: '0', interactive_notice: { content: '推荐了你的图文', from_user: [user] } })
    expect(other).toMatchObject({ type: 'system', user: { id: SEC_UID }, target: null, text: '推荐了你的图文' })
  })
})

describe('douyin 缺 UIFID 时自动补上', () => {
  it('报 Uifid Not Found 且凭证里没有 UIFID：请求一次推荐流，拿到 Set-Cookie 的 UIFID 后重试', async () => {
    const { retryWithUifid } = await import('../src/platforms/douyin/web/commands.js')
    const { CatbusError } = await import('../src/core/errors.js')
    const ctx = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake; ttwid=fake', cookieDomain: '.douyin.com' })
    const urls: string[] = []
    const restore = mockSender((p) => {
      urls.push(p.url)
      if (p.url.includes('/aweme/v1/web/tab/feed/') || p.url.includes('/aweme/v1/web/module/feed/')) {
        return fakeResponse({ status_code: 0, aweme_list: [] }, { headers: [['set-cookie', 'UIFID=fake-uifid; Domain=.douyin.com; Path=/']] })
      }
      return fakeResponse({ status_code: 0 })
    })
    let calls = 0
    try {
      const run = retryWithUifid(async (c) => {
        calls++
        if (!c.credential.scopes.main!.cookies.some((k) => k.name === 'UIFID')) throw new CatbusError('RISK_CONTROL', 'Uifid Not Found', { detail: { kind: 'blocked', reason: 'uifid' } })
        return 'ok'
      })
      expect(await run(ctx)).toBe('ok')
    } finally {
      restore()
    }
    expect(calls).toBe(2)
    expect(urls.some((u) => u.includes('/feed/'))).toBe(true)
  })

  it('其他错误原样抛出；长连接的 handler（同步返回 AsyncIterable）原样交回', async () => {
    const { retryWithUifid } = await import('../src/platforms/douyin/web/commands.js')
    const { CatbusError } = await import('../src/core/errors.js')
    const ctx = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake', cookieDomain: '.douyin.com' })
    await expect(retryWithUifid(async () => Promise.reject(new CatbusError('UPSTREAM', 'x')))(ctx) as Promise<unknown>).rejects.toMatchObject({ code: 'UPSTREAM' })
    const stream = (async function* () {})()
    expect(retryWithUifid(() => stream)(ctx)).toBe(stream)
  })
})

describe('douyin 对拍：补齐的命令流程', () => {
  it('短信（SSO）：login.douyin.com 页 → send_activation_code（gfkadpd 拦截页补 cookie 重试）→ quick_login → 跟随重定向', async () => {
    const c = loadCase('douyin', 'login_sms_sso')
    const d = new Douyin(makeCtx({ platform: 'douyin', account: 'guest' }))
    const p = new Passport(d)
    const { requests, error } = await replayBin(c, async () => {
      await p.bootstrapSso()
      await p.sendSmsCodeSso(c.input.phone)
      await p.phoneLoginSso(c.input.phone, c.input.code)
    })
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(Object.fromEntries(d.cookies())).toEqual(c.result.cookies)
    expect(d.tokens).toMatchObject({ ticket: c.result.ticket, ts_sign: c.result.ts_sign })
    // 非 TTY 两步登录：发码后的会话能原样恢复，并记得走 SSO
    const restored = new Passport(new Douyin(makeCtx({ platform: 'douyin', account: 'guest' })))
    restored.restore(p.snapshot() as Record<string, unknown>)
    expect([restored.sso, restored.ssoPageStartedMs]).toEqual([true, c.now])
  })

  it('item search --type video：视频频道搜索，游标带上 X-Tt-Logid 作为下一页的 search_id', async () => {
    const c = loadCase('douyin', 'search_video')
    const { itemSearch } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = loggedCtx(c)
    ctx.args = { keyword: c.input.keyword }
    ctx.options = { type: 'video', sort: 'popular', time: 'half_year', length: 'short', range: 'seen' }
    const { requests, result, error } = await replay(c, () => itemSearch(ctx) as Promise<any>)
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result.page).toEqual({ cursor: `16,${c.result[0]}`, has_more: true })
    expect(result.data).toMatchObject([{ id: AWEME, kind: 'video', text: '搜索到的视频' }])
  })

  it('item list：进入创作者中心（页面、oversea、csrf）→ work_list', async () => {
    const c = loadCase('douyin', 'work_list')
    const { itemList } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = loggedCtx(c)
    const { requests, result, error } = await replay(c, () => itemList(ctx) as Promise<any>)
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result).toEqual({ data: [], page: { cursor: null, has_more: false } })
  })

  it('搜索筛选的取值映射：综合频道只标记 is_filter_search，--range all 在视频频道是 0', async () => {
    const { searchFilters } = await import('../src/platforms/douyin/web/commands.js')
    expect(searchFilters({}, false)).toEqual({ sortType: '0', publishTime: '0', filterDuration: '', searchRange: '', contentType: '' })
    expect(searchFilters({ sort: 'latest', time: 'week', length: 'medium', range: 'following' }, false)).toEqual({
      sortType: '2',
      publishTime: '7',
      filterDuration: '1-5',
      searchRange: '3',
      contentType: '',
    })
    expect(searchFilters({ range: 'all', length: 'long' }, true)).toMatchObject({ searchRange: '0', filterDuration: '5-10000', contentType: undefined })
  })

  it('item collect --folder：按名字找到收藏夹，收藏后移进去；uncollect --folder 只移出', async () => {
    const { itemCollect, itemUncollect } = await import('../src/platforms/douyin/web/commands.js')
    const c = loadCase('douyin', 'collect_move')
    const urls: string[] = []
    const restore = mockSender((p) => {
      urls.push(`${p.method} ${p.url.split('?')[0]}`)
      if (p.url.includes('/collects/list/')) return fakeResponse({ status_code: 0, collects_list: [{ collects_id_str: c.input.folder, collects_name: '我的收藏夹' }] })
      if (p.method === 'HEAD') return fakeResponse('', { headers: [['x-ware-csrf-token', '0001,fakecsrf,86370,success,x']] })
      if (p.url.includes('get_client_cert')) return fakeResponse({ message: 'success', data: { server_cert: 'x' } })
      if (p.url.includes('/collects/video/move/')) expect(p.url).toContain(p.url.includes('to_collects_id') ? `to_collects_id=${c.input.folder}` : `from_collects_id=${c.input.folder}`)
      return fakeResponse({ status_code: 0 })
    })
    try {
      const ctx = loggedCtx(c)
      ctx.args = { item: AWEME }
      ctx.options = { folder: '我的收藏夹' }
      expect(await itemCollect(ctx)).toEqual({ id: AWEME })
      const moves = urls.filter((u) => u.includes('/collect'))
      expect(moves).toEqual([
        'GET https://www.douyin.com/aweme/v1/web/collects/list/',
        'POST https://www.douyin.com/aweme/v1/web/aweme/collect/',
        'POST https://www.douyin.com/aweme/v1/web/collects/video/move/',
      ])
      urls.length = 0
      expect(await itemUncollect(ctx)).toEqual({ id: AWEME })
      expect(urls.filter((u) => u.includes('/collect'))).toEqual(['GET https://www.douyin.com/aweme/v1/web/collects/list/', 'POST https://www.douyin.com/aweme/v1/web/collects/video/move/'])
      ctx.options = { folder: '不存在' }
      await expect(itemCollect(ctx)).rejects.toMatchObject({ code: 'USAGE' })
    } finally {
      restore()
    }
  })

  it('发布正文：--topic / --tag 写成 #话题，--mention 写成 @用户（上游说明：描述里可内嵌纯文本）', async () => {
    const { publishDesc } = await import('../src/platforms/douyin/web/commands.js')
    expect(publishDesc({ text: '正文', topic: ['旅行', '#美食'], tag: ['日常'], mention: ['@好友'] })).toBe('正文 #日常 #旅行 #美食 @好友')
    expect(publishDesc({ topic: ['旅行'] })).toBe('#旅行')
  })

  it('msg send 的参数约束：--file / --share 也算消息内容', async () => {
    const { PLATFORMS } = await import('../src/platforms/index.js')
    const web = PLATFORMS.find((p) => p.id === 'douyin')!.endpoints.web
    const cmd = (web as any).commands.get('msg send')
    expect(cmd.check({}, { to: 'u', share: 'x' })).toBeUndefined()
    expect(cmd.check({}, { to: 'u', file: 'a.pdf' })).toBeUndefined()
    expect(cmd.check({}, { to: 'u' })).toMatch(/--file 或 --share/)
    expect(cmd.check({ text: 'hi' }, { to: 'u', conversation: 'c' })).toMatch(/需要用一个/)
    // --to 与 --item 可以同时用（AGENTS 4.8），抖音不支持，由 handler 报 UNSUPPORTED
    expect(cmd.check({ text: 'hi' }, { to: 'u', item: 'i' })).toBeUndefined()
  })
})

describe('douyin 归一化：补齐的命令', () => {
  it('item list：定时未发布 → draft，审核中 / 违规 / 私密，其余 published', async () => {
    const norm = await import('../src/platforms/douyin/web/normalize.js')
    const base = { aweme_id: '7600000000000000001', desc: '作品', create_time: 1790000000, video: { cover: { url_list: ['https://p3.douyinpic.com/c.jpeg'] } }, statistics: { play_count: 12 } }
    expect(norm.work({ ...base, timer: { status: 0, public_time: 1790086400 } })).toMatchObject({ id: base.aweme_id, kind: 'video', status: 'draft', stats: { views: 12 } })
    expect(norm.work({ ...base, status: { in_reviewing: true } }).status).toBe('reviewing')
    expect(norm.work({ ...base, status: { is_prohibited: true } }).status).toBe('rejected')
    expect(norm.work({ ...base, status: { private_status: 1 } }).status).toBe('private')
    expect(norm.work({ ...base, status: { private_status: 0 }, timer: { status: 1 } }).status).toBe('published')
    expect(norm.work({ ...base, aweme_type: 68, images: [{ url_list: ['https://p3.douyinpic.com/i.jpeg'] }] })).toMatchObject({ kind: 'image', url: `https://www.douyin.com/note/${base.aweme_id}` })
  })

  it('live media：live_core_sdk_data 的各清晰度 flv / hls（带分辨率），再补 flv_pull_url / hls_pull_url_map，去重', async () => {
    const norm = await import('../src/platforms/douyin/web/normalize.js')
    const streamData = { data: { origin: { main: { flv: 'https://pull-flv-l1.douyincdn.com/stage/stream-1_or4.flv', hls: 'https://pull-hls-l1.douyincdn.com/stage/stream-1_or4/index.m3u8', sdk_params: '{"resolution":"1920x1080","vbitrate":6000000}' } } } }
    const body = {
      status_code: 0,
      data: {
        data: [
          {
            status: 2,
            stream_url: {
              flv_pull_url: { FULL_HD1: 'https://pull-flv-l1.douyincdn.com/stage/stream-1_or4.flv', SD1: 'https://pull-flv-l1.douyincdn.com/stage/stream-1_ld.flv' },
              hls_pull_url_map: { SD1: 'https://pull-hls-l1.douyincdn.com/stage/stream-1_ld/index.m3u8' },
              live_core_sdk_data: { pull_data: { stream_data: JSON.stringify(streamData) } },
            },
          },
        ],
      },
    }
    expect(norm.liveStreams(body).map((m) => [m.id, m.url?.split('/').at(-1), m.width, m.height])).toEqual([
      ['origin.flv', 'stream-1_or4.flv', 1920, 1080],
      ['origin.hls', 'index.m3u8', 1920, 1080],
      ['SD1.flv', 'stream-1_ld.flv', null, null],
      ['SD1.hls', 'index.m3u8', null, null],
    ])
    expect(norm.liveStreams({ data: { data: [{ status: 4 }] } })).toEqual([])
  })

  it('live rank / 千票榜的行、商品评价标签', async () => {
    const norm = await import('../src/platforms/douyin/web/normalize.js')
    const rows = norm.rankRows({ data: { list: [{ user: { id_str: '1', sec_uid: SEC_UID, nickname: '榜一' }, score: 1000 }, { user: { id_str: '2', nickname: '榜二' }, rank: 2 }] } })
    expect(rows.map((r) => [r.rank, r.user.id, r.user.name, r.score])).toEqual([
      [1, SEC_UID, '榜一', 1000],
      [2, '2', '榜二', null],
    ])
    const labels = norm.commentLabels({ counter_info: { tags: [{ tag_id: 7, tag_name: '好评', count: 120 }, { TagId: '9', TagName: '有图', Count: '3' }] } })
    expect(labels).toEqual([
      { id: '7', name: '好评', count: 120 },
      { id: '9', name: '有图', count: 3 },
    ])
  })

  it('live history：im/fetch 的 LiveResponse 里带回的消息转成 Event', () => {
    const chat = proto.encode('Live', 'ChatMessage', { user: { nickname: '观众A', sec_uid: 'MS4wLjABAAAAviewerA' }, content: '主播好' })
    const member = proto.encode('Live', 'MemberMessage', { user: { id: 222, nickname: '观众B' } })
    const raw = proto.encode('Live', 'LiveResponse', {
      messagesList: [
        { method: 'WebcastChatMessage', payload: chat },
        { method: 'WebcastMemberMessage', payload: member },
        { method: 'WebcastUnknownMessage', payload: chat },
      ],
      cursor: 't-1',
    })
    expect(live.fetchEvents(raw).map((e) => [e.type, e.user?.name, e.text])).toEqual([
      ['chat', '观众A', '主播好'],
      ['enter', '观众B', null],
    ])
  })
})

/** 上游 tests/test_dtrait_profile.py 的 CAPTURED_BLOB：Chrome 153 DevTools 里抓到的内层 blob，默认档案就是从它取证的。 */
const CAPTURED_BLOB =
  'IAAAAADQIC0FVqIh4kBm/yLQO48ZI8SHsdUkUnQhRSUtc6pZJoXtgvcnqvUbwih5/' +
  'ufyKR3SnsMqMtFjyisa3jq/LEbrp0It3oooWy6x8OwMLzYf+ukwKpioVDEAAAAAMi' +
  'Zm67kzi/GgODSiHrKONRJqRnA2hZHFNjcbzZ0NOFhf5lQ5ucywezqnDTbrO0LJZ588' +
  'JQFrBT3os+69Pnc1cw4/6hH+lkBcuWKWR5QWrJM='

const errorCode = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (err) {
    return (err as { code?: unknown }).code ?? err
  }
  return null
}

describe('douyin dtrait 内层 blob（上游 utils/dtrait_features.py、fix-dtrait-blob 的默认档案）', () => {
  const c = loadCase('douyin', 'dtrait_blob')

  it('默认档案生成的 blob 与 Chrome 抓到的逐字节一致，也与上游 build_blob 一致', () => {
    expect(c.input.captured).toBe(CAPTURED_BLOB)
    expect(buildBlob(defaultProfile())).toBe(CAPTURED_BLOB)
    expect(buildBlob(defaultProfile())).toBe(c.result.default)
    expect(computedFeatures(defaultProfile())).toEqual(c.result.default_features)
  })

  it('自定义档案：bool 位图跨过 32、reserved / version、accessType、小数与非 ASCII 字段', () => {
    expect(buildBlob(c.input.custom_profile)).toBe(c.result.custom)
    expect(buildBlob(c.input.custom_profile, 1)).toBe(c.result.custom_edge)
    expect(computedFeatures(c.input.custom_profile)).toEqual(c.result.custom_features)
  })

  it('murmur3 与 JS 的 Number → 字符串（上游 js_number_to_str）', () => {
    expect(c.result.murmur3.map(([s]: [string]) => [s, murmur3(s)])).toEqual(c.result.murmur3)
    expect(c.result.js_number.map(([x]: [number]) => [x, String(x)])).toEqual(c.result.js_number)
  })

  it('档案不完整时报 USAGE（上游加载档案时就用 build_blob 校验）', () => {
    const p = c.input.custom_profile
    const hashes = { ...p.render_hashes }
    delete hashes['7']
    expect(errorCode(() => buildBlob([]))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, ua: undefined }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, languages: 'zh-CN' }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, device_memory: null }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, render_hashes: hashes }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, render_hashes: { ...p.render_hashes, 7: 2 ** 32 } }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, bools: { x: true } }))).toBe('USAGE')
    expect(errorCode(() => buildBlob({ ...p, bools: { 1: 'yes' } }))).toBe('USAGE')
  })

  it('取 blob 的优先级：dtrait_blob > dtrait_profile > 默认档案；档案无效时算不出，评论 / 发布在本地拦下', async () => {
    const { commentAdd } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake; ttwid=fake', cookieDomain: '.douyin.com', args: { item: AWEME, text: 'x' } })
    Object.assign(ctx.credential.scopes.main!.tokens, { ticket: 'hash.fake', ts_sign: 'ts.2.fake' })
    const d = new Douyin(ctx)
    d.device.private_key = 'fake-key'
    expect(d.dtraitBlob()).toBe(CAPTURED_BLOB)
    d.device.dtrait_profile = c.input.custom_profile
    expect(d.dtraitBlob()).toBe(c.result.custom)
    d.device.dtrait_blob = 'imported-blob'
    expect(d.dtraitBlob()).toBe('imported-blob')

    delete d.device.dtrait_blob
    d.device.dtrait_profile = { ...c.input.custom_profile, render_hashes: {} }
    expect(d.dtraitBlob()).toBeNull()
    expect(d.dtraitHeader('/aweme/v1/web/comment/publish')).toBeNull()
    expect(errorCode(() => d.dtraitHeader('/aweme/v1/web/comment/publish', { strict: true }))).toBe('AUTH_REQUIRED')
    expect(errorCode(() => creator.requirePublishSecurity(d))).toBe('AUTH_REQUIRED')
    await expect(commentAdd(ctx)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    // 成品头只给非严格的请求用
    d.device.session_dtrait = 'static-header'
    expect(d.dtraitHeader('/aweme/v1/web/comment/publish')).toBe('static-header')
    expect(errorCode(() => d.dtraitHeader('/web/api/media/aweme/create_v2/', { strict: true }))).toBe('AUTH_REQUIRED')
  })

  it('comment add：没有导入 dtrait_blob 时不再本地拒绝，按默认档案带上 x-tt-session-dtrait', async () => {
    const c = loadCase('douyin', 'comment_publish_profile')
    const { commentAdd } = await import('../src/platforms/douyin/web/commands.js')
    const ctx = loggedCtx(c)
    ctx.args = { item: AWEME, text: c.input.text }
    const { requests, result, error } = await replay(c, () => commentAdd(ctx) as Promise<any>)
    if (error) throw error
    expectReqs(requests, c.requests)
    expect(result).toMatchObject({ item_id: AWEME, text: c.input.text })
  })

  it('auth login --cookie <JSON>：可选导入 dtrait_profile / dtrait_blob，坏档案报 USAGE；出现任何 dtrait 键时整组替换', async () => {
    const { mkdtempSync, rmSync, readFileSync: read } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { authLogin } = await import('../src/platforms/douyin/web/commands.js')
    const home = mkdtempSync(join(tmpdir(), 'catbus-dy-'))
    const prev = process.env.CATBUS_HOME
    process.env.CATBUS_HOME = home
    const restore = mockSender((p) => {
      if (p.url.includes('/aweme/v1/web/query/user/')) return fakeResponse({ status_code: 0, id: '7400000000000000001', user_uid: '97872126662' })
      if (p.url.includes('/web/api/media/user/info/')) return fakeResponse({ user: { sec_uid: SEC_UID, uid: '97872126662', nickname: '我' } })
      if (p.url.includes('mssdk.bytedance.com')) return fakeResponse({ code: 0 }, { headers: [['x-ms-token', 'fake-mstoken']] })
      return fakeResponse({ status_code: 0 })
    })
    const custom = c.input.custom_profile
    const login = async (json: Record<string, unknown>, device: Record<string, unknown> = {}) => {
      const ctx = makeCtx({ platform: 'douyin', account: null, options: { method: 'cookie', cookie: JSON.stringify({ cookie: 'sessionid=fake; ttwid=fake', ...json }) } })
      Object.assign(ctx.credential.device, device)
      await authLogin(ctx)
      return JSON.parse(read(join(home, 'auth', 'douyin', 'web', 'default.json'), 'utf8')).device
    }
    try {
      const d1 = await login({ dtrait_profile: custom })
      expect(d1.dtrait_profile).toEqual(custom)
      expect(d1.dtrait_blob).toBeUndefined()
      // 同名账号已有 blob：这次只给档案时整组替换，旧 blob 不会压过新档案
      const d2 = await login({ dtrait_profile: custom }, { dtrait_blob: 'old-blob', session_dtrait: 'old-header' })
      expect([d2.dtrait_blob, d2.session_dtrait, d2.dtrait_profile]).toEqual([undefined, undefined, custom])
      // 一个 dtrait 键都没给：沿用同名账号已有的
      expect(await login({}, { dtrait_blob: 'old-blob', dtrait_profile: custom })).toMatchObject({ dtrait_blob: 'old-blob', dtrait_profile: custom })
      // null 表示清掉，回到默认档案
      expect((await login({ dtrait_blob: null }, { dtrait_blob: 'old-blob' })).dtrait_blob).toBeUndefined()
      await expect(login({ dtrait_profile: { ...custom, bools: [] } })).rejects.toMatchObject({ code: 'USAGE' })
      await expect(login({ dtrait_blob: 123 })).rejects.toMatchObject({ code: 'USAGE' })
    } finally {
      restore()
      if (prev === undefined) delete process.env.CATBUS_HOME
      else process.env.CATBUS_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })
})

// ================================================================ 审查修复：命令级测试（不联网，按 URL 应答）

/** 用例里记下的响应 → HttpResponse（二进制响应记成 {base64}）。 */
function goldenReply(r: GoldenCase['responses'][number], url: string): HttpResponse {
  const hs: [string, string][] = []
  for (const [k, v] of Object.entries(r.headers)) for (const x of Array.isArray(v) ? v : [v]) hs.push([k, x])
  const body = typeof r.body === 'string' ? r.body : (r.body as any)?.base64 != null ? new Uint8Array(Buffer.from((r.body as any).base64, 'base64')) : JSON.stringify(r.body)
  return fakeResponse(body, { status: r.status, headers: hs, url })
}

type Route = [string | RegExp, (p: PreparedRequest) => HttpResponse]

/** 按 URL 应答的假服务端（取第一个匹配的路由），时钟固定在 NOW；没配到的请求直接报错。 */
async function withServer<T>(routes: Route[], run: (seen: GoldenRequest[]) => Promise<T>): Promise<T> {
  const seen: GoldenRequest[] = []
  const restoreRand = rand.deterministic({ now: NOW })
  const restore = mockSender((p) => {
    seen.push(normalize(p))
    const hit = routes.find(([m]) => (typeof m === 'string' ? p.url.includes(m) : m.test(p.url)))
    if (!hit) throw new Error(`测试没有配置这个请求：${p.method} ${p.url}`)
    return hit[1](p)
  })
  try {
    return await run(seen)
  } finally {
    restore()
    restoreRand()
  }
}

const reqPath = (r: GoldenRequest) => `${r.method} ${r.url.split('?')[0]}`
const query = (r: GoldenRequest) => new URL(r.url).searchParams
const loggedFrom = (name: string, init: { args?: Record<string, string>; options?: Record<string, unknown>; cursor?: string } = {}) => {
  const ctx = loggedCtx(loadCase('douyin', name))
  ctx.args = init.args ?? {}
  ctx.options = init.options ?? {}
  ctx.cursor = init.cursor ?? null
  return ctx
}
const commands = () => import('../src/platforms/douyin/web/commands.js')

describe('douyin 审查修复：登录态与错误映射', () => {
  useTempHome()

  it('auth login --sso 只能配 --method sms：cookie / qrcode 在发任何请求之前报 USAGE', async () => {
    const { authLogin } = await commands()
    for (const method of ['qrcode', 'cookie']) {
      const ctx = makeCtx({ platform: 'douyin', account: null, options: { method, sso: true, cookie: 'sessionid=fake' } })
      await withServer([], async (seen) => {
        await expect(authLogin(ctx)).rejects.toMatchObject({ code: 'USAGE' })
        expect(seen).toEqual([])
      })
    }
  })

  it('webcast 的 20003（User doesn\'t login）按登录墙处理，说明取 data.message', async () => {
    const { check } = await import('../src/platforms/douyin/web/client.js')
    const body = { status_code: 20003, data: { message: "User doesn't login" } }
    const err = (() => {
      try {
        check(makeCtx({ platform: 'douyin' }), body)
      } catch (e) {
        return e as any
      }
    })()
    expect([err.code, err.message]).toEqual(['AUTH_EXPIRED', "User doesn't login"])
    expect(errorCode(() => check(makeCtx({ platform: 'douyin', account: 'guest' }), body))).toBe('AUTH_REQUIRED')
    expect(errorCode(() => check(makeCtx({ platform: 'douyin' }), { status_code: 10011, status_msg: '参数错误' }))).toBe('UPSTREAM')
  })

  it('auth status：风控原样抛出；query/user 没给 uid 才算未登录；取不到 sec_uid 时沿用凭证里的用户', async () => {
    const { authStatus } = await commands()
    const ctx = () => {
      const c = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake; ttwid=fake; s_v_web_id=fake', cookieDomain: '.douyin.com' })
      c.credential.scopes.main!.tokens.webid = '7400000000000000001'
      c.credential.user = { id: SEC_UID, name: '我', url: `https://www.douyin.com/user/${SEC_UID}` }
      return c
    }
    const run = (queryUser: () => HttpResponse, userInfo: () => HttpResponse = () => fakeResponse({ user: { sec_uid: SEC_UID, nickname: '新昵称' } })) =>
      withServer(
        [
          ['/aweme/v1/web/query/user/', queryUser],
          ['/web/api/media/user/info/', userInfo],
          ['/user/self', () => fakeResponse('<html></html>')],
        ],
        () => authStatus(ctx()),
      )
    await expect(run(() => fakeResponse(''))).rejects.toMatchObject({ code: 'RISK_CONTROL' })
    await expect(run(() => fakeResponse('Uifid Not Found'))).rejects.toMatchObject({ code: 'RISK_CONTROL', detail: { reason: 'uifid' } })
    expect(await run(() => fakeResponse({ status_code: 0 }))).toMatchObject({ logged_in: false, user: null })
    expect(await run(() => fakeResponse({ status_code: 0, user_uid: '0' }))).toMatchObject({ logged_in: false })
    expect(await run(() => fakeResponse({ status_code: 0, user_uid: '97872126662' }))).toMatchObject({ logged_in: true, user: { id: SEC_UID, name: '新昵称' } })
    expect(await run(() => fakeResponse({ status_code: 0, user_uid: '97872126662' }), () => fakeResponse(''))).toMatchObject({ logged_in: true, user: { id: SEC_UID, name: '我' } })
  })

  it('auth login --cookie：query/user 被风控时报 RISK_CONTROL，不再说成 cookie 无效', async () => {
    const { authLogin } = await commands()
    const login = (queryUser: () => HttpResponse) =>
      withServer(
        [
          ['/aweme/v1/web/query/user', queryUser],
          ['/discover', () => fakeResponse('<html></html>')],
        ],
        () => authLogin(makeCtx({ platform: 'douyin', account: null, options: { method: 'cookie', cookie: 'sessionid=fake; ttwid=fake' } })),
      )
    await expect(login(() => fakeResponse(''))).rejects.toMatchObject({ code: 'RISK_CONTROL' })
    await expect(login(() => fakeResponse({ status_code: 0 }))).rejects.toMatchObject({ code: 'AUTH_REQUIRED', message: '登录没有成功：cookie 无效或已过期' })
  })

  it('读取类命令缺 UIFID 时整条重跑；登录与写操作不重跑（index.ts 只给读取类套 retryWithUifid）', async () => {
    const m = await commands()
    const { PLATFORMS } = await import('../src/platforms/index.js')
    const web = PLATFORMS.find((p) => p.id === 'douyin')!.endpoints.web as any
    const load = (key: string) => web.commands.get(key).handler()
    const raw: [string, unknown][] = [
      ['auth login', m.authLogin],
      ['msg send', m.msgSend],
      ['comment add', m.commentAdd],
      ['item publish', m.itemPublish],
      ['item collect', m.itemCollect],
      ['media upload', m.mediaUpload],
      ['live send', m.liveSend],
      ['live like', m.liveLike],
    ]
    for (const [key, fn] of raw) expect(await load(key), key).toBe(fn)
    for (const [key, fn] of [
      ['user likes', m.userLikes],
      ['auth status', m.authStatus],
      ['item get', m.itemGet],
    ] as const)
      expect(await load(key), key).not.toBe(fn)
  })
})

describe('douyin 审查修复：私信', () => {
  const file = loadCase('douyin', 'im_send_file')
  const create = loadCase('douyin', 'im_create')
  const sendRoutes: Route[] = [
    ['imapi.douyin.com/v2/conversation/create', (p) => goldenReply(create.responses[0]!, p.url)],
    ['/service/2/abtest_config/', (p) => goldenReply(file.responses[0]!, p.url)],
    ['/passport/ticket_guard/get_client_cert/', (p) => goldenReply(file.responses[1]!, p.url)],
    ['/aweme/v1/web/im/upload/config/v2', (p) => goldenReply(file.responses[2]!, p.url)],
    ['Action=ApplyUploadInner', (p) => goldenReply(file.responses[3]!, p.url)],
    ['tos-fake.snssdk.com', (p) => goldenReply(file.responses[4]!, p.url)],
    ['Action=CommitUploadInner', (p) => goldenReply(file.responses[5]!, p.url)],
    ['/passport/safe/get_identity_security_token/', (p) => goldenReply(file.responses[6]!, p.url)],
    ['imapi.douyin.com/v1/message/send', (p) => goldenReply(file.responses[7]!, p.url)],
  ]
  const sent = (seen: GoldenRequest[]) =>
    seen.filter((r) => r.url.startsWith('https://imapi.douyin.com/v1/message/send')).map((r) => (pbBody((r.body as { base64: string }).base64) as any).body.send_message_body)

  it('--share 取作品失败时一条都不发（文字不会先发出去）；--to 给数字 uid 时直接建会话', async () => {
    const { msgSend } = await commands()
    const ctx = loggedFrom('im_send_file', { args: { text: 'hi' }, options: { to: '1234567890', share: AWEME } })
    await withServer([...sendRoutes, ['/aweme/v1/web/aweme/detail/', () => fakeResponse({ status_code: 0 })]], async (seen) => {
      await expect(msgSend(ctx)).rejects.toMatchObject({ code: 'UPSTREAM' })
      expect(seen.map(reqPath)).toEqual(['POST https://imapi.douyin.com/v2/conversation/create', 'GET https://www.douyin.com/aweme/v1/web/aweme/detail/'])
      expect((pbBody((seen[0]!.body as { base64: string }).base64) as any).body.create_conversation_v2_body.participants).toEqual(['1234567890', file.input.uid])
    })
  })

  it('先上传再逐条发送；--file 给 URL 时文件名照上游叫 file.bin', async () => {
    const { msgSend } = await commands()
    const ctx = loggedFrom('im_send_file', { args: { text: 'hi' }, options: { to: '1234567890', file: 'https://example.com/docs/a.pdf' } })
    const bytes = Buffer.from(file.input.file, 'base64')
    await withServer([...sendRoutes, ['https://example.com/docs/a.pdf', () => fakeResponse(new Uint8Array(bytes), { headers: [['content-type', 'application/pdf']] })]], async (seen) => {
      const msg = await msgSend(ctx)
      expect(msg).toMatchObject({ conversation_id: CONV_ID, type: 'other', text: 'file.bin' })
      const paths = seen.map(reqPath)
      const firstSend = paths.indexOf('POST https://imapi.douyin.com/v1/message/send')
      expect(firstSend).toBeGreaterThan(paths.findIndex((x) => x.startsWith('POST https://vod.bytedanceapi.com/')))
      const bodies = sent(seen)
      expect(bodies.map((b: any) => b.message_type)).toEqual([im.IM_TEXT, im.IM_FILE])
      expect(JSON.parse(bodies[0].content).text).toBe('hi')
      expect(JSON.parse(bodies[1].content)).toMatchObject({ aweType: 15001, name: 'file.bin', format: 'bin', data_size: bytes.length })
      expect(seen.some((r) => r.url.includes('/user/profile/other/'))).toBe(false)
    })
  })
})

describe('douyin 审查修复：搜索、评价、收藏夹的翻页', () => {
  useTempHome()

  it('user search / live search：has_more=1 但空列表时停止翻页；--fans / --user-type 的取值映射', async () => {
    const { userSearch, liveSearch } = await commands()
    await withServer(
      [
        ['/aweme/v1/web/discover/search/', () => fakeResponse({ status_code: 0, has_more: 1, user_list: [] })],
        ['/aweme/v1/web/live/search/', () => fakeResponse({ status_code: 0, has_more: 1, data: [] })],
      ],
      async (seen) => {
        const users: any = await userSearch(loggedFrom('search_user', { args: { keyword: '巴旦木' }, options: { fans: '1w_10w', userType: 'enterprise' } }))
        expect(users.page).toEqual({ cursor: null, has_more: false })
        expect(JSON.parse(query(seen[0]!).get('search_filter_value')!)).toEqual({ douyin_user_fans: ['1w_10w'], douyin_user_type: ['enterprise_user'] })
        const lives: any = await liveSearch(loggedFrom('search_live', { args: { keyword: '三角洲' }, cursor: '15' }))
        expect(lives.page).toEqual({ cursor: null, has_more: false })
        expect(query(seen[1]!).get('offset')).toBe('15')
      },
    )
  })

  it('item search --type image 报 UNSUPPORTED（综合频道不发 content_type）', async () => {
    const r = await cli('douyin', 'item', 'search', '美食', '--type', 'image')
    expect([r.code, r.env.error.code]).toEqual([2, 'UNSUPPORTED'])
  })

  it('item search --type video 的第二页：游标「偏移,X-Tt-Logid」拆开，下一页游标接上新的 logid', async () => {
    const { itemSearch } = await commands()
    await withServer(
      [['/aweme/v1/web/search/item/', () => fakeResponse({ status_code: 0, has_more: 1, data: [{ aweme_info: { aweme_id: AWEME, desc: 'x' } }] }, { headers: [['x-tt-logid', 'logid-2']] })]],
      async (seen) => {
        const r: any = await itemSearch(loggedFrom('search_video', { args: { keyword: '美食' }, options: { type: 'video' }, cursor: '16,logid-1' }))
        expect([query(seen[0]!).get('offset'), query(seen[0]!).get('search_id')]).toEqual(['16', 'logid-1'])
        expect(r.page).toEqual({ cursor: '32,logid-2', has_more: true })
      },
    )
  })

  it('notice list --group 的取值映射：不带时 960', async () => {
    const { noticeList } = await commands()
    await withServer([['/aweme/v1/web/notice/', () => fakeResponse({ status_code: 0, notice_list_v2: [], has_more: 0 })]], async (seen) => {
      for (const group of [undefined, 'all', 'fans', 'mention', 'comment', 'like', 'danmaku']) await noticeList(loggedFrom('notices', { options: group ? { group } : {} }))
      expect(seen.map((r) => query(r).get('notice_group'))).toEqual(['960', '700', '401', '601', '2', '3', '520'])
    })
  })

  it('商品评价 --label：按名字或 id 找标签，找不到报 USAGE；tag_id 编进游标，翻页时不再请求 comment/counter', async () => {
    const { commentList } = await commands()
    const product = 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=3622058069401408999&promotion_id=3622058069401408240&shop_id=fakeShop01'
    const routes: Route[] = [
      ['/ecom/product/comment/counter/', () => fakeResponse({ status_code: 0, counter_info: { tags: [{ tag_id: 7, tag_name: '好评', count: 3 }] } })],
      ['/ecom/product/comments/', () => fakeResponse({ status_code: 0, data: { Comments: [{ CommentId: '1', Content: '好', User: { NickName: 'a' } }], Cursor: 10, HasMore: true } })],
    ]
    await withServer(routes, async (seen) => {
      const p1: any = await commentList(loggedFrom('product_comments', { args: { item: product }, options: { label: '好评' } }))
      expect(p1.page).toEqual({ cursor: '10,7', has_more: true })
      expect(seen.map((r) => r.url.includes('/counter/'))).toEqual([true, false])
      expect(query(seen[1]!).get('tag_id')).toBe('7')
      seen.length = 0
      const p2: any = await commentList(loggedFrom('product_comments', { args: { item: product }, options: { label: '好评' }, cursor: '10,7' }))
      expect(seen.map(reqPath)).toEqual(['GET https://www.douyin.com/aweme/v1/web/ecom/product/comments/'])
      expect([query(seen[0]!).get('cursor'), query(seen[0]!).get('tag_id')]).toEqual(['10', '7'])
      expect(p2.page.cursor).toBe('10,7')
      seen.length = 0
      // 纯数字：不在计数里也照用；名字对不上报 USAGE
      await commentList(loggedFrom('product_comments', { args: { item: product }, options: { label: '9' } }))
      expect(query(seen[1]!).get('tag_id')).toBe('9')
      await expect(commentList(loggedFrom('product_comments', { args: { item: product }, options: { label: '差评' } }))).rejects.toMatchObject({ code: 'USAGE' })
      // 不带 --label 时游标就是服务端的游标
      const plain: any = await commentList(loggedFrom('product_comments', { args: { item: product } }))
      expect(plain.page.cursor).toBe('10')
    })
  })

  it('folder list 按响应的 cursor / has_more 翻页；--folder 在后面的页里也能找到', async () => {
    const { folderList, itemCollect } = await commands()
    const page = (cursor: string | null) =>
      cursor === '20'
        ? { status_code: 0, collects_list: [{ collects_id_str: '2002', collects_name: '第二页的收藏夹', total_number: 1 }], cursor: 21, has_more: false }
        : { status_code: 0, collects_list: [{ collects_id_str: '1001', collects_name: '第一页的收藏夹', total_number: 3 }], cursor: 20, has_more: true }
    const routes: Route[] = [
      ['/collects/list/', (p) => fakeResponse(page(new URL(p.url).searchParams.get('cursor')))],
      ['/service/2/abtest_config/', () => fakeResponse('', { headers: [['x-ware-csrf-token', '0001,fakecsrf,86370,success,x']] })],
      ['/aweme/v1/web/aweme/collect/', () => fakeResponse({ status_code: 0 })],
      ['/collects/video/move/', () => fakeResponse({ status_code: 0 })],
    ]
    await withServer(routes, async (seen) => {
      const p1: any = await folderList(loggedFrom('collect_list'))
      expect([p1.data.map((f: any) => f.id), p1.page]).toEqual([['1001'], { cursor: '20', has_more: true }])
      const p2: any = await folderList(loggedFrom('collect_list', { cursor: '20' }))
      expect([p2.data.map((f: any) => f.name), p2.page]).toEqual([['第二页的收藏夹'], { cursor: null, has_more: false }])
      seen.length = 0
      expect(await itemCollect(loggedFrom('collect_move', { args: { item: AWEME }, options: { folder: '第二页的收藏夹' } }))).toEqual({ id: AWEME })
      const lists = seen.filter((r) => r.url.includes('/collects/list/')).map((r) => query(r).get('cursor'))
      expect(lists).toEqual(['0', '20'])
      const move = seen.find((r) => r.url.includes('/collects/video/move/'))!
      expect([query(move).get('to_collects_id'), query(move).get('collects_name')]).toEqual(['2002', '第二页的收藏夹'])
    })
  })
})

describe('douyin 审查修复：参数与发布', () => {
  it('--share 的目标：主页上点开的作品（/user/<sec_uid>?modal_id=）按作品算，与 resolveItem 一致', async () => {
    const { resolveItem, resolveShare } = await import('../src/platforms/douyin/web/resolve.js')
    const d = new Douyin(makeCtx({ platform: 'douyin' }))
    const modal = `https://www.douyin.com/user/${SEC_UID}?modal_id=${AWEME}`
    expect(await resolveShare(d, modal)).toEqual({ kind: 'item', id: AWEME })
    expect(await resolveItem(d, modal)).toBe(AWEME)
    expect(await resolveShare(d, `https://www.douyin.com/note/${AWEME}`)).toEqual({ kind: 'item', id: AWEME })
    expect(await resolveShare(d, AWEME)).toEqual({ kind: 'item', id: AWEME })
    expect(await resolveShare(d, `https://www.douyin.com/user/${SEC_UID}`)).toEqual({ kind: 'user', secUid: SEC_UID })
    expect(await resolveShare(d, SEC_UID)).toEqual({ kind: 'user', secUid: SEC_UID })
    expect(await resolveShare(d, 'https://example.com/a?b=1')).toEqual({ kind: 'web', url: 'https://example.com/a?b=1' })
    // /user/self 不是 sec_uid，当网页
    expect(await resolveShare(d, 'https://www.douyin.com/user/self')).toEqual({ kind: 'web', url: 'https://www.douyin.com/user/self' })
    await expect(resolveShare(d, 'hello')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('item publish 的本地校验（不发请求）与 PublishOptions 映射', async () => {
    const { itemPublish, publishOptions } = await commands()
    for (const options of [{}, { video: 'v.mp4', image: ['a.png'] }, { image: ['a.png'], poiName: '北京' }, { image: ['a.png', 'b.png'], cover: 'c.png' }]) {
      await withServer([], async (seen) => {
        await expect(itemPublish(makeCtx({ platform: 'douyin', cookies: 'sessionid=fake', cookieDomain: '.douyin.com', options })), JSON.stringify(options)).rejects.toMatchObject({ code: 'USAGE' })
        expect(seen).toEqual([])
      })
    }
    const schedule = '2026-10-01T12:00:00+08:00'
    expect(publishOptions({ title: 'T', text: '正文', tag: ['a'], visibility: 'friends', schedule, noDownload: true, poi: 123, poiName: '北京', series: '777', hotspot: '热点' })).toEqual({
      title: 'T',
      desc: '正文 #a',
      visibility: 2,
      timing: Math.floor(Date.parse(schedule) / 1000),
      allowDownload: false,
      poi: { poi_id: '123', poi_name: '北京' },
      mixId: '777',
      hotSpot: { word: '热点' },
    })
    expect(publishOptions({ visibility: 'private', poi: '1' })).toMatchObject({ desc: '', visibility: 1, allowDownload: true, poi: { poi_id: '1', poi_name: '' }, timing: undefined })
  })
})

describe('douyin 审查修复：直播', () => {
  const liveInfoCase = loadCase('douyin', 'live_info')

  it('live listen：房间解析不出来时直接报 UPSTREAM，不当成断线一直重连', async () => {
    const ctx = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake; ttwid=fake', cookieDomain: '.douyin.com' })
    await withServer([['https://live.douyin.com/', () => fakeResponse('<html>直播已结束</html>')]], async (seen) => {
      await expect(live.listenLive(ctx, new Douyin(ctx), '123')[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'UPSTREAM' })
      expect(seen.map(reqPath)).toEqual(['GET https://live.douyin.com/123'])
    })
  })

  it('live history：im/fetch 返回的不是 protobuf 时报 UPSTREAM', async () => {
    const { liveHistory } = await commands()
    const ctx = loggedFrom('live_info', { args: { room: liveInfoCase.input.web_rid } })
    await withServer(
      [
        ['/webcast/im/fetch/', () => fakeResponse('<html>captcha</html>')],
        ['/service/2/abtest_config/', () => fakeResponse('')],
        [`https://live.douyin.com/${liveInfoCase.input.web_rid}`, (p) => goldenReply(liveInfoCase.responses[0]!, p.url)],
      ],
      async () => {
        await expect(liveHistory(ctx)).rejects.toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('im/fetch') })
      },
    )
    expect(errorCode(() => live.decodeFetch(new Uint8Array([0xff, 0xff, 0xff])))).toBe('UPSTREAM')
  })

  it('直播消息的时间取公共头 Common 的 createTime（字段 1 → 4，毫秒）；没有时用当前时间', async () => {
    const protobuf = (await import('protobufjs')).default
    const n = await import('../src/core/normalize.js')
    const common = protobuf.Writer.create().uint32((1 << 3) | 2).fork().uint32((1 << 3) | 2).string('WebcastChatMessage').uint32((4 << 3) | 0).uint64(1790000000123).ldelim().finish()
    const chat = Buffer.concat([common, proto.encode('Live', 'ChatMessage', { user: { nickname: '观众A' }, content: '主播好' })])
    const bare = proto.encode('Live', 'ChatMessage', { user: { nickname: '观众B' }, content: '在吗' })
    expect(live.messageTime(chat)).toBe(n.time(1790000000123))
    expect(live.messageTime(bare)).toBeNull()
    const raw = proto.encode('Live', 'LiveResponse', {
      messagesList: [
        { method: 'WebcastChatMessage', payload: chat },
        { method: 'WebcastChatMessage', payload: bare },
      ],
    })
    const restore = rand.deterministic({ now: NOW })
    try {
      expect(live.fetchEvents(raw).map((e) => [e.text, e.time])).toEqual([
        ['主播好', n.time(1790000000123)],
        ['在吗', n.time(NOW)],
      ])
    } finally {
      restore()
    }
  })
})

describe('douyin 审查修复：TOS 上传', () => {
  const node = { store_uri: 'tos-cn-v-fake/abc', auth: 'fake-auth', upload_id: '', upload_host: 'tos-fake.snssdk.com', session_key: 'sk', upload_header: { 'x-tos-extra': '1' } }

  it('分片上传（超过 3MB）：创作者中心与私信共用流程，content-crc32 的位置与 uploadid 编码（urllib.parse.quote）各照上游', async () => {
    const tos = await import('../src/platforms/douyin/web/tos.js')
    const data = new Uint8Array(3 * 1024 * 1024 + 1).fill(7)
    const cases = [
      { style: tos.CREATOR_TOS, id: 'up/id+1', origin: 'https://creator.douyin.com', crcAt: 4 },
      { style: tos.IM_TOS, id: 'up/id%2B1', origin: 'https://www.douyin.com', crcAt: 11 },
    ]
    for (const c of cases) {
      const routes: Route[] = [
        ['phase=init', () => fakeResponse({ code: 2000, data: { uploadid: 'up/id+1' } })],
        ['tos-fake.snssdk.com', () => fakeResponse({ code: 2000 })],
      ]
      await withServer(routes, async (seen) => {
        await tos.tosUpload(new Douyin(makeCtx({ platform: 'douyin' })), c.style, node, data, '42')
        const base = 'https://tos-fake.snssdk.com/upload/v1/tos-cn-v-fake/abc'
        expect(seen.map((r) => r.url)).toEqual([
          `${base}?uploadmode=part&phase=init`,
          `${base}?uploadid=${c.id}&part_number=1&phase=transfer&part_offset=0`,
          `${base}?uploadmode=part&phase=finish&uploadid=${c.id}`,
        ])
        const names = seen[1]!.headers.map(([k]) => k)
        expect(names.indexOf('content-crc32')).toBe(c.crcAt)
        expect(names.at(-1)).toBe('x-tos-extra')
        expect(Object.fromEntries(seen[1]!.headers)).toMatchObject({ origin: c.origin, referer: `${c.origin}/`, 'x-storage-u': '42' })
        expect(seen[0]!.headers.some(([k]) => k === 'content-crc32')).toBe(false)
        expect(seen[2]!.body).toBe(`1:${crc32Hex(data)}`)
      })
    }
    // 成功码：创作者中心只认 2000，私信也接受没有 code 的响应
    const small = new Uint8Array(10)
    for (const [style, code] of [
      [tos.CREATOR_TOS, 'UPSTREAM'],
      [tos.IM_TOS, null],
    ] as const) {
      await withServer([['tos-fake.snssdk.com', () => fakeResponse({})]], async () => {
        const run = tos.tosUpload(new Douyin(makeCtx({ platform: 'douyin' })), style, node, small, '')
        if (code) await expect(run).rejects.toMatchObject({ code })
        else await run
      })
    }
  })
})
