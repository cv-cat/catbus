import { md5Hex } from '../../../core/hash.js'
import * as rand from '../../../core/rand.js'

/**
 * 知乎 web 端的请求签名：`x-zse-93` 与 `x-zse-96`。
 *
 * 知乎前端在 JSVMP 里实现（static.zhihu.com/heifetz 的 webpack 模块 1514，`__g._encrypt`），这里用 TS 重写：
 * - 签名源串：`[x-zse-93, 路径 + query, d_c0, 请求体（字符串且不超过 4096 字节时）, x-zst-81]`，去掉空项后用 `+` 连接；
 * - `x-zse-96` = `2.0_` + encrypt(md5(源串))。
 *
 * encrypt：md5 十六进制串前面加 [随机字节, 0]，补 14 到 48 字节；第一块与固定 IV、42 异或后过一次分组加密（SM4 结构，
 * S 盒与轮密钥取自前端的 `h.zb` / `h.zk`），后两块做 CBC；每 4 字节的最后一字节再异或 58，整体反转，每 3 字节按小端
 * 拆成 4 个 6 位，查自定义字母表。第二个字节在前端 VM 检测到非浏览器环境时会变成别的值，服务端按 0 校验。
 */

export const ZSE_93 = '101_3_3.0'
export const ZSE_96_VERSION = '2.0'

const ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rg'

const IV = [48, 53, 57, 48, 53, 51, 102, 55, 100, 49, 53, 101, 48, 49, 100, 55]

const ZK = [
  1170614578, 1024848638, 1413669199, -343334464, -766094290, -1373058082, -143119608, -297228157, 1933479194,
  -971186181, -406453910, 460404854, -547427574, -1891326262, -1679095901, 2119585428, -2029270069, 2035090028,
  -1521520070, -5587175, -77751101, -2094365853, -1243052806, 1579901135, 1321810770, 456816404, -1391643889,
  -229302305, 330002838, -788960546, 363569021, -1947871109,
]

const ZB = [
  20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230, 93, 252, 205,
  90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217, 153, 15, 103, 80, 189, 71, 191,
  97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148, 86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151,
  85, 77, 124, 254, 18, 4, 26, 123, 176, 232, 193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196,
  229, 1, 192, 213, 27, 110, 56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239,
  251, 127, 81, 11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
  174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82, 165, 67, 169,
  225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70, 234, 163, 219, 108, 170,
  166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136, 206, 135, 175, 195, 25, 92, 121, 208, 126,
  139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184, 49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179,
  210, 134, 250, 201, 164, 89, 216, 202, 220, 50, 221, 152, 140, 33, 235, 214,
]

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))

function readU32(b: number[], i: number): number {
  return ((b[i]! & 255) << 24) | ((b[i + 1]! & 255) << 16) | ((b[i + 2]! & 255) << 8) | (b[i + 3]! & 255)
}

function writeU32(x: number, out: number[], i: number): void {
  out[i] = (x >>> 24) & 255
  out[i + 1] = (x >>> 16) & 255
  out[i + 2] = (x >>> 8) & 255
  out[i + 3] = x & 255
}

function tau(x: number): number {
  const t = [0, 0, 0, 0]
  writeU32(x, t, 0)
  const r = readU32(t.map((v) => ZB[v]!), 0)
  return r ^ rotl(r, 2) ^ rotl(r, 10) ^ rotl(r, 18) ^ rotl(r, 24)
}

/** 一个 16 字节分组的加密（前端的 `__g.r`）。 */
function encryptBlock(block: number[]): number[] {
  const k = [readU32(block, 0), readU32(block, 4), readU32(block, 8), readU32(block, 12)]
  for (let r = 0; r < 32; r++) k[r + 4] = k[r]! ^ tau(k[r + 1]! ^ k[r + 2]! ^ k[r + 3]! ^ ZK[r]!)
  const out: number[] = []
  writeU32(k[35]!, out, 0)
  writeU32(k[34]!, out, 4)
  writeU32(k[33]!, out, 8)
  writeU32(k[32]!, out, 12)
  return out
}

/**
 * `__g._encrypt`：md5 十六进制串 → 64 个字符。`seed` 是前端 `Math.random() * 127` 取整得到的首字节，
 * `flag` 是第二个字节（浏览器里为 0）。
 */
export function encrypt(md5: string, seed: number, flag = 0): string {
  const data = [seed, flag, ...[...md5].map((c) => c.charCodeAt(0))]
  while (data.length < 48) data.push(14)
  let prev = encryptBlock(data.slice(0, 16).map((v, i) => v ^ IV[i]! ^ 42))
  const bytes = [...prev]
  for (let i = 16; i < 48; i += 16) {
    const p = prev
    prev = encryptBlock(data.slice(i, i + 16).map((v, j) => v ^ p[j]!))
    bytes.push(...prev)
  }
  for (let i = 47; i >= 0; i -= 4) bytes[i]! ^= 58
  bytes.reverse()
  let s = ''
  for (let i = 0; i < 48; i += 3) {
    const n = bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)
    for (let j = 0; j < 4; j++) s += ALPHABET[(n >>> (6 * j)) & 63]
  }
  return s
}

/** 签名源串（前端的拼接方式）。`body` 超过 4096 字节时不参与签名。 */
export function signSource(pathAndQuery: string, dc0: string, body?: string | null, zst81?: string | null): string {
  const signedBody = body && Buffer.byteLength(body) <= 4096 ? body : null
  return [ZSE_93, pathAndQuery, dc0, signedBody, zst81].filter(Boolean).join('+')
}

/** `x-zse-96` 的值。随机数只经 core/rand。 */
export function zse96(pathAndQuery: string, dc0: string, body?: string | null): string {
  const seed = Math.floor(rand.random() * 127)
  return `${ZSE_96_VERSION}_${encrypt(md5Hex(signSource(pathAndQuery, dc0, body)), seed)}`
}
