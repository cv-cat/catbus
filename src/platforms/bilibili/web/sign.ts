import { constants, publicEncrypt } from 'node:crypto'
import { hmacSha256Hex, md5Hex } from '../../../core/hash.js'
import { jsonDumps, type Pairs, pyStr, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { PROFILE } from './profile.js'

/** B 站的纯算签名与设备值（上游 utils/wbi.py、ticket.py、bv.py、murmur3.py、dm_img.py、device.py、correspond.py）。 */

export const md5 = (text: string): string => md5Hex(text)

// ---------------------------------------------------------------- WBI

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7,
  16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

/** wbi 图片 URL 里的文件名（不带扩展名）。 */
export function extractKey(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1).split('.')[0]!
}

export function mixinKey(imgKey: string, subKey: string): string {
  const raw = (imgKey.includes('/') ? extractKey(imgKey) : imgKey) + (subKey.includes('/') ? extractKey(subKey) : subKey)
  return MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32)
}

/**
 * 给 query 补上 w_rid 与 wts。排序与剔除 `!'()*` 只作用于签名串，
 * 发出去的参数保持原顺序，末尾依次追加 w_rid、wts。
 */
export function encWbi(params: Pairs, key: string, wts = rand.nowSeconds()): Pairs {
  const toSign: Pairs = [...params.filter(([k]) => k !== 'wts'), ['wts', wts]]
  toSign.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const query = urlencode(toSign.map(([k, v]) => [k, pyStr(v).replace(/[!'()*]/g, '')]))
  const signed = params.filter(([k]) => k !== 'w_rid' && k !== 'wts')
  return [...signed, ['w_rid', md5(query + key)], ['wts', wts]]
}

// ---------------------------------------------------------------- bili_ticket

export const TICKET_KEY_ID = 'ec02'

export function ticketHexSign(ts: number): string {
  return hmacSha256Hex('XgwSnGZ1p', `ts${ts}`)
}

// ---------------------------------------------------------------- av / bv

const XOR_CODE = 23442827791579n
const MASK_CODE = 2251799813685247n
const MAX_AID = 1n << 51n
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf'
const ENCODE_MAP = [8, 7, 0, 5, 1, 3, 2, 4, 6]
const DECODE_MAP = [...ENCODE_MAP].reverse()
const BASE = 58n

export function av2bv(aid: number | string | bigint): string {
  const chars: string[] = Array(ENCODE_MAP.length).fill('')
  let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE
  for (const i of ENCODE_MAP) {
    chars[i] = ALPHABET[Number(tmp % BASE)]!
    tmp /= BASE
  }
  return 'BV1' + chars.join('')
}

export function bv2av(bvid: string): string {
  if (!bvid.startsWith('BV1')) throw new Error(`不是合法的 bvid：${bvid}`)
  const body = bvid.slice(3)
  if (body.length !== ENCODE_MAP.length) throw new Error(`bvid 长度不对：${bvid}`)
  let tmp = 0n
  for (const i of DECODE_MAP) tmp = tmp * BASE + BigInt(ALPHABET.indexOf(body[i]!))
  return String((tmp & MASK_CODE) ^ XOR_CODE)
}

// ---------------------------------------------------------------- murmur3_x64_128

const MASK64 = (1n << 64n) - 1n
const C1 = 0x87c37b91114253d5n
const C2 = 0x4cf5ad432745937fn

const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (64n - r))) & MASK64
function fmix64(k: bigint): bigint {
  k ^= k >> 33n
  k = (k * 0xff51afd7ed558ccdn) & MASK64
  k ^= k >> 33n
  k = (k * 0xc4ceb9fe1a85ec53n) & MASK64
  k ^= k >> 33n
  return k
}

function readLE64(data: Buffer, offset: number, length = 8): bigint {
  let v = 0n
  for (let i = length - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]!)
  return v
}

/** buvid_fp：murmur3_x64_128 的 32 位十六进制摘要。 */
export function murmur3Hex(input: string, seed = 31): string {
  const data = Buffer.from(input, 'utf8')
  const length = data.length
  const nblocks = Math.floor(length / 16)
  let h1 = BigInt(seed) & MASK64
  let h2 = h1
  for (let i = 0; i < nblocks; i++) {
    let k1 = readLE64(data, i * 16)
    let k2 = readLE64(data, i * 16 + 8)
    k1 = (k1 * C1) & MASK64
    k1 = rotl(k1, 31n)
    k1 = (k1 * C2) & MASK64
    h1 ^= k1
    h1 = rotl(h1, 27n)
    h1 = (h1 + h2) & MASK64
    h1 = (h1 * 5n + 0x52dce729n) & MASK64
    k2 = (k2 * C2) & MASK64
    k2 = rotl(k2, 33n)
    k2 = (k2 * C1) & MASK64
    h2 ^= k2
    h2 = rotl(h2, 31n)
    h2 = (h2 + h1) & MASK64
    h2 = (h2 * 5n + 0x38495ab5n) & MASK64
  }
  const tailAt = nblocks * 16
  const tailLen = length - tailAt
  if (tailLen > 8) {
    let k2 = readLE64(data, tailAt + 8, tailLen - 8)
    k2 = (k2 * C2) & MASK64
    k2 = rotl(k2, 33n)
    k2 = (k2 * C1) & MASK64
    h2 ^= k2
  }
  if (tailLen > 0) {
    let k1 = readLE64(data, tailAt, Math.min(tailLen, 8))
    k1 = (k1 * C1) & MASK64
    k1 = rotl(k1, 31n)
    k1 = (k1 * C2) & MASK64
    h1 ^= k1
  }
  h1 ^= BigInt(length)
  h2 ^= BigInt(length)
  h1 = (h1 + h2) & MASK64
  h2 = (h2 + h1) & MASK64
  h1 = fmix64(h1)
  h2 = fmix64(h2)
  h1 = (h1 + h2) & MASK64
  h2 = (h2 + h1) & MASK64
  return h1.toString(16).padStart(16, '0') + h2.toString(16).padStart(16, '0')
}

// ---------------------------------------------------------------- dm_img_*

/** `json.dumps(v, separators=(',', ':'))`（ensure_ascii 为默认的 True）。 */
export const dumps = (v: unknown) => jsonDumps(v, { separators: [',', ':'] })

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64').replace(/=+$/, '')

/** 鼠标采样。缺省 0 条（空数组）才是浏览器刚加载时的行为。 */
function dmImgList(count: number): string {
  const samples: object[] = []
  let x = rand.randint(1000, 4000)
  let y = rand.choice([rand.randint(150, 2000), -rand.randint(200, 5000)])
  let timestamp = rand.randint(3000, 40000)
  let z = 0
  for (let i = 0; i < count; i++) {
    samples.push({ x, y, z, timestamp, k: rand.randint(60, 128), type: i % 2 })
    const stepX = rand.randint(-400, 500)
    const stepY = rand.randint(-300, 400)
    x += stepX
    y += stepY
    z = Math.max(0, z + Math.abs(stepX) + Math.abs(stepY) - rand.randint(0, 300))
    timestamp += rand.randint(96, 120)
  }
  return dumps(samples)
}

function dmImgInter(withDs: boolean): string {
  const offset = rand.randint(1, 350)
  const inter: { ds: object[]; wh: number[]; of: number[] } = {
    ds: [],
    wh: [rand.randint(7500, 7900), rand.randint(9000, 9200), rand.randint(0, 120)],
    of: [offset, offset * 2, offset],
  }
  if (withDs) {
    inter.ds = [
      {
        t: 7,
        c: b64('vui_button vui_pagenation--btn vui_pagenation--btn-side'),
        p: [rand.randint(3000, 7500), rand.randint(10, 200), rand.randint(3000, 7500)],
        s: [rand.randint(300, 500), rand.randint(600, 900), rand.randint(900, 1200)],
      },
    ]
  }
  return dumps(inter)
}

/** 四个 dm_img 参数，参与 WBI 签名，必须在签名前加上。 */
export function dmImgParams(sampleCount = 0, withDs = false): Pairs {
  return [
    ['dm_img_list', dmImgList(sampleCount)],
    ['dm_img_str', b64(PROFILE.webglVersion)],
    ['dm_cover_img_str', b64((PROFILE.webglRenderer + PROFILE.webglVendor).slice(0, -1))],
    ['dm_img_inter', dmImgInter(withDs)],
  ]
}

// ---------------------------------------------------------------- 设备值

const UUID_CHARS = [...'123456789ABCDEF', '10']

/** _uuid：五段随机 + 5 位毫秒尾数 + infoc。 */
export function uuidInfoc(): string {
  const parts = [8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, () => rand.choice(UUID_CHARS)).join(''))
  return parts.join('-') + String(rand.now() % 100000).padEnd(5, '0') + 'infoc'
}

export function randomHex(length: number, upper = true): string {
  return rand.string(length, upper ? '0123456789ABCDEF' : '0123456789abcdef')
}

/** b_lsid：8 位随机十六进制 + '_' + 毫秒时间戳的十六进制。 */
export function bLsid(): string {
  return `${randomHex(8)}_${rand.now().toString(16).toUpperCase()}`
}

export function sid(): string {
  return rand.string(8, '0123456789abcdefghijklmnopqrstuvwxyz')
}

/** 搜索接口的 qv_id。 */
export function qvId(): string {
  return rand.string(32, '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
}

export function liveBuvid(): string {
  return `AUTO${rand.nowSeconds()}${rand.string(9, '0123456789')}`
}

// ---------------------------------------------------------------- 续期与登录

const CORRESPOND_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHum0qSZA0AyCBDABUqCrfNgCiJ00Ra7GmRj+YCK1NJEuewlb40
JNrRuoEUXpabUzGB8QIDAQAB
-----END PUBLIC KEY-----`

/** correspondPath：RSA-OAEP(SHA-256) 加密 `refresh_{毫秒时间戳}`，小写十六进制。 */
export function correspondPath(ts = rand.now()): string {
  return publicEncrypt({ key: CORRESPOND_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(`refresh_${ts}`)).toString('hex')
}

/** 账密登录：用服务端公钥 RSA-OAEP(SHA-256) 加密 salt+密码，base64。 */
export function encryptPassword(salt: string, password: string, publicKeyPem: string): string {
  return publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(salt + password)).toString('base64')
}
