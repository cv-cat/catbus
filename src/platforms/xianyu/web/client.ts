import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { type HttpClient, type HttpRequest, parseJson } from '../../../core/http.js'
import { unquote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { UserRef } from '../../../core/schemas.js'
import { authError, httpClient, isGuest } from '../../../core/toolkit.js'
import { APP_KEY, BROWSER, COOKIE_DOMAIN, H5API, merge, MTOP_HEADERS, SESSION_HEADERS, userUrl } from './profile.js'
import { generateDeviceId, genTfstk } from './sign.js'

/**
 * 闲鱼 web 端的会话（上游 goofish_apis.py 的 XianyuApis 与 build_initial_cookies）：
 * cookie 罐、mtop 签名用的 `_m_h5_tk`、私信用的设备 ID，以及 mtop 业务码到 catbus 错误的映射。
 */

export interface MtopJson<T = any> {
  api?: string
  v?: string
  ret?: string[]
  data: T
  [key: string]: unknown
}

/** 令牌过期 / 为空：响应的 Set-Cookie 已经带来新的 `_m_h5_tk`，换新令牌重签一次。 */
const TOKEN_RE = /FAIL_SYS_TOKEN_EXOIRED|FAIL_SYS_TOKEN_EMPTY|FAIL_SYS_TOKEN_ILLEGAL|令牌过期|令牌为空/
const SESSION_RE = /FAIL_SYS_SESSION_EXPIRED|SESSION_EXPIRED|FAIL_SYS_LOGIN|未登录|请重新登录|请登录/
const CAPTCHA_RE = /RGV587_ERROR|FAIL_SYS_USER_VALIDATE/
const LIMIT_RE = /FAIL_SYS_TRAFFIC_LIMIT|FAIL_SYS_FLOWLIMIT/

export class Xianyu {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
  }

  /** 当前账号的用户 ID（cookie `unb`）。 */
  get myId(): string {
    return this.jar.get('unb') ?? ''
  }

  /** 昵称（cookie `tracknick`，可能是 URL 编码或 `\uXXXX` 转义过的）。 */
  get nick(): string | null {
    const raw = this.jar.get('tracknick')
    if (!raw) return null
    const s = unquote(raw)
    return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
  }

  me(): UserRef {
    return { id: this.myId, name: this.nick, url: userUrl(this.myId) }
  }

  /** 私信用的设备 ID：上游每次按 `unb` 随机生成；这里生成一次后存在凭证的 device 里。 */
  get deviceId(): string {
    const device = this.ctx.credential.device as { device_id?: string }
    return (device.device_id ??= generateDeviceId(this.myId))
  }

  /** mtop 签名用的令牌：cookie `_m_h5_tk` 下划线前的部分，没有（或已过期）时为空串。 */
  token(): string {
    const c = this.jar.forUrl(`${H5API}/`).find((x) => x.name === '_m_h5_tk')
    return (c?.value ?? '').split('_')[0]!
  }

  /** 全部 cookie 拼成一个 Cookie 头（上游 get_session_cookies_str，不分域名）。 */
  cookieString(): string {
    return Object.entries(this.jar.toObject())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  /** 每条命令开始时调用：游客还没有初始 cookie 时，生成一份并缓存在 guest.json。 */
  async init(): Promise<void> {
    if (isGuest(this.ctx) && !this.jar.has('cookie2')) await this.buildInitialCookies()
  }

  /**
   * 纯 HTTP 获取初始 cookie，不含登录态（上游 build_initial_cookies）：
   * eg.js 拿 `cna`，两次空签名的 mtop 拿 `_m_h5_tk` 和 `cookie2`，最后跑 JS 生成 `tfstk`。
   */
  async buildInitialCookies(): Promise<void> {
    await this.http.request({ url: 'https://log.mmstat.com/eg.js', headers: SESSION_HEADERS })
    const cna = this.jar.get('cna', '.mmstat.com')
    if (cna) this.jar.set('cna', cna, COOKIE_DOMAIN)
    for (const api of ['mtop.taobao.idlehome.home.webpc.feed', 'mtop.gaia.nodejs.gaia.idle.data.gw.v2.index.get']) {
      await this.http.request(unsignedMtop(api))
    }
    const tfstk = await genTfstk((line) => this.ctx.log.debug(line))
    if (tfstk) this.jar.set('tfstk', tfstk, COOKIE_DOMAIN)
  }

  /**
   * 发一个 mtop 请求并检查业务码。build 拿当前令牌构造请求（签名在里面算）；
   * 令牌过期或为空时用 Set-Cookie 带回的新令牌重签一次（上游只在 get_token 里这样做）。
   */
  async mtop<T = any>(build: (token: string) => HttpRequest): Promise<MtopJson<T>> {
    for (let attempt = 0; ; attempt++) {
      const body = await parseJson<MtopJson<T>>(await this.http.request(build(this.token())))
      const ret = (body.ret ?? []).join(';')
      if (attempt === 0 && TOKEN_RE.test(ret)) {
        this.ctx.log.debug(`mtop 令牌失效，重签：${ret}`)
        continue
      }
      check(this.ctx, body)
      return body
    }
  }

  /** 写操作和私信前检查登录态（registry 已保证不是游客，这里防 cookie 不全）。 */
  requireLogin(): void {
    if (!this.myId) throw authError(this.ctx, '当前账号的 cookie 里没有 unb，请重新登录')
  }
}

/** 空签名的 mtop 请求（build_initial_cookies、qrcode_login 最后一步），只为拿响应里的 cookie。 */
export function unsignedMtop(api: string): HttpRequest {
  return {
    method: 'POST',
    url: `${H5API}/${api}/1.0/`,
    query: [
      ['jsv', '2.7.2'],
      ['appKey', APP_KEY],
      ['t', String(rand.now())],
      ['sign', ''],
      ['v', '1.0'],
      ['type', 'originaljson'],
      ['dataType', 'json'],
      ['timeout', '20000'],
      ['api', api],
      ['sessionOption', 'AutoLoginOnly'],
      ['spm_cnt', 'a21ybx.home.0.0'],
    ],
    body: 'data=%7B%7D',
    headers: merge(SESSION_HEADERS, MTOP_HEADERS),
  }
}

/** mtop 的 ret 映射成 catbus 的错误（AGENTS 6.4）。 */
export function check(ctx: HandlerContext, body: MtopJson): void {
  const ret = body?.ret ?? []
  const first = String(ret[0] ?? '')
  if (first.startsWith('SUCCESS')) return
  const all = ret.join(';')
  const message = first.split('::').slice(1).join('::') || first || '闲鱼返回了空的 ret'
  const detail = { ret, api: body?.api ?? null }
  if (SESSION_RE.test(all)) throw authError(ctx, `闲鱼登录态无效：${message}`)
  if (CAPTCHA_RE.test(all)) {
    throw new CatbusError('RISK_CONTROL', `闲鱼风控拦截，需要滑块验证：${message}`, { detail: { kind: 'captcha', ...detail, url: body?.data?.url ?? null } })
  }
  if (LIMIT_RE.test(all)) throw new CatbusError('RISK_CONTROL', `闲鱼限流：${message}`, { detail: { kind: 'rate_limit', ...detail } })
  throw new CatbusError('UPSTREAM', `闲鱼返回错误：${message}`, { detail })
}

/** 建立会话，游客补齐初始 cookie。 */
export async function xianyu(ctx: HandlerContext): Promise<Xianyu> {
  const x = new Xianyu(ctx)
  await x.init()
  return x
}
