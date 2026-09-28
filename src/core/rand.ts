import { randomBytes } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * 随机数与时钟。平台代码一律经由这里取随机数和当前时间，不直接用 Math.random / Date.now，
 * 这样对拍测试可以换成确定性的序列（见 {@link deterministic}），与上游 Python 的输出逐字节比较。
 *
 * 各方法的推导公式与 scripts/golden/catbus_golden.py 里对 Python random 的替换一一对应，改动时两边一起改。
 */

let source: () => number = Math.random
let clock: () => number = Date.now

/** [0, 1) 的浮点数。对应 Python 的 `random.random()`。 */
export function random(): number {
  return source()
}

/** [a, b] 的整数，含两端。对应 `random.randint(a, b)`。 */
export function randint(a: number, b: number): number {
  return a + Math.floor(source() * (b - a + 1))
}

/** 对应 `random.uniform(a, b)`。 */
export function uniform(a: number, b: number): number {
  return a + (b - a) * source()
}

/** 对应 `random.choice(seq)`。 */
export function choice<T>(seq: ArrayLike<T>): T {
  return seq[Math.floor(source() * seq.length)]!
}

/** 从 alphabet 里取 n 个字符。对应 `''.join(random.choice(alphabet) for _ in range(n))`。 */
export function string(n: number, alphabet: string): string {
  let s = ''
  for (let i = 0; i < n; i++) s += choice(alphabet)
  return s
}

const TWOPI = 2 * Math.PI
let gaussNext: number | null = null

/**
 * 对应 `random.gauss(mu, sigma)`：Box-Muller 一次算出两个，第二个缓存到下一次调用（Python 的 `gauss_next`）。
 * 缓存在 {@link deterministic} 切换时清空。cos / sin / log 用的是 V8 的实现，与 C libm 可能差最后一位。
 */
export function gauss(mu = 0, sigma = 1): number {
  let z = gaussNext
  gaussNext = null
  if (z === null) {
    const x2pi = source() * TWOPI
    const g2rad = Math.sqrt(-2 * Math.log(1 - source()))
    z = Math.cos(x2pi) * g2rad
    gaussNext = Math.sin(x2pi) * g2rad
  }
  return mu + z * sigma
}

/** 对应 `random.sample(population, k)`（部分 Fisher-Yates）。 */
export function sample<T>(population: ArrayLike<T>, k: number): T[] {
  const pool = Array.from(population)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(source() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool.slice(0, k)
}

/** 原地打乱。对应 `random.shuffle(x)`。 */
export function shuffle<T>(x: T[]): T[] {
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(source() * (i + 1))
    ;[x[i], x[j]] = [x[j]!, x[i]!]
  }
  return x
}

/** n 个随机字节。对应 `os.urandom(n)` / `secrets.token_bytes(n)`。 */
export function bytes(n: number): Uint8Array {
  if (source === Math.random) return new Uint8Array(randomBytes(n))
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor(source() * 256)
  return out
}

/** 2n 位小写十六进制。对应 `secrets.token_hex(n)`。 */
export function hex(n: number): string {
  return Buffer.from(bytes(n)).toString('hex')
}

/** 对应 `str(uuid.uuid4())`。 */
export function uuid4(): string {
  const b = bytes(16)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Buffer.from(b).toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** 当前时间，毫秒。 */
export function now(): number {
  return clock()
}

/** 当前时间，秒（整数）。对应 `int(time.time())`。 */
export function nowSeconds(): number {
  return Math.floor(clock() / 1000)
}

/** 等待（毫秒）。确定性模式下不等，对应对拍时被替换成空操作的 `time.sleep`。 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (isDeterministic() || ms <= 0) return
  await delay(ms, undefined, { signal }).catch(() => {})
}

/** mulberry32：Python 侧有逐位相同的实现。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const DEFAULT_SEED = 20260927
export const DEFAULT_NOW = 1790000000123

/** 切换成确定性的随机数与固定时钟，返回恢复函数。只给测试用。 */
export function deterministic(options: { seed?: number; now?: number } = {}): () => void {
  const prev = [source, clock] as const
  source = mulberry32(options.seed ?? DEFAULT_SEED)
  gaussNext = null
  const fixed = options.now ?? DEFAULT_NOW
  clock = () => fixed
  return () => {
    ;[source, clock] = prev
    gaussNext = null
  }
}

/** 当前是否处于确定性模式（签名 vm 据此给脚本注入固定的 Math.random / Date）。 */
export function isDeterministic(): boolean {
  return source !== Math.random
}
