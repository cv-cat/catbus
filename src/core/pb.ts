import protobuf from 'protobufjs/minimal.js'

/**
 * 无 schema 的 protobuf 解码（替代上游的 blackboxprotobuf）：按字段号取值。
 * 同一字段号出现多次时是 repeated。
 */

export type PbValue = bigint | Uint8Array | number
export type PbMessage = Map<number, PbValue[]>

/** 解一层消息。varint 为 bigint，fixed32 / fixed64 为 number / bigint，length-delimited 为字节。 */
export function decode(buf: Uint8Array): PbMessage {
  const r = protobuf.Reader.create(buf)
  const out: PbMessage = new Map()
  while (r.pos < r.len) {
    const tag = r.uint32()
    const field = tag >>> 3
    let value: PbValue
    switch (tag & 7) {
      case 0:
        value = BigInt(r.uint64().toString())
        break
      case 1:
        value = BigInt(r.fixed64().toString())
        break
      case 2:
        value = r.bytes()
        break
      case 5:
        value = r.fixed32()
        break
      default:
        throw new Error(`protobuf：不支持的 wire type ${tag & 7}`)
    }
    const list = out.get(field)
    if (list) list.push(value)
    else out.set(field, [value])
  }
  return out
}

/** 取字段的第一个值。 */
export function first(m: PbMessage, field: number): PbValue | undefined {
  return m.get(field)?.[0]
}

export function str(m: PbMessage, field: number): string | null {
  const v = first(m, field)
  return v instanceof Uint8Array ? Buffer.from(v).toString('utf8') : null
}

export function int(m: PbMessage, field: number): number | null {
  const v = first(m, field)
  return typeof v === 'bigint' ? Number(BigInt.asIntN(64, v)) : typeof v === 'number' ? v : null
}

/** 64 位整数按字符串取（ID 用）。 */
export function int64(m: PbMessage, field: number): string | null {
  const v = first(m, field)
  return typeof v === 'bigint' ? BigInt.asIntN(64, v).toString() : null
}

/** repeated 的子消息。 */
export function messages(m: PbMessage, field: number): PbMessage[] {
  return (m.get(field) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(decode)
}

export function message(m: PbMessage, field: number): PbMessage | null {
  const v = first(m, field)
  return v instanceof Uint8Array ? decode(v) : null
}

export { protobuf }
