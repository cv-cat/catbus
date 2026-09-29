import { readFileSync } from 'node:fs'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'

/**
 * x-tt-session-dtrait 里的内层设备特征 blob（上游 utils/dtrait_features.py 的 build_blob、utils/dtrait_profile.py）。
 *
 * 结构逆自 `@byted/uc-secure-dtrait-core` 的字节码 VM：`[1 字节头][bool 位图][字符串特征段]`，整体 base64。
 * - 头字节 = `(reserved << 6) | (dTraitType << 5) | (accessType << 4) | version`
 * - bool 位图：`(floor(maxIdx/32)+1) * 5` 字节，第 n 个 bool 落在 `buf[5*(floor(n/32)+1) - floor((n%32)/8) - 1]` 的第 `n%8` 位
 * - 字符串特征：34 条，每条 5 字节 = `[tag][murmur3 大端 4 字节]`；`str_1..str_33` → tag 32..64，`str_34` → 71
 *
 * canvas / WebGL / audio / 字体像素这类特征必须真实渲染，档案里直接存 murmur3 结果（render_hashes）；
 * 其余由档案字段现算。随包的默认档案 static/douyin/dtrait_profile.json 是上游从 Chrome 153 DevTools 取证固化的，原样复制。
 */

/** 算不出 blob 时的说明：默认档案随包提供，只有导入的档案坏了（或安装不完整）才会走到这里。 */
export const DTRAIT_BROKEN = '凭证里的 dtrait_profile 无效，或随包的默认设备档案缺失'
export const DTRAIT_HINT = '用 catbus douyin auth login --method cookie --cookie @<凭证 JSON> 重新导入有效的 dtrait_profile / dtrait_blob，或把它们设为 null 改用内置档案'

/** 档案无效时的错误（上游 _normalise_profile 在加载时就调 build_blob 校验）。 */
function invalid(message: string): never {
  throw new CatbusError('USAGE', `dtrait_profile 无效：${message}`)
}

const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)

/** str_N 的 tag（上游 STR_TAGS）。 */
const strTag = (n: number) => (n <= 33 ? 31 + n : 71)

/**
 * Math 指纹的取值（str_11 / str_12，上游 math_features）。入参全是字面常量（VM 的 fn#313），结果只取决于浏览器的 V8，
 * 所以直接写 Chrome 的值（与上游测试里 Chrome 153 抓到的 blob 一致），不在运行时现算：Node 自带的 V8 与 Chrome 的不同，
 * Node 24 实测 Math.atanh(0.5)、Math.log(3)、Math.expm1(1) 都差 1 ULP（上游同样把 expm1(1) 写成常量 _V8_EXPM1_1）。
 * 数值转字符串就是 JS 的 Number::toString（上游 js_number_to_str）。
 */
const MATH = {
  tan: -1.4214488238747245, // Math.tan(-1e300)
  atanh: 0.5493061443340549, // Math.atanh(0.5)
  atanhPolyfill: 0.5493061443340549, // SDK 自带的 atanh polyfill：Math.log((1 + 0.5) / (1 - 0.5)) / 2
  cos: -0.8390715290095377, // Math.cos(10.000000000123)
  expm1: 1.7182818284590453, // Math.expm1(1)
  powPi: 1.9275814160560206e-50, // Math.pow(Math.PI, -100)
  sin: 0.8178819121159085, // Math.sin(-1e300)
}

/** Math 指纹的特征串（VM 的 fn#313 拼接顺序）。 */
export function mathFeatures(): Record<number, string> {
  const m = MATH
  return {
    11: `${m.tan},${m.atanh},${m.atanhPolyfill},${m.cos}`,
    12: `${m.expm1},${m.powPi},${m.sin},${m.tan}`,
  }
}

/** MurmurHash3 x86 32 位，按 UTF-8 字节算（上游 murmur3_32，与 SDK 内的实现一致）。 */
export function murmur3(s: string, seed = 0): number {
  const data = Buffer.from(s, 'utf8')
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593
  let h = seed | 0
  const n = data.length & ~3
  for (let i = 0; i < n; i += 4) {
    let k = data.readUInt32LE(i)
    k = Math.imul(k, c1)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, c2)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) | 0
  }
  if (data.length > n) {
    let k = 0
    for (let i = n; i < data.length; i++) k |= data[i]! << (8 * (i - n))
    k = Math.imul(k, c1)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, c2)
    h ^= k
  }
  h ^= data.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** 直接当特征串用的字段（上游对它们直接取 murmur3，必须是字符串）。 */
const STRING_FIELDS = ['ua', 'notification_permission', 'hook_score']
/** 用逗号拼接的字符串列表。 */
const LIST_FIELDS = ['languages', 'str16_list', 'str18_list']
/** 拼进特征串的标量：字符串或数字。 */
const SCALAR_FIELDS = [
  'downlink', 'effective_type', 'language', 'vendor', 'platform', 'str17_tail', 'locale', 'timezone', 'str29_head', 'device_memory',
  'hardware_concurrency', 'max_touch_points', 'avail_height', 'avail_left', 'avail_top', 'avail_width', 'screen_height', 'screen_width',
  'color_depth', 'pixel_depth', 'device_pixel_ratio',
]

function checkFields(p: Record<string, unknown>): void {
  for (const k of STRING_FIELDS) if (typeof p[k] !== 'string') invalid(`缺少字符串字段 ${k}`)
  for (const k of LIST_FIELDS) {
    const v = p[k]
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) invalid(`${k} 要是字符串数组`)
  }
  for (const k of SCALAR_FIELDS) {
    const v = p[k]
    if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) invalid(`缺少字段 ${k}`)
  }
  for (const k of ['reserved', 'dtrait_type', 'version']) if (p[k] != null && !Number.isInteger(p[k])) invalid(`${k} 要是整数`)
}

/** 从档案字段现算的特征串，键是 str_N 的 N（上游 computed_features）。 */
export function computedFeatures(p: Record<string, any>): Record<number, string> {
  return {
    ...mathFeatures(),
    14: `${p.downlink},${p.effective_type}`,
    15: `${p.language},${p.languages.join(',')}`,
    16: `${p.str16_list.join(',')},${p.vendor}`,
    17: `${p.platform},${p.str17_tail}`,
    18: p.str18_list.join(','),
    19: p.ua,
    27: `${p.locale}+${p.timezone}`,
    28: p.notification_permission,
    29: `${p.str29_head},${p.device_memory},${p.hardware_concurrency},${p.max_touch_points}`,
    30: `${p.avail_height},${p.avail_left},${p.avail_top},${p.avail_width}`,
    31: `${p.screen_height},${p.screen_width}`,
    32: `${p.color_depth},${p.pixel_depth},${p.device_pixel_ratio}`,
    34: p.hook_score,
  }
}

/** bools / render_hashes 的键转成序号（上游 _normalise_profile 的 `int(key)`）。 */
function indexed(p: Record<string, unknown>, field: string): Map<number, unknown> {
  const v = p[field]
  if (!isObject(v)) invalid(`${field} 要是对象`)
  const out = new Map<number, unknown>()
  for (const [k, x] of Object.entries(v)) {
    const n = Number(k)
    if (!k.trim() || !Number.isInteger(n) || n < 0) invalid(`${field} 的键 ${k} 不是序号`)
    out.set(n, x)
  }
  return out
}

/** bool 特征的位图（上游 _bool_buffer，即 VM 的 getBoolBuffer）。 */
function boolBuffer(bools: Map<number, unknown>): Buffer {
  if (!bools.size) return Buffer.alloc(0)
  const keys = [...bools.keys()].sort((a, b) => a - b)
  const buf = Buffer.alloc((Math.floor(keys.at(-1)! / 32) + 1) * 5)
  for (const n of keys) {
    if (n % 32 === 0) buf[n / 32] = n / 8
    if (bools.get(n)) {
      const i = 5 * (Math.floor(n / 32) + 1) - Math.floor((n % 32) / 8) - 1
      buf[i] = buf[i]! | (1 << (n % 8))
    }
  }
  return buf
}

/**
 * 由设备档案生成内层 dtrait blob（base64）。档案的结构同 static/douyin/dtrait_profile.json：
 * `render_hashes`（渲染类特征的 murmur3）、`bools`，加上可算特征需要的字段。档案不完整时报 USAGE。
 * accessType：central 与 edge 侧都是 0（实测两者头字节都是 0x20）。
 */
export function buildBlob(profile: unknown, accessType = 0): string {
  if (!isObject(profile)) invalid('要是 JSON 对象')
  const bools = indexed(profile, 'bools')
  for (const [n, v] of bools) if (typeof v !== 'boolean') invalid(`bools 的 ${n} 要是 true / false`)
  const values = indexed(profile, 'render_hashes')
  checkFields(profile)
  for (const [n, s] of Object.entries(computedFeatures(profile))) values.set(Number(n), murmur3(s))
  const body = Buffer.alloc(34 * 5)
  for (let n = 1; n <= 34; n++) {
    const v = values.get(n)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) invalid(`render_hashes 缺少 ${n}，或不是 32 位无符号整数`)
    body[(n - 1) * 5] = strTag(n)
    body.writeUInt32BE(v, (n - 1) * 5 + 1)
  }
  const num = (k: string, fallback: number) => (profile[k] ?? fallback) as number
  const head = ((num('reserved', 0) & 0x3) << 6) | ((num('dtrait_type', 1) & 0x1) << 5) | ((accessType & 0x1) << 4) | (num('version', 0) & 0xf)
  return Buffer.concat([Buffer.from([head]), boolBuffer(bools), body]).toString('base64')
}

let defaults: Record<string, unknown> | undefined

/** 随包的默认设备档案（上游 load_dtrait_profile 的默认路径 utils/dtrait_profile.json）。 */
export function defaultProfile(): Record<string, unknown> {
  return (defaults ??= JSON.parse(readFileSync(staticFile('douyin', 'dtrait_profile.json'), 'utf8')))
}
