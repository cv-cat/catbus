import { spawn } from 'node:child_process'
import { createCipheriv, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CatbusError } from '../../../core/errors.js'
import type { HttpResponse } from '../../../core/http.js'
import { staticFile } from '../../../core/paths.js'
import { compactJson, jsonDumps, parseQsl, quote, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import * as api from './api.js'
import type { Douyin } from './client.js'
import { clientDataCookie, clientDataV2Cookie, generateEcKey } from './crypto.js'
import { commonBehavior, commonReport } from './mssdk.js'
import { headers as baseHeaders, LOGIN, Params, PROFILE, WWW } from './profile.js'
import { aidSign, md5Hex, passportEncrypt, passportSign, sdkTs, spliceUrl, svWebId, uaAesUrlsafe } from './sign.js'

/**
 * 登录（上游 dy_apis/login_api.py 的 DYLoginApi，默认的 chrome_current 画像）：
 * 页面 bootstrap → challenge → 扫码轮询 / 短信验证码 → 跟随重定向落 cookie。
 * 登录响应的 bd-ticket-guard-server-data 下发 ticket / ts_sign / client_cert，签给登录前自己生成的 P-256 公钥。
 */

// ---------------------------------------------------------------- cookie 视图（上游 scoped_cookies）

const WWW_ONLY = ['s_v_web_id', '__ac_nonce', '__ac_signature', 'x-web-secsdk-uid', 'dy_swidth', 'dy_sheight', 'device_web_cpu_core', 'device_web_memory_size', 'architecture', 'fpk1', 'fpk2']

const LOGIN_ORDER = [
  'enter_pc_once', 'UIFID_TEMP', 'is_support_rtm_web_ts', 'hevc_supported', 'IsDouyinActive', 'home_can_add_dy_2_desktop',
  'stream_recommend_feed_params', 'odin_tt', 'strategyABtestKey', 'passport_csrf_token', 'passport_csrf_token_default', 'ttwid',
  '__security_mc_1_s_sdk_crypt_sdk', 'bd_ticket_guard_regenerate_keys_time', 'bd_ticket_guard_client_data', 'bd_ticket_guard_client_web_domain',
  'bd_ticket_guard_client_data_v2', 'biz_trace_id', 'sdk_source_info', 'bit_env', 'gulu_source_res', 'passport_auth_mix_state',
]
const SMS_ORDER = [
  'enter_pc_once', 'UIFID_TEMP', 'odin_tt', 'is_support_rtm_web_ts', 'hevc_supported', 'IsDouyinActive', 'home_can_add_dy_2_desktop',
  'stream_recommend_feed_params', 'strategyABtestKey', 'is_dash_user', 'passport_csrf_token', 'passport_csrf_token_default', 'ttwid',
  'biz_trace_id', '__security_mc_1_s_sdk_crypt_sdk', 'bd_ticket_guard_regenerate_keys_time', 'bd_ticket_guard_client_data',
  'bd_ticket_guard_client_web_domain', 'bd_ticket_guard_client_data_v2', 'sdk_source_info', 'bit_env', 'gulu_source_res', 'passport_auth_mix_state',
]
const SMS_HISTORICAL_ONLY = ['MONITOR_WEB_ID', 'UIFID', 'download_guide']
const CHALLENGE_ORDER = [
  'enter_pc_once', 'UIFID_TEMP', 'odin_tt', 'is_support_rtm_web_ts', 'hevc_supported', 'IsDouyinActive', 'home_can_add_dy_2_desktop',
  'stream_recommend_feed_params', 'strategyABtestKey', 'is_dash_user', 'passport_csrf_token', 'passport_csrf_token_default', 'ttwid', 'biz_trace_id',
  '__security_mc_1_s_sdk_crypt_sdk', 'bd_ticket_guard_regenerate_keys_time', 'bd_ticket_guard_client_data', 'bd_ticket_guard_client_web_domain',
]
const QR_ORDER = [...CHALLENGE_ORDER, 'bd_ticket_guard_client_data_v2', 'sdk_source_info', 'bit_env', 'gulu_source_res', 'passport_auth_mix_state']
const QR_REFRESH_ORDER = [
  ...CHALLENGE_ORDER, 'bd_ticket_guard_client_data_v2', 'gulu_source_res', 'download_guide', 'sdk_source_info', 'bit_env', 'passport_auth_mix_state',
]
const TTWID_ORDER = [
  'enter_pc_once', 'UIFID_TEMP', 'odin_tt', 'is_support_rtm_web_ts', 'hevc_supported', 'IsDouyinActive', 'home_can_add_dy_2_desktop',
  'stream_recommend_feed_params', 'strategyABtestKey', 'ttwid', 'is_dash_user', 'biz_trace_id', 'passport_csrf_token', 'passport_csrf_token_default',
]
const WWW_PAGE = [
  '__ac_nonce', '__ac_signature', 'enter_pc_once', 'UIFID_TEMP', 'x-web-secsdk-uid', 's_v_web_id', 'odin_tt', 'douyin.com', 'device_web_cpu_core',
  'device_web_memory_size', 'architecture', 'is_support_rtm_web_ts', 'hevc_supported', 'IsDouyinActive', 'home_can_add_dy_2_desktop', 'dy_swidth',
  'dy_sheight', 'stream_recommend_feed_params', 'strategyABtestKey',
]
const WWW_BOOTSTRAP_ORDER = [...WWW_PAGE, 'ttwid', 'is_dash_user', 'biz_trace_id', 'passport_csrf_token', 'passport_csrf_token_default']
const WWW_TTWID_ORDER = ['__ac_nonce', '__ac_signature', 'ttwid', ...WWW_PAGE.slice(2)]
const WWW_GUIDING_ORDER = [...WWW_PAGE, 'ttwid', 'is_dash_user', 'biz_trace_id']
const TICKET_GUARD_ORDER = [
  ...WWW_PAGE.slice(0, 19), 'is_dash_user', 'passport_csrf_token', 'passport_csrf_token_default', 'fpk1', 'fpk2', 'ttwid', 'biz_trace_id',
  '__security_mc_1_s_sdk_crypt_sdk', 'bd_ticket_guard_regenerate_keys_time',
]
const HEADER_ORDER = [
  'web-sdk-version', 'x-tt-session-dtrait', 'referer', 'x-tt-passport-aid-sign', 'x-tt-passport-csrf-token', 'x-tt-passport-trace-id', 'user-agent', 'accept',
  'content-type', 'x-tt-passport-verify-portrait', 'accept-encoding', 'accept-language', 'content-length', 'origin', 'priority', 'sec-fetch-dest',
  'sec-fetch-mode', 'sec-fetch-site',
]
const HEADER_ORDER_QR = [
  'web-sdk-version', 'sec-ch-ua-platform', 'x-tt-session-dtrait', 'referer', 'sec-ch-ua', 'x-tt-passport-aid-sign', 'sec-ch-ua-mobile',
  'x-tt-passport-csrf-token', 'x-tt-passport-trace-id', 'user-agent', 'accept', 'content-type', 'x-tt-passport-verify-portrait', 'accept-language',
  'origin', 'priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
]

const PASSPORT_SDK: [string, string][] = [
  ['passport_jssdk_version', '3.4.4'],
  ['passport_jssdk_type', 'normal'],
  ['is_from_ttaccountsdk', '1'],
]
const SDK_TAIL = { p_ui: '2.4.4', p_ca: '4.0.26', p_ca_real: '1.0.0.892', account_sdk_source: 'web', p_js_v: '3.4.4', p_js_t: 'pro', p_zt: '3.3.17', p_ver: '1.1.3', p_ver_real: '0', p_bd: '1.0.1.19-fix.01' }
const MIX_ALPHABET = '1234567890qwertyuiopasdfghjklzxcvbnm'
const POLL_INTERVAL = 5200
const QR_TTL = 55_000
const THROTTLE_GIVEUP = 120_000
const MS_COMMON_INTERVAL = 300_000

/** 登录过程中的会话状态（上游挂在 DouyinAuth 上的那些字段）。 */
export class Passport {
  strict = false
  verifyPortrait = ''
  secTs = ''
  private tSuffix = ''
  private tCookie = ''
  private tQuery = ''
  private sourceInfo = ''
  qrRefreshReady = false
  smsSentAt: number | null = null

  constructor(readonly d: Douyin) {}

  /** 非 TTY 下短信分两步：发码之后把整个页面会话存下来，填验证码时原样恢复（上游要求同一个 auth）。 */
  snapshot(): Record<string, unknown> {
    const { strict, verifyPortrait, secTs, tSuffix, tCookie, tQuery, sourceInfo, qrRefreshReady, smsSentAt } = this
    return { strict, verifyPortrait, secTs, tSuffix, tCookie, tQuery, sourceInfo, qrRefreshReady, smsSentAt, credential: structuredClone(this.d.credential) }
  }

  restore(state: Record<string, any>): void {
    const { credential, ...fields } = state
    Object.assign(this.d.credential, structuredClone(credential))
    Object.assign(this, fields)
  }

  // ---------------------------------------------------------------- cookie

  private get(name: string): string | undefined {
    return this.d.cookie(name)
  }

  /** Python 的 dict.setdefault：默认值总会先求值（随机数照样消耗）。 */
  private setdefault(name: string, value: string): void {
    if (this.get(name) === undefined) this.d.setCookie(name, value)
  }

  private view(order: string[]): [string, string][] {
    const out: [string, string][] = []
    for (const name of order) {
      const v = this.get(name)
      if (v != null && v !== '') out.push([name, v])
    }
    return out
  }

  /** 按域、按实录顺序挑 cookie（上游 scoped_cookies）。 */
  scoped(host: string): [string, string][] {
    if (host === 'challenge') {
      const out = this.view(this.qrRefreshReady ? QR_REFRESH_ORDER : CHALLENGE_ORDER)
      const dg = this.get('download_guide')
      if (dg && !out.some(([k]) => k === 'download_guide')) out.push(['download_guide', dg])
      return out
    }
    if (host === 'qr') return this.view(this.qrRefreshReady ? QR_REFRESH_ORDER : QR_ORDER)
    if (host === 'ticket_guard') return this.view(TICKET_GUARD_ORDER)
    if (host === 'ttwid') return this.view(TTWID_ORDER)
    if (host === 'www_ttwid') return this.view(WWW_TTWID_ORDER)
    if (host === 'www_guiding') return this.view(WWW_GUIDING_ORDER)
    if (host === 'www_bootstrap') return this.view(WWW_BOOTSTRAP_ORDER)
    const order = host === 'sms' || host === 'sms_login' ? SMS_ORDER : LOGIN_ORDER
    const out = this.view(order)
    for (const [k, v] of this.d.cookies()) {
      if (out.some(([n]) => n === k) || v === '') continue
      if ((host === 'sms' || host === 'sms_login') && SMS_HISTORICAL_ONLY.includes(k)) continue
      if (WWW_ONLY.includes(k) || k === 'my_rd') continue
      out.push([k, v])
    }
    return out
  }

  static cookieHeader(pairs: [string, string][]): string {
    return pairs.map(([k, v]) => `${k}=${v}`).join('; ')
  }

  // ---------------------------------------------------------------- 页面 bootstrap

  /** 取不透明的页面随机量：t 的 9 位会话后缀共用，4 位前缀按 cookie / query 分开（上游 _browser_t）。 */
  private browserT(role: 'cookie' | 'query'): string {
    if (!this.tSuffix) this.tSuffix = String(Math.floor(rand.random() * 1e9)).padStart(9, '0')
    const make = () => String(Math.floor(rand.random() * 1e4)).padStart(4, '0') + this.tSuffix
    if (role === 'cookie') return (this.tCookie ||= make())
    return (this.tQuery ||= make())
  }

  /** 页面 JS 自己写的那批 cookie（上游 _add_page_cookies，chrome_current 画像）。 */
  addPageCookies(): void {
    this.setdefault('enter_pc_once', '1')
    this.setdefault('is_support_rtm_web_ts', '1')
    this.setdefault('hevc_supported', 'true')
    this.setdefault('IsDouyinActive', 'true')
    this.setdefault('is_dash_user', '1')
    this.setdefault('my_rd', '2')
    this.setdefault('home_can_add_dy_2_desktop', '%220%22')
    this.setdefault('strategyABtestKey', quote(jsonDumps((rand.now() / 1000).toFixed(3))))
    this.setdefault('dy_swidth', PROFILE.screenWidth)
    this.setdefault('dy_sheight', PROFILE.screenHeight)
    this.setdefault('device_web_cpu_core', PROFILE.cpuCoreNum)
    this.setdefault('device_web_memory_size', PROFILE.deviceMemory)
    this.setdefault('architecture', 'amd64')
    this.setdefault('x-web-secsdk-uid', rand.uuid4())
    const feed = { cookie_enabled: true, screen_width: 2560, screen_height: 1440, browser_online: true, cpu_core_num: 20, device_memory: 32, downlink: 10, effective_type: '4g', round_trip_time: 0 }
    this.setdefault('stream_recommend_feed_params', quote(jsonDumps(jsonDumps(feed, { separators: [',', ':'] }), { ensureAscii: false }), ''))
    this.setdefault('__security_mc_1_s_sdk_crypt_sdk', `${rand.hex(4)}-${rand.hex(2)}-${rand.hex(2)}`)
    this.setdefault('bd_ticket_guard_regenerate_keys_time', shanghai(rand.now(), 'keys'))
    if (!this.get('fpk2')) this.d.setCookie('fpk2', md5Hex(PROFILE.ua))
    if (!this.get('fpk1')) this.d.setCookie('fpk1', fpk1())
    if (this.get('passport_auth_mix_state') === undefined) this.d.setCookie('passport_auth_mix_state', mixState(48))
    this.setdefault('gulu_source_res', Buffer.from(compactJson({ p_in: rand.hex(32) })).toString('base64'))
    this.setdefault('sdk_source_info', passportEncrypt(compactJson(probe(this.browserT('cookie')))))
  }

  /** 页面 acrawler 生成 __ac_signature（上游 _apply_ac_signature，在子进程里跑上游的 run_ac_node.js）。 */
  async applyAcSignature(): Promise<void> {
    const nonce = this.get('__ac_nonce')
    if (!nonce) {
      if (this.strict) throw new CatbusError('RISK_CONTROL', '登录页没有下发 __ac_nonce', { detail: { kind: 'blocked' } })
      return
    }
    if (this.get('__ac_signature')) return
    try {
      const out = await runNode(staticFile('douyin', 'acrawler_runtime/run_ac_node.js'), [], {
        AC_NONCE: nonce,
        AC_SIGN_NONCE: nonce,
        AC_COOKIE_ONLY: this.d.cookieStr,
        AC_HREF: `${WWW}/jingxuan`,
        AC_REFERRER: `${WWW}/jingxuan`,
        AC_VARIANT: 'chrome-doc-native-proto',
        AC_UA: PROFILE.ua,
        AC_NOW: String(rand.now()),
        AC_CANVAS_DATA_URL: canvasDataUrl(),
      })
      const payload = lastJson(out)
      const sig = String(payload?.sig ?? '')
      if (!sig.startsWith('_')) throw new Error('acrawler 没有产出签名')
      const before = new Map(this.d.cookies())
      this.d.setCookie('__ac_signature', sig)
      for (const [k, v] of parseCookieHeader(String(payload.cookie ?? ''))) if (k !== '__ac_signature' && before.get(k) !== v) this.d.setCookie(k, v)
    } catch (err) {
      if (this.strict) throw new CatbusError('RISK_CONTROL', `无法执行页面 acrawler 生成 __ac_signature：${(err as Error).message}`, { detail: { kind: 'blocked' } })
      this.d.ctx.log.debug(`执行 page acrawler 失败，暂不写入 __ac_signature：${(err as Error).message}`)
    }
  }

  // ---------------------------------------------------------------- 公共参数与请求头

  /** account_sdk_source_info：页面会话内固定（上游 _sdk_source_info，chrome_current 画像）。 */
  private sdkSourceInfo(): string {
    if (this.sourceInfo) return this.sourceInfo
    const g = PROFILE.geo
    const timeOrigin = pyFloat(Number((rand.now() - rand.uniform(3000, 60000)).toFixed(1)))
    const info = {
      hardwareConcurrency: 20,
      webdriver: false,
      chromedriver: false,
      shelldriver: false,
      plugins: 5,
      innerHeight: g[1],
      innerWidth: g[0],
      outerHeight: g[3],
      outerWidth: g[2],
      webgl: { vendor: PROFILE.webglVendor, renderer: PROFILE.webglRenderer },
      automation: { s: '00000000', c: '0000', p: '0000000', s1: '00000000', c1: '0000', p1: '0' },
      performance: {
        timeOrigin: '__TIME_ORIGIN__',
        usedJSHeapSize: 472537551,
        navigationTiming: {
          decodedBodySize: 968454,
          entryType: 'navigation',
          initiatorType: 'navigation',
          name: `${WWW}/?recommend=1`,
          renderBlockingStatus: 'non-blocking',
          serverTiming: 'cdn-cache,edge,origin,inner,tt_agw',
          guleStart: 610.8999999761581,
          guleDuration: 'none',
        },
      },
      browser: { t: this.browserT('query'), bit_protocol: 'false', bit_helper: false },
    }
    this.sourceInfo = passportEncrypt(compactJson(info).replace('"__TIME_ORIGIN__"', String(timeOrigin)))
    return this.sourceInfo
  }

  /** 登录接口的公共 query，最后是 sign / qs / msToken（上游 _sdk_params）。 */
  async sdkParams(
    extra: [string, string][] = [],
    options: { data?: [string, string][]; deviceFp?: boolean; pUi?: boolean; requestHost?: boolean; msToken?: boolean } = {},
  ): Promise<Params> {
    const { data, deviceFp = false, pUi = true, requestHost = true, msToken = true } = options
    const p = new Params().update(PASSPORT_SDK).add('aid', '6383').add('language', 'zh').add('account_app_language', 'zh-CN').add('ts', sdkTs())
    p.update(extra)
    if (pUi) p.add('p_ui', SDK_TAIL.p_ui)
    if (deviceFp) {
      const fp = this.get('s_v_web_id') || svWebId()
      this.setdefault('s_v_web_id', fp)
      p.add('p_ca', SDK_TAIL.p_ca).add('p_ca_real', SDK_TAIL.p_ca_real).add('fp', fp).add('verifyFp', fp)
    }
    p.add('account_sdk_source', SDK_TAIL.account_sdk_source).add('account_sdk_source_info', this.sdkSourceInfo())
    for (const k of ['p_js_v', 'p_js_t', 'p_zt', 'p_ver', 'p_ver_real'] as const) p.add(k, SDK_TAIL[k])
    if (requestHost) p.add('request_host', quote(WWW, ''))
    p.add('p_bd', SDK_TAIL.p_bd).add('p_ts', String(rand.now())).add('p_no', rand.hex(32))
    p.add('biz_trace_id', this.get('biz_trace_id') || rand.hex(4)).add('device_platform', 'web_app')
    const { sign, qs } = passportSign(p.pairs(), data)
    p.add('sign', sign).add('qs', qs)
    if (msToken) p.add('msToken', await this.d.msToken())
    return p
  }

  /** passport 请求头（上游 _passport_headers，chrome_current 画像）。 */
  headers(options: { form?: boolean; api?: string; strictDtrait?: boolean; bodyLength?: number; wireAcceptEncoding?: boolean } = {}): [string, string][] {
    const { form = false, api = '', strictDtrait = false, bodyLength, wireAcceptEncoding = false } = options
    const h = new Map<string, string>()
    h.set('web-sdk-version', '1')
    const qr = ['/passport/web/challenge/', '/passport/web/get_qrcode/', '/passport/web/check_qrconnect/'].some((p) => api.endsWith(p))
    if (qr) h.set('sec-ch-ua-platform', PROFILE.secChUaPlatform)
    const dtrait = api ? this.d.dtraitHeader(api, { aid: 6383, origin: WWW, strict: strictDtrait }) : null
    if (strictDtrait && (dtrait ?? '').length !== 820) {
      throw new CatbusError('RISK_CONTROL', `x-tt-session-dtrait 未达到 Chrome 短信实录的 820 字节（当前 ${(dtrait ?? '').length}），已拒绝发送`, { detail: { kind: 'blocked' } })
    }
    if (dtrait) h.set('x-tt-session-dtrait', dtrait)
    h.set('referer', `${WWW}/`)
    if (qr) h.set('sec-ch-ua', PROFILE.secChUa)
    if (api) h.set('x-tt-passport-aid-sign', aidSign(api, sdkTs()))
    if (qr) h.set('sec-ch-ua-mobile', '?0')
    h.set('x-tt-passport-csrf-token', this.get('passport_csrf_token') || this.get('passport_csrf_token_default') || '')
    const trace = this.get('biz_trace_id')
    if (trace) h.set('x-tt-passport-trace-id', trace)
    h.set('user-agent', PROFILE.ua)
    h.set('accept', 'application/json, text/javascript')
    if (form) h.set('content-type', 'application/x-www-form-urlencoded')
    if (this.verifyPortrait) h.set('x-tt-passport-verify-portrait', this.verifyPortrait)
    if (wireAcceptEncoding) h.set('accept-encoding', 'gzip, deflate, br, zstd')
    h.set('accept-language', 'zh-CN,zh;q=0.9')
    if (bodyLength != null) h.set('content-length', String(bodyLength))
    h.set('origin', WWW).set('priority', 'u=1, i').set('sec-fetch-dest', 'empty').set('sec-fetch-mode', 'cors').set('sec-fetch-site', 'same-site')
    return (qr ? HEADER_ORDER_QR : HEADER_ORDER).filter((k) => h.has(k)).map((k) => [k, h.get(k)!])
  }

  /** 响应的 Set-Cookie 合并回来，收 bd-ticket-guard-server-data 与 sec_ts。 */
  private async absorb(res: HttpResponse, options: { ticket?: boolean; secTs?: boolean; refreshV2?: boolean } = {}): Promise<void> {
    this.d.mergeSetCookies(res.url || `${LOGIN}/`, res)
    if (options.ticket) applyTicketGuard(this.d, res)
    if (options.secTs) await this.harvestSecTs(res, options.refreshV2 ?? true)
  }

  private async harvestSecTs(res: HttpResponse, refreshV2: boolean): Promise<void> {
    const v = res.headers.get('bd-ticket-guard-sec-ts')
    if (!v || v === this.secTs) return
    this.secTs = v
    if (refreshV2) await this.addClientDataV2()
  }

  // ---------------------------------------------------------------- bootstrap 各步

  /** 加载落地页，吸收 __ac_nonce / UIFID_TEMP 等 Set-Cookie（上游 fetch_www_bootstrap）。 */
  async fetchWwwBootstrap(): Promise<void> {
    const res = await this.d.request({
      url: `${WWW}/?recommend=1`,
      headers: [
        ['upgrade-insecure-requests', '1'],
        ['user-agent', PROFILE.ua],
        ['sec-ch-ua', PROFILE.secChUa],
        ['sec-ch-ua-mobile', '?0'],
        ['sec-ch-ua-platform', PROFILE.secChUaPlatform],
        ['accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'],
        ['accept-language', 'zh-CN,zh;q=0.9'],
        ['priority', 'u=0, i'],
        ['sec-fetch-dest', 'document'],
        ['sec-fetch-mode', 'navigate'],
        ['sec-fetch-site', 'none'],
        ['sec-fetch-user', '?1'],
        ['referer', `${WWW}/?recommend=1`],
      ],
      timeout: 20,
    })
    await res.arrayBuffer().catch(() => {})
  }

  private async ttwidCheck(url: string, referer: string, site: string, scope: string, extra: [string, string][] = []): Promise<boolean> {
    const h: [string, string][] = [
      ['referer', referer],
      ['user-agent', PROFILE.ua],
      ['accept', 'application/json, text/plain, */*'],
      ...extra,
      ['content-type', 'application/json'],
      ['cookie', Passport.cookieHeader(this.scoped(scope))],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['origin', WWW],
      ['priority', 'u=1, i'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', site],
    ]
    const res = await this.d.request({ method: 'POST', url, headers: h, body: '{"aid":6383,"service":"www.douyin.com"}', timeout: 20 }, { merge: false })
    const got = res.headers.getSetCookie().some((c) => c.startsWith('ttwid='))
    await this.absorb(res)
    return got
  }

  /** www.douyin.com/ttwid/check（上游 check_ttwid_www）。 */
  checkTtwidWww(): Promise<boolean> {
    return this.ttwidCheck(`${WWW}/ttwid/check/`, `${WWW}/jingxuan`, 'same-origin', 'www_ttwid', [['x-secsdk-csrf-token', 'DOWNGRADE']])
  }

  /** login.douyin.com/ttwid/check（上游 check_ttwid）。 */
  checkTtwid(): Promise<boolean> {
    return this.ttwidCheck(`${LOGIN}/ttwid/check/`, `${WWW}/`, 'same-site', 'ttwid')
  }

  /** 登录引导策略，响应写 passport_csrf_token（上游 login_guiding_strategy）。 */
  async loginGuidingStrategy(): Promise<any> {
    const path = '/passport/general/login_guiding_strategy/'
    const p = await this.sdkParams([], { pUi: false, requestHost: true })
    p.add('a_bogus', this.d.ab.sign(spliceUrl(p.pairs()), '', 'www.douyin.com'))
    const h: [string, string][] = [
      ['x-tt-passport-csrf-token', this.get('passport_csrf_token') || this.get('passport_csrf_token_default') || ''],
      ['referer', `${WWW}/jingxuan`],
      ['user-agent', PROFILE.ua],
      ['accept', 'application/json, text/javascript'],
      ['x-tt-passport-aid-sign', aidSign(path, sdkTs())],
      ['x-tt-passport-trace-id', this.get('biz_trace_id') ?? ''],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['origin', WWW],
      ['priority', 'u=1, i'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'same-origin'],
      ['cookie', Passport.cookieHeader(this.scoped('www_guiding'))],
    ]
    const res = await this.d.request({ url: WWW + path, headers: h, query: p.pairs(), timeout: 20 }, { merge: false })
    await this.absorb(res)
    const body = await jsonOrRaw(res)
    raiseIfBlocked('login_guiding_strategy/', body)
    return body
  }

  /** get_sec_ts：sec_ts 在响应头里（上游 get_sec_ts）。 */
  async getSecTs(): Promise<void> {
    const query: [string, string][] = [
      ['aid', '6383'],
      ['is_from_ttaccountsdk', '1'],
      ['msToken', await this.d.msToken()],
    ]
    query.push(['a_bogus', this.d.ab.sign(urlencode(query), '', 'www.douyin.com')])
    const h: [string, string][] = [
      ['referer', `${WWW}/user/self`],
      ['user-agent', PROFILE.ua],
      ['accept', 'application/json'],
      ['x-secsdk-csrf-token', 'DOWNGRADE'],
      ['content-type', 'application/x-www-form-urlencoded'],
      ['cookie', Passport.cookieHeader(this.scoped('www_bootstrap'))],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['origin', WWW],
      ['priority', 'u=1, i'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'same-origin'],
    ]
    const res = await this.d.request(
      { method: 'POST', url: `${WWW}/passport/user_info/get_sec_ts/`, headers: h, query, body: 'aid=6383&is_from_ttaccountsdk=1', timeout: 20 },
      { merge: false },
    )
    await this.absorb(res, { secTs: true, refreshV2: false })
    await res.arrayBuffer().catch(() => {})
  }

  /** bd_ticket_guard_client_data_v2（上游 _add_client_data_v2）。 */
  async addClientDataV2(): Promise<boolean> {
    if (!this.secTs) return false
    try {
      const path = '/passport/ticket_guard/get_client_cert/'
      const dtrait = this.d.dtraitHeader(path, { aid: 6383, origin: WWW }) ?? undefined
      const cert = await api.serverCert(this.d, 6383, Passport.cookieHeader(this.scoped('ticket_guard')), WWW, {
        dtrait,
        csrf: 'DOWNGRADE',
        msToken: (await this.d.msToken()) || undefined,
        referer: `${WWW}/`,
      })
      this.d.setCookie('bd_ticket_guard_client_data_v2', clientDataV2Cookie(this.d.privateKey!, this.secTs, cert, String(this.d.tokens.ts_sign ?? '')))
      return true
    } catch (err) {
      this.d.ctx.log.debug(`构造 bd_ticket_guard_client_data_v2 失败，跳过：${(err as Error).message}`)
      return false
    }
  }

  /** 设备认证 challenge：响应带 passportiv 与需要执行的 template（上游 challenge）。 */
  async challenge(): Promise<any> {
    const body = challengeBody()
    const data = parseQsl(body)
    const p = await this.sdkParams(
      [
        ['request_host', quote(WWW, '')],
        ['skip_c', '1'],
      ],
      { data, deviceFp: true, pUi: false, requestHost: false },
    )
    p.add('a_bogus', this.d.ab.sign(spliceUrl(p.pairs()), spliceUrl(data), 'login.douyin.com'))
    const h = this.headers({ form: true, api: '/passport/web/challenge/', strictDtrait: this.strict })
    h.push(['cookie', Passport.cookieHeader(this.scoped('challenge'))])
    const res = await this.d.request({ method: 'POST', url: `${LOGIN}/passport/web/challenge/`, headers: h, query: p.pairs(), body, timeout: 25 }, { merge: false })
    await this.absorb(res, { secTs: true })
    const out = await jsonOrRaw(res)
    await this.applyChallengeTemplate(out)
    return out
  }

  /** 执行 challenge 下发的 template，写回 gulu_source_res / sdk_source_info；passportiv 派生 bit_env（上游 _apply_challenge_template）。 */
  private async applyChallengeTemplate(res: any): Promise<void> {
    const data = res?.data ?? {}
    if (data.passportiv) this.d.setCookie('bit_env', uaAesUrlsafe(Buffer.from(String(data.passportiv), 'utf8')))
    const tpl = data.template
    if (!tpl) {
      if (this.strict) throw new CatbusError('RISK_CONTROL', 'challenge 响应缺少 data.template', { detail: { kind: 'blocked' } })
      return
    }
    const out = await runTemplate(String(tpl)).catch(() => null)
    if (!out?.p_in) {
      if (this.strict) throw new CatbusError('RISK_CONTROL', 'challenge template 执行失败或没有产出 p_in', { detail: { kind: 'blocked' } })
      return
    }
    const eIn = out.e_in && typeof out.e_in === 'object' ? out.e_in : {}
    if (this.strict) {
      if (!/^[0-9a-fA-F]{64}$/.test(String(out.p_in))) throw new CatbusError('RISK_CONTROL', 'challenge template 的 p_in 不是 64 位 sha256', { detail: { kind: 'blocked' } })
      if (!Object.keys(eIn).length) throw new CatbusError('RISK_CONTROL', 'challenge template 没有产出 e_in 探针', { detail: { kind: 'blocked' } })
    }
    this.d.setCookie('gulu_source_res', Buffer.from(compactJson({ p_in: out.p_in })).toString('base64'))
    const merged: Record<string, unknown> = { ...probe(this.browserT('cookie')), ...eIn, global_variables: '[]' }
    delete merged.console_liad
    merged.console_lied = 'false'
    this.d.setCookie('sdk_source_info', passportEncrypt(compactJson(merged)))
  }

  /**
   * 登录前的完整 bootstrap（上游 bootstrap_auth）。strict 只用于短信登录：任何一步缺失就停止，不带着伪造字段继续。
   */
  async bootstrap(strict: boolean): Promise<void> {
    this.strict = strict
    const d = this.d
    d.setDefault('s_v_web_id', svWebId)
    const prv = generateEcKey()
    d.device.private_key = prv
    d.setCookie('bd_ticket_guard_client_data', clientDataCookie(prv))
    d.setCookie('bd_ticket_guard_client_web_domain', '2')
    try {
      await this.fetchWwwBootstrap()
    } catch (err) {
      if (strict && !this.get('__ac_nonce')) throw err
      d.ctx.log.debug(`加载落地页失败：${(err as Error).message}`)
    }
    if (!this.get('ttwid')) {
      const ttwid = await api.registerTtwid(d).catch(() => '')
      if (ttwid) d.setCookie('ttwid', ttwid)
      else if (strict) throw new CatbusError('RISK_CONTROL', '注册 ttwid 失败', { detail: { kind: 'blocked' } })
    }
    d.deleteCookie('msToken')
    this.setdefault('s_v_web_id', svWebId())
    this.setdefault('biz_trace_id', rand.hex(4))
    this.addPageCookies()
    await this.applyAcSignature()
    if (strict) {
      for (const name of ['UIFID_TEMP', 'odin_tt']) {
        if (!this.get(name)) throw new CatbusError('RISK_CONTROL', `短信登录要求登录页下发 ${name}`, { detail: { kind: 'blocked' } })
      }
    }
    this.verifyPortrait = `${rand.uuid4()}.login`
    if (!d.device.dtrait_blob && !d.device.session_dtrait) {
      if (strict) throw new CatbusError('AUTH_REQUIRED', '短信登录需要 dtrait 设备素材（dtrait_blob）', { hint: 'catbus douyin auth login --method cookie --cookie @<凭证 JSON>，或改用扫码登录' })
      d.ctx.log.debug('没有 dtrait 素材，passport 请求会缺 x-tt-session-dtrait')
    }
    if (strict && (!this.get('__ac_nonce') || !this.get('__ac_signature'))) {
      throw new CatbusError('RISK_CONTROL', '短信登录缺少 www 页面的 __ac_nonce / __ac_signature', { detail: { kind: 'blocked' } })
    }
    await this.step(strict, 'www/ttwid/check', () => this.checkTtwidWww())
    await this.step(strict, 'login_guiding_strategy', async () => (await this.loginGuidingStrategy())?.message === 'success')
    await this.step(strict, 'get_sec_ts', async () => (await this.getSecTs(), true))
    await this.step(strict, 'ttwid/check', () => this.checkTtwid())
    d.deleteCookie('bd_ticket_guard_client_data_v2')
    await this.step(strict, 'challenge', async () => (await this.challenge())?.message === 'success')
    if (strict && !this.get('bit_env')) throw new CatbusError('RISK_CONTROL', 'challenge 没有下发 passportiv，无法生成 bit_env', { detail: { kind: 'blocked' } })
    await this.step(strict, 'client_data_v2', () => this.addClientDataV2())
  }

  private async step(strict: boolean, name: string, fn: () => Promise<boolean>): Promise<void> {
    let ok = false
    try {
      ok = await fn()
    } catch (err) {
      if (strict) throw err instanceof CatbusError ? err : new CatbusError('RISK_CONTROL', `登录 bootstrap 的 ${name} 失败：${(err as Error).message}`, { detail: { kind: 'blocked' } })
      this.d.ctx.log.debug(`${name} 失败：${(err as Error).message}`)
      return
    }
    if (!ok) {
      if (strict) throw new CatbusError('RISK_CONTROL', `登录 bootstrap 的 ${name} 没有成功`, { detail: { kind: 'blocked' } })
      this.d.ctx.log.debug(`${name} 没有成功`)
    }
  }

  // ---------------------------------------------------------------- 扫码

  async getQrcode(): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = await this.sdkParams(
        [
          ['next', WWW],
          ['need_short_url', 'true'],
          ['need_logo', 'false'],
          ['is_new_login', '1'],
          ['is_from_iesaccountsaas', '1'],
        ],
        { deviceFp: this.qrRefreshReady },
      )
      p.add('a_bogus', this.d.ab.sign(spliceUrl(p.pairs()), '', 'login.douyin.com'))
      const h = this.headers({ api: '/passport/web/get_qrcode/' })
      h.push(['cookie', Passport.cookieHeader(this.scoped('qr'))])
      const res = await this.d.request({ url: `${LOGIN}/passport/web/get_qrcode/`, headers: h, query: p.pairs(), timeout: 20 }, { merge: false })
      await this.absorb(res, { ticket: true, secTs: true })
      const text = await res.text()
      if (text.trimStart().startsWith('{')) {
        const body = JSON.parse(text)
        raiseIfBlocked('get_qrcode/', body)
        return body
      }
      if (attempt === 0 && this.solveGfkadpd(text)) continue
      throw new CatbusError('RISK_CONTROL', `get_qrcode 返回的不是 JSON（HTTP ${res.status}）`, { detail: { kind: 'blocked', status: res.status } })
    }
  }

  private solveGfkadpd(text: string): boolean {
    if (!text.includes('gfkadpd')) return false
    const m = /var\s+e\s*=\s*"(\d+)"\s*,\s*t\s*=\s*"(\d+)"/.exec(text)
    if (!m) return false
    this.d.setCookie('gfkadpd', `${m[1]},${m[2]}`)
    return true
  }

  /** 轮询二维码状态：new / scanned / confirmed / expired（上游 check_qrcode）。 */
  async checkQrcode(token: string): Promise<any> {
    const data: [string, string][] = [
      ['need_logo', 'false'],
      ['is_frontier', 'true'],
      ['token', token],
      ['is_new_login', '1'],
      ['next', WWW],
      ['need_short_url', 'true'],
    ]
    const p = await this.sdkParams([['is_from_iesaccountsaas', '1']], { data, deviceFp: true })
    p.add('a_bogus', this.d.ab.sign(spliceUrl(p.pairs()), spliceUrl(data), 'login.douyin.com'))
    const h = this.headers({ form: true, api: '/passport/web/check_qrconnect/' })
    h.push(['cookie', Passport.cookieHeader(this.scoped('qr'))])
    const res = await this.d.request({ method: 'POST', url: `${LOGIN}/passport/web/check_qrconnect/`, headers: h, query: p.pairs(), form: data, timeout: 20 }, { merge: false })
    await this.absorb(res, { ticket: true, secTs: true })
    const raw = (await res.text()).trim()
    if (!raw) return { data: { error_code: 7, description: 'empty response from QR poll edge' }, message: 'retry' }
    if (!raw.startsWith('{')) throw new CatbusError('RISK_CONTROL', `check_qrconnect 返回的不是 JSON（HTTP ${res.status}），可能命中登录风控页`, { detail: { kind: 'blocked' } })
    const body = JSON.parse(raw)
    if (body.data?.status === 'expired') {
      this.qrRefreshReady = true
      this.setdefault('download_guide', downloadGuide('1'))
      const mix = this.get('passport_auth_mix_state')
      if (mix && mix.length !== 32) this.d.setCookie('passport_auth_mix_state', mixState(32))
    }
    if (body.data?.error_code !== 7) raiseIfBlocked('check_qrconnect/', body)
    return body
  }

  /**
   * 完整扫码流程（上游 qrcode_login）：二维码 55 秒一换（只在读到 new 时换），error_code=7 指数退避，
   * 首次读到状态后发一次 /web/common 完整上报，之后每 5 分钟一次行为心跳。
   */
  async qrcodeLogin(show: (url: string) => Promise<void>, options: { timeout?: number } = {}): Promise<void> {
    const d = this.d
    const started = rand.now()
    await this.bootstrap(false)
    d.msPinned = true
    const deadline = rand.now() + (options.timeout ?? 300_000)
    let token: string | null = null
    let born = 0
    let wait = POLL_INTERVAL
    let throttledSince: number | null = null
    let scanned = false
    let firstStatusAt: number | null = null
    let commonDone = false
    let nextBehavior = started + MS_COMMON_INTERVAL
    let fresh = false
    try {
      while (rand.now() < deadline && !d.ctx.signal.aborted) {
        const now = rand.now()
        if (token && firstStatusAt != null && !commonDone && now - firstStatusAt >= POLL_INTERVAL) {
          commonDone = true
          await this.refreshCommon(false)
        } else if (token && commonDone && now >= nextBehavior) {
          await this.refreshCommon(true)
          while (nextBehavior <= now) nextBehavior += MS_COMMON_INTERVAL
        }
        let pending: any = null
        if (token && fresh && !scanned && rand.now() - born > QR_TTL) {
          const last = (await this.checkQrcode(token)).data ?? {}
          if (last.status === 'confirmed') return this.finish(last.redirect_url)
          if (last.status === 'scanned') {
            scanned = true
            d.ctx.log.info('换码前发现已扫码，请在手机上确认')
            pending = last
          } else {
            d.ctx.log.info('二维码到期，换一张')
            token = null
            fresh = false
          }
        }
        if (!token) {
          const data = (await this.getQrcode()).data ?? {}
          token = data.token
          if (!token) throw new CatbusError('UPSTREAM', '获取二维码失败', { detail: { error_code: data.error_code ?? null } })
          born = rand.now()
          await show(data.qrcode_index_url)
        }
        const info = pending ?? (await this.checkQrcode(token!)).data ?? {}
        if (info.error_code === 7) {
          fresh = false
          throttledSince ??= rand.now()
          if (rand.now() - throttledSince > THROTTLE_GIVEUP) {
            throw new CatbusError('RISK_CONTROL', 'check_qrconnect 持续返回 error_code=7（访问太频繁），请等几分钟再试', { detail: { kind: 'rate_limit' } })
          }
          wait = Math.min(wait * 2, 60_000)
          await rand.sleep(wait, d.ctx.signal)
          continue
        }
        throttledSince = null
        wait = POLL_INTERVAL
        const status = info.status
        fresh = Boolean(status)
        if (fresh && firstStatusAt == null) firstStatusAt = rand.now()
        if (status === 'confirmed') return this.finish(info.redirect_url)
        if (status === 'expired') {
          d.ctx.log.info('二维码已过期，换一张继续等')
          token = null
          scanned = false
          fresh = false
          if (!commonDone) firstStatusAt = null
          continue
        }
        if (status === 'scanned' && !scanned) {
          scanned = true
          d.ctx.log.info('已扫码，请在手机上确认')
        }
        await rand.sleep(wait, d.ctx.signal)
      }
      throw new CatbusError('AUTH_REQUIRED', '扫码登录超时', { hint: '重新执行 catbus douyin auth login' })
    } finally {
      d.msPinned = false
    }
  }

  /**
   * mssdk /web/common 轮换 msToken（上游 refresh_mstoken(common=True)）：失败时保留上一个；
   * 既没有上一个、也不在扫码轮询期间，才退回 /web/r/token。
   */
  async refreshCommon(behavior: boolean, sms = false): Promise<string> {
    const cached = this.d.tokens.msToken as { value: string } | undefined
    const previous = cached?.value ?? ''
    try {
      const token = await api.commonMstoken(this.d, previous, behavior ? commonBehavior() : commonReport(6383, 6241, sms))
      if (token) {
        this.d.setMsToken(token)
        return token
      }
    } catch {}
    if (previous) return previous
    if (this.d.msPinned) return ''
    delete this.d.tokens.msToken
    return this.d.msToken()
  }

  // ---------------------------------------------------------------- 短信

  /**
   * 严格短信登录的 cookie 形状检查：名字、顺序、每个值的长度都要与 Chrome 实录（current_23）一致，
   * 否则不发送（上游 _assert_sms_cookie_shape）。
   */
  private assertSmsCookieShape(): void {
    if (!this.strict) return
    const expected: Record<string, number[]> = {
      enter_pc_once: [1], UIFID_TEMP: [160, 224], odin_tt: [96, 128, 160], is_support_rtm_web_ts: [1], hevc_supported: [4],
      IsDouyinActive: [4], home_can_add_dy_2_desktop: [7], stream_recommend_feed_params: [323, 324], strategyABtestKey: [20],
      is_dash_user: [1], passport_csrf_token: [32], passport_csrf_token_default: [32], ttwid: [127], biz_trace_id: [8],
      __security_mc_1_s_sdk_crypt_sdk: [18], bd_ticket_guard_regenerate_keys_time: [19], bd_ticket_guard_client_data: [304],
      bd_ticket_guard_client_web_domain: [1], bd_ticket_guard_client_data_v2: [354, 552], sdk_source_info: [472], bit_env: [512],
      gulu_source_res: [100], passport_auth_mix_state: [32, 48],
    }
    const missing = SMS_ORDER.filter((n) => !this.get(n))
    if (missing.length) throw new CatbusError('RISK_CONTROL', `短信登录缺少 Chrome cookie：${missing.join(', ')}`, { detail: { kind: 'blocked' } })
    const wrong = Object.entries(expected)
      .filter(([n, sizes]) => !sizes.includes((this.get(n) ?? '').length))
      .map(([n, sizes]) => `${n}=${(this.get(n) ?? '').length}（应为 ${sizes.join('/')}）`)
    if (wrong.length) throw new CatbusError('RISK_CONTROL', `短信登录 cookie 长度与 Chrome 实录不一致：${wrong.join(', ')}`, { detail: { kind: 'blocked' } })
  }

  /** 短信页要求 /web/common 轮换后的 msToken（解码后至少 170 字节，上游 _ensure_sms_ms_token）。 */
  private async ensureSmsMsToken(): Promise<void> {
    const len = (v: string) => decodeURIComponent(v).length
    const cached = (this.d.tokens.msToken as { value: string } | undefined)?.value ?? ''
    if (len(cached) >= 170) return
    if (len(await this.d.msToken()) >= 170) return
    const rotated = await this.refreshCommon(false, true)
    if (len(rotated) < 170) throw new CatbusError('RISK_CONTROL', `短信请求要求 /web/common 轮换后的 msToken（至少 170 字节，当前 ${len(rotated)}）`, { detail: { kind: 'blocked' } })
  }

  private async smsPost(path: string, data: [string, string][], scope: string): Promise<HttpResponse> {
    this.assertSmsCookieShape()
    await this.ensureSmsMsToken()
    const p = await this.sdkParams([['is_from_iesaccountsaas', '1']], { data, deviceFp: true })
    p.add('a_bogus', this.d.ab.sign(spliceUrl(p.pairs()), spliceUrl(data), 'login.douyin.com'))
    const body = urlencode(data)
    const h = this.headers({ form: true, api: path, strictDtrait: true, bodyLength: Buffer.byteLength(body), wireAcceptEncoding: true })
    h.push(['cookie', Passport.cookieHeader(this.scoped(scope))])
    return this.d.request({ method: 'POST', url: LOGIN + path, headers: h, query: p.pairs(), body, timeout: 20 }, { merge: false })
  }

  /** 发短信验证码（上游 send_sms_code，passport_web 画像）。 */
  async sendSmsCode(phone: string): Promise<any> {
    const res = await this.smsPost(
      '/passport/web/send_code/',
      [
        ['is6Digits', '1'],
        ['mix_mode', '1'],
        ['mobile', passportEncrypt(formatPhone(phone))],
        ['type', '3731'],
        ['fixed_mix_mode', '1'],
      ],
      'sms',
    )
    await this.absorb(res)
    const body = JSON.parse(await res.text())
    this.smsSentAt = rand.now()
    if (body.error_code && body.error_code !== 0) throw smsError(body)
    if (body.data?.error_code) throw smsError(body.data)
    return body
  }

  /** 用验证码登录（上游 phone_login）。 */
  async phoneLogin(phone: string, code: string): Promise<void> {
    if (!/^\d{6}$/.test(code.trim())) throw new CatbusError('USAGE', '验证码必须是 6 位数字')
    const res = await this.smsPost(
      '/passport/web/sms_login/',
      [
        ['service', WWW],
        ['mix_mode', '1'],
        ['mobile', passportEncrypt(formatPhone(phone))],
        ['code', passportEncrypt(code.trim())],
        ['fixed_mix_mode', '1'],
      ],
      'sms_login',
    )
    await this.absorb(res, { ticket: true, secTs: true })
    const body = JSON.parse(await res.text())
    const err = body.data?.error_code ?? body.error_code
    if (err) throw smsError(body.data ?? body)
    await this.finish(body.data?.redirect_url ?? body.redirect_url)
  }

  // ---------------------------------------------------------------- 收尾

  /** 跟随登录重定向，收下各跳的 Set-Cookie 与 ticket（上游 _follow_login_redirect）。 */
  async finish(redirectUrl?: string): Promise<void> {
    let url = redirectUrl
    for (let hop = 0; url && hop < 5; hop++) {
      const h = baseHeaders('DOC').set('cookie', Passport.cookieHeader(this.scoped('login'))).list()
      const res = await this.d.request({ url, headers: h, redirect: 'manual', timeout: 20 }, { merge: false })
      await this.absorb(res, { ticket: true })
      if (![301, 302, 303, 307, 308].includes(res.status)) break
      url = res.headers.get('location') ?? undefined
    }
    this.d.deleteCookie('msToken')
  }
}

// ---------------------------------------------------------------- 纯函数

/** 反自动化探针的默认值（sdk_source_info 明文，键名与拼写照实录）。 */
function probe(t: string): Record<string, string> {
  return {
    automa_ele: 'false',
    bit_helper: 'false',
    chrome_extension_script: '[]',
    console_lied: 'false',
    global_variables: '[]',
    swt_alt: 'false',
    zn_cap: 'false',
    hok_noti: 'false',
    inj_zfb: 'false',
    t,
    bit_protocol: 'false',
  }
}

/** passport_auth_mix_state：36 字符表里取 n 个（上游 generate_passport_auth_mix_state）。 */
function mixState(length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += MIX_ALPHABET[Math.floor(rand.random() * MIX_ALPHABET.length)]
  return s
}

/** 北京时间的日期串。上游用本机时区；这里固定 Asia/Shanghai，与抖音页面一致，也让对拍与机器时区无关。 */
function shanghai(ms: number, kind: 'keys' | 'date'): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  )
  return kind === 'keys' ? `${parts.year}-${parts.month}-${parts.day}/${parts.hour}:${parts.minute}:${parts.second}` : `${parts.year}${parts.month}${parts.day}`
}

function downloadGuide(stage: string): string {
  return quote(jsonDumps(`${stage}/${shanghai(rand.now(), 'date')}/0`), '')
}

/** Python `json.dumps(float)`：整数值的浮点数带 `.0`。 */
function pyFloat(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x)
}

let challengeProfile: any
function profile(): any {
  return (challengeProfile ??= JSON.parse(readFileSync(staticFile('douyin', 'challenge_profile.json'), 'utf8')))
}

/** fpk1：FingerprintJS 摘要经 CryptoJS 口令 AES（OpenSSL `Salted__` 格式，上游 build_fpk1）。 */
function fpk1(): string {
  const digest = String(profile().fingerprint_digest).toLowerCase()
  const salt = Buffer.from(rand.bytes(8))
  let derived = Buffer.alloc(0)
  let prev = Buffer.alloc(0)
  while (derived.length < 48) {
    prev = createHash('md5').update(Buffer.concat([prev, Buffer.from('byte_fingerprint'), salt])).digest()
    derived = Buffer.concat([derived, prev])
  }
  const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
  const ct = Buffer.concat([cipher.update(digest, 'ascii'), cipher.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, ct]).toString('base64')
}

/** challenge 的 body：sign = AES(btoa(指纹 JSON))，sk = XOR5(encodeURIComponent(调用栈))（上游 build_challenge_body）。 */
function challengeBody(): string {
  const p = profile()
  const sign = uaAesUrlsafe(Buffer.from(Buffer.from(JSON.stringify(p.fingerprint), 'latin1').toString('base64'), 'ascii'))
  const stack = String(p.stack_current ?? p.stack)
  const sk = [...Buffer.from(encodeURIComponent(stack), 'utf8')].map((b) => (b ^ 5).toString(16)).join('')
  return urlencode([
    ['sign', sign],
    ['sk', sk],
  ])
}

function canvasDataUrl(): string {
  try {
    return JSON.parse(readFileSync(staticFile('douyin', 'acrawler_runtime/canvas_actual_exact.json'), 'utf8'))
  } catch {
    return ''
  }
}

function formatPhone(phone: string): string {
  const raw = phone.trim()
  let m = /^(?:\+86\s?)?(\d{11})$/.exec(raw)
  if (m) return `+86 ${m[1]}`
  m = /^\+86(\d{11})$/.exec(raw)
  if (m) return `+86 ${m[1]}`
  throw new CatbusError('USAGE', '手机号必须是 11 位大陆号码，或 +86 <11 位>')
}

function parseCookieHeader(header: string): [string, string][] {
  return header
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t.includes('='))
    .map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)])
}

function lastJson(text: string): any {
  for (const line of text.split(/\r?\n/).reverse()) {
    const s = line.trim()
    if (!s) continue
    try {
      return JSON.parse(s)
    } catch {}
  }
  return null
}

async function jsonOrRaw(res: HttpResponse): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 200), status: res.status }
  }
}

/** passport 的风控错误码（上游 _raise_if_blocked）。 */
function raiseIfBlocked(api: string, res: any): void {
  const code = res?.data?.error_code
  if (code === 0 || code == null) return
  const desc = res.data?.description ?? res.message ?? ''
  if (code === 4031) throw new CatbusError('RISK_CONTROL', `${api} 返回 4031「网站存在安全风险」：${desc}`, { detail: { kind: 'blocked', code } })
  if (code === 7) throw new CatbusError('RISK_CONTROL', `${api} 访问太频繁：${desc}`, { detail: { kind: 'rate_limit', code } })
  throw new CatbusError('UPSTREAM', `${api} 失败 error_code=${code} ${desc}`, { detail: { code, description: desc } })
}

function smsError(data: any): CatbusError {
  const code = data.error_code
  const desc = data.description ?? data.message ?? ''
  if ([1105, 1104, 1107, 2046].includes(code) || /验证|captcha/i.test(desc)) return new CatbusError('RISK_CONTROL', `需要人机验证：${desc || code}`, { detail: { kind: 'captcha', code } })
  return new CatbusError('UPSTREAM', desc || `短信登录失败 error_code=${code}`, { detail: { code, description: desc } })
}

/** 登录响应下发的 ticket 信息（上游 apply_ticket_guard）。 */
export function applyTicketGuard(d: Douyin, res: HttpResponse): boolean {
  let raw = res.headers.get('bd-ticket-guard-server-data')
  if (!raw) raw = /(?:^|\s)bd_ticket_guard_server_data=([^;]*)/.exec(res.headers.getSetCookie().join('\n'))?.[1] ?? null
  if (!raw) return false
  try {
    const info = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString('utf8'))
    if (!info.ticket) return false
    Object.assign(d.tokens, { ticket: info.ticket, ts_sign: info.ts_sign ?? '', client_cert: info.client_cert ?? '' })
    return true
  } catch {
    return false
  }
}

/** 在子进程里跑上游的 Node 脚本（它们改进程级的全局状态，vm 里跑不了，AGENTS 7.4）。确定性模式下注入与对拍相同的 Math.random / Date。 */
function runNode(script: string, args: string[], env: Record<string, string>): Promise<string> {
  const preload = rand.isDeterministic()
    ? `(()=>{let a=${rand.DEFAULT_SEED}>>>0;Math.random=()=>{a=(a+0x6d2b79f5)>>>0;let t=Math.imul(a^(a>>>15),a|1);t=(t+Math.imul(t^(t>>>7),t|61))^t;return((t^(t>>>14))>>>0)/4294967296};const D=Date,n=${rand.now()};globalThis.Date=class extends D{constructor(...x){super(...(x.length?x:[n]))}static now(){return n}}})();`
    : ''
  // catbus 的 package.json 是 "type": "module"，上游脚本是 CommonJS：按 CJS 编译执行，不走模块解析
  const load = `const M=require('module'),f=${JSON.stringify(script)},m=new M(f);m.filename=f;m.paths=M._nodeModulePaths(require('path').dirname(f));m._compile(require('fs').readFileSync(f,'utf8'),f)`
  const code = preload + load
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, script, ...args], { env: { ...process.env, ...env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', () => {})
    const timer = setTimeout(() => child.kill(), 60_000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(`子进程退出码 ${code}`))
    })
  })
}

/** 执行 challenge template（上游 challenge_template.run_template，runner 原样复制在 static/douyin/）。 */
async function runTemplate(template: string): Promise<{ p_in?: string; e_in?: Record<string, unknown> } | null> {
  const dir = await mkdtemp(join(tmpdir(), 'dych_'))
  try {
    const tpl = join(dir, 't.js')
    const prof = join(dir, 'p.json')
    const g = PROFILE.geo
    await writeFile(tpl, template, 'utf8')
    await writeFile(
      prof,
      JSON.stringify({
        ua: PROFILE.ua,
        browser_major: 151,
        cpu_core_num: 20,
        device_memory: 32,
        screen_width: 2560,
        screen_height: 1440,
        avail_width: g[4],
        avail_height: g[5],
        inner_width: g[0],
        inner_height: g[1],
        outer_width: g[2],
        outer_height: g[3],
        webgl_vendor: PROFILE.webglVendor,
        webgl_renderer: PROFILE.webglRenderer,
        languages: ['zh-CN', 'zh', 'en', 'zh-TW', 'ja'],
      }),
      'utf8',
    )
    const out = lastJson(await runNode(staticFile('douyin', 'challenge_template_runner.js'), [tpl, prof], {}))
    return out?.ok ? out.result : null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
