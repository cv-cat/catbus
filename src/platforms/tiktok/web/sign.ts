import { createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, pbkdf2Sync, sign as ecSign } from 'node:crypto'
import { compactJson, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'

/**
 * TikTok Web 的纯算签名（上游 signing/pure.py、aws_v4.py、ticket_guard.py、builder/signer.py）。
 * 与上游逐字节一致：对拍测试用同样的输入比较输出。
 */

const GNARLY_ALPHABET = 'u09tbS3UvgDEe6r-ZVMXzLpsAohTn7mdINQlW412GqBjfYiyk8JORCF5/xKHwacP='
const BOGUS_ALPHABET = 'Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe='
const STD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
const SIGMA = [1196819126, 600974999, 3863347763, 1451689750]
const DYNOSAUR_FIELD_COUNT = 25

type Bytes = Uint8Array

const u32 = (v: number) => v >>> 0
const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0
const utf8 = (s: string | Bytes): Bytes => (typeof s === 'string' ? Buffer.from(s, 'utf8') : s)

/** `secrets.randbits(k)`（k ≤ 32），对拍时与 Python 侧的替换公式一致。 */
export function randbits(k: number): number {
  return Math.floor(rand.random() * 2 ** k)
}

function quarter(s: number[], a: number, b: number, c: number, d: number): void {
  s[a] = u32(s[a]! + s[b]!)
  s[d] = rotl(s[d]! ^ s[a]!, 16)
  s[c] = u32(s[c]! + s[d]!)
  s[b] = rotl(s[b]! ^ s[c]!, 12)
  s[a] = u32(s[a]! + s[b]!)
  s[d] = rotl(s[d]! ^ s[a]!, 8)
  s[c] = u32(s[c]! + s[d]!)
  s[b] = rotl(s[b]! ^ s[c]!, 7)
}

/** WebMssdk 的一个块：对角轮的调度不是标准 ChaCha。 */
function gnarlyBlock(initial: number[], rounds: number): number[] {
  const s = [...initial]
  let count = 0
  while (count < rounds) {
    quarter(s, 0, 4, 8, 12)
    quarter(s, 1, 5, 9, 13)
    quarter(s, 2, 6, 10, 14)
    quarter(s, 3, 7, 11, 15)
    count++
    if (count >= rounds) break
    quarter(s, 0, 5, 10, 15)
    quarter(s, 1, 6, 11, 12)
    quarter(s, 2, 7, 12, 13)
    quarter(s, 3, 4, 13, 14)
    count++
  }
  return s.map((v, i) => u32(v + initial[i]!))
}

function gnarlyXor(data: Bytes, keyWords: number[], rounds: number): Bytes {
  if (keyWords.length !== 12) throw new Error('X-Gnarly needs 12 key words')
  const state = [...SIGMA, ...keyWords.map(u32)]
  const out = Uint8Array.from(data)
  for (let offset = 0; offset < out.length; offset += 64) {
    const stream = gnarlyBlock(state, rounds)
    const limit = Math.min(64, out.length - offset)
    for (let i = 0; i < limit; i++) out[offset + i]! ^= (stream[i >> 2]! >>> (8 * (i % 4))) & 0xff
    state[12] = u32(state[12]! + 1)
  }
  return out
}

function customB64(data: Bytes, alphabet: string): string {
  let out = ''
  for (let o = 0; o < data.length; o += 3) {
    const a = data[o]!
    const b = o + 1 < data.length ? data[o + 1]! : 0
    const c = o + 2 < data.length ? data[o + 2]! : 0
    out += alphabet[a >> 2]
    out += alphabet[((a & 3) << 4) | (b >> 4)]
    out += o + 1 < data.length ? alphabet[((b & 15) << 2) | (c >> 6)] : alphabet[64]
    out += o + 2 < data.length ? alphabet[c & 63] : alphabet[64]
  }
  return out
}

export function md5Hex(value: string | Bytes): string {
  return createHash('md5').update(utf8(value)).digest('hex')
}

/** 5.3.x 的 FNV 式 query / UA 绑定。 */
export function hashUrlState(value: string): number {
  let state = 2166136260
  for (const byte of utf8(value)) {
    const mixed = u32(Math.imul(state ^ byte, 16777619))
    state = u32(mixed + u32(mixed * 32))
  }
  return state
}

function encodeEnvBytes(value: string, variant: 'a' | 'b'): Bytes {
  const [xorBase, addBase, preXor, rotate, postAdd] = variant === 'a' ? [103, 1, null, 2, 1] : [102, 0, 165, 1, 0]
  const chars = Array.from(String(value))
  const length = chars.length
  const size = Math.max(length + 2, 6)
  const out = new Uint8Array(size)
  chars.forEach((ch, i) => {
    let v = u32(ch.codePointAt(0)! ^ (xorBase + i))
    v = u32(v + addBase + (170 & i)) % 256
    if (preXor != null) v ^= preXor
    v = ((v << rotate) | (v >> (8 - rotate))) & 0xff
    v = ((v ^ 187) + postAdd) & 0xff
    out[i] = v
  })
  for (let i = length; i < size - 2; i++) out[i] = (221 + i) & 0xff
  out[size - 2] = 0
  out[size - 1] = length & 0xff
  return out
}

function rawU32(value: number): Bytes {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(u32(value))
  return b
}

interface DynosaurInput {
  ts: number
  randB: number
  query: string
  userAgent: string
  envcode: number
  ubcode: number
  canvas: number
  page: string
  payloadVersion: string
  sdkVersion: string
  imageRatio: number
  textRatio: number
  runtimeField8: string
  runtimeField18: string
  runtimeField19: string
}

function dynosaurPayload(p: DynosaurInput): Bytes {
  const mix = u32(((((p.ts >>> 16) & 0xffff) ^ ((p.randB >>> 16) & 0xffff)) ^ ((p.ts & 0xffff) ^ (p.randB & 0xffff))) | (p.envcode << 16))
  const a = (v: string) => encodeEnvBytes(v, 'a')
  const fields: Bytes[] = [
    a('0'),
    encodeEnvBytes('1', 'b'),
    encodeEnvBytes('1', 'b'),
    a('0'),
    a(String(mix)),
    a(String(p.imageRatio)),
    a(String(p.envcode)),
    a(String(p.ts)),
    a(p.runtimeField8),
    a('0'),
    a(p.payloadVersion),
    rawU32(hashUrlState('')),
    a(String(p.canvas)),
    a('0'),
    rawU32(hashUrlState(p.query)),
    a(String(p.textRatio)),
    rawU32(hashUrlState(p.userAgent)),
    a(p.sdkVersion),
    a(p.runtimeField18),
    a(p.runtimeField19),
    a(String(p.randB)),
    a(p.page),
    a(String(p.ubcode)),
    a('0'),
    rawU32(hashUrlState('')),
  ]
  let checksum = 0
  for (const f of fields) checksum ^= f[1]!
  fields[0] = encodeEnvBytes(String(checksum), 'b')
  const out: number[] = []
  fields.forEach((f, i) => {
    if (f.length > 255) throw new Error('bytes must be in range(0, 256)')
    out.push(0x20 + i, 0, f.length, ...f)
  })
  if (fields.length !== DYNOSAUR_FIELD_COUNT) throw new Error('unexpected Dynosaur field count')
  return Uint8Array.from(out)
}

type FieldValue = number | string

function intBytes(value: number, width: number): number[] {
  const out: number[] = []
  for (let i = width - 1; i >= 0; i--) out.push(Math.floor(value / 256 ** i) % 256)
  return out
}

function encodeField(key: number, value: FieldValue, width: (v: number) => number): number[] {
  if (typeof value === 'number' && (value < 0 || value > 0xffffffff)) throw new Error('signature integer is outside uint32')
  const encoded = typeof value === 'number' ? intBytes(value, width(value)) : [...utf8(value)]
  if (encoded.length > 0xffff) throw new Error('signature field is too long')
  return [key & 0xff, (encoded.length >> 8) & 0xff, encoded.length & 0xff, ...encoded]
}

function xorHeader(fields: Map<number, FieldValue>): number {
  let x = 0
  for (const [k, v] of fields) if (k !== 0 && typeof v === 'number') x = u32(x ^ v)
  return x
}

/** project-post 代：整数小于 255*255 用 2 字节，否则 4 字节；键按数字排序。 */
function legacyPayload(input: Map<number, FieldValue>): Bytes {
  const values = new Map(input)
  values.set(0, xorHeader(values))
  const out: number[] = [values.size]
  for (const key of [...values.keys()].sort((a, b) => a - b)) out.push(...encodeField(key, values.get(key)!, (v) => (v < 255 * 255 ? 2 : 4)))
  return Uint8Array.from(out)
}

const CURRENT_FIELD_ORDER = [10, 15, 3, 5, 7, 8, 16, 9, 0, 4, 11, 13, 6, 14, 12, 2, 1]

/** 5.3.x 代：整数不超过 uint16 用 2 字节；按浏览器观测到的插入顺序。 */
function currentPayload(input: Map<number, FieldValue>): Bytes {
  const values = new Map(input)
  values.set(0, xorHeader(values))
  const order = CURRENT_FIELD_ORDER.filter((k) => values.has(k))
  if (order.length !== values.size) throw new Error('unknown current X-Gnarly fields')
  const out: number[] = [order.length]
  for (const key of order) out.push(...encodeField(key, values.get(key)!, (v) => (v <= 0xffff ? 2 : 4)))
  return Uint8Array.from(out)
}

function newKey(): number[] {
  return Array.from({ length: 12 }, () => randbits(32))
}

/** 明文加密后插入 12 个密钥字，再做自定义 base64（Gnarly / Dynosaur 共用）。 */
function seal(plaintext: Bytes, keyWords?: number[]): string {
  const words = (keyWords ?? newKey()).map(u32)
  const rounds = (words.reduce((s, w) => s + (w & 15), 0) & 15) + 5
  const encrypted = gnarlyXor(plaintext, words, rounds)
  const keyBytes = Buffer.alloc(48)
  words.forEach((w, i) => keyBytes.writeUInt32LE(w, i * 4))
  let insertion = 0
  for (const v of keyBytes) insertion = (insertion + v) % (encrypted.length + 1)
  for (const v of encrypted) insertion = (insertion + v) % (encrypted.length + 1)
  const raw = Buffer.concat([Buffer.from([75]), encrypted.subarray(0, insertion), keyBytes, encrypted.subarray(insertion)])
  return customB64(raw, GNARLY_ALPHABET)
}

/** Creator Studio project/post 的 10 字段 X-Gnarly。 */
export function encodeGnarlyProject(
  query: string,
  body: string | Bytes,
  userAgent: string,
  o: { ubcode?: number; canvas?: number; timestamp?: number; timestampMs?: number; sdkVersion?: string; keyWords?: number[] } = {},
): string {
  const fields = new Map<number, FieldValue>([
    [1, 1],
    [2, o.ubcode ?? 136],
    [3, md5Hex(query)],
    [4, md5Hex(body)],
    [5, md5Hex(userAgent)],
    [6, o.timestamp ?? rand.nowSeconds()],
    [7, o.canvas ?? 2894886431],
    [8, (o.timestampMs ?? rand.now()) % 0x80000000],
    [9, o.sdkVersion ?? '5.1.0'],
  ])
  return seal(legacyPayload(fields), o.keyWords)
}

export interface GnarlyCurrentOptions {
  envcode?: number
  ubcode?: number
  canvas?: number
  timestamp?: number
  timestampMs?: number
  payloadVersion?: string
  sdkVersion?: string
  totalRequests?: number
  companionRequests?: number
  randomLow16?: number
  random32?: number
  randomTail?: number
  keyWords?: number[]
}

/** 当前 Web API 的 17 字段 X-Gnarly。 */
export function encodeGnarlyCurrent(query: string, body: string | Bytes, userAgent: string, o: GnarlyCurrentOptions = {}): string {
  const timestamp = o.timestamp ?? rand.nowSeconds()
  const timestampMs = o.timestampMs ?? rand.now()
  const low16 = o.randomLow16 ?? randbits(16)
  const randomA = o.random32 ?? randbits(32)
  const randomB = o.randomTail ?? randbits(32)
  const envcode = o.envcode ?? 65
  if (low16 < 0 || low16 > 0xffff) throw new Error('random_low16 is outside uint16')
  const fields = new Map<number, FieldValue>([
    [1, envcode],
    [2, o.ubcode ?? 14],
    [3, md5Hex(query)],
    [4, md5Hex(body)],
    [5, md5Hex(userAgent)],
    [6, timestamp],
    [7, o.canvas ?? 2894886431],
    [8, timestampMs % 0x80000000],
    [9, o.payloadVersion ?? '5.3.2'],
    [10, o.sdkVersion ?? '1.0.0.417'],
    [11, 1],
    [12, o.totalRequests ?? 2],
    [13, o.companionRequests ?? 3],
    [14, u32((envcode << 16) | low16)],
    [15, randomA],
    [16, randomB],
  ])
  return seal(currentPayload(fields), o.keyWords)
}

export interface DynosaurOptions {
  page?: string
  envcode?: number
  ubcode?: number
  canvas?: number
  timestamp?: number
  randB?: number
  payloadVersion?: string
  sdkVersion?: string
  imageRatio?: number
  textRatio?: number
  runtimeField8?: string
  runtimeField18?: string
  runtimeField19?: string
  keyWords?: number[]
}

/** 当前 25 字段的 X-Dynosaur。 */
export function encodeDynosaurCurrent(query: string, userAgent: string, o: DynosaurOptions = {}): string {
  const plaintext = dynosaurPayload({
    ts: o.timestamp ?? rand.nowSeconds(),
    randB: o.randB ?? rand.now() % 0x80000000,
    query,
    userAgent,
    envcode: o.envcode ?? 65,
    ubcode: o.ubcode ?? 14,
    canvas: o.canvas ?? 2894886431,
    page: o.page ?? '',
    payloadVersion: o.payloadVersion ?? '5.3.2',
    sdkVersion: o.sdkVersion ?? '1.0.0.417',
    imageRatio: o.imageRatio ?? 1,
    textRatio: o.textRatio ?? 2,
    runtimeField8: o.runtimeField8 ?? '0',
    runtimeField18: o.runtimeField18 ?? '0',
    runtimeField19: o.runtimeField19 ?? '0',
  })
  return seal(plaintext, o.keyWords)
}

function rc4(data: Bytes, key: number[]): Bytes {
  const box = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + box[i]! + key[i % key.length]!) % 256
    ;[box[i], box[j]] = [box[j]!, box[i]!]
  }
  const out = new Uint8Array(data.length)
  let a = 0
  j = 0
  data.forEach((v, k) => {
    a = (a + 1) % 256
    j = (j + box[a]!) % 256
    ;[box[a], box[j]] = [box[j]!, box[a]!]
    out[k] = v ^ box[(box[a]! + box[j]!) % 256]!
  })
  return out
}

function doubleMd5(value: string | Bytes): string {
  return createHash('md5').update(createHash('md5').update(utf8(value)).digest()).digest('hex')
}

/** 28 位 X-Bogus（Creator project/post 与 Shop 用）。 */
export function encodeXBogus(query: string, userAgent: string, body: string | Bytes = '', o: { timestamp?: number; ubcode?: number; magic?: number } = {}): string {
  const timestamp = o.timestamp ?? rand.nowSeconds()
  const ubcode = o.ubcode ?? 14
  const magic = o.magic ?? 536919696
  const md5p = Buffer.from(doubleMd5(query), 'hex')
  const md5d = Buffer.from(doubleMd5(body), 'hex')
  const md5u = Buffer.from(md5Hex(customB64(rc4(utf8(userAgent), [0, 1, ubcode]), STD_ALPHABET)), 'hex')
  const salt: number[] = [timestamp, magic, 64, 0, 1, ubcode, md5p[14]!, md5p[15]!, md5d[14]!, md5d[15]!, md5u[14]!, md5u[15]!]
  for (const shift of [24, 16, 8, 0]) salt.push(Math.floor(timestamp / 2 ** shift) & 0xff)
  for (const shift of [24, 16, 8, 0]) salt.push(Math.floor(magic / 2 ** shift) & 0xff)
  let checksum = 64
  for (const v of salt.slice(3)) checksum ^= v
  salt.push(checksum, 255)
  const order = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 4, 6, 8, 10, 12, 14, 16, 18, 20]
  const filtered = order.map((i) => salt[i - 1]!)
  const scramble = [0, 10, 1, 11, 2, 12, 3, 13, 4, 14, 5, 15, 6, 16, 7, 17, 8, 18, 9]
  const encrypted = rc4(Uint8Array.from(scramble.map((i) => filtered[i]!)), [255])
  return customB64(Uint8Array.from([2, 255, ...encrypted]), BOGUS_ALPHABET)
}

// ================================================================ 请求签名调度（builder/signer.py）

/** 该路径需要的签名字段；有些浏览器请求本来就不签名。 */
export function requiredSignatureKeys(url: string): string[] {
  const path = new URL(url).pathname
  const unsigned = [
    '/api/feedback/v1/newest_reply/',
    '/tiktok/v1/screen_time/upload/',
    '/tiktok/v1/screen_time/list/',
    '/api/v1/web/project/get/ab/',
    '/api/v1/user/profile/upload/',
    '/tiktok/v1/creator/publish_setting/',
    '/api/v1/media/get/openid/',
    '/api/v1/web-cookie-privacy/config',
    '/tiktok/popup/dispatch/v1',
    '/tiktok/popup/display/v1/',
    '/tiktok/ppf/api/eligibility/v2',
    '/api/compliance/settings/',
    '/tiktok/v1/compliance/guadig/settings/',
    '/api/share/settings/',
    '/api/im/spotlight/relation',
    '/api/privacy/user/effected_count/v1',
    '/aweme/v1/report/inbox/notice',
    '/tiktok/v1/community_notes/intake/check',
    '/tiktok/popup/callback/v1',
    '/tiktok/v1/csp/pa_prompt',
    '/tiktok/music/tt_to_dsp/platform/list/v1',
  ]
  if (unsigned.some((p) => path.includes(p))) return []
  if (PROJECT_PATHS.some((p) => path.includes(p))) return ['msToken', 'X-Bogus', 'X-Gnarly']
  return ['X-Dynosaur', 'msToken', 'X-Bogus', 'X-Gnarly']
}

const PROJECT_PATHS = ['/tiktok/web/project/post/v1/', '/tiktok/web/project/post_retry/v1/', '/api/v1/video/upload/auth/', '/tiktok/creator/manage/item_list/v1/']

/** 浏览器运行时的可选输入（上游 browser_metrics），缺省时按上游规则本地推导。 */
export type Metrics = Record<string, unknown>

export interface SignInput {
  url: string
  method: string
  body: string | Bytes | null
  userAgent: string
  referer: string
  metrics?: Metrics
  signingTimestamp?: number
  expectedLengths?: Record<string, number>
}

export class SignerError extends Error {}

function metricNumber(m: Metrics, key: string, fallback: number): number {
  return m[key] == null ? fallback : Number(m[key])
}

function metricString(m: Metrics, key: string, fallback: string): string {
  return m[key] == null ? fallback : String(m[key])
}

function checkLengths(values: Record<string, string>, expected: Record<string, number> | undefined, what: string): void {
  if (!expected) return
  const bad = Object.entries(expected).filter(([k, n]) => values[k]?.length !== Number(n))
  if (bad.length) throw new SignerError(`${what} 签名长度不匹配: ${bad.map(([k]) => k).join(', ')}`)
}

/** 按路径选择签名代：Creator project 系列走 X-Bogus + 10 字段 Gnarly，其余走 Dynosaur + 17 字段 Gnarly。 */
export function signRequest(input: SignInput): Record<string, string> {
  const body = input.body == null ? null : typeof input.body === 'string' ? input.body : bytesOrText(input.body)
  if (['POST', 'PUT', 'PATCH'].includes(input.method.toUpperCase()) && body == null) throw new SignerError('签名需要完整 body，不能对有 body 的方法省略 body')
  const values = PROJECT_PATHS.some((p) => input.url.includes(p)) ? signProject(input, body ?? '') : signLegacy(input, body)
  const required = requiredSignatureKeys(input.url)
  const missing = required.filter((k) => !values[k])
  if (missing.length) throw new SignerError(`纯计算后缺少字段: ${missing.join(', ')}`)
  return Object.fromEntries(required.map((k) => [k, values[k]!]))
}

/** 能按 UTF-8 解码的字节按字符串签名（与上游 body.decode('utf-8') 一致），gzip 等二进制保持字节。 */
function bytesOrText(b: Bytes): string | Bytes {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return b
  }
}

function signLegacy(input: SignInput, body: string | Bytes | null): Record<string, string> {
  const query = splitQuery(input.url)
  const parts = query ? query.split('&') : []
  const tokens = parts.filter((p) => p.startsWith('msToken='))
  const tokenPart = tokens[tokens.length - 1]
  const token = tokenPart ? tokenPart.slice(tokenPart.indexOf('=') + 1) : ''
  if (!token) throw new SignerError('legacy Web API unsigned URL 缺少浏览器 msToken')
  const base = parts.filter((p) => !['X-Dynosaur=', 'X-Bogus=', 'X-Gnarly=', 'msToken='].some((x) => p.startsWith(x))).join('&')
  const ua = input.userAgent
  if (!ua) throw new SignerError('legacy Web API 纯计算需要完整 user-agent')
  const m = input.metrics ?? {}
  const nowMs = metricNumber(m, 'timestamp_ms', rand.now())
  const timestamp = input.signingTimestamp || Math.floor(nowMs / 1000)
  const randB = m.rand_b != null ? Number(m.rand_b) : 100_000_000 + (hashUrlState(base) % 900_000_000)
  let page = String(m.dynosaur_page ?? m.page ?? '')
  if (!page) {
    const ref = urlsplit(input.referer || 'https://www.tiktok.com/')
    page = ref.netloc + (ref.path || '/')
  }
  let field8 = m.runtime_field8 ?? m.dynosaur_field8
  if (field8 == null) {
    const digest = createHash('sha256').update(`${base}|${ua}`, 'utf8').digest()
    field8 = String(1_000_000_000 + (digest.readUInt32BE(0) % 3_000_000_000))
  }
  const field18 = String(m.runtime_field18 ?? m.dynosaur_field18 ?? '1.0.0.2870')
  const field19 = String(m.runtime_field19 ?? m.dynosaur_field19 ?? md5Hex(`${ua}|${page}`))
  const envcode = metricNumber(m, 'envcode', 65)
  const ubcode = metricNumber(m, 'ubcode', 14)
  const canvas = metricNumber(m, 'canvas', 2894886431)
  const payloadVersion = metricString(m, 'payload_version', '5.3.2')
  const sdkVersion = metricString(m, 'sdk_version', '1.0.0.417')
  const dynosaur = encodeDynosaurCurrent(base, ua, {
    page,
    envcode,
    ubcode,
    canvas,
    timestamp,
    randB,
    payloadVersion,
    sdkVersion,
    imageRatio: metricNumber(m, 'image_ratio', 1),
    textRatio: metricNumber(m, 'text_ratio', 2),
    runtimeField8: String(field8),
    runtimeField18: field18,
    runtimeField19: field19,
  })
  const signedQuery = `${base}&X-Dynosaur=${dynosaur}&${tokenPart}`
  const gnarly = encodeGnarlyCurrent(signedQuery, body ?? '', ua, {
    envcode,
    ubcode,
    canvas,
    timestamp,
    timestampMs: nowMs,
    payloadVersion,
    sdkVersion,
    totalRequests: metricNumber(m, 'total_requests', 2),
    companionRequests: metricNumber(m, 'companion_requests', 3),
    randomLow16: m.random_low16 == null ? undefined : Number(m.random_low16),
    random32: m.random32 == null ? undefined : Number(m.random32),
    randomTail: m.random_tail == null ? undefined : Number(m.random_tail),
  })
  // 当前 Web API 的 X-Bogus 是字面量 1（端点约定，不是占位）
  const values = { 'X-Dynosaur': dynosaur, msToken: token, 'X-Bogus': '1', 'X-Gnarly': gnarly }
  checkLengths(values, input.expectedLengths, '纯 legacy')
  return values
}

function signProject(input: SignInput, body: string | Bytes): Record<string, string> {
  const query = splitQuery(input.url)
  const token = query
    .split('&')
    .find((p) => p.startsWith('msToken='))
    ?.split('=')
    .slice(1)
    .join('=')
  if (!token) throw new SignerError('project/post unsigned URL 缺少浏览器 msToken')
  if (!input.userAgent) throw new SignerError('project/post 纯计算需要完整 user-agent')
  const canvas = metricNumber(input.metrics ?? {}, 'canvas', 2894886431)
  const values = {
    msToken: token,
    'X-Bogus': encodeXBogus(query, input.userAgent, body, { timestamp: input.signingTimestamp, ubcode: 136, magic: canvas }),
    'X-Gnarly': encodeGnarlyProject(query, body, input.userAgent, { timestamp: input.signingTimestamp, ubcode: 136, canvas }),
  }
  checkLengths(values, input.expectedLengths, '纯 project/post')
  return values
}

/** Python 的 `urllib.parse.urlsplit`：各部分保持原样，不解码、不规范化。 */
export function urlsplit(url: string): { scheme: string; netloc: string; path: string; query: string; fragment: string } {
  const m = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(url)!
  return { scheme: m[1] ?? '', netloc: m[2] ?? '', path: m[3] ?? '', query: m[4] ?? '', fragment: m[5] ?? '' }
}

function splitQuery(url: string): string {
  return urlsplit(url).query
}

// ================================================================ AWS SigV4（signing/aws_v4.py）

export function canonicalAwsQuery(pairs: [string, string][]): string {
  const encoded = pairs.map(([k, v]) => [quote(k, '-_.~'), quote(v, '-_.~')] as const)
  encoded.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return encoded.map(([k, v]) => `${k}=${v}`).join('&')
}

const sha256Hex = (b: Bytes | string) => createHash('sha256').update(b).digest('hex')
const hmac = (key: Bytes | string, value: string) => createHmac('sha256', key).update(value, 'utf8').digest()

export function amzDate(ms = rand.now()): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

export function signAwsV4(o: {
  method: string
  path: string
  query: [string, string][]
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  body?: Bytes | string
  amzDate?: string
  region?: string
  service?: string
}): Record<string, string> {
  if (!o.accessKeyId || !o.secretAccessKey || !o.sessionToken) throw new Error('AWS V4 缺少 access key、secret key 或 session token')
  const payload = utf8(o.body ?? new Uint8Array())
  const date = o.amzDate ?? amzDate()
  const region = o.region ?? 'ap-singapore-1'
  const service = o.service ?? 'vod'
  const payloadHash = sha256Hex(payload)
  const signed = ['x-amz-date', 'x-amz-security-token']
  let canonicalHeaders = `x-amz-date:${date}\nx-amz-security-token:${o.sessionToken}\n`
  if (payload.length) {
    signed.unshift('x-amz-content-sha256')
    canonicalHeaders = `x-amz-content-sha256:${payloadHash}\n` + canonicalHeaders
  }
  const signedHeaders = signed.join(';')
  const canonicalRequest = [o.method.toUpperCase(), quote(o.path, '/-_.~'), canonicalAwsQuery(o.query), canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date.slice(0, 8)}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n')
  let key = hmac('AWS4' + o.secretAccessKey, date.slice(0, 8))
  key = hmac(key, region)
  key = hmac(key, service)
  key = hmac(key, 'aws4_request')
  const signature = createHmac('sha256', key).update(stringToSign, 'utf8').digest('hex')
  const headers: Record<string, string> = {
    authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-security-token': o.sessionToken,
    'x-amz-date': date,
  }
  if (payload.length) headers['x-amz-content-sha256'] = payloadHash
  return headers
}

// ================================================================ tt-ticket-guard（signing/ticket_guard.py）

/** 解密浏览器 security-sdk 存的 encrypt_ticket（AES-GCM，PBKDF2 派生密钥）。 */
export function decryptEncryptTicket(encryptTicket: string): string {
  const data = Buffer.from(String(encryptTicket), 'base64')
  if (data.length <= 12 + 16) throw new Error('encrypt_ticket 长度不足，无法解密')
  const key = pbkdf2Sync('tt-ticket-guard-iv', 'secure-salt', 1000, 16, 'sha256')
  const decipher = createDecipheriv('aes-128-gcm', key, data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(data.length - 16))
  const ticket = Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString('utf8')
  if (!ticket) throw new Error('encrypt_ticket 解密为空')
  return ticket
}

/** Chrome 的 65 字节未压缩 P-256 公钥，base64。 */
export function publicKeyBase64(privateKeyPem: string): string {
  const jwk = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' })
  if (jwk.kty !== 'EC' || !jwk.x || !jwk.y) throw new Error('ticket guard private key 不是 EC 私钥')
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64')
}

export function signTicketPath(privateKeyPem: string, ticket: string, path: string, timestamp: number): string {
  const data = `ticket=${ticket}&path=${path}&timestamp=${Math.trunc(timestamp)}`
  return ecSign('sha256', Buffer.from(data, 'utf8'), { key: createPrivateKey(privateKeyPem), dsaEncoding: 'der' }).toString('base64')
}

export function encodeClientData(o: { tsSign: string; reqSign: string; timestamp: number; reqContent?: string }): string {
  const payload = { ts_sign: o.tsSign, req_content: o.reqContent ?? 'ticket,path,timestamp', req_sign: o.reqSign, timestamp: Math.trunc(o.timestamp) }
  return Buffer.from(compactJson(payload), 'utf8').toString('base64')
}

export interface TicketGuardState {
  privateKey: string
  encryptTicket: string
  tsSign: string
  version?: string
  iterationVersion?: string
}

/** 五个 tt-ticket-guard 请求头，每次用浏览器私钥现签。 */
export function ticketGuardHeaders(state: TicketGuardState, path: string, timestamp = rand.nowSeconds()): Record<string, string> {
  const ticket = decryptEncryptTicket(state.encryptTicket)
  const reqSign = signTicketPath(state.privateKey, ticket, path, timestamp)
  return {
    'tt-ticket-guard-public-key': publicKeyBase64(state.privateKey),
    'tt-ticket-guard-web-version': '1',
    'tt-ticket-guard-version': String(state.version || '2'),
    'tt-ticket-guard-iteration-version': String(state.iterationVersion || '0'),
    'tt-ticket-guard-client-data': encodeClientData({ tsSign: state.tsSign, reqSign, timestamp }),
  }
}

/** client-data 里的时间戳（project/post 用它作签名时间）。 */
export function ticketTimestamp(clientData: string): number {
  const payload = JSON.parse(Buffer.from(clientData.trim(), 'base64url').toString('utf8'))
  const value = Number(payload.timestamp)
  if (!(value > 0)) throw new Error('ticket-guard-client-data timestamp 无效')
  return Math.trunc(value)
}
