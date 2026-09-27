import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import * as rand from '../../../core/rand.js'

/**
 * 快手的纯算签名（上游 utils/sign/jsval.py、falcon_pure.py、sig3_pure.py、kww_pure.py、webweapon_boot.py）。
 *
 * - `__NS_hxfalcon`（sig4）：www 白名单接口、直播站、登录站、cp 少量接口，配套 `caver=2`；
 * - `__NS_sig3`：cp 创作者中心 `/rest/cp`、`rest/v2/creator`、`/rest/kd`；
 * - webweapon 的 AES（`st$1` 与 gdfp `/s/w/c` 的加解密）。
 *
 * 签名器是有状态的（启动时间、调用计数都进签名），对应浏览器的一个页面会话：一条 catbus 命令一个实例。
 */

// ================================================================ JS 值语义（jsval.py）

/** ECMAScript ToString（`"" + value`）。 */
export function jsToString(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map((v) => (v == null ? '' : jsToString(v))).join(',')
  return '[object Object]'
}

/** JSON.stringify（无缩进）。JS 对象的键序本身就是 ECMAScript 的枚举序，与 jsval 的移植一致。 */
export function jsJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

/** axios 的 query 编码：encodeURIComponent 后把 `: $ , [ ]` 还原、`%20` 换成 `+`。 */
export function axiosEncode(value: unknown): string {
  return encodeURIComponent(jsToString(value))
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']')
    .replace(/%20/g, '+')
}

/** Params.to_query_string：按插入顺序，axios 口径编码。 */
export function axiosQuery(params: [string, unknown][]): string {
  return params.map(([k, v]) => `${axiosEncode(k)}=${axiosEncode(v)}`).join('&')
}

// ================================================================ sig4：__NS_hxfalcon（falcon_pure.py）

export const CAVER = '2'

/** www 侧 sig4 白名单。 */
const SIG4_WHITELIST = new Set([
  '/rest/v/profile/get',
  '/rest/v/profile/user/v2',
  '/rest/v/search/user',
  '/rest/v/search/feed',
  '/rest/v/profile/feed',
  '/rest/v/feed/hot',
  '/rest/v/feed/liked',
  '/rest/v/collect/list',
  '/rest/v/profile/private/list',
])

/** 直播站 sig4 名单：签名输入用网关背后的 realUrl（/rest/k/*），发出去的仍是 /live_api/*。 */
export const LIVE_URL_MAP: Record<string, string> = {
  '/live_api/baseuser/userinfo/sensitive': '/rest/k/user/info/sensitive',
  '/live_api/search/author': '/rest/k/live/search/user',
  '/live_api/comment/list': '/rest/k/photo/comment/list',
  '/live_api/search/overview': '/rest/k/live/search',
  '/live_api/search/category': '/rest/k/live/game/search/category',
  '/live_api/search/liveStream': '/rest/k/live/game/search/liveStream',
  '/live_api/profile/public': '/rest/k/feed/profile',
  '/live_api/profile/private': '/rest/k/feed/profile',
  '/live_api/profile/liked': '/rest/k/feed/liked',
  '/live_api/web/header/searchHotUserListQuery': '/rest/k/live/search/hot',
  '/live_api/web/header/searchSuggestQuery': '/rest/k/live/search/suggest',
  '/live_api/liveroom/websocketinfo': '/rest/k/live/websocket/info',
  '/live_api/profileInterestMask/list': '/rest/k/pc-live/author/category',
  '/live_api/profile/feedbyid': '/rest/k/photo',
  '/live_api/profile/likestatus': '/rest/k/photo',
  '/live_api/playback/list': '/rest/k/playback/product/list',
  '/live_api/baseuser/author/checkfollow': '/rest/k/user/info',
  '/live_api/baseuser/userinfo/byid': '/rest/k/user/info',
  '/live_api/baseuser/userLogin': '/rest/k/user/info',
  '/live_api/follow/all': '/rest/k/live/relation/follower',
  '/live_api/gameboard/list': '/rest/k/pc-live/live/getByGame',
  '/live_api/home/more': '/rest/k/pc-live/labels/switch',
  '/live_api/playback/detail': '/rest/k/playback/product/play',
  '/live_api/liveroom/like': '/rest/k/live/like',
  '/live_api/liveroom/status': '/rest/wd/live/liveStream/status',
  '/live_api/non-gameboard/list': '/rest/k/pc-live/live/synthesize',
  '/live_api/playback/download': '/rest/k/material/download',
  '/live_api/profile/interestlist': '/rest/k/pc-live/author/profile/reco',
}

/** 登录站（id.kuaishou.com）的 sig4 名单，form body 参与签名。 */
const LOGIN_SIG4 = new Set([
  '/rest/c/infra/ks/qr/start',
  '/rest/c/infra/ks/new/qr/start',
  '/rest/c/infra/ks/qr/scanResult',
  '/rest/c/infra/ks/new/qr/scanResult',
  '/rest/c/infra/ks/qr/acceptResult',
  '/rest/c/infra/ks/new/qr/acceptResult',
  '/pass/bid/web/sns/login/code',
  '/pass/bid/web/sns/quickLoginByKsAuth',
  '/pass/kuaishou/sms/requestMobileCode',
  '/pass/kuaishou/login/mobileCode',
  '/pass/kuaishou/login/qr/callback',
])

/** cp 侧改走 sig4 的接口（子串匹配）。 */
const CP_SIG4 = [
  'rest/cp/works/v2/common/pc/nearby',
  'rest/cp/works/v2/video/pc/edit/info',
  'rest/cp/works/v2/common/pc/ip2poi',
  '/rest/zt/location/wi/poi/search',
  '/rest/cp/works/v2/video/pc/submit',
]

export const CP_PROJECT_INFO = { appKey: 'mMovf2dVDF', debug: false, sampling: 1 }

export const needSign = (path: string) => SIG4_WHITELIST.has(path)
export const liveNeedSign = (url: string) => url.split('?')[0]! in LIVE_URL_MAP
export const liveSignUrl = (url: string) => LIVE_URL_MAP[url.split('?')[0]!] ?? url
export const loginNeedSign = (url: string) => LOGIN_SIG4.has(url.split('?')[0]!)
export const cpNeedSign = (url: string) => CP_SIG4.some((m) => url.split('?')[0]!.includes(m))

const SIG3_MARKERS = ['/rest/cp', 'rest/v2/creator', '/rest/kd']
export const needSig3 = (url: string) => SIG3_MARKERS.some((m) => url.includes(m)) && !cpNeedSign(url)

export type Obj = Record<string, unknown>

export interface SignInput {
  url: string
  query: Obj
  form?: Obj | unknown
  requestBody?: Obj | unknown
  projectInfo?: Obj
}

/**
 * 送入引擎的 signInput（build_sign_input）。www / cp 没有 body 时省略 form / requestBody 两个键；
 * 直播与登录站恒带空对象。
 */
export function buildSignInput(
  path: string,
  query: Obj,
  body: unknown,
  contentType = 'application/json',
  options: { projectInfo?: Obj; omitEmptyBody?: boolean } = {},
): SignInput {
  const ct = contentType.toLowerCase()
  const isForm = ct.includes('application/x-www-form-urlencoded')
  const isJson = ct.includes('application/json')
  let bodyObj = body
  if (typeof body === 'string' && body) {
    try {
      bodyObj = JSON.parse(body)
    } catch {
      bodyObj = body
    }
  }
  const truthy = (v: unknown) => v != null && v !== '' && !(typeof v === 'object' && Object.keys(v as object).length === 0)
  const input: SignInput = { url: path, query: { caver: CAVER, ...query } }
  const formValue = isForm && truthy(bodyObj) ? bodyObj : {}
  const bodyValue = isJson && truthy(bodyObj) ? bodyObj : {}
  if (!(options.omitEmptyBody && !truthy(formValue))) input.form = formValue
  if (!(options.omitEmptyBody && !truthy(bodyValue))) input.requestBody = bodyValue
  if (options.projectInfo) input.projectInfo = { ...options.projectInfo }
  return input
}

/** jmpOnw_ms：路径 + 排序后的参数 + JSON body。键名含 `__NS` 的参数跳过。 */
export function serializeSignInput(data: SignInput): string {
  let path = data.url ?? ''
  if (/^http(s)?:\/\/([\w-]+\.)+[\w-]+/.test(path)) {
    const rest = path.split('//')[1]!
    path = rest.includes('/') ? rest.slice(rest.indexOf('/')) : rest
  }
  path = path.split('?')[0]!
  const merged = new Map<string, unknown>()
  for (const [k, v] of Object.entries((data.query ?? {}) as Obj)) merged.set(String(k), v)
  for (const [k, v] of Object.entries((data.form ?? {}) as Obj)) merged.set(String(k), v)
  const items: string[] = []
  for (const [k, v] of merged) {
    if (k.includes('__NS')) continue
    items.push(v == null ? `${k}=` : `${k}=${jsToString(v)}`)
  }
  let out = path + items.sort().join('')
  if (data.requestBody !== undefined && data.requestBody !== null) out += jsJson(data.requestBody)
  return out
}

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
]
const BLAKE_IV = [2837534710, 2845986804, 2436420605, 706843635, 719254516, 2557931286, 2596197199, 2432949778]
const BLAKE_PARAM = 16842784

const EO = Buffer.from([
  98, 0, 0, 128, 49, 117, 185, 253, 224, 172, 104, 36, 223, 155, 87, 19, 32, 0, 0, 64, 2, 0, 0, 16, 255, 255, 255, 127, 255, 255, 255, 63, 0, 0, 0,
  240, 0, 0, 0, 192, 0, 0, 0, 128, 255, 255, 255, 15,
])
const CTS_KEY = 'Vuz4fCHxn1CO'

const CHACHA_CONST = [394484062, 2378328696, 630790222, 1922531795]
const CHACHA_KEY = [4183807412, 394484062, 1106561997, 2378328696, 630790222, 2546784104, 2891127470, 1922531795]
const CHACHA_NONCE = [2215853858, 1643070585, 1849059804]
const BLOB_XOR = 35
const GEH = 'e0000000000000'
const XOR_DIGEST = [45, 211, 69, 192]
const XOR_ENV = [123, 86, 62, 218]
const COUNT_MASK = 3131873467n
const NOW_MASK = 3360347992n
const RAND_SPAN = 281474976710655

export const SDK_VERSION_DEFAULT = 43468
export const SDK_VERSION_LIVE = 43469
const DEFAULT_SCRIPTS_LEN = 24
const DEFAULT_SECS_STACK = 'spatchRequest (https://p23-plat.wskwai.com/kos/nlav111422/ks-web/assets/index-bZyTA7JL.js:32:235479)'

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0
const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0

function blakeG(v: number[], a: number, b: number, c: number, d: number, x: number, y: number): void {
  v[a] = (v[a]! + v[b]! + x) >>> 0
  v[d] = rotr((v[d]! ^ v[a]!) >>> 0, 16)
  v[c] = (v[c]! + v[d]!) >>> 0
  v[b] = rotr((v[b]! ^ v[c]!) >>> 0, 12)
  v[a] = (v[a]! + v[b]! + y) >>> 0
  v[d] = rotr((v[d]! ^ v[a]!) >>> 0, 8)
  v[c] = (v[c]! + v[d]!) >>> 0
  v[b] = rotr((v[b]! ^ v[c]!) >>> 0, 7)
}

function blakeCompress(h: number[], words: number[], off: number, counter: number, length: number, final: boolean): void {
  const v = [...h, ...BLAKE_IV]
  v[12] = (v[12]! ^ counter) >>> 0
  if (final) v[14] = (v[14]! ^ 0xffffffff) >>> 0
  const m = new Array<number>(16).fill(0)
  for (let i = 0; i < length; i++) m[i % 16] = (m[i % 16]! ^ words[off + i]!) >>> 0
  for (const s of SIGMA) {
    blakeG(v, 0, 4, 8, 12, m[s[0]!]!, m[s[1]!]!)
    blakeG(v, 1, 5, 9, 13, m[s[2]!]!, m[s[3]!]!)
    blakeG(v, 2, 6, 10, 14, m[s[4]!]!, m[s[5]!]!)
    blakeG(v, 3, 7, 11, 15, m[s[6]!]!, m[s[7]!]!)
    blakeG(v, 0, 5, 10, 15, m[s[8]!]!, m[s[9]!]!)
    blakeG(v, 1, 6, 11, 12, m[s[10]!]!, m[s[11]!]!)
    blakeG(v, 2, 7, 8, 13, m[s[12]!]!, m[s[13]!]!)
    blakeG(v, 3, 4, 9, 14, m[s[14]!]!, m[s[15]!]!)
  }
  for (let i = 0; i < 8; i++) h[i] = (h[i]! ^ v[i]! ^ v[i + 8]!) >>> 0
}

/** jmpOnw_b2has：BLAKE2s 变体（自定义 IV，按小端字分块），64 位 hex。 */
export function blakeHex(text: string): string {
  const raw = Buffer.from(text, 'utf8')
  const padded = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)])
  const words: number[] = []
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i))
  const h = [...BLAKE_IV]
  h[0] = (h[0]! ^ BLAKE_PARAM) >>> 0
  let remain = words.length
  let off = 0
  let counter = 0
  while (remain > 64) {
    counter += 64
    remain -= 64
    blakeCompress(h, words, off, counter, 64, false)
    off += 64
  }
  counter += remain
  blakeCompress(h, words, off, counter, remain, true)
  return h.map((w) => w.toString(16).padStart(8, '0')).join('')
}

/** jmpOnw_cts：三路 LFSR 组合生成器，逐字节 `out = b ^ (keystream + 3)`。 */
class Cts {
  private r0: number
  private r1: number
  private r2: number
  private readonly p0 = EO.readUInt32LE(0)
  private readonly f1 = EO.readUInt32LE(16)
  private readonly f2 = EO.readUInt32LE(20)
  private readonly m0 = EO.readUInt32LE(24)
  private readonly m1 = EO.readUInt32LE(28)
  private readonly m2 = EO.readUInt32LE(44)
  private readonly h0 = EO.readUInt32LE(40)
  private readonly h1 = EO.readUInt32LE(36)
  private readonly h2 = EO.readUInt32LE(32)

  constructor(key = CTS_KEY) {
    let r0 = EO.readUInt32LE(12)
    let r1 = EO.readUInt32LE(8)
    let r2 = EO.readUInt32LE(4)
    for (let i = 0; i < 4; i++) {
      const byte = key.charCodeAt(i + 4) & 0xff
      r0 = ((r0 << 8) | byte) >>> 0
      r1 = ((r1 << 8) | byte) >>> 0
      r2 = ((r2 << 8) | byte) >>> 0
    }
    this.r0 = r0 || 324508639
    this.r1 = r1 || 610839776
    this.r2 = r2 || 4256789809
  }

  /** 返回低 8 位（上游的有符号修正不影响低 8 位，最终只用 `& 0xFF`）。 */
  private next(): number {
    let out = 0
    let b0 = this.r1 & 1
    let b1 = this.r2 & 1
    for (let i = 0; i < 8; i++) {
      if (this.r0 & 1) {
        this.r0 = ((this.r0 ^ (this.p0 >>> 1)) | this.h0) >>> 0
        if (this.r1 & 1) {
          this.r1 = ((this.r1 ^ (this.f1 >>> 1)) | this.h1) >>> 0
          b0 = 1
        } else {
          this.r1 = ((this.r1 >>> 1) & this.m1) >>> 0
          b0 = 0
        }
      } else {
        this.r0 = ((this.r0 >>> 1) & this.m0) >>> 0
        if (this.r2 & 1) {
          this.r2 = ((this.r2 ^ (this.f2 >>> 1)) | this.h2) >>> 0
          b1 = 1
        } else {
          this.r2 = ((this.r2 >>> 1) & this.m2) >>> 0
          b1 = 0
        }
      }
      out = ((out << 1) | (b0 ^ b1)) & 0xff
    }
    return out
  }

  apply(data: Uint8Array): Uint8Array {
    return Uint8Array.from(data, (b) => (b ^ ((this.next() + 3) & 0xff)) & 0xff)
  }
}

function chachaBlock(state: number[]): number[] {
  const w = [...state]
  const q = (a: number, b: number, c: number, d: number) => {
    w[a] = (w[a]! + w[b]!) >>> 0
    w[d] = rotl((w[d]! ^ w[a]!) >>> 0, 16)
    w[c] = (w[c]! + w[d]!) >>> 0
    w[b] = rotl((w[b]! ^ w[c]!) >>> 0, 12)
    w[a] = (w[a]! + w[b]!) >>> 0
    w[d] = rotl((w[d]! ^ w[a]!) >>> 0, 8)
    w[c] = (w[c]! + w[d]!) >>> 0
    w[b] = rotl((w[b]! ^ w[c]!) >>> 0, 7)
  }
  for (let i = 0; i < 10; i++) {
    q(0, 4, 8, 12)
    q(1, 5, 9, 13)
    q(2, 6, 10, 14)
    q(3, 7, 11, 15)
    q(0, 5, 10, 15)
    q(1, 6, 11, 12)
    q(2, 7, 8, 13)
    q(3, 4, 9, 14)
  }
  return w.map((x, i) => (x + state[i]!) >>> 0)
}

/** collectDeviceInfo 用的 ChaCha20（常量、密钥、nonce 都是定死的）。 */
function chacha(data: number[]): Uint8Array {
  const state = [...CHACHA_CONST, ...CHACHA_KEY, 1, ...CHACHA_NONCE]
  let block = chachaBlock(state)
  const out = new Uint8Array(data.length)
  let k = 0
  data.forEach((byte, i) => {
    if (k === 64) {
      state[12] = (state[12]! + 1) >>> 0
      block = chachaBlock(state)
      k = 0
    }
    out[i] = (byte ^ ((block[k >> 2]! >>> ((k & 3) << 3)) & 0xff)) & 0xff
    k++
  })
  return out
}

/** po() / _a()：小端 n 字节；n >= 4 且值 >= 2^32 时固定为 4 个 0xFF。 */
function le(value: number, n: number): number[] {
  const v = BigInt(value || 0)
  if (n >= 4 && v >= 1n << 32n) return [255, 255, 255, 255]
  return Array.from({ length: n }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn))
}

/** jmpOnw_i2h：小端 n 字节的 hex。 */
function leHex(value: number | bigint, n: number): string {
  const v = BigInt(value)
  let out = ''
  for (let i = 0; i < n; i++) out += Number((v >> BigInt(8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return out
}

/** collectDeviceInfo()：TLV → 异或 0x23 → ChaCha20 → base64url（`+/=` 换成 `-_.`），前缀 `HUDR_`。 */
function devicePrefix(scriptsLen: number, guardCount: number, secsStack: string, secsCount: number): string {
  const blob = [45, 61, 0, 2, 68, 0, ...le(scriptsLen, 4), 112, 0, ...le(guardCount, 4), 114, 1, ...le(secsStack.length, 2)]
  for (const ch of secsStack) blob.push(ch.codePointAt(0)!)
  blob.push(115, 0, ...le(secsCount, 4))
  const enc = chacha(blob.map((b) => (b ^ BLOB_XOR) & 0xff))
  return 'HUDR_' + Buffer.from(enc).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.')
}

function hexChecksum(hex: string): string {
  const total = [...Buffer.from(hex, 'hex')].reduce((s, b) => s + b, 0)
  const v = total > 255 ? -total & 0xff : total & 0xff
  return v.toString(16).padStart(2, '0')
}

function container(hex: string, checksum: string): string {
  const raw = Buffer.from(hex + checksum, 'hex')
  const key = raw[raw.length - 1]!
  const out = Buffer.from(raw)
  for (let i = 0; i < out.length - 1; i++) out[i] = raw[i]! ^ key
  return out.toString('hex')
}

/**
 * `__NS_hxfalcon` 签名器。startupRandom 是引擎构造时刻的 unix 毫秒，count 与 KsGuard.count 从 100 起逐次自增。
 */
export class HxFalconSigner {
  count = 100
  guardCount = 100
  readonly startupRandom: number

  constructor(readonly sdkVersion = SDK_VERSION_DEFAULT) {
    this.startupRandom = rand.now()
  }

  sign(input: SignInput): string {
    return this.encode(input, rand.now(), Math.floor(rand.random() * RAND_SPAN))
  }

  encode(input: SignInput, nowMs: number, rand48: number): string {
    const prefix = devicePrefix(DEFAULT_SCRIPTS_LEN, this.guardCount, DEFAULT_SECS_STACK, this.count)
    this.guardCount++
    const serialized = serializeSignInput(input)
    const stream = new Cts().apply(Buffer.from(blakeHex(serialized + prefix).slice(0, 4), 'utf8'))
    const digest = Buffer.from([0, 1, 2, 3].map((i) => (stream[i]! ^ XOR_DIGEST[i]!) & 0xff)).toString('hex')
    const envRaw = Buffer.from(GEH, 'hex')
    const env = Buffer.from([...envRaw].map((b, i) => (b ^ XOR_ENV[i % 4]!) & 0xff)).toString('hex')
    const body =
      '4b54' +
      leHex(this.sdkVersion, 2) +
      'ab' +
      leHex(this.startupRandom, 6) +
      leHex(rand48, 6) +
      '0100000001' +
      leHex(BigInt(this.count) ^ COUNT_MASK, 4) +
      digest +
      leHex(BigInt(nowMs) ^ NOW_MASK, 6) +
      env +
      hexChecksum(env)
    this.count++
    return prefix + '$HE_' + container(body, hexChecksum(body))
  }
}

// ================================================================ sig3（sig3_pure.py）

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

const SIG3_IV = [
  [1201087869, 728038316, -1247317401, -375217708, -1820116536, 395408228, 1482956210, -1904517706],
  [-932960537, -839864669, 895983619, 323220038, 1908748190, 778712444, -2022813415, -1089440689],
].map((row) => row.map((v) => v >>> 0))

/** 引擎的 d()：追加 0x80，切 16 字大端块；长度字段是 (len + 63) * 8。 */
function sha256Blocks(msg: number[]): number[][] {
  const m = [...msg, 0x80]
  const total = Math.ceil((m.length / 4 + 2) / 16)
  const out: number[][] = []
  for (let i = 0; i < total; i++) {
    const block: number[] = []
    for (let j = 0; j < 16; j++) {
      let word = 0
      for (let b = 0; b < 4; b++) {
        const idx = i * 64 + j * 4 + b
        word = (word | ((idx < m.length ? m[idx]! : 0) << (24 - 8 * b))) >>> 0
      }
      block.push(word)
    }
    out.push(block)
  }
  const bits = BigInt((m.length + 63) * 8)
  out[out.length - 1]![14] = Number((bits >> 32n) & 0xffffffffn)
  out[out.length - 1]![15] = Number(bits & 0xffffffffn)
  return out
}

function sha256Compress(blocks: number[][], iv: number[]): number[] {
  let h = [...iv]
  for (const block of blocks) {
    const w = [...block]
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3)
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10)
      w.push((w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0)
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let t = 0; t < 64; t++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[t]! + w[t]!) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h = h.map((x, i) => (x + [a, b, c, d, e, f, g, hh][i]!) >>> 0)
  }
  return h
}

/** 4 字节摘要：两轮自定义 IV 的 SHA-256，第二轮直接吃第一轮的大端字节。 */
export function sig3Digest(md5hex: string): Buffer {
  const first = sha256Compress(sha256Blocks([...Buffer.from(md5hex, 'latin1')]), SIG3_IV[0]!)
  const mid: number[] = []
  for (const w of first) for (let b = 0; b < 4; b++) mid.push((w >>> (24 - 8 * b)) & 0xff)
  const second = sha256Compress(sha256Blocks(mid), SIG3_IV[1]!)
  const out = Buffer.alloc(4)
  out.writeUInt32BE(second[0]!)
  return out
}

/** request2SortedString：键按 JS 默认序，拼 `k=encodeURI(v)`。 */
function sortedString(obj: Obj): string {
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${encodeURI(jsToString(obj[k]))}`)
    .join('')
}

/** request2Md5：form-data 时 body 并入 query 一起排序，json 时拼 JSON.stringify(body)。 */
export function request2Md5(query: Obj, body: unknown, type: 'json' | 'form-data' = 'json'): string {
  const merged: Obj = { ...query }
  let suffix = ''
  if (type === 'form-data') Object.assign(merged, body ?? {})
  else suffix = jsJson(body ?? {})
  return createHash('md5')
    .update(sortedString(merged) + suffix, 'utf8')
    .digest('hex')
}

const SIG3_BUILD = 1653548225

/** `__NS_sig3` 签名器：startupRandom 是 unix 秒，count 从 100 起。 */
export class Sig3Signer {
  count = 100
  readonly startupRandom = rand.nowSeconds()

  sign(query: Obj, body: unknown, type: 'json' | 'form-data' = 'json'): string {
    const head = Buffer.alloc(27)
    head.write('TE', 0, 'latin1')
    head[2] = 0x01
    head[3] = 0x30
    head.writeUInt32LE(this.startupRandom >>> 0, 4)
    head.writeUInt32LE(this.count >>> 0, 8)
    sig3Digest(request2Md5(query, body, type)).copy(head, 12)
    head.writeUInt32LE(SIG3_BUILD, 16)
    Buffer.from('01000100000000', 'hex').copy(head, 20)
    this.count++
    const total = [...head].reduce((s, b) => s + b, 0)
    const key = total > 255 ? -total & 0xff : total & 0xff
    const out = Buffer.alloc(28)
    for (let i = 0; i < 27; i++) out[i] = head[i]! ^ key ^ i
    out[27] = key
    return out.toString('hex')
  }
}

// ================================================================ webweapon AES

const CONFIG_KEY = Buffer.from('webweaponconfigs')

/** AES-128-CBC + PKCS7，IV 等于 key，输出 base64（st$1 / gdfp 的 at()）。 */
export function weaponEncrypt(plain: string, key: Buffer = CONFIG_KEY): string {
  const c = createCipheriv('aes-128-cbc', key, key)
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64')
}

export function weaponDecrypt(blob: string, key: Buffer = CONFIG_KEY): string {
  const d = createDecipheriv('aes-128-cbc', key, key)
  return Buffer.concat([d.update(Buffer.from(blob, 'base64')), d.final()]).toString('utf8')
}
