import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import * as rand from '../src/core/rand.js'
import type { LocalMedia } from '../src/core/files.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/douyin/web/api.js'
import { Douyin } from '../src/platforms/douyin/web/client.js'
import * as creator from '../src/platforms/douyin/web/creator.js'
import * as im from '../src/platforms/douyin/web/im.js'
import * as live from '../src/platforms/douyin/web/live.js'
import { Passport } from '../src/platforms/douyin/web/passport.js'
import * as proto from '../src/platforms/douyin/web/proto.js'
import { commonBehavior, commonReport, strDataReport } from '../src/platforms/douyin/web/mssdk.js'
import { ABogus, fakeWebid, liveSignature, randomMsToken, signedUrl, sm3, spliceUrl, svWebId, XBogus } from '../src/platforms/douyin/web/sign.js'
import { type GoldenCase, type GoldenRequest, loadCase, makeCtx, normalize, replay } from './golden.js'

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
    const hs: [string, string][] = []
    for (const [k, v] of Object.entries(r.headers)) for (const x of Array.isArray(v) ? v : [v]) hs.push([k, x])
    const body = typeof r.body === 'string' ? r.body : (r.body as any)?.base64 != null ? new Uint8Array(Buffer.from((r.body as any).base64, 'base64')) : JSON.stringify(r.body)
    return fakeResponse(body, { status: r.status, headers: hs, url: p.url })
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
}

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGNgYGD4z8DAwMAAAAwAAf8v0Mo8AAAAAElFTkSuQmCC'
const CONV_ID = '0:1:97872126662:1234567890'

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
    const { withUifid } = await import('../src/platforms/douyin/web/commands.js')
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
      const run = withUifid(async (c) => {
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
    const { withUifid } = await import('../src/platforms/douyin/web/commands.js')
    const { CatbusError } = await import('../src/core/errors.js')
    const ctx = makeCtx({ platform: 'douyin', cookies: 'sessionid=fake', cookieDomain: '.douyin.com' })
    await expect(withUifid(async () => Promise.reject(new CatbusError('UPSTREAM', 'x')))(ctx) as Promise<unknown>).rejects.toMatchObject({ code: 'UPSTREAM' })
    const stream = (async function* () {})()
    expect(withUifid(() => stream)(ctx)).toBe(stream)
  })
})
