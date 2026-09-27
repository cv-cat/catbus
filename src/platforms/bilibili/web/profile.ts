import type { HeaderPairs } from '../../../core/http.js'

/**
 * 设备画像与请求头（上游 utils/fingerprint.py、builder/header.py）。
 * UA 锁在 Chrome 146，与 TLS 指纹（wreq-js 的 chrome_146）一致。
 */

export const PROFILE = {
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  secChUa: '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  secChUaPlatform: '"Windows"',
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  screenWidth: 2560,
  screenHeight: 1440,
  browserResolution: '2560-1215',
  colorDepth: 24,
  deviceMemory: 8,
  hardwareConcurrency: 20,
  timezone: 'Asia/Shanghai',
  webglVersion: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  webglVendor: 'Google Inc. (NVIDIA)',
} as const

export const BROWSER = 'chrome_146' as const

export const ORIGIN = {
  main: 'https://www.bilibili.com',
  live: 'https://live.bilibili.com',
  passport: 'https://passport.bilibili.com',
  member: 'https://member.bilibili.com',
  dynamic: 'https://t.bilibili.com',
  space: 'https://space.bilibili.com',
  search: 'https://search.bilibili.com',
} as const

export const API = 'https://api.bilibili.com'
export const LIVE_API = 'https://api.live.bilibili.com'
export const PASSPORT = 'https://passport.bilibili.com'
export const MEMBER = 'https://member.bilibili.com'

const ACCEPT_ENCODING = 'gzip, deflate, br, zstd'
const XHR_ACCEPT = 'application/json, text/plain, */*'
const DOC_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'

export type HeaderType = 'DOC' | 'GET' | 'POST' | 'FORM'

/** 有序请求头，对应上游的 Header 类：改值不影响位置，新键追加到末尾。 */
export class Headers {
  pairs: HeaderPairs = []

  set(key: string, value: string): this {
    const i = this.pairs.findIndex(([k]) => k === key)
    if (i >= 0) this.pairs[i] = [key, value]
    else this.pairs.push([key, value])
    return this
  }

  referer(url: string): this {
    return this.set('referer', url)
  }

  remove(key: string): this {
    this.pairs = this.pairs.filter(([k]) => k !== key)
    return this
  }

  /** 在 anchor 之前插入；anchor 不存在时追加。 */
  insertBefore(anchor: string, key: string, value: string): this {
    const i = this.pairs.findIndex(([k]) => k === anchor)
    if (i < 0) return this.set(key, value)
    this.pairs = this.pairs.filter(([k]) => k !== key)
    this.pairs.splice(
      this.pairs.findIndex(([k]) => k === anchor),
      0,
      [key, value],
    )
    return this
  }

  get(): HeaderPairs {
    return this.pairs
  }
}

/**
 * 构造一组顺序与 Chrome 一致的请求头（上游 HeaderBuilder.build）。
 * same_origin 时 `sec-fetch-site` 为 same-origin，且 GET 不带 origin。
 */
export function headers(type: HeaderType = 'GET', options: { origin?: string; accept?: string; sameOrigin?: boolean } = {}): Headers {
  const origin = options.origin ?? ORIGIN.main
  const h = new Headers()
  h.set('sec-ch-ua', PROFILE.secChUa)
  h.set('sec-ch-ua-mobile', '?0')
  h.set('sec-ch-ua-platform', PROFILE.secChUaPlatform)
  if (type === 'DOC') {
    h.set('upgrade-insecure-requests', '1')
    h.set('user-agent', PROFILE.ua)
    h.set('accept', options.accept ?? DOC_ACCEPT)
    h.set('sec-fetch-site', 'none')
    h.set('sec-fetch-mode', 'navigate')
    h.set('sec-fetch-user', '?1')
    h.set('sec-fetch-dest', 'document')
    h.set('accept-encoding', ACCEPT_ENCODING)
    h.set('accept-language', PROFILE.acceptLanguage)
    h.set('priority', 'u=0, i')
    return h
  }
  h.set('user-agent', PROFILE.ua)
  if (type === 'POST') h.set('content-type', 'application/json')
  else if (type === 'FORM') h.set('content-type', 'application/x-www-form-urlencoded')
  h.set('accept', options.accept ?? XHR_ACCEPT)
  if (!(options.sameOrigin && type === 'GET')) h.set('origin', origin)
  h.set('sec-fetch-site', options.sameOrigin ? 'same-origin' : 'same-site')
  h.set('sec-fetch-mode', 'cors')
  h.set('sec-fetch-dest', 'empty')
  h.set('referer', origin + '/')
  h.set('accept-encoding', ACCEPT_ENCODING)
  h.set('accept-language', PROFILE.acceptLanguage)
  h.set('priority', 'u=1, i')
  return h
}

/** 浏览器实抓的 Cookie 顺序（上游 utils/device.py COOKIE_ORDER）。 */
export const COOKIE_ORDER = [
  'buvid3',
  'b_nut',
  '_uuid',
  'home_feed_column',
  'buvid4',
  'browser_resolution',
  'buvid_fp',
  'LIVE_BUVID',
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'theme-tip-show',
  'CURRENT_FNVAL',
  'sid',
  'rpdid',
  'PVID',
  'CURRENT_QUALITY',
  'bili_ticket',
  'bili_ticket_expires',
  'ogv_device_support_dolby',
  'ogv_device_support_hdr',
  'b_lsid',
]

export const COOKIE_DOMAIN = '.bilibili.com'
