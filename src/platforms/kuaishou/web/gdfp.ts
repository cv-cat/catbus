import { createHash } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import type { HttpResponse } from '../../../core/http.js'
import { compactJson } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { Ks } from './client.js'
import { PROFILE, RESOLUTION } from './profile.js'

/**
 * gdfp manMachine 预检（上游 utils/gdfp_manmachine.py）：滑块提交 verify 之前必须先上报的行为遥测。
 * SDK_INIT（换策略，上报路径由它下发）→ core `/n/a/b` → 等策略里的 wait 毫秒 → whole `/n/a/b`。
 * 不做这一步直接提交，服务端回 350014 anti check err。
 *
 * 分辨率、平台、CPU、WebGL 与屏幕尺寸取自统一的浏览器档案 {@link PROFILE}，与请求头和 captchaExtraParam 一致。
 *
 * 响应按上游严格校验：状态码、content-type、响应体逐字节。协议版本不查：上游抓包时是 HTTP/2，现在默认也接受
 * HTTP/1.1（有的网络上这个接口只协商出 HTTP/1.1，只认 HTTP/2 会让验证码永远走不到 verify；设
 * KS_STRICT_GDFP_HTTP2=1 才恢复只认 HTTP/2），而 catbus 的 HttpResponse 本来就拿不到协商的协议版本。
 */

export const APP_KEY = '10001001'
export const SECRET_KEY = 'f2fff381c551a8dcdb765e316f3d44ac'
const CORE_DATA_LOGGER_ID = '10001002'
const RM_VERSION = '1.6.0'
const HOST = 'https://gdfp.gifshow.com'
const URL_STRATEGY = '/s/u/v'
export const URL_CORE_REPORT = '/n/a/b'
const BUSS_TYPE_MAN_MACHINE = 'manMachine'
const FLAG = 2
const RESPONSE_CONTENT_TYPE = 'application/json;charset=UTF-8'
const CAPTCHA_ORIGIN = 'https://captcha.zt.kuaishou.com'

export const MAN_MACHINE_INIT_RESPONSE =
  '{"result":1,"error_msg":"","antispamPluginRsp":' +
  '"eyJzd2l0Y2giOjEsIm1heEJhdGNoTGVuZ3RoIjo1MCwid2FpdCI6MTAwMCwiZW5hYmxlTmF0aXZlIjoxLCJqc3ZlciI6IjEuMC4xIiwicmVwb3J0Q29uZmlnIjp7InJlcG9ydFVybHMiOlsiL24vYS9iIl19LCJwb2xpY3lJZCI6MjU0LCJwdmVyIjoiMS4wLjIiLCJzdGF0dXMiOjF9"}'
export const REPORT_RESPONSE = '{"result":1,"error_msg":""}'

const MAN_MACHINE_INIT_CONFIG = {
  switch: 1,
  maxBatchLength: 50,
  wait: 1000,
  enableNative: 1,
  jsver: '1.0.1',
  reportConfig: { reportUrls: ['/n/a/b'] },
  policyId: 254,
  pver: '1.0.2',
  status: 1,
}

const SCRIPT_BASE = 'https://p23-plat.wskwai.com/kos/nlav111449/technology-platform/static/captcha/js'
export const CAPTCHA_SCRIPT_URLS = [
  `${SCRIPT_BASE}/weblogger.2e328f42.js`,
  `${SCRIPT_BASE}/chunk-vendors.39300a01.js`,
  `${SCRIPT_BASE}/encrypt.ee7d2a41.js`,
  `${SCRIPT_BASE}/iframe/index.c9ae8c81.js`,
]

const PDF = 'Portable Document Format'
const PLUGIN_LIST = compactJson(
  ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer', 'Microsoft Edge PDF Viewer', 'WebKit built-in PDF'].map((name) => ({
    name,
    filename: 'internal-pdf-viewer',
    description: PDF,
  })),
)
const MIME_LIST = compactJson([
  { type: 'application/pdf', description: PDF },
  { type: 'text/pdf', description: PDF },
])
const PERMISSION_STATES = (
  [
    ['speaker', 'error'],
    ['device-info', 'error'],
    ['bluetooth', 'error'],
    ['ambient-light-sensor', 'error'],
    ['clipboard', 'error'],
    ['nfc', 'error'],
    ['geolocation', 'denied'],
    ['notifications', 'denied'],
    ['push', 'denied'],
    ['midi', 'denied'],
    ['camera', 'denied'],
    ['microphone', 'denied'],
    ['background-fetch', 'prompt'],
    ['background-sync', 'granted'],
    ['persistent-storage', 'prompt'],
    ['accelerometer', 'granted'],
    ['gyroscope', 'granted'],
    ['magnetometer', 'granted'],
    ['display-capture', 'denied'],
  ] as const
).map(([permissionName, state]) => ({ permissionName, state }))
const CORE_NATIVE_FINGERPRINT = { cf: 585, ch: '3b4de2be29905d2bcc3812d4fa039bc3', ff: 166, fh: '7daf378bafe0d3babac2696177d5de0d', el: 33, eh: 'dc4d3e06840e103f3e77747a82029aa9' }
const WHOLE_NATIVE_FINGERPRINT = {
  pc: 134,
  ph: '594d639a69bb0bdf419c1c14ccbb560a',
  wf: 1159,
  wh: '6a9ba63fd2cbda1ce03b5204db881cac',
  cf: 585,
  ch: '3b4de2be29905d2bcc3812d4fa039bc3',
  mf: 1052,
  mh: '3bbcec74126d8f15aa514a6c7b4179f8',
  ff: 166,
  fh: '7daf378bafe0d3babac2696177d5de0d',
  af: 1031,
  ah: '744f127aa70ee2cd33f97f47cf641a77',
  gr: 598,
  gh: '54a77c38470096d9684100f3909f3109',
  el: 33,
  eh: 'dc4d3e06840e103f3e77747a82029aa9',
  ow: 19748,
  oh: '4f323cba12d2aba1b62665eb7b260b40',
  ky: 33,
  kh: '61792d30f54bedfe1007347e9fdc4223',
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex')

/** `md5(appKey + secretKey + 秒级时间戳)`。 */
export const signFor = (ts: number | string) => md5(`${APP_KEY}${SECRET_KEY}${ts}`)

/** gdfp 请求地址（appkey / seckey / bussType / timestamp / sign）。 */
export function buildUrl(path: string, bussType = BUSS_TYPE_MAN_MACHINE, tsSeconds?: number, extra = ''): string {
  const ts = tsSeconds ?? rand.nowSeconds()
  return `${HOST}${path}?appkey=${APP_KEY}&seckey=${SECRET_KEY}&bussType=${bussType}&timestamp=${ts}&sign=${signFor(ts)}${extra}`
}

function scriptList(scriptUrls: string[] = []): string[] {
  const out = [...CAPTCHA_SCRIPT_URLS]
  for (const url of scriptUrls) if (url && !out.includes(url)) out.push(url)
  return out
}

function cookieFingerprint(cookies: [string, string][]): { ci: number; ih: string } {
  const line = cookies.map(([k, v]) => `${k}=${v}`).join('; ')
  return { ci: [...line].length, ih: md5(line) }
}

function callStack(kind: 'core' | 'whole'): string {
  const base = CAPTCHA_SCRIPT_URLS[0]
  const frames: [string, number | null][] =
    kind === 'whole'
      ? [
          ['printCallStack', 34236],
          ['RiskMgt._this.generateModuleSection', 77458],
          ['RiskMgt.<anonymous>', 84095],
          ['', 4825],
          ['Object.next', 4930],
          ['', 3857],
          ['newPromise(<anonymous>)', null],
          ['__awaiter', 3602],
          ['RiskMgt.sendWholeData', 83975],
          ['RiskMgt.<anonymous>', 83076],
        ]
      : [
          ['printCallStack', 34236],
          ['RiskMgt._this.generateCoreModuleSection', 79648],
          ['RiskMgt.<anonymous>', 83773],
          ['', 4825],
          ['Object.next', 4930],
          ['', 3857],
          ['newPromise(<anonymous>)', null],
          ['__awaiter', 3602],
          ['RiskMgt.sendCoreData', 83346],
          ['n', 82235],
        ]
  return frames.map(([name, offset]) => (offset == null ? `at${name}` : name ? `at${name}(${base}:1:${offset})` : `at${base}:1:${offset}`)).join('')
}

function timings(begin: number, now: number, whole = false): Record<string, number> {
  const values: Record<string, number> = { cs: begin + 246, ce: begin + 250, as: begin + 255, ae: begin + 259, cae: begin + 338, ls: now }
  if (whole) Object.assign(values, { le: begin + 472, cre: begin + 688, gs: begin + 492, ge: begin + 515 })
  return values
}

const afterMozilla = (ua: string) => (ua.includes('Mozilla/') ? ua.slice(ua.indexOf('Mozilla/') + 'Mozilla/'.length) : ua)

export interface PayloadInput {
  did: string
  /** gdfp 能看到的验证码页 cookie（按线序，重复名字保留后一个值、前一个位置）。 */
  cookies: [string, string][]
  parentUrl: string
  iframeUrl: string
  ua: string
  /** 默认取档案的屏幕尺寸。 */
  resolution?: string
  identity: string
  nowMs: number
  beginMs: number
  sessionId: string
  scriptUrls?: string[]
}

/**
 * `generateCoreModuleSection` 的产物（`/n/a/b` 第一次上报）。
 * 字段号都是递增的，普通对象里形如整数的键按数值升序输出，与上游的插入顺序一致。
 */
export function buildCorePayload(o: PayloadInput): Record<string, unknown> {
  const resolution = o.resolution || RESOLUTION
  const section = {
    1: { page: o.parentUrl, identity: o.identity, page_type: 2 },
    2: o.iframeUrl,
    5: o.sessionId,
    7: Object.fromEntries(o.cookies),
    8: resolution,
    11: o.ua,
    17: o.did,
    21: { type: 'PAGE_ENTER', timestamp: o.nowMs - 20, initTime: o.beginMs },
    28: sha1(`${o.did}${o.parentUrl}${resolution}${o.ua}${o.iframeUrl}`),
    33: 'Mozilla',
    34: 'Netscape',
    35: afterMozilla(o.ua),
    36: PROFILE.platform,
    55: 0,
    56: o.ua,
    69: '0043c0b8a0b002e8133a140d14068859',
    75: '1',
    76: '',
    77: scriptList(o.scriptUrls),
    79: callStack('core'),
    82: { ...CORE_NATIVE_FINGERPRINT, ...cookieFingerprint(o.cookies) },
    89: timings(o.beginMs, o.nowMs),
    102: 50,
    108: {},
  }
  return { 1: o.did, 3: CORE_DATA_LOGGER_ID, 6: BUSS_TYPE_MAN_MACHINE, 7: 10, 9: o.nowMs, 10: '', 12: APP_KEY, 13: '', 14: RM_VERSION, module_section: [section] }
}

const LETTERS_DIGITS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** _webrtc_fields：每个 iframe 现生成的 mDNS 主机名、端口、ICE 凭据、证书指纹与 SDP。 */
export function webrtcFields(): [candidates: string, sdp: string] {
  const mdns1 = `${rand.uuid4()}.local`
  const mdns2 = `${rand.uuid4()}.local`
  const port1 = rand.randint(50000, 59998)
  const port2 = rand.randint(50000, 59998)
  const ufrag = rand.string(4, LETTERS_DIGITS)
  const pwd = rand.string(24, LETTERS_DIGITS + '+/')
  const fingerprint = Array.from({ length: 32 }, () =>
    Math.floor(rand.random() * 256)
      .toString(16)
      .toUpperCase()
      .padStart(2, '0'),
  ).join(':')
  // randint(10**18, 10**19 - 1)：超出 double 的整数范围，用 BigInt 做加法
  const session = (10n ** 18n + BigInt(Math.floor(rand.random() * 9e18))).toString()
  const candidates =
    `;candidate:1801140675 1 udp 2113937151 ${mdns1} ${port1} typ host generation 0 ufrag ${ufrag} network-cost 999` +
    `;candidate:1070259456 1 udp 2113939711 ${mdns2} ${port2} typ host generation 0 ufrag ${ufrag} network-cost 999`
  const candidate1 = `a=candidate:1801140675 1 udp 2113937151 ${mdns1} ${port1} typ host generation 0 network-cost 999\r\n`
  const candidate2 = `a=candidate:1070259456 1 udp 2113939711 ${mdns2} ${port2} typ host generation 0 network-cost 999\r\n`
  const prefix =
    `v=0\r\no=- ${session} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n` +
    'a=group:BUNDLE 0\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\n' +
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
    'c=IN IP4 0.0.0.0\r\n'
  const suffix =
    `a=ice-ufrag:${ufrag}\r\na=ice-pwd:${pwd}\r\n` +
    `a=ice-options:trickle\r\na=fingerprint:sha-256 ${fingerprint}\r\n` +
    'a=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n'
  // Chrome 的 promise 先在第一个 host candidate 时 resolve，第二个收集完再来一次：两段 `;v=0`
  const sdp = `;${prefix}${candidate1}${suffix};${prefix}${candidate1}${candidate2}${suffix}`
  return [candidates, sdp]
}

/** `sendWholeData` 的完整上报（第二次 `/n/a/b`）。 */
export function buildWholePayload(o: PayloadInput & { reportPath?: string }): Record<string, unknown> {
  const resolution = o.resolution || RESOLUTION
  const [candidates, sdp] = webrtcFields()
  const section = {
    1: { page: o.parentUrl, identity: o.identity, page_type: 2 },
    2: o.iframeUrl,
    4: CAPTCHA_ORIGIN,
    5: o.sessionId,
    6: 'captcha',
    7: Object.fromEntries(o.cookies),
    8: resolution,
    9: 360,
    10: 360,
    11: o.ua,
    12: 'NT 10.0',
    13: 'zh-CN',
    14: 'Windows',
    17: o.did,
    21: { type: 'PAGE_ENTER', timestamp: o.beginMs + 491, initTime: o.beginMs },
    24: '10',
    25: '10-1',
    26: '0',
    28: sha1(`${o.did}${o.parentUrl}${resolution}${o.ua}${o.iframeUrl}`),
    29: o.reportPath ?? URL_CORE_REPORT,
    30: 'production',
    31: 1,
    32: '0.00',
    33: 'Mozilla',
    34: 'Netscape',
    35: afterMozilla(o.ua),
    36: PROFILE.platform,
    37: '["zh-CN","zh","en","zh-TW","ja"]',
    41: '20030107',
    42: 'Google Inc.',
    43: '',
    44: PROFILE.cpuCores,
    50: 10,
    51: '',
    52: 1,
    53: 'Gecko',
    54: true,
    55: 0,
    56: o.ua,
    57: 'zh-CN',
    58: PLUGIN_LIST,
    59: MIME_LIST,
    61: PROFILE.webglVendor,
    62: PROFILE.webglRenderer,
    63: '1',
    64: 'WebKit',
    65: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
    66: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
    67: 0,
    68: 'f3bd24f5b153d57f5817372fd5f22573',
    69: '0043c0b8a0b002e8133a140d14068859',
    70: 'ba6689f9a1550fb5eef25d1fc682c8c1',
    75: '1',
    76: '',
    77: scriptList(o.scriptUrls),
    78: { w: { pc: 1256, kc: 255, lc: 261 }, n: { pc: 0, kc: 0, lc: 82 } },
    79: callStack('whole'),
    80: '2200',
    81: '1032',
    82: { ...WHOLE_NATIVE_FINGERPRINT, ...cookieFingerprint(o.cookies) },
    85: candidates,
    86: sdp,
    87: { w: PROFILE.screenWidth, h: PROFILE.screenHeight, c: 24, p: 24 },
    88: md5(sdp),
    89: timings(o.beginMs, o.nowMs, true),
    90: '',
    100: 11,
    101: { lsc: 10, ssc: 2 },
    102: 50,
    103: { en: false, isF: false },
    104: { ts: o.beginMs + 520, cts: o.beginMs + 520 },
    105: '0',
    106: PERMISSION_STATES.map((p) => ({ ...p })),
    107: -8,
    108: {},
  }
  return { 1: o.did, 3: APP_KEY, 6: BUSS_TYPE_MAN_MACHINE, 7: 10, 9: o.nowMs, 10: '', 12: APP_KEY, 13: '', 14: RM_VERSION, module_section: [section] }
}

/** 外层封装：`{"flag":2,"data":"<base64(JSON)>"}`。 */
export function encodeBody(payload: unknown): string {
  return compactJson({ flag: FLAG, data: Buffer.from(compactJson(payload), 'utf8').toString('base64') })
}

/** `/s/u/v?type=SDK_INIT` 的 body：`{"data":"<base64>","flag":2}`（发空 body 会被回 PARAM_INVALID）。 */
export function buildInitBody(did: string, sdkVer = RM_VERSION, pver = '0.0.0', platform = 3, bussType = BUSS_TYPE_MAN_MACHINE): string {
  const inner = compactJson({ device_id: did, sdkver: sdkVer, pver, hp: bussType, platform })
  return compactJson({ data: Buffer.from(inner, 'utf8').toString('base64'), flag: FLAG })
}

/** 解 SDK_INIT 响应里的 `antispamPluginRsp`（base64 的 JSON）；`/n/a/b` 这个上报路径就是从这里下发的。 */
export function parseInitResponse(resp: any): Record<string, any> {
  const blob = String(resp?.antispamPluginRsp ?? '')
  if (!blob) return {}
  try {
    return JSON.parse(Buffer.from(blob, 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

async function validate(res: HttpResponse, role: string, expected: string): Promise<any> {
  const fail = (why: string) => new CatbusError('UPSTREAM', `gdfp manMachine ${role} ${why}`, { detail: { kind: 'captcha', status: res.status } })
  if (res.status !== 200) throw fail(`HTTP 状态不是 200：${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (type !== RESPONSE_CONTENT_TYPE) throw fail(`content-type 偏离：${type}`)
  const raw = await res.text()
  if (raw !== expected) throw fail(`响应体偏离：${raw.slice(0, 200)}`)
  return JSON.parse(raw)
}

export interface ReportInput {
  did: string
  cookies: [string, string][]
  parentUrl: string
  iframeUrl: string
  ua: string
  resolution?: string
  identity?: string
  scriptUrls?: string[]
}

/** 完整的 manMachine 预检：SDK_INIT → core /n/a/b → whole /n/a/b。 */
export async function report(ks: Ks, o: ReportInput): Promise<{ identity: string; init: any; config: Record<string, any>; core: any; whole: any }> {
  const identity = o.identity || rand.uuid4()
  const sessionId = rand.uuid4()
  const beginMs = rand.now()
  const headers: [string, string][] = [
    ['user-agent', o.ua],
    ['content-type', 'text/plain;charset=UTF-8'],
    ['referer', o.iframeUrl],
    ['accept', '*/*'],
    ['accept-encoding', 'gzip, deflate, br, zstd'],
    ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7,ja;q=0.6'],
    ['origin', CAPTCHA_ORIGIN],
    ['priority', 'u=1, i'],
    ['sec-fetch-dest', 'empty'],
    ['sec-fetch-mode', 'cors'],
    ['sec-fetch-site', 'cross-site'],
  ]
  const post = (url: string, body: string) => ks.http.request({ method: 'POST', url, headers, body, cookies: false, timeout: 30 })

  // 1) SDK_INIT：换策略，上报路径由它下发
  const init = await validate(await post(buildUrl(URL_STRATEGY, BUSS_TYPE_MAN_MACHINE, undefined, '&type=SDK_INIT'), buildInitBody(o.did)), 'SDK_INIT', MAN_MACHINE_INIT_RESPONSE)
  if (Object.keys(init).join() !== 'result,error_msg,antispamPluginRsp' || init.result !== 1 || init.error_msg !== '') {
    throw new CatbusError('UPSTREAM', 'gdfp manMachine SDK_INIT 响应偏离', { detail: { kind: 'captcha' } })
  }
  const config = parseInitResponse(init)
  if (compactJson(config) !== compactJson(MAN_MACHINE_INIT_CONFIG)) {
    throw new CatbusError('UPSTREAM', 'gdfp manMachine 策略偏离，拒绝继续', { detail: { kind: 'captcha', config } })
  }
  const path = String(config.reportConfig.reportUrls[0])

  // 2) 行为遥测
  const common = { ...o, identity, beginMs, sessionId }
  const corePayload = buildCorePayload({ ...common, nowMs: rand.now() })
  const core = await validate(await post(buildUrl(path), encodeBody(corePayload)), 'core report', REPORT_RESPONSE)

  // 3) SDK 策略里的 wait 隔开 core 与 whole 两次上报
  await rand.sleep(Number(config.wait))
  const wholePayload = buildWholePayload({ ...common, nowMs: rand.now(), reportPath: path })
  const whole = await validate(await post(buildUrl(path), encodeBody(wholePayload)), 'whole report', REPORT_RESPONSE)
  return { identity, init, config, core, whole }
}
