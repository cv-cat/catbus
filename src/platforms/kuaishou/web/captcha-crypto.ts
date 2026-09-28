import { crc32 } from 'node:zlib'
import { quote } from '../../../core/py.js'

/**
 * 滑块验证码 `verifyParam` 的加密（上游 utils/sign/captcha_crypto.py，对应 encrypt.js 的 `$encrypt`）。
 *
 * 32 字节定长头 + 流密码密文：魔数、头长度、协议版本、0x1001、6、crc32(appId)、2、crc32(密文)、密文长度，均为小端。
 * 密文是逐字节 `b ^ keystream`，keystream 来自三路 LFSR 组合生成器。没有随机数也没有时间戳。
 */

const FEEDBACK = [0x80000062, 0x40000020, 0x10000002] as const
const MASK = [0x7fffffff, 0x3fffffff, 0x0fffffff] as const
const HIGH = [0x80000000, 0xc0000000, 0xf0000000] as const
/** q()/f27 里的种子；只有密钥装填后寄存器为 0 才用到。 */
const SEED = [324508639, 610839776, 4256789809] as const

/** 顶层闭包变量 v：`$encrypt` 调 q(payload, v) 时传进去的密钥。 */
export const CIPHER_KEY = 'BvWTr0uRBGH366Yb'
const HEADER_LEN = 32
const MAGIC = 0xdeadc0de
const VERSION_HEX = '00000000000000000003'
const FIELD_1001 = 4097
const CONST_6 = 6
const CONST_2 = 2

/** 页面 d702 包装器传进来的 appId。 */
export const APP_ID = 'c7b645db-65e8-401f-b38c-4c07c5fff247'

const u16le = (v: number) => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff)
const u32le = (v: number) => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)

/** q() + z()：三路 LFSR，每字节输出 8 bit 的钥匙流。 */
class Lfsr3 {
  private readonly r: number[]

  constructor(key = CIPHER_KEY) {
    // 密钥循环补齐到 12 字节；三条寄存器都用 key[4..7] 装填
    const raw = [...key].map((ch) => ch.charCodeAt(0) & 0xff)
    while (raw.length < 12) raw.push(raw[raw.length - key.length]!)
    const regs: number[] = [...SEED]
    for (let i = 0; i < 4; i++) {
      const byte = raw[i + 4]!
      for (let r = 0; r < 3; r++) regs[r] = ((regs[r]! << 8) | byte) >>> 0
    }
    this.r = regs.map((v, i) => v || SEED[i]!)
  }

  next(): number {
    const r = this.r
    let b1 = r[1]! & 1
    let b2 = r[2]! & 1
    let out = 0
    for (let i = 0; i < 8; i++) {
      if (r[0]! & 1) {
        r[0] = ((r[0]! ^ (FEEDBACK[0] >>> 1)) | HIGH[0]) >>> 0
        if (r[1]! & 1) {
          r[1] = ((r[1]! ^ (FEEDBACK[1] >>> 1)) | HIGH[1]) >>> 0
          b1 = 1
        } else {
          r[1] = ((r[1]! >>> 1) & MASK[1]) >>> 0
          b1 = 0
        }
      } else {
        r[0] = ((r[0]! >>> 1) & MASK[0]) >>> 0
        if (r[2]! & 1) {
          r[2] = ((r[2]! ^ (FEEDBACK[2] >>> 1)) | HIGH[2]) >>> 0
          b2 = 1
        } else {
          r[2] = ((r[2]! >>> 1) & MASK[2]) >>> 0
          b2 = 0
        }
      }
      out = ((out << 1) | (b1 ^ b2)) & 0xff
    }
    return out
  }

  apply(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i++) out[i] = (data[i]! ^ this.next()) & 0xff
    return out
  }
}

/** d702 的 `h()`：逐个 UTF-16 码元取低 8 位（不是 UTF-8，非 ASCII 字符会“丢字”，与浏览器一致）。 */
export function toBytes(payload: string): Uint8Array {
  const out = new Uint8Array(payload.length)
  for (let i = 0; i < payload.length; i++) out[i] = payload.charCodeAt(i) & 0xff
  return out
}

/** `$encrypt`：明文 → 带 32 字节头的密文块。 */
export function encrypt(payload: string | Uint8Array, appId = APP_ID): Uint8Array {
  const plain = typeof payload === 'string' ? toBytes(payload) : payload
  const cipher = new Lfsr3().apply(plain)
  return Buffer.concat([
    u32le(MAGIC),
    u16le(HEADER_LEN),
    Buffer.from(VERSION_HEX, 'hex'),
    u16le(FIELD_1001),
    Uint8Array.of(CONST_6),
    u32le(crc32(Buffer.from(appId, 'utf8')) >>> 0),
    Uint8Array.of(CONST_2),
    u32le(crc32(cipher) >>> 0),
    u32le(cipher.length),
    cipher,
  ])
}

/** `$encrypt` 的逆：剥掉 32 字节头，用同一钥匙流还原明文（latin-1）。 */
export function decrypt(blob: Uint8Array): string {
  const b = Buffer.from(blob)
  if (b.length < HEADER_LEN) throw new Error(`密文块太短：${b.length} < ${HEADER_LEN}`)
  if (b.readUInt32LE(0) !== MAGIC) throw new Error('魔数不对')
  const cipher = b.subarray(HEADER_LEN)
  if (b.readUInt32LE(28) !== cipher.length) throw new Error('长度字段与实际密文不符')
  if (b.readUInt32LE(24) !== crc32(cipher) >>> 0) throw new Error('密文 CRC32 校验失败')
  return Buffer.from(new Lfsr3().apply(cipher)).toString('latin1')
}

/** d702 里的 `qs.stringify`：按插入顺序、键值都编码、跳过 null / undefined、布尔写成 true / false。 */
export function qsStringify(params: Record<string, unknown> | [string, unknown][]): string {
  const pairs = Array.isArray(params) ? params : Object.entries(params)
  const out: string[] = []
  for (const [key, value] of pairs) {
    if (value == null) continue
    const v = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
    out.push(`${quote(String(key), '*-._')}=${quote(v, '*-._')}`)
  }
  return out.join('&')
}

/** 参数 → 可以直接放进请求体的 base64 `verifyParam`。 */
export function verifyParam(params: Record<string, unknown> | [string, unknown][], appId = APP_ID): string {
  return Buffer.from(encrypt(qsStringify(params), appId)).toString('base64')
}
