import type { HeaderPairs } from '../../../core/http.js'

/**
 * 设备画像、请求头与公共 query（上游 utils/fingerprint.py、builder/header.py、builder/params.py）。
 * UA 是 Chrome 151（上游实录）；wreq-js 最新的 TLS 画像是 chrome_149，与上游 curl_cffi 用 chrome150 画像配 151 UA 的做法一致。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

export const PROFILE = {
  ua: UA,
  secChUa: '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  secChUaPlatform: '"Windows"',
  browserName: 'Chrome',
  browserVersion: '151.0.0.0',
  engineVersion: '151.0.0.0',
  platform: 'Win32',
  osVersion: '10',
  cpuCoreNum: '20',
  deviceMemory: '32',
  screenWidth: '2560',
  screenHeight: '1440',
  webglVendor: 'Google Inc. (NVIDIA)',
  webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5060 Ti (0x00002D04) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6',
  /** inner w/h、outer w/h、avail w/h、screen w/h。 */
  geo: [2560, 1215, 2560, 1392, 2560, 1392, 2560, 1440] as const,
  screenX: 0,
  screenY: 0,
} as const

/** navigator.appVersion：UA 去掉 `Mozilla/` 前缀。 */
export const APP_VERSION = UA.replace('Mozilla/', '')

export const BROWSER = 'chrome_149' as const

export const WWW = 'https://www.douyin.com'
export const LIVE = 'https://live.douyin.com'
export const CREATOR = 'https://creator.douyin.com'
export const LOGIN = 'https://login.douyin.com'

/** 只在 www.douyin.com 上的 host-only cookie（上游 builder/auth.py ensure_http_session 的 www_only）。 */
export const WWW_ONLY = new Set([
  's_v_web_id',
  '__ac_nonce',
  '__ac_signature',
  'x-web-secsdk-uid',
  'dy_swidth',
  'dy_sheight',
  'device_web_cpu_core',
  'device_web_memory_size',
  'architecture',
  'fpk1',
  'fpk2',
])

// ---------------------------------------------------------------- 请求头

/** 有序请求头，对应上游 Header：改值不影响位置，新键追加到末尾。 */
export class Headers {
  pairs: HeaderPairs = []

  set(key: string, value: string): this {
    const i = this.pairs.findIndex(([k]) => k === key)
    if (i >= 0) this.pairs[i] = [key, value]
    else this.pairs.push([key, value])
    return this
  }

  get(key: string): string | undefined {
    return this.pairs.find(([k]) => k === key)?.[1]
  }

  referer(url: string): this {
    return this.set('referer', url)
  }

  remove(...keys: string[]): this {
    this.pairs = this.pairs.filter(([k]) => !keys.includes(k))
    return this
  }

  list(): HeaderPairs {
    return this.pairs
  }
}

export type HeaderType = 'DOC' | 'GET' | 'POST' | 'FORM' | 'PROTOBUF'

/** 上游 HeaderBuilder.build。 */
export function headers(type: HeaderType = 'GET'): Headers {
  const h = new Headers()
  if (type === 'DOC') {
    for (const [k, v] of [
      ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
      ['accept-language', PROFILE.acceptLanguage],
      ['cache-control', 'no-cache'],
      ['cookie', ''],
      ['pragma', 'no-cache'],
      ['priority', 'u=0, i'],
      ['sec-ch-ua', PROFILE.secChUa],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', PROFILE.secChUaPlatform],
      ['sec-fetch-dest', 'document'],
      ['sec-fetch-mode', 'navigate'],
      ['sec-fetch-site', 'none'],
      ['sec-fetch-user', '?1'],
      ['upgrade-insecure-requests', '1'],
      ['user-agent', PROFILE.ua],
    ] as const)
      h.set(k, v)
    return h
  }
  h.set('user-agent', PROFILE.ua)
  if (type === 'POST') h.set('accept', '*/*').set('content-type', 'application/json; charset=UTF-8')
  else if (type === 'FORM') h.set('accept', 'application/json, text/plain, */*').set('content-type', 'application/x-www-form-urlencoded; charset=UTF-8')
  else if (type === 'PROTOBUF') h.set('accept', 'application/x-protobuf').set('content-type', 'application/x-protobuf')
  else h.set('accept', 'application/json, text/plain, */*')
  h.set('sec-ch-ua', PROFILE.secChUa)
  h.set('sec-ch-ua-mobile', '?0')
  h.set('sec-ch-ua-platform', PROFILE.secChUaPlatform)
  h.set('accept-language', PROFILE.acceptLanguage)
  h.set('priority', 'u=1, i')
  h.set('sec-fetch-dest', 'empty')
  h.set('sec-fetch-mode', 'cors')
  h.set('sec-fetch-site', 'same-origin')
  return h
}

// ---------------------------------------------------------------- query

/** 有序参数，对应上游 Params（一个 dict）：已有的键原位改值，新键追加。 */
export class Params {
  readonly map = new Map<string, string>()

  add(key: string, value: unknown): this {
    this.map.set(key, value == null ? '' : String(value))
    return this
  }

  update(pairs: Iterable<readonly [string, unknown]>): this {
    for (const [k, v] of pairs) this.add(k, v)
    return this
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  pairs(): [string, string][] {
    return [...this.map]
  }

  /** 上游 toString：`k=v` 原样拼接，不编码。 */
  raw(): string {
    return this.pairs()
      .map(([k, v]) => `${k}=${v}`)
      .join('&')
  }
}

/** www.douyin.com 的公共 query 组（上游 with_platform，不带 auth 的部分）。 */
export function platformParams(roundTripTime = '0', versionCode = '170400', versionName = '17.4.0'): [string, string][] {
  return [
    ['device_platform', 'webapp'],
    ['aid', '6383'],
    ['channel', 'channel_pc_web'],
    ['update_version_code', '170400'],
    ['pc_client_type', '1'],
    ['pc_libra_divert', 'Windows'],
    ['support_h265', '1'],
    ['support_dash', '1'],
    ['cpu_core_num', PROFILE.cpuCoreNum],
    ['version_code', versionCode],
    ['version_name', versionName],
    ['cookie_enabled', 'true'],
    ['screen_width', PROFILE.screenWidth],
    ['screen_height', PROFILE.screenHeight],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', PROFILE.browserName],
    ['browser_version', PROFILE.browserVersion],
    ['browser_online', 'true'],
    ['engine_name', 'Blink'],
    ['engine_version', PROFILE.engineVersion],
    ['os_name', 'Windows'],
    ['os_version', '10'],
    ['device_memory', PROFILE.deviceMemory],
    ['platform', 'PC'],
    ['downlink', '10'],
    ['effective_type', '4g'],
    ['round_trip_time', roundTripTime],
  ]
}

/** live.douyin.com 电商接口的公共 query 组（上游 with_live_platform）。 */
export function livePlatformParams(roundTripTime = '50'): [string, string][] {
  return [
    ['update_version_code', '170400'],
    ['pc_client_type', '1'],
    ['pc_libra_divert', 'Windows'],
    ['support_h265', '1'],
    ['support_dash', '0'],
    ['cpu_core_num', PROFILE.cpuCoreNum],
    ['version_code', '320100'],
    ['version_name', '32.1.0'],
    ['cookie_enabled', 'true'],
    ['screen_width', PROFILE.screenWidth],
    ['screen_height', PROFILE.screenHeight],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', PROFILE.browserName],
    ['browser_version', PROFILE.browserVersion],
    ['browser_online', 'true'],
    ['engine_name', 'Blink'],
    ['engine_version', PROFILE.engineVersion],
    ['os_name', 'Windows'],
    ['os_version', '10'],
    ['device_memory', PROFILE.deviceMemory],
    ['platform', 'PC'],
    ['downlink', '10'],
    ['effective_type', '4g'],
    ['round_trip_time', roundTripTime],
  ]
}

/** creator.douyin.com 的固定 query 组（上游 with_creator_platform）。 */
export function creatorPlatformParams(): [string, string][] {
  return [
    ['cookie_enabled', 'true'],
    ['screen_width', PROFILE.screenWidth],
    ['screen_height', PROFILE.screenHeight],
    ['browser_language', 'zh-CN'],
    ['browser_platform', 'Win32'],
    ['browser_name', 'Mozilla'],
    ['browser_version', APP_VERSION],
    ['browser_online', 'true'],
    ['timezone_name', 'Asia/Shanghai'],
    ['aid', '1128'],
    ['support_h265', '1'],
  ]
}
