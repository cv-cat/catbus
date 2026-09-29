import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readCredential, writeCredential } from '../src/core/auth-store.js'
import { fakeResponse, type HeaderPairs, mockSender, type PreparedRequest } from '../src/core/http.js'
import { jsonDumps } from '../src/core/py.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/xianyu/web/api.js'
import { Xianyu } from '../src/platforms/xianyu/web/client.js'
import { authLogin, itemGet, itemPublish, msgHistory, msgListen, msgSend } from '../src/platforms/xianyu/web/commands.js'
import {
  ackDiffFrame,
  createChatFrame,
  createdCid,
  DEFAULT_ITEM_ID,
  heartbeatFrame,
  type ImSocket,
  listFrame,
  mockConnect,
  regFrame,
  sendMsgFrame,
} from '../src/platforms/xianyu/web/im.js'
import { SESSION_HEADERS } from '../src/platforms/xianyu/web/profile.js'
import { resolveConversation, resolveItem, resolveUser } from '../src/platforms/xianyu/web/resolve.js'
import { decrypt, generateDeviceId, generateMid, generateSign, generateUuid, genTfstk } from '../src/platforms/xianyu/web/sign.js'
import { expectRequests, type GoldenCase, type GoldenRequest, loadCase, makeCtx, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

// 与 scripts/golden/xianyu/gen.py 相同的假凭证
const MY_ID = '2200000001'
const PEER_ID = '2200000999'
const CID = '47000000001'
const ITEM_ID = '900000000001'
const TOKEN = '0123456789abcdef0123456789abcdef'
const COOKIES =
  `cna=fakecna; cookie2=fakecookie2; t=faket; _tb_token_=faketbtoken; unb=${MY_ID}; tracknick=tester; ` +
  `sgcookie=fakesg; _m_h5_tk=${TOKEN}_1790003600000; _m_h5_tk_enc=fakeenc`
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const FILE = { data: new Uint8Array(PNG), filename: '1.png', contentType: 'image/png' }

function ctxOf(init: { cookies?: string; account?: string | null; args?: Record<string, string>; options?: Record<string, unknown> } = {}) {
  return makeCtx({ platform: 'xianyu', account: init.account, cookies: init.cookies ?? COOKIES, cookieDomain: '.goofish.com', args: init.args, options: init.options })
}

const xOf = (cookies?: string) => new Xianyu(ctxOf({ cookies }))

/** 与上游一致，只是 cookie 的先后不比：requests 按域名分组发送（刷新过的 cookie 换到新的域名组），catbus 原位更新。 */
function sortCookies(list: GoldenRequest[]): GoldenRequest[] {
  return list.map((r) => ({ ...r, cookies: [...r.cookies].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) }))
}

function pngFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'catbus-xianyu-'))
  writeFileSync(join(dir, '1.png'), PNG)
  return join(dir, '1.png')
}

// ---------------------------------------------------------------- 假的私信长连

interface Script {
  /** 客户端发出多少帧之后推送。 */
  after: number
  data: string
}

/** 按脚本推送的假连接：第 i 帧等客户端发出 after 帧后才推，推完不断开，直到客户端关闭。 */
function fakeConnect(script: Script[]) {
  const state = { url: '', headers: [] as HeaderPairs, sent: [] as string[], closed: false, connects: 0 }
  let wake: (() => void) | null = null
  const poke = () => {
    const w = wake
    wake = null
    w?.()
  }
  const wait = () => new Promise<void>((r) => (wake = r))
  const socket: ImSocket = {
    async send(data) {
      state.sent.push(data)
      poke()
    },
    close() {
      state.closed = true
      poke()
    },
    messages: {
      async *[Symbol.asyncIterator]() {
        for (const s of script) {
          while (state.sent.length < s.after && !state.closed) await wait()
          if (state.closed) return
          yield s.data
        }
        while (!state.closed) await wait()
      },
    },
  }
  const restore = mockConnect(async (url, headers) => {
    state.connects++
    state.url = url
    state.headers = headers
    return socket
  })
  return { state, restore }
}

/** 断线重连用：每次连接给一个新的假 socket，按 conns 依次推送；drop 的连接推完就断开（服务端关闭），其余等 hangup()。 */
function fakeReconnects(conns: { script: Script[]; drop?: boolean }[]) {
  const sockets: { sent: string[]; closed: boolean }[] = []
  let hung = false
  const wakes = new Set<() => void>()
  const poke = () => {
    for (const w of wakes) w()
    wakes.clear()
  }
  const wait = () => new Promise<void>((r) => wakes.add(r))
  const restore = mockConnect(async () => {
    const conn = conns[sockets.length] ?? { script: [] }
    const state = { sent: [] as string[], closed: false }
    sockets.push(state)
    const socket: ImSocket = {
      async send(data) {
        state.sent.push(data)
        poke()
      },
      close() {
        state.closed = true
        poke()
      },
      messages: {
        async *[Symbol.asyncIterator]() {
          for (const s of conn.script) {
            while (state.sent.length < s.after && !state.closed) await wait()
            if (state.closed) return
            yield s.data
          }
          if (conn.drop) return
          while (!state.closed && !hung) await wait()
        },
      },
    }
    return socket
  })
  /** 服务端断开所有还开着的连接。 */
  const hangup = () => {
    hung = true
    poke()
  }
  return { sockets, hangup, restore }
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 5000 && !cond(); i++) await new Promise((r) => setImmediate(r))
  if (!cond()) throw new Error('等待超时')
}

/** 把几个用例的请求与响应拼起来：catbus 的一条命令对应上游几个方法的组合时用。 */
function combine(...cases: GoldenCase[]): GoldenCase {
  return { ...cases[0]!, requests: cases.flatMap((c) => c.requests), responses: cases.flatMap((c) => c.responses) }
}

/** 用例里上游发出的帧：ws_frames 的 result 就是帧列表，其余在 result.sent。 */
function frames(name: string): string[] {
  const { result } = loadCase('xianyu', name)
  return Array.isArray(result) ? result : result.sent
}

// ================================================================ 纯算

describe('xianyu 对拍：上游 JS', () => {
  it('设备 ID、mid、uuid、mtop 签名、推送解码、tfstk', async () => {
    const c = loadCase('xianyu', 'pure')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect({
        device_id: generateDeviceId(MY_ID),
        mid: generateMid(),
        uuid: generateUuid(),
        sign: generateSign('1790000000000', TOKEN, '{"itemId":"中文"}'),
        decrypt: (c.input.pushes as string[]).map(decrypt),
        tfstk: await genTfstk(),
      }).toEqual(c.result)
    } finally {
      restore()
    }
  })
})

// ================================================================ HTTP

describe('xianyu 对拍：HTTP 请求', () => {
  const cases: Record<string, () => Promise<unknown>> = {
    get_token: () => api.getToken(xOf()),
    refresh_token: () => api.refreshToken(xOf()),
    public_channel: () => api.publicChannel(xOf(), '九成新机械键盘', [{ url: 'https://img.alicdn.com/imgextra/fake.png', width: 100, height: 80 }]),
    default_location: () => api.defaultLocation(xOf()),
    upload_media: () => api.uploadMedia(xOf(), FILE),
    publish: () => api.publish(xOf(), { images: [FILE], desc: '九成新机械键盘', price: { current: 199.9, original: 399 }, shipping: 'fixed', postage: 12.5, pickup: true }),
    publish_free: () => api.publish(xOf(), { images: [], desc: '全新未拆封', price: null, shipping: 'free', postage: 0, pickup: false }),
    publish_distance: () => api.publish(xOf(), { images: [], desc: '按距离', price: { current: 10, original: 0 }, shipping: 'distance', postage: 0, pickup: false }),
    publish_none: () => api.publish(xOf(), { images: [], desc: '无需邮寄', price: { current: 0.1, original: 0 }, shipping: 'none', postage: 0, pickup: false }),
  }
  for (const [name, run] of Object.entries(cases)) {
    it(name, async () => {
      const c = loadCase('xianyu', name)
      const { requests, result, error } = await replay(c, run)
      if (error) throw error
      expectRequests(requests, c.requests)
      expect(result).toEqual(c.result)
    })
  }

  it('get_token：令牌过期时用响应下发的新 _m_h5_tk 重签', async () => {
    const c = loadCase('xianyu', 'get_token_retry')
    const { requests, result, error } = await replay(c, () => api.getToken(xOf()))
    if (error) throw error
    expectRequests(sortCookies(requests), sortCookies(c.requests))
    expect(result).toEqual(c.result)
  })

  it('item_detail：只带 session 的 UA（上游 cookie 构造的 session 里是 requests 默认的 python-requests UA，不照抄）', async () => {
    const c = loadCase('xianyu', 'item_detail')
    const { requests, result, error } = await replay(c, () => api.itemInfo(xOf(), ITEM_ID))
    if (error) throw error
    expect(c.requests[0]!.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
    expectRequests(requests, [{ ...c.requests[0]!, headers: [...SESSION_HEADERS, ...c.requests[0]!.headers] }])
    expect(result).toEqual(c.result)
  })
})

// ================================================================ 私信帧

describe('xianyu 对拍：私信帧', () => {
  it('init：/reg 与 ackDiff', () => {
    const c = loadCase('xianyu', 'ws_init')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect([jsonDumps(regFrame('fake-access-token', generateDeviceId(MY_ID))), jsonDumps(ackDiffFrame())]).toEqual(c.result.sent)
    } finally {
      restore()
    }
  })

  it('create_chat、send_msg（文字 / 图片）、heart_beat', () => {
    const c = loadCase('xianyu', 'ws_frames')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect([
        jsonDumps(createChatFrame(MY_ID, PEER_ID, ITEM_ID)),
        jsonDumps(sendMsgFrame(MY_ID, CID, PEER_ID, { type: 'text', text: '你好 "quote"' })),
        jsonDumps(sendMsgFrame(MY_ID, CID, PEER_ID, { type: 'image', image_url: 'https://img.alicdn.com/imgextra/fake.png', width: 100, height: 80 })),
        jsonDumps(heartbeatFrame()),
      ]).toEqual(c.result)
    } finally {
      restore()
    }
  })

  it('listUserMessages 翻页：游标取上一页的 nextCursor', () => {
    const c = loadCase('xianyu', 'ws_history_pages')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      const lists = (c.result.sent as string[]).filter((f) => f.includes('listUserMessages'))
      expect(lists).toEqual([jsonDumps(listFrame(CID, '9007199254740991')), jsonDumps(listFrame(CID, '1789990000000'))])
    } finally {
      restore()
    }
  })
})

// ================================================================ 命令流程

describe('xianyu 对拍：命令流程', () => {
  it('item publish：传图 → 推荐类目 → 默认地址 → 提交', async () => {
    const c = loadCase('xianyu', 'publish')
    const ctx = ctxOf({ options: { text: '九成新机械键盘', image: [pngFile()], price: 199.9, originalPrice: 399, shipping: 'fixed', postage: 12.5, pickup: true } })
    const { requests, result, error } = await replay(c, () => itemPublish(ctx))
    if (error) throw error
    expectRequests(requests, c.requests)
    const body = JSON.parse(decodeURIComponent(String(requests[3]!.body).slice('data='.length).replaceAll('+', '%20')))
    expect(body.itemPriceDTO).toEqual({ priceInCent: '19990', origPriceInCent: '39900' })
    expect(result).toMatchObject({ id: ITEM_ID, kind: 'goods', url: `https://www.goofish.com/item?id=${ITEM_ID}`, text: '九成新机械键盘', price: { amount: 199.9 }, status: 'on_sale' })
  })

  it('item publish：--original-price 要和 --price 一起用', async () => {
    const { error } = await replay(loadCase('xianyu', 'publish_free'), () => itemPublish(ctxOf({ options: { text: '全新', originalPrice: 10, shipping: 'free' } })))
    expect(error).toMatchObject({ code: 'USAGE' })
  })

  it('msg history：get_token → 握手 → 注册 → 等 /s/vulcan → 取一页', async () => {
    const c = loadCase('xianyu', 'ws_history')
    const { state, restore } = fakeConnect(c.result.server)
    const ctx = ctxOf({ args: { conversation: CID } })
    const { requests, result, error } = await replay(c, () => msgHistory(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(state.url).toBe(c.result.url)
    expect(state.headers).toEqual(c.result.headers)
    expect(state.sent).toEqual(c.result.sent)
    expect(state.closed).toBe(true)

    const { data, page } = result as any
    expect(page).toEqual({ cursor: null, has_more: false })
    // 与上游一样从旧到新（接口从新到旧给，上游每条都插到最前面）
    const upstream = c.result.result
    expect(data.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(data.map((m: any) => m.from.id)).toEqual(upstream.map((u: any) => u.send_user_id))
    expect(data.map((m: any) => m.from.name)).toEqual(upstream.map((u: any) => u.send_user_name))
    expect(data[2]).toMatchObject({
      id: 'm3',
      conversation_id: CID,
      type: 'image',
      text: null,
      media: [{ type: 'image', url: upstream[2].message.image.pics[0].url, width: 100, height: 80 }],
    })
    expect(data[1]).toMatchObject({ id: 'm2', type: 'text', text: upstream[1].message.text.text, media: [] })
    expect(data[0].created_at).toMatch(/^2026-/)
    expect(data[2][RAW]).toEqual(JSON.parse(c.result.server[1].data).body.userMessageModels[0])
  })

  it('msg history --all：同一条连接上按 nextCursor 翻完三页（只取一次 token、只注册一次），从旧到新', async () => {
    const c = loadCase('xianyu', 'ws_history_all')
    const { state, restore } = fakeConnect(c.result.server)
    const { requests, result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { all: true } })))
    restore()
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(state.sent).toEqual(c.result.sent)
    expect(state.closed).toBe(true)
    const { data, page } = result as any
    expect(page).toEqual({ cursor: null, has_more: false })
    expect(data.map((m: any) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm5', 'm6'])
    expect(data.map((m: any) => m.from.id)).toEqual(c.result.result.map((u: any) => u.send_user_id))
    expect(data.map((m: any) => m.text ?? m.media[0].url)).toEqual(c.result.result.map((u: any) => u.message.text?.text ?? u.message.image.pics[0].url))
  })

  it('msg history --limit：翻到够数就停；截在页中间时游标指回这一页的起始游标，带上已输出的条数', async () => {
    const c = loadCase('xianyu', 'ws_history_all')
    // 第一页 2 条、第二页 3 条：--limit 4 翻两页，保留最新的 4 条
    const { state, restore } = fakeConnect(c.result.server.slice(0, 3))
    const { result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { limit: 4 } })))
    restore()
    if (error) throw error
    expect(state.sent).toEqual(c.result.sent.slice(0, 7))
    const { data, page } = result as any
    expect(data.map((m: any) => m.id)).toEqual(['m2', 'm3', 'm5', 'm6'])
    // 第二页的起始游标是第一页的 nextCursor，这一页输出了 2 条
    expect(page).toEqual({ cursor: '1789990002000+2', has_more: true })

    // 正好翻完整页：游标就是接口的 nextCursor
    const again = fakeConnect(c.result.server.slice(0, 2))
    const one = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { limit: 2 } })))
    again.restore()
    if (one.error) throw one.error
    expect((one.result as any).data.map((m: any) => m.id)).toEqual(['m5', 'm6'])
    expect((one.result as any).page).toEqual({ cursor: '1789990002000', has_more: true })
  })

  it('msg history：hasMore 时返回 nextCursor', async () => {
    const c = loadCase('xianyu', 'ws_history_pages')
    const { restore } = fakeConnect(c.result.server.slice(0, 2))
    const { result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID } })))
    restore()
    if (error) throw error
    expect((result as any).page).toEqual({ cursor: '1789990000000', has_more: true })
  })

  it('msg listen：注册、心跳、逐帧 ack；解出别人发来的文字和图片，跳过状态推送和自己发的', async () => {
    const c = loadCase('xianyu', 'ws_listen')
    const upstream: string[] = c.result.sent
    // 上游的 handle_message 收到消息后会回一条 echo（示例代码），catbus 不回
    const isReply = (f: string) => f.includes('/r/MessageSend/sendByReceiverScope')
    const replies = upstream.filter(isReply).map((f) => JSON.parse(f))
    const script = (c.result.server as Script[]).map((s) => ({ after: upstream.slice(0, s.after).filter((f) => !isReply(f)).length, data: s.data }))
    const expected = upstream.filter((f) => !isReply(f))
    const { state, restore } = fakeConnect(script)
    const controller = new AbortController()
    const ctx = { ...ctxOf(), signal: controller.signal }
    const got: any[] = []
    const { requests, error } = await replay(c, async () => {
      const it = msgListen(ctx)[Symbol.asyncIterator]()
      got.push((await it.next()).value, (await it.next()).value)
      await until(() => state.sent.length >= expected.length)
      controller.abort()
      await it.return?.(undefined)
    })
    restore()
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(state.headers).toEqual(c.result.headers)
    expect(state.sent).toEqual(expected)
    expect(state.closed).toBe(true)

    const [text, image] = got
    // 上游 echo：`{send_user_name} 说了: {send_message}`，回给 cid / send_user_id
    const echo = replies[0].body
    const said = JSON.parse(Buffer.from(echo[0].content.custom.data, 'base64').toString()).text.text
    expect(`${text.conversation_id}@goofish`).toBe(echo[0].cid)
    expect(`${text.from.id}@goofish`).toBe(echo[1].actualReceivers[0])
    expect(`${text.from.name} 说了: ${text.text}`).toBe(said)
    expect(text).toMatchObject({ id: '3400000000001.PNM', type: 'text', media: [] })
    expect(text.created_at).toMatch(/^2026-/)
    expect(image).toMatchObject({ id: '3400000000002.PNM', type: 'image', text: null, media: [{ url: 'https://img.alicdn.com/fake.png', width: 100, height: 80 }] })
  })

  it('msg listen：注册被拒（token 无效）时报 AUTH_EXPIRED，不再重连', async () => {
    const c = loadCase('xianyu', 'ws_listen')
    const mid = JSON.parse(c.result.sent[0]).headers.mid
    const { state, restore } = fakeConnect([{ after: 3, data: jsonDumps({ code: 401, headers: { mid }, body: { reason: 'decode token failed' } }) }])
    const { error } = await replay(c, async () => {
      for await (const _ of msgListen(ctxOf())) void _
    })
    restore()
    expect(error).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(state.closed).toBe(true)
  })

  it('msg listen：断线重连后旧连接的心跳停掉，只有新连接每 15 秒发心跳', async () => {
    const c = loadCase('xianyu', 'ws_listen')
    // 第一条连接注册完就断开；重连时再取一次 token
    const { sockets, hangup, restore } = fakeReconnects([{ script: [], drop: true }, { script: [] }])
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const controller = new AbortController()
    const ctx = { ...ctxOf(), signal: controller.signal }
    try {
      const { error } = await replay(combine(c, c), async () => {
        const it = msgListen(ctx)[Symbol.asyncIterator]()
        const next = it.next()
        await until(() => sockets.length === 2 && sockets[1]!.sent.length === 3)
        // 两条连接都发了 /reg、ackDiff、心跳
        for (const s of sockets) expect(s.sent.map((f) => JSON.parse(f).lwp)).toEqual(['/reg', '/r/SyncStatus/ackDiff', '/!'])
        vi.advanceTimersByTime(15_000)
        expect(sockets[0]!.sent).toHaveLength(3)
        expect(sockets[1]!.sent.map((f) => JSON.parse(f).lwp)).toEqual(['/reg', '/r/SyncStatus/ackDiff', '/!', '/!'])
        controller.abort()
        hangup()
        expect(await next).toEqual({ done: true, value: undefined })
        // 结束后不再有心跳
        vi.advanceTimersByTime(60_000)
        expect(sockets[1]!.sent).toHaveLength(4)
      })
      if (error) throw error
    } finally {
      vi.useRealTimers()
      restore()
    }
  })

  it('msg send --item：商品详情取卖家 → get_token → 建会话 → 发文字', async () => {
    const detail = loadCase('xianyu', 'item_detail')
    const token = loadCase('xianyu', 'get_token')
    const init = frames('ws_init')
    const [create, text] = frames('ws_frames')
    const createResp = jsonDumps({ code: 200, headers: { mid: JSON.parse(create!).headers.mid }, body: { singleChatConversation: { cid: `${CID}@goofish` } } })
    const sendResp = jsonDumps({ code: 200, headers: { mid: JSON.parse(text!).headers.mid }, body: { messageId: '3400000000009.PNM', createAt: 1790000000999 } })
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: { sid: 'v' } }) },
      { after: 4, data: createResp },
      { after: 6, data: sendResp },
    ])
    const ctx = ctxOf({ args: { text: '你好 "quote"' }, options: { item: ITEM_ID } })
    const { requests, result, error } = await replay(combine(detail, token), () => msgSend(ctx))
    restore()
    if (error) throw error
    expect(requests.map((r) => r.url)).toEqual([...detail.requests, ...token.requests].map((r) => r.url))
    expectRequests(requests.slice(1), token.requests)
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, create, text])
    expect(result).toMatchObject({ id: '3400000000009.PNM', conversation_id: CID, from: { id: MY_ID, name: 'tester' }, type: 'text', text: '你好 "quote"' })
  })

  it('msg send --to：用上游 create_chat 的默认商品建会话，再发文字（不取商品详情）', async () => {
    const token = loadCase('xianyu', 'get_token')
    const init = frames('ws_init')
    const [create, text] = frames('ws_send_to')
    expect(JSON.parse(create!).body[0].extension.itemId).toBe(DEFAULT_ITEM_ID)
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: { sid: 'v' } }) },
      { after: 4, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(create!).headers.mid }, body: { singleChatConversation: { cid: `${CID}@goofish` } } }) },
      { after: 6, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(text!).headers.mid }, body: {} }) },
    ])
    const ctx = ctxOf({ args: { text: '你好' }, options: { to: `https://www.goofish.com/personal?userId=${PEER_ID}` } })
    const { requests, result, error } = await replay(token, () => msgSend(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, token.requests)
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, create, text])
    expect(result).toMatchObject({ conversation_id: CID, from: { id: MY_ID }, type: 'text', text: '你好' })
  })

  it('msg send --to --item：按指定商品建会话（卖家联系买家）', async () => {
    const token = loadCase('xianyu', 'get_token')
    const init = frames('ws_init')
    const [create, text] = frames('ws_frames')
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: {} }) },
      { after: 4, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(create!).headers.mid }, body: { singleChatConversation: { cid: `${CID}@goofish` } } }) },
      { after: 6, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(text!).headers.mid }, body: { messageId: '3400000000010.PNM' } }) },
    ])
    const ctx = ctxOf({ args: { text: '你好 "quote"' }, options: { to: PEER_ID, item: `https://www.goofish.com/item?id=${ITEM_ID}` } })
    const { requests, result, error } = await replay(token, () => msgSend(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, token.requests)
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, create, text])
    expect(result).toMatchObject({ id: '3400000000010.PNM', conversation_id: CID })
  })

  it('msg send：不能发给自己；自己的商品只给 --item 时提示用 --to', async () => {
    const token = loadCase('xianyu', 'get_token')
    for (const to of ['me', MY_ID]) {
      const { error, requests } = await replay(token, () => msgSend(ctxOf({ args: { text: 'hi' }, options: { to } })))
      expect(error).toMatchObject({ code: 'USAGE', message: '不能给自己发私信' })
      expect(requests).toEqual([])
    }
    const detail = loadCase('xianyu', 'item_detail')
    const mine = { ...detail, responses: [{ ...detail.responses[0]!, body: { ...(detail.responses[0]!.body as any), data: { ...(detail.responses[0]!.body as any).data, sellerDO: { sellerId: Number(MY_ID) } } } }] }
    const { error } = await replay(mine, () => msgSend(ctxOf({ args: { text: 'hi' }, options: { item: ITEM_ID } })))
    expect(error).toMatchObject({ code: 'USAGE', hint: '联系买家用 --to <买家> --item <商品>' })
  })

  it('msg send --conversation：最近一页只有自己的消息时，在同一条连接上往前翻找对方', async () => {
    const token = loadCase('xianyu', 'get_token')
    const history = loadCase('xianyu', 'ws_history_all')
    const lists = (history.result.sent as string[]).filter((f) => f.includes('listUserMessages'))
    const text = frames('ws_send_to')[1]!
    const { state, restore } = fakeConnect([
      ...history.result.server.slice(0, 3),
      { after: 8, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(text).headers.mid }, body: {} }) },
    ])
    const { requests, result, error } = await replay(token, () => msgSend(ctxOf({ args: { text: '你好' }, options: { conversation: CID } })))
    restore()
    if (error) throw error
    expectRequests(requests, token.requests)
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...frames('ws_init'), lists[0], lists[1], text])
    expect(result).toMatchObject({ conversation_id: CID, type: 'text', text: '你好' })
  })

  it('msg send --conversation：整个会话都只有自己的消息时报 USAGE，提示用 --to', async () => {
    const token = loadCase('xianyu', 'get_token')
    const history = loadCase('xianyu', 'ws_history_all')
    const first = JSON.parse(history.result.server[1].data)
    const { state, restore } = fakeConnect([
      history.result.server[0],
      { after: 4, data: jsonDumps({ ...first, body: { ...first.body, hasMore: 0 } }) },
    ])
    const { error } = await replay(token, () => msgSend(ctxOf({ args: { text: '你好' }, options: { conversation: CID } })))
    restore()
    expect(error).toMatchObject({ code: 'USAGE', hint: '用 --to <对方用户>（可加 --item <商品>）发送' })
    expect((error as Error).message).toContain('全部消息记录')
    expect(state.closed).toBe(true)
  })

  it('msg send --conversation --image：先上传，从最近消息里找到对方，再发图片', async () => {
    const upload = loadCase('xianyu', 'upload_media')
    const token = loadCase('xianyu', 'get_token')
    const history = loadCase('xianyu', 'ws_history')
    const init = frames('ws_init')
    const image = frames('ws_frames')[2]!
    const mid = JSON.parse(image).headers.mid
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: {} }) },
      { after: 4, data: history.result.server[1].data },
      { after: 6, data: jsonDumps({ code: 200, headers: { mid }, body: {} }) },
    ])
    const ctx = ctxOf({ options: { conversation: CID, image: [pngFile()] } })
    const { requests, result, error } = await replay(combine(upload, token), () => msgSend(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, [...upload.requests, ...token.requests])
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, frames('ws_history')[3]!, image])
    expect(result).toMatchObject({
      conversation_id: CID,
      type: 'image',
      media: [{ id: '12345678901', type: 'image', url: 'https://img.alicdn.com/imgextra/fake.png', width: 100, height: 80 }],
    })
  })
})

describe('xianyu auth', () => {
  useTempHome()

  it('扫码登录：初始 cookie → mini_login → 生成二维码 → 轮询 → login_token → 刷新 mtop cookie', async () => {
    const c = loadCase('xianyu', 'qrcode_login')
    const ctx = makeCtx({ platform: 'xianyu', account: null, options: { method: 'qrcode' } })
    // 二维码字符画写在 stderr 上
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const { requests, result, error } = await replay(c, () => authLogin(ctx)).finally(() => stderr.mockRestore())
    if (error) throw error
    expectRequests(sortCookies(requests), sortCookies(c.requests))
    expect(result).toMatchObject({ platform: 'xianyu', account: 'default', current: true, method: 'qrcode', user: { id: MY_ID, name: 'tester' } })
    const saved = (await readCredential('xianyu', 'web', 'default'))!
    expect(saved.scopes.main!.cookies.map((x) => [x.name, x.value, x.domain]).sort()).toEqual([...c.result.cookies].sort())
  })

  it('cookie 登录：refresh_token 校验，user 取自 unb / tracknick；之后 auth status、user get me', async () => {
    const c = loadCase('xianyu', 'refresh_token')
    const { requests, result, error } = await replay(c, () => cli('xianyu', 'auth', 'login', '--method', 'cookie', '--cookie', COOKIES))
    if (error) throw error
    expectRequests(requests, c.requests)
    const r = result as Awaited<ReturnType<typeof cli>>
    expect(r.code).toBe(0)
    expect(r.env.data).toMatchObject({ platform: 'xianyu', account: 'default', current: true, user: { id: MY_ID, name: 'tester' }, method: 'cookie' })

    const status = await replay(c, () => cli('xianyu', 'auth', 'status'))
    expect((status.result as any).env.data).toMatchObject({ logged_in: true, user: { id: MY_ID, name: 'tester' }, method: 'cookie' })
    const me = await replay(c, () => cli('xianyu', 'user', 'get', 'me'))
    expect((me.result as any).env.data).toMatchObject({ id: MY_ID, name: 'tester', url: `https://www.goofish.com/personal?userId=${MY_ID}` })
  })

  it('cookie 失效：AUTH_REQUIRED', async () => {
    const c = loadCase('xianyu', 'refresh_token')
    const expired = { ...c, responses: [{ status: 200, headers: {}, body: { api: 'x', data: {}, ret: ['FAIL_SYS_SESSION_EXPIRED::Session过期'], v: '1.0' } }] }
    const { result } = await replay(expired, () => cli('xianyu', 'auth', 'login', '--method', 'cookie', '--cookie', COOKIES))
    expect((result as any).env.error).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect((result as any).code).toBe(3)
  })

  it('游客 auth status：不联网，logged_in 为 false；未登录时 user get 报 AUTH_REQUIRED', async () => {
    const r = await cli('xianyu', 'auth', 'status')
    expect(r.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
    const other = await cli('xianyu', 'user', 'get', PEER_ID)
    expect(other.code).toBe(3)
    expect(other.env.error.code).toBe('AUTH_REQUIRED')
  })

  it('msg history --limit 经 core 分页：handler 只调一次，只取一次 token、只建一条连接', async () => {
    await writeCredential(ctxOf().credential)
    const c = loadCase('xianyu', 'ws_history_all')
    const { state, restore } = fakeConnect(c.result.server.slice(0, 3))
    const { result, error } = await replay(c, () => cli('xianyu', 'msg', 'history', CID, '--limit', '4', '-a', 'default'))
    restore()
    if (error) throw error
    const r = result as Awaited<ReturnType<typeof cli>>
    expect(r.code).toBe(0)
    expect(r.env.data.map((m: any) => m.id)).toEqual(['m2', 'm3', 'm5', 'm6'])
    expect(r.env.page).toEqual({ cursor: '1789990002000+2', has_more: true })
    expect(state.connects).toBe(1)
    expect(state.sent).toEqual(c.result.sent.slice(0, 7))
  })

  it('msg history --cursor <起始游标>+<N>：core 原样交给 handler；重取那一页、跳过已输出的，接着往更早翻', async () => {
    await writeCredential(ctxOf().credential)
    const c = loadCase('xianyu', 'ws_history_all')
    const [vulcan, , second, third] = c.result.server as Script[]
    // 从第二页开始：/s/vulcan 之后回第二页、第三页
    const { state, restore } = fakeConnect([vulcan!, { ...second!, after: 4 }, { ...third!, after: 6 }])
    const { result, error } = await replay(c, () => cli('xianyu', 'msg', 'history', CID, '--limit', '4', '--cursor', '1789990002000+2', '-a', 'default'))
    restore()
    if (error) throw error
    const r = result as Awaited<ReturnType<typeof cli>>
    expect(r.code).toBe(0)
    expect(r.env.data.map((m: any) => m.id)).toEqual(['m0', 'm1'])
    expect(r.env.page).toEqual({ cursor: null, has_more: false })
    expect(state.connects).toBe(1)
    // 与上游翻第二、三页的请求相同
    expect(state.sent).toEqual([...c.result.sent.slice(0, 3), ...c.result.sent.slice(5, 9)])
  })

  it('风控：RGV587 → RISK_CONTROL（captcha），退出码 5', async () => {
    const c = loadCase('xianyu', 'item_detail')
    const blocked = { ...c, responses: [{ status: 200, headers: {}, body: { api: 'mtop.taobao.idle.pc.detail', data: { url: 'https://x' }, ret: ['RGV587_ERROR::SM::哎哟喂,被挤爆啦,请稍后重试!'] } }] }
    const { error } = await replay(blocked, () => itemGet(ctxOf({ args: { item: ITEM_ID } })))
    expect(error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
  })
})

describe('xianyu 参数与解析', () => {
  it('商品：纯数字、商品页链接、分享文本里的链接', async () => {
    const x = xOf()
    expect(await resolveItem(x, ITEM_ID)).toBe(ITEM_ID)
    expect(await resolveItem(x, `https://www.goofish.com/item?spm=a.b&id=${ITEM_ID}&categoryId=1`)).toBe(ITEM_ID)
    expect(await resolveItem(x, `【闲鱼】https://h5.m.goofish.com/item?itemId=${ITEM_ID} 点击链接直接打开`)).toBe(ITEM_ID)
    await expect(resolveItem(x, 'abc')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('用户：纯数字、@goofish、主页链接、分享文本里的主页链接、me', async () => {
    const x = xOf()
    expect(await resolveUser(x, PEER_ID)).toBe(PEER_ID)
    expect(await resolveUser(x, `${PEER_ID}@goofish`)).toBe(PEER_ID)
    expect(await resolveUser(x, `https://www.goofish.com/personal?userId=${PEER_ID}`)).toBe(PEER_ID)
    expect(await resolveUser(x, `快来看看 https://h5.m.goofish.com/app/idleFish-F2e/fish-mini-home/pages/personal?userid=${PEER_ID}&spm=a 的主页`)).toBe(PEER_ID)
    expect(await resolveUser(x, 'me')).toBe(MY_ID)
    await expect(resolveUser(x, 'abc')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('用户：分享短链跟一次跳转取 userId；跳转地址里没有时打开落地页找；都没有时报 USAGE', async () => {
    const x = xOf()
    const sent: PreparedRequest[] = []
    const restore = mockSender((p) => {
      sent.push(p)
      if (p.url === 'https://m.tb.cn/h.a') return fakeResponse('', { status: 302, headers: [['location', `https://www.goofish.com/personal?userId=${PEER_ID}&spm=x`]] })
      if (p.url === 'https://m.tb.cn/h.b') return fakeResponse('', { status: 302, headers: [['location', 'https://h5.m.goofish.com/landing?code=b']] })
      if (p.url === 'https://h5.m.goofish.com/landing?code=b') return fakeResponse(`<script>location.href = "https://www.goofish.com/personal?from=share&amp;userId=${PEER_ID}"</script>`)
      if (p.url === 'https://m.tb.cn/h.c') return fakeResponse('<html>页面不存在</html>')
      throw new Error(`多发了请求：${p.url}`)
    })
    try {
      expect(await resolveUser(x, 'https://m.tb.cn/h.a')).toBe(PEER_ID)
      expect(await resolveUser(x, '【闲鱼】https://m.tb.cn/h.b 点击链接直接打开')).toBe(PEER_ID)
      await expect(resolveUser(x, 'https://m.tb.cn/h.c')).rejects.toMatchObject({ code: 'USAGE' })
    } finally {
      restore()
    }
    expect(sent.map((p) => p.url)).toEqual(['https://m.tb.cn/h.a', 'https://m.tb.cn/h.b', 'https://h5.m.goofish.com/landing?code=b', 'https://m.tb.cn/h.c'])
    // 跟跳转不带账号的 cookie
    for (const p of sent) {
      expect(p.cookies).toEqual([])
      expect(p.headers).toEqual([['user-agent', 'Mozilla/5.0']])
    }
  })

  it('会话 ID：带不带 @goofish 都行', () => {
    expect(resolveConversation(CID)).toBe(CID)
    expect(resolveConversation(`${CID}@goofish`)).toBe(CID)
    expect(() => resolveConversation('a-b')).toThrow(/会话/)
  })

  it('建会话的响应里取会话 ID', () => {
    expect(createdCid({ body: { singleChatConversation: { cid: `${CID}@goofish` } } })).toBe(CID)
    expect(createdCid({ body: {} })).toBeNull()
  })
})
