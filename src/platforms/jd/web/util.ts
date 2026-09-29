import * as n from '../../../core/normalize.js'
import { pyStr, type Scalar } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { DEFAULT_AREA } from './profile.js'

/** 纯算工具（上游 utils/jd_util.py、utils/jd_cookie.py、utils/trace_headers.py、utils/aks.py 的编码部分）。 */

export { sha256Hex } from '../../../core/hash.js'

/** 浏览器复制的 Cookie 头 → 有序的 name → value（trans_cookies）。 */
export function transCookies(cookie: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of (cookie ?? '').split(';')) {
    const item = raw.trim()
    if (!item || !item.includes('=')) continue
    const i = item.indexOf('=')
    out.set(item.slice(0, i).trim(), item.slice(i + 1).trim())
  }
  return out
}

/** 去掉搜索结果里的高亮标签。 */
export function stripTags(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/<[^>]+>/g, '')
}

/** 仿浏览器的 jQuery jsonp 回调名（jQuery2905208）。 */
export function randomJqueryCallback(): string {
  return `jQuery${rand.randint(1000000, 9999999)}`
}

/** 咚咚 WS 的 `_wid_`：8-4-4-4-12 的随机十六进制。 */
export function generateWid(): string {
  const seg = () => rand.randint(0x10000, 0x1ffff).toString(16).slice(1)
  return `${seg()}${seg()}-${seg()}-${seg()}-${seg()}-${seg()}${seg()}${seg()}`
}

/** 咚咚会话 ID（getSessionId）。 */
export function sessionId(pin: string, app: string, venderId: string): string {
  return `${pin.toLowerCase()}:${app}:${venderId}`
}

/** 风控埋点的逐字符 XOR 5（对合）。 */
export function xor5(text: string): string {
  let out = ''
  for (const ch of text) out += String.fromCodePoint(ch.codePointAt(0)! ^ 5)
  return out
}

/** 从 `ipLoc-djd` 取收货地区；full 时保留 `.addressId` 后缀（area_of）。 */
export function areaOf(cookies: Map<string, string>, full = false): string {
  const raw = (cookies.get('ipLoc-djd') ?? '').trim()
  let area = raw ? raw.replaceAll('-', '_') : DEFAULT_AREA
  if (!full) area = area.split('.')[0]!
  return area
}

/** 搜索页用 `__jda` 的第二段作 uuid，缺省为 -1（search_uuid_of）。 */
export function searchUuidOf(cookies: Map<string, string>): string {
  const fields = String(cookies.get('__jda') ?? '').split('.')
  if (fields.length > 1 && fields[1] !== '' && fields[1] !== '-') return fields[1]!
  return '-1'
}

/** JS `encodeURIComponent`（jQuery.param 用的编码，aks.encode_component）。 */
export function encodeComponent(value: Scalar): string {
  const s = value == null ? '' : pyStr(value)
  let out = ''
  for (const byte of Buffer.from(s, 'utf8')) {
    const ch = String.fromCharCode(byte)
    out += byte < 0x80 && /[A-Za-z0-9\-_.!~*'()]/.test(ch) ? ch : '%' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

/** 按 jQuery 的方式序列化有序键值对（aks.encode_query_pairs）。 */
export function encodeQueryPairs(pairs: [string, Scalar][]): string {
  return pairs.map(([k, v]) => `${encodeComponent(k)}=${encodeComponent(v)}`).join('&')
}

// ---------------------------------------------------------------- 埋点 cookie 冷启动（utils/jd_cookie.py）

/** 各站点的埋点 siteId。 */
export const SITE_IDS: Record<string, string> = {
  www: '122270672',
  search: '143920055',
  item: '122270672',
  passport: '95931165',
  chat: '23334881',
}

/** `__jdu` = 13 位毫秒时间戳 + 10 位随机数字。 */
export function generateJdu(): string {
  return `${rand.now()}${rand.randint(10 ** 9, 10 ** 10 - 1)}`
}

/** `__jdu` / `__jdc` / `__jda` / `__jdb` / `__jdv` 一组埋点 cookie。 */
export function trackingCookies(site = 'search', jdu?: string, source = 'direct', visitCount = 1, pv = 1): [string, string][] {
  const siteId = SITE_IDS[site] ?? SITE_IDS.www!
  const u = jdu || generateJdu()
  const ms = rand.now()
  const sec = Math.floor(ms / 1000)
  return [
    ['__jdu', u],
    ['__jdc', siteId],
    ['__jda', `${siteId}.${u}.${sec}.${sec}.${sec}.${visitCount}`],
    ['__jdb', `${siteId}.${pv}.${u}|${visitCount}.${sec}`],
    ['__jdv', `${siteId}|${source}|-|direct|-|${ms}`],
  ]
}

/** 给空会话灌冷启动 cookie（bootstrap）：埋点 cookie + 收货地区。 */
export function bootstrapCookies(site = 'search', area?: string): [string, string][] {
  const a = area || DEFAULT_AREA.replaceAll('_', '-')
  return [...trackingCookies(site), ['areaId', a.split('-')[0]!], ['ipLoc-djd', a]]
}

// ---------------------------------------------------------------- 登录页 SGM / JDAS 链路头（utils/trace_headers.py）

/** 取 `secrets.randbits(k)`：与对拍框架的 getrandbits 一致，每 32 位一个随机数。 */
function randbits(k: number): bigint {
  let out = 0n
  let shift = 0n
  while (k > 0) {
    const bits = Math.min(k, 32)
    out |= BigInt(Math.floor(rand.random() * 2 ** bits)) << shift
    shift += BigInt(bits)
    k -= bits
  }
  return out
}

/** RFC 9562 UUIDv7。 */
export function uuid7(): string {
  const ts = BigInt(rand.now()) & ((1n << 48n) - 1n)
  const randA = randbits(12)
  const randB = randbits(62)
  let v = (ts << 80n) | (0x7n << 76n) | (randA << 64n)
  v |= (0b10n << 62n) | randB
  const h = v.toString(16).padStart(32, '0')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** sgm-web 3.3.0 的数字 key。 */
function sgmKey(): string {
  let out = ''
  for (const ch of '1000-1000-4000-8000-1000000') {
    if (!'018'.includes(ch)) {
      out += ch
      continue
    }
    const digit = Number(ch)
    const shift = Math.trunc(digit / 4)
    const part = Number(randbits(8)) & (15 >> shift)
    out += String(digit ^ part)
  }
  const value = out.replaceAll('-', '').slice(0, 18)
  return BigInt(value || '0').toString()
}

/** 登录页的 `#uuid` 取作 JDAS-Page-Id。 */
export function pageIdFromHtml(html: string): string {
  const inputs = html.match(/<input\b[^>]*>/gi) ?? []
  for (const tag of inputs) {
    const attrs = parseAttrs(tag)
    if (attrs.id === 'uuid' && attrs.value) return attrs.value.trim()
  }
  throw new Error('登录页 HTML 缺少 #uuid，无法生成 JDAS-Page-Id')
}

/** 一个 input 标签的属性（小写名 → 值，实体已解码）。 */
export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '')
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const name = m[1]!.toLowerCase()
    if (name in out) continue
    out[name] = n.unescapeHtml(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}


/** 同一登录页内的链路上下文：Page-Id 取自页面，Session-Id 页面内复用（LoginTraceContext）。 */
export class TraceContext {
  constructor(
    readonly pageId: string,
    readonly sessionId: string = (() => {
      const g = uuid7()
      return g.slice(0, -4) + '0001'
    })(),
  ) {}

  static fromHtml(html: string): TraceContext {
    return new TraceContext(pageIdFromHtml(html))
  }

  nextHeaders(): Record<string, string> {
    const key = sgmKey()
    return {
      'sgm-context': `${key};${key}`,
      'jdas-trace-id': uuid7(),
      'jdas-page-id': this.pageId,
      'jdas-session-id': this.sessionId,
    }
  }
}
