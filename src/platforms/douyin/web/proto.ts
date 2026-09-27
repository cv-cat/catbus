import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import protobuf from 'protobufjs'
import { staticFile } from '../../../core/paths.js'

/** 上游 static/*.proto 原样复制在 static/douyin/ 下，用 protobufjs 按文本解析（字段名保持 snake_case）。 */

const roots = new Map<string, protobuf.Root>()

export function type(file: 'Request' | 'Response' | 'Live', name: string): protobuf.Type {
  let root = roots.get(file)
  if (!root) {
    root = protobuf.parse(readFileSync(staticFile('douyin', `${file}.proto`), 'utf8'), { keepCase: true }).root
    roots.set(file, root)
  }
  return root.lookupType(name)
}

export function encode(file: 'Request' | 'Response' | 'Live', name: string, value: Record<string, unknown>): Uint8Array {
  const t = type(file, name)
  return t.encode(t.fromObject(value)).finish()
}

export function decode<T = any>(file: 'Request' | 'Response' | 'Live', name: string, data: Uint8Array, options: protobuf.IConversionOptions = {}): T {
  const t = type(file, name)
  return t.toObject(t.decode(data), { longs: String, bytes: Buffer, defaults: false, ...options }) as T
}

/** 直播推送帧的负载可能是 gzip。 */
export function inflate(payload: Uint8Array): Uint8Array {
  return payload[0] === 0x1f && payload[1] === 0x8b ? gunzipSync(payload) : payload
}
