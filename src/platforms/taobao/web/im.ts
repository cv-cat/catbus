import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs } from '../../../core/http.js'
import { jsonDumps } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { openSocket } from '../../../core/stream.js'
import { authError } from '../../../core/toolkit.js'
import { accessToken, type Taobao } from './client.js'
import { IM_APP_KEY, IM_DOMAIN, IM_UA, WSS_URL, wsHeaders } from './profile.js'
import { generateMid, generateUuid } from './sign.js'

/**
 * 私信：钉钉 IMPaaS 的 wss 长连（上游 taobao_live.py）。
 *
 * 帧是 JSON，用 Python `json.dumps` 的默认格式序列化（上游如此，对拍逐字节比较）。
 * 请求帧带 `headers.mid`，响应回同一个 mid；服务端推送的每一帧都要回 ack。
 */

type Frame = Record<string, any>

/** listUserMessages 的起始游标（JS 的 Number.MAX_SAFE_INTEGER）。 */
export const FIRST_CURSOR = '9007199254740991'
/** 心跳间隔（上游 heart_beat 为 15 秒）。 */
const HEARTBEAT_MS = 15_000
/** 注册后等服务端的 /s/vulcan 推送，超时后照样继续。 */
const READY_MS = 10_000

export const imId = (id: string) => `${id}@${IM_DOMAIN}`
/** 去掉 `@cntaobao` 后缀。 */
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

/** create_chat：用卖家的 encrypt_uid 建单聊会话。 */
export function createChatFrame(myId: string, encryptUid: string): Frame {
  return {
    lwp: '/r/SingleChatConversation/create',
    headers: { mid: generateMid() },
    body: [{ pairFirst: imId(myId), bizType: '11001', ctx: { createConversationCtx: '{"encryptUid":"' + encryptUid + '"}', selfBizDomain: 'taobao' } }],
  }
}

export type OutgoingMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; file_id: unknown; image_url: string; size: unknown; width: number; height: number }

/** send_msg：cid 带 `@cntaobao` 后缀；图片是 base64 的 JSON，放在 custom 里。 */
export function sendMsgFrame(myId: string, cid: string, toId: string, senderNick: string, message: OutgoingMessage): Frame {
  const extension: Frame = { senderBizDomain: 'taobao', receiverBizDomain: 'taobao', sender_nick: senderNick }
  const content: Frame = { contentType: null }
  if (message.type === 'text') {
    content.contentType = 1
    content.text = { extension: { sender_nick: senderNick }, content: message.text }
  } else {
    delete extension.sender_nick
    const data = { fileId: message.file_id, size: message.size, url: message.image_url, width: message.width, height: message.height, isOriginal: 1, suffix: 'png' }
    content.contentType = 101
    content.custom = { type: 7, data: Buffer.from(jsonDumps(data)).toString('base64') }
  }
  return {
    lwp: '/r/MessageSend/sendByReceiverScope',
    headers: { mid: generateMid() },
    body: [
      {
        cid,
        uuid: generateUuid(),
        conversationType: 1,
        redPointPolicy: 0,
        extension,
        content,
        ctx: { senderBizDomain: 'taobao', receiverBizDomain: 'taobao' },
      },
      { actualReceivers: [imId(myId), imId(toId)] },
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

  private constructor(readonly tb: Taobao) {
    this.readyPromise.catch(() => {})
  }

  /**
   * 连接并注册（上游 init：先 get_token，再发 /reg 与 ackDiff）。listen 时再发一次心跳，之后每 15 秒一次。
   * 上游先连接再取 token；这里先取 token，登录态无效时不必建连接。
   */
  static async open(tb: Taobao, options: { heartbeat?: boolean } = {}): Promise<Im> {
    const token = await accessToken(tb)
    const im = new Im(tb)
    im.socket = await connector(WSS_URL, wsHeaders(tb.cookieString()), tb.ctx)
    try {
      const reg = regFrame(token, tb.deviceId)
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
      }, this.tb.ctx.config.timeout * 1000)
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
    if (this.heartbeat) clearInterval(this.heartbeat)
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
    if (res.code === 401) return authError(this.tb.ctx, `私信登录失败：${reason || res.code}`)
    return new CatbusError('UPSTREAM', `私信请求 ${lwp} 失败：${reason || res.code}`, { detail: { code: res.code, body: res.body ?? null } })
  }

  private finish(err: unknown): void {
    if (err && !this.failure) this.failure = err
    this.closed = true
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

/** 从 SingleChatConversation/create 的响应里取会话 ID。 */
export function createdCid(res: Frame): string | null {
  const direct = res.body?.singleChatConversation?.cid ?? res.body?.cid
  if (typeof direct === 'string' && direct) return plainId(direct)
  const m = /"(\d+\.\d+-\d+\.\d+#\d+)(?:@cntaobao)?"/.exec(JSON.stringify(res.body ?? null))
  return m ? m[1]! : null
}
