import {
  type BodyInit,
  type BrowserAlias,
  type BrowserProfile,
  createTransport,
  type EmulationOS,
  fetch as wreqFetch,
  RequestError,
  type Transport,
} from 'wreq-js'
import type { CookieJar } from './cookies.js'
import { CatbusError } from './errors.js'
import type { Logger } from './log.js'
import { jsonDumps, type PairsInit, parseQsl, pyStr, requoteUri, toPairs, urlencode } from './py.js'

// wreq-js 默认读 HTTP(S)_PROXY 和系统代理。代理只能显式配置（AGENTS 5.5），这里全部关掉，
// 只通过 transport 的 proxy 传入。cli/main.ts 在加载任何模块前也会设置一次。
disableEnvProxy()

export function disableEnvProxy(): void {
  process.env.NO_PROXY = process.env.no_proxy = '*,0.0.0.0/0,::/0'
}

export type HeaderPairs = [string, string][]
export type HeaderInit = HeaderPairs | Record<string, string | null | undefined>

export interface MultipartPart {
  name: string
  /** 字符串或字节。 */
  data: string | Uint8Array
  filename?: string
  contentType?: string
}

export interface HttpRequest {
  method?: string
  url: string
  /** 追加到 URL 上的 query，编码方式与 curl_cffi / requests 的 `params=` 相同。 */
  query?: PairsInit
  /** 按顺序发送的请求头。值为 null / undefined 的项跳过。 */
  headers?: HeaderInit
  /** application/x-www-form-urlencoded 表单，编码方式与 Python 的 `urlencode` 相同。 */
  form?: PairsInit
  /** JSON 请求体，序列化方式与 curl_cffi 的 `json=` 相同（紧凑、非 ASCII 转义）。 */
  json?: unknown
  body?: string | Uint8Array
  multipart?: MultipartPart[]
  /** 默认从 cookie 罐取；传对象则只发这些；false 不发 cookie。 */
  cookies?: Record<string, string> | false
  redirect?: 'follow' | 'manual'
  /** 秒，默认用客户端的超时。 */
  timeout?: number
}

/** 实际要发出的请求。对拍测试比较的就是它。 */
export interface PreparedRequest {
  method: string
  url: string
  /** 显式请求头，不含 cookie。 */
  headers: HeaderPairs
  cookies: [string, string][]
  body: string | Uint8Array | null
  multipart: MultipartPart[] | null
}

export interface HttpResponse {
  readonly status: number
  readonly ok: boolean
  readonly url: string
  readonly headers: { get(name: string): string | null; getSetCookie(): string[] }
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
  clone(): HttpResponse
  readonly body?: ReadableStream<Uint8Array> | null
}

export interface ClientOptions {
  browser?: BrowserProfile | BrowserAlias
  os?: EmulationOS
  proxy?: string | null
  /** 秒。 */
  timeout?: number
  jar?: CookieJar
  /** 发送前重排 cookie 名字的顺序。 */
  cookieOrder?: string[]
  /** 默认 true：只发显式给出的请求头，顺序完全由调用方决定。 */
  disableDefaultHeaders?: boolean
  log?: Logger
}

type Sender = (prepared: PreparedRequest, options: SendOptions) => Promise<HttpResponse>

interface SendOptions {
  browser: BrowserProfile | BrowserAlias
  os: EmulationOS
  proxy: string | null
  timeout: number
  redirect: 'follow' | 'manual'
  disableDefaultHeaders: boolean
}

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

const transports = new Map<string, Promise<Transport>>()

async function transportFor(options: SendOptions): Promise<Transport> {
  const key = `${options.browser}|${options.os}|${options.proxy ?? ''}`
  let t = transports.get(key)
  if (!t) {
    t = createTransport({ browser: options.browser, os: options.os, ...(options.proxy ? { proxy: options.proxy } : {}) })
    transports.set(key, t)
  }
  return t
}

const wreqSender: Sender = async (p, o) => {
  const headers: HeaderPairs = [...p.headers]
  if (p.cookies.length) insertCookieHeader(headers, p.cookies.map(([k, v]) => `${k}=${v}`).join('; '))
  let body: BodyInit | undefined
  if (p.multipart) {
    const form = new FormData()
    for (const part of p.multipart) {
      if (part.filename != null || typeof part.data !== 'string') {
        const data = typeof part.data === 'string' ? Buffer.from(part.data) : new Uint8Array(part.data)
        form.append(part.name, new Blob([data], { type: part.contentType ?? 'application/octet-stream' }), part.filename ?? part.name)
      } else form.append(part.name, part.data)
    }
    body = form
  } else if (p.body != null) body = p.body as BodyInit
  return wreqFetch(p.url, {
    method: p.method,
    headers,
    body,
    transport: await transportFor(o),
    timeout: o.timeout * 1000,
    redirect: o.redirect,
    disableDefaultHeaders: o.disableDefaultHeaders,
  }) as unknown as HttpResponse
}

let sender: Sender = wreqSender

/** 替换真正发请求的函数，返回恢复函数。只给测试用。 */
export function mockSender(fn: (prepared: PreparedRequest) => Promise<HttpResponse> | HttpResponse): () => void {
  const prev = sender
  sender = async (p) => fn(p)
  return () => {
    sender = prev
  }
}

/** 关闭所有连接池，让进程可以退出。 */
export async function closeTransports(): Promise<void> {
  const all = [...transports.values()]
  transports.clear()
  await Promise.allSettled(all.map(async (t) => (await t).close()))
}

/** cookie 头放在 priority 之前（Chrome 的位置），没有 priority 时放最后。 */
function insertCookieHeader(headers: HeaderPairs, value: string): void {
  const i = headers.findIndex(([k]) => k.toLowerCase() === 'priority')
  headers.splice(i < 0 ? headers.length : i, 0, ['cookie', value])
}

function headerPairs(init: HeaderInit | undefined): HeaderPairs {
  if (!init) return []
  const pairs = Array.isArray(init) ? init : Object.entries(init)
  return pairs.filter((p): p is [string, string] => p[1] != null)
}

function hasHeader(headers: HeaderPairs, name: string): boolean {
  const n = name.toLowerCase()
  return headers.some(([k]) => k.toLowerCase() === n)
}

/**
 * curl_cffi 的 `update_url_params`：已有同名参数且新旧都只出现一次时就地替换，否则追加；
 * 布尔值写成 true / false；最后整体 `urlencode` 再 `requote_uri`。
 */
export function buildUrl(url: string, query?: PairsInit): string {
  const pairs = toPairs(query)
  if (!pairs.length) return requoteUri(url)
  const hashAt = url.indexOf('#')
  const fragment = hashAt < 0 ? '' : url.slice(hashAt)
  const base = hashAt < 0 ? url : url.slice(0, hashAt)
  const qAt = base.indexOf('?')
  const path = qAt < 0 ? base : base.slice(0, qAt)
  let args: [string, string][] = qAt < 0 ? [] : parseQsl(base.slice(qAt + 1))
  const count = (list: [string, unknown][], key: string) => list.filter(([k]) => k === key).length
  for (const [key, raw] of pairs) {
    const value = typeof raw === 'boolean' ? String(raw) : pyStr(raw)
    if (count(args, key) === 1 && count(pairs, key) === 1) args = args.map((a) => (a[0] === key ? [key, value] : a))
    else args.push([key, value])
  }
  const query2 = urlencode(args)
  return requoteUri(`${path}${query2 ? '?' + query2 : ''}${fragment}`)
}

export class HttpClient {
  readonly jar: CookieJar | null
  private readonly options: ClientOptions

  constructor(options: ClientOptions = {}) {
    this.options = options
    this.jar = options.jar ?? null
  }

  /** 组装请求（不发送）。 */
  prepare(req: HttpRequest): PreparedRequest {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = buildUrl(req.url, req.query)
    const headers = headerPairs(req.headers)
    let body: string | Uint8Array | null = null
    if (req.json !== undefined) {
      body = jsonDumps(req.json, { separators: [',', ':'] })
      if (!hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/json'])
    } else if (req.form !== undefined) {
      body = urlencode(req.form)
      if (method !== 'POST' && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    } else if (req.body !== undefined) {
      body = req.body
      if (body.length && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', 'application/octet-stream'])
    }

    // 显式给出的 cookie 头原样保留；否则从 cookie 罐取
    let cookies: [string, string][] = []
    const explicit = headers.findIndex(([k]) => k.toLowerCase() === 'cookie')
    if (explicit >= 0) {
      cookies = headers
        .filter(([k]) => k.toLowerCase() === 'cookie')
        .flatMap(([, v]) => v.split(';'))
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const i = c.indexOf('=')
          return [c.slice(0, i), c.slice(i + 1)] as [string, string]
        })
      for (let i = headers.length - 1; i >= 0; i--) if (headers[i]![0].toLowerCase() === 'cookie') headers.splice(i, 1)
    } else if (req.cookies !== false) {
      if (req.cookies) cookies = Object.entries(req.cookies)
      else if (this.jar) {
        const list = this.jar.forUrl(url)
        const order = this.options.cookieOrder
        if (order) {
          const index = new Map(order.map((n, i) => [n, i]))
          list.sort((a, b) => (index.get(a.name) ?? order.length) - (index.get(b.name) ?? order.length))
        }
        const seen = new Set<string>()
        for (const c of list) if (!seen.has(c.name)) (seen.add(c.name), cookies.push([c.name, c.value]))
      }
    }
    return { method, url, headers, cookies, body, multipart: req.multipart ?? null }
  }

  /**
   * 发送请求。Set-Cookie 自动写回 cookie 罐；网络错误映射成 NETWORK。
   * 跳转由这里逐跳跟随（最多 10 跳），这样中间跳转设置的 cookie 也会收进 cookie 罐，
   * 后续跳转按 cookie 罐重新取 cookie。
   */
  async request(req: HttpRequest): Promise<HttpResponse> {
    const follow = (req.redirect ?? 'follow') === 'follow'
    let current = req
    for (let hop = 0; ; hop++) {
      const { res, url } = await this.send(current)
      const location = res.headers.get('location')
      if (!follow || !location || !REDIRECT_STATUS.has(res.status) || hop >= 10) return res
      const method = (current.method ?? 'GET').toUpperCase()
      const toGet = res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')
      current = { ...current, url: new URL(location, url).toString(), query: undefined }
      if (toGet) {
        const { form: _f, json: _j, body: _b, multipart: _m, ...rest } = current
        current = { ...rest, method: 'GET', headers: headerPairs(rest.headers).filter(([k]) => k.toLowerCase() !== 'content-type') }
      }
    }
  }

  private async send(req: HttpRequest): Promise<{ res: HttpResponse; url: string }> {
    const prepared = this.prepare(req)
    const o = this.options
    const sendOptions: SendOptions = {
      browser: o.browser ?? 'chrome',
      os: o.os ?? 'windows',
      proxy: o.proxy ?? null,
      timeout: req.timeout ?? o.timeout ?? 30,
      redirect: 'manual',
      disableDefaultHeaders: o.disableDefaultHeaders ?? true,
    }
    // 表单 POST：libcurl 会自己补 content-type，wreq 不会
    if (req.form !== undefined && prepared.method === 'POST' && !hasHeader(prepared.headers, 'content-type')) {
      prepared.headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
    }
    o.log?.debug(`${prepared.method} ${prepared.url}`)
    let res: HttpResponse
    try {
      res = await sender(prepared, sendOptions)
    } catch (err) {
      throw toNetworkError(err)
    }
    this.jar?.applySetCookie(prepared.url, res.headers.getSetCookie())
    o.log?.debug(`${res.status} ${prepared.url}`)
    return { res, url: prepared.url }
  }

  async text(req: HttpRequest): Promise<string> {
    return (await this.request(req)).text()
  }

  /** 请求并解析 JSON；不是 JSON 时报 UPSTREAM（HTTP 状态码放在 detail 里）。 */
  async json<T = any>(req: HttpRequest): Promise<T> {
    const res = await this.request(req)
    return parseJson<T>(res)
  }

  async bytes(req: HttpRequest): Promise<Uint8Array> {
    const res = await this.request(req)
    return new Uint8Array(await res.arrayBuffer())
  }
}

export async function parseJson<T>(res: HttpResponse): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new CatbusError('UPSTREAM', `平台返回的不是 JSON（HTTP ${res.status}）`, {
      detail: { status: res.status, body: text.slice(0, 300) },
    })
  }
}

/** wreq-js 的错误映射成 NETWORK，`detail.kind` 区分超时、代理、连接、DNS、TLS、中止。 */
export function toNetworkError(err: unknown): CatbusError {
  if (err instanceof CatbusError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (!(err instanceof RequestError) && !(err instanceof Error && err.name === 'AbortError')) {
    return new CatbusError('ERROR', message, { cause: err })
  }
  const kind = /timed? ?out/i.test(message)
    ? 'timeout'
    : /proxy|tunnel|socks/i.test(message)
      ? 'proxy'
      : /certificate|tls|ssl/i.test(message)
        ? 'tls'
        : /abort/i.test(message)
          ? 'abort'
          : /dns|resolve|lookup|name or service/i.test(message)
            ? 'dns'
            : 'connect'
  return new CatbusError('NETWORK', `网络错误：${message}`, {
    hint: kind === 'proxy' ? '检查代理：catbus config get proxy' : null,
    detail: { kind },
    cause: err,
  })
}

/** 测试用：构造一个响应。 */
export function fakeResponse(body: string | Uint8Array | object, init: { status?: number; headers?: HeaderPairs; url?: string } = {}): HttpResponse {
  const text = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
  const headers = new globalThis.Headers(init.headers ?? [])
  const res = new globalThis.Response(text as ConstructorParameters<typeof globalThis.Response>[0], { status: init.status ?? 200, headers })
  Object.defineProperty(res, 'url', { value: init.url ?? '' })
  return res as unknown as HttpResponse
}
