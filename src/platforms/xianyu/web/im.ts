import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs } from '../../../core/http.js'
import { jsonDumps } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { openSocket } from '../../../core/stream.js'
import { authError } from '../../../core/toolkit.js'
import { getToken } from './api.js'
import type { Xianyu } from './client.js'
import { IM_APP_KEY, IM_DOMAIN, IM_UA, WSS_URL, wsHeaders } from './profile.js'
import { generateMid, generateUuid } from './sign.js'

/**
 * 私信：钉钉 IMPaaS 的 wss 长连（上游 goofish_live.py 的 XianyuLive）。
 *
 * 帧是 JSON，用 Python `json.dumps` 的默认格式序列化（上游如此，对拍逐字节比较）。
 * 请求帧带 `headers.mid`，响应回同一个 mid；服务端推送的每一帧都要回 ack。
 */

export type Frame = Record<string, any>

/** listUserMessages 的起始游标（JS 的 Number.MAX_SAFE_INTEGER）。 */
export const FIRST_CURSOR = '9007199254740991'
/** 心跳间隔（上游 heart_beat 为 15 秒）。 */
const HEARTBEAT_MS = 15_000
/** 注册后等服务端的 /s/vulcan 推送，超时后照样继续。 */
const READY_MS = 10_000

export const imId = (id: string) => `${id}@${IM_DOMAIN}`
/** 去掉 `@goofish` 后缀。 */
export const plainId = (id: unknown) => String(id ?? '').replace(new RegExp(`@${IM_DOMAIN}$`), '')

// ================================================================ 帧（一个函数对应上游的一处构造）

/** init 的第一帧：/reg。 */
export function regFrame(token: string, deviceId: string): Frame {
  return {
    lwp: '/reg',
    headers: {
      'cache-header': 'app-key token ua wv',
      'app-key': IM_APP_KEY,
      token,
      ua: IM_UA,
      dt: 'j',
      wv: 'im:3,au:3,sy:6',
      sync: '0,0;0;0;',
      did: deviceId,
      mid: generateMid(),
    },
  }
}

/** init 的第二帧：同步位点。 */
export function ackDiffFrame(): Frame {
  const now = rand.now()
  return {
    lwp: '/r/SyncStatus/ackDiff',
    headers: { mid: generateMid() },
    body: [{ pipeline: 'sync', tooLong2Tag: 'PNM,1', channel: 'sync', topic: 'sync', highPts: 0, pts: now * 1000, seq: 0, timestamp: now }],
  }
}

/** heart_beat。 */
export function heartbeatFrame(): Frame {
  return { lwp: '/!', headers: { mid: generateMid() } }
}

/** 收到任何带 headers 的帧都回的 ack（上游 main / list_all_conversations 的循环体）。 */
export function ackFrame(h: Record<string, unknown>): Frame {
  const ack: Frame = { code: 200, headers: { mid: 'mid' in h ? h.mid : generateMid(), sid: 'sid' in h ? h.sid : '' } }
  for (const key of ['app-key', 'ua', 'dt']) if (key in h) ack.headers[key] = h[key]
  return ack
}

/** list_all_conversations 的请求：一页 20 条，游标从大往小翻。 */
export function listFrame(cid: string, cursor: string): Frame {
  return { lwp: '/r/MessageManager/listUserMessages', headers: { mid: generateMid() }, body: [imId(cid), false, BigInt(cursor), 20, false] }
}

/** create_chat 的 item_id 默认值（上游写死）：只给对方用户、不指定商品时用它建会话。 */
export const DEFAULT_ITEM_ID = '891198795482'

/** create_chat：按商品和对方建单聊会话（已有时返回原会话）。 */
export function createChatFrame(myId: string, toId: string, itemId = DEFAULT_ITEM_ID): Frame {
  return {
    lwp: '/r/SingleChatConversation/create',
    headers: { mid: generateMid() },
    body: [
      {
        pairFirst: imId(toId),
        pairSecond: imId(myId),
        bizType: '1',
        extension: { itemId },
        ctx: { appVersion: '1.0', platform: 'web' },
      },
    ],
  }
}

export type OutgoingMessage = { type: 'text'; text: string } | { type: 'image'; image_url: string; width: number; height: number }

/** send_msg：内容是 base64 的 JSON，放在 custom 里（文字 type 1，图片 type 2）。 */
export function sendMsgFrame(myId: string, cid: string, toId: string, message: OutgoingMessage): Frame {
  const payload =
    message.type === 'text'
      ? { contentType: 1, text: { text: message.text } }
      : { contentType: 2, image: { pics: [{ type: 0, url: message.image_url, width: message.width, height: message.height }] } }
  return {
    lwp: '/r/MessageSend/sendByReceiverScope',
    headers: { mid: generateMid() },
    body: [
      {
        uuid: generateUuid(),
        cid: imId(cid),
        conversationType: 1,
        content: { contentType: 101, custom: { type: payload.contentType, data: Buffer.from(jsonDumps(payload)).toString('base64') } },
        redPointPolicy: 0,
        extension: { extJson: '{}' },
        ctx: { appVersion: '1.0', platform: 'web' },
        mtags: {},
        msgReadStatusSetting: 1,
      },
      { actualReceivers: [imId(toId), imId(myId)] },
    ],
  }
}

// ================================================================ 连接

export interface ImSocket {
  send(data: string): Promise<void>
  close(): void
  messages: AsyncIterable<string | Uint8Array>
}

export type Connect = (url: string, headers: HeaderPairs, ctx: HandlerContext) => Promise<ImSocket>

const realConnect: Connect = (url, headers, ctx) =>
  openSocket(url, {
    // Host、Connection 由 WebSocket 库自己生成
    headers: headers.filter(([k]) => !/^(host|connection)$/i.test(k)),
    ...(ctx.config.proxy ? { proxy: ctx.config.proxy } : {}),
    signal: ctx.signal,
  })

let connector: Connect = realConnect

/** 替换建立长连的函数，返回恢复函数。只给测试用。 */
export function mockConnect(fn: Connect): () => void {
  const prev = connector
  connector = fn
  return () => {
    connector = prev
  }
}

/** 私信的 accessToken（上游 init 里取不到就退出）。 */
export async function accessToken(x: Xianyu): Promise<string> {
  const res = await getToken(x)
  const token = res.data?.accessToken
  if (!token) throw new CatbusError('UPSTREAM', '获取私信 token 失败', { detail: { ret: res.ret ?? null } })
  return token
}

interface Waiter {
  resolve(frame: Frame): void
  reject(err: unknown): void
}

/** 一条私信长连：注册、ack、按 mid 配对请求与响应、收集推送。 */
export class Im {
  private socket!: ImSocket
  private readonly pending = new Map<string, Waiter>()
  private readonly pushes: Frame[] = []
  private wake: (() => void) | null = null
  private failure: unknown = null
  private closed = false
  private regMid = ''
  private heartbeat: NodeJS.Timeout | null = null
  private readyResolve!: () => void
  private readyReject!: (err: unknown) => void
  private readonly readyPromise = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })

  private constructor(readonly x: Xianyu) {
    this.readyPromise.catch(() => {})
  }

  /**
   * 连接并注册（上游 init：先 get_token，再发 /reg 与 ackDiff）。listen 时再发一次心跳，之后每 15 秒一次。
   * 上游先连接再取 token；这里先取 token，登录态无效时不必建连接。
   */
  static async open(x: Xianyu, options: { heartbeat?: boolean } = {}): Promise<Im> {
    const token = await accessToken(x)
    const im = new Im(x)
    im.socket = await connector(WSS_URL, wsHeaders(x.cookieString()), x.ctx)
    try {
      const reg = regFrame(token, x.deviceId)
      im.regMid = reg.headers.mid
      await im.send(reg)
      await im.send(ackDiffFrame())
      if (options.heartbeat) {
        await im.send(heartbeatFrame())
        im.heartbeat = setInterval(() => void im.send(heartbeatFrame()).catch(() => {}), HEARTBEAT_MS)
        im.heartbeat.unref()
      }
    } catch (err) {
      im.close()
      throw err
    }
    void im.read()
    return im
  }

  send(frame: Frame): Promise<void> {
    return this.socket.send(jsonDumps(frame))
  }

  /** 等服务端的 /s/vulcan（上游 list_all_conversations 收到它才发请求）；注册失败时报错。 */
  async ready(): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, READY_MS)))
    try {
      await Promise.race([this.readyPromise, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /** 发请求帧，等同一 mid 的响应；code 不是 200 时报错。 */
  async request(frame: Frame): Promise<Frame> {
    if (this.failure) throw this.failure
    const mid = String(frame.headers.mid)
    const response = new Promise<Frame>((resolve, reject) => this.pending.set(mid, { resolve, reject }))
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(mid)
        reject(new CatbusError('NETWORK', `私信请求超时：${frame.lwp}`, { detail: { kind: 'timeout' } }))
      }, this.x.ctx.config.timeout * 1000)
    })
    try {
      await this.send(frame)
      const res = await Promise.race([response, timeout])
      if (res.code !== 200) throw this.responseError(frame.lwp, res)
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  /** 服务端推送（带 syncPushPackage 的帧），直到连接关闭；连接出错时抛出。 */
  async *pushFrames(): AsyncIterable<Frame> {
    for (;;) {
      while (this.pushes.length) yield this.pushes.shift()!
      if (this.failure) throw this.failure
      if (this.closed) return
      await new Promise<void>((r) => (this.wake = r))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket?.close()
    this.finish(null)
  }

  private async read(): Promise<void> {
    try {
      for await (const raw of this.socket.messages) {
        let msg: Frame
        try {
          msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
        } catch {
          continue
        }
        const h = msg?.headers
        if (h && typeof h === 'object') await this.send(ackFrame(h)).catch(() => {})
        this.dispatch(msg)
      }
      this.finish(this.closed ? null : new CatbusError('NETWORK', '私信长连接已断开', { detail: { kind: 'connect' } }))
    } catch (err) {
      this.finish(this.closed ? null : err)
    }
  }

  private dispatch(msg: Frame): void {
    if (msg.lwp === '/s/vulcan') this.readyResolve()
    const mid = msg.headers?.mid
    if (mid != null && 'code' in msg) {
      if (mid === this.regMid && msg.code !== 200) {
        // 注册失败（token 无效等）：等待中的请求和推送都以它结束
        const err = this.responseError('/reg', msg)
        this.failure ??= err
        this.readyReject(err)
        this.notify()
        return
      }
      const waiter = this.pending.get(String(mid))
      if (waiter) {
        this.pending.delete(String(mid))
        waiter.resolve(msg)
        return
      }
    }
    if (msg.body?.syncPushPackage) {
      this.pushes.push(msg)
      this.notify()
    }
  }

  private responseError(lwp: string, res: Frame): CatbusError {
    const reason = String(res.body?.reason ?? res.body?.message ?? res.body?.msg ?? '')
    if (res.code === 401) return authError(this.x.ctx, `私信登录失败：${reason || res.code}`)
    return new CatbusError('UPSTREAM', `私信请求 ${lwp} 失败：${reason || res.code}`, { detail: { code: res.code, body: res.body ?? null } })
  }

  /** 连接结束（主动关闭或断线）：停心跳，等待中的请求和推送都以错误结束。 */
  private finish(err: unknown): void {
    if (err && !this.failure) this.failure = err
    this.closed = true
    // 断线时 read() 先走到这里，之后的 close() 会直接返回，心跳必须在这里停
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    const e = this.failure ?? new CatbusError('NETWORK', '私信长连接已关闭', { detail: { kind: 'connect' } })
    for (const w of this.pending.values()) w.reject(e)
    this.pending.clear()
    this.readyReject(e)
    this.notify()
  }

  private notify(): void {
    const w = this.wake
    this.wake = null
    w?.()
  }
}

/** listUserMessages 的一页：消息从新到旧。 */
export interface HistoryPage {
  models: unknown[]
  nextCursor: string | null
  hasMore: boolean
}

/** 取一页消息记录（上游 list_all_conversations 循环里的一次请求）。游标没往前走时按没有更多处理，免得原地打转。 */
export async function historyPage(im: Im, cid: string, cursor: string): Promise<HistoryPage> {
  const body = (await im.request(listFrame(cid, cursor))).body ?? {}
  const nextCursor = body.nextCursor == null ? null : String(body.nextCursor)
  const hasMore = Number(body.hasMore) === 1 && nextCursor != null && nextCursor !== cursor
  return { models: (body.userMessageModels as unknown[]) ?? [], nextCursor, hasMore }
}

/**
 * 在同一条连接上按 nextCursor 往更早翻（上游 list_all_conversations：收到一页就接着发下一页的请求），
 * 直到没有更多；调用方不再需要时提前结束迭代即可。翻页间隔用平台默认值（AGENTS 4.9）。
 */
export async function* historyPages(im: Im, cid: string, cursor: string): AsyncGenerator<HistoryPage> {
  for (;;) {
    const page = await historyPage(im, cid, cursor)
    yield page
    if (!page.hasMore) return
    cursor = page.nextCursor!
    await rand.sleep(im.x.ctx.platform.pageInterval, im.x.ctx.signal)
  }
}

/** 从 SingleChatConversation/create 的响应里取会话 ID。 */
export function createdCid(res: Frame): string | null {
  const direct = res.body?.singleChatConversation?.cid ?? res.body?.cid
  return typeof direct === 'string' && direct ? plainId(direct) : null
}
