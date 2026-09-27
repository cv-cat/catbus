import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { staticFile } from '../../../core/paths.js'
import * as rand from '../../../core/rand.js'

/**
 * x-client-transaction-id（XCTID）纯算实现，移植自上游 utils/transaction.py。
 *
 * X 前端对**每个** API 请求现算一个一次性签名头。素材（key / 4 帧动画路径 / 4 个下标）
 * 来自登录页 app shell，一次会话内稳定；catbus 直接读打包进仓库的
 * `static/x/transaction_l1.json`（对应上游 `ClientTransaction.from_cached`）。
 *
 * 算法：由素材算出稳定的 animation_key，再对 `method!path!t{KEYWORD}{anim_key}` 取 sha256，
 * 拼上 key_bytes + t 的 4 字节小端 + digest[:16] + [3]，最后混入一个随机字节做 base64（去 =）。
 * 因为末尾混入随机字节，同输入不同输出；固定随机源时可逐字节对拍。
 */

const EPOCH_SECONDS = 1682924400
const DEFAULT_KEYWORD = 'obfiowerehiring'
const ADDITIONAL_RANDOM_NUMBER = 3
const TOTAL_TIME = 4096

interface Profile {
  key: string
  frames: string[]
  indices: number[]
}

let cached: ClientTransaction | null = null

/** 打包进仓库的 XCTID 素材（对拍与离线都用它，不发网络）。 */
export function transaction(): ClientTransaction {
  if (!cached) {
    const profile = JSON.parse(readFileSync(staticFile('x', 'transaction_l1.json'), 'utf8')) as Profile
    cached = new ClientTransaction(profile.key, profile.frames, profile.indices)
  }
  return cached
}

function bezier(a: number, b: number, m: number): number {
  return 3.0 * a * (1 - m) * (1 - m) * m + 3.0 * b * (1 - m) * m * m + m * m * m
}

/** cubic-bezier(c0, c1, c2, c3) 求值，逐行对齐上游 Cubic.get_value。 */
function cubicValue(c: number[], target: number): number {
  let startGradient = 0
  let endGradient = 0
  let start = 0
  let end = 1
  let mid = 0
  if (target <= 0.0) {
    if (c[0]! > 0.0) startGradient = c[1]! / c[0]!
    else if (!c[1] && c[2]! > 0.0) startGradient = c[3]! / c[2]!
    return startGradient * target
  }
  if (target >= 1.0) {
    if (c[2]! < 1.0) endGradient = (c[3]! - 1.0) / (c[2]! - 1.0)
    else if (c[2] === 1.0 && c[0]! < 1.0) endGradient = (c[1]! - 1.0) / (c[0]! - 1.0)
    return 1.0 + endGradient * (target - 1.0)
  }
  while (start < end) {
    mid = (start + end) / 2
    const estimate = bezier(c[0]!, c[2]!, mid)
    if (Math.abs(target - estimate) < 0.00001) return bezier(c[1]!, c[3]!, mid)
    if (estimate < target) start = mid
    else end = mid
  }
  return bezier(c[1]!, c[3]!, mid)
}

function interpolate(from: number[], to: number[], f: number): number[] {
  return from.map((a, i) => a * (1 - f) + to[i]! * f)
}

function rotationMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180
  return [Math.cos(rad), -Math.sin(rad), Math.sin(rad), Math.cos(rad)]
}

/** 复刻上游 _float_to_hex：整数部分逐位取余，小数部分逐位展开。 */
function floatToHex(x: number): string {
  const result: string[] = []
  let quotient = Math.trunc(x)
  let fraction = x - quotient
  while (quotient > 0) {
    quotient = Math.trunc(x / 16)
    const remainder = Math.trunc(x - quotient * 16)
    result.unshift(remainder > 9 ? String.fromCharCode(remainder + 55) : String(remainder))
    x = quotient
  }
  if (fraction === 0) return result.join('')
  result.push('.')
  while (fraction > 0) {
    fraction *= 16
    const integer = Math.trunc(fraction)
    fraction -= integer
    result.push(integer > 9 ? String.fromCharCode(integer + 55) : String(integer))
  }
  return result.join('')
}

function solve(value: number, minVal: number, maxVal: number, rounding: boolean): number {
  const result = (value * (maxVal - minVal)) / 255 + minVal
  return rounding ? Math.floor(result) : Math.round(result * 100) / 100
}

function isOdd(num: number): number {
  return num % 2 ? -1.0 : 0.0
}

export class ClientTransaction {
  private readonly keyBytes: number[]
  private readonly animationKey: string

  constructor(
    private readonly key: string,
    private readonly frames: string[],
    private readonly indices: number[],
  ) {
    this.keyBytes = [...Buffer.from(key, 'base64')]
    this.animationKey = this.buildAnimationKey()
  }

  /** 选中的帧路径按 'C' 切成若干行数字（上游 _frame_rows）。 */
  private frameRows(): number[][] {
    const frame = this.frames[this.keyBytes[5]! % 4]!
    return frame
      .slice(9)
      .split('C')
      .map((segment) =>
        segment
          .replace(/[^\d]+/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((x) => parseInt(x, 10)),
      )
  }

  private buildAnimationKey(): string {
    const rowIndex = this.keyBytes[this.indices[0]!]! % 16
    let frameTime = 1
    for (const index of this.indices.slice(1)) frameTime *= this.keyBytes[index]! % 16
    const rows = this.frameRows()
    return ClientTransaction.animate(rows[rowIndex]!, frameTime / TOTAL_TIME)
  }

  private static animate(frameRow: number[], targetTime: number): string {
    const fromColor = [...frameRow.slice(0, 3), 1].map(Number)
    const toColor = [...frameRow.slice(3, 6), 1].map(Number)
    const fromRotation = [0.0]
    const toRotation = [solve(Number(frameRow[6]), 60.0, 360.0, true)]
    const curves = frameRow.slice(7).map((v, i) => solve(Number(v), isOdd(i), 1.0, false))
    const progress = cubicValue(curves, targetTime)
    const color = interpolate(fromColor, toColor, progress).map((v) => Math.max(v, 0))
    const rotation = interpolate(fromRotation, toRotation, progress)
    const matrix = rotationMatrix(rotation[0]!)
    const parts: string[] = color.slice(0, -1).map((v) => Math.round(v).toString(16))
    for (const value of matrix) {
      const rounded = Math.abs(Math.round(value * 100) / 100)
      const hexValue = floatToHex(rounded)
      if (hexValue.startsWith('.')) parts.push(`0${hexValue}`.toLowerCase())
      else parts.push(hexValue || '0')
    }
    parts.push('0', '0')
    return parts.join('').replace(/[.-]/g, '')
  }

  /**
   * 算一个 XCTID。path 必须是不含 query 的 pathname。
   * timeNow / randomByte 仅供对拍覆盖。
   */
  generate(method: string, path: string, timeNow?: number, randomByte?: number): string {
    const t = timeNow ?? rand.nowSeconds() - EPOCH_SECONDS
    const timeBytes = [0, 1, 2, 3].map((i) => (t >>> (i * 8)) & 0xff)
    const message = `${method}!${path}!${t}${DEFAULT_KEYWORD}${this.animationKey}`
    const digest = createHash('sha256').update(message).digest()
    const payload = [...this.keyBytes, ...timeBytes, ...digest.subarray(0, 16), ADDITIONAL_RANDOM_NUMBER]
    const rnd = randomByte ?? rand.randint(0, 255)
    const out = Buffer.from([rnd, ...payload.map((b) => b ^ rnd)])
    return out.toString('base64').replace(/=+$/, '')
  }
}
