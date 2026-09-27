import * as realFs from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'
import { DEFAULT_NOW, DEFAULT_SEED, isDeterministic, now } from '../../../core/rand.js'
import { createContext } from '../../../core/vm.js'
import type { Jd } from './client.js'
import { PROFILE } from './profile.js'

/**
 * 京东 PC WebM 指纹（utils/webm.py + static/webm/env/run.js）：原版 jdwebm.js 跑在 jsdom 里，产出 wsgw_getinfo 的正文。
 * run.js 本是命令行脚本（读 stdin、写 stdout），这里放进 vm context，stdin / stdout 换成内存。
 */

const hostRequire = createRequire(import.meta.url)
const RESULT_PREFIX = '__WEBM_RESULT__'
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** jsdom window realm 的确定性（对拍时与 scripts/golden/jd/preload.cjs 相同）。 */
const REALM_JS = `(() => {
  let a = __catbus_seed >>> 0
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const D = Date
  globalThis.Date = class extends D { constructor(...x) { super(...(x.length ? x : [__catbus_now])) } static now() { return __catbus_now } }
  try { const fill = (arr) => { const span = 2 ** (8 * arr.BYTES_PER_ELEMENT); for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * span); return arr }; Object.defineProperty(crypto, 'getRandomValues', { value: fill, configurable: true, writable: true }) } catch (e) {}
  try { const t0 = __catbus_now; Object.defineProperty(performance, 'now', { value: () => 0, configurable: true, writable: true }); Object.defineProperty(performance, 'timeOrigin', { value: t0, configurable: true }) } catch (e) {}
})()`

/** 给脚本的 jsdom：确定性模式下，每个新 window 的 realm 固定随机数与时钟。 */
export function deterministicJsdom(): unknown {
  const m = hostRequire('jsdom') as { JSDOM: new (...a: unknown[]) => { getInternalVMContext(): vm.Context } }
  if (!isDeterministic()) return m
  const Base = m.JSDOM
  class JSDOM extends Base {
    constructor(...args: unknown[]) {
      super(...args)
      try {
        const ctx = this.getInternalVMContext()
        ctx.__catbus_seed = DEFAULT_SEED
        ctx.__catbus_now = now() || DEFAULT_NOW
        vm.runInContext(REALM_JS, ctx)
      } catch {}
    }
  }
  return Object.assign(Object.create(m), { JSDOM })
}

/** 在 vm 里跑一个命令行脚本：stdin 给定，stdout 收集，脚本调用 process.exit 或写出结果行后结束。 */
export async function runCliScript(
  file: string,
  input: string,
  options: { modules?: Record<string, unknown>; resultPrefix: string; timeout: number; log?: (line: string) => void },
): Promise<string> {
  const dir = join(file, '..')
  let out = ''
  let resolveDone!: (v: string) => void
  const done = new Promise<string>((r) => (resolveDone = r))
  const onChunk = (chunk: unknown) => {
    out += String(chunk)
    let i: number
    while ((i = out.indexOf('\n')) >= 0) {
      const line = out.slice(0, i)
      out = out.slice(i + 1)
      if (line.startsWith(options.resultPrefix)) resolveDone(line.slice(options.resultPrefix.length))
      else options.log?.(line)
    }
    return true
  }
  const fakeStdout = { write: onChunk, isTTY: false }
  const fs = {
    ...realFs,
    readFileSync: (p: unknown, ...rest: unknown[]) => (p === 0 ? input : (realFs.readFileSync as any)(p, ...rest)),
  }
  const modules: Record<string, unknown> = { fs, ...options.modules }
  const fakeProcess = new Proxy(process, {
    get: (t, k) => (k === 'stdout' ? fakeStdout : k === 'exit' ? () => resolveDone('') : k === 'env' ? {} : Reflect.get(t, k)),
    set: (_t, k) => k === 'exitCode',
  })
  const moduleShim = {
    createRequire: () => (name: string) => (name in modules ? modules[name] : hostRequire(name)),
  }
  const req = (name: string) => (name === 'module' ? moduleShim : name in modules ? modules[name] : hostRequire(name))
  const quiet = (...a: unknown[]) => options.log?.(a.map(String).join(' '))
  const context = createContext({
    require: req,
    process: fakeProcess,
    __dirname: dir,
    __filename: file,
    module: { exports: {} },
    exports: {},
    console: { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet },
    Buffer,
  })
  context.global = context
  vm.runInContext(realFs.readFileSync(file, 'utf8'), context, { filename: file })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => reject(new CatbusError('ERROR', `${file} 运行超时`)), options.timeout)
  })
  try {
    return await Promise.race([done, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** 跑原版 jdwebm.js，返回完整的 wsgw_getinfo 正文，同时把它写的 cookie 和 localStorage 交回会话（build_search_payload）。 */
export async function buildSearchPayload(jd: Jd, pageUrl: string, configData = '', localStorage?: Record<string, string>): Promise<any> {
  const input = {
    pageUrl: String(pageUrl),
    userAgent: PROFILE.ua,
    cookies: Object.fromEntries([...jd.cookies].filter(([, v]) => v != null && v !== '')),
    localStorage: localStorage ?? jd.localStorageFor(pageUrl),
    configData: String(configData ?? ''),
  }
  const marker = await runCliScript(staticFile('jd', 'webm/env/run.js'), JSON.stringify(input), {
    modules: { jsdom: deterministicJsdom() },
    resultPrefix: RESULT_PREFIX,
    timeout: 30_000,
    log: (line) => jd.ctx.log.debug(`[webm] ${line.slice(0, 300)}`),
  })
  if (!marker) throw new CatbusError('ERROR', '纯程序 WebM 指纹进程异常：无结果标记')
  let result: any
  try {
    result = JSON.parse(marker)
  } catch {
    throw new CatbusError('ERROR', '纯程序 WebM 指纹返回格式异常')
  }
  if (!result.ok) throw new CatbusError('ERROR', `纯程序 WebM 指纹生成失败：${String(result.errorMessage || result.error || '').slice(0, 240)}`)
  if (result.cookies && typeof result.cookies === 'object') {
    jd.update(Object.entries(result.cookies as Record<string, unknown>).filter(([k]) => COOKIE_NAME.test(k)).map(([k, v]) => [k, String(v ?? '')] as [string, string]))
  }
  if (result.localStorage && typeof result.localStorage === 'object') jd.replaceLocalStorage(pageUrl, result.localStorage)
  const payload = result.payload
  if (!payload || typeof payload !== 'object' || typeof payload.body !== 'object' || !payload.body) throw new CatbusError('ERROR', '纯程序 WebM 指纹缺少上报正文')
  return payload
}
