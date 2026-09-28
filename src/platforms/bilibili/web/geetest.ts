import { createCipheriv, createHash } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import { HttpClient, type HttpResponse } from '../../../core/http.js'
import { interactive } from '../../../core/login.js'
import { jsonDumps } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import * as api from './api.js'
import type { Bili } from './client.js'
import { manualGeetest } from './geetest-manual.js'
import { BROWSER, COOKIE_ORDER, PASSPORT, PROFILE } from './profile.js'
import { bLsid, sid } from './sign.js'

/**
 * 极验 v3（上游 utils/geetest_w.py、tools/geetest_solve.py）：
 * `w` 的加密原语、fullpage 无感通道，以及降级到点选题后的自动识别（geetest-vision.ts）→ 提交 → 失败换题重试。
 * 自动识别连续失败时，终端里改为在本地页面上手动验证（geetest-manual.ts）。
 */

const AES_IV = Buffer.from('0000000000000000')
const RSA_N_HEX =
  '00C1E3934D1614465B33053E7F48EE4EC87B14B95EF88947713D25EECBFF7E74' +
  'C7977D02DC1D9451F79DD5D1C10C29ACB6A9B4D6FB7D0A0279B6719E1772565F' +
  '09AF627715919221AEF91899CAE08C0D686D748B20A3603BE2318CA6BC2B5970' +
  '6592A9219D0BF05C9F65023A21D2330807252AE0066D59CEEFA5F2748EA80BAB81'
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()'
const B64_MASKS = [0x6f0000, 0x90b400, 0x004b14, 0x0000eb]
export const GEETEST_VERSION = '9.2.0-guwyxh'

export function genAesKey(length = 16): string {
  return rand.string(length, '0123456789abcdef')
}

export function aesEncrypt(plaintext: string, key: string): Buffer {
  const c = createCipheriv('aes-128-cbc', Buffer.from(key), AES_IV)
  return Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
}

function gatherBits(value: number, mask: number): number {
  let n = 0
  for (let r = 23; r >= 0; r--) if ((mask >> r) & 1) n = (n << 1) + ((value >> r) & 1)
  return n
}

/** 极验自定义 base64：按掩码做位挑选，尾部用 '.' 填充。 */
export function customB64(data: Uint8Array): string {
  let res = ''
  let end = ''
  const size = data.length
  for (let a = 0; a < size; a += 3) {
    let v: number
    let take: number
    if (a + 2 < size) {
      v = (data[a]! << 16) + (data[a + 1]! << 8) + data[a + 2]!
      take = 4
    } else if (size % 3 === 2) {
      v = (data[a]! << 16) + (data[a + 1]! << 8)
      take = 3
      end = '.'
    } else {
      v = data[a]! << 16
      take = 2
      end = '..'
    }
    for (const m of B64_MASKS.slice(0, take)) res += B64_ALPHABET[gatherBits(v, m)]
  }
  return res + end
}

const RSA_N = BigInt('0x' + RSA_N_HEX)
const RSA_E = 0x10001n
const RSA_BYTES = 128

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base %= mod
  for (; exp > 0n; exp >>= 1n) {
    if (exp & 1n) result = (result * base) % mod
    base = (base * base) % mod
  }
  return result
}

/**
 * 用极验公钥加密 AES 密钥（PKCS#1 v1.5），十六进制。填充的非零随机字节逐个从 rand.bytes 取（取到 0 就重取），
 * 这样对拍时与上游（gen.py 换成确定性随机字节的同一套填充）逐字节一致；平时就是 crypto.randomBytes。
 */
export function rsaEncryptKey(key: string): string {
  const m = Buffer.from(key)
  const ps: number[] = []
  while (ps.length < RSA_BYTES - m.length - 3) {
    const b = rand.bytes(1)[0]!
    if (b) ps.push(b)
  }
  const em = Buffer.concat([Buffer.from([0, 2]), Buffer.from(ps), Buffer.from([0]), m])
  return modPow(BigInt('0x' + em.toString('hex')), RSA_E, RSA_N).toString(16).padStart(RSA_BYTES * 2, '0')
}

/** `tt` 字段的插入式混淆；取模用原始 track 的长度。 */
export function csCipher(track: string, c: number[] | null | undefined, s: string): string {
  if (!c?.length || !s) return track
  const [s0, , a, , tail] = c as [number, number, number, number, number]
  let result = track
  const base = track.length
  for (let offset = 0; offset < s.length - 1; offset += 2) {
    const ch = parseInt(s.slice(offset, offset + 2), 16)
    const pos = (s0 * ch * ch + a * ch + tail) % base
    result = result.slice(0, pos) + String.fromCharCode(ch) + result.slice(pos)
  }
  return result
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex')

const EMPTY_TRACK = 'M(*((1((M(('
const EMPTY_HDL_TRACK = 'tEQOYESJYERVYEQ.'
const EMPTY_BUF_MAGIC = '-1magic data'.repeat(73) + '-1'
const EMPTY_BUF_BANG = '-1!!'.repeat(73) + '-1'
const EMPTY_HDL_N = 'dGFdxFsdzEBYxHgZ'.repeat(73) + 'dGE.'

export function defaultEp(nowMs = rand.now()): Record<string, unknown> {
  const tm: Record<string, number> = {}
  ;[...'abcdefghijklmnopqrstu'].forEach((k, i) => (tm[k] = 'afghijlmnopqr'.includes(k) ? nowMs + i : 0))
  return {
    v: GEETEST_VERSION,
    te: false,
    $_BBn: false,
    ven: PROFILE.webglVendor,
    ren: PROFILE.webglRenderer,
    fp: null,
    lp: null,
    em: { ph: 0, cp: 0, ek: '11', wd: 1, nt: 0, si: 0, sc: 0 },
    tm,
    dnf: 'dnf',
    by: 2,
  }
}

/** 极验手工拼的 JSON：`"key":value`，值用 Python json.dumps 的默认分隔符。 */
function stringify(fields: [string, unknown][]): string {
  return '{' + fields.map(([k, v]) => `${jsonDumps(k)}:${jsonDumps(v, { ensureAscii: false })}`).join(',') + '}'
}

const tt = (c: number[] | null | undefined, s: string) => (c?.length && s ? csCipher(EMPTY_TRACK, c, s) : EMPTY_TRACK)

/** fullpage（无感判定）的明文载荷（build_payload）。 */
export function buildPayload(gt: string, challenge: string, passtime: number, c?: number[] | null, s = '', ep = defaultEp()): string {
  return stringify([
    ['lang', 'zh-cn'],
    ['type', 'fullpage'],
    ['tt', tt(c, s)],
    ['light', -1],
    ['s', md5(EMPTY_HDL_TRACK)],
    ['h', md5(EMPTY_HDL_N)],
    ['hh', md5(EMPTY_BUF_MAGIC)],
    ['hi', md5(EMPTY_BUF_BANG)],
    ['vip_order', -1],
    ['ct', -1],
    ['ep', ep],
    ['passtime', passtime],
    ['rp', md5(`${gt}${challenge}${passtime}`)],
  ])
}

/** 第一发 get.php 的明文载荷（build_init_payload）。 */
export function buildInitPayload(gt: string, challenge: string): string {
  return jsonDumps(
    {
      gt,
      challenge,
      offline: false,
      new_captcha: true,
      product: 'bind',
      https: true,
      lang: 'zh-cn',
      type: 'fullpage',
      protocol: 'https://',
      width: '300px',
      cc: 20,
      ww: true,
      i: EMPTY_BUF_BANG,
    },
    { separators: [',', ':'], ensureAscii: false },
  )
}

/** 点选提交（ajax.php）的明文载荷（build_click_payload）：有 a 时才带 rp。 */
export function buildClickPayload(gt: string, challenge: string, a: string, pic: string, passtime: number, c?: number[] | null, s = '', ep = defaultEp()): string {
  const fields: [string, unknown][] = [
    ['lang', 'zh-cn'],
    ['passtime', passtime],
    ['a', a],
    ['pic', pic],
    ['tt', tt(c, s)],
    ['ep', ep],
  ]
  if (a) fields.push(['rp', md5(`${gt}${challenge}${passtime}`)])
  return stringify(fields)
}

/** JS 的 Math.round（.5 一律向 +∞），即上游的 _js_round。 */
const jsRound = (x: number) => Math.floor(x + 0.5)

/** 点击坐标 → `a` 字段：`x_y,x_y`，坐标是相对图片宽高的万分比（encode_click_a）。 */
export function encodeClickA(clicks: [number, number][]): string {
  return clicks.map(([x, y]) => `${Math.trunc(x)}_${Math.trunc(y)}`).join(',')
}

/** 0~1 的相对坐标 → `a` 字段（encode_click_a_from_ratio）。 */
export function encodeClickAFromRatio(ratios: [number, number][]): string {
  return encodeClickA(ratios.map(([rx, ry]) => [jsRound(rx * 10000), jsRound(ry * 10000)]))
}

export function buildW(payload: string, key = genAesKey(), withRsa = true): string {
  const body = customB64(aesEncrypt(payload, key))
  return withRsa ? body + rsaEncryptKey(key) : body
}

// ---------------------------------------------------------------- 链路

const GEETEST = 'https://api.geetest.com'
const REFERER = 'https://passport.bilibili.com/'
/** 点选最多试几道题（上游 BiliAuth.from_sms_login 的 attempts=4）。 */
const ATTEMPTS = 4
const RETRYABLE_STATUS = new Set([412, 429, 502, 503, 504])

type Cookies = Map<string, string>

function jsonp(text: string): any {
  const m = /^[^(]*\(([\s\S]*)\)\s*$/.exec(text.trim())
  return JSON.parse(m ? m[1]! : text)
}

/** trans_cookies：Cookie 串 → 有序的名值表。 */
function parseCookies(str: string): Cookies {
  const out: Cookies = new Map()
  for (let item of str.split(';')) {
    item = item.trim()
    const i = item.indexOf('=')
    if (!item || i < 0) continue
    out.set(item.slice(0, i).trim(), item.slice(i + 1).trim())
  }
  return out
}

const cookieString = (c: Cookies) => [...c].map(([k, v]) => `${k}=${v}`).join('; ')

/** sort_cookies：按浏览器的 cookie 顺序重排，表外的按原顺序排在最后。 */
function sortCookies(c: Cookies): Cookies {
  const known = COOKIE_ORDER.filter((k) => c.has(k))
  return new Map([...known, ...[...c.keys()].filter((k) => !COOKIE_ORDER.includes(k))].map((k) => [k, c.get(k)!]))
}

/**
 * 上游 `BiliAuth.from_cookie(state['cookies'], fill_device=False)` 的 cookie：极验 cookie 之外补上会话级的
 * sid / PVID / b_lsid，再按浏览器顺序排好。上游提交和换题都用这份 cookie 请求 api.geetest.com。
 */
function sessionCookies(str: string): Cookies {
  const c = parseCookies(str)
  const newSid = sid() // setdefault 的参数总会先求值，随机数照样消耗
  if (!c.has('sid')) c.set('sid', newSid)
  if (!c.has('PVID')) c.set('PVID', '1')
  c.set('b_lsid', bLsid())
  return sortCookies(c)
}

/** 响应里新设的 cookie（requests_cookies_to_dict）。 */
function setCookies(res: HttpResponse): [string, string][] {
  return res.headers.getSetCookie().map((line) => {
    const i = line.indexOf('=')
    return [line.slice(0, i).trim(), line.slice(i + 1).split(';', 1)[0]!.trim()] as [string, string]
  })
}

/** 点选会话状态（上游落在 session.json 里的那份）。 */
interface ClickState {
  gt: string
  challenge: string
  token: string
  pic: string
  c: number[] | null
  s: string
  cookies: string
  fetchedAt: number
}

/**
 * 极验的请求：只带 referer（上游 `request(..., headers={'referer': REFERER})`），cookie 每次显式给出。
 * 用单独的 HTTP 客户端，极验的 cookie 不进 B 站凭证的 cookie 罐。
 */
class Geetest {
  private readonly http: HttpClient

  constructor(readonly b: Bili) {
    const { ctx } = b
    this.http = new HttpClient({ browser: BROWSER, os: 'windows', proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
  }

  /** 带退避重试的 GET（上游 http_util.request）。 */
  async get(url: string, query: [string, string | number][] | undefined, cookies: Cookies): Promise<HttpResponse> {
    let res!: HttpResponse
    for (let attempt = 0; attempt <= 3; attempt++) {
      res = await this.http.request({ url, query, headers: [['referer', REFERER]], cookies: Object.fromEntries(cookies) })
      if (!RETRYABLE_STATUS.has(res.status)) return res
      if (attempt < 3) await rand.sleep(1000 * 2 ** attempt, this.b.ctx.signal)
    }
    return res
  }

  /** JSONP 接口：自动带 callback，返回解析后的对象和新设的 cookie。 */
  async call(path: string, query: [string, string | number][], cookies: Cookies): Promise<{ body: any; cookies: [string, string][] }> {
    const res = await this.get(`${GEETEST}${path}`, [...query, ['callback', `geetest_${rand.now()}`]], cookies)
    const text = await res.text()
    try {
      return { body: jsonp(text), cookies: setCookies(res) }
    } catch {
      throw new CatbusError('UPSTREAM', `极验 ${path} 返回的不是 JSON（HTTP ${res.status}）`, { detail: { status: res.status, body: text.slice(0, 300) } })
    }
  }

  /** 下载题图。 */
  async image(servers: string[] | undefined, pic: string, cookies: Cookies): Promise<Uint8Array> {
    const server = (servers?.[0] ?? 'static.geetest.com/').replace(/\/+$/, '')
    const res = await this.get(`https://${server}/${pic.replace(/^\/+/, '')}`, undefined, cookies)
    if (res.status !== 200) throw captchaError(`下载极验题图失败（HTTP ${res.status}）`)
    return new Uint8Array(await res.arrayBuffer())
  }
}

function captchaError(message: string, detail: Record<string, unknown> = {}): CatbusError {
  return new CatbusError('RISK_CONTROL', message, { detail: { kind: 'captcha', ...detail } })
}

/** B 站会话的 cookie（上游 `auth.cookie`）。上游下载第一张题图时没传 cookies，带的就是这一份。 */
function biliCookies(b: Bili): Cookies {
  return new Map(b.http.prepare({ url: `${PASSPORT}/` }).cookies)
}

type Fetched = { validate: api.Geetest } | { state: ClickState; sprite: Uint8Array }

/**
 * 申请 B 站 captcha，走 fullpage 无感判定（上游 fetch）：
 * 1. get.php（w = AES + RSA）建立会话，拿 c / s；
 * 2. ajax.php（w 复用 AES）无感判定，直接放行时返回 validate；
 * 3. 降级到点选时，get.php?is_next=true&type=click 下发题图和新的 c / s，再下载题图。
 */
async function fetchPuzzle(g: Geetest): Promise<Fetched> {
  const { b } = g
  const captcha = await api.captcha(b)
  if (captcha.code !== 0) throw new CatbusError('UPSTREAM', `申请人机验证失败：${captcha.message ?? captcha.code}`, { detail: { code: captcha.code } })
  const { token, geetest } = captcha.data
  const { gt, challenge } = geetest

  const type = (await g.call('/gettype.php', [['gt', gt]], new Map())).body?.data?.type
  b.ctx.log.debug(`极验产品类型：${type}`)

  const cookies: Cookies = new Map()
  const key = genAesKey()
  const common: [string, string | number][] = [
    ['gt', gt],
    ['challenge', challenge],
    ['lang', 'zh-cn'],
    ['pt', 0],
    ['client_type', 'web'],
  ]
  const init = await g.call('/get.php', [...common, ['w', buildW(buildInitPayload(gt, challenge), key, true)]], cookies)
  for (const [k, v] of init.cookies) cookies.set(k, v)
  if (init.body.status !== 'success') throw captchaError('人机验证初始化被拒绝', { response: init.body })
  const { c, s } = init.body.data ?? {}

  const startedAt = rand.now()
  const decision = await g.call('/ajax.php', [...common, ['w', buildW(buildPayload(gt, challenge, 800, c, s ?? ''), key, false)]], cookies)
  for (const [k, v] of decision.cookies) cookies.set(k, v)
  const result = decision.body.data?.result
  b.ctx.log.debug(`极验 fullpage 判定：${result}`)
  if (result !== 'click') {
    const validate = decision.body.data?.validate
    if (validate) return { validate: { token, challenge, validate, seccode: `${validate}|jordan` } }
    throw captchaError(`极验没有放行，也没有下发点选题：${result ?? decision.body.status}`, { result: result ?? null })
  }

  const puzzle = await g.call(
    '/get.php',
    [
      ['is_next', 'true'],
      ['type', 'click'],
      ['gt', gt],
      ['challenge', challenge],
      ['lang', 'zh-cn'],
      ['https', 'true'],
      ['protocol', 'https://'],
      ['offline', 'false'],
      ['product', 'embed'],
      ['api_server', 'api.geetest.com'],
      ['isPC', 'true'],
      ['autoReset', 'true'],
      ['width', '100%'],
    ],
    cookies,
  )
  for (const [k, v] of puzzle.cookies) cookies.set(k, v)
  if (puzzle.body.status !== 'success') throw captchaError('极验拒绝下发点选题', { response: puzzle.body })
  const data = puzzle.body.data ?? {}
  if (!data.pic) throw captchaError('极验没有下发点选题图', { type: data.pic_type ?? null })
  const sprite = await g.image(data.static_servers, data.pic, biliCookies(b))
  return {
    state: { gt, challenge, token, pic: data.pic, c: data.c ?? null, s: data.s ?? '', cookies: cookieString(cookies), fetchedAt: startedAt },
    sprite,
  }
}

/** 提交点击坐标（上游 _post_ajax）。click 插件会重新生成 AES 密钥，并且总带 RSA 段。 */
async function postAjax(g: Geetest, state: ClickState, a: string): Promise<any> {
  // 服务端会拿请求到达时间校验 passtime：识别太快时补足等待，避免 `duration short`
  const elapsed = rand.now() - state.fetchedAt
  if (elapsed < 3500) await rand.sleep(3500 - elapsed, g.b.ctx.signal)
  const passtime = rand.now() - state.fetchedAt
  const w = buildW(buildClickPayload(state.gt, state.challenge, a, state.pic, passtime, state.c, state.s), undefined, true)
  const { body } = await g.call(
    '/ajax.php',
    [
      ['gt', state.gt],
      ['challenge', state.challenge],
      ['lang', 'zh-cn'],
      ['pt', 0],
      ['client_type', 'web'],
      ['w', w],
    ],
    sessionCookies(state.cookies),
  )
  return body
}

/** 验证失败后换一道题（上游 _refresh，对齐 click.3.1.2.js 的 refresh.php）。c / s 沿用原来的。 */
async function refresh(g: Geetest, state: ClickState): Promise<{ state: ClickState; sprite: Uint8Array }> {
  const cookies = sessionCookies(state.cookies)
  const { body, cookies: set } = await g.call(
    '/refresh.php',
    [
      ['gt', state.gt],
      ['challenge', state.challenge],
      ['lang', 'zh-cn'],
      ['type', 'click'],
    ],
    cookies,
  )
  for (const [k, v] of set) cookies.set(k, v)
  const sorted = sortCookies(cookies)
  const data = body.data ?? {}
  if (body.status !== 'success' || !data.pic) throw captchaError('极验拒绝换题', { response: body })
  const sprite = await g.image(data.image_servers, data.pic, sorted)
  return { state: { ...state, pic: data.pic, cookies: cookieString(sorted), fetchedAt: rand.now() }, sprite }
}

/**
 * 自动过极验（上游 tools/geetest_solve.solve）：无感通道放行就直接返回；降级到点选时自动识别并提交，
 * 服务端判 fail 就换题重试，最多 attempts 道题。识别或提交失败报 RISK_CONTROL（captcha）。
 */
export async function autoSolve(b: Bili, attempts = ATTEMPTS): Promise<api.Geetest> {
  const g = new Geetest(b)
  const first = await fetchPuzzle(g)
  if ('validate' in first) return first.validate
  let { state, sprite } = first
  const { solveClick } = await import('./geetest-vision.js')
  let body: any
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const r = await solveClick(sprite).catch((err: unknown) => {
      if (err instanceof CatbusError) throw err
      throw captchaError(`点选识别出错：${err instanceof Error ? err.message : String(err)}`)
    })
    b.ctx.log.debug(`极验点选第 ${attempt}/${attempts} 题：提示 ${r.hintText.join(' ')}，候选 ${r.candChars.join(' ')}，点击 ${JSON.stringify(r.order)}`, r.match)
    for (const w of r.warnings) b.ctx.log.debug(`极验点选：${w}`)
    const [width, height] = r.puzzleSize
    const a = encodeClickAFromRatio(r.order.map(([x, y]) => [x / width, y / height]))
    body = await postAjax(g, state, a)
    const validate = body?.data?.validate
    if (validate) return { token: state.token, challenge: state.challenge, validate, seccode: `${validate}|jordan` }
    if (body?.data?.result !== 'fail' || attempt === attempts) break
    ;({ state, sprite } = await refresh(g, state))
  }
  throw captchaError(`极验点选在 ${attempts} 道题内没有通过：${body?.data?.result ?? body?.status ?? '未知结果'}`, { result: body?.data?.result ?? null })
}

/** 自动识别失败后是否该交给人：验证码本身的失败（RISK_CONTROL），或者识别环境有问题（ERROR，例如缺模型）。 */
function isSolveFailure(err: unknown): err is CatbusError {
  return err instanceof CatbusError && (err.code === 'RISK_CONTROL' || err.code === 'ERROR')
}

/**
 * 登录用的极验：先自动过（无感 / 点选识别）；自动识别失败时，终端里（stdin 与 stderr 都是 TTY）重新申请一次 captcha，
 * 在本地页面上手动验证（上游 quick_sms_login.complete_geetest 的人工分支）；否则报 RISK_CONTROL。
 */
export async function solve(b: Bili): Promise<api.Geetest> {
  try {
    return await autoSolve(b)
  } catch (err) {
    if (!isSolveFailure(err)) throw err
    if (!interactive()) {
      // 环境问题（例如缺 OCR 模型）原样报出，带着它自己的修复提示
      if (err.code === 'ERROR') throw err
      throw new CatbusError('RISK_CONTROL', `人机验证没有自动通过：${err.message}`, {
        hint: '在终端里重新执行这条登录命令：自动识别失败时会在本地打开验证页面，在浏览器里手动完成即可；也可以改用扫码登录 catbus bilibili auth login --method qrcode',
        detail: { kind: 'captcha', ...(err.detail && typeof err.detail === 'object' ? err.detail : {}) },
      })
    }
    b.ctx.log.warn(`人机验证没有自动通过（${err.message}），改为在浏览器里手动验证`)
    const captcha = await api.captcha(b)
    if (captcha.code !== 0) throw new CatbusError('UPSTREAM', `申请人机验证失败：${captcha.message ?? captcha.code}`, { detail: { code: captcha.code } })
    const { token, geetest } = captcha.data
    const r = await manualGeetest(b.ctx, geetest.gt, geetest.challenge)
    return { token, challenge: r.challenge, validate: r.validate, seccode: r.seccode }
  }
}
