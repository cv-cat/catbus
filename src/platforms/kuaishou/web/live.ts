import { readFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'
import { gunzipSync, inflateRawSync } from 'node:zlib'
import protobuf from 'protobufjs'
import * as n from '../../../core/normalize.js'
import { staticFile } from '../../../core/paths.js'
import type { Event, UserRef } from '../../../core/schemas.js'

/**
 * 直播弹幕 WebSocket 的 protobuf 编解码（上游 utils/live_proto.py）。schema 是 live-app.js 内嵌的
 * protobufjs descriptor（static/kuaishou/fixtures/live_ws_proto.json），直接交给 Root.fromJSON。
 *
 * 信封 SocketMessage { payloadType=1, compressionType=2, payload=3 }；payload 按 compressionType
 * 处理：3 → AES-128-CBC 解密，2 → gzip，其余原样；再按 payloadType 对应的消息类型解码。
 */

const WS_AES_KEY = Buffer.from('PPbzKKL7NB15leYy')
const WS_AES_IV = Buffer.from('JRODKJiolJ9xqso0')

interface Schema {
  root: protobuf.Root
  types: Map<string, protobuf.Type>
  enums: Map<string, protobuf.Enum>
  numberToName: Record<string, string>
  nameToType: Record<string, string>
  upstream: Record<string, [number, string]>
}

let cached: Schema | null = null

function schema(): Schema {
  if (cached) return cached
  // 上游抽出的 descriptor 里 CommentImageSegment 有个拼写错误的类型 `unit32`（上游 Python 解码器不校验类型，
  // protobufjs 会拒绝）；静态文件保持原样，这里在内存里改成 uint32
  const descriptor = JSON.parse(readFileSync(staticFile('kuaishou', 'fixtures/live_ws_proto.json'), 'utf8').replaceAll('"type": "unit32"', '"type": "uint32"').replaceAll('"type":"unit32"', '"type":"uint32"'))
  const maps = JSON.parse(readFileSync(staticFile('kuaishou', 'fixtures/live_ws_maps.json'), 'utf8'))
  const root = protobuf.Root.fromJSON({ nested: descriptor })
  const types = new Map<string, protobuf.Type>()
  const enums = new Map<string, protobuf.Enum>()
  // 与上游一样按简单名字索引：先深后浅，根上的同名类型覆盖嵌套的
  const walk = (ns: protobuf.NamespaceBase, depth: number, out: [number, protobuf.ReflectionObject][]) => {
    for (const obj of ns.nestedArray) {
      out.push([depth, obj])
      if (obj instanceof protobuf.Namespace) walk(obj, depth + 1, out)
    }
  }
  const all: [number, protobuf.ReflectionObject][] = []
  walk(root, 0, all)
  all.sort((a, b) => b[0] - a[0])
  for (const [, obj] of all) {
    if (obj instanceof protobuf.Type) types.set(obj.name, obj)
    else if (obj instanceof protobuf.Enum) enums.set(obj.name, obj)
  }
  cached = { root, types, enums, numberToName: maps.number_to_name, nameToType: maps.name_to_type, upstream: maps.upstream }
  return cached
}

function type(name: string): protobuf.Type {
  const t = schema().types.get(name)
  if (!t) throw new Error(`live proto 没有类型 ${name}`)
  return t
}

/** 编一帧上行：CS_ENTER_ROOM / CS_HEARTBEAT / CS_USER_EXIT。 */
export function encodeFrame(kind: 'CS_ENTER_ROOM' | 'CS_HEARTBEAT' | 'CS_USER_EXIT', payload: Record<string, unknown>): Uint8Array {
  const [number, typeName] = schema().upstream[kind]!
  const body = type(typeName).encode(type(typeName).fromObject(payload)).finish()
  return type('SocketMessage').encode({ payloadType: number, payload: body }).finish()
}

/** 进房帧：连上 WebSocket 后第一件事，token 来自 liveroom/websocketinfo。 */
export function enterRoomFrame(token: string, liveStreamId: string, reconnectCount = 0): Uint8Array {
  const payload: Record<string, unknown> = { token, liveStreamId }
  if (reconnectCount) payload.reconnectCount = reconnectCount
  return encodeFrame('CS_ENTER_ROOM', payload)
}

export const heartbeatFrame = (timestampMs: number) => encodeFrame('CS_HEARTBEAT', { timestamp: timestampMs })
export const userExitFrame = (timeMs: number) => encodeFrame('CS_USER_EXIT', { time: timeMs })

function decompress(payload: Uint8Array, compression: number): Buffer {
  if (compression === 3) {
    const d = createDecipheriv('aes-128-cbc', WS_AES_KEY, WS_AES_IV)
    d.setAutoPadding(false)
    let plain = Buffer.concat([d.update(payload), d.final()])
    const pad = plain[plain.length - 1] ?? 0
    if (pad >= 1 && pad <= 16 && plain.subarray(plain.length - pad).every((b) => b === pad)) plain = plain.subarray(0, plain.length - pad)
    return plain
  }
  if (compression === 2) {
    try {
      return gunzipSync(payload)
    } catch {
      return inflateRawSync(payload)
    }
  }
  return Buffer.from(payload)
}

export interface Frame {
  type: string
  payloadType: number
  payload: any
}

/** 解一帧下行。不在 bundle h 表里的类型浏览器会直接丢弃，这里保留原始字节。 */
export function decodeFrame(frame: Uint8Array): Frame {
  const s = schema()
  const env = type('SocketMessage').decode(frame) as any
  const number = Number(env.payloadType ?? 0)
  const name = s.numberToName[String(number)] ?? s.enums.get('PayloadType')?.valuesById[number] ?? String(number)
  let payload: any = {}
  if (env.payload?.length) {
    const raw = decompress(env.payload, Number(env.compressionType ?? 0))
    const typeName = s.nameToType[name]
    payload = typeName && s.types.has(typeName) ? type(typeName).toObject(type(typeName).decode(raw), { longs: String, enums: String, defaults: false }) : { _raw: raw.toString('hex') }
  }
  return { type: name, payloadType: number, payload }
}

function liveUser(u: any): UserRef | null {
  if (!u?.principalId) return null
  return n.userRef({ id: u.principalId, name: u.userName, url: `https://live.kuaishou.com/profile/${u.principalId}` })
}

/** SC_FEED_PUSH → Event：弹幕、点赞、礼物、分享与系统通知。 */
export function feedEvents(payload: any, giftName: (id: string) => string | null): Event[] {
  const out: Event[] = []
  const at = (v: any) => n.time(v) ?? undefined
  for (const f of payload?.commentFeeds ?? []) out.push(n.event({ type: 'chat', time: at(f.time), user: liveUser(f.user), text: String(f.content ?? '') }, f))
  for (const f of payload?.likeFeeds ?? []) out.push(n.event({ type: 'like', user: liveUser(f.user) }, f))
  for (const f of payload?.giftFeeds ?? []) {
    const id = String(f.giftId ?? '')
    const count = Number(f.batchSize || f.comboCount || 1)
    out.push(n.event({ type: 'gift', time: at(f.time), user: liveUser(f.user), gift: { name: giftName(id) ?? id, count } }, f))
  }
  for (const f of payload?.shareFeeds ?? []) out.push(n.event({ type: 'other', time: at(f.time), user: liveUser(f.user), text: '分享了直播间' }, f))
  for (const f of payload?.systemNoticeFeeds ?? []) out.push(n.event({ type: 'other', time: at(f.time), user: liveUser(f.user), text: n.str(f.content) }, f))
  return out
}
