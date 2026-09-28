/**
 * 与 Python 标准库逐字节一致的编码函数。上游的签名常常算在 `urlencode` / `json.dumps` 的结果上，
 * 移植时必须产出同样的字符串，否则签名对不上。
 */

const ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/

export type Scalar = string | number | boolean | null | undefined
export type Pairs = [string, Scalar][]
export type PairsInit = Pairs | Record<string, Scalar>

export function toPairs(init: PairsInit | undefined): Pairs {
  if (!init) return []
  return Array.isArray(init) ? init : Object.entries(init)
}

/** Python 的 `str(value)`：True / False / None 的写法与 JS 不同。 */
export function pyStr(value: Scalar): string {
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (value == null) return 'None'
  return String(value)
}

/** 有限 double 的精确十进制：|x| = digits / 10^scale。 */
function exactDecimal(x: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, Math.abs(x))
  const bits = view.getBigUint64(0)
  const exponent = Number((bits >> 52n) & 0x7ffn)
  let mantissa = bits & ((1n << 52n) - 1n)
  let e = -1074
  if (exponent) {
    mantissa |= 1n << 52n
    e = exponent - 1075
  }
  if (e >= 0) return { digits: mantissa << BigInt(e), scale: 0 }
  return { digits: mantissa * 5n ** BigInt(-e), scale: -e }
}

/**
 * Python 的 `round(x, ndigits)`（float）：按 x 的精确二进制值舍入到 ndigits 位小数，恰好一半时取偶，
 * 结果为 0 时保留符号。`Number.prototype.toFixed` 在恰好一半时进位，不能直接用。
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x) || x === 0) return x
  const { digits, scale } = exactDecimal(x)
  if (scale <= ndigits) return x
  const divisor = 10n ** BigInt(scale - ndigits)
  let q = digits / divisor
  const twice = (digits % divisor) * 2n
  if (twice > divisor || (twice === divisor && q % 2n === 1n)) q += 1n
  const out = Number(`${q}e-${ndigits}`)
  return x < 0 ? -out : out
}

/**
 * Python 的 `str(float)` / `repr(float)`：最短往返表示；整数值带 `.0`；
 * 小于 1e-4 或不小于 1e16 时用指数形式，指数至少两位（`1e-05`）。
 */
export function pyFloatStr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  const abs = Math.abs(x)
  if (abs < 1e-4 || abs >= 1e16) {
    const [mantissa, exp] = x.toExponential().split('e') as [string, string]
    const sign = exp.startsWith('-') ? '-' : '+'
    return `${mantissa}e${sign}${exp.replace(/^[+-]/, '').padStart(2, '0')}`
  }
  const s = String(x)
  return s.includes('.') ? s : `${s}.0`
}

/** `urllib.parse.quote(s, safe)`，默认 safe 为 `/`。 */
export function quote(s: string, safe = '/'): string {
  let out = ''
  for (const byte of Buffer.from(s, 'utf8')) {
    const ch = String.fromCharCode(byte)
    out += byte < 0x80 && (ALWAYS_SAFE.test(ch) || safe.includes(ch)) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

/** `urllib.parse.quote_plus(s, safe)`：空格编码成 `+`。 */
export function quotePlus(s: string, safe = ''): string {
  return s.includes(' ') ? quote(s, safe + ' ').replaceAll(' ', '+') : quote(s, safe)
}

/** `urllib.parse.unquote(s)`。 */
export function unquote(s: string): string {
  return s.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => Buffer.from(m.replaceAll('%', ''), 'hex').toString('utf8'))
}

/** `urllib.parse.urlencode(pairs, safe=safe, quote_via=...)`，值先经 Python 的 `str()`。 */
export function urlencode(init: PairsInit, options: { safe?: string; via?: 'plus' | 'percent' } = {}): string {
  const q = options.via === 'percent' ? quote : quotePlus
  const safe = options.safe ?? ''
  return toPairs(init)
    .map(([k, v]) => `${q(k, safe)}=${q(pyStr(v), safe)}`)
    .join('&')
}

/** `urllib.parse.parse_qsl(query, keep_blank_values=True)`。 */
export function parseQsl(query: string): [string, string][] {
  return query
    .split(/[&;]/)
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=')
      const [k, v] = i < 0 ? [part, ''] : [part.slice(0, i), part.slice(i + 1)]
      return [unquote(k.replaceAll('+', ' ')), unquote(v.replaceAll('+', ' '))]
    })
}

const REQUOTE_SAFE = "!#$%&'()*+,/:;=?@[]~|"
const UNRESERVED = /[A-Za-z0-9\-._~]/

/** curl_cffi 的 `requote_uri`：已编码的部分保持不变，其余非法字符补上编码（requests 的版本不把 `|` 当安全字符）。 */
export function requoteUri(uri: string): string {
  // unquote_unreserved：%XX 表示的是非保留字符时解开
  const unreserved = uri.replace(/%([0-9A-Fa-f]{2})/g, (m, h: string) => {
    const ch = String.fromCharCode(parseInt(h, 16))
    return UNRESERVED.test(ch) ? ch : m.toUpperCase()
  })
  return quote(unreserved, REQUOTE_SAFE)
}

export interface DumpsOptions {
  /** 默认 `[', ', ': ']`，即 Python 的默认值。紧凑写法传 `[',', ':']`。 */
  separators?: [string, string]
  /** 默认 true：非 ASCII 字符写成 \uXXXX。 */
  ensureAscii?: boolean
}

const ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' }

function dumpString(s: string, ensureAscii: boolean): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    const code = s.charCodeAt(i)
    if (ESCAPES[ch]) out += ESCAPES[ch]
    else if (code < 0x20 || (ensureAscii && code > 0x7e)) out += '\\u' + code.toString(16).padStart(4, '0')
    else out += ch
  }
  return out + '"'
}

/**
 * `json.dumps(value, separators=..., ensure_ascii=...)`。对象按插入顺序输出，与 Python dict 一致。
 * 注意 JS 对象里形如整数的键（如 `"3064"`）总是排在最前；需要精确键序时传 Map。
 */
export function jsonDumps(value: unknown, options: DumpsOptions = {}): string {
  const [itemSep, keySep] = options.separators ?? [', ', ': ']
  const ascii = options.ensureAscii ?? true
  const dump = (v: unknown): string => {
    if (v === null || v === undefined) return 'null'
    if (v === true) return 'true'
    if (v === false) return 'false'
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity'
      return String(v)
    }
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string') return dumpString(v, ascii)
    if (Array.isArray(v)) return '[' + v.map(dump).join(itemSep) + ']'
    if (v instanceof Map) return '{' + [...v].map(([k, x]) => dumpString(String(k), ascii) + keySep + dump(x)).join(itemSep) + '}'
    if (typeof v === 'object') {
      return '{' + Object.entries(v as object).map(([k, x]) => dumpString(k, ascii) + keySep + dump(x)).join(itemSep) + '}'
    }
    throw new TypeError(`jsonDumps：不支持的类型 ${typeof v}`)
  }
  return dump(value)
}

/** 紧凑、不转义非 ASCII：`json.dumps(v, separators=(',', ':'), ensure_ascii=False)`。 */
export function compactJson(value: unknown): string {
  return jsonDumps(value, { separators: [',', ':'], ensureAscii: false })
}
