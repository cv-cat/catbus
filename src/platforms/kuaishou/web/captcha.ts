import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs } from '../../../core/http.js'
import { compactJson, parseQsl, pyFloatStr, pyRound, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { verifyParam } from './captcha-crypto.js'
import { captchaExtraParamJson, gpuInfoJson } from './captcha-fp.js'
import type { Json, Ks } from './client.js'
import { findGapX } from './gap.js'
import * as gdfp from './gdfp.js'
import { ACCEPT_AXIOS, ACCEPT_ENCODING, ACCEPT_LANGUAGE, RECO_REFERER, UA } from './profile.js'

/**
 * 快手滑块验证码（captcha.zt.kuaishou.com，上游 utils/captcha.py 与 KuaishouAPI._pass_captcha）。
 *
 * 风控接口返回 `{"data":{"result":400002,"url":"…/iframe/index.html?captchaSession=…"}}`（GraphQL 是
 * `errors` + `data.captcha.url`）时：验证码 iframe 的 webweapon 引导 → config → 下载背景图与滑块图 → 找缺口 →
 * 造轨迹 → gdfp manMachine 预检 → `$encrypt` → 提交 verifyUrl2（kSecretApiVerify）。通过后调用方重新序列化
 * 同一条 Cookie 线序，把原请求重发一次。
 */

const HOST = 'https://captcha.zt.kuaishou.com'
const CONFIG_URL = `${HOST}/rest/zt/captcha/sliding/config`
const VERIFY_URL = `${HOST}/rest/zt/captcha/sliding/kSecretApiVerify`
const TIMEOUT = 30

/** Python 的真值判断：空数组 / 空对象 / 空串 / 0 / null 为假。 */
function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === 'object') return Object.keys(v).length > 0
  return Boolean(v)
}

/** _is_risk：REST `data.result == 400002` 且有 `data.url`，或 GraphQL `errors` + `data.captcha.url`。 */
export function isRisk(resp: Json): boolean {
  const data = resp?.data && typeof resp.data === 'object' ? resp.data : {}
  if (data.result === 400002 && truthy(data.url)) return true
  return truthy(data.captcha?.url) && truthy(resp?.errors)
}

/** _graphql_risk_as_rest：GraphQL 的挑战改成 REST 的形状，交给同一个求解器。 */
export function graphqlRiskAsRest(resp: Json): Json {
  const url = resp?.data?.captcha?.url
  return url ? { data: { result: 400002, url } } : (resp ?? {})
}

/** extract_captcha_url：验证码 iframe 的完整地址（它的 query 会带进 Referer，不能截短）。 */
export function extractCaptchaUrl(risk: Json): string {
  const data = truthy(risk?.data) ? risk.data : risk
  return String(data?.url || data?.captcha?.url || '')
}

/** extract_session：iframe 地址里的 captchaSession。 */
export function extractSession(risk: Json): string {
  const url = extractCaptchaUrl(risk)
  if (!url) return ''
  const q = url.indexOf('?')
  if (q < 0) return ''
  const hash = url.indexOf('#', q)
  const query = url.slice(q + 1, hash < 0 ? undefined : hash)
  return parseQsl(query).find(([k, v]) => k === 'captchaSession' && v !== '')?.[1] ?? ''
}

/** 轨迹上的一个点：x 在被 `min()` 夹到整数的 distance 时是 Python int，其余是 float。 */
export interface TrackPoint {
  x: number
  xInt: boolean
  y: number
  t: number
}

/**
 * build_trajectory：先加速后减速、末段带小幅回调与抖动的拖动轨迹（t 是毫秒偏移）。
 * distanceInt 表示 distance 在上游是 int（缺口 x 减 disX）还是 float（兜底的 1.0）。
 */
export function buildTrajectory(distance: number, distanceInt: boolean, startY = 0): TrackPoint[] {
  const points: TrackPoint[] = []
  let t = 0
  let x = 0
  let xInt = false
  let v = 0
  // 前 70%～80% 加速，之后减速
  const mid = distance * (0.7 + rand.random() * 0.1)
  while (x < distance) {
    const a = x < mid ? 2.0 + rand.random() * 2.0 : -(2.5 + rand.random() * 2.0)
    const dt = 8 + rand.random() * 14
    v = Math.max(0.4, v + (a * dt) / 100.0)
    // min(distance, x + v)：相等时 Python 返回第一个参数
    if (x + v < distance) {
      x = x + v
      xInt = false
    } else {
      x = distance
      xInt = distanceInt
    }
    t += Math.trunc(dt)
    points.push({ x: xInt ? x : pyRound(x, 2), xInt, y: startY + pyRound(rand.gauss(0, 0.8), 2), t })
  }
  // 冲过头一点再拉回来
  for (const back of [2.2, 1.1, 0.4, 0.0]) {
    t += Math.trunc(20 + rand.random() * 40)
    points.push({ x: pyRound(distance - back, 2), xInt: false, y: startY + pyRound(rand.gauss(0, 0.6), 2), t })
  }
  return points
}

/** format_trajectory：`x|y|dt` 逗号连接，dt 相对第一个点。 */
export function formatTrajectory(points: TrackPoint[]): string {
  if (!points.length) return ''
  const t0 = points[0]!.t
  return points.map((p) => `${p.xInt ? String(p.x) : pyFloatStr(p.x)}|${pyFloatStr(p.y)}|${p.t - t0}`).join(',')
}

/** Python 的 `int(v)`：数字截断，字符串按十进制解析。 */
function pyInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new CatbusError('UPSTREAM', `验证码配置里的数值不合法：${String(v)}`, { detail: { kind: 'captcha' } })
  return Math.trunc(n)
}

export interface SolverInput {
  session: string
  /** gdfp 遥测里的 cookie（验证码路径可见的那些）。 */
  cookies: [string, string][]
  /** iframe 的完整地址，作 Referer。 */
  referer: string
  did: string
  /** 验证码页面冻结的 kww：只进 config / verify 的 XHR，图片请求不带。 */
  kww: string
  /** 带重复产品名的完整 Cookie 头。 */
  cookieHeader: string
  /** 触发验证码的业务页（gdfp module_section.1.page）。 */
  parentUrl: string
  /** verification-captcha `/s/w/c` 下发并执行过的 fpUrl / signUrl。 */
  scriptUrls: string[]
}

/** SlidingCaptcha：一次滑块验证会话。 */
export class SlidingCaptcha {
  config: Json = {}

  constructor(
    private readonly ks: Ks,
    private readonly o: SolverInput,
  ) {}

  /** 各请求的 Chrome 请求头：config / verify 是 XHR（带 kww），图片是 `<img>` 子资源（不带）。 */
  private headers(kind: 'config' | 'image' | 'verify'): HeaderPairs {
    const h: HeaderPairs =
      kind === 'image'
        ? [
            ['user-agent', UA],
            ['accept', 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'],
            ['accept-encoding', ACCEPT_ENCODING],
            ['accept-language', ACCEPT_LANGUAGE],
            ['referer', this.o.referer],
            ['sec-fetch-dest', 'image'],
            ['sec-fetch-mode', 'no-cors'],
            ['sec-fetch-site', 'same-origin'],
          ]
        : [
            ['user-agent', UA],
            ['accept', ACCEPT_AXIOS],
            ['accept-encoding', ACCEPT_ENCODING],
            ['accept-language', ACCEPT_LANGUAGE],
            ['origin', HOST],
            ['referer', this.o.referer],
            ['sec-fetch-dest', 'empty'],
            ['sec-fetch-mode', 'cors'],
            ['sec-fetch-site', 'same-origin'],
          ]
    if (kind === 'config') h.push(['content-type', 'application/x-www-form-urlencoded'])
    else if (kind === 'verify') h.push(['content-type', 'application/json'])
    if (kind !== 'image' && this.o.kww) h.push(['kww', this.o.kww])
    return h
  }

  /** 第 1 步：拿 captchaSn 与图片尺寸。 */
  async loadConfig(): Promise<Json> {
    if (!this.o.kww || !this.o.cookieHeader) throw new CatbusError('UPSTREAM', '验证码 config 请求缺少页面 kww 或 Cookie', { detail: { kind: 'captcha' } })
    const res = await this.ks.send({ method: 'POST', url: CONFIG_URL, headers: this.headers('config'), cookie: this.o.cookieHeader, body: `captchaSession=${quote(this.o.session, '')}`, timeout: TIMEOUT })
    this.config = await this.ks.json(res)
    if (this.config?.result !== 1) this.ks.log.debug('验证码 config 失败', this.config)
    return this.config
  }

  /** 第 2 步：下背景图与滑块图。 */
  async loadImages(): Promise<[Uint8Array, Uint8Array]> {
    const sn = String(this.config.captchaSn)
    const get = async (url: string) => {
      const res = await this.ks.send({ method: 'GET', url, query: [['captchaSn', sn]], headers: this.headers('image'), cookie: this.o.cookieHeader, timeout: TIMEOUT })
      return new Uint8Array(await res.arrayBuffer())
    }
    const bg = await get(String(this.config.bgPicUrl))
    const cut = await get(String(this.config.cutPicUrl))
    return [bg, cut]
  }

  /** 走完整条：config → 下图 → 找缺口 → 造轨迹 → gdfp 预检 → 加密提交。返回 verify 的响应。 */
  async solve(): Promise<Json> {
    if (!Object.keys(this.config).length) await this.loadConfig()
    if (this.config?.result !== 1) return this.config
    const [bg, cut] = await this.loadImages()
    const gapX = await findGapX(bg, cut)
    const disX = pyInt(this.config.disX ?? 0)
    // max(1.0, gap_x - dis_x)：差值大于 1 时是 int，否则是 float 的 1.0
    const diff = gapX - disX
    const distanceInt = diff > 1
    const distance = distanceInt ? diff : 1
    this.ks.log.debug(`验证码缺口 x=${gapX}，起点 disX=${disX}，移动 ${distance.toFixed(1)}px`)
    const points = buildTrajectory(distance, distanceInt, pyInt(this.config.disY ?? 0))
    // 提交前先做 gdfp manMachine 预检，不做服务端回 350014 anti check err
    await this.precheck()
    const payload: [string, unknown][] = [
      ['captchaSn', this.config.captchaSn],
      ['bgDisWidth', pyInt(this.config.bgPicWidth)],
      ['bgDisHeight', pyInt(this.config.bgPicHeight)],
      ['cutDisWidth', pyInt(this.config.cutPicWidth)],
      ['cutDisHeight', pyInt(this.config.cutPicHeight)],
      ['relativeX', Math.round(disX + distance)],
      ['relativeY', pyInt(this.config.disY ?? 0)],
      ['trajectory', formatTrajectory(points)],
      ['gpuInfo', gpuInfoJson()],
      ['captchaExtraParam', captchaExtraParamJson({ did: this.o.did })],
    ]
    return this.submit(payload)
  }

  /** gdfp manMachine 预检：SDK_INIT → core → whole，任何一步不通过都不提交 verify。 */
  async precheck(): Promise<void> {
    const r = await gdfp.report(this.ks, {
      did: this.o.did,
      cookies: this.o.cookies,
      parentUrl: this.o.parentUrl,
      iframeUrl: this.o.referer,
      ua: UA,
      scriptUrls: this.o.scriptUrls,
    })
    const reportUrls = r.config?.reportConfig?.reportUrls ?? []
    if (r.init?.result !== 1 || r.config?.switch !== 1 || r.config?.status !== 1 || !reportUrls.length || r.core?.result !== 1 || r.whole?.result !== 1) {
      throw new CatbusError('UPSTREAM', '验证码 gdfp 预检没有完整通过，不提交 verify', { detail: { kind: 'captcha' } })
    }
  }

  /** 把载荷加密成 verifyParam 提交到 verifyUrl2（明文 verifyUrl 服务端回 350013）。 */
  async submit(payload: [string, unknown][]): Promise<Json> {
    if (!this.o.kww || !this.o.cookieHeader) throw new CatbusError('UPSTREAM', '验证码 verify 缺少页面 kww 或 Cookie', { detail: { kind: 'captcha' } })
    const res = await this.ks.send({
      method: 'POST',
      url: String(this.config.verifyUrl2 || VERIFY_URL),
      headers: this.headers('verify'),
      cookie: this.o.cookieHeader,
      body: compactJson({ verifyParam: verifyParam(payload) }),
      timeout: TIMEOUT,
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return { _status: res.status, _text: text.slice(0, 200) }
    }
  }
}

/**
 * _pass_captcha：撞上滑块时过一次验证码。通过返回 true；没过或出错返回 false，调用方按原样返回风控响应
 * （最后报 RISK_CONTROL）。referer 是触发风控的业务页。
 */
export async function passCaptcha(ks: Ks, risk: Json, referer?: string): Promise<boolean> {
  const session = extractSession(risk)
  if (!session) return false
  ks.log.info('快手要求滑块验证，正在自动验证…')
  let result: Json
  try {
    const iframeUrl = extractCaptchaUrl(risk)
    const context = await ks.s.prepareCaptchaContext(iframeUrl)
    const solver = new SlidingCaptcha(ks, {
      session,
      cookies: context.cookies,
      did: ks.s.did,
      referer: iframeUrl,
      kww: context.kww,
      cookieHeader: context.cookieHeader,
      parentUrl: referer || RECO_REFERER,
      scriptUrls: context.scriptUrls,
    })
    result = await solver.solve()
  } catch (err) {
    ks.log.warn(`自动过滑块出错：${(err as Error).message}`)
    return false
  }
  const ok = result?.result === 1
  if (ok) ks.log.info('滑块验证通过，重发原请求')
  else ks.log.warn(`滑块验证没有通过：${JSON.stringify(result).slice(0, 120)}`)
  return ok
}
