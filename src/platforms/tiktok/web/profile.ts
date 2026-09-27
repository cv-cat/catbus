import type { HeaderPairs } from '../../../core/http.js'
import { quote, quotePlus } from '../../../core/py.js'

/**
 * 浏览器画像、请求头与 query 构造（上游 builder/auth.py 的常量、builder/header.py、builder/params.py）。
 * UA 是上游取证用的 Chrome 153；TLS 指纹用 wreq-js 最新的 Chrome 画像。
 */

export const PROFILE = {
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  secChUa: '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
  secChUaPlatform: '"Windows"',
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  clientAbVersions:
    '70508271,72437276,73720540,75360573,75657507,75843653,75878361,' +
    '76074824,76122410,76179551,76403724,76499369,76626930,76651230,' +
    '76669176,76713103,76740102,76792575,76805936,76813520,76815102,' +
    '76826749,76839930,76840792,76887350,76889673,76907405,76933422,' +
    '76945954,76950455,77005875,77011497,77014490,77056281,77064650,' +
    '77071444,77093404,77120364,77141446,77150562,77155134,70138197,' +
    '70156809,70405643,71057832,71200802,71381811,71803300,72360691,' +
    '72408100,72854054,72892778,73171280,73208420,73989921,74276218,' +
    '74844724,75330961',
} as const

export const BROWSER = 'chrome' as const

export const ORIGIN = 'https://www.tiktok.com'
export const WEBCAST = 'https://webcast.tiktok.com'
export const SHOP = 'https://shop.tiktok.com'
export const COOKIE_DOMAIN = '.tiktok.com'

/** 浏览器端可覆盖的画像字段（会话 JSON 里给出时用它，否则用上面的默认值）。 */
export interface Browser {
  ua: string
  secChUa: string
  secChUaPlatform: string
  acceptLanguage: string
}

/** 有序请求头，对应上游的 OrderedDict：改值不动位置，新键追加到末尾。 */
export class Headers {
  map = new Map<string, string>()

  set(key: string, value: string | null | undefined): this {
    if (value != null) this.map.set(key, String(value))
    return this
  }

  get(key: string): string | undefined {
    return this.map.get(key)
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  delete(key: string): this {
    this.map.delete(key)
    return this
  }

  update(values: Record<string, string> | Map<string, string> | undefined): this {
    for (const [k, v] of values instanceof Map ? values : Object.entries(values ?? {})) this.set(k, v)
    return this
  }

  /** 按给定顺序重排；不在表里的键保持原顺序排在后面。drop 为 true 时丢掉表外的键。 */
  reorder(order: readonly string[], drop = false): this {
    const next = new Map<string, string>()
    for (const k of order) if (this.map.has(k)) next.set(k, this.map.get(k)!)
    if (!drop) for (const [k, v] of this.map) if (!next.has(k)) next.set(k, v)
    this.map = next
    return this
  }

  /** 发送用的键值对。cookie 由 cookie 罐按 URL 补上（位置由 core 决定），这里去掉。 */
  pairs(): HeaderPairs {
    return [...this.map].filter(([k]) => k !== 'cookie')
  }
}

export type HeaderType = 'DOC' | 'GET' | 'POST' | 'FORM'

/** 上游 HeaderBuilder.build：只放浏览器在该类请求里实际发出的字段。cookie 占位，保持与上游相同的相对顺序。 */
export function buildHeaders(
  type: HeaderType,
  b: Browser,
  o: { referer: string; origin?: string; contentLength?: string | null; secFetchSite?: string },
): Headers {
  const h = new Headers()
  if (type === 'DOC') {
    h.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7')
    h.set('accept-language', b.acceptLanguage)
    h.set('cache-control', 'no-cache')
    h.set('pragma', 'no-cache')
    h.set('priority', 'u=0, i')
    h.set('referer', o.referer)
    h.set('sec-ch-ua', b.secChUa)
    h.set('sec-ch-ua-mobile', '?0')
    h.set('sec-ch-ua-platform', b.secChUaPlatform)
    h.set('sec-fetch-dest', 'document')
    h.set('sec-fetch-mode', 'navigate')
    h.set('sec-fetch-site', 'same-origin')
    h.set('sec-fetch-user', '?1')
    h.set('upgrade-insecure-requests', '1')
    h.set('user-agent', b.ua)
    h.set('cookie', '')
    return h
  }
  h.set('sec-ch-ua-platform', b.secChUaPlatform)
  h.set('referer', o.referer)
  h.set('user-agent', b.ua)
  h.set('sec-ch-ua', b.secChUa)
  h.set('sec-ch-ua-mobile', '?0')
  if (type === 'POST') h.set('content-type', 'application/json')
  else if (type === 'FORM') h.set('content-type', 'application/x-www-form-urlencoded')
  h.set('accept', '*/*')
  h.set('accept-encoding', 'gzip, deflate, br, zstd')
  h.set('accept-language', b.acceptLanguage)
  h.set('cookie', '')
  if (o.origin) h.set('origin', o.origin)
  if (o.contentLength != null) h.set('content-length', o.contentLength)
  h.set('priority', 'u=1, i')
  h.set('sec-fetch-dest', 'empty')
  h.set('sec-fetch-mode', 'cors')
  h.set('sec-fetch-site', o.secFetchSite ?? 'same-origin')
  return h
}

// ================================================================ query（builder/params.py）

const SIGNATURE_SAFE = new Set(['X-Dynosaur', 'X-Gnarly', 'msToken'])

export type QueryValue = string | number | boolean | null | undefined

/** 保持插入顺序、按 TikTok 浏览器规则转义的 query。 */
export class Params {
  pairs: [string, string][] = []

  constructor(
    values: Iterable<readonly [string, QueryValue]> = [],
    readonly spacePlusKeys: ReadonlySet<string> = new Set(),
  ) {
    for (const [k, v] of values) this.add(k, v)
  }

  /** add_param：同名键只保留最新的一个，追加到末尾。 */
  add(key: string, value: QueryValue): this {
    const v = pyValue(value)
    this.pairs = this.pairs.filter(([k]) => k !== key)
    this.pairs.push([key, v])
    return this
  }

  /** add_pair：允许重复键（直播 im/fetch 的两个 version_code）。 */
  addPair(key: string, value: QueryValue): this {
    this.pairs.push([key, pyValue(value)])
    return this
  }

  update(values: Record<string, QueryValue> | Iterable<readonly [string, QueryValue]>): this {
    const entries = Symbol.iterator in Object(values) ? (values as Iterable<readonly [string, QueryValue]>) : Object.entries(values)
    for (const [k, v] of entries) this.add(k, v)
    return this
  }

  /** 原样复制（保留重复键）。 */
  clone(): Params {
    const p = new Params([], this.spacePlusKeys)
    p.pairs = this.pairs.map(([k, v]) => [k, v])
    return p
  }

  get(key: string): string | undefined {
    return this.pairs.findLast(([k]) => k === key)?.[1]
  }

  toQuery(): string {
    return this.pairs
      .map(([key, value]) => {
        const safe = SIGNATURE_SAFE.has(key) ? '/=+.-_~' : key === 'next' ? ':' : '-_.~'
        const enc = this.spacePlusKeys.has(key) ? quotePlus : quote
        return `${quote(key, '-_.~')}=${enc(value, safe)}`
      })
      .join('&')
  }
}

/** Python 的 `"" if value is None else str(value)`。 */
function pyValue(value: QueryValue): string {
  if (value == null) return ''
  if (value === true) return 'True'
  if (value === false) return 'False'
  return String(value)
}
