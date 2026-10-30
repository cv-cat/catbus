import type { CookieJar } from '../../../core/cookies.js'
import { CatbusError } from '../../../core/errors.js'
import { sha1Hex } from '../../../core/hash.js'
import { type HeaderPairs, HttpClient, type HttpResponse, jsonpOf, parseJson, parseJsonp } from '../../../core/http.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { authError, httpClient, isGuest, jarOf } from '../../../core/toolkit.js'

const ORIGIN = 'https://www.youtube.com'
export const STUDIO_ORIGIN = 'https://studio.youtube.com'
const BROWSER = 'chrome_149' as const
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
/** 页面语言固定为英文：计数（`1.2M views`）和相对时间（`3 days ago`）按英文解析。 */
const HL = 'en'
const GL = 'US'
const ACCEPT_LANGUAGE = `${HL}-${GL},${HL};q=0.9`
/** 首页 ytcfg 的缓存时长。clientVersion 每天都会更新，旧版本仍可用一段时间。 */
const CONFIG_TTL_MS = 12 * 3600 * 1000

/** 发请求要用的页面配置，缓存在凭证的 device.ytcfg 里，随凭证由 core 落盘。 */
interface YtConfig {
  clientVersion: string
  visitorData: string
  fetchedAt: number
}

/**
 * 取媒体地址用的 VISIONOS（Vision Pro 上的 YouTube）客户端，与 yt-dlp 使用的一致。
 * 实测（2026-10-29）：它给的直链不带 PO token 也能完整下载；ANDROID_VR 的地址只给前约 1 分钟，之后回 403。
 */
const MEDIA_CLIENT = {
  clientName: 'VISIONOS',
  clientVersion: '1.02',
  deviceMake: 'Apple',
  deviceModel: 'RealityDevice17,1',
  osName: 'visionOS',
  osVersion: '26.5.23O471',
}
const MEDIA_CLIENT_ID = '101'
export const MEDIA_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

/** 会改动账号数据的 InnerTube 接口：网络出错时不自动重试。 */
const WRITE_PATH = /^(like|subscription|comment|browse\/edit_playlist|live_chat\/send|playlist|upload|channel\/create)/

/** 登录签名用的 cookie：SAPISIDHASH 与两个分区的变体，有哪个就带哪个。 */
const SID_SCHEMES: [string, string][] = [
  ['SAPISIDHASH', 'SAPISID'],
  ['SAPISID1PHASH', '__Secure-1PAPISID'],
  ['SAPISID3PHASH', '__Secure-3PAPISID'],
]

export class YtClient {
  readonly http: HttpClient
  /** 游客请求（取媒体地址）用：没有 cookie 罐，响应的 Set-Cookie 不会写回当前账号。 */
  readonly bare: HttpClient
  readonly jar: CookieJar
  /** 同一命令里并发的请求（item get 的 player + next）共用一次首页请求。 */
  private configP?: Promise<YtConfig>

  constructor(readonly ctx: HandlerContext) {
    this.http = httpClient(ctx, { browser: BROWSER, os: 'windows' })
    this.bare = new HttpClient({ browser: BROWSER, os: 'windows', proxy: ctx.config.proxy, timeout: ctx.config.timeout, log: ctx.log })
    this.jar = jarOf(ctx.credential)
  }

  /** 凭证里有 SAPISID 一类 cookie 才算登录：游客的 guest.json 只有 VISITOR_INFO1_LIVE 等设备 cookie。 */
  get loggedIn(): boolean {
    return !isGuest(this.ctx) && SID_SCHEMES.some(([, name]) => this.jar.get(name))
  }

  readonly ua = UA

  /** 取 HTML 页面（首页、Studio 首页）用的请求头。 */
  pageHeaders(): HeaderPairs {
    return [
      ['User-Agent', UA],
      ['Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
      ['Accept-Language', ACCEPT_LANGUAGE],
    ]
  }

  /** `Authorization: SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")> …`，与 web 端页面脚本一致；Studio 的 origin 不同。 */
  authorization(origin = ORIGIN): string | null {
    const ts = String(rand.nowSeconds())
    const parts = SID_SCHEMES.flatMap(([scheme, name]) => {
      const sid = this.jar.get(name)
      return sid ? [`${scheme} ${ts}_${sha1Hex(`${ts} ${sid} ${origin}`)}`] : []
    })
    return parts.length ? parts.join(' ') : null
  }

  /** 页面配置：缓存过期或没有时，取一次首页。 */
  config(): Promise<YtConfig> {
    return (this.configP ??= this.loadConfig().catch((err) => {
      this.configP = undefined
      throw err
    }))
  }

  private async loadConfig(): Promise<YtConfig> {
    const cached = this.ctx.credential.device.ytcfg as YtConfig | undefined
    if (cached?.clientVersion && cached.visitorData && rand.now() - cached.fetchedAt < CONFIG_TTL_MS) return cached
    const res = await this.http.request({
      url: `${ORIGIN}/`,
      query: { hl: HL, gl: GL },
      headers: this.pageHeaders(),
    })
    await this.check(res, '/')
    const html = await res.text()
    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1]
    const visitorData = html.match(/"VISITOR_DATA":"([^"]+)"/)?.[1]
    if (!clientVersion || !visitorData) {
      if (/consent\.(youtube|google)\.com/.test(html)) {
        throw new CatbusError('RISK_CONTROL', 'YouTube 要求先同意 cookie 政策', {
          hint: '换一个代理出口（美国等无需同意弹窗的地区），或用 cookie 登录',
          detail: { kind: 'blocked' },
        })
      }
      throw new CatbusError('UPSTREAM', 'YouTube 首页里没有找到 ytcfg', { hint: '页面结构可能已变更' })
    }
    const cfg: YtConfig = { clientVersion, visitorData, fetchedAt: rand.now() }
    this.ctx.credential.device.ytcfg = cfg
    return cfg
  }

  /** InnerTube 请求：`POST /youtubei/v1/<path>`，请求体带 WEB 客户端的 context；登录后带 SAPISIDHASH 签名。 */
  async innertube<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
    const cfg = await this.config()
    const auth = this.loggedIn ? this.authorization() : null
    const headers: HeaderPairs = [
      ['User-Agent', UA],
      ['Accept', '*/*'],
      ['Accept-Language', ACCEPT_LANGUAGE],
      ['Content-Type', 'application/json'],
      ['X-Goog-Visitor-Id', cfg.visitorData],
      ['X-Youtube-Client-Name', '1'],
      ['X-Youtube-Client-Version', cfg.clientVersion],
      ['Origin', ORIGIN],
      ['Referer', `${ORIGIN}/`],
    ]
    if (auth) headers.push(['Authorization', auth], ['X-Goog-AuthUser', '0'], ['X-Origin', ORIGIN])
    const client = { clientName: 'WEB', clientVersion: cfg.clientVersion, hl: HL, gl: GL, visitorData: cfg.visitorData }
    const res = await this.post<T>(path, headers, { context: { client }, ...body })
    // cookie 失效时（常见原因是浏览器开着同一个会话、Google 轮换了 cookie），需要登录的页面照样回 200，只是内容为空；
    // 响应的 responseContext 里有 logged_in=0，据此报登录失效，不返回空列表
    if (auth && loggedInFlag(res) === '0') throw authError(this.ctx, 'YouTube 登录态已失效（cookie 可能已被浏览器轮换），请重新导出 cookie 登录')
    return res
  }

  /**
   * 取媒体地址用的 player 请求：WEB 客户端只给 SABR 流或要签名解算的地址，VISIONOS 客户端直接给可下载的地址。
   * 这个客户端不支持 cookie，一律以游客身份请求；同一出口 IP 请求过多时会被要求「Sign in to confirm you're not a bot」。
   */
  async mediaPlayer<T = any>(videoId: string): Promise<T> {
    const cfg = await this.config()
    const headers: HeaderPairs = [
      ['User-Agent', MEDIA_UA],
      ['Content-Type', 'application/json'],
      ['X-Goog-Visitor-Id', cfg.visitorData],
      ['X-Youtube-Client-Name', MEDIA_CLIENT_ID],
      ['X-Youtube-Client-Version', MEDIA_CLIENT.clientVersion],
    ]
    const client = { ...MEDIA_CLIENT, hl: HL, gl: GL, visitorData: cfg.visitorData }
    return this.post('player', headers, { context: { client }, ...playerBody(videoId) }, this.bare)
  }

  private async post<T>(path: string, headers: HeaderPairs, json: unknown, http = this.http): Promise<T> {
    const req = { method: 'POST', url: `${ORIGIN}/youtubei/v1/${path}`, query: { prettyPrint: 'false' }, headers, json }
    // 经代理时偶发连接被重置：读取类请求重试一次；写操作不重试，避免重复提交
    const send = () => http.request(req)
    const res = await (WRITE_PATH.test(path) ? send() : retryNetwork(this.ctx, send))
    await this.check(res, path)
    return parseJson<T>(res)
  }

  /** 搜索联想词在单独的域名上，返回 JSONP：`window.google.ac.h([...])`。 */
  async suggest(prefix: string): Promise<any[]> {
    const res = await this.http.request({
      url: 'https://suggestqueries-clients6.youtube.com/complete/search',
      query: { client: 'youtube', ds: 'yt', q: prefix, hl: HL, gl: GL.toLowerCase() },
      headers: [
        ['User-Agent', UA],
        ['Accept', '*/*'],
        ['Referer', `${ORIGIN}/`],
      ],
    })
    await this.check(res, 'suggest')
    return jsonpOf<any[]>(res)
  }

  /** HTTP 状态码 → 错误码。InnerTube 的业务错误也走 HTTP 状态码，消息在 `error.message`。 */
  async check(res: HttpResponse, path: string): Promise<void> {
    if (res.ok) return
    const message: string | undefined = parseJsonp(await res.clone().text().catch(() => ''))?.error?.message
    const detail = { status: res.status, path, ...(message ? { message } : {}) }
    // 403 也用于普通业务失败（「Sorry, something went wrong」），只有 401 或明说要登录时才当作登录态问题
    if (res.status === 401 || (res.status === 403 && /sign in|log in|authenticat|credential/i.test(message ?? ''))) {
      throw authError(this.ctx, message ? `YouTube：${message}` : undefined)
    }
    if (res.status === 429 || (res.status === 403 && !this.loggedIn)) {
      throw new CatbusError('RISK_CONTROL', `YouTube 拒绝了请求（HTTP ${res.status}）`, {
        hint: '降低请求频率，或换一个代理出口',
        detail: { kind: res.status === 429 ? 'rate_limit' : 'blocked', ...detail },
      })
    }
    throw new CatbusError('UPSTREAM', `YouTube 返回 HTTP ${res.status}${message ? `：${message}` : ''}`, { detail })
  }
}

/** 网络出错（经代理时偶发连接被重置）时等 1 秒再试一次。只用于重发不会改动账号数据的请求。 */
export function retryNetwork<T>(ctx: HandlerContext, send: () => Promise<T>): Promise<T> {
  return send().catch(async (err) => {
    if (!(err instanceof CatbusError && err.code === 'NETWORK')) throw err
    ctx.log.warn(`网络出错，重试一次：${err.message}`)
    await rand.sleep(1000)
    return send()
  })
}

/** responseContext.serviceTrackingParams 里的 logged_in（"0" / "1"），没有时为 null。 */
function loggedInFlag(res: any): string | null {
  for (const t of res?.responseContext?.serviceTrackingParams ?? []) {
    for (const p of t.params ?? []) if (p.key === 'logged_in') return String(p.value)
  }
  return null
}

/** player 请求体里除 context 以外的部分：WEB 与 VISIONOS 相同。 */
export function playerBody(videoId: string) {
  return { videoId, contentCheckOk: true, racyCheckOk: true }
}

/** 每个命令一个会话。 */
export function yt(ctx: HandlerContext): YtClient {
  return new YtClient(ctx)
}
