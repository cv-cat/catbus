import { createCipheriv, createECDH, createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto'
import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'

/**
 * bd-ticket-guard、x-tt-session-dtrait、ImageX/VOD 网关签名（上游 utils/bd_ticket.py、dtrait.py、imagex_sign.py、passport.py）。
 *
 * 随机数一律经 core/rand：ECDSA 的 k、密钥生成与 RSA 填充都按上游 python-ecdsa / os.urandom 的消耗方式取字节，
 * 对拍时与上游逐字节一致；平时 rand.bytes 走 crypto.randomBytes。
 */

// ================================================================ P-256

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n
const SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d03010703420004', 'hex')

const toBig = (buf: Uint8Array) => BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'))
const toBuf32 = (n: bigint) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex')

function modInv(a: bigint, m: bigint): bigint {
  let [r0, r1] = [((a % m) + m) % m, m]
  let [s0, s1] = [1n, 0n]
  while (r1) {
    const q = r0 / r1
    ;[r0, r1] = [r1, r0 - q * r1]
    ;[s0, s1] = [s1, s0 - q * s1]
  }
  return ((s0 % m) + m) % m
}

/** python-ecdsa 的 randrange(order)：取 33 字节，截前 256 位加 1，落在 [1, order) 为止。 */
function randrange(order = P256_ORDER): bigint {
  for (;;) {
    const ent = rand.bytes(33)
    const num = (toBig(ent) >> 8n) + 1n
    if (num > 0n && num < order) return num
  }
}

/** 私钥标量：接受 PEM（SEC1 / PKCS8）或十六进制。 */
function privateScalar(prv: string): bigint {
  if (prv.includes('-----BEGIN')) {
    const jwk = createPrivateKey(prv).export({ format: 'jwk' }) as { d: string }
    return toBig(Buffer.from(jwk.d, 'base64url'))
  }
  return BigInt('0x' + prv.trim())
}

/** k·G 的未压缩点（借 ECDH 做标量乘）。 */
function mulG(k: bigint): Buffer {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(toBuf32(k))
  return ecdh.getPublicKey()
}

/** 生成登录用的 P-256 密钥对，返回 SEC1 PEM（上游 generate_ec_keypair）。 */
export function generateEcKey(): string {
  const d = randrange()
  const pub = mulG(d)
  const jwk = { kty: 'EC', crv: 'P-256', d: toBuf32(d).toString('base64url'), x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }
  return createPrivateKey({ key: jwk, format: 'jwk' }).export({ type: 'sec1', format: 'pem' }).toString()
}

/** bd-ticket-guard-ree-public-key：base64(04 || X || Y)。 */
export function reeKey(prv: string): string {
  return mulG(privateScalar(prv)).toString('base64')
}

function derInt(n: bigint): Buffer {
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  let b = Buffer.from(hex, 'hex')
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0]), b])
  return Buffer.concat([Buffer.from([0x02, b.length]), b])
}

/** ECDSA-SHA256，DER 编码（python-ecdsa 的 sign(..., sigencode_der)，不做 low-s）。 */
export function ecdsaSign(message: string, prv: string): string {
  const d = privateScalar(prv)
  const z = toBig(createHash('sha256').update(message, 'utf8').digest())
  for (;;) {
    const k = randrange()
    const r = toBig(mulG(k).subarray(1, 33)) % P256_ORDER
    const s = (modInv(k, P256_ORDER) * ((z + ((d * r) % P256_ORDER)) % P256_ORDER)) % P256_ORDER
    if (!r || !s) continue
    const body = Buffer.concat([derInt(r), derInt(s)])
    return Buffer.concat([Buffer.from([0x30, body.length]), body]).toString('base64')
  }
}

/** 服务端证书里的 65 字节公钥点：`pub.<b64>` 或 PEM 证书。 */
function serverPoint(cert: string): Buffer {
  if (cert.startsWith('pub.')) return Buffer.from(cert.slice(4), 'base64')
  const der = Buffer.from(cert.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
  const i = der.indexOf(SPKI_PREFIX)
  if (i < 0) throw new Error('服务端证书中未找到 P-256 公钥')
  const start = i + SPKI_PREFIX.length
  return Buffer.concat([Buffer.from([4]), der.subarray(start, start + 64)])
}

function hkdf(ikm: Buffer, length = 32): Buffer {
  const prk = createHmac('sha256', Buffer.alloc(32)).update(ikm).digest()
  let okm = Buffer.alloc(0)
  let block = Buffer.alloc(0)
  for (let counter = 1; okm.length < length; counter++) {
    block = createHmac('sha256', prk).update(Buffer.concat([block, Buffer.from([counter])])).digest()
    okm = Buffer.concat([okm, block])
  }
  return okm.subarray(0, length)
}

/** ECDH(客户端私钥, 服务端公钥) → HKDF-SHA256 → 32 字节 HMAC 密钥。 */
export function ecdhKey(prv: string, serverCert: string): Buffer {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(toBuf32(privateScalar(prv)))
  return hkdf(ecdh.computeSecret(serverPoint(serverCert)))
}

export function hmacSign(message: string, key: Buffer): string {
  return createHmac('sha256', key).update(message, 'utf8').digest('base64')
}

/** bd-ticket-guard-client-data：有 ECDH 密钥走 HMAC，否则 ECDSA。 */
export function ticketClientData(
  api: string,
  ticket: string,
  tsSign: string,
  prv: string,
  key: Buffer | null,
  timestamp = rand.nowSeconds(),
  tTrust?: number,
): { data: string; algo: 'hmac' | 'ecdsa' } {
  const content = `ticket=${ticket}&path=${api}&timestamp=${timestamp}`
  const algo = key ? 'hmac' : 'ecdsa'
  const payload: Record<string, unknown> = {
    ts_sign: tsSign,
    req_content: 'ticket,path,timestamp',
    req_sign: key ? hmacSign(content, key) : ecdsaSign(content, prv),
    timestamp,
  }
  if (tTrust !== undefined) payload.t_trust = tTrust
  return { data: Buffer.from(compactJson(payload), 'utf8').toString('base64'), algo }
}

/** web-version 由 ts_sign 前缀决定：ts.1 → 1，其余 → 2。 */
export const ticketGuardVersion = (tsSign: string) => (tsSign.startsWith('ts.1') ? 1 : 2)

/** bd_ticket_guard_client_data：把自己的公钥交给服务端（base64(JSON) 再 encodeURIComponent）。 */
export function clientDataCookie(prv: string): string {
  const payload = {
    'bd-ticket-guard-version': 2,
    'bd-ticket-guard-iteration-version': 1,
    'bd-ticket-guard-ree-public-key': reeKey(prv),
    'bd-ticket-guard-web-version': 2,
  }
  return encodeURIComponent(Buffer.from(compactJson(payload)).toString('base64'))
}

/** bd_ticket_guard_client_data_v2：对 `sec_ts=<sec_ts>` 做 HMAC（ECDH 密钥）。 */
export function clientDataV2Cookie(prv: string, secTs: string, serverCert: string, tsSign = ''): string {
  const payload: Record<string, unknown> = { ree_public_key: reeKey(prv) }
  if (tsSign) payload.ts_sign = tsSign
  payload.req_content = 'sec_ts'
  payload.req_sign = hmacSign('sec_ts=' + secTs, ecdhKey(prv, serverCert))
  payload.sec_ts = secTs
  return encodeURIComponent(Buffer.from(compactJson(payload)).toString('base64'))
}

// ================================================================ x-tt-session-dtrait

/** 登录页 bundle 内置的 d0 公钥（上游 dtrait.py 的 _BUILTIN_TRAIT_PK1_B64）。 */
const BUILTIN_PK1 = Buffer.from(
  'LS0tLS1CRUdJTiBSU0EgUFVCTElDIEtFWS0tLS0tCk1JSUJDZ0tDQVFFQTQrZHZ2WTd1TStvcGMrbkxHL0R1bVNlRm83YVZjSW0xTE8rbVVJcldwclJ6UDBhMUdwRVEKNHF0TzlN' +
    'UmYvbHdFSXgzOCs0Qlo0WE9HemV2VnR1VXZmSU9VRTdBVHRRVzdGS0pmNVBuU0xDSTYvazB2bDFGQwpMVVNWbUVQNnFQSnJJalo0elhvcWkzeXVOWisxb2RiUkEvL0dIZ2NnU3l5' +
    'eWFMcXp3amtwV0dYb3VNWW12WXNTCnBway9mdjJFV0FCc3RQTnhXYTRFT0JDYWRUVVBrWE5RNzZOQkVQOXh6ZkpTMjB3aUR2MW9TL3ZLdnJTVXBXY0oKbmF6a2tCdnFRYmJBcVZi' +
    'UUZURi9EUGlrcHB1NlpUNmxHSVh2SktDcmVlRmlIQTJxSzZ0UzE4U1dWSFc5QVJ6MQorcGpCMWVxSUlZdG9oV3BUMkI0ME9DNE84dFZlQkFuYmlRSURBUUFCCi0tLS0tRU5EIFJT' +
    'QSBQVUJMSUMgS0VZLS0tLS0=',
  'base64',
).toString('ascii')
const PK1_VERSION = 'd0'
const DTRAIT_SDK_VERSION = '1.0.0.16'

export interface DtraitMaterial {
  keyHex: string
  encKey: Buffer
}

function rsaPkcs1v15(pem: string, message: Buffer): Buffer {
  const jwk = createPublicKey(pem).export({ format: 'jwk' }) as { n: string; e: string }
  const n = toBig(Buffer.from(jwk.n, 'base64url'))
  const e = toBig(Buffer.from(jwk.e, 'base64url'))
  const k = Buffer.from(jwk.n, 'base64url').length
  const psLen = k - message.length - 3
  const ps: number[] = []
  while (ps.length < psLen) for (const b of rand.bytes(psLen - ps.length)) if (b !== 0) ps.push(b)
  const em = toBig(Buffer.concat([Buffer.from([0, 2]), Buffer.from(ps.slice(0, psLen)), Buffer.from([0]), message]))
  let c = 1n
  let base = em % n
  for (let x = e; x > 0n; x >>= 1n) {
    if (x & 1n) c = (c * base) % n
    base = (base * base) % n
  }
  return Buffer.from(c.toString(16).padStart(k * 2, '0'), 'hex')
}

function aes128cbc(key: Buffer, iv: Uint8Array, plaintext: string): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
}

/**
 * 按请求 path 生成 x-tt-session-dtrait。同一会话复用 RSA 加密后的 AES 密钥（第一段），
 * 每次请求重新取 IV 并按 path 加密 payload（第二段）。首次调用时的随机消耗顺序：key → iv → RSA 填充。
 */
export function sessionDtrait(path: string, blob: string, material: DtraitMaterial | null): { header: string; material: DtraitMaterial } {
  let iv: Uint8Array
  if (!material) {
    const keyHex = Buffer.from(rand.bytes(16)).toString('hex')
    iv = rand.bytes(16)
    material = { keyHex, encKey: rsaPkcs1v15(BUILTIN_PK1, Buffer.from(keyHex, 'ascii')) }
  } else iv = rand.bytes(16)
  const payload = compactJson({ dtrait: blob, timestamp: rand.nowSeconds(), sdkVersion: DTRAIT_SDK_VERSION, path })
  const cipher = aes128cbc(Buffer.from(material.keyHex, 'hex'), iv, payload)
  const header = `${PK1_VERSION}_${material.encKey.toString('base64')}_${Buffer.concat([iv, cipher]).toString('base64')}`
  return { header, material }
}

// ================================================================ ImageX / VOD 网关的 AWS SigV4

export const IMAGEX_HOST = 'imagex.bytedanceapi.com'
export const VOD_HOST = 'vod.bytedanceapi.com'
const REGION = 'cn-north-1'

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

function canonicalQuery(query: [string, string | number][]): string {
  const enc = query.map(([k, v]) => [rfc3986(String(k)), rfc3986(String(v))] as const)
  enc.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  return enc.map(([k, v]) => `${k}=${v}`).join('&')
}

export interface Sts {
  AccessKeyID: string
  SecretAccessKey: string
  SessionToken: string
  [key: string]: unknown
}

/** 返回要合入请求的头：authorization、x-amz-date、x-amz-security-token（POST 另有 x-amz-content-sha256）。 */
export function sigv4(sts: Sts, method: 'GET' | 'POST', query: [string, string | number][], body: Uint8Array | string = '', service = 'imagex'): Record<string, string> {
  const d = new Date(rand.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const amzDate = `${dateStamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  const payloadHash = sha256Hex(body)
  const signed: Record<string, string> = { 'x-amz-date': amzDate, 'x-amz-security-token': sts.SessionToken }
  if (method === 'POST') signed['x-amz-content-sha256'] = payloadHash
  const names = Object.keys(signed).sort()
  const canonical = [method, '/', canonicalQuery(query), names.map((k) => `${k}:${signed[k]}\n`).join(''), names.join(';'), payloadHash].join('\n')
  const scope = `${dateStamp}/${REGION}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n')
  let key: Buffer = createHmac('sha256', 'AWS4' + sts.SecretAccessKey).update(dateStamp).digest()
  for (const part of [REGION, service, 'aws4_request']) key = createHmac('sha256', key).update(part).digest()
  const signature = createHmac('sha256', key).update(toSign).digest('hex')
  const out: Record<string, string> = {
    authorization: `AWS4-HMAC-SHA256 Credential=${sts.AccessKeyID}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-security-token': sts.SessionToken,
  }
  if (method === 'POST') out['x-amz-content-sha256'] = payloadHash
  return out
}

/** content-crc32：小写 8 位十六进制。 */
export function crc32Hex(data: Uint8Array): string {
  let c = ~0
  for (const b of data) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ((~c) >>> 0).toString(16).padStart(8, '0')
}
