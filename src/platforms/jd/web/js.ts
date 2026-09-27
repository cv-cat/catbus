import { EventEmitter } from 'node:events'
import * as realFs from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { format } from 'node:util'
import vm from 'node:vm'
import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs, HttpClient } from '../../../core/http.js'
import type { Logger } from '../../../core/log.js'
import { staticFile } from '../../../core/paths.js'
import * as rand from '../../../core/rand.js'
import { createContext } from '../../../core/vm.js'
import { LOGIN_PAGE, PROFILE } from './profile.js'

/**
 * 上游签名 JS 的宿主（AGENTS 7.4）：h5st 5.3（static/h5st5_env.js + h5st5_lib.js）、
 * PC 设备参数（pc_tk_lib.js）、SummerCryptico。
 *
 * 上游把它们作为常驻 node 子进程跑（环境脚本改写整个进程的全局对象）；这里每个脚本一个 vm context，
 * 注入一份与 node 主 realm 相同的全局对象，环境脚本对 JSON / Function / Date 的改写只留在 context 里。
 * 脚本里的 `require('https')` 换成走 core/http（wreq-js）的实现，`require('fs')` 里 token 缓存换成凭证里的一段，
 * `require('jsdom')` 补上 jsdom 30 去掉的 ResourceLoader。
 */

const hostRequire = createRequire(import.meta.url)
const STATIC = staticFile('jd', '')

/** node 主 realm 在 ECMAScript 内置对象之外的全局（Node 22）。环境脚本据此判断哪些 jsdom 属性需要提升到全局。 */
const NODE_GLOBALS = [
  'process', 'global', 'Buffer', 'clearImmediate', 'setImmediate', 'URL', 'URLSearchParams', 'DOMException',
  'AbortController', 'AbortSignal', 'Event', 'EventTarget', 'TextEncoder', 'TextDecoder', 'TransformStream',
  'TransformStreamDefaultController', 'WritableStream', 'WritableStreamDefaultController', 'WritableStreamDefaultWriter',
  'ReadableStream', 'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader', 'ReadableStreamBYOBRequest',
  'ReadableByteStreamController', 'ReadableStreamDefaultController', 'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
  'TextEncoderStream', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream', 'clearInterval', 'clearTimeout',
  'setInterval', 'setTimeout', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'BroadcastChannel', 'MessageChannel',
  'MessagePort', 'Blob', 'File', 'Performance', 'PerformanceEntry', 'PerformanceMark', 'PerformanceMeasure',
  'PerformanceObserver', 'PerformanceObserverEntryList', 'PerformanceResourceTiming', 'performance', 'fetch', 'FormData',
  'Headers', 'Request', 'Response', 'MessageEvent', 'WebSocket', 'Navigator', 'navigator', 'crypto', 'Crypto', 'CryptoKey',
  'SubtleCrypto', 'CustomEvent',
]

const sources = new Map<string, string>()
function source(file: string): string {
  let s = sources.get(file)
  if (s == null) sources.set(file, (s = realFs.readFileSync(join(STATIC, file), 'utf8')))
  return s
}

export interface JsHost {
  http: HttpClient
  log: Logger
}

// ---------------------------------------------------------------- 模块替身

/** jsdom 30 去掉了 ResourceLoader：它在 jsdom 25 里只用来设置 UA，这里换成 jsdom 30 的 resources 对象。 */
function jsdomModule(): unknown {
  const m = hostRequire('jsdom') as Record<string, unknown>
  if (m.ResourceLoader) return m
  return {
    ...m,
    ResourceLoader: function ResourceLoader(options?: { userAgent?: string }) {
      return { userAgent: options?.userAgent }
    },
  }
}

/** `https.request` 的替身：脚本里的 XHR 经它走 core/http，与业务请求同一套 TLS 指纹和代理。 */
function httpsModule(host: JsHost) {
  return {
    request(options: { method?: string; hostname: string; path: string; headers?: Record<string, string> }, callback: (res: EventEmitter) => void) {
      const req = new EventEmitter() as EventEmitter & { write(d: unknown): void; end(): void }
      const chunks: Buffer[] = []
      req.write = (d) => chunks.push(Buffer.from(d as string))
      req.end = () => {
        const body = Buffer.concat(chunks)
        const headers: HeaderPairs = Object.entries(options.headers ?? {}).map(([k, v]) => [k, String(v)])
        host.http
          .request({ method: options.method ?? 'GET', url: `https://${options.hostname}${options.path}`, headers, body: body.length ? body.toString('utf8') : undefined })
          .then(async (r) => {
            const text = await r.text()
            const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string | string[]> }
            res.statusCode = r.status
            res.headers = {}
            const set = r.headers.getSetCookie()
            ;(r as unknown as { headers: globalThis.Headers }).headers.forEach?.((v, k) => {
              if (k !== 'set-cookie') res.headers[k] = v
            })
            if (set.length) res.headers['set-cookie'] = set
            callback(res)
            res.emit('data', Buffer.from(text, 'utf8'))
            res.emit('end')
          })
          .catch((err: unknown) => {
            host.log.debug(`签名脚本的网络请求失败：${(err as Error).message}`)
            req.emit('error', err)
          })
      }
      return req
    },
  }
}

/** 只读真实文件；`virtual` 里的路径读写落在内存（token 缓存）。 */
function fsModule(virtual: Map<string, string>, onRename: (path: string, text: string) => void) {
  return {
    ...realFs,
    existsSync: (p: string) => virtual.has(p) || realFs.existsSync(p),
    readFileSync: (p: string | number, ...rest: unknown[]) => (typeof p === 'string' && virtual.has(p) ? virtual.get(p) : (realFs.readFileSync as any)(p, ...rest)),
    writeFileSync: (p: string, data: unknown) => {
      if (typeof p === 'string' && p.startsWith(VIRTUAL)) virtual.set(p, String(data))
      else throw new Error(`签名脚本不允许写文件：${p}`)
    },
    renameSync: (from: string, to: string) => {
      if (!virtual.has(from)) throw new Error(`签名脚本不允许改名文件：${from}`)
      const text = virtual.get(from)!
      virtual.delete(from)
      virtual.set(to, text)
      onRename(to, text)
    },
    appendFileSync: () => {},
  }
}

const VIRTUAL = '/catbus-virtual/jd/'

/** 有状态宿主的 context：主 realm 同款全局 + 伪造的 process.env、require。 */
function scriptContext(env: Record<string, string | undefined>, modules: Record<string, unknown>, log: Logger): vm.Context {
  const globals: Record<string, unknown> = {}
  for (const k of NODE_GLOBALS) if (k in globalThis) globals[k] = (globalThis as Record<string, unknown>)[k]
  const fakeProcess = new Proxy(process, { get: (t, k) => (k === 'env' ? env : Reflect.get(t, k)) })
  const quiet = (...a: unknown[]) => log.debug(`[jd.js] ${format(...a)}`.slice(0, 500))
  const context = createContext({
    ...globals,
    process: fakeProcess,
    console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet, trace: quiet },
    require: (name: string) => (name in modules ? modules[name] : hostRequire(name)),
    __dirname: STATIC.replace(/[\\/]$/, ''),
    module: { exports: {} },
    exports: {},
  })
  context.global = context
  return context
}

// ---------------------------------------------------------------- h5st 5.3（utils/h5st5.py + static/h5st5_server.js）

export interface TokenCache {
  profile: string
  values: Record<string, string>
}

export interface H5stResult {
  h5st?: string
  _stk?: string
  _ste?: number
  [key: string]: unknown
}

/** token 缓存：服务端签发的 tk03 token 有 24h 有效期，按画像版本存在凭证里复用。 */
export interface TokenStore {
  load(): TokenCache | null
  save(cache: TokenCache): void
}

const TK_CACHE = `${VIRTUAL}h5st_token_cache.json`

const isRealToken = (h5st: string) => {
  const segs = (h5st ?? '').split(';')
  return segs.length > 3 && segs[3]!.startsWith('tk03')
}

/**
 * h5st 签名器（上游常驻签名进程）。cookie 变化时重建 context；origin / referer 只影响向 cactus 换 token 的那一发，
 * 只在还没有 context 时更新（与上游 configure 一致）。
 */
export class H5st {
  private cookie = ''
  private origin = 'https://search.jd.com'
  private referer = 'https://search.jd.com/'
  private context: vm.Context | null = null

  constructor(
    private readonly host: JsHost,
    private readonly store: TokenStore,
  ) {}

  configure(cookie: string, origin?: string, referer?: string): void {
    const changed = cookie !== this.cookie
    this.cookie = cookie ?? ''
    if (origin && !this.context) this.origin = origin
    if (referer && !this.context) this.referer = referer
    if (changed) this.context = null
  }

  /** 丢弃 context，下次签名重新加载（上游 shutdown）。 */
  reset(): void {
    this.context = null
  }

  private ensure(): vm.Context {
    if (this.context) return this.context
    const virtual = new Map<string, string>()
    const cached = this.store.load()
    if (cached) virtual.set(TK_CACHE, JSON.stringify(cached))
    const env = {
      JD_COOKIE: this.cookie,
      JD_ORIGIN: this.origin,
      JD_REFERER: this.referer,
      JD_TK_PROFILE: PROFILE.profileId,
      JD_TK_CACHE: TK_CACHE,
    }
    const modules = {
      jsdom: jsdomModule(),
      https: httpsModule(this.host),
      fs: fsModule(virtual, (_p, text) => this.store.save(JSON.parse(text))),
    }
    const context = scriptContext(env, modules, this.host.log)
    vm.runInContext(source('h5st5_env.js'), context, { filename: join(STATIC, 'h5st5_env.js') })
    vm.runInContext(source('h5st5_lib.js'), context, { filename: 'h5st5_lib.js' })
    this.context = context
    return context
  }

  async signOnce(params: Record<string, unknown>, appId: string): Promise<H5stResult> {
    const context = this.ensure()
    const inner = vm.runInContext('JSON', context).parse(JSON.stringify(params))
    let result: H5stResult
    try {
      const ps = new context.window.ParamsSign({ appId: appId || 'f06cc' })
      result = await ps.sign(inner)
    } catch (err) {
      throw new CatbusError('ERROR', `h5st5 签名失败：${(err as Error)?.message ?? err}`)
    }
    context.__jdFlushTokenCache?.()
    return JSON.parse(JSON.stringify(result ?? {}))
  }

  /** 冷启动后第一次签名往往还没拿到服务端 token（tk03），短暂等待后重签。 */
  async sign(params: Record<string, unknown>, appId = 'f06cc', warmup = true): Promise<H5stResult> {
    let res = await this.signOnce(params, appId)
    if (warmup && !isRealToken(String(res.h5st ?? ''))) {
      for (const delay of [350, 600, 1000]) {
        await rand.sleep(delay)
        // 换 token 的 XHR 由库的定时器发起；上游在两次签名之间有一次进程间往返，这里让出一个定时器周期
        await new Promise((r) => setTimeout(r, 30))
        res = await this.signOnce(params, appId)
        if (isRealToken(String(res.h5st ?? ''))) break
      }
    }
    return res
  }
}

// ---------------------------------------------------------------- PC 设备参数（utils/device_token.py + static/pc_tk_server.js）

export const DEVICE_PROFILE = PROFILE.profileId
const IDENTITY_COOKIES = new Set(['3AB9D23F7A4B3C9B', '3AB9D23F7A4B3CSS', 'PCA9D23F7A4B3CSS', 'PCTSD23F7A4B3CSS'])

export interface DeviceFields {
  eid: string
  eid2: string
  fp: string
  giaD: string
}

/** 换设备票据时去掉旧票据（_without_old_identity）。 */
function withoutOldIdentity(cookie: string): string {
  return String(cookie ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !IDENTITY_COOKIES.has(s.split('=', 1)[0]!.trim()))
    .join('; ')
}

function validateDevice(result: Record<string, unknown>): DeviceFields {
  const f = Object.fromEntries(['eid', 'eid2', 'fp', 'giaD'].map((k) => [k, String(result?.[k] ?? '')])) as unknown as DeviceFields
  if (!/^[A-Za-z0-9._-]{32,256}$/.test(f.eid)) throw new CatbusError('ERROR', 'PC 设备参数 eid 格式异常')
  if (!(f.eid2.startsWith('jdd03') && f.eid2.endsWith('X') && f.eid2.length >= 64 && f.eid2.length <= 512)) {
    throw new CatbusError('ERROR', 'PC 设备参数 eid2/jsToken 格式异常')
  }
  if (!/^[A-Za-z0-9]{32}$/.test(f.fp)) throw new CatbusError('ERROR', 'PC 设备参数 fp 格式异常')
  if (f.giaD && !/^[A-Za-z0-9._-]{1,128}$/.test(f.giaD)) throw new CatbusError('ERROR', 'PC 设备参数 _gia_d 格式异常')
  return f
}

/** pc_tk_server.js 的 getDeviceFields。 */
const DEVICE_FIELDS_JS = `(() => {
  const jsToken = new Promise((resolve) => { window.getJsToken((value) => resolve(value || {}), 5000); });
  const eid = new Promise((resolve) => {
    window.getJdEid((value, fp, meta) => resolve({ eid: String(value || ""), fp: String(fp || ""), meta: meta || {} }), null, 100);
  });
  return Promise.all([jsToken, eid]).then(([tk, device]) => {
    const cookies = Object.create(null);
    for (const item of String(document.cookie || "").split(";")) {
      const pos = item.indexOf("=");
      if (pos > 0) cookies[item.slice(0, pos).trim()] = item.slice(pos + 1).trim();
    }
    return JSON.stringify({
      eid: device.eid || String(device.meta.eid || ""),
      eid2: String(tk.jsToken || ""),
      fp: String(tk.fp || device.fp || device.meta.fp || ""),
      giaD: String(cookies._gia_d || ""),
    });
  });
})()`

/**
 * jsdom 30 把 CSS 系统颜色（ActiveBorder 等）解析成 rgb()，上游用的 jsdom 25 原样返回小写关键字。
 * pc-tk.js 会采集这组颜色，这里让 getComputedStyle 对行内写了系统颜色的属性返回关键字，与上游一致。
 */
const SYSTEM_COLOR_COMPAT = `(() => {
  const SYSTEM = new Set('activeborder,activecaption,appworkspace,background,buttonface,buttonhighlight,buttonshadow,buttontext,captiontext,graytext,highlight,highlighttext,inactiveborder,inactivecaption,inactivecaptiontext,infobackground,infotext,menu,menutext,scrollbar,threeddarkshadow,threedface,threedhighlight,threedlightshadow,threedshadow,window,windowframe,windowtext'.split(','));
  const inline = (el, prop) => { try { const v = String(el && el.style && el.style.getPropertyValue(prop) || '').toLowerCase(); return SYSTEM.has(v) ? v : null } catch (e) { return null } };
  const orig = window.getComputedStyle;
  const patched = function getComputedStyle(el, pseudo) {
    const cs = orig.call(window, el, pseudo);
    return new Proxy(cs, {
      get(t, k) {
        if (k === 'getPropertyValue') return (p) => inline(el, p) ?? t.getPropertyValue(p);
        if (typeof k === 'string') { const hit = inline(el, k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())); if (hit) return hit }
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  };
  window.getComputedStyle = patched;
  if (typeof globalThis.getComputedStyle === 'function') globalThis.getComputedStyle = patched;
})()`

/**
 * 京东 PC `getJsToken / getJdEid`（上游 device_token.get_device_fields）。
 * 页面作用域（page / origin / referer）或 cookie 变化时重建 context；force 时临时去掉旧设备票据。
 */
export class DeviceToken {
  private cookie = ''
  private page = LOGIN_PAGE
  private origin = 'https://passport.jd.com'
  private referer = LOGIN_PAGE
  private context: vm.Context | null = null

  constructor(private readonly host: JsHost) {}

  configure(cookie: string, page?: string, origin?: string, referer?: string): void {
    const nextPage = page || LOGIN_PAGE
    const next = [cookie ?? '', nextPage, origin || 'https://passport.jd.com', referer || nextPage] as const
    if (next.join('\n') !== [this.cookie, this.page, this.origin, this.referer].join('\n')) {
      ;[this.cookie, this.page, this.origin, this.referer] = next
      this.context = null
    }
  }

  private ensure(): vm.Context {
    if (this.context) return this.context
    const env = { JD_COOKIE: this.cookie, JD_PAGE_URL: this.page, JD_ORIGIN: this.origin, JD_REFERER: this.referer }
    const modules = { jsdom: jsdomModule(), https: httpsModule(this.host), fs: fsModule(new Map(), () => {}) }
    const context = scriptContext(env, modules, this.host.log)
    vm.runInContext(source('h5st5_env.js'), context, { filename: join(STATIC, 'h5st5_env.js') })
    vm.runInContext(SYSTEM_COLOR_COMPAT, context)
    vm.runInContext('console.debug = () => {}; console.info = () => {};', context)
    vm.runInContext(source('pc_tk_lib.js'), context, { filename: 'pc_tk_lib.js' })
    this.context = context
    return context
  }

  async get(force = false): Promise<DeviceFields> {
    const original = this.cookie
    if (force) {
      this.context = null
      this.cookie = withoutOldIdentity(original)
    }
    let text: string
    try {
      const context = this.ensure()
      text = await vm.runInContext(DEVICE_FIELDS_JS, context)
    } finally {
      if (force) {
        this.context = null
        this.cookie = original
      }
    }
    const fields = JSON.parse(text) as Record<string, string>
    if (!fields.eid || !fields.eid2 || !fields.fp) throw new CatbusError('ERROR', 'PC 设备参数生成失败：DEVICE_FIELDS_EMPTY')
    return validateDevice(fields)
  }
}

/** 确定性模式下的 crypto.getRandomValues：每个元素取一次 Math.random（与对拍的 node 预加载一致）。 */
export function fillRandom<T extends ArrayBufferView>(array: T, random: () => number): T {
  const a = array as unknown as { length: number; BYTES_PER_ELEMENT: number; [i: number]: number }
  const span = 2 ** (8 * a.BYTES_PER_ELEMENT)
  for (let i = 0; i < a.length; i++) a[i] = Math.floor(random() * span)
  return array
}

// ---------------------------------------------------------------- SummerCryptico（utils/summer_cryptico.py + static/summer_cryptico_runner.js）

const SUMMER_URL = 'https://jrsecstatic.jdpay.com/jr-sec-dev-static/summer-cryptico-h5.min.js'
let summerSource = ''

/** 官方 SummerCryptico 脚本：与上游一样运行时从京东 CDN 取，进程内缓存。 */
export async function loadSummerSource(http: HttpClient): Promise<string> {
  if (summerSource) return summerSource
  const res = await http.request({ url: SUMMER_URL, cookies: false, timeout: 20 })
  const text = await res.text()
  if (res.status !== 200 || !text.includes('SummerCryptico')) throw new CatbusError('UPSTREAM', `SummerCryptico 官方脚本加载失败 HTTP ${res.status}`)
  return (summerSource = text)
}

/** 测试用：直接给定脚本内容。 */
export function setSummerSource(text: string): void {
  summerSource = text
}

/** 用服务端下发的 GMPK 加密一个值（summer_cryptico.encrypt）。 */
export async function summerEncrypt(http: HttpClient, publicKey: string, plaintext: string): Promise<string> {
  const key = String(publicKey ?? '')
  const value = String(plaintext ?? '')
  if (!key || !value) throw new CatbusError('ERROR', 'SummerCryptico 公钥和明文不能为空')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(key) || key.length % 4) throw new CatbusError('ERROR', 'SummerCryptico 公钥格式异常')
  if (Buffer.from(key, 'base64').length < 65) throw new CatbusError('ERROR', 'SummerCryptico 公钥长度异常')
  const src = await loadSummerSource(http)
  // runner 把自己的 global 当 window：这里的 host context 就是它
  const host = createContext({})
  const storage = new Map<string, string>()
  const libraryModule = { exports: {} as Record<string, any> }
  host.window = host
  host.navigator = { appName: 'Netscape' }
  host.localStorage = {
    getItem: (k: string) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k: string, v: unknown) => void storage.set(k, String(v)),
  }
  const hostGet = (name: string) => vm.runInContext(name, host)
  const hostMath = hostGet('Math') as Math
  host.crypto = rand.isDeterministic() ? { getRandomValues: (a: Uint8Array) => fillRandom(a, () => hostMath.random()) } : globalThis.crypto
  const inner = vm.createContext({
    module: libraryModule,
    exports: libraryModule.exports,
    window: host,
    navigator: host.navigator,
    localStorage: host.localStorage,
    console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
    ...Object.fromEntries(
      ['Math', 'Date', 'JSON', 'Uint8Array', 'Uint32Array', 'ArrayBuffer', 'Promise', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape'].map((k) => [k, hostGet(k)]),
    ),
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(src, inner, { filename: 'summer-cryptico-h5.min.js', timeout: 10000 })
  const cryptico = libraryModule.exports?.SummerCryptico
  if (!cryptico || typeof cryptico.encryptData !== 'function') throw new CatbusError('ERROR', 'SummerCryptico 本地加密失败：SUMMER_CRYPTICO_EXPORT_MISSING')
  const encrypted = String(cryptico.encryptData(key, value) ?? '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)) throw new CatbusError('ERROR', 'SummerCryptico 本地加密失败：EMPTY')
  return encrypted
}
