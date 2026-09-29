import { crc32 } from 'node:zlib'
import { CatbusError } from '../../../core/errors.js'
import { md5Hex } from '../../../core/hash.js'
import { parseJson } from '../../../core/http.js'
import * as rand from '../../../core/rand.js'
import { checkStatus, getdss, jsonOf as parseResponse, loginOrder, type Pc, splice } from './client.js'
import { acceptSsk, createHandshake, generateWebsectiga, pcProfileData } from './js.js'
import { AS, EDITH, type Headers, LOGIN_LANG, navigationHeaders, orderedHeaders, PC_ORDER, PC_REFERENCE, SEM, WEB, XHR_ACCEPT } from './profile.js'
import { normalizeEts } from './state.js'

/**
 * PC 端的匿名设备初始化与登录（上游 apis/xhs_pc_login_apis.py 的 XHSLoginApi）。
 *
 * 匿名链路：www 导航拿 abRequestId → 本地生成 a1 / webId → 安全初始化（honeypot、redcaptcha、sem_sdk、
 * ds、sbtsource、seccallback → websectiga）→ login/activate 拿访客 web_session 与 webSsk → webprofile 拿 gid。
 * 游客态就是这条链路走完的访客会话，缓存在 guest.json（AGENTS 5.2）。
 */

const A1_CHARSET = 'abcdefghijklmnopqrstuvwxyz1234567890'

/** 上游 common_util.generate_a1：时间戳十六进制 + 30 位随机 + '50000' + crc32，截到 52 位。 */
export function generateA1(): string {
  const part = rand.now().toString(16) + rand.string(30, A1_CHARSET) + '5' + '0' + '000'
  return (part + String(crc32(Buffer.from(part)) >>> 0)).slice(0, 52)
}

export const generateWebId = (a1: string) => md5Hex(a1)

type Kind = Parameters<typeof loginOrder>[1]

/** 登录链路的一次请求：签名（可选）→ 按实抓顺序排头 → 发送 → 合并 cookie → 解析 JSON。 */
async function send(p: Pc, method: 'GET' | 'POST', url: string, headers: Headers, kind: Kind | 'raw', o: { body?: string; cookieUrl?: string | null; appendShared?: string[] } = {}) {
  const cookies = o.cookieUrl === null ? null : p.wire(o.cookieUrl ?? url)
  const pairs = kind === 'raw' ? orderedHeaders(headers, PC_ORDER.navigation, cookies, { optional: ['cookie'] }) : orderedHeaders(headers, loginOrder(headers, kind), cookies)
  return p.send({ method, url, headers: pairs, ...(o.body !== undefined ? { body: o.body } : {}) }, o.appendShared)
}

/** 登录接口触发风控时，退回到浏览器登录后导入 cookie。 */
const COOKIE_HINT = '在浏览器里登录小红书后导入 cookie：catbus xhs auth login --method cookie --cookie "<Cookie>"'

/** 登录链路的响应 → JSON：461 / 471 / 406 / 429 报风控并提示改用 cookie 登录，不是 JSON 时报 UPSTREAM。 */
const jsonOf = (res: Awaited<ReturnType<Pc['send']>>): Promise<any> => parseResponse(res, COOKIE_HINT)

// ---------------------------------------------------------------- 安全初始化

async function navigate(p: Pc): Promise<void> {
  const h = navigationHeaders()
  await p.send({ url: `${WEB}/`, headers: orderedHeaders(h, PC_ORDER.navigation, null, { optional: ['cookie'] }), redirect: 'manual' })
  await p.send({ url: `${WEB}/explore`, headers: orderedHeaders(h, PC_ORDER.navigation, p.wire(`${WEB}/explore`), { optional: ['cookie'] }), redirect: 'manual' })
  if (!p.shared().abRequestId) throw new CatbusError('UPSTREAM', '小红书首页导航没有下发 abRequestId')
}

async function honeypot(p: Pc): Promise<void> {
  const h: Headers = {
    'sec-ch-ua-platform': '"Windows"',
    referer: `${WEB}/`,
    'user-agent': PC_REFERENCE.release.userAgent,
    accept: XHR_ACCEPT,
    'sec-ch-ua': PC_REFERENCE.release.secChUa,
    'content-type': 'application/json;charset=UTF-8',
    'sec-ch-ua-mobile': '?0',
    'accept-language': LOGIN_LANG,
    origin: WEB,
    priority: 'u=1, i',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
  }
  await send(p, 'POST', `${AS}/api/p/pj`, h, 'honeypot', { body: '{"callFrom":"xhs-pc-web"}' })
}

async function security(p: Pc, api: string, payload: unknown, o: { tier: string; mnsProfile: string; trace?: boolean; includeB1?: boolean; origin?: string; kind?: Kind }) {
  const s = await p.loginSigned(api, payload, 'POST', { secDomain: true, tier: o.tier, mnsProfile: o.mnsProfile, trace: o.trace ?? false, includeB1: o.includeB1 })
  return send(p, 'POST', (o.origin ?? AS) + api, s.headers, o.kind ?? 'security', { body: s.body })
}

async function scripting(p: Pc, payload: unknown, tier: string, mnsProfile: string): Promise<any> {
  const res = await security(p, '/api/sec/v1/scripting', payload, { tier, mnsProfile })
  const body = await jsonOf(res)
  if (!res.ok || !body?.success) throw new CatbusError('UPSTREAM', body?.msg || `scripting HTTP ${res.status}`)
  return body
}

/** 上游 _initialize_security：冷启动两段安全程序，按浏览器顺序。 */
async function initializeSecurity(p: Pc): Promise<void> {
  const dsl = await p.dsl()
  p.setLoginDsl(dsl)
  await honeypot(p)
  await security(p, '/api/redcaptcha/v2/getconfig', {}, { tier: '0201', mnsProfile: 'security_initial', trace: true, origin: EDITH, kind: 'post' })
  const sem = await p.loginSigned('/data/sem_sdk', '', 'GET', { secDomain: true, tier: '0201', mnsProfile: 'security_initial', trace: false })
  await send(p, 'GET', `${SEM}/data/sem_sdk`, sem.headers, 'sem', { cookieUrl: null })

  const ds = await scripting(p, { callFrom: 'web', callback: '', type: 'ds', appId: 'xhs-pc-web' }, '0201', 'security_initial')
  const anchor = getdss(String(ds?.data?.data ?? ''))
  if (!anchor) throw new CatbusError('UPSTREAM', 'ds scripting 响应里没有 getdss()')
  p.setLoginDsl(anchor)

  await security(p, '/api/sec/v1/sbtsource', { callFrom: 'web', appId: 'xhs-pc-web' }, { tier: '0201', mnsProfile: 'security_initial' })

  const sec = await scripting(p, { callFrom: 'web', callback: 'seccallback' }, '0101', 'security_callback')
  const poison = String(sec?.data?.secPoisonId ?? '')
  const code = String(sec?.data?.data ?? '')
  if (!poison || code.length < 1000) throw new CatbusError('UPSTREAM', 'seccallback 响应缺少 secPoisonId 或安全程序')
  const tiga = await generateWebsectiga(code, { userAgent: PC_REFERENCE.release.userAgent, platform: 'Win32', pageUrl: `${WEB}/explore`, timeoutMs: 15000 })
  p.setCookie('websectiga', tiga)
  p.setCookie('sec_poison_id', poison)
  p.sync()
  p.state.lastTiga = rand.now()
  p.state.dsllt = p.state.lastTiga
}

/** 上游 _activate：访客 web_session + webSsk（X25519 协商）。 */
async function activate(p: Pc): Promise<void> {
  const hs = createHandshake()
  const s = await p.loginSigned('/api/sns/web/v1/login/activate', { client_public_key_base64: hs.client_public_key_base64 }, 'POST', { tier: '0101', mnsProfile: 'activate' })
  const res = await send(p, 'POST', `${EDITH}/api/sns/web/v1/login/activate`, s.headers, 'post', { body: s.body })
  const body = await jsonOf(res)
  if (!res.ok || !body?.success) throw new CatbusError('UPSTREAM', body?.msg || `login/activate HTTP ${res.status}`)
  const d = body.data ?? {}
  if (d.session) p.setCookie('web_session', String(d.session))
  p.sync()
  if (!p.shared().web_session) throw new CatbusError('UPSTREAM', 'login/activate 没有下发访客 web_session')
  if (!d.ssk) throw new CatbusError('UPSTREAM', 'login/activate 没有下发 SSK')
  p.state.webSsk = JSON.stringify({ 'xhs-pc-web': acceptSsk(hs.private_key_base64, String(d.ssk)) })
  p.state.fingerprintReady = true
}

/** 上游 _fetch_gid / ensure_webprofile：上报 profileData，换 gid。 */
export async function webprofile(p: Pc): Promise<string> {
  const existing = p.shared().gid
  if (p.webprofileReported && existing) return existing
  const data = {
    platform: 'Windows',
    sdkVersion: PC_REFERENCE.release.webProfileSdkVersion,
    svn: '2',
    profileData: pcProfileData(p.state.profileDataOptions(rand.now())),
  }
  const res = await security(p, '/api/sec/v1/shield/webprofile', data, { tier: '0301', mnsProfile: 'webprofile', includeB1: true })
  // 风控状态码照常抛出；只有响应体不是 JSON 时按上报失败处理（上游 except 后返回 None）
  checkStatus(res, COOKIE_HINT)
  const body = await parseJson<any>(res).catch(() => ({}))
  const gid = p.shared().gid
  if (!res.ok || !(body?.success === true || body?.code === 0) || !gid) throw new CatbusError('RISK_CONTROL', 'webprofile 上报没有换到 gid', { detail: { kind: 'blocked' } })
  p.state.p1 += 1
  p.state.fingerprintReady = true
  p.webprofileReported = true
  return gid
}

/** 上游 generate_init_cookies：从零建立一个匿名设备会话（不含 webprofile）。 */
export async function initAnonymous(p: Pc): Promise<void> {
  // 上游先用空 cookie 建一次 profile（消耗一次 tab 设备 ID 的 uuid4，这里是 Pc 构造时的那次），导航后再用初始 cookie 重建
  p.jar.cookies.splice(0)
  await navigate(p)
  const ts = rand.now()
  const a1 = generateA1()
  const webId = generateWebId(a1)
  const loadts = ts + rand.randint(50, 200)
  p.replaceShared({
    abRequestId: p.shared().abRequestId!,
    ets: String(normalizeEts(ts)),
    webBuild: PC_REFERENCE.release.webBuild,
    xsecappid: PC_REFERENCE.release.appId,
    loadts: String(loadts),
    a1,
    webId,
  })
  p.resetState()
  p.loginB1 = ''
  p.webprofileReported = false
  await initializeSecurity(p)
  await activate(p)
}

// ---------------------------------------------------------------- 二维码 / 短信

export async function qrcodeCreate(p: Pc): Promise<{ qrId: string; code: string; url: string }> {
  const s = await p.loginSigned('/api/sns/web/v1/login/qrcode/create', { qr_type: 1 }, 'POST', { tier: '0301', mnsProfile: 'qrcode_create' })
  const body = await jsonOf(await send(p, 'POST', `${EDITH}/api/sns/web/v1/login/qrcode/create`, s.headers, 'post', { body: s.body }))
  const d = body?.data ?? {}
  if (!body?.success || !d.qr_id || !d.code || !d.url) throw new CatbusError('UPSTREAM', body?.msg || '获取二维码失败')
  return { qrId: String(d.qr_id), code: String(d.code), url: String(d.url) }
}

/** 上游 check_qrcode_status：0 待扫码、1 待确认、2 成功（成功时换正式 web_session）、3 过期。 */
export async function qrcodeStatus(p: Pc, qrId: string, code: string): Promise<number> {
  const s = await p.loginSigned('/api/qrcode/userinfo', { qrId, code }, 'POST', { tier: '0301', mnsProfile: 'qrcode_poll' })
  const body = await jsonOf(await send(p, 'POST', `${EDITH}/api/qrcode/userinfo`, s.headers, 'post', { body: s.body }))
  const status = body?.data?.codeStatus
  if (status == null) throw new CatbusError('UPSTREAM', body?.msg || '二维码状态响应缺少 codeStatus')
  if (status === 2) await qrcodeFinish(p, qrId, code)
  return Number(status)
}

export async function qrcodeFinish(p: Pc, qrId: string, code: string): Promise<void> {
  const api = splice('/api/sns/web/v1/login/qrcode/status', { qr_id: qrId, code })
  const visitor = p.shared().web_session ?? ''
  const s = await p.loginSigned(api, '', 'GET', { tier: '0301', mnsProfile: 'qrcode_poll' })
  s.headers['x-login-mode'] = ''
  const res = await send(p, 'GET', EDITH + api, s.headers, 'get-login-mode', { appendShared: ['web_session', 'id_token', 'x-rednote-datactry', 'x-rednote-holderctry'] })
  const body = await jsonOf(res)
  const d = body?.data ?? {}
  if (!body?.success || d.code_status !== 2) throw new CatbusError('AUTH_REQUIRED', body?.msg || '二维码登录状态无效')
  // 上游 `cookies.pop(name); cookies[name] = value` 在 cookie dict 里挪到末尾，但 HostCookieStore 记住的发送顺序不变，
  // 线上仍在原位，所以这里只改值
  const session = String(d.login_info?.session ?? '')
  if (session) p.setCookie('web_session', session)
  else if (!p.shared().web_session || p.shared().web_session === visitor) throw new CatbusError('AUTH_REQUIRED', '二维码登录响应缺少正式 web_session')
  p.sync()
}

export async function sendSmsCode(p: Pc, phone: string, zone = '86'): Promise<void> {
  const api = splice('/api/sns/web/v2/login/send_code', { phone, zone, type: 'login' })
  const s = await p.loginSigned(api, '', 'GET')
  const body = await jsonOf(await send(p, 'GET', EDITH + api, s.headers, 'get'))
  if (!body?.success) throw new CatbusError('UPSTREAM', body?.msg || '发送验证码失败', { detail: { code: body?.code } })
}

export async function smsLoginCode(p: Pc, phone: string, code: string, zone = '86'): Promise<void> {
  const api = splice('/api/sns/web/v1/login/check_code', { phone, zone, code })
  const s = await p.loginSigned(api, '', 'GET')
  const checked = await jsonOf(await send(p, 'GET', EDITH + api, s.headers, 'get'))
  const token = checked?.data?.mobile_token
  if (!checked?.success || !token) throw new CatbusError('AUTH_REQUIRED', checked?.msg || '验证码验证失败')
  const login = '/api/sns/web/v2/login/code'
  const s2 = await p.loginSigned(login, { mobile_token: token, zone, phone }, 'POST')
  const body = await jsonOf(await send(p, 'POST', EDITH + login, s2.headers, 'post', { body: s2.body }))
  const session = body?.data?.session
  if (!body?.success || !session) throw new CatbusError('AUTH_REQUIRED', body?.msg || '登录失败')
  p.setCookie('web_session', String(session))
  p.sync()
}

/** 上游 XHSLoginApi.get_user_info：user/me，guest 为 false 才算正式登录。 */
export async function loginUserMe(p: Pc): Promise<any> {
  const s = await p.loginSigned('/api/sns/web/v2/user/me', '', 'GET')
  const body = await jsonOf(await send(p, 'GET', `${EDITH}/api/sns/web/v2/user/me`, s.headers, 'get'))
  return body?.success ? (body.data ?? {}) : null
}
