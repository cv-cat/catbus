import { arch, platform, release } from 'node:os'
import { CatbusError } from '../../../core/errors.js'
import { type HeaderPairs, HttpClient, type HttpResponse } from '../../../core/http.js'
import { jsonDumps, jsonLoads, type PairsInit, toPairs } from '../../../core/py.js'
import { now, uuid4 } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, scope } from '../../../core/toolkit.js'

export const ORIGIN = 'https://discord.com'
const API = `${ORIGIN}/api/v9`
export const BROWSER = 'chrome_146'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.419 Chrome/148.0.7778.280 Electron/42.11.15 Safari/537.36'
export type Json = Record<string, unknown>

export function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
}

export function records(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new CatbusError('UPSTREAM', 'Discord 返回的列表格式不符')
  return value.map(object)
}

export function snowflake(value: unknown, label = 'ID'): string {
  const text = typeof value === 'string' || typeof value === 'bigint' ? String(value) : ''
  if (!/^\d{1,20}$/.test(text) || BigInt(text) === 0n || BigInt(text) >= 1n << 64n) {
    throw new CatbusError('USAGE', `${label} 必须是 Discord 数字 ID`)
  }
  return text
}

export interface Identity {
  os: string
  arch: string
  release: string
  locale: string
  timezone: string
  launchId: string
}

export function identity(): Identity {
  const names: Record<string, string> = { darwin: 'Mac OS X', linux: 'Linux', win32: 'Windows' }
  const os = names[platform()] ?? platform()
  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  const timezone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(now()).find((part) => part.type === 'timeZoneName')?.value ?? 'UTC'
  return { os, arch: arch(), release: release(), locale, timezone, launchId: uuid4().replaceAll('-', '') }
}

/** 顺序和字段来自 discord-cli 的 fidelity.py。 */
export function properties(i: Identity): Json {
  return {
    os: i.os, browser: 'Discord Client', release_channel: 'stable', client_version: '0.0.419',
    os_version: i.release, os_arch: i.arch, app_arch: i.arch, system_locale: i.locale, has_client_mods: false,
    client_launch_id: i.launchId, browser_user_agent: USER_AGENT, browser_version: '42.11.15',
    os_sdk_version: i.release.split('.')[0], client_build_number: 649389, client_event_source: null,
  }
}

export function commonHeaders(i: Identity, fingerprint?: string, installation?: string): HeaderPairs {
  const headers: HeaderPairs = [
    ['sec-ch-ua-platform', '"macOS"'], ['x-debug-options', 'bugReporterEnabled'], ['accept-language', i.locale],
    ['sec-ch-ua', '"Not(A:Brand";v="8", "Chromium";v="148"'], ['sec-ch-ua-mobile', '?0'],
    ['x-discord-timezone', i.timezone], ['x-super-properties', Buffer.from(jsonDumps(properties(i), { separators: [',', ':'] })).toString('base64')],
    ['x-discord-locale', i.locale], ['user-agent', USER_AGENT], ['accept', '*/*'], ['origin', ORIGIN],
    ['sec-fetch-site', 'same-origin'], ['sec-fetch-mode', 'cors'], ['sec-fetch-dest', 'empty'],
    ['referer', `${ORIGIN}/login`], ['accept-encoding', 'gzip, deflate, br, zstd'], ['priority', 'u=1, i'],
  ]
  if (fingerprint) headers.push(['x-fingerprint', fingerprint])
  if (installation) headers.push(['x-installation-id', installation])
  return headers
}

export function credentialToken(ctx: HandlerContext): string | undefined {
  const value = ctx.credential.scopes.main?.tokens.authorization
  return typeof value === 'string' ? value : undefined
}

export function installationId(ctx: HandlerContext): string | undefined {
  const value = ctx.credential.device.discord_installation_id
  return typeof value === 'string' && value ? value : undefined
}

export function requireToken(ctx: HandlerContext): string {
  const token = credentialToken(ctx)
  if (!token) throw authError(ctx)
  return token
}

export class DiscordResponseError extends CatbusError {
  constructor(status: number, body: Json) {
    super('UPSTREAM', `Discord 请求失败（HTTP ${status}）`, {
      detail: { status, ...(typeof body.code === 'number' ? { code: body.code } : {}) },
    })
  }
}

class CaptchaRequired extends CatbusError {
  constructor(status: number, readonly challenge: Json, canSolve: boolean) {
    super('RISK_CONTROL', 'Discord 要求人工验证码', {
      detail: { kind: 'captcha', status },
      hint: canSolve ? '在交互式终端重试，或加 --captcha 后在浏览器中完成验证' : '在 Discord 中完成验证后重试',
    })
  }
}

interface RequestOptions {
  json?: unknown
  query?: PairsInit
  auth?: boolean
  context?: Json
  login?: boolean
  captcha?: boolean
}

export class DiscordClient {
  private readonly http: HttpClient
  private fingerprint?: string
  private installation?: string
  private nonceTime = -1
  private nonceSequence = 0

  readonly identity: Identity

  constructor(private readonly ctx: HandlerContext, id: Identity = identity()) {
    this.identity = id
    this.installation = installationId(ctx)
    this.http = httpClient(ctx, { browser: BROWSER, os: 'macos' })
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new CatbusError('USAGE', 'Discord API 路径无效')
    let captchaHeaders: HeaderPairs = []
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, options, captchaHeaders)
      } catch (error) {
        if (!(error instanceof CaptchaRequired) || !options.captcha || (!process.stderr.isTTY && !this.ctx.options.captcha)) throw error
        if (attempt >= 2) throw new CatbusError('RISK_CONTROL', 'Discord 未接受两次人工验证码提交', { detail: { kind: 'captcha' } })
        const { solveCaptcha } = await import('./captcha.js')
        captchaHeaders = await solveCaptcha(this.ctx, error.challenge)
      }
    }
  }

  private async requestOnce<T>(method: string, path: string, options: RequestOptions, captchaHeaders: HeaderPairs): Promise<T> {
    const headers = commonHeaders(this.identity, this.fingerprint, this.installation)
    if (options.auth !== false) headers.push(['Authorization', requireToken(this.ctx)])
    if (options.context) {
      const data = jsonDumps(options.context, { separators: [',', ':'] })
      headers.push(['X-Context-Properties', Buffer.from(data).toString('base64')])
    }
    headers.push(...captchaHeaders)
    if (options.json !== undefined) headers.push(['content-type', 'application/json'])
    const response = await this.http.request({ method, url: `${API}${path}`, headers, query: toPairs(options.query).filter(([, value]) => value != null), json: options.json, redirect: 'manual' })
    if (response.status === 204 || response.status === 205) return null as T
    if (response.status === 429) {
      throw new CatbusError('RISK_CONTROL', 'Discord 限制了请求频率', { detail: { kind: 'rate_limit', status: 429 } })
    }
    if (response.status === 401 && options.auth !== false) throw authError(this.ctx)
    let data: unknown
    try {
      const text = await response.text()
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new CatbusError('UPSTREAM', 'Discord 响应超过 16 MiB')
      data = text.trim() === '' ? null : jsonLoads(text)
    } catch (error) {
      if (error instanceof CatbusError) throw error
      throw new DiscordResponseError(response.status, {})
    }
    const body = object(data)
    if (body.captcha_key && (!Array.isArray(body.captcha_key) || body.captcha_key.length)) throw new CaptchaRequired(response.status, body, options.captcha === true)
    if (!response.ok && !(options.login && response.status === 400)) throw new DiscordResponseError(response.status, body)
    return data as T
  }

  async initialize(): Promise<void> {
    const data = object(await this.request('GET', '/experiments', { auth: false, query: { with_guild_experiments: 'true' } }))
    if (typeof data.fingerprint === 'string') this.fingerprint = data.fingerprint
    if (typeof data.installation === 'string') {
      this.installation = data.installation
      this.ctx.credential.device.discord_installation_id = data.installation
    }
  }

  clearFingerprint(): void {
    this.fingerprint = undefined
  }

  nonce(): string {
    const time = now()
    if (time !== this.nonceTime) {
      this.nonceTime = time
      this.nonceSequence = 0
    }
    if (this.nonceSequence > 4095) throw new CatbusError('ERROR', '同一毫秒的消息序号已用尽')
    return (((BigInt(time) - 1420070400000n) << 22n) + BigInt(this.nonceSequence++)).toString()
  }
}

/** CDN 请求独立于凭证和 cookie，签名 URL 不写入日志。 */
export async function cdnRequest(ctx: HandlerContext, method: 'GET' | 'PUT', input: string, body?: Uint8Array): Promise<HttpResponse> {
  let url: URL
  try {
    url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
  } catch {
    throw new CatbusError('USAGE', '附件地址必须是无内嵌凭证的 HTTPS URL')
  }
  const client = new HttpClient({ browser: BROWSER, os: 'macos', proxy: ctx.config.proxy, timeout: ctx.config.timeout })
  let res: HttpResponse
  try {
    res = await client.request({ method, url: input, headers: method === 'PUT'
      ? [['Content-Type', 'application/octet-stream'], ['Accept', '*/*'], ['User-Agent', 'discord-cli/0.1 Python-stdlib']]
      : [['User-Agent', 'discord-cli/0.1 Python-stdlib'], ['Accept', '*/*']], body, cookies: false, redirect: 'manual' })
  } catch {
    throw new CatbusError('NETWORK', 'Discord 附件传输失败')
  }
  if (!res.ok) throw new CatbusError('UPSTREAM', `Discord 附件请求失败（HTTP ${res.status}）`, { detail: { status: res.status } })
  return res
}

export function storeToken(ctx: HandlerContext, value: string): void {
  const token = value.trim()
  if (!/^(?:Bot )?[!-~]+$/.test(token)) throw new CatbusError('USAGE', 'Discord 凭证格式无效')
  scope(ctx.credential).tokens.authorization = token
}
