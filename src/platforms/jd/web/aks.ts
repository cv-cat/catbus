import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import * as rand from '../../../core/rand.js'

/**
 * passport 的 AKS 加密（上游 utils/aks.py，与登录页 aks.js / summer-cryptico 一致）：
 * `base64(公钥头 || SM2(C1C3C2, sm4Key) || iv || SM4-CBC(query))`。
 * SM2 的实现照 gmssl（随机数 k 用 64 个十六进制字符），SM3 / SM4 用 node 自带的 OpenSSL。
 */

const P = BigInt('0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFF')
const A = BigInt('0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFC')
const G: Point = [
  BigInt('0x32c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7'),
  BigInt('0xbc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0'),
]

type Point = [bigint, bigint] | null

const mod = (x: bigint) => ((x % P) + P) % P

function inv(x: bigint): bigint {
  let [a, b, u, v] = [mod(x), P, 1n, 0n]
  while (a !== 0n) {
    const q = b / a
    ;[a, b] = [b - q * a, a]
    ;[u, v] = [v - q * u, u]
  }
  return mod(v)
}

function add(p: Point, q: Point): Point {
  if (!p) return q
  if (!q) return p
  if (p[0] === q[0]) {
    if (mod(p[1] + q[1]) === 0n) return null
    const l = mod((3n * p[0] * p[0] + A) * inv(2n * p[1]))
    const x = mod(l * l - 2n * p[0])
    return [x, mod(l * (p[0] - x) - p[1])]
  }
  const l = mod((q[1] - p[1]) * inv(q[0] - p[0]))
  const x = mod(l * l - p[0] - q[0])
  return [x, mod(l * (p[0] - x) - p[1])]
}

function mul(k: bigint, p: Point): Point {
  let r: Point = null
  let q = p
  while (k > 0n) {
    if (k & 1n) r = add(r, q)
    q = add(q, q)
    k >>= 1n
  }
  return r
}

const hex64 = (n: bigint) => n.toString(16).padStart(64, '0')
const sm3 = (data: Uint8Array) => createHash('sm3').update(data).digest()

function kdf(z: Buffer, klen: number): Buffer {
  const out: Buffer[] = []
  for (let ct = 1; out.length * 32 < klen; ct++) {
    const c = Buffer.alloc(4)
    c.writeUInt32BE(ct)
    out.push(sm3(Buffer.concat([z, c])))
  }
  return Buffer.concat(out).subarray(0, klen)
}

/** gmssl `CryptSM2(public_key=pubHex, mode=1).encrypt(data)`：C1(64) || C3(32) || C2。 */
export function sm2Encrypt(publicHex: string, data: Uint8Array): Buffer {
  const pub: Point = [BigInt('0x' + publicHex.slice(0, 64)), BigInt('0x' + publicHex.slice(64, 128))]
  const k = BigInt('0x' + rand.string(64, '0123456789abcdef'))
  const c1 = mul(k, G)!
  const s = mul(k, pub)!
  const x2 = Buffer.from(hex64(s[0]), 'hex')
  const y2 = Buffer.from(hex64(s[1]), 'hex')
  const t = kdf(Buffer.concat([x2, y2]), data.length)
  const c2 = Buffer.from(data.map((b, i) => b ^ t[i]!))
  const c3 = sm3(Buffer.concat([x2, Buffer.from(data), y2]))
  return Buffer.concat([Buffer.from(hex64(c1[0]) + hex64(c1[1]), 'hex'), c3, c2])
}

export function sm4Encrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer {
  const c = createCipheriv('sm4-cbc', key, iv)
  return Buffer.concat([c.update(data), c.final()])
}

export function sm4Decrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Buffer {
  const d = createDecipheriv('sm4-cbc', key, iv)
  return Buffer.concat([d.update(data), d.final()])
}

const STORAGE_KEY = Buffer.from('6c3d6878252e641b')
const STORAGE_IV = Buffer.from('5f5e5a247f544d771255134517043757', 'hex')

/** summer-cryptico 的 randomUnit8Array(1, 127, n)。 */
const randomUnits = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(rand.random() * 127) + 1)

/** 持久化的 SM4 key：浏览器存在 localStorage.aksKey（加密后的十六进制），这里存在凭证 device.aks。 */
export interface AksState {
  aksKey?: string
}

function loadSm4Key(state: AksState): string {
  try {
    if (state.aksKey) {
      const plain = sm4Decrypt(Buffer.from(state.aksKey, 'hex'), STORAGE_KEY, STORAGE_IV).toString('utf8')
      if (/^[0-9a-f]{16}$/.test(plain)) return plain
    }
  } catch {}
  const key = Buffer.from(randomUnits(8)).toString('hex')
  state.aksKey = sm4Encrypt(Buffer.from(key, 'utf8'), STORAGE_KEY, STORAGE_IV).toString('hex')
  return key
}

/** 把 jQuery 编码后的 query 串加密成 aksParamsU / aksParamsB（encrypt_query）。 */
export function encryptQuery(query: string, publicKeyB64: string, state: AksState): string {
  if (!query) throw new Error('AKS query cannot be empty')
  const raw = Buffer.from(publicKeyB64, 'base64')
  if (raw.length < 65) throw new Error('passport publicKey/init 返回值长度不足')
  const header = raw.subarray(0, raw.length - 65)
  const pub = raw.subarray(raw.length - 65)
  const publicHex = pub[0] === 4 ? pub.subarray(1).toString('hex') : pub.toString('hex')
  const sm4Key = loadSm4Key(state)
  const iv = randomUnits(16)
  const sm2 = sm2Encrypt(publicHex, Buffer.from(sm4Key, 'utf8'))
  const sm4 = sm4Encrypt(Buffer.from(query, 'utf8'), Buffer.from(sm4Key, 'utf8'), iv)
  return Buffer.concat([header, sm2, iv, sm4]).toString('base64')
}
