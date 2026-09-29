import { CatbusError } from '../../../core/errors.js'
import { type HttpResponse, parseJsonp } from '../../../core/http.js'
import { unescapeHtml } from '../../../core/normalize.js'
import { jsonLoads, type Pairs, pyFloatStr, type Scalar } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type AksState, encryptQuery } from './aks.js'
import type { Jd } from './client.js'
import { solveCaptcha } from './jcap.js'
import { summerEncrypt } from './js.js'
import { APPID_PASSPORT, basic, type Header, LOGIN_PAGE, PASSPORT_URL, QR_URL, qrImage, qrJsonp, qrValidation } from './profile.js'
import { encodeQueryPairs, parseAttrs, randomJqueryCallback, TraceContext } from './util.js'

/**
 * 京东 PC 登录（上游 jd_apis/jd_login_api.py 与 jd_sms_login_api.py）：
 * 扫码三步（show → check → qrCodeTicketValidation），手机号短信（JCAP → sendMessage → loginService，必要时额外安全验证）。
 * passport 的 query / body 由 aks.js 加密成 aksParamsU / aksParamsB。
 */

export const APPID = 133
const PAGE_SOURCE = 'login2025'
const PAGE_LOCATION = ''
const FIRST_SHOW = 'f'
const RETURN_URL = 'https://home.jd.com/index.html'
const SMS_CAPTCHA_APP_ID = '1000802'
const SAFE_LOGIN_SMS_TYPES = new Set(['DANGEROUS_DOWN', 'PARENT_DANGEROUS_DOWN', 'HISTORY_MOBILE'])
/** 登录页 getAliveSsoDomains() 的结果。 */
export const SSO_DOMAINS = [
  'sso.jd.hk', 'sso.jkcsjd.com', 'sso.healthjd.com', 'sso.jingxi.com', 'sso.jdh.com', 'sso.jingdong.com', 'ssa.7fresh.com',
  'sso.jdpay.com', 'sso.jingdonghealth.cn', 'sso.vipmro.com', 'sso.yiyaojd.com', 'sso.jdcloud.com', 'sso.jdl.com', 'sso.jhscm.com',
  'sso.jddj.com',
].join(',')

const aksState = (jd: Jd): AksState => ((jd.ctx.credential.device.aks as AksState) ??= {})

/** 响应体：JSON，或括号包着的 JSON（_parse_response）。 */
export async function parseResponse(res: HttpResponse): Promise<any> {
  const text = await res.text()
  try {
    const v = jsonLoads(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {}
  let t = (text ?? '').trim().replace(/;+$/, '')
  if (t.startsWith('(') && t.endsWith(')')) t = t.slice(1, -1).trim()
  try {
    const v = jsonLoads(t)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return { _invalid_response_length: t.length }
  }
}

// ================================================================ 扫码

/** 加载登录页，拿页面下发的 `#uuid` 建立 JDAS 链路上下文（_prepare_trace_context）。 */
export async function prepareTrace(jd: Jd): Promise<{ trace: TraceContext; html: string }> {
  const res = await jd.send({ url: LOGIN_PAGE, headers: basic('DOC').get(), timeout: 15 })
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `登录页初始化失败 HTTP ${res.status}`)
  const html = await res.text()
  try {
    return { trace: TraceContext.fromHtml(html), html }
  } catch (err) {
    throw new CatbusError('UPSTREAM', (err as Error).message)
  }
}

/** 取二维码（get_qrcode）：返回 PNG 与二维码内容（`https://qr.m.jd.com/p?k=<QRCodeKey>&appid=133`）。 */
export async function getQrcode(jd: Jd, size = 147): Promise<{ png: Uint8Array; content: string | null }> {
  const res = await jd.send({
    url: `${QR_URL}/show`,
    headers: qrImage().get(),
    query: [
      ['appid', APPID],
      ['size', size],
      ['t', rand.now()],
    ],
    timeout: 15,
  })
  const png = new Uint8Array(await res.arrayBuffer())
  if (res.status !== 200 || !png.length) throw new CatbusError('UPSTREAM', `取二维码失败 HTTP ${res.status}`)
  if (!jd.cookie('wlfstk_smdl')) throw new CatbusError('UPSTREAM', '响应里没有 wlfstk_smdl，无法轮询')
  const key = jd.cookie('QRCodeKey')
  return { png, content: key ? `${QR_URL}/p?k=${key}&appid=${APPID}` : null }
}

/** 轮询一次扫码状态（check_qrcode）：201 未扫、202 已扫待确认、200 带 ticket。 */
export async function checkQrcode(jd: Jd): Promise<any> {
  const res = await jd.send({
    url: `${QR_URL}/check`,
    headers: qrJsonp().get(),
    query: [
      ['callback', randomJqueryCallback()],
      ['appid', APPID],
      ['token', jd.cookie('wlfstk_smdl') ?? ''],
      ['_', rand.now()],
    ],
    timeout: 15,
  })
  const text = await res.text()
  return parseJsonp(text) ?? { code: -1, raw: text }
}

/** passport 的 aks.js 公钥（_public_key）。 */
export async function publicKey(jd: Jd, trace: Record<string, string>): Promise<string> {
  const h = qrValidation(trace).set('accept', '*/*')
  const res = await jd.send({ url: `${PASSPORT_URL}/publicKey/init`, headers: h.get(), timeout: 15 })
  const text = await res.text()
  let payload: any
  try {
    payload = jsonLoads(text)
  } catch {
    throw new CatbusError('UPSTREAM', `publicKey/init 返回非 JSON：${text.slice(0, 200)}`)
  }
  const key = payload && typeof payload === 'object' ? payload.data : null
  if (!key) throw new CatbusError('UPSTREAM', 'publicKey/init 缺少 data')
  return String(key)
}

/** 用 ticket 换 thor / pin（validate_ticket）。 */
export async function validateTicket(jd: Jd, ticket: string, trace: TraceContext): Promise<any> {
  if (!ticket) throw new CatbusError('UPSTREAM', 'ticket 为空')
  jd.h5st.configure(jd.cookieStr, PASSPORT_URL, LOGIN_PAGE)
  const signed = await jd.h5st.sign({ t: ticket }, APPID_PASSPORT)
  const h5st = String(signed.h5st ?? '')
  const stk = String(signed._stk ?? '')
  if (!h5st || !stk) throw new CatbusError('ERROR', 'passport h5st/_stk 生成失败')
  const pairs: [string, Scalar][] = [
    ['t', ticket],
    ['pageSource', PAGE_SOURCE],
    ['pageLocation', PAGE_LOCATION],
    ['ReturnUrl', RETURN_URL],
    ['h5st', h5st],
    ['_stk', stk],
    ['firstShowAccountLoginPage', FIRST_SHOW],
    ['ssoDomains', SSO_DOMAINS],
  ]
  const encoded = encodeQueryPairs(pairs)
  const key = await publicKey(jd, trace.nextHeaders())
  const encrypted = encryptQuery(encoded, key, aksState(jd))
  const h = qrValidation(trace.nextHeaders()).referer(LOGIN_PAGE)
  const res = await jd.send({ url: `${PASSPORT_URL}/uc/qrCodeTicketValidation`, headers: h.get(), query: [['aksParamsU', encrypted]], timeout: 15 })
  const text = await res.text()
  let json: any
  try {
    json = jsonLoads(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  if (json && typeof json === 'object' && 'returnCode' in json && json.returnCode !== 0 && json.returnCode !== '0') {
    throw new CatbusError('UPSTREAM', `ticket 兑换失败 returnCode=${json.returnCode}`, { detail: { returnCode: json.returnCode } })
  }
  if (!jd.cookie('thor')) throw new CatbusError('UPSTREAM', 'ticket 兑换未拿到 thor')
  return json
}

// ================================================================ 手机号短信

export interface SmsContext {
  trace: TraceContext
  fields: Record<string, string>
  publicKey: string
  captchaStatus: number
  captchaSessionId: string
  captchaJwtToken: string
}

/** 登录页的隐藏域（parse_login_inputs）：按 id 与 name 记录 value。 */
export function parseLoginInputs(html: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) {
    const attrs = parseAttrs(tag)
    const value = attrs.value ?? ''
    for (const key of [attrs.id, attrs.name]) if (key) values[key] = value
  }
  if (!values.uuid) throw new CatbusError('UPSTREAM', '登录页缺少 uuid')
  return values
}

/** 手机号规范化（normalize_mobile）。 */
export function normalizeMobile(mobile: string, areaCode = '0086'): string {
  const digits = String(mobile ?? '').replace(/[\s()-]/g, '')
  if (!/^\+?\d{6,30}$/.test(digits)) throw new CatbusError('USAGE', '手机号格式不正确')
  const area = String(areaCode ?? '0086').replace(/[\s()-]/g, '')
  if (['86', '+86', '0086'].includes(area)) {
    let local = digits.replace(/^\++/, '')
    if (local.startsWith('0086')) local = local.slice(4)
    else if (local.startsWith('86') && local.length > 11) local = local.slice(2)
    return local
  }
  if (!/^(?:00|\+)?\d{1,6}$/.test(area)) throw new CatbusError('USAGE', '国家/地区代码格式不正确')
  const prefix = area.startsWith('00') ? area.slice(2) : area.replace(/^\++/, '')
  let local = digits.replace(/^\++/, '')
  if (local.startsWith('00' + prefix)) local = local.slice(2 + prefix.length)
  else if (local.startsWith(prefix)) local = local.slice(prefix.length)
  return `+${prefix}${local}`
}

/** ITU-T E.164 的一位、两位国家/地区码；其余都是三位（国家码是前缀码，按前缀即可切分）。 */
const CALLING_1 = new Set(['1', '7'])
const CALLING_2 = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(' '),
)

/** `+852…` / `00852…` 开头的号码 → 国家/地区码（`852`）；不带国际前缀时为 null。 */
export function callingCode(mobile: string): string | null {
  const m = /^(?:\+|00)(\d+)$/.exec(String(mobile ?? '').replace(/[\s()-]/g, ''))
  if (!m) return null
  const d = m[1]!
  if (CALLING_1.has(d.slice(0, 1))) return d.slice(0, 1)
  if (CALLING_2.has(d.slice(0, 2))) return d.slice(0, 2)
  return d.slice(0, 3)
}

/**
 * `--phone` → 登录接口里的手机号：带 `+` / `00` 国际前缀时按前缀识别国家/地区码，
 * 再交给 normalize_mobile（等于上游 login(area_code=<该码>)）；否则按中国大陆（0086）。
 */
export function loginMobile(phone: string): string {
  const code = callingCode(phone)
  return normalizeMobile(phone, code ? `+${code}` : '0086')
}

/** passport 的 jQuery AJAX 头（_ajax_headers）。 */
function ajaxHeaders(ctx: SmsContext, accept = 'application/json, text/javascript, */*; q=0.01', form = false): Header {
  const h = qrValidation(ctx.trace.nextHeaders()).referer(LOGIN_PAGE).set('accept', accept)
  if (form) {
    h.set('content-type', 'application/x-www-form-urlencoded; charset=UTF-8')
    h.set('origin', PASSPORT_URL)
  }
  const order = ['sgm-context', 'sec-ch-ua-platform', 'jdas-trace-id', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'x-requested-with', 'user-agent', 'accept', 'jdas-page-id']
  if (form) order.push('content-type')
  order.push('jdas-session-id', 'accept-encoding', 'accept-language')
  if (form) order.push('origin')
  order.push('priority', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site')
  return h.reorder(order)
}

const encrypted = (jd: Jd, ctx: SmsContext, pairs: [string, Scalar][]) => encryptQuery(encodeQueryPairs(pairs), ctx.publicKey, aksState(jd))

/** 登录页首屏 QR 图片请求：只要它下发的 wlfstk_smdl（_load_qr_cookie）。 */
async function loadQrCookie(jd: Jd): Promise<void> {
  const res = await jd.send({
    url: `${QR_URL}/show`,
    headers: qrImage().get(),
    query: [
      ['appid', APPID],
      ['size', 147],
      ['t', rand.now()],
    ],
    timeout: 15,
  })
  const token = res.headers
    .getSetCookie()
    .map((l) => /^\s*wlfstk_smdl=([^;]*)/.exec(l)?.[1])
    .find((v) => v)
  if (res.status !== 200 || !token) throw new CatbusError('UPSTREAM', `登录页 QR 设备 Cookie 初始化失败 HTTP ${res.status}`)
  jd.update([['wlfstk_smdl', token]])
}

/** ssoDomain.js：取动态列表，保留 /alive 返回 success 的域（_load_sso_domains）。 */
async function loadSsoDomains(jd: Jd, ctx: SmsContext): Promise<void> {
  const res = await jd.send({
    url: `${PASSPORT_URL}/ssoDomain/getList`,
    headers: ajaxHeaders(ctx).get(),
    query: [
      ['ReturnUrl', RETURN_URL],
      ['r', pyFloatStr(rand.random())],
    ],
    timeout: 15,
  })
  let candidates: unknown = []
  try {
    candidates = await res.json()
  } catch {}
  const list = Array.isArray(candidates) ? candidates.slice(0, 32).map(String).filter((d) => /^[A-Za-z0-9.-]{3,253}$/.test(d)) : []
  const results = await Promise.all(
    list.map(async (domain) => {
      const callback = randomJqueryCallback()
      const h = qrJsonp().referer(LOGIN_PAGE)
      try {
        const probe = await jd.http.request({
          url: `https://${domain}/alive`,
          headers: h.get(),
          query: [
            ['callback', callback],
            ['_', rand.now()],
          ],
          cookies: false,
          timeout: 8,
        })
        const text = await probe.text()
        let outer: any = parseJsonp(text)
        if (outer == null) {
          const m = /^[^(]*\(([\s\S]*)\)[;\s]*$/.exec(text)
          const quoted = m ? m[1]!.trim() : ''
          if (quoted.length >= 2 && quoted[0] === quoted[quoted.length - 1] && (quoted[0] === "'" || quoted[0] === '"')) outer = quoted.slice(1, -1).replaceAll("\\'", "'")
        }
        const payload = typeof outer === 'string' ? jsonLoads(outer) : outer
        const ok = probe.status === 200 && payload && typeof payload === 'object' && payload.result === 'success'
        return { domain: ok ? domain : '', probe }
      } catch {
        return { domain: '', probe: null }
      }
    }),
  )
  const reachable: string[] = []
  for (const { domain, probe } of results) {
    if (probe) jd.absorb(probe)
    if (domain) reachable.push(domain)
  }
  ctx.fields.ssoDomains = reachable.join(',')
}

/** 登录行为序列 id（_load_seq_sid）。 */
async function loadSeqSid(jd: Jd, ctx: SmsContext): Promise<void> {
  const res = await jd.send({
    url: 'https://seq.jd.com/jseqf.html',
    headers: qrJsonp().referer(LOGIN_PAGE).get(),
    query: [
      ['bizId', 'passport_jd_com_login_pc'],
      ['platform', 'js'],
      ['version', '1'],
    ],
    timeout: 15,
  })
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `登录行为序列初始化失败 HTTP ${res.status}`)
  const m = /_jdtdmap_sessionId\s*=\s*["'](\d+)["']/.exec(await res.text())
  if (!m) throw new CatbusError('UPSTREAM', 'seq.jd.com 响应缺少 _jdtdmap_sessionId')
  ctx.fields.seqSid = m[1]!
}

/** 初始化短信图形验证码（refresh_captcha）。 */
export async function refreshCaptcha(jd: Jd, ctx: SmsContext): Promise<any> {
  const enc = encrypted(jd, ctx, [['appId', SMS_CAPTCHA_APP_ID]])
  const res = await jd.send({ url: `${PASSPORT_URL}/uc/graphic/sessionId/refresh`, headers: ajaxHeaders(ctx).get(), query: [['aksParamsU', enc]], timeout: 15 })
  const payload = await parseResponse(res)
  if (res.status !== 200 || !(payload.code === 1 || payload.code === '1')) {
    throw new CatbusError('UPSTREAM', `短信图形验证码初始化失败 HTTP ${res.status} code=${payload.code}`)
  }
  ctx.captchaStatus = Number.parseInt(String(payload.status ?? 0), 10) || 0
  ctx.captchaSessionId = String(payload.sessionId ?? '')
  ctx.captchaJwtToken = String(payload.jwtToken ?? '')
  if (ctx.captchaStatus === 1 && (!ctx.captchaSessionId || !ctx.captchaJwtToken)) throw new CatbusError('UPSTREAM', '短信图形验证码响应缺少 sessionId/jwtToken')
  return payload
}

/** 手机号登录的准备（JdSmsLoginAPI.start）：登录页、QR cookie、公钥、设备参数、SSO 域、行为序列、图形验证码。 */
export async function startSms(jd: Jd): Promise<SmsContext> {
  const res = await jd.send({ url: LOGIN_PAGE, headers: basic('DOC').get(), timeout: 15 })
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `登录页初始化失败 HTTP ${res.status}`)
  const html = await res.text()
  const fields = parseLoginInputs(html)
  const ctx: SmsContext = { trace: TraceContext.fromHtml(html), fields, publicKey: '', captchaStatus: 0, captchaSessionId: '', captchaJwtToken: '' }
  await loadQrCookie(jd)
  ctx.publicKey = await publicKey(jd, ctx.trace.nextHeaders())
  const device = await jd.refreshDevice()
  Object.assign(fields, device)
  fields.sessionId = device.fp
  await loadSsoDomains(jd, ctx)
  await loadSeqSid(jd, ctx)
  await refreshCaptcha(jd, ctx)
  return ctx
}

/** 发短信（send_code）。 */
export async function sendCode(jd: Jd, ctx: SmsContext, mobile: string, verifyToken = ''): Promise<{ success: boolean; message: string; payload: any }> {
  if (ctx.captchaStatus === 1 && !verifyToken) return { success: false, message: '发送短信前必须完成人机验证', payload: {} }
  const f = ctx.fields
  const pairs: [string, Scalar][] = [
    ['source', f.source ?? ''],
    ['eid', f.eid ?? ''],
    ['uuid', f.uuid ?? ''],
    ['mobile', mobile],
    ['imageAuthCodeToken', ''],
    ['firstShowAccountLoginPage', f.firstShowAccountLoginPage ?? FIRST_SHOW],
    ['pageSource', f.pageSource ?? PAGE_SOURCE],
    ['pageLocation', f.pageLocation ?? PAGE_LOCATION],
  ]
  if (ctx.captchaSessionId) pairs.push(['graphicCaptchaSessionId', ctx.captchaSessionId])
  if (ctx.captchaJwtToken) pairs.push(['graphicCaptchaJwtToken', ctx.captchaJwtToken])
  if (verifyToken) pairs.push(['graphicCaptchaVerifyToken', verifyToken])
  pairs.push(['_', rand.now()])
  const enc = encrypted(jd, ctx, pairs)
  const res = await jd.send({ url: `${PASSPORT_URL}/uc/mobile/sendMessage`, headers: ajaxHeaders(ctx, '*/*').get(), query: [['aksParamsU', enc]], timeout: 15 })
  const payload = await parseResponse(res)
  const success = res.status === 200 && (payload.code === 1 || payload.code === '1')
  const message = String(payload.msg || (success ? '短信已发送' : '短信发送失败')).replaceAll(mobile, '<mobile>')
  return { success, message, payload }
}

/** 用短信码换登录态（submit_code）。成功时跟随跳转拿到 thor / pin。 */
export async function submitCode(jd: Jd, ctx: SmsContext, mobile: string, smsCode: string): Promise<{ success: boolean; message: string; payload: any }> {
  if (!/^\d{6}$/.test(String(smsCode ?? ''))) return { success: false, message: '短信验证码必须是六位数字', payload: {} }
  const f = ctx.fields
  const device = {
    eid: f.eid || jd.cookie('3AB9D23F7A4B3C9B') || '',
    eid2: f.eid2 || jd.cookie('3AB9D23F7A4B3CSS') || '',
    fp: f.fp ?? '',
  }
  jd.h5st.configure(jd.cookieStr, PASSPORT_URL, LOGIN_PAGE)
  const signed = await jd.h5st.sign({ mobile }, APPID_PASSPORT)
  if (!signed.h5st || signed._stk !== 'mobile') return { success: false, message: '手机号登录 h5st/_stk 生成失败', payload: {} }
  const body: [string, Scalar][] = [
    ['uuid', f.uuid ?? ''],
    ['eid', device.eid],
    ['eid2', device.eid2],
    ['fp', device.fp],
    ['_t', f._t ?? '_t'],
    ['mobile', mobile],
    ['mobileCode', smsCode],
    ['pageSource', f.pageSource ?? PAGE_SOURCE],
    ['pageLocation', f.pageLocation ?? PAGE_LOCATION],
    ['loginType', f.loginType ?? 'f'],
    ['sa_token', f.sa_token ?? ''],
    ['seqSid', f.seqSid ?? ''],
    ['useSlideAuthCode', f.useRandomSlideAuthCode ?? ''],
    ['authcode', ''],
    ['ssoDomains', f.ssoDomains ?? ''],
    ['h5st', String(signed.h5st)],
    ['_stk', String(signed._stk)],
  ]
  const query = `ReturnUrl=${RETURN_URL}&r=${pyFloatStr(rand.random())}&version=2015`
  const encUrl = encryptQuery(query, ctx.publicKey, aksState(jd))
  const encBody = encrypted(jd, ctx, body)
  const res = await jd.send({
    method: 'POST',
    url: `${PASSPORT_URL}/uc/mobile/loginService`,
    headers: ajaxHeaders(ctx, 'text/plain, */*; q=0.01', true).get(),
    query: [['aksParamsU', encUrl]],
    form: [['aksParamsB', encBody]],
    timeout: 15,
  })
  const payload = await parseResponse(res)
  if (payload._t) f._t = String(payload._t)
  const target = payload.success || payload.transfer
  if (target) {
    const resolved = new URL(String(target), LOGIN_PAGE)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return { success: false, message: '登录成功跳转地址协议异常', payload }
    await follow(jd, resolved.href, basic('DOC').set('referer', LOGIN_PAGE))
    if (jd.isLogin) return { success: true, message: '手机号短信登录成功', payload }
    return { success: false, message: '登录跳转完成，但未取得 thor/pin', payload }
  }
  for (const key of ['username', 'authcode2', 'emptyAuthcode', 'pwd', 'msg']) {
    if (payload[key]) return { success: false, message: String(payload[key]).replaceAll(mobile, '<mobile>'), payload }
  }
  if (payload.newSafeVerify) return { success: false, message: '账号需要额外安全验证', payload }
  return { success: false, message: `手机号登录失败 HTTP ${res.status}`, payload }
}

/** 逐跳跟随重定向并吸收每一跳的 Set-Cookie（allow_redirects=True + absorb_response）。 */
export async function follow(jd: Jd, url: string, headers: Header, max = 10): Promise<HttpResponse> {
  let current = url
  for (let i = 0; ; i++) {
    const res = await jd.send({ url: current, headers: headers.get(), redirect: 'manual', timeout: 20 })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location || i >= max) return res
    current = new URL(location, current).href
  }
}

// ---------------------------------------------------------------- 额外安全验证（Authentication Cube）

export interface SafePage {
  finalUrl: string
  config: Record<string, any>
  requestParams: Record<string, string>
}

/** 找出 `window.safeWebConfig = ...` 赋值的对象（_extract_safe_web_config），不执行 JS。 */
export function extractSafeWebConfig(html: string): Record<string, any> {
  const source = html ?? ''
  const pattern = /(?:(?:window\s*\.\s*)?safeWebConfig|(?:var|let|const)\s+safeWebConfig)\s*=\s*/g
  for (const m of source.matchAll(pattern)) {
    const value = parseCandidate(source.slice(m.index! + m[0].length).trimStart())
    if (value && Object.keys(value).length) return value
  }
  return {}
}

function parseCandidate(candidate: string): Record<string, any> | null {
  for (const variant of [candidate, unescapeHtml(candidate)]) {
    const v = variant.trimStart()
    try {
      const obj = parseJsLiteral(v)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj
    } catch {}
    const pm = /^JSON\s*\.\s*parse\s*\(\s*([\s\S]*)/.exec(v)
    if (!pm) continue
    let arg = pm[1]!.trimStart()
    let transform = ''
    const cm = /^(decodeURIComponent|decodeURI|atob)\s*\(\s*([\s\S]*)/.exec(arg)
    if (cm) {
      transform = cm[1]!
      arg = cm[2]!
    }
    let serialized: string
    try {
      serialized = new JsParser(arg).leadingString()
    } catch {
      continue
    }
    if (transform === 'decodeURIComponent' || transform === 'decodeURI') serialized = decodeURIComponent(serialized)
    else if (transform === 'atob') serialized = Buffer.from(serialized, 'base64').toString('utf8')
    try {
      const obj = jsonLoads(serialized)
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length) return obj
    } catch {}
  }
  return null
}

/** 受限的 JS / JSON5 数据字面量解析（_parse_js_data_object）：只认字面量，拒绝任何可执行的标识符。 */
class JsParser {
  i = 0
  constructor(readonly text: string) {}

  skip(): void {
    for (;;) {
      const c = this.text[this.i]
      if (c !== undefined && /\s/.test(c)) this.i++
      else if (this.text.startsWith('//', this.i)) {
        const end = this.text.indexOf('\n', this.i + 2)
        this.i = end < 0 ? this.text.length : end + 1
      } else if (this.text.startsWith('/*', this.i)) {
        const end = this.text.indexOf('*/', this.i + 2)
        if (end < 0) throw new Error('unterminated comment')
        this.i = end + 2
      } else return
    }
  }

  leadingString(): string {
    this.skip()
    const q = this.text[this.i]
    if (q !== "'" && q !== '"') throw new Error('string expected')
    return this.string()
  }

  string(): string {
    const quote = this.text[this.i]!
    let out = ''
    this.i++
    while (this.i < this.text.length) {
      const c = this.text[this.i++]!
      if (c === quote) return out
      if (c !== '\\') {
        out += c
        continue
      }
      const e = this.text[this.i++]
      if (e === undefined) break
      const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
      if (e in simple) out += simple[e]
      else if (e === 'u') {
        out += String.fromCharCode(parseInt(this.text.slice(this.i, this.i + 4), 16))
        this.i += 4
      } else if (e === 'x') {
        out += String.fromCharCode(parseInt(this.text.slice(this.i, this.i + 2), 16))
        this.i += 2
      } else if (e === '\n') {
      } else out += e
    }
    throw new Error('unterminated string')
  }

  identifier(): string {
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(this.text.slice(this.i))
    if (!m) throw new Error('identifier expected')
    this.i += m[0].length
    return m[0]
  }

  value(): unknown {
    this.skip()
    const c = this.text[this.i]
    if (c === undefined) throw new Error('value expected')
    if (c === '{') return this.object()
    if (c === '[') return this.array()
    if (c === "'" || c === '"') return this.string()
    const num = /^[-+]?(?:0[xX][0-9A-Fa-f]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(this.text.slice(this.i))
    if (num) {
      this.i += num[0].length
      return Number(num[0])
    }
    const name = this.identifier()
    const constants: Record<string, unknown> = { true: true, false: false, null: null, undefined: null }
    if (!(name in constants)) throw new Error('executable identifier rejected')
    return constants[name]
  }

  object(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    this.i++
    for (;;) {
      this.skip()
      if (this.i >= this.text.length) throw new Error('unterminated object')
      if (this.text[this.i] === '}') {
        this.i++
        return out
      }
      const c = this.text[this.i]
      const key = c === "'" || c === '"' ? this.string() : this.identifier()
      this.skip()
      if (this.text[this.i] !== ':') throw new Error('colon expected')
      this.i++
      out[key] = this.value()
      this.skip()
      if (this.text[this.i] === ',') this.i++
      else if (this.text[this.i] !== '}') throw new Error('comma expected')
    }
  }

  array(): unknown[] {
    const out: unknown[] = []
    this.i++
    for (;;) {
      this.skip()
      if (this.i >= this.text.length) throw new Error('unterminated array')
      if (this.text[this.i] === ']') {
        this.i++
        return out
      }
      out.push(this.value())
      this.skip()
      if (this.text[this.i] === ',') this.i++
      else if (this.text[this.i] !== ']') throw new Error('comma expected')
    }
  }
}

function parseJsLiteral(text: string): unknown {
  const p = new JsParser(text)
  p.skip()
  if (text[p.i] !== '{') throw new Error('top-level object expected')
  return p.value()
}

const SAFE_HOSTS = ['jd.com', 'jdpay.com', 'jingdong.com']
const safeHost = (host: string) => SAFE_HOSTS.some((s) => host === s || host.endsWith('.' + s))

/** 在同一会话里打开官方 safeVerifyUrl（load_safe_verify）。 */
export async function loadSafeVerify(jd: Jd, payload: any): Promise<SafePage> {
  const target = new URL(String(payload?.safeVerifyUrl ?? ''), LOGIN_PAGE)
  if (target.protocol !== 'https:' || !safeHost(target.hostname.toLowerCase())) {
    throw new CatbusError('UPSTREAM', `额外安全验证跳转地址异常：host=${target.hostname || '<empty>'}`)
  }
  const res = await follow(jd, target.href, basic('DOC').set('referer', LOGIN_PAGE))
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `额外安全验证页面加载失败 HTTP ${res.status}`)
  const finalUrl = res.url || target.href
  if (!safeHost(new URL(finalUrl).hostname.toLowerCase())) throw new CatbusError('UPSTREAM', '额外安全验证页面重定向域异常')
  const html = await res.text()
  return { finalUrl, config: extractSafeWebConfig(html), requestParams: Object.fromEntries(target.searchParams) }
}

function safeHeaders(jd: Jd, page: SafePage, form = false): Header {
  const u = new URL(page.finalUrl)
  const h = basic('DOC').set('accept', 'application/json, text/plain, */*').set('referer', page.finalUrl).set('origin', `${u.protocol}//${u.host}`).set('x-requested-with', 'XMLHttpRequest')
  if (form) h.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
  const xsrf = jd.cookie('XSRF-TOKEN')
  if (xsrf) h.set('x-xsrf-token', xsrf)
  return h
}

async function safeCommonFields(jd: Jd, page: SafePage): Promise<Pairs> {
  const u = new URL(page.finalUrl)
  jd.device.configure(jd.cookieStr, page.finalUrl, `${u.protocol}//${u.host}`, page.finalUrl)
  const d = await jd.device.get()
  return [
    ['fp', d.fp],
    ['eid', d.eid],
    ['eid2', d.eid2],
    ['uuid', rand.uuid4()],
  ]
}

function safeMethod(page: SafePage, validateType = ''): Record<string, any> {
  let methods: any[] = page.config.list ?? []
  if (validateType) methods = methods.filter((m) => m && typeof m === 'object' && m.validateType === validateType)
  for (const m of methods) {
    const params = m && typeof m === 'object' ? m.params : null
    if (params && typeof params === 'object' && params.m && m.enP && m.validateType && SAFE_LOGIN_SMS_TYPES.has(m.validateType)) return m
  }
  return {}
}

function safeMessage(payload: any, fallback: string, secret = ''): string {
  const r = payload?.resultData
  let msg = r && typeof r === 'object' ? String(r.msg ?? '') : ''
  msg = msg || String(payload?.resultMsg || fallback)
  return secret ? msg.replaceAll(String(secret), '<masked>') : msg
}

const configValue = (page: SafePage, key: string) => String(page.config[key] || page.requestParams[key] || '')

/** 发额外安全验证的第二条短信（send_safe_mobile_code）。 */
export async function sendSafeCode(jd: Jd, page: SafePage, validateType = '', delivery = 'msg') {
  const method = safeMethod(page, validateType)
  if (!Object.keys(method).length) return { success: false, message: '额外安全验证没有可直接执行的手机号分支', method, payload: {} }
  const mobile = String(method.params.m)
  const keyRes = await jd.send({ url: 'https://aq.jd.com/pwd/gmpk', headers: safeHeaders(jd, page).get(), query: [['s', '1']], timeout: 20 })
  const keyPayload = await parseResponse(keyRes)
  const pub = String(keyPayload.resultData ?? '')
  if (keyRes.status !== 200 || keyPayload.resultCode !== '10000' || !pub) return { success: false, message: '额外安全验证加密公钥获取失败', method, payload: keyPayload }
  const form: Pairs = [
    ['p', method.enP],
    ['m', await summerEncrypt(jd.http, pub, mobile)],
    ['v', method.validateType],
    ['o', configValue(page, 'o')],
    ['s', configValue(page, 's')],
    ...(await safeCommonFields(jd, page)),
    ['f', delivery],
  ]
  const res = await jd.send({ method: 'POST', url: 'https://aq.jd.com/mobile/getCode', headers: safeHeaders(jd, page, true).get(), form, timeout: 20 })
  const payload = await parseResponse(res)
  const success = res.status === 200 && payload.success === true
  return { success, message: safeMessage(payload, success ? '额外安全验证短信已发送' : '额外安全验证短信发送失败', mobile), method, payload }
}

/** 校验额外安全验证的短信码并跟随返回页（submit_safe_mobile_code）。 */
export async function submitSafeCode(jd: Jd, page: SafePage, method: Record<string, any>, code: string) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return { success: false, message: '额外安全验证短信验证码必须是六位数字', payload: {} }
  const form: Pairs = [
    ['p', method.enP ?? ''],
    ['c', String(code)],
    ['v', method.validateType ?? ''],
    ['o', configValue(page, 'o')],
    ['s', configValue(page, 's')],
    ...(await safeCommonFields(jd, page)),
    ['rnd', pyFloatStr(rand.random())],
  ]
  const res = await jd.send({ method: 'POST', url: 'https://aq.jd.com/mobile/validateCode', headers: safeHeaders(jd, page, true).get(), form, timeout: 20 })
  const payload = await parseResponse(res)
  if (res.status !== 200 || payload.success !== true) return { success: false, message: safeMessage(payload, '额外安全验证短信校验失败'), payload }
  const target = payload.resultData && typeof payload.resultData === 'object' ? payload.resultData.page : ''
  if (target) {
    const resolved = new URL(String(target), page.finalUrl)
    if (resolved.protocol !== 'https:' || !resolved.hostname) return { success: false, message: '额外安全验证返回地址异常', payload }
    await follow(jd, resolved.href, safeHeaders(jd, page))
  }
  return { success: true, message: '额外安全验证短信校验通过', payload }
}

/** 短信图形验证码（JCAP）：纯程序求解，返回 graphicCaptchaVerifyToken。 */
export function solveSmsCaptcha(jd: Jd, ctx: SmsContext, mobile: string): Promise<string> {
  return solveCaptcha(jd, { sessionId: ctx.captchaSessionId, account: mobile, pageUrl: LOGIN_PAGE })
}
