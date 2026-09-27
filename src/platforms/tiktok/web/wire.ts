import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'
import { protobuf } from '../../../core/pb.js'
import { compactJson } from '../../../core/py.js'

/**
 * protobuf 线格式（上游 signing/protobuf.py、signing/live_wire.py，以及 api/tiktok_web.py 的私信帧构造）。
 * 字段顺序与上游手写的完全一致；64 位整数一律用 bigint / 字符串，避免精度丢失。
 */

export type IntLike = number | bigint | string

const enc = new TextEncoder()
const dec = new TextDecoder()

function big(value: IntLike, name: string): bigint {
  let v: bigint
  try {
    v = typeof value === 'bigint' ? value : BigInt(typeof value === 'number' ? Math.trunc(value) : String(value))
  } catch {
    throw new CatbusError('ERROR', `${name} 必须是整数`)
  }
  if (v < 0n) throw new CatbusError('ERROR', `${name} 不允许为负数`)
  return v
}

export function varint(value: IntLike, name = 'value'): Uint8Array {
  let n = big(value, name)
  const out: number[] = []
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80)
    n >>= 7n
  }
  out.push(Number(n))
  return Uint8Array.from(out)
}

export function concat(parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts))
}

export function fieldVarint(field: number, value: IntLike | boolean, name = 'value'): Uint8Array {
  return concat([varint(field << 3, 'field tag'), varint(typeof value === 'boolean' ? Number(value) : value, name)])
}

export function fieldBytes(field: number, value: Uint8Array): Uint8Array {
  return concat([varint((field << 3) | 2, 'field tag'), varint(value.length, 'length'), value])
}

export function fieldString(field: number, value: string): Uint8Array {
  return fieldBytes(field, enc.encode(String(value)))
}

export const fieldMessage = fieldBytes

// ================================================================ 无 schema 解码（live_wire.fields）

type Raw = bigint | Uint8Array
type Tree = Map<number, Raw[]>

function fields(raw: Uint8Array): Tree {
  const out: Tree = new Map()
  let offset = 0
  const number = (): bigint => {
    let value = 0n
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= raw.length) throw new CatbusError('UPSTREAM', 'protobuf varint 截断')
      const byte = raw[offset++]!
      value |= BigInt(byte & 0x7f) << shift
      if (byte < 0x80) return value
    }
    throw new CatbusError('UPSTREAM', 'protobuf varint 过长')
  }
  while (offset < raw.length) {
    const tag = number()
    const field = Number(tag >> 3n)
    const wire = Number(tag & 7n)
    if (!field) throw new CatbusError('UPSTREAM', 'protobuf field 0 无效')
    let value: Raw
    if (wire === 0) value = number()
    else if (wire === 2 || wire === 1 || wire === 5) {
      const length = wire === 2 ? Number(number()) : wire === 1 ? 8 : 4
      if (offset + length > raw.length) throw new CatbusError('UPSTREAM', 'protobuf bytes 截断')
      value = raw.subarray(offset, offset + length)
      offset += length
    } else throw new CatbusError('UPSTREAM', `不支持的 protobuf wire type ${wire}`)
    const list = out.get(field)
    if (list) list.push(value)
    else out.set(field, [value])
  }
  return out
}

const first = (t: Tree, k: number) => t.get(k)?.[0]
const str = (t: Tree, k: number) => {
  const v = first(t, k)
  return v instanceof Uint8Array ? dec.decode(v) : ''
}
const int = (t: Tree, k: number): bigint => {
  const v = first(t, k)
  return typeof v === 'bigint' ? v : 0n
}
const nested = (t: Tree, k: number): Tree => {
  const v = first(t, k)
  return v instanceof Uint8Array ? fields(v) : new Map()
}

// ================================================================ 直播（signing/live_wire.py）

export interface LiveUser {
  id: string
  nickname: string
  display_id: string
  sec_uid: string
}

export interface LiveEvent {
  method: string
  message_id: string
  type: 'chat' | 'like' | 'gift' | 'other'
  user?: LiveUser
  text?: string
  count?: number
  total?: number
  gift_id?: string
  combo_count?: number
  gift?: { id: string; name: string }
  payload_length?: number
}

export interface LiveResponse {
  events: LiveEvent[]
  cursor: string
  internal_ext: string
  fetch_interval: number
  heartbeat_duration: number
  need_ack: boolean
  raw_length: number
}

function liveUser(t: Tree): LiveUser {
  return { id: int(t, 1).toString(), nickname: str(t, 3), display_id: str(t, 38), sec_uid: str(t, 46) }
}

/** 一次 HTTP im/fetch 或解压后的 WS LiveResponse。 */
export function decodeLiveResponse(raw: Uint8Array): LiveResponse {
  const tree = fields(raw)
  const events: LiveEvent[] = []
  for (const item of tree.get(1) ?? []) {
    if (!(item instanceof Uint8Array)) throw new CatbusError('UPSTREAM', 'LiveResponse.messagesList 不是 message')
    const envelope = fields(item)
    const method = str(envelope, 1)
    const payload = first(envelope, 2) ?? new Uint8Array()
    if (!(payload instanceof Uint8Array)) throw new CatbusError('UPSTREAM', '直播事件 payload 不是 bytes')
    const event: LiveEvent = { method, message_id: int(envelope, 3).toString(), type: 'other' }
    const body = fields(payload)
    if (method === 'WebcastChatMessage') Object.assign(event, { type: 'chat', user: liveUser(nested(body, 2)), text: str(body, 3) })
    else if (method === 'WebcastLikeMessage') {
      Object.assign(event, { type: 'like', count: Number(int(body, 2)), total: Number(int(body, 3)), user: liveUser(nested(body, 5)) })
    } else if (method === 'WebcastGiftMessage') {
      const gift = nested(body, 15)
      Object.assign(event, {
        type: 'gift',
        gift_id: int(body, 2).toString(),
        combo_count: Number(int(body, 6)),
        user: liveUser(nested(body, 7)),
        gift: { id: int(gift, 5).toString(), name: str(gift, 16) },
      })
    } else event.payload_length = payload.length
    events.push(event)
  }
  return {
    events,
    cursor: str(tree, 2),
    internal_ext: str(tree, 5),
    fetch_interval: Number(int(tree, 3)),
    heartbeat_duration: Number(int(tree, 8)),
    need_ack: int(tree, 9) !== 0n,
    raw_length: raw.length,
  }
}

export interface PushFrame {
  seq_id: string
  log_id: bigint
  payload_type: string
  headers: Record<string, string>
  response: LiveResponse | null
  payload_length: number
}

/** WS 的 PushFrame，payload 可能是 gzip 过的 LiveResponse。 */
export function decodePushFrame(raw: Uint8Array): PushFrame {
  const tree = fields(raw)
  let payload = first(tree, 8) ?? new Uint8Array()
  if (!(payload instanceof Uint8Array)) throw new CatbusError('UPSTREAM', 'PushFrame.payload 不是 bytes')
  const headers: Record<string, string> = {}
  for (const item of tree.get(5) ?? []) {
    if (item instanceof Uint8Array) {
      const pair = fields(item)
      headers[str(pair, 1)] = str(pair, 2)
    }
  }
  if (headers.compress_type === 'gzip' || (payload[0] === 0x1f && payload[1] === 0x8b)) payload = new Uint8Array(gunzipSync(payload))
  const kind = str(tree, 7)
  return {
    seq_id: int(tree, 1).toString(),
    log_id: int(tree, 2),
    payload_type: kind,
    headers,
    response: kind === 'msg' || kind === 'im_enter_room_resp' ? decodeLiveResponse(payload) : null,
    payload_length: payload.length,
  }
}

export function encodeFrame(kind: string, payload: Uint8Array, logId?: IntLike): Uint8Array {
  return concat([logId != null ? fieldVarint(2, logId) : new Uint8Array(), fieldString(6, 'pb'), fieldString(7, kind), fieldBytes(8, payload)])
}

export function encodeHeartbeat(roomId: IntLike): Uint8Array {
  return encodeFrame('hb', fieldVarint(1, roomId))
}

export function encodeEnterRoom(roomId: IntLike, liveId: IntLike, cursor: string): Uint8Array {
  const payload = concat([fieldVarint(1, roomId), fieldVarint(4, liveId), fieldString(5, 'audience'), fieldString(6, cursor), fieldVarint(7, 0), fieldString(9, '0'), fieldVarint(10, 0)])
  return encodeFrame('im_enter_room', payload)
}

// ================================================================ 私信请求（api/tiktok_web.py 的 _im_* 方法）

export const IM_SDK_VERSION = '1.7.4'
export const IM_BUILD_NUMBER = 'cb1a69c:feat/im-core-sdk-ooo-push-v2'

export interface ImEnvelope {
  sequenceId: IntLike
  token?: string
  refer?: number
  inboxType?: number
  sdkVersion?: string
  buildNumber?: string
  deviceId: string
  channel?: string | null
  devicePlatform?: string
  deviceType?: string | null
  osVersion?: string | null
  versionCode?: string | null
  headers: [string, string][]
  configId?: IntLike | null
  authType?: IntLike | null
}

/** Request 外层：body 是 field 8，里面再按命令号嵌一层。 */
export function imOuterRequest(command: number, bodyPayload: Uint8Array, e: ImEnvelope): Uint8Array {
  const parts = [
    fieldVarint(1, command),
    fieldVarint(2, e.sequenceId, 'sequence_id'),
    fieldString(3, e.sdkVersion ?? IM_SDK_VERSION),
    fieldString(4, e.token ?? ''),
    fieldVarint(5, e.refer ?? 3),
    fieldVarint(6, e.inboxType ?? 0),
    fieldString(7, e.buildNumber ?? IM_BUILD_NUMBER),
    fieldMessage(8, fieldMessage(command, bodyPayload)),
    fieldString(9, e.deviceId),
  ]
  if (e.channel != null) parts.push(fieldString(10, e.channel))
  parts.push(fieldString(11, e.devicePlatform ?? 'web'))
  for (const [n, v] of [
    [12, e.deviceType],
    [13, e.osVersion],
    [14, e.versionCode],
  ] as const) {
    if (v != null) parts.push(fieldString(n, v))
  }
  for (const [k, v] of e.headers) parts.push(fieldMessage(15, concat([fieldString(1, k), fieldString(2, v)])))
  if (e.configId != null) parts.push(fieldVarint(16, e.configId, 'config_id'))
  if (e.authType != null) parts.push(fieldVarint(18, e.authType, 'auth_type'))
  return concat(parts)
}

export interface Inbox {
  inbox_type: IntLike
  cursor: IntLike
  limit: IntLike
  scene: IntLike
  cursor_type?: IntLike | null
}

/** cmd 204：get_by_user_combo。 */
export function imUserComboRequest(inboxes: Inbox[], e: ImEnvelope, o: { statusAdapterMap?: IntLike; lastPullTime?: IntLike } = {}): Uint8Array {
  if (!inboxes.length) throw new CatbusError('ERROR', '私信 get_by_user_combo 至少需要一个 inbox')
  const parts = inboxes.map((b) =>
    fieldMessage(
      1,
      concat([
        fieldVarint(1, b.inbox_type),
        fieldVarint(2, b.cursor),
        fieldVarint(3, b.limit),
        fieldVarint(4, b.scene),
        ...(b.cursor_type != null ? [fieldVarint(5, b.cursor_type)] : []),
      ]),
    ),
  )
  if (o.statusAdapterMap != null) parts.push(fieldVarint(2, o.statusAdapterMap))
  if (o.lastPullTime != null) parts.push(fieldVarint(3, o.lastPullTime))
  return imOuterRequest(204, concat(parts), e)
}

/** cmd 203：get_by_user_init（私信页初次拉取）。 */
export function imUserInitRequest(cursor: IntLike, e: ImEnvelope, o: { newUser?: IntLike; initSubType?: IntLike; withEmptyConv?: boolean; siderankKeys?: string[] } = {}): Uint8Array {
  const parts = [fieldVarint(1, cursor, 'cursor')]
  if (o.newUser != null) parts.push(fieldVarint(2, o.newUser))
  if (o.initSubType != null) parts.push(fieldVarint(3, o.initSubType))
  if (o.withEmptyConv != null) parts.push(fieldVarint(4, o.withEmptyConv))
  for (const k of o.siderankKeys ?? []) parts.push(fieldString(5, k))
  return imOuterRequest(203, concat(parts), e)
}

/** cmd 301：get_by_conversation。 */
export function imConversationRequest(
  c: { conversationId: string; shortId: IntLike; type: IntLike; anchorIndex: IntLike; direction: IntLike; limit: IntLike; ext?: [string, string][] },
  e: ImEnvelope,
): Uint8Array {
  if (!c.conversationId) throw new CatbusError('ERROR', '私信 conversation_id 必须是非空字符串')
  const parts = [
    fieldString(1, c.conversationId),
    fieldVarint(2, c.type),
    fieldVarint(3, c.shortId),
    fieldVarint(4, c.direction),
    fieldVarint(5, c.anchorIndex),
    fieldVarint(6, c.limit),
  ]
  for (const [k, v] of c.ext ?? []) parts.push(fieldMessage(7, concat([fieldString(1, k), fieldString(2, v)])))
  return imOuterRequest(301, concat(parts), e)
}

/** cmd 100 的 body：文本消息（content 里的 aweType 是浏览器原样的拼写）。 */
export function imSendBody(c: { conversationId: string; shortId: IntLike; type: IntLike; text: string; messageType?: IntLike; clientMessageId: string }): Uint8Array {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(c.clientMessageId)) {
    throw new CatbusError('ERROR', '私信发送 client_message_id 必须是完整 UUID')
  }
  const content = compactJson({ aweType: 0, text: c.text })
  return concat([
    fieldString(1, c.conversationId),
    fieldVarint(2, c.type),
    fieldVarint(3, c.shortId),
    fieldString(4, content),
    fieldMessage(5, concat([fieldString(1, 's:mentioned_users'), fieldString(2, '')])),
    fieldMessage(5, concat([fieldString(1, 's:client_message_id'), fieldString(2, c.clientMessageId)])),
    fieldVarint(6, c.messageType ?? 7),
    fieldString(7, 'deprecated'),
    fieldString(8, c.clientMessageId),
  ])
}

/** WebSocket.send 的完整二进制 Frame。 */
export function imSendFrame(o: { request: Uint8Array; sequenceId: IntLike; logId: IntLike; xBogus: string; frameHeaders: [string, string][] }): Uint8Array {
  if (o.xBogus.length !== 16) throw new CatbusError('ERROR', '私信 WebSocket 缺少 16 位 X-Bogus')
  return concat([
    fieldVarint(1, o.sequenceId),
    fieldVarint(2, o.logId),
    fieldVarint(3, 5),
    fieldVarint(4, 1),
    fieldMessage(5, concat([fieldString(1, 'X-Bogus'), fieldString(2, o.xBogus)])),
    ...o.frameHeaders.map(([k, v]) => fieldMessage(5, concat([fieldString(1, k), fieldString(2, v)]))),
    fieldString(7, 'pb'),
    fieldMessage(8, o.request),
  ])
}

// ================================================================ 私信回包（static/Tiktok_Request_pb2.py 的 descriptor）

let root: protobuf.Root | null = null

function imType(name: string): protobuf.Type {
  root ??= protobuf.Root.fromJSON(JSON.parse(readFileSync(staticFile('tiktok', 'Tiktok_Request.json'), 'utf8')))
  return root.lookupType(`im_proto.${name}`)
}

const TO_OBJECT = { longs: String, bytes: String, defaults: false } as const

/** Frame → Response（protobuf_to_dict 的替代：protobufjs toObject，64 位整数为字符串）。 */
export function decodeImFrame(raw: Uint8Array): { frame: any; response: any } {
  try {
    const frame = imType('Frame').toObject(imType('Frame').decode(raw), TO_OBJECT) as any
    const payload = Buffer.from(frame.payload ?? '', 'base64')
    const response = imType('Response').toObject(imType('Response').decode(payload), TO_OBJECT)
    return { frame, response }
  } catch (err) {
    throw new CatbusError('UPSTREAM', `私信 WebSocket 回包不是可解析 protobuf：${(err as Error).message}`)
  }
}

/** 私信命令 100 的回包（上游 _decode_im_send_response）。 */
export function decodeImSendResponse(raw: string | Uint8Array): Record<string, unknown> {
  if (typeof raw === 'string') return raw === 'hi' ? { heartbeat: true } : { text_frame: true }
  const { frame, response } = decodeImFrame(raw)
  const out: Record<string, unknown> = {
    heartbeat: false,
    frame_seqid: String(frame.seqid ?? '0'),
    cmd: Number(response.cmd ?? 0),
    sequence_id: String(response.sequence_id ?? '0'),
    status_code: Number(response.status_code ?? 0),
    error_desc: String(response.error_desc ?? ''),
  }
  const body = response.body?.send_message_body
  if (out.cmd === 100 && body) {
    Object.assign(out, {
      message_status: Number(body.status ?? 0),
      server_message_id: String(body.server_message_id ?? '0'),
      check_code: String(body.check_code ?? '0'),
      is_async_send: Boolean(body.is_async_send),
    })
  }
  return out
}

export interface ImTextMessage {
  conversation_id: string
  conversation_short_id: string
  server_message_id: string
  message_type: number
  sender: string
  sec_sender: string
  text: string
  content: unknown
  create_time: string
  frame_seqid: string
}

/** cmd 500 的新消息推送；只处理文本（message_type 7），其他返回 null（上游 decode_im_ws_notification）。 */
export function decodeImNotification(raw: string | Uint8Array): ImTextMessage | null {
  if (typeof raw === 'string') {
    if (raw === 'hi') return null
    throw new CatbusError('UPSTREAM', '私信 WS 收到未知文本帧')
  }
  const { frame, response } = decodeImFrame(raw)
  if (Number(response.cmd ?? 0) !== 500) return null
  if (response.status_code) throw new CatbusError('UPSTREAM', `私信 WS 推送状态异常：${response.status_code}`)
  const notify = response.body?.has_new_message_notify
  if (!notify) throw new CatbusError('UPSTREAM', '私信 command-500 缺少通知 body')
  const m = notify.message
  if (!m || Number(m.message_type ?? 0) !== 7) return null
  let content: any
  try {
    content = JSON.parse(m.content)
  } catch {
    throw new CatbusError('UPSTREAM', '私信文本推送 content 缺少 text')
  }
  if (typeof content?.text !== 'string') throw new CatbusError('UPSTREAM', '私信文本推送 content 缺少 text')
  return {
    conversation_id: String(m.conversation_id ?? ''),
    conversation_short_id: String(m.conversation_short_id ?? '0'),
    server_message_id: String(m.server_message_id ?? '0'),
    message_type: Number(m.message_type),
    sender: String(m.sender ?? '0'),
    sec_sender: String(m.sec_sender ?? ''),
    text: content.text,
    content,
    create_time: String(m.create_time ?? '0'),
    frame_seqid: String(frame.seqid ?? '0'),
  }
}

// ---------------------------------------------------------------- 私信 HTTP 回包的无 schema 解码（上游 decode_im_protobuf）

export type Wire = { [field: string]: WireValue }
export type WireValue = string | Wire | unknown[] | WireValue[]

/**
 * 与 blackboxprotobuf 的推断一致：bytes 能完整解析成 protobuf 时当子消息，否则按 UTF-8 文本；
 * 文本像 JSON 时解析成对象。varint 为十进制字符串。重复字段为数组。
 */
export function decodeWire(raw: Uint8Array): Wire {
  const tree = fields(raw)
  const out: Wire = {}
  for (const [k, values] of tree) {
    const decoded = values.map(wireValue)
    out[String(k)] = decoded.length === 1 ? decoded[0]! : decoded
  }
  return out
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true })

/** 可打印的 UTF-8 文本当字符串（像 JSON 时解析），否则尝试当子消息，再不行给 base64。 */
function wireValue(v: Raw): WireValue {
  if (typeof v === 'bigint') return v.toString()
  let text: string | null = null
  try {
    text = utf8Strict.decode(v)
  } catch {}
  if (text != null && !/[\x00-\x08\x0e-\x1f\x7f]/.test(text)) {
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return JSON.parse(text)
      } catch {}
    }
    return text
  }
  try {
    return decodeWire(v)
  } catch {
    return text ?? Buffer.from(v).toString('base64')
  }
}

export interface PulledMessage {
  conversation_id: string
  server_message_id: string
  conversation_short_id: string
  message_type: string
  sender: string
  text: string
  content: Record<string, unknown>
  create_time: string
}

/** 从拉取的回包里找出文本消息：field 8 是带 text 的 JSON 的节点（上游 visit）。 */
export function pulledMessages(wire: Wire): PulledMessage[] {
  const out: PulledMessage[] = []
  const seen = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const node = value as Wire
    const content = node['8'] as Record<string, unknown> | undefined
    if (content && typeof content === 'object' && !Array.isArray(content) && typeof content.text === 'string') {
      const key = [node['3'], node['5'], node['7'], node['10'], content.text].map(String).join('\u0000')
      if (!seen.has(key)) {
        seen.add(key)
        out.push({
          conversation_id: String(node['1'] ?? ''),
          server_message_id: String(node['3'] ?? ''),
          conversation_short_id: String(node['5'] ?? ''),
          message_type: String(node['6'] ?? ''),
          sender: String(node['7'] ?? ''),
          content,
          text: content.text as string,
          create_time: String(node['10'] ?? ''),
        })
      }
    }
    Object.values(node).forEach(visit)
  }
  visit(wire)
  return out
}

export interface PulledConversation {
  conversation_id: string
  conversation_short_id: string
  conversation_type: string
}

const CONVERSATION_ID = /^\d+:\d+:\d+:\d+$/

/** 会话：field 1 是 `0:1:<uid>:<uid>` 形式的会话 ID、field 2 / 3 是短 ID 与类型的节点（ConversationInfo）。 */
export function pulledConversations(wire: Wire): PulledConversation[] {
  const out = new Map<string, PulledConversation>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const node = value as Wire
    const id = node['1']
    if (typeof id === 'string' && CONVERSATION_ID.test(id) && !out.has(id)) {
      // ConversationInfo：1=id 2=short_id 3=type；MessageBody：1=id 2=type 5=short_id
      const isMessage = typeof node['5'] === 'string' && node['8'] !== undefined
      const shortId = isMessage ? node['5'] : node['2']
      const type = isMessage ? node['2'] : node['3']
      if (typeof shortId === 'string' && /^\d+$/.test(shortId)) {
        out.set(id, { conversation_id: id, conversation_short_id: shortId, conversation_type: typeof type === 'string' ? type : '1' })
      }
    }
    Object.values(node).forEach(visit)
  }
  visit(wire)
  return [...out.values()]
}
