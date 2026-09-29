import { createCipheriv, createHash, createHmac } from 'node:crypto'
import { md5Hex, sha256Hex } from '../../../core/hash.js'
import { quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { PROFILE } from './profile.js'

/**
 * 抖音的纯算签名（上游 utils/sm3.py、ab_pure.py、xbogus_pure.py、secsdk_web_sign.py、strdata_pure.py、dy_util.py）。
 */

// ================================================================ SM3

const SM3_IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e]

const rotl = (x: number, n: number) => {
  n &= 31
  return n ? ((x << n) | (x >>> (32 - n))) >>> 0 : x >>> 0
}
const p0 = (x: number) => (x ^ rotl(x, 9) ^ rotl(x, 17)) >>> 0
const p1 = (x: number) => (x ^ rotl(x, 15) ^ rotl(x, 23)) >>> 0

function sm3Block(v: number[], block: Uint8Array, offset: number): number[] {
  const w = new Array<number>(68)
  for (let i = 0; i < 16; i++) {
    const o = offset + i * 4
    w[i] = ((block[o]! << 24) | (block[o + 1]! << 16) | (block[o + 2]! << 8) | block[o + 3]!) >>> 0
  }
  for (let j = 16; j < 68; j++) {
    w[j] = (p1(w[j - 16]! ^ w[j - 9]! ^ rotl(w[j - 3]!, 15)) ^ rotl(w[j - 13]!, 7) ^ w[j - 6]!) >>> 0
  }
  let [a, b, c, d, e, f, g, h] = v as [number, number, number, number, number, number, number, number]
  for (let j = 0; j < 64; j++) {
    const tj = j < 16 ? 0x79cc4519 : 0x7a879d8a
    const ss1 = rotl((rotl(a, 12) + e + rotl(tj, j)) >>> 0, 7)
    const ss2 = (ss1 ^ rotl(a, 12)) >>> 0
    const ff = j < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c)
    const gg = j < 16 ? e ^ f ^ g : (e & f) | (~e & g)
    const tt1 = ((ff >>> 0) + d + ss2 + ((w[j]! ^ w[j + 4]!) >>> 0)) >>> 0
    const tt2 = ((gg >>> 0) + h + ss1 + w[j]!) >>> 0
    d = c
    c = rotl(b, 9)
    b = a
    a = tt1
    h = g
    g = rotl(f, 19)
    f = e
    e = p0(tt2)
  }
  return [a, b, c, d, e, f, g, h].map((x, i) => (x ^ v[i]!) >>> 0)
}

export function sm3(message: Uint8Array | string): Uint8Array {
  const msg = typeof message === 'string' ? Buffer.from(message, 'utf8') : message
  const bitLen = BigInt(msg.length) * 8n
  const padLen = ((msg.length + 9 + 63) >> 6) << 6
  const buf = new Uint8Array(padLen)
  buf.set(msg)
  buf[msg.length] = 0x80
  new DataView(buf.buffer).setBigUint64(padLen - 8, bitLen)
  let v = SM3_IV
  for (let i = 0; i < padLen; i += 64) v = sm3Block(v, buf, i)
  const out = new Uint8Array(32)
  const dv = new DataView(out.buffer)
  v.forEach((x, i) => dv.setUint32(i * 4, x))
  return out
}

// ================================================================ 公用

function b64Custom(data: ArrayLike<number>, alphabet: string): string {
  let out = ''
  for (let i = 0; i < data.length; i += 3) {
    const n = Math.min(3, data.length - i)
    const v = (data[i]! << 16) | ((n > 1 ? data[i + 1]! : 0) << 8) | (n > 2 ? data[i + 2]! : 0)
    out += alphabet[(v >> 18) & 63]! + alphabet[(v >> 12) & 63]!
    out += n > 1 ? alphabet[(v >> 6) & 63]! : '='
    out += n > 2 ? alphabet[v & 63]! : '='
  }
  return out
}

/** 标准 RC4。 */
function rc4(key: ArrayLike<number>, data: ArrayLike<number>): number[] {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out: number[] = []
  let i = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255
    j = (j + s[i]!) & 255
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out.push(data[k]! ^ s[(s[i]! + s[j]!) & 255]!)
  }
  return out
}

export { md5Hex, sha256Hex }

/** 上游 splice_url：值用 `quote(safe='')` 编码，键原样，按插入顺序拼接。 */
export function spliceUrl(params: Iterable<[string, unknown]>): string {
  const parts: string[] = []
  for (const [k, v] of params) parts.push(`${k}=${quote(v == null ? '' : String(v), '')}`)
  return parts.join('&')
}

// ================================================================ a_bogus（ab_pure.py）

const SALT = 'dhzx'
const SDK_VERSION_CODE = 1
const SDK_MINOR_CODE = 12
const HOST_ABOGUS: Record<string, { sdkMinor: number; l40: number; l41: number; l42: number }> = {
  'www.douyin.com': { sdkMinor: 8, l40: 132, l41: 1, l42: 1 },
  'login.douyin.com': { sdkMinor: 14, l40: 0, l41: 0, l42: 0 },
}
const HOST_APP_IDS: Record<string, [number, number]> = {
  'www.douyin.com': [6383, 11881],
  'live.douyin.com': [6383, 7571],
  'creator.douyin.com': [2906, 33638],
  'login.douyin.com': [6383, 6241],
}
const FORTNIGHT_EPOCH = 1721836800000
const COUNTER_INIT = 2
const RC4_KEY_BYTE = 211
const ALPHABET_S3 = 'ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe'
const ALPHABET_S4 = 'Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe'
const BROWSER_OFFSET: Record<string, number> = { Chrome: 0, Firefox: 40, Safari: 81, Edge: 125, Huawei: 170 }
const BROWSER_TABLE: [string, RegExp[]][] = [
  ['Huawei', [/\bhuawei\b/i]],
  ['Chrome', [/(chrome)\/([\w.]+)(?!.*chromium)/i]],
  ['Edge', [/(edg|edge)\/([\w.]+)/i]],
  ['Firefox', [/\bfocus\/([\w.]+)/i, /fxios\/([-\w.]+)/i, /mobile vr; rv:([\w.]+)\).+firefox/i, /(firefox)\/([\w.]+)/i]],
  ['IE', [/(msie |trident.*rv:)([\w.]+)/i]],
  ['Opera', [/(opera|opr)\/([\w.]+)/i]],
  ['Safari', [/(safari)\/([\w.]+)(?!.*chrome)/i]],
]
const A98_PERM = [
  34, 44, 56, 61, 73, 29, 70, 45, 35, 49, 38, 66, 51, 68, 28, 48, 64, 47, 30, 71, 26, 55, 31, 69, 59, 40, 62, 63, 27, 72, 41, 74, 57, 52, 42, 39,
  33, 67, 53, 43, 65, 46, 36, 24, 60, 32, 79, 80, 84, 85,
]
const CHK_FIELDS = [
  24, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 55, 56, 57, 59, 60, 61, 62, 63, 64, 65, 66,
  67, 68, 69, 70, 71, 72, 73, 74, 79, 80, 84, 85,
]

/** a_bogus 用的 RC4 变体：S 盒初值倒序，密钥调度 `j = j*S[i] + j + key`。 */
function rc4Variant(key: number[], data: number[]): number[] {
  const s = Array.from({ length: 256 }, (_, i) => 255 - i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j * s[i]! + j + key[i % key.length]!) % 256
    ;[s[i], s[j]] = [s[j]!, s[i]!]
  }
  const out: number[] = []
  let i = 0
  j = 0
  for (const b of data) {
    i = (i + 1) % 256
    j = (j + s[i]!) % 256
    ;[s[i], s[j]] = [s[j]!, s[i]!]
    out.push(b ^ s[(s[i]! + s[j]!) % 256]!)
  }
  return out
}

function strToBytes(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c & 0xff00) out.push(c >> 8, c & 255)
    else out.push(c)
  }
  return out
}

const le = (value: number, count: number) => Array.from({ length: count }, (_, i) => Math.floor(value / 2 ** (8 * i)) & 255)

function blend(c0: number, c1: number, r0: number, r1: number): number[] {
  return [(r0 & 170) | (c0 & 85), (r0 & 85) | (c0 & 170), (r1 & 170) | (c1 & 85), (r1 & 85) | (c1 & 170)]
}

function expand(arr: number[], next: () => number): number[] {
  const out: number[] = []
  for (let i = 0; i < arr.length; i += 3) {
    if (i + 2 < arr.length) {
      const r = Math.floor(next() * 1000) & 255
      out.push((r & 145) | (arr[i]! & 110), (r & 66) | (arr[i + 1]! & 189), (r & 44) | (arr[i + 2]! & 211))
      out.push((arr[i]! & 145) | (arr[i + 1]! & 66) | (arr[i + 2]! & 44))
    } else {
      out.push(arr[i]!)
      if (i + 1 < arr.length && arr[i + 1]) out.push(arr[i + 1]!)
    }
  }
  return out
}

function escapeDigest(digest: Uint8Array, idx: number, reserved: number, fallback: number, force: boolean): number {
  let v = idx < digest.length ? digest[idx]! : fallback
  while (v === reserved) {
    idx++
    v = idx < digest.length ? digest[idx]! : fallback
  }
  return force ? reserved : v
}

export function browserName(ua: string): string {
  for (const [name, regs] of BROWSER_TABLE) if (regs.some((r) => r.test(ua))) return name
  return 'Other'
}

const counterBucket = (c: number) => (c > 10745 ? 3 : c > 1283 ? 4 : c > 139 ? 5 : 6)

/**
 * a_bogus 签名器（上游 ABogusPureSigner(fixed=False)）。计数器按签名次数递增，
 * 上游是进程级单例；catbus 一条命令一个会话，挂在会话上，语义相同。
 */
export class ABogus {
  counter = COUNTER_INIT
  readonly ua = PROFILE.ua
  private readonly offsetName = browserName(PROFILE.ua)

  sign(query: string, body = '', host = 'www.douyin.com'): string {
    const [aid, pageId] = HOST_APP_IDS[host] ?? HOST_APP_IDS['www.douyin.com']!
    const cfg = HOST_ABOGUS[host]
    const L: Record<number, any> = {}
    this.counter++
    L[12] = 3
    const t = rand.now()
    L[14] = t
    const v129 = SDK_VERSION_CODE
    const v14 = cfg?.sdkMinor ?? SDK_MINOR_CODE
    const h1 = sm3(sm3(query + SALT))
    const h2 = sm3(sm3(body + SALT))
    const uaCipher = rc4Variant([Math.floor(v129 / 256), v129 % 256, v14 % 256], [...this.ua.trim()].map((c) => c.charCodeAt(0)))
    const hUa = sm3(b64Custom(uaCipher, ALPHABET_S3))
    const ink = t - 1
    L[24] = 41
    L[25] = [1, 0, 1, 0, 1]
    L[26] = Math.trunc((t - FORTNIGHT_EPOCH) / 1000 / 60 / 60 / 24 / 14)
    L[27] = counterBucket(this.counter)
    L[28] = 3 // (t - t + 3) & 255
    le(t, 6).forEach((b, i) => (L[29 + i] = b))
    ;[L[35], L[36]] = le(v129, 2)
    const flags = 1 | (Number(browserName(this.ua) === 'Firefox') << 5)
    ;[L[38], L[39]] = le(flags, 2)
    L[40] = cfg?.l40 ?? 0
    L[41] = cfg?.l41 ?? 0
    L[42] = cfg?.l42 ?? 0
    L[43] = 0
    le(v14, 4).forEach((b, i) => (L[44 + i] = b))
    ;[L[48], L[49]] = [h1[9], h1[18]]
    L[51] = escapeDigest(h1, 3, 11, 12, Boolean(flags & 2))
    ;[L[52], L[53]] = [h2[10], h2[19]]
    L[55] = escapeDigest(h2, 4, 8, 9, Boolean(flags & 4))
    ;[L[56], L[57]] = [hUa[11], hUa[21]]
    L[59] = escapeDigest(hUa, 5, 12, 13, Boolean(flags & 8))
    le(ink, 6).forEach((b, i) => (L[60 + i] = b))
    L[66] = L[12]
    le(pageId, 4).forEach((b, i) => (L[67 + i] = b))
    le(aid, 4).forEach((b, i) => (L[71 + i] = b))
    L[77] = strToBytes([...PROFILE.geo, 'Win32'].join('|'))
    L[78] = L[77].length
    ;[L[79], L[80]] = le(L[78], 2)
    L[81] = `${(t + 3) & 255},`
    L[82] = strToBytes(L[81])
    L[83] = L[82].length
    ;[L[84], L[85]] = le(L[83], 2)

    const v6 = rand.random() * 65535
    const a8 = blend(L[25][0], L[25][1], Math.trunc(v6) & 255, (Math.trunc(v6) >> 8) & 255)
    rand.random()
    const r144 = rand.random()
    let check: number
    if (flags & 64) {
      const r = Math.floor(r144 * 109)
      check = r + 110 + (r % 2)
    } else {
      const r = Math.floor(r144 * 240)
      check = r > 109 ? r + (r % 2) + 1 : r
    }
    const perm = (Math.floor(rand.random() * 255) & 77) | 2 | 16 | 32 | 128
    a8.push(...blend(L[25][2], L[25][3], check, perm))
    let chk = 0
    for (const b of [...a8, ...CHK_FIELDS.map((s) => L[s] as number)]) chk ^= b
    L[87] = chk
    const a98 = [...A98_PERM.map((s) => L[s] as number), ...L[77], ...L[82], L[87]]
    const hr0 = Math.floor(rand.random() * 65535) & 255
    const offset = Math.floor(rand.random() * 40) + (BROWSER_OFFSET[this.offsetName] ?? 210)
    L[89] = blend(3, 82, hr0, offset)
    const plain = [...a8, ...expand(a98, rand.random)]
    const cipher = rc4Variant([RC4_KEY_BYTE], plain.map((x) => x & 0xffff))
    return b64Custom([...L[89], ...cipher.map((c) => c & 255)], ALPHABET_S4)
  }
}

// ================================================================ X-Bogus（xbogus_pure.py，直播 wss 的 signature）

const XB_ALPHABET = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe'
const XB_ENV_FLAGS = 1 | (1 << 3)
const XB_V14 = 4 | 8

export class XBogus {
  counter = 0

  sign(stubHex: string, payload = ''): string {
    const r1 = rand.random()
    const r2 = rand.random()
    const r3 = rand.random()
    const h1 = createHash('md5').update(createHash('md5').update(payload, 'utf8').digest()).digest()
    const h2 = createHash('md5').update(Buffer.from(stubHex, 'hex')).digest()
    const counter = this.counter + 1
    this.counter++
    const plain = [counter & 0x3f, (counter >> 8) & 255, XB_ENV_FLAGS, XB_V14, h1[14]!, h1[15]!, h2[14]!, h2[15]!, Math.trunc(255 * r2) & 255]
    const chk = plain.reduce((a, b) => a ^ b, 0)
    const keyByte = Math.trunc(255 * r3) & 255
    const cipher = rc4([keyByte], [...plain, chk])
    const eef = (1 << 6) | ((Math.trunc(100 * r1) & 1) << 4)
    return b64Custom([eef, keyByte, ...cipher], XB_ALPHABET)
  }
}

/** 直播 wss 的 signature（上游 dy_util.generate_signature）。 */
export function liveSignature(xb: XBogus, roomId: string, userUniqueId: string): string {
  const raw =
    `live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.15,room_id=${roomId},sub_room_id=,sub_channel_id=,did_rule=3,` +
    `user_unique_id=${userUniqueId},device_platform=web,device_type=,ac=,identity=audience`
  return xb.sign(md5Hex(raw))
}

// ================================================================ x-secsdk-web-signature（secsdk_web_sign.py）

const WEBSIGN_CONST = 'A96D855A08C0A9707F8BEF0D9A527E4E'
const encodeComponent = (v: string) => quote(v, "!*'()")
const unquotePlus = (s: string) => {
  const bytes: number[] = []
  const src = s.replaceAll('+', ' ')
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '%' && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) {
      bytes.push(parseInt(src.slice(i + 1, i + 3), 16))
      i += 2
    } else bytes.push(...Buffer.from(src[i]!, 'utf8'))
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

/** 规范化 query：顺序不变，value 先解码再按 encodeURIComponent 重编码，key 只解码。 */
export function canonicalQuery(query: string): string {
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=')
      const [k, v] = i < 0 ? [pair, ''] : [pair.slice(0, i), pair.slice(i + 1)]
      return `${unquotePlus(k)}=${encodeComponent(unquotePlus(v))}`
    })
    .join('&')
}

/**
 * 带 timestamp + x-secsdk-web-signature 的完整 URL（上游 Params.signed_url / sign_url）。
 * query 是 `k=v` 原样拼接（上游 Params.toString，不编码）。
 */
export function signedUrl(base: string, rawQuery: string, uifid = ''): string {
  const kept = rawQuery.split('&').filter((p) => p && !['timestamp', 'x-secsdk-web-signature'].includes(p.split('=', 1)[0]!))
  let canon = canonicalQuery(kept.join('&'))
  const names = canon.split('&').filter(Boolean).map((p) => p.split('=', 1)[0])
  if (!names.includes('uifid') && uifid) canon = canon ? `${canon}&uifid=${encodeComponent(uifid)}` : `uifid=${encodeComponent(uifid)}`
  const ts = rand.nowSeconds()
  const signed = canon ? `${canon}&timestamp=${ts}` : `timestamp=${ts}`
  let uifidValue = ''
  for (const pair of signed.split('&')) {
    if (pair.startsWith('uifid=')) {
      uifidValue = unquotePlus(pair.slice(6))
      break
    }
  }
  if (!uifidValue && uifid) uifidValue = uifid
  const signature = md5Hex(`${uifidValue}_${ts}_${WEBSIGN_CONST}_${signed}`)
  return `${base}?${signed}&x-secsdk-web-signature=${signature}`
}

// ================================================================ mssdk strData（strdata_pure.py）

const STRDATA_ALPHABET = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe'

export function encodeStrData(plaintext: string, nonce: number): string {
  return b64Custom([0x41, nonce, ...rc4([nonce], Buffer.from(plaintext, 'utf8'))], STRDATA_ALPHABET)
}

// ================================================================ 小生成器（dy_util.py）

const MSTOKEN_BASE = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789='
const SV_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** 随机 msToken（上游 generate_msToken：randint(0, len-1) 取字符）。 */
export function randomMsToken(length = 107): string {
  let s = ''
  for (let i = 0; i < length; i++) s += MSTOKEN_BASE[rand.randint(0, MSTOKEN_BASE.length - 1)]
  return s
}

export function fakeWebid(length = 19): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String(rand.randint(0, 9))
  return s
}

/** s_v_web_id：`verify_<base36 毫秒>_<8>_<4>_4<3>_[89ab]<3>_<12>`。 */
export function svWebId(): string {
  const ts36 = Math.floor(rand.now()).toString(36)
  const r = (k: number) => rand.string(k, SV_CHARSET)
  const groups = [r(8), r(4), '4' + r(3), rand.choice('89ab') + r(3), r(12)]
  return `verify_${ts36}_${groups.join('_')}`
}

// ================================================================ passport（utils/passport.py、login_api.py）

export const PASSPORT_APP_KEY = '163e7ce78d58971a41f5b969996d85c2'

/** 字段加密：UTF-8 字节逐个 XOR 5，非定宽小写十六进制。 */
export function passportEncrypt(text: string): string {
  return [...Buffer.from(text, 'utf8')].map((b) => (b ^ 5).toString(16)).join('')
}

/** passport 的 ts：当天 UTC 12:00 的秒级时间戳。 */
export function sdkTs(nowMs = rand.now()): string {
  const d = new Date(nowMs)
  return String(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12) / 1000)
}

export function aidSign(path: string, ts: string, aid = '6383'): string {
  const prk = createHmac('sha256', ts).update(PASSPORT_APP_KEY).digest('hex')
  const okm = createHmac('sha256', Buffer.from(prk, 'hex')).update(Buffer.from([1])).digest()
  return createHmac('sha256', okm).update(`aid=${aid}&path=${path}&ts=${ts}`).digest('hex')
}

const SIGN_EXCLUDE = new Set(['sign', 'qs', 'msToken', 'a_bogus'])

/** passport 的 sign / qs：按键名排序后取前 10 个参数，连同 body 做 SHA-256。 */
export function passportSign(query: [string, string][], data: [string, string][] = []): { sign: string; qs: string } {
  const signable = new Map(query.filter(([k]) => !SIGN_EXCLUDE.has(k)))
  const keys = [...signable.keys()].sort(pyCompare).slice(0, 10)
  const qstr = keys.map((k) => `${k}=${signable.get(k)}`).join('&')
  const body = new Map(data)
  const bstr = [...body.keys()]
    .sort(pyCompare)
    .map((k) => `${k}=${body.get(k)}`)
    .join('&')
  return { sign: sha256Hex(`${qstr}&${bstr}&app_key=${PASSPORT_APP_KEY}`), qs: passportEncrypt(keys.join(',')) }
}

/** Python 字符串比较（按码点）。 */
export function pyCompare(a: string, b: string): number {
  const x = [...a].map((c) => c.codePointAt(0)!)
  const y = [...b].map((c) => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  return x.length - y.length
}

/** challenge 的 AES-256-CBC：key = SHA256(UA)，IV = key 后 16 字节，Base64URL（保留 =）。 */
export function uaAesUrlsafe(plaintext: Buffer, ua = PROFILE.ua): string {
  const key = createHash('sha256').update(ua, 'utf8').digest()
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(16))
  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64').replaceAll('+', '-').replaceAll('/', '_')
}
