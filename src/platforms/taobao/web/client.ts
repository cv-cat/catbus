import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import type { HttpClient, HttpRequest, HttpResponse } from '../../../core/http.js'
import { unquote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { UserRef } from '../../../core/schemas.js'
import { authError, httpClient } from '../../../core/toolkit.js'
import * as api from './api.js'
import { BROWSER } from './profile.js'
import { generateDeviceId } from './sign.js'

/**
 * 淘宝 web 端的会话（上游 TaobaoApis + taobaoLive 的构造部分）：cookie、设备号、当前账号。
 *
 * 上游用 requests 的 Session，cookie 是从字符串导入的（没有 domain），会发给所有域名，
 * 顺序是 `session.cookies.get_dict()` 的顺序，即写入顺序。这里照做。
 */
export class Taobao {
  readonly http: HttpClient
  readonly jar: CookieJar

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.jar = this.http.jar!
  }

  /** 所有未过期的 cookie，按写入顺序；同名（不同 domain）时位置取第一个、值取最后一个，与 get_dict 相同。 */
  cookies(): Record<string, string> {
    const now = rand.nowSeconds()
    const map = new Map<string, string>()
    for (const c of this.jar.cookies) if (c.expires == null || c.expires > now) map.set(c.name, c.value)
    return Object.fromEntries(map)
  }

  /** 上游 get_session_cookies_str：`k=v; k=v`。 */
  cookieString(): string {
    return Object.entries(this.cookies())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  cookie(name: string): string | undefined {
    return this.cookies()[name]
  }

  /** 当前账号的用户 ID（cookie `unb`）。 */
  get myId(): string {
    return this.cookie('unb') ?? ''
  }

  /** cookie `_nk_` 的原值（没有时用 `tracknick`）：URL 编码后的 `\uXXXX` 转义。上游私信的 sender_nick 直接拼它，不解码。 */
  get rawNick(): string {
    return this.cookie('_nk_') ?? this.cookie('tracknick') ?? ''
  }

  /** 当前账号的昵称（解码后的 `_nk_`）。 */
  get nick(): string {
    return decodeNick(this.rawNick)
  }

  /** 设备号：上游每次启动随机生成；这里生成一次后存进凭证的 device，之后复用。 */
  get deviceId(): string {
    const device = this.ctx.credential.device
    if (typeof device.device_id !== 'string' || !device.device_id) device.device_id = generateDeviceId(this.myId)
    return device.device_id as string
  }

  me(): UserRef {
    return { id: this.myId, name: this.nick || null, url: null }
  }

  /** 私信、上传等需要登录的操作：cookie 里必须有 unb。 */
  requireLogin(): void {
    if (!this.myId) throw authError(this.ctx, '当前账号的 cookie 里没有 unb，请重新登录')
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    return this.http.request({ ...req, cookies: this.cookies() })
  }

  async text(req: HttpRequest): Promise<string> {
    return (await this.request(req)).text()
  }
}

export function decodeNick(raw: string): string {
  return unquote(raw).replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

/** mtop 的 ret（如 `FAIL_SYS_SESSION_EXPIRED::Session过期`）映射成 catbus 的错误（AGENTS 6.4）。 */
function mtopError(ctx: HandlerContext, body: { ret?: unknown[] } | null | undefined): CatbusError {
  const ret = String(body?.ret?.[0] ?? '')
  if (/SESSION_EXPIRED|FAIL_SYS_SESSION|NOT_LOGIN|ERR_SID_INVALID/i.test(ret)) return authError(ctx, `淘宝登录态无效：${ret}`)
  if (/FAIL_SYS_USER_VALIDATE/.test(ret)) {
    return new CatbusError('RISK_CONTROL', `淘宝要求人机验证：${ret}`, { detail: { kind: 'captcha', ret: body?.ret } })
  }
  if (/RGV587|FAIL_SYS_TRAFFIC_LIMIT|FAIL_SYS_ILLEGAL_ACCESS/.test(ret)) {
    return new CatbusError('RISK_CONTROL', `淘宝风控拦截：${ret}`, { detail: { kind: 'blocked', ret: body?.ret } })
  }
  return new CatbusError('UPSTREAM', ret ? `淘宝返回错误：${ret}` : '淘宝返回了无法识别的结果', { detail: { ret: body?.ret ?? null } })
}

/** 私信长连的 accessToken（上游 init 里 get_token 的用法）。 */
export async function accessToken(tb: Taobao): Promise<string> {
  const body = await api.getToken(tb)
  const token = body?.data?.result?.accessToken
  if (typeof token === 'string' && token) return token
  throw mtopError(tb.ctx, body)
}

/** 建立会话。 */
export function taobao(ctx: HandlerContext): Taobao {
  return new Taobao(ctx)
}
