import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parseCookieInput } from '../src/core/cookies.js'
import { fakeResponse, type HttpResponse, mockSender } from '../src/core/http.js'
import { deterministic } from '../src/core/rand.js'
import * as n from '../src/core/normalize.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/tiktok/web/api.js'
import { hydration, TikTok } from '../src/platforms/tiktok/web/client.js'
import * as im from '../src/platforms/tiktok/web/im.js'
import { frontierSign, shopSign } from '../src/platforms/tiktok/web/jsrun.js'
import * as sign from '../src/platforms/tiktok/web/sign.js'
import * as up from '../src/platforms/tiktok/web/upload.js'
import * as wire from '../src/platforms/tiktok/web/wire.js'
import { type GoldenCase, type GoldenRequest, loadCase, makeCtx, normalize } from './golden.js'

/** WebSocket 替身：记录地址与发出的帧，按顺序回放 `wsFrames` 里预置的帧。 */
const sockets: { url: string; headers: unknown; sent: Uint8Array[] }[] = []
let wsFrames: (Uint8Array | string)[] = []
vi.mock('../src/core/stream.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/core/stream.js')>()
  return {
    ...orig,
    openSocket: async (url: string, options: { headers?: unknown } = {}) => {
      const s = { url, headers: options.headers, sent: [] as Uint8Array[] }
      sockets.push(s)
      const frames = wsFrames.map((f) => (typeof f === 'string' ? f : Buffer.from(f)))
      return {
        send: async (d: string | Uint8Array) => void s.sent.push(typeof d === 'string' ? new TextEncoder().encode(d) : Uint8Array.from(d)),
        close: () => {},
        messages: (async function* () {
          yield* frames
        })(),
      }
    },
  }
})

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
const KEY = [0x01234567, 0x89abcdef, 0xfedcba98, 0x76543210, 1, 2, 3, 4, 0xffffffff, 0x80000000, 12345, 67890]
const Q = 'aid=1988&app_name=tiktok_web&keyword=%E7%8C%AB&msToken=abc'
const FIX = JSON.parse(readFileSync(new URL('./golden/tiktok/_fixtures.json', import.meta.url), 'utf8'))

/** 在与对拍数据相同的确定性随机数与时钟下运行。 */
async function det<T>(name: string, fn: () => T | Promise<T>): Promise<{ result: T; expected: any }> {
  const c = loadCase('tiktok', name)
  const restore = deterministic({ seed: c.seed, now: c.now })
  try {
    return { result: await fn(), expected: c.result }
  } finally {
    restore()
  }
}

const b64 = (b: Uint8Array) => ({ base64: Buffer.from(b).toString('base64') })

describe('tiktok 对拍：纯算签名', () => {
  it('X-Bogus', async () => {
    const { result, expected } = await det('pure_x_bogus', () => [
      sign.encodeXBogus(Q, UA, '', { timestamp: 1790000000, ubcode: 136, magic: 2894886431 }),
      sign.encodeXBogus('msToken=' + 'A'.repeat(142) + '==', UA, '{"a":1}', { timestamp: 1790000000, ubcode: 14, magic: 2894886431 }),
      sign.encodeXBogus(Q, UA),
    ])
    expect(result).toEqual(expected)
  })

  it('X-Gnarly（project/post 10 字段）', async () => {
    const { result, expected } = await det('pure_gnarly_project', () => [
      sign.encodeGnarlyProject(Q, '{"x":"中文"}', UA, { timestamp: 1790000000, timestampMs: 1790000000123, keyWords: KEY }),
      sign.encodeGnarlyProject(Q, Uint8Array.from([0x1f, 0x8b, 0x00, 0xff]), UA),
    ])
    expect(result).toEqual(expected)
  })

  it('X-Gnarly（Web API 17 字段）', async () => {
    const { result, expected } = await det('pure_gnarly_current', () => [
      sign.encodeGnarlyCurrent(Q, '', UA, { timestamp: 1790000000, timestampMs: 1790000000123, randomLow16: 4660, random32: 0xdeadbeef, randomTail: 7, keyWords: KEY }),
      sign.encodeGnarlyCurrent(Q, 'room_id=1', UA),
    ])
    expect(result).toEqual(expected)
  })

  it('X-Dynosaur', async () => {
    const { result, expected } = await det('pure_dynosaur', () => [
      sign.encodeDynosaurCurrent(Q, UA, {
        page: 'www.tiktok.com/',
        timestamp: 1790000000,
        randB: 123456789,
        runtimeField8: '1234567890',
        runtimeField18: '1.0.0.2870',
        runtimeField19: '0123456789abcdef0123456789abcdef',
        keyWords: KEY,
      }),
      sign.encodeDynosaurCurrent(Q, UA, { page: 'www.tiktok.com/@猫/live' }),
      sign.hashUrlState(Q),
    ])
    expect(result).toEqual(expected)
  })

  it('签名调度：legacy 四字段 / project 三字段', async () => {
    const url = 'https://www.tiktok.com/api/comment/list/?aid=1988&cursor=0&referer=https%3A%2F%2Fwww.tiktok.com%2F&msToken=tok_en-1'
    const { result, expected } = await det('signer_dispatch', () => [
      sign.signRequest({ url, method: 'GET', body: null, userAgent: UA, referer: 'https://www.tiktok.com/@tiktok?lang=zh-Hans' }),
      sign.signRequest({
        url: url.replace('/api/comment/list/', '/webcast/room/like/'),
        method: 'POST',
        body: '{"to_uid":"1"}',
        userAgent: UA,
        referer: 'https://www.tiktok.com/@x/live',
        metrics: { dynosaur_page: 'www.tiktok.com/@x/live', rand_b: 111222333 },
      }),
      sign.signRequest({
        url: 'https://www.tiktok.com/tiktok/web/project/post/v1/?app_name=tiktok_web&aid=1988&msToken=mt',
        method: 'POST',
        body: '{"k":1}',
        userAgent: UA,
        referer: 'https://www.tiktok.com/',
        signingTimestamp: 1789999999,
      }),
    ])
    expect(result).toEqual(expected)
  })

  it('AWS SigV4', async () => {
    const pairs: [string, string][] = [
      ['Action', 'ApplyUploadInner'],
      ['Version', '2020-11-19'],
      ['SpaceName', 'tiktok'],
      ['FileType', 'video'],
      ['s', 'abcdefghijk'],
      ['device_platform', 'web'],
      ['business_tag', 'tiktok_video_submission_web'],
      ['Z', 'a b~*'],
    ]
    const { result, expected } = await det('aws_v4', () => [
      sign.canonicalAwsQuery(pairs),
      sign.signAwsV4({ method: 'GET', path: '/top/v1', query: pairs, accessKeyId: 'AKFAKE', secretAccessKey: 'SKFAKE', sessionToken: 'STFAKE' }),
      sign.signAwsV4({
        method: 'POST',
        path: '/top/v1',
        query: pairs.slice(0, 3),
        accessKeyId: 'AKFAKE',
        secretAccessKey: 'SKFAKE',
        sessionToken: 'STFAKE',
        body: '{"SessionKey":"sk"}',
        service: 'imagex',
      }),
    ])
    expect(result).toEqual(expected)
  })

  it('tt-ticket-guard：确定部分逐字节一致，ECDSA 签名可用公钥验证', async () => {
    const { expected } = await det('ticket_guard', () => null)
    const headers = sign.ticketGuardHeaders({ privateKey: FIX.private_key, encryptTicket: FIX.encrypt_ticket, tsSign: FIX.ts_sign }, '/api/comment/publish/', 1790000000)
    const data = JSON.parse(Buffer.from(headers['tt-ticket-guard-client-data']!, 'base64').toString('utf8'))
    const { createPublicKey, verify } = await import('node:crypto')
    const ok = verify(
      'sha256',
      Buffer.from('ticket=fake-ticket-0001&path=/api/comment/publish/&timestamp=1790000000'),
      { key: createPublicKey(FIX.private_key), dsaEncoding: 'der' },
      Buffer.from(data.req_sign, 'base64'),
    )
    expect(ok).toBe(true)
    delete data.req_sign
    delete headers['tt-ticket-guard-client-data']
    expect({
      headers,
      client_data: data,
      ticket: sign.decryptEncryptTicket(FIX.encrypt_ticket),
      client_data_encoded: sign.encodeClientData({ tsSign: FIX.ts_sign, reqSign: 'AAAA', timestamp: 1790000000 }),
    }).toEqual(expected)
  })
})

describe('tiktok 对拍：直播 protobuf', () => {
  it('LiveResponse / PushFrame 解码与心跳、进房、ACK 帧', async () => {
    const { expected } = await det('live_wire', () => null)
    const resp = Buffer.from(expected.response_raw.base64, 'base64')
    const frame = Buffer.from(expected.frame_raw.base64, 'base64')
    const idsToNumbers = (r: wire.LiveResponse) =>
      JSON.parse(JSON.stringify(r), (k, v) => (['id', 'message_id', 'gift_id'].includes(k) && typeof v === 'string' ? Number(v) : v))
    expect(idsToNumbers(wire.decodeLiveResponse(resp))).toEqual(expected.response)
    const pf = wire.decodePushFrame(frame)
    expect({ ...pf, seq_id: Number(pf.seq_id), log_id: Number(pf.log_id), response: idsToNumbers(pf.response!) }).toEqual(expected.frame)
    expect(b64(wire.encodeHeartbeat('7300000000000000001'))).toEqual(expected.heartbeat)
    expect(b64(wire.encodeEnterRoom('7300000000000000001', 12, 'cursor-1'))).toEqual(expected.enter)
    expect(b64(wire.encodeFrame('ack', new TextEncoder().encode('ext=1'), 8))).toEqual(expected.ack)
  })
})

describe('tiktok 对拍：上游 Node 签名运行器', () => {
  it('frontierSign（直播 WS / 私信 stub）', async () => {
    const cookie = 'ttwid=1%7Cfake%7C1790000000%7Cabc; msToken=fakeMsToken; s_v_web_id=verify_fake'
    const { result, expected } = await det('frontier_sign', async () => [
      await frontierSign({ cookie, userAgent: UA, referer: 'https://www.tiktok.com/@host/live' }),
      await frontierSign({ cookie, userAgent: UA, referer: 'https://www.tiktok.com/messages', stub: '0123456789abcdef0123456789abcdef' }),
    ])
    expect(result).toEqual(expected)
  }, 60_000)

  it('Shop BSID（含 X-Bogus 与 _signature）', async () => {
    const ms = 'A'.repeat(142) + '=='
    const body =
      '{"product_id":"1729384756","page_start":2,"page_size":3,"sort_rule":1,"review_filter":{"filter_type":1,"filter_value":6},"component_name":"pdp_left_reviews"}'
    const { result, expected } = await det('shop_bsid', () =>
      shopSign({
        url: 'https://shop.tiktok.com/api/shop/pdp_desktop/get_product_reviews',
        method: 'POST',
        headers: [
          ['accept', 'application/json,*/*;q=0.8'],
          ['content-type', 'application/json'],
        ],
        body,
        cookie: `msToken=${ms}; oec_lucifer=${'ab'.repeat(80)}; ttwid=fake`,
        userAgent: UA,
        xBogus: (token) => sign.encodeXBogus(`msToken=${token}`, UA, body, { ubcode: 14, magic: 2894886431 }),
      }),
    )
    expect(result).toEqual(expected)
  }, 60_000)
})

// ================================================================ 请求构造对拍

const SESSION = JSON.parse(readFileSync(new URL('./golden/tiktok/_session.json', import.meta.url), 'utf8'))
const SEC = 'MS4wLjABAAAAfakeSecUid0123456789abcdefghijklmnopqrstuvwxyz'
const AWEME = '7300000000000000123'
const ROOM = '7300000000000000456'
const HOST = '7100000000000000789'
const VIDEO_URL = `https://www.tiktok.com/@creator/video/${AWEME}`
const PRODUCT_URL = 'https://shop.tiktok.com/us/pdp/fake-product/1729384756'
const LIVE_PAGE = 'https://www.tiktok.com/@host.name/live'

/** 与 gen.py 的 TiktokAuth.from_cookie(COOKIE, **RUNTIME) 等价的登录态上下文。 */
function sessionCtx(extra: Parameters<typeof makeCtx>[0] | Record<string, never> = {}) {
  const { cookie, ...device } = SESSION
  const ctx = makeCtx({ platform: 'tiktok', ...extra })
  ctx.credential.scopes.main!.cookies = parseCookieInput(cookie, '.tiktok.com')
  ctx.credential.device = structuredClone(device)
  return ctx
}

function toResponse(r: GoldenCase['responses'][number], url: string): HttpResponse {
  const headers: [string, string][] = []
  for (const [k, v] of Object.entries(r.headers)) for (const x of Array.isArray(v) ? v : [v]) headers.push([k, x])
  const body: any = r.body
  const data = typeof body === 'string' ? body : body && typeof body === 'object' && 'base64' in body ? Buffer.from(body.base64, 'base64') : JSON.stringify(body)
  return fakeResponse(data, { status: r.status, headers, url })
}

/** golden.replay 的变体：响应可以是二进制（{base64}）。 */
async function replayTt<T>(c: GoldenCase, run: () => Promise<T>) {
  const requests: GoldenRequest[] = []
  const restoreRand = deterministic({ seed: c.seed, now: c.now })
  const restoreSender = mockSender((p) => {
    requests.push(normalize(p))
    const r = c.responses[requests.length - 1]
    if (!r) throw new Error(`TS 实现多发了请求：${p.method} ${p.url}`)
    return toResponse(r, p.url)
  })
  try {
    return { requests, result: await run(), error: undefined as unknown }
  } catch (error) {
    return { requests, result: undefined as T | undefined, error }
  } finally {
    restoreSender()
    restoreRand()
  }
}

const GUARD = 'tt-ticket-guard-client-data'

/**
 * ticket-guard 的 client-data 里有 ECDSA 签名（每次随机）：解出 JSON，用公钥验 TS 的签名，
 * 再把 req_sign 去掉后比较其余字段。
 */
function maskGuard(r: GoldenRequest, path: string, checkSig: boolean): GoldenRequest {
  const i = r.headers.findIndex(([k]) => k === GUARD)
  if (i < 0) return r
  const data = JSON.parse(Buffer.from(r.headers[i]![1], 'base64').toString('utf8'))
  if (checkSig) {
    const msg = `ticket=fake-ticket-0001&path=${path}&timestamp=${data.timestamp}`
    const ok = verify('sha256', Buffer.from(msg), { key: createPublicKey(SESSION.ticket_guard_private_key), dsaEncoding: 'der' }, Buffer.from(data.req_sign, 'base64'))
    expect(ok, `ticket-guard 签名：${path}`).toBe(true)
  }
  delete data.req_sign
  const headers = r.headers.map(([k, v], j) => [k, j === i ? JSON.stringify(data) : v] as [string, string])
  return { ...r, headers }
}

function expectSame(actual: GoldenRequest[], expected: GoldenRequest[], guardPath?: (r: GoldenRequest) => string) {
  expect(actual.map((r) => `${r.method} ${r.url}`)).toEqual(expected.map((r) => `${r.method} ${r.url}`))
  actual.forEach((r, i) => {
    const path = guardPath?.(r) ?? new URL(r.url).pathname
    expect(maskGuard(r, path, true), `第 ${i + 1} 个请求：${r.method} ${r.url}`).toEqual(maskGuard(expected[i]!, path, false))
  })
}

async function session(extra?: Parameters<typeof makeCtx>[0]) {
  const t = new TikTok(sessionCtx(extra))
  await t.prepare()
  return t
}

const API_CASES: Record<string, (t: TikTok) => Promise<unknown>> = {
  user_posted: (t) => api.userPosted(t, SEC, '17'),
  recommend_feed: (t) => api.recommendFeed(t),
  user_playlist: (t) => api.userPlaylist(t, SEC, '5'),
  profile_followers: (t) => api.profileUserList(t, SEC, '67', { minCursor: '1789990000' }),
  profile_following: (t) => api.profileUserList(t, SEC, '21'),
  following_item_list: (t) => api.followingItemList(t, '9'),
  notice_count: (t) => api.noticeCount(t),
  notice_multi: (t) => api.noticeMulti(t, [{ count: 20, is_mark_read: 0, group: 500, max_time: 1789990000, min_time: 0 }]),
  im_user_profile: (t) => api.imUserProfile(t, ['107955', '42']),
  collection_list: (t) => api.collectionList(t, SEC, '3'),
  repost_list: (t) => api.repostList(t, SEC),
  collected_item_list: (t) => api.collectedItemList(t, SEC, '16'),
  playlist_name_check: (t) => api.checkPlaylistName(t, '我的 收藏'),
  collection_create: (t) => api.collectionCreate(t, '我的 收藏'),
  collection_modify_info: (t) => api.collectionModifyInfo(t, '7394627756635573022', '新名字'),
  collection_detail: (t) => api.collectionDetail(t, '7394627756635573022'),
  collection_item_list: (t) => api.collectionItemList(t, '7394627756635573022', '30'),
  search_live_room: (t) => api.searchLiveRoom(t, '猫 cat'),
  search_general: (t) => api.searchGeneral(t, 'cat', { offset: '12' }),
  search_suggest: (t) => api.searchSuggest(t, 'cat'),
  comments: (t) => api.comments(t, AWEME, '20'),
  comment_replies: (t) => api.commentReplies(t, AWEME, '7300000000000000999', { cursor: '0', referer: VIDEO_URL, rootReferer: VIDEO_URL }),
  comment_publish: (t) => api.postComment(t, AWEME, '好看 & 猫'),
  comment_reply: (t) => api.postComment(t, AWEME, '回复', { replyId: '7300000000000000999' }),
  item_digg: (t) => api.itemDigg(t, AWEME, '1'),
  item_undigg: (t) => api.itemDigg(t, AWEME, '0', { referer: VIDEO_URL, queryReferer: 'https://www.tiktok.com/@creator' }),
  item_collect: (t) => api.itemCollect(t, AWEME, SEC, '1'),
  follow_user: (t) => api.followUser(t, '107955', SEC, { actionType: '1', referer: 'https://www.tiktok.com/@tiktok', queryReferer: 'https://www.tiktok.com/@tiktok' }),
  unfollow_user: (t) => api.followUser(t, '107955', SEC, { actionType: '0', referer: 'https://www.tiktok.com/@tiktok', queryReferer: 'https://www.tiktok.com/@tiktok' }),
  related_items: (t) => api.relatedItems(t, AWEME, { referer: VIDEO_URL }),
  webcast_feed: (t) => api.webcastFeed(t),
  live_user_room: (t) => api.liveUserRoom(t, 'host.name'),
  webcast_drawer_tabs: (t) => api.webcastDrawerTabs(t),
  live_gift_list: (t) => api.liveGiftList(t, ROOM),
  webcast_rank_list: (t) => api.webcastRankList(t, HOST, ROOM),
  live_chat: (t) => api.postLiveChat(t, ROOM, '你好', { referer: LIVE_PAGE }),
  live_like: (t) => api.postLiveLike(t, HOST, ROOM, { referer: LIVE_PAGE }),
  creator_item_list: (t) => api.creatorItemList(t, 50),
  creator_poi_list: (t) => api.creatorPoiList(t, { pageNum: 2 }),
  wid: async (t) => (await api.cookiePrivacyConfig(t)).body.consent.wid,
  video_detail: (t) => api.videoDetail(t, VIDEO_URL, AWEME),
  user_info: async (t) => hydration(await api.userHtml(t, 'https://www.tiktok.com/@tiktok'))!['webapp.user-detail'],
  shop_product_detail: (t) => api.shopProductDetail(t, PRODUCT_URL, '1729384756'),
  shop_review_page: (t) => {
    t.jar.set('msToken', 'A'.repeat(142) + '==', '.tiktok.com')
    t.jar.set('oec_lucifer', 'ab'.repeat(80), '.tiktok.com')
    return api.shopReviewPage(t, PRODUCT_URL, '1729384756', 2)
  },
}

describe('tiktok 对拍：请求构造与签名（TiktokWebAPI 的各个方法）', () => {
  for (const [name, run] of Object.entries(API_CASES)) {
    it(name, async () => {
      const c = loadCase('tiktok', name)
      const { requests, result, error } = await replayTt(c, async () => run(await session()))
      if (error) throw error
      expectSame(requests, c.requests)
      expect(result).toEqual(c.result)
    }, 60_000)
  }
})

// ================================================================ 直播长连、私信、上传发布、命令流程

const B64 = (x: { base64: string }) => Uint8Array.from(Buffer.from(x.base64, 'base64'))
const b64of = (x: Uint8Array) => ({ base64: Buffer.from(x).toString('base64') })
const numIds = (v: unknown) =>
  JSON.parse(JSON.stringify(v), (k, x) => (['id', 'message_id', 'gift_id'].includes(k) && typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : x))
/** 64 位整数在 JSON 里会被 JS 解析成近似值：两边都按 Number 取整后再比（上游是 Python int，TS 是字符串）。 */
const strIds = (m: object) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? String(Number(v)) : v]))

describe('tiktok 对拍：直播 protobuf 拉取与长连', () => {
  it('webcast/im/fetch（两个 version_code 的原样 query，二进制回包）', async () => {
    const c = loadCase('tiktok', 'webcast_im_fetch')
    const { requests, result, error } = await replayTt(c, async () => api.webcastImFetch(await session(), '12', ROOM, { referer: LIVE_PAGE }))
    if (error) throw error
    expectSame(requests, c.requests)
    expect(b64of(result!)).toEqual(c.result)
  })

  it('live listen：HTTP 首批 → frontierSign → WS 地址、心跳 / 进房 / ACK 帧、按消息 ID 去重', async () => {
    const c = loadCase('tiktok', 'live_listen')
    const { liveEvents } = await import('../src/platforms/tiktok/web/commands.js')
    sockets.length = 0
    wsFrames = [B64(c.result.frame)]
    const ctx = sessionCtx()
    const controller = new AbortController()
    ctx.signal = controller.signal
    const events: wire.LiveEvent[] = []
    const { requests, error } = await replayTt(c, async () => {
      const t = new TikTok(ctx)
      await t.prepare()
      for await (const e of liveEvents(ctx, t, ROOM, LIVE_PAGE)) {
        events.push(e)
        if (events.length === c.result.events.length) break
      }
      controller.abort()
    })
    if (error) throw error
    expectSame(requests, c.requests)
    expect(sockets[0]!.url).toBe(c.result.url)
    expect(sockets[0]!.headers).toMatchObject({ Origin: c.result.origin })
    expect(sockets[0]!.sent.map(b64of)).toEqual(c.result.sent)
    expect(numIds(events)).toEqual(c.result.events)
  }, 60_000)
})

describe('tiktok 对拍：私信', () => {
  const CONV = '0:1:7000000000000000001:6900000000000000001'
  const pulls: Record<string, (t: TikTok) => Promise<Uint8Array>> = {
    im_user_init: (t) => im.pullInit(t, 0),
    im_conversation: (t) => im.pullConversation(t, { conversationId: CONV, shortId: '7300000000000000777', type: '1', anchorIndex: '0', direction: 1, limit: 50 }),
    im_user_combo: (t) =>
      api.postImProtobuf(
        t,
        '/v1/message/get_by_user_combo',
        wire.imUserComboRequest(
          [
            { inbox_type: 0, cursor: 1789990000000, limit: 50, scene: 1 },
            { inbox_type: 1, cursor: 0, limit: 20, scene: 1, cursor_type: 1 },
          ],
          im.envelope(t),
          { statusAdapterMap: 1, lastPullTime: 1789990000 },
        ),
      ),
  }
  for (const [name, run] of Object.entries(pulls)) {
    it(`${name}：protobuf 请求逐字节一致，回包里的文本消息一致`, async () => {
      const c = loadCase('tiktok', name)
      const { requests, result, error } = await replayTt(c, async () => run(await session()))
      if (error) throw error
      expectSame(requests, c.requests)
      expect(b64of(result!)).toEqual(c.result.raw)
      expect(wire.pulledMessages(wire.decodeWire(result!)).map(strIds)).toEqual(c.result.messages.map(strIds))
      expect(wire.pulledConversations(wire.decodeWire(result!))).toEqual([{ conversation_id: CONV, conversation_short_id: '7300000000000000777', conversation_type: '1' }])
    })
  }

  it('im send：WS 地址与 command-100 帧（除 ticket-guard 签名及依赖它的 X-Bogus 外逐字段一致）', async () => {
    const c = loadCase('tiktok', 'im_send')
    const { requests, result, error } = await replayTt(c, async () => {
      const t = await session()
      return { url: await im.imWsUrl(t), built: await im.buildSendFrame(t, { conversationId: CONV, shortId: '7300000000000000777', type: '1', text: '你好 catbus' }) }
    })
    if (error) throw error
    expect(requests).toEqual([])
    expect(result!.url).toBe(c.result.url)
    const protobuf = (await import('protobufjs')).default
    const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(new URL('../static/tiktok/Tiktok_Request.json', import.meta.url), 'utf8')))
    const decode = (bytes: Uint8Array) => {
      const F = root.lookupType('im_proto.Frame')
      const R = root.lookupType('im_proto.Request')
      const f = F.toObject(F.decode(bytes), { longs: String, bytes: String }) as any
      const r = R.toObject(R.decode(Buffer.from(f.payload, 'base64')), { longs: String, bytes: String }) as any
      const guard = r.headers.find((h: any) => h.key === GUARD)
      const data = JSON.parse(Buffer.from(guard.value, 'base64').toString('utf8'))
      delete data.req_sign
      guard.value = data
      f.headers.find((h: any) => h.key === 'X-Bogus').value = '<frontierSign(md5(Request))>'
      delete f.payload
      return { frame: f, request: r }
    }
    expect(decode(result!.built.frame)).toEqual(decode(B64(c.result.sent[0])))
    expect(strIds(wire.decodeImSendResponse(B64(loadCase('tiktok', 'im_decode').result.reply)))).toMatchObject(
      strIds(Object.fromEntries(Object.entries(c.result.response).filter(([k]) => !k.startsWith('wire_')))),
    )
  }, 60_000)

  it('新消息推送与发送回包的解码', async () => {
    const { expected } = await det('im_decode', () => null)
    expect(strIds(wire.decodeImNotification(B64(expected.frame))!)).toEqual(strIds(expected.decoded))
    expect(strIds(wire.decodeImSendResponse(B64(expected.reply)))).toEqual(strIds(expected.send_response))
  })
})

const UPLOAD_AUTH = {
  video_token_v5: { access_key_id: 'AKVIDEO', secret_acess_key: 'SKVIDEO', session_token: 'STVIDEO', space_name: 'tiktok' },
  vframe_token_v5: { access_key_id: 'AKFRAME', secret_acess_key: 'SKFRAME', session_token: 'STFRAME', space_name: 'tiktok-ai-frame' },
  status_code: 0,
}
const APPLIED = {
  Result: {
    InnerUploadAddress: {
      UploadNodes: [{ Vid: 'v0vid001', SessionKey: 'sessionkey001', UploadHost: 'tos-sg.example.com', StoreInfos: [{ StoreUri: 'tos-sg/obj001', Auth: 'SpaceKey/tos-auth-001' }] }],
    },
  },
}
const MEDIA = Uint8Array.from({ length: 1024 }, (_, i) => i % 256)
const PHOTO_REF = 'https://www.tiktok.com/tiktokstudio/upload/post/photo'

const UPLOAD_CASES: Record<string, (t: TikTok) => Promise<unknown>> = {
  upload_auth_signed: (t) => up.uploadAuth(t),
  upload_auth_unsigned: (t) => up.uploadAuth(t, { signed: false, referer: PHOTO_REF }),
  upload_candidates: (t) => up.uploadCandidates(t, UPLOAD_AUTH),
  apply_upload_inner_video: (t) => up.applyUploadInner(t, MEDIA.length, { auth: UPLOAD_AUTH, clientBestHosts: ['up1.example.com', 'up2.example.com'] }),
  apply_upload_inner_image: (t) => up.applyUploadInner(t, 10, { fileType: 'image', spaceName: 'tiktok-ai-frame', auth: UPLOAD_AUTH }),
  upload_tos_post: (t) => up.uploadTosBytes(t, APPLIED, MEDIA, { auth: UPLOAD_AUTH, postUpload: true }),
  upload_tos_plain: (t) => up.uploadTosBytes(t, APPLIED, MEDIA, { filename: 'undefined' }),
  commit_upload_inner: (t) => up.commitUploadInner(t, 'sessionkey001', { auth: UPLOAD_AUTH, spaceName: 'tiktok-ai-frame' }),
  apply_image_upload: (t) => up.applyImageUpload(t, MEDIA.length, UPLOAD_AUTH),
  commit_image_upload: (t) => up.commitImageUpload(t, 'sessionkey001', UPLOAD_AUTH),
  upload_photo_bytes: (t) => up.uploadPhotoBytes(t, MEDIA, UPLOAD_AUTH),
  upload_media_image: (t) => up.uploadMediaBytes(t, MEDIA, { fileType: 'image', spaceName: 'tiktok', scene: 'poster', businessTag: 'tiktok_video_cover_web', auth: UPLOAD_AUTH }),
  transcode_enable: (t) => up.enableVideoTranscode(t, 'v0vid001'),
  transcode_result: (t) => up.videoTranscodeResult(t, 'v0vid001', { width: 720, height: 1280, durationMs: 14000, fileKey: 'file_1790000000123_000042' }),
  media_openid: (t) => up.mediaOpenId(t),
  project_create: (t) => up.projectCreate(t, 'ROO_abcdefghijk012345'),
  project_bodies: async () => ({
    video: up.buildVideoProjectBody({
      creationId: 'ROO_abcdefghijk012345',
      videoId: 'v0vid001',
      text: '文案 #cat',
      coverUri: 'tos-sg/poster001',
      playUrl: 'https://v.example.com/play.mp4',
      filename: 'a.mp4',
      width: 720,
      height: 1280,
      durationMs: 14000,
      fps: 30,
      visibilityType: 0,
    }),
    photo: up.buildPhotoProjectBody({
      creationId: 'abcdefghijklmnopqrstu',
      photos: [
        { id: 'file_1790000000123_42', uri: 'tos-sg/img001', width_px: 1080, height_px: 1920 },
        { id: 'file_1790000000124_7', uri: 'tos-sg/img002', width_px: 800, height_px: 600 },
      ],
      text: '图文',
      title: '标题',
      visibilityType: 2,
    }),
    creation_id: up.creationId(),
    photo_creation_id: up.photoCreationId(),
    upload_s: up.uploadRandomS(),
  }),
  post_project: (t) => up.postProject(t, '{"post_common_info":{"creation_id":"ROO_x"}}'),
}

describe('tiktok 对拍：Creator Studio 上传与发布（AWS V4、TOS、ImageX、转码、project/post）', () => {
  for (const [name, run] of Object.entries(UPLOAD_CASES)) {
    it(name, async () => {
      const c = loadCase('tiktok', name)
      const { requests, result, error } = await replayTt(c, async () => run(await session()))
      if (error) throw error
      expectSame(requests, c.requests)
      expect(result).toEqual(c.result)
    })
  }
})

describe('tiktok 对拍：命令流程', () => {
  it('user items @tiktok：主页 SSR 取 secUid → post/item_list，归一化成 Item', async () => {
    const c = loadCase('tiktok', 'flow_user_items')
    const { userItems } = await import('../src/platforms/tiktok/web/commands.js')
    const ctx = sessionCtx({ platform: 'tiktok', args: { user: '@tiktok' } })
    const { requests, result, error } = await replayTt(c, () => userItems(ctx))
    if (error) throw error
    expectSame(requests, c.requests)
    const r = result as any
    expect(r.page).toEqual({ cursor: c.result.cursor, has_more: true })
    expect(r.data[0][RAW]).toEqual(c.result.itemList[0])
    expect(r.data[0]).toMatchObject({
      id: AWEME,
      kind: 'video',
      url: VIDEO_URL,
      text: '猫 #cat',
      author: { id: '6900000000000000001', name: '创作者', url: 'https://www.tiktok.com/@creator' },
      created_at: n.time(1789990000),
      stats: { views: 1200, likes: 34, comments: 5, collects: 6, shares: 7 },
      media: [{ type: 'video', url: 'https://v16-webapp-prime.tiktok.com/video/x/?a=1988', width: 720, height: 1280, duration: 14 }],
    })
  })

  it('comment list <商品 URL> --cursor 2：商品页 SSR → 第 2 页评价（Shop BSID）', async () => {
    const c = loadCase('tiktok', 'flow_product_reviews')
    const { commentList } = await import('../src/platforms/tiktok/web/commands.js')
    const ctx = sessionCtx({ platform: 'tiktok', args: { item: PRODUCT_URL }, cursor: '2' })
    const cookies = ctx.credential.scopes.main!.cookies
    cookies.find((x) => x.name === 'msToken')!.value = 'A'.repeat(142) + '=='
    cookies.push({ name: 'oec_lucifer', value: 'ab'.repeat(80), domain: '.tiktok.com', path: '/', expires: null })
    const { requests, result, error } = await replayTt(c, () => commentList(ctx))
    if (error) throw error
    expectSame(requests, c.requests)
    const r = result as any
    expect(r.page).toEqual({ cursor: null, has_more: false })
    expect(r.data.map((x: any) => x[RAW])).toEqual(c.result.product_reviews)
    expect(r.data[0]).toMatchObject({ id: 'r2', item_id: '1729384756', text: '二' })
  }, 60_000)
})

// ================================================================ 上游没有的部分：游客态、登录

const page = (scope: object) =>
  `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: scope })}</script></html>`

/** 按顺序回复预置响应，记录发出的请求。 */
async function withResponses<T>(bodies: string[], run: () => Promise<T>): Promise<{ result: T; requests: GoldenRequest[] }> {
  const requests: GoldenRequest[] = []
  const restoreRand = deterministic()
  const restore = mockSender((p) => {
    requests.push(normalize(p))
    return fakeResponse(bodies[requests.length - 1] ?? '{}', { url: p.url, headers: [['content-type', 'text/html']] })
  })
  try {
    return { result: await run(), requests }
  } finally {
    restore()
    restoreRand()
  }
}

describe('tiktok 游客态（上游没有生成器，catbus 补齐）', () => {
  it('首次访问：首页 hydration 取 wid / odinId / webIdCreatedTime，本地生成 s_v_web_id 与 msToken，之后复用', async () => {
    const { itemGet } = await import('../src/platforms/tiktok/web/commands.js')
    const ctx = makeCtx({ platform: 'tiktok', account: 'guest', args: { item: VIDEO_URL } })
    const home = page({ 'webapp.app-context': { wid: '7690000000000000001', odinId: '7690000000000000002', webIdCreatedTime: '1789999999' } })
    const video = page({ 'webapp.video-detail': { statusCode: 0, itemInfo: { itemStruct: { id: AWEME, desc: 'x', author: { id: '1', uniqueId: 'creator' } } } } })
    const { result, requests } = await withResponses([home, video], () => itemGet(ctx))
    expect(requests.map((r) => r.url)).toEqual(['https://www.tiktok.com/', VIDEO_URL])
    expect(ctx.credential.device).toMatchObject({ device_id: '7690000000000000001', odin_id: '7690000000000000002', web_id_last_time: '1789999999' })
    const jar = Object.fromEntries(ctx.credential.scopes.main!.cookies.map((c) => [c.name, c.value]))
    expect(jar.s_v_web_id).toMatch(/^verify_[0-9a-z]+_[0-9A-Za-z]{8}_[0-9A-Za-z]{4}_4[0-9A-Za-z]{3}_[89ab][0-9A-Za-z]{3}_[0-9A-Za-z]{12}$/)
    expect(jar.msToken).toMatch(/^[A-Za-z0-9_-]{148}$/)
    expect(result).toMatchObject({ id: AWEME, kind: 'video', url: VIDEO_URL, author: { id: '1', url: 'https://www.tiktok.com/@creator' } })

    // 第二次：设备数据已在游客凭证里，不再请求首页
    const again = await withResponses([video], () => itemGet({ ...ctx }))
    expect(again.requests.map((r) => r.url)).toEqual([VIDEO_URL])
  })

  it('签名请求带上补齐的设备参数与四个签名字段', async () => {
    const ctx = makeCtx({ platform: 'tiktok', account: 'guest' })
    ctx.credential.device = { device_id: '7690000000000000001', odin_id: '7690000000000000002', web_id_last_time: '1789999999' }
    const { requests } = await withResponses(['{"status_code":0,"data":[]}'], async () => {
      const t = new TikTok(ctx)
      await t.prepare()
      return api.searchSuggest(t, 'cat')
    })
    const q = new URL(requests[0]!.url).searchParams
    expect(q.get('device_id')).toBe('7690000000000000001')
    expect(q.get('odinId')).toBe('7690000000000000002')
    expect(q.get('WebIdLastTime')).toBe('1789999999')
    expect(q.get('user_is_login')).toBe('false')
    expect(q.get('verifyFp')).toMatch(/^verify_/)
    // search/suggest/guide 本来就不签名
    expect(q.has('X-Gnarly')).toBe(false)
  })
})

describe('tiktok auth', () => {
  it('auth login --cookie <会话 JSON>：cookie 与设备数据分开保存，首页 app-context 取当前用户', async () => {
    const { mkdtempSync, rmSync, readFileSync: read } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const home = mkdtempSync(join(tmpdir(), 'catbus-tt-'))
    const prev = process.env.CATBUS_HOME
    process.env.CATBUS_HOME = home
    try {
      const { authLogin } = await import('../src/platforms/tiktok/web/commands.js')
      const ctx = makeCtx({ platform: 'tiktok', account: null, options: { method: 'cookie', cookie: JSON.stringify(SESSION) } })
      const user = { uid: '7000000000000000001', uniqueId: 'me_handle', nickName: '我', secUid: SEC }
      const { result, requests } = await withResponses([page({ 'webapp.app-context': { user } })], () => authLogin(ctx))
      expect(requests.map((r) => r.url)).toEqual(['https://www.tiktok.com/'])
      expect(result).toMatchObject({ platform: 'tiktok', account: 'default', current: true, user: { id: user.uid, name: '我', url: 'https://www.tiktok.com/@me_handle' }, method: 'cookie' })
      const saved = JSON.parse(read(join(home, 'auth', 'tiktok', 'web', 'default.json'), 'utf8'))
      expect(saved.scopes.main.cookies.map((c: any) => c.name)).toContain('sessionid')
      expect(saved.device.ticket_guard_ts_sign).toBe(SESSION.ticket_guard_ts_sign)
      expect(saved.device.device_id).toBe('7000000000000000001')
    } finally {
      if (prev === undefined) delete process.env.CATBUS_HOME
      else process.env.CATBUS_HOME = prev
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('没有登录 cookie 时拒绝', async () => {
    const { authLogin } = await import('../src/platforms/tiktok/web/commands.js')
    const ctx = makeCtx({ platform: 'tiktok', account: null, options: { method: 'cookie', cookie: 'ttwid=1; msToken=x; s_v_web_id=verify_x' } })
    ctx.credential.device = { device_id: '1', odin_id: '1' }
    await expect(withResponses([page({ 'webapp.app-context': { wid: '1', odinId: '2' } })], () => authLogin(ctx))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})

describe('tiktok 参数归一化与本地媒体处理', () => {
  it('作品、用户、商品参数', async () => {
    const { resolveItem, parseUser, resolveProduct } = await import('../src/platforms/tiktok/web/resolve.js')
    const t = new TikTok(makeCtx({ platform: 'tiktok', account: 'guest' }))
    expect(await resolveItem(t, `${VIDEO_URL}?is_from_webapp=1`)).toEqual({ id: AWEME, handle: 'creator', url: VIDEO_URL })
    expect(await resolveItem(t, 'https://www.tiktok.com/@a.b/photo/7300000000000000124')).toMatchObject({ id: '7300000000000000124', handle: 'a.b' })
    expect((await resolveItem(t, AWEME)).url).toBe(`https://www.tiktok.com/@_/video/${AWEME}`)
    expect(await parseUser(t, '@tiktok')).toEqual({ handle: 'tiktok', secUid: null, id: null })
    expect(await parseUser(t, 'https://www.tiktok.com/@tiktok?lang=en')).toEqual({ handle: 'tiktok', secUid: null, id: null })
    expect(await parseUser(t, SEC)).toEqual({ handle: null, secUid: SEC, id: null })
    expect(await parseUser(t, '107955')).toEqual({ handle: null, secUid: null, id: '107955' })
    expect(resolveProduct(PRODUCT_URL)).toEqual({ id: '1729384756', url: PRODUCT_URL })
    expect(resolveProduct('https://shop.tiktok.com/view/product/1729384756?x=1')).toEqual({ id: '1729384756', url: 'https://shop.tiktok.com/view/product/1729384756' })
    await expect(parseUser(t, 'me')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('MP4 元数据（替代 ffmpeg）与单文件 ZIP', async () => {
    const box = (type: string, ...parts: Buffer[]) => {
      const body = Buffer.concat(parts)
      const h = Buffer.alloc(8)
      h.writeUInt32BE(8 + body.length)
      h.write(type, 4, 'latin1')
      return Buffer.concat([h, body])
    }
    const u32 = (...v: number[]) => Buffer.concat(v.map((x) => Buffer.from([x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255])))
    const tkhd = box('tkhd', Buffer.alloc(76), u32(720 * 65536, 1280 * 65536))
    const mdhd = box('mdhd', Buffer.alloc(4), u32(0, 0, 30000, 450000))
    const hdlr = box('hdlr', Buffer.alloc(8), Buffer.from('vide'), Buffer.alloc(12))
    const stts = box('stts', Buffer.alloc(4), u32(1, 450, 1000))
    const moov = box('moov', box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', box('stbl', stts)))))
    expect(up.mp4Meta(Uint8Array.from(Buffer.concat([box('ftyp', Buffer.from('isom')), moov])))).toEqual({ width: 720, height: 1280, durationMs: 15000, fps: 30 })
    const zip = up.zipOne('0.jpeg', new TextEncoder().encode('hello'))
    expect(Buffer.from(zip.subarray(0, 4)).readUInt32LE(0)).toBe(0x04034b50)
    const { inflateRawSync } = await import('node:zlib')
    const size = Buffer.from(zip).readUInt32LE(18)
    expect(inflateRawSync(zip.subarray(30 + 6, 30 + 6 + size)).toString()).toBe('hello')
  })
})
