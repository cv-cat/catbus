import { constants, createPublicKey, publicEncrypt } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import * as rand from '../../../core/rand.js'
import { openSocket, type Socket } from '../../../core/stream.js'
import type { Pc } from './client.js'
import { PUSH_URL, UA, WEB } from './profile.js'

/**
 * 私信 / 直播间的 RWP 长连（上游 apis/xhs_live.py 的 XHSWebSocket 与 IM protobuf 编解码）。
 * 帧是 JSON 信封 `{v, t, m, b}`；私信正文是 protobuf（ChatOneMessage），直播间事件是 base64 的 JSON。
 */

// ---------------------------------------------------------------- protobuf（上游 _pb_*，只用到 varint / length-delimited）

function varint(v: number | bigint): number[] {
  let n = BigInt(v)
  if (n < 0n) throw new Error('protobuf varint 不能为负')
  const out: number[] = []
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80)
    n >>= 7n
  }
  out.push(Number(n))
  return out
}

const field = (num: number, wire: number, payload: number[]) => [...varint((num << 3) | wire), ...payload]
const pbUint = (num: number, v: number | bigint) => field(num, 0, varint(v))
const pbBool = (num: number, v: boolean) => field(num, 0, varint(v ? 1 : 0))
const pbBytes = (num: number, b: Uint8Array | number[]) => field(num, 2, [...varint(b.length), ...b])
const pbString = (num: number, s: string) => pbBytes(num, [...Buffer.from(s, 'utf8')])

function readVarint(d: Uint8Array, o: number): [bigint, number] {
  let v = 0n
  let shift = 0n
  while (o < d.length) {
    const b = d[o++]!
    v |= BigInt(b & 0x7f) << shift
    if (!(b & 0x80)) return [v, o]
    shift += 7n
    if (shift >= 64n) throw new Error('protobuf varint 无效')
  }
  throw new Error('protobuf varint 被截断')
}

type Fields = Map<number, (bigint | Uint8Array)[]>

function readFields(d: Uint8Array): Fields {
  const out: Fields = new Map()
  let o = 0
  while (o < d.length) {
    const [tag, o1] = readVarint(d, o)
    o = o1
    const num = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    let v: bigint | Uint8Array
    if (wire === 0) [v, o] = readVarint(d, o)
    else if (wire === 2) {
      const [len, o2] = readVarint(d, o)
      v = d.subarray(o2, o2 + Number(len))
      o = o2 + Number(len)
    } else throw new Error(`protobuf wire type ${wire} 不支持`)
    const list = out.get(num)
    if (list) list.push(v)
    else out.set(num, [v])
  }
  return out
}

const last = (f: Fields, n: number) => f.get(n)?.at(-1)
const text = (f: Fields, n: number) => {
  const v = last(f, n)
  return v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : ''
}
const int = (f: Fields, n: number) => {
  const v = last(f, n)
  return typeof v === 'bigint' ? Number(v) : 0
}

export interface ChatMessage {
  mid: string
  ts: number
  sender: string
  receiver: string
  content: string
  contentType: number
}

/**
 * encode_im_chat_message：ChatSendMessage 包进 ChatOneMessage（type=1, field 9）。
 * 上游的 _pb_* 不省略默认值：token / nickname / ref_id 为空串、group_chat 为 false 也照写；command 为 None 时不写。
 */
export function encodeChatMessage(m: ChatMessage): Uint8Array {
  const send = [
    ...pbString(1, m.mid),
    ...pbUint(2, m.ts),
    ...pbString(3, ''),
    ...pbString(4, m.sender),
    ...pbString(5, m.receiver),
    ...pbString(6, m.content),
    ...pbUint(7, m.contentType),
    ...pbString(8, ''),
    ...pbBool(9, false),
    ...pbString(11, ''),
    ...pbUint(12, 1),
  ]
  return Uint8Array.from([...pbUint(1, 1), ...pbBytes(9, send)])
}

export interface InboundChat {
  mid: string
  messageId: string
  ts: number
  payload: string
  json: any
}

export interface ChatAck {
  mid: string
  messageId: string
  ts: number
  code: number
  msg: string
}

/** decode_im_one_message：field 4 是收到的私信，field 5 是发送回执。 */
export function decodeChat(data: Uint8Array): { message?: InboundChat; ack?: ChatAck } {
  const outer = readFields(data)
  const out: { message?: InboundChat; ack?: ChatAck } = {}
  const m = last(outer, 4)
  if (m instanceof Uint8Array) {
    const f = readFields(m)
    const payload = text(f, 5)
    let json: any = null
    try {
      json = JSON.parse(payload)
    } catch {}
    out.message = { mid: text(f, 1), messageId: text(f, 2), ts: int(f, 3), payload, json }
  }
  const a = last(outer, 5)
  if (a instanceof Uint8Array) {
    const f = readFields(a)
    out.ack = { mid: text(f, 1), messageId: text(f, 2), ts: int(f, 3), code: int(f, 5), msg: text(f, 6) }
  }
  return out
}

/** 私信正文常嵌套多层 JSON（上游 demo._im_text）：剥出最内层文本。 */
export function innerText(body: unknown): string {
  let content: any = body
  for (let i = 0; i < 6; i++) {
    if (content && typeof content === 'object' && 'content' in content) {
      content = content.content
      continue
    }
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content)
        if (parsed && typeof parsed === 'object') {
          content = parsed
          continue
        }
      } catch {}
    }
    break
  }
  return typeof content === 'string' ? content : JSON.stringify(content)
}

// ---------------------------------------------------------------- RSA 短链（HTTP 兜底发私信）

const RSA_N =
  'd321555d67813eace010dc27e72ab14876a9b671c7d58d3c9c2064cd60f7e9f79ad3799657b35a1b7654d82725408a71549d5ade11e74bbf1ec39b549ed32116affd4f6b03f2c9c44d91f84157b159a8a225150916e2716cc82dc8fd62385e5a01c83b784c139462a1dd45d47d96ebb4f5068c42b3de8590123a03565a9e5aed'

/** rsa_encrypt_short_link_payload：RSAES-PKCS1-v1_5 按 117 字节分块，结果按 latin-1 转成字符串。 */
export function rsaShortLink(payload: Uint8Array): string {
  const pub = createPublicKey({ key: { kty: 'RSA', n: Buffer.from(RSA_N, 'hex').toString('base64url'), e: 'AQAB' }, format: 'jwk' })
  const key = { key: pub, padding: constants.RSA_PKCS1_PADDING }
  const chunks: Buffer[] = []
  for (let o = 0; o < payload.length; o += 117) chunks.push(publicEncrypt(key, payload.subarray(o, o + 117)))
  return Buffer.concat(chunks).toString('latin1')
}

// ---------------------------------------------------------------- RWP 信封

/** message_id：uuid4().hex[:14] + '-' + hex(now)[-11:]。 */
export const messageId = () => rand.uuid4().replaceAll('-', '').slice(0, 14) + '-' + rand.now().toString(16).slice(-11)

const envelope = (t: number, m?: string, b?: unknown) => JSON.stringify({ v: 1, t, ...(m != null ? { m } : {}), ...(b !== undefined ? { b } : {}) })
const b64 = (v: Uint8Array | string) => Buffer.from(v as any).toString('base64')

export interface PushIdentity {
  uid: string
  sid: string
  deviceId: string
  fingerprint: string
}

export function handshakeFrame(id: PushIdentity): [string, string] {
  const m = messageId()
  const payload = {
    appId: 'xhs-pc',
    authInfo: { authType: 'generic', sid: id.sid, uid: id.uid, domain: 'red' },
    deviceInfo: { deviceId: id.deviceId, fingerprint: id.fingerprint, platform: 'browser', os: 'web', osVersion: '10.15', deviceName: 'Chrome', appVersion: '131.0.0.0', userAgent: UA },
    serviceTag: '',
    bizInfos: [
      { bizName: 'dqa_chatsearch', serializeType: 'protobuf' },
      { bizName: 'xhs_dots_pc', serializeType: 'protobuf' },
      { bizName: 'push', serializeType: 'json' },
    ],
    roomInfo: [],
    roomInfos: [],
    tagInfo: [],
    extInfo: {},
    state: 1,
  }
  return [envelope(2, m, { d: { a: 1, s: 0, b: payload } }), m]
}

export const registerFrame = (biz: string, type: string) => envelope(2, messageId(), { d: { a: 1, s: 1, b: { bizInfo: { bizName: biz, serializeType: type }, register: true } } })
export const joinRoomFrame = (roomId: string) => envelope(2, messageId(), { d: { a: 1, s: 8, b: { info: { bizName: 'room', roomId, roomType: 'LIVE' } } } })
export const heartbeatFrame = () => envelope(0)
export const stateSyncFrame = () => envelope(2, messageId(), { d: { a: 1, s: 6, b: {} } })

/** im_frame：客户端发私信用 action=2、服务 rrmp.b.i。 */
export const imFrame = (payload: Uint8Array) => envelope(3, messageId(), { d: { a: 2, c: 'sendMessage', biz: 'im', b: b64(payload), e: {}, s: 'rrmp.b.i' } })

/** 直播间观看心跳（上游 heartbeat）。 */
export function viewerHeartFrame(roomId: string, profile: { nickname: string; avatar: string; user_id: string; role: number }): string {
  const custom = { type: 'viewer_heart', priority: 0, profile, source: 'web_live', desc: '' }
  const data = { roomId, roomType: 'LIVE', command: 1, customData: JSON.stringify(custom) }
  return envelope(3, messageId(), { d: { a: 0, c: 'liveHeartBeat', biz: 'room', b: b64(JSON.stringify(data)), e: {}, s: 'rrmp.o.l' } })
}

/** decode_room_push：t=4 帧里 biz=room 的事件（base64 JSON，customData 再解一层）。 */
export function decodeRoomPush(frame: any): any[] {
  const d = frame?.t === 4 ? frame?.b?.d : null
  if (!d || d.biz !== 'room' || !Array.isArray(d.b)) return []
  const out: any[] = []
  for (const item of d.b) {
    if (typeof item?.d !== 'string') continue
    try {
      const payload = JSON.parse(Buffer.from(item.d, 'base64').toString('utf8'))
      if (typeof payload?.customData === 'string') {
        try {
          payload.customData = JSON.parse(payload.customData)
        } catch {}
      }
      out.push(payload)
    } catch {}
  }
  return out
}

/** IM 帧：t=3 的 b.d.b 是单个 base64，t=4 的 b.d.b 是 [{d}] 批量；发送回执在 b.a.b。 */
export function decodeImFrame(frame: any): ReturnType<typeof decodeChat>[] {
  const out: ReturnType<typeof decodeChat>[] = []
  const d = frame?.b?.d
  const tryDecode = (s: unknown) => {
    if (typeof s !== 'string' || !s) return
    try {
      out.push(decodeChat(Buffer.from(s, 'base64')))
    } catch {}
  }
  if (d?.biz === 'im') {
    if (typeof d.b === 'string') tryDecode(d.b)
    else if (Array.isArray(d.b)) for (const item of d.b) tryDecode(item?.d)
  }
  if (!out.length) tryDecode(frame?.b?.a?.b)
  return out
}

// ---------------------------------------------------------------- 连接

export interface Push {
  socket: Socket
  frames: AsyncIterable<any>
  send(frame: string): Promise<void>
  close(): void
}

/** 上游 connect_push_from_storage：没有 RWP token 时先 celestial/lt 换一个，再握手、注册 im（可选进直播间）。 */
export async function connectPush(p: Pc, signal: AbortSignal, roomId?: string): Promise<Push> {
  const { celestialLt } = await import('./api.js')
  const tokenValid = () => p.state.rwpToken && p.state.rwpToken.uid === p.userId && (p.state.rwpToken.expiredAt == null || p.state.rwpToken.expiredAt > rand.now())
  if (!tokenValid()) {
    p.state.rwpToken = null
    p.check(await celestialLt(p))
  }
  const sid = p.state.rwpToken?.aLt ?? ''
  if (!sid || !p.userId) throw new CatbusError('AUTH_REQUIRED', '没有拿到私信长连的登录 token（celestial/lt）', { hint: 'catbus xhs auth login' })
  const id: PushIdentity = { uid: p.userId, sid, deviceId: p.state.tabDeviceId, fingerprint: p.state.rwpFingerprint }
  const cookie = Object.entries(p.wire(PUSH_URL.replace('wss://', 'https://'))).map(([k, v]) => `${k}=${v}`).join('; ')
  const socket = await openSocket(PUSH_URL, { headers: { 'User-Agent': UA, Origin: WEB, ...(cookie ? { Cookie: cookie } : {}) }, signal })
  const it = socket.messages[Symbol.asyncIterator]()
  const pending: any[] = []
  const parse = (raw: string | Buffer) => {
    try {
      return JSON.parse(String(raw))
    } catch {
      return { raw: String(raw) }
    }
  }
  const [hs, hsId] = handshakeFrame(id)
  await socket.send(hs)
  // 浏览器等握手的 c=0 回执后才注册，否则后续帧都会被拒（3100001 Account has not privilege）
  const deadline = rand.now() + 10_000
  for (;;) {
    if (rand.now() > deadline) throw new CatbusError('NETWORK', '私信长连握手超时')
    const r = await it.next()
    if (r.done) throw new CatbusError('NETWORK', '私信长连在握手时断开')
    const f = parse(r.value)
    if (f?.m !== hsId) {
      pending.push(f)
      continue
    }
    const c = f?.b?.a?.c
    if (c !== 0) throw new CatbusError('AUTH_EXPIRED', `私信长连握手被拒绝：c=${c} ${f?.b?.a?.m ?? ''}`, { hint: 'catbus xhs auth login' })
    break
  }
  await socket.send(registerFrame('im', 'protobuf'))
  if (roomId) {
    await socket.send(registerFrame('room', 'json'))
    await socket.send(joinRoomFrame(roomId))
  }
  const beat = setInterval(() => void socket.send(heartbeatFrame()).catch(() => {}), 30_000).unref()
  return {
    socket,
    send: (frame) => socket.send(frame),
    close: () => {
      clearInterval(beat)
      socket.close()
    },
    frames: {
      async *[Symbol.asyncIterator]() {
        while (pending.length) yield pending.shift()
        for (;;) {
          const r = await it.next()
          if (r.done) return
          yield parse(r.value)
        }
      },
    },
  }
}
