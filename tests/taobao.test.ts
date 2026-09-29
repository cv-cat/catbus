import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { writeCredential } from '../src/core/auth-store.js'
import type { HeaderPairs } from '../src/core/http.js'
import { jsonDumps } from '../src/core/py.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/taobao/web/api.js'
import { decodeNick, Taobao } from '../src/platforms/taobao/web/client.js'
import { msgHistory, msgListen, msgSend, userGet } from '../src/platforms/taobao/web/commands.js'
import {
  ackDiffFrame,
  createChatFrame,
  createdCid,
  heartbeatFrame,
  type ImSocket,
  listFrame,
  mockConnect,
  regFrame,
  sendMsgFrame,
} from '../src/platforms/taobao/web/im.js'
import { resolveConversation, resolveItem } from '../src/platforms/taobao/web/resolve.js'
import { decrypt, generateDeviceId, generateMid, generateSign, generateUuid } from '../src/platforms/taobao/web/sign.js'
import { expectRequests, type GoldenCase, loadCase, makeCtx, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

// 与 scripts/golden/taobao/gen.py 相同的假凭证
const MY_ID = '2200000001'
const PEER_ID = '2200000999'
const CID = `${MY_ID}.1-${PEER_ID}.1#11001`
const COOKIES =
  `cna=fakecna; cookie2=fakecookie2; t=faket; _tb_token_=faketbtoken; unb=${MY_ID}; _nk_=tester; ` +
  'sgcookie=fakesg; _m_h5_tk=0123456789abcdef0123456789abcdef_1790003600000; _m_h5_tk_enc=fakeenc'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const IMAGE = { type: 'image', file_id: 12345678901, image_url: 'https://img.alicdn.com/imgextra/fake.png', size: 68, width: 100, height: 80 } as const

function ctxOf(init: { cookies?: string; args?: Record<string, string>; options?: Record<string, unknown> } = {}) {
  return makeCtx({ platform: 'taobao', cookies: init.cookies ?? COOKIES, cookieDomain: '.taobao.com', args: init.args, options: init.options })
}

const tbOf = (cookies?: string) => new Taobao(ctxOf({ cookies }))

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
  const { result } = loadCase('taobao', name)
  return Array.isArray(result) ? result : result.sent
}

// ================================================================ 纯算

describe('taobao 对拍：上游 JS', () => {
  it('设备号、mid、uuid、mtop 签名、推送解码', () => {
    const c = loadCase('taobao', 'pure')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect({
        device_id: generateDeviceId(MY_ID),
        mid: generateMid(),
        uuid: generateUuid(),
        sign: generateSign(1790000000000, '0123456789abcdef0123456789abcdef', '{"a":"中文"}'),
        decrypt: decrypt('gQGRhAHaACgzODg4Nzc3MTA4LjEtMjU5MTU2MDE5Mi4xIzExMDAxQGNudGFvYmFvAgADAQSzMzg4ODc3NzEwOEBjbnRhb2Jhbw=='),
      }).toEqual(c.result)
    } finally {
      restore()
    }
  })

  it('推送解码：MessagePack 里的 64 位整数写成字符串', () => {
    const c = loadCase('taobao', 'ws_listen')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      c.input.pushes.forEach((p: string, i: number) => expect(JSON.parse(decrypt(p))).toEqual(c.result.result.decoded[i]))
    } finally {
      restore()
    }
  })
})

// ================================================================ HTTP

describe('taobao 对拍：HTTP 请求', () => {
  it('get_token', async () => {
    const c = loadCase('taobao', 'get_token')
    const { requests, result, error } = await replay(c, () => api.getToken(tbOf()))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual(c.result)
  })

  it('get_token：令牌过期时用响应下发的新 _m_h5_tk 重试', async () => {
    const c = loadCase('taobao', 'get_token_retry')
    const tb = tbOf('_m_h5_tk=0123456789abcdef0123456789abcdef_1; _m_h5_tk_enc=oldenc')
    const { requests, result, error } = await replay(c, () => api.getToken(tb))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual(c.result)
  })

  it('get_goods_uid_encrypt_uid', async () => {
    const c = loadCase('taobao', 'goods_uid')
    const tb = tbOf()
    const { requests, result, error } = await replay(c, async () => api.parseSeller(tb, await api.goodsPage(tb, c.input.url)))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual(c.result)
  })

  it('upload_media', async () => {
    const c = loadCase('taobao', 'upload_media')
    const { requests, result, error } = await replay(c, () => api.uploadMedia(tbOf(), { data: new Uint8Array(PNG), filename: '1.png' }))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toEqual(c.result)
  })
})

// ================================================================ 私信帧

describe('taobao 对拍：私信帧', () => {
  it('init：/reg 与 ackDiff', async () => {
    const c = loadCase('taobao', 'ws_init')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect([jsonDumps(regFrame('fake-access-token', generateDeviceId(MY_ID))), jsonDumps(ackDiffFrame())]).toEqual(c.result.sent)
    } finally {
      restore()
    }
  })

  it('create_chat、send_msg（文字 / 图片）、heart_beat', () => {
    const c = loadCase('taobao', 'ws_frames')
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      expect([
        jsonDumps(createChatFrame(MY_ID, 'FAKEENCRYPTUID0001')),
        jsonDumps(sendMsgFrame(MY_ID, `${CID}@cntaobao`, PEER_ID, 'cntaobaotester', { type: 'text', text: '你好 "quote"' })),
        jsonDumps(sendMsgFrame(MY_ID, `${CID}@cntaobao`, PEER_ID, 'cntaobaotester', IMAGE)),
        jsonDumps(heartbeatFrame()),
      ]).toEqual(c.result)
    } finally {
      restore()
    }
  })

  it('listUserMessages 翻页：游标取上一页的 nextCursor', () => {
    const c = loadCase('taobao', 'ws_history_pages')
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

describe('taobao 对拍：命令流程', () => {
  it('msg history：get_token → 握手 → 注册 → 等 /s/vulcan → 取一页', async () => {
    const c = loadCase('taobao', 'ws_history')
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
    expect(data.map((m: any) => m.id)).toEqual(['m1', 'm2'])
    expect(data.map((m: any) => `${m.from.id}@cntaobao`)).toEqual(upstream.map((u: any) => u.send_user_id))
    expect(data.map((m: any) => `cntaobao${m.from.name}`)).toEqual(upstream.map((u: any) => u.send_user_name))
    expect(data[1]).toMatchObject({ id: 'm2', conversation_id: CID, type: 'text', text: upstream[1].message.text.content, media: [] })
    const image = JSON.parse(Buffer.from(upstream[0].message.base64, 'base64').toString())
    expect(data[0]).toMatchObject({ id: 'm1', type: 'image', text: null, media: [{ id: '1', type: 'image', url: image.url, width: image.width, height: image.height }] })
    expect(data[0].created_at).toMatch(/^2026-/)
    expect(data[1][RAW]).toEqual(JSON.parse(c.result.server[1].data).body.userMessageModels[0])
  })

  it('msg history --all：同一条连接上按 nextCursor 翻完三页（只取一次 token、只注册一次），从旧到新', async () => {
    const c = loadCase('taobao', 'ws_history_all')
    const { state, restore } = fakeConnect(c.result.server)
    const { requests, result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { all: true } })))
    restore()
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(state.connects).toBe(1)
    expect(state.sent).toEqual(c.result.sent)
    expect(state.closed).toBe(true)
    const { data, page } = result as any
    expect(page).toEqual({ cursor: null, has_more: false })
    expect(data.map((m: any) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
    expect(data.map((m: any) => `${m.from.id}@cntaobao`)).toEqual(c.result.result.map((u: any) => u.send_user_id))
    expect(data.map((m: any) => `cntaobao${m.from.name}`)).toEqual(c.result.result.map((u: any) => u.send_user_name))
  })

  it('msg history --limit：翻到够数就停；截在页中间时游标指回这一页的起始游标，带上已输出的条数', async () => {
    const c = loadCase('taobao', 'ws_history_all')
    // 第一页 2 条、第二页 2 条：--limit 3 翻两页，保留最新的 3 条
    const { state, restore } = fakeConnect(c.result.server.slice(0, 3))
    const { result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { limit: 3 } })))
    restore()
    if (error) throw error
    expect(state.sent).toEqual(c.result.sent.slice(0, 7))
    expect((result as any).data.map((m: any) => m.id)).toEqual(['m2', 'm3', 'm4'])
    expect((result as any).page).toEqual({ cursor: '1789990002000+1', has_more: true })

    // 正好翻完整页：游标就是接口的 nextCursor
    const again = fakeConnect(c.result.server.slice(0, 2))
    const one = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID }, options: { limit: 2 } })))
    again.restore()
    if (one.error) throw one.error
    expect((one.result as any).data.map((m: any) => m.id)).toEqual(['m3', 'm4'])
    expect((one.result as any).page).toEqual({ cursor: '1789990002000', has_more: true })
  })

  it('msg history：--cursor 不是数字时报 USAGE，不建连接', async () => {
    const c = loadCase('taobao', 'ws_history')
    const { state, restore } = fakeConnect([])
    const { error, requests } = await replay(c, () => msgHistory({ ...ctxOf({ args: { conversation: CID } }), cursor: 'abc' }))
    restore()
    expect(error).toMatchObject({ code: 'USAGE' })
    expect(requests).toEqual([])
    expect(state.connects).toBe(0)
  })

  it('msg history：hasMore 时返回 nextCursor', async () => {
    const c = loadCase('taobao', 'ws_history_pages')
    const { restore } = fakeConnect(c.result.server.slice(0, 2))
    const { result, error } = await replay(c, () => msgHistory(ctxOf({ args: { conversation: CID } })))
    restore()
    if (error) throw error
    expect((result as any).page).toEqual({ cursor: '1789990000000', has_more: true })
  })

  it('msg listen：注册、心跳、逐帧 ack；解出别人发来的文字消息，跳过状态推送和自己发的', async () => {
    const c = loadCase('taobao', 'ws_listen')
    const upstream: string[] = c.result.sent
    // 上游的 handle_message 收到消息后会回一条 echo（示例代码），catbus 不回
    const isReply = (f: string) => f.includes('/r/MessageSend/sendByReceiverScope')
    const reply = JSON.parse(upstream.find(isReply)!)
    const script = (c.result.server as Script[]).map((s) => ({ after: upstream.slice(0, s.after).filter((f) => !isReply(f)).length, data: s.data }))
    const expected = upstream.filter((f) => !isReply(f))
    const { state, restore } = fakeConnect(script)
    const controller = new AbortController()
    const ctx = { ...ctxOf(), signal: controller.signal }
    const got: any[] = []
    const { requests, error } = await replay(c, async () => {
      const it = msgListen(ctx)[Symbol.asyncIterator]()
      got.push((await it.next()).value)
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

    const [m] = got
    const body = reply.body[0]
    expect(`${m.conversation_id}@cntaobao`).toBe(body.cid)
    expect(`${m.from.id}@cntaobao`).toBe(reply.body[1].actualReceivers[1])
    expect(`cntaobao${m.from.name} 说了: ${m.text}`).toBe(body.content.text.content)
    expect(m).toMatchObject({ id: '3400000000001.PNM', type: 'text', media: [] })
    expect(m.created_at).toMatch(/^2026-/)
  })

  it('msg listen：注册被拒（token 无效）时报 AUTH_EXPIRED，不再重连', async () => {
    const c = loadCase('taobao', 'ws_listen')
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
    const c = loadCase('taobao', 'ws_listen')
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

  it('msg send --item：商品页取卖家 → get_token → 建会话 → 发文字', async () => {
    const goods = loadCase('taobao', 'goods_uid')
    const token = loadCase('taobao', 'get_token')
    const init = frames('ws_init')
    const [create, text] = frames('ws_frames')
    const createResp = jsonDumps({ code: 200, headers: { mid: JSON.parse(create!).headers.mid }, body: { singleChatConversation: { cid: `${CID}@cntaobao` } } })
    const sendResp = jsonDumps({ code: 200, headers: { mid: JSON.parse(text!).headers.mid }, body: { messageId: '3400000000009.PNM', createAt: 1790000000999 } })
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: { sid: 'v' } }) },
      { after: 4, data: createResp },
      { after: 6, data: sendResp },
    ])
    const ctx = ctxOf({ args: { text: '你好 "quote"' }, options: { item: goods.input.url } })
    const { requests, result, error } = await replay(combine(goods, token), () => msgSend(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, [...goods.requests, ...token.requests])
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, create, text])
    expect(result).toMatchObject({ id: '3400000000009.PNM', conversation_id: CID, from: { id: MY_ID, name: 'tester' }, type: 'text', text: '你好 "quote"' })
  })

  it('msg send --conversation --image：先上传，再发图片', async () => {
    const upload = loadCase('taobao', 'upload_media')
    const token = loadCase('taobao', 'get_token')
    const init = frames('ws_init')
    const image = frames('ws_frames')[2]!
    const dir = mkdtempSync(join(tmpdir(), 'catbus-taobao-'))
    writeFileSync(join(dir, '1.png'), PNG)
    const { state, restore } = fakeConnect([
      { after: 2, data: jsonDumps({ lwp: '/s/vulcan', headers: {} }) },
      { after: 4, data: jsonDumps({ code: 200, headers: { mid: JSON.parse(image).headers.mid }, body: {} }) },
    ])
    const ctx = ctxOf({ options: { conversation: CID, image: [join(dir, '1.png')] } })
    const { requests, result, error } = await replay(combine(upload, token), () => msgSend(ctx))
    restore()
    if (error) throw error
    expectRequests(requests, [...upload.requests, ...token.requests])
    expect(state.sent.filter((f) => !f.startsWith('{"code"'))).toEqual([...init, image])
    expect(result).toMatchObject({
      conversation_id: CID,
      type: 'image',
      media: [{ id: '12345678901', type: 'image', url: IMAGE.image_url, width: 100, height: 80 }],
    })
  })

  it('user get：商品页里的卖家', async () => {
    const c = loadCase('taobao', 'goods_uid')
    const { requests, result, error } = await replay(c, () => userGet(ctxOf({ args: { user: c.input.url } })))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect(result).toMatchObject({ id: PEER_ID, name: '测试店铺', handle: '测试卖家', url: 'https://shop1.taobao.com' })
    expect((result as any)[RAW]).toMatchObject(c.result)
  })

  it('user get：游客打开商品页遇到登录墙 → AUTH_REQUIRED', async () => {
    const c = loadCase('taobao', 'goods_uid')
    const wall = { ...c, responses: [{ status: 200, headers: {}, body: '<script>var jump = "https://item.taobao.com/_____tmd_____/page/login_jump?rand=x"</script>' }] }
    const ctx = makeCtx({ platform: 'taobao', account: 'guest', args: { user: c.input.url } })
    const { error } = await replay(wall, () => userGet(ctx))
    expect(error).toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})

describe('taobao auth（CLI）', () => {
  useTempHome()

  it('cookie 登录：换一次私信 token 校验，user 取自 unb / _nk_', async () => {
    const c = loadCase('taobao', 'get_token')
    const { requests, result, error } = await replay(c, () => cli('taobao', 'auth', 'login', '--cookie', COOKIES))
    if (error) throw error
    expectRequests(requests, c.requests)
    const r = result as Awaited<ReturnType<typeof cli>>
    expect(r.code).toBe(0)
    expect(r.env.data).toMatchObject({ platform: 'taobao', account: 'default', current: true, user: { id: MY_ID, name: 'tester', url: null }, method: 'cookie' })

    const status = await replay(c, () => cli('taobao', 'auth', 'status'))
    expect((status.result as any).env.data).toMatchObject({ logged_in: true, user: { id: MY_ID, name: 'tester' }, method: 'cookie' })
  })

  it('cookie 失效：AUTH_REQUIRED', async () => {
    const c = loadCase('taobao', 'get_token')
    const expired = { ...c, responses: [{ status: 200, headers: {}, body: ' mtopjsonp3({"api":"mtop.taobao.login.token.get.h5","data":{},"ret":["FAIL_SYS_SESSION_EXPIRED::Session过期"],"v":"2.0"})' }] }
    const { result } = await replay(expired, () => cli('taobao', 'auth', 'login', '--cookie', COOKIES))
    expect((result as any).env.error).toMatchObject({ code: 'AUTH_REQUIRED' })
    expect((result as any).code).toBe(3)
  })

  it('游客 auth status：不联网，logged_in 为 false', async () => {
    const r = await cli('taobao', 'auth', 'status')
    expect(r.env.data).toEqual({ logged_in: false, user: null, method: null, expires_at: null })
  })

  it('msg history --limit 经 core 分页：handler 只调一次，只取一次 token、只建一条连接', async () => {
    await writeCredential(ctxOf().credential)
    const c = loadCase('taobao', 'ws_history_all')
    const { state, restore } = fakeConnect(c.result.server.slice(0, 3))
    const { result, error } = await replay(c, () => cli('taobao', 'msg', 'history', CID, '--limit', '3', '-a', 'default'))
    restore()
    if (error) throw error
    const r = result as Awaited<ReturnType<typeof cli>>
    expect(r.code).toBe(0)
    expect(r.env.data.map((m: any) => m.id)).toEqual(['m2', 'm3', 'm4'])
    expect(r.env.page).toEqual({ cursor: '1789990002000+1', has_more: true })
    expect(state.connects).toBe(1)
    expect(state.sent).toEqual(c.result.sent.slice(0, 7))
  })

  it('msg history --cursor <起始游标>+<N>：core 原样交给 handler；重取那一页、跳过已输出的，接着往更早翻', async () => {
    await writeCredential(ctxOf().credential)
    const c = loadCase('taobao', 'ws_history_all')
    const [vulcan, , second, third] = c.result.server as Script[]
    // 从第二页开始：/s/vulcan 之后回第二页、第三页
    const { state, restore } = fakeConnect([vulcan!, { ...second!, after: 4 }, { ...third!, after: 6 }])
    const { result, error } = await replay(c, () => cli('taobao', 'msg', 'history', CID, '--limit', '3', '--cursor', '1789990002000+1', '-a', 'default'))
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

  it('user get me：规划中', async () => {
    const c = loadCase('taobao', 'get_token')
    await replay(c, () => cli('taobao', 'auth', 'login', '--cookie', COOKIES))
    const r = await cli('taobao', 'user', 'get', 'me')
    expect(r.code).toBe(4)
    expect(r.env.error.code).toBe('NOT_IMPLEMENTED')
  })
})

describe('taobao 参数与解析', () => {
  it('会话 ID：带不带 @cntaobao 都行，对方是另一个 uid', () => {
    expect(resolveConversation(CID, MY_ID)).toEqual({ cid: CID, peer: PEER_ID })
    expect(resolveConversation(`${PEER_ID}.1-${MY_ID}.1#11001@cntaobao`, MY_ID)).toEqual({ cid: `${PEER_ID}.1-${MY_ID}.1#11001`, peer: PEER_ID })
    expect(() => resolveConversation('123', MY_ID)).toThrow(/会话/)
    expect(() => resolveConversation(`1.1-2.1#11001`, MY_ID)).toThrow(/不属于/)
  })

  it('商品：纯数字 ID 拼成商品页，淘宝 / 天猫链接原样使用', async () => {
    const tb = tbOf()
    expect(await resolveItem(tb, '806319949537')).toBe('https://item.taobao.com/item.htm?id=806319949537')
    expect(await resolveItem(tb, 'https://detail.tmall.com/item.htm?id=1')).toBe('https://detail.tmall.com/item.htm?id=1')
    await expect(resolveItem(tb, 'https://example.com/?id=1')).rejects.toMatchObject({ code: 'USAGE' })
  })

  it('建会话的响应里取会话 ID', () => {
    expect(createdCid({ body: { singleChatConversation: { cid: `${CID}@cntaobao` } } })).toBe(CID)
    expect(createdCid({ body: { conversation: { id: `${CID}@cntaobao` } } })).toBe(CID)
    expect(createdCid({ body: {} })).toBeNull()
  })

  it('昵称：_nk_ 是 URL 编码的 \\u 转义', () => {
    expect(decodeNick('tb%5Cu6d4b%5Cu8bd5')).toBe('tb测试')
    expect(decodeNick('tester')).toBe('tester')
  })
})
