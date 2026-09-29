import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { format } from 'node:util'
import vm from 'node:vm'
import { CatbusError } from '../../../core/errors.js'
import type { HttpClient } from '../../../core/http.js'
import { cacheDir, staticFile } from '../../../core/paths.js'
import { DEFAULT_SEED, isDeterministic, now } from '../../../core/rand.js'
import { createContext } from '../../../core/vm.js'
import { compactJson } from '../../../core/py.js'
import { ACCEPT_ENCODING, ACCEPT_LANGUAGE, UA } from './profile.js'

/**
 * webweapon 预言机（上游 utils/sign/weapon_oracle.py、like_token.py）：在 node:vm 里跑官方 kwf / kws 脚本
 * 与 likeData token 引擎，产出 `kwfv1` / `kwscode` / 指纹上报 / like token。
 *
 * 上游把 reverse/tools/*_oracle.js 当命令行脚本起子进程（读环境变量、往 stdout 打印 JSON）；
 * 这里在 vm 里按 CommonJS 执行同一份脚本（static/kuaishou/ 原样复制），由包装层喂环境变量、收 stdout。
 * 预言机自己会 `require('vm').createContext` 再跑官方脚本：确定性模式（对拍）下给这些内层 context
 * 也注入固定的 Math.random / Date，与 scripts/golden/kuaishou/vm_determinism.cjs 一致。
 */

const hostRequire = createRequire(import.meta.url)
const P = 'kuaishou'

export const KWF_ORACLE = staticFile(P, 'tools/kwf_oracle.js')
export const KWS_ORACLE = staticFile(P, 'tools/kws_oracle.js')
export const LIKE_ORACLE = staticFile(P, 'tools/like_token_oracle.js')
export const WEAPON_DIR = staticFile(P, 'bundles/weapon')
const KWF_CURRENT_SCRIPT = staticFile(P, 'js/cp-kwf.js')
const KWF_LEGACY_NAME = 'kwf-0.0.2.2cee19b4b7dec496.js'
const KWF_LEGACY_SCRIPT = join(WEAPON_DIR, KWF_LEGACY_NAME)
const KWF_CURRENT_CAPTURE_NAME = 'kwf-0.1.1.a6d1e5d478c2cafa.js'
const KWF_NEW_GENERATION_COUNTER = 999

const HEX64 = /^[0-9a-f]{64}$/
const KWS_FILENAME = /^kws-(\d+)-0\.0\.1-obfuscated\.([0-9a-f]{16})\.js$/
const KWS_MIN_BYTES = 32_000
const KWS_MAX_BYTES = 128_000

const sources = new Map<string, string>()
function source(file: string): string {
  let s = sources.get(file)
  if (s == null) sources.set(file, (s = fs.readFileSync(file, 'utf8')))
  return s
}

/**
 * 确定性模式下注入内层 context 的代码，与 scripts/golden/kuaishou/vm_determinism.cjs 逐字相同。
 * Date 不能用 `class extends Date`：like token 的 VM 用 `constructor.prototype` 找原型，子类会无限循环。
 */
const INNER_PATCH = (seed: number, fixed: number) => `(() => {
  let a = ${seed} >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const D = Date
  const F = function Date(...a) {
    if (!new.target) return new D(${fixed}).toString()
    return new D(...(a.length ? a : [${fixed}]))
  }
  F.prototype = D.prototype
  F.now = () => ${fixed}
  F.parse = D.parse
  F.UTC = D.UTC
  globalThis.Date = F
})()`

/** 预言机里 `require('vm')` 拿到的模块：确定性模式下每个新 context 都从种子重新开始。 */
function oracleVm(): typeof vm {
  if (!isDeterministic()) return vm
  const patch = INNER_PATCH(DEFAULT_SEED, now())
  return {
    ...vm,
    createContext(sandbox?: vm.Context, options?: vm.CreateContextOptions) {
      const ctx = vm.createContext(sandbox, options)
      vm.runInContext(patch, ctx)
      return ctx
    },
  } as typeof vm
}

class OracleExit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
  }
}

/**
 * 按 CommonJS 执行一个预言机脚本，返回它写到 stdout 的内容。env 只含预言机要的 KS_* 变量。
 */
function runOracle(file: string, options: { env: Record<string, string | undefined>; argv?: string[]; stdin?: string }): string {
  const out: string[] = []
  const err: string[] = []
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(options.env)) if (v != null) env[k] = v
  const fakeProcess = {
    env,
    argv: ['node', file, ...(options.argv ?? [])],
    platform: process.platform,
    versions: process.versions,
    nextTick: process.nextTick,
    exit(code = 0) {
      throw new OracleExit(code)
    },
    stdout: { write: (s: unknown) => (out.push(String(s)), true) },
    stderr: { write: (s: unknown) => (err.push(String(s)), true) },
  }
  const fakeConsole = {
    log: (...a: unknown[]) => out.push(format(...a) + '\n'),
    info: (...a: unknown[]) => out.push(format(...a) + '\n'),
    error: (...a: unknown[]) => err.push(format(...a) + '\n'),
    warn: (...a: unknown[]) => err.push(format(...a) + '\n'),
    debug: () => {},
  }
  const vmModule = oracleVm()
  const fsModule = {
    ...fs,
    readFileSync: (p: fs.PathOrFileDescriptor, ...rest: unknown[]) => (p === 0 ? (options.stdin ?? '') : (fs.readFileSync as any)(p, ...rest)),
  }
  const module = { exports: {} as unknown }
  const req = ((id: string) => (id === 'vm' ? vmModule : id === 'fs' ? fsModule : hostRequire(id))) as NodeJS.Require
  Object.assign(req, { main: module, resolve: hostRequire.resolve, cache: {} })
  const context = createContext({
    require: req,
    module,
    exports: module.exports,
    __filename: file,
    __dirname: dirname(file),
    process: fakeProcess,
    console: fakeConsole,
  })
  try {
    vm.runInContext(source(file), context, { filename: file })
  } catch (e) {
    if (!(e instanceof OracleExit) || e.code !== 0) {
      const detail = err.join('').trim().slice(0, 300)
      throw new CatbusError('ERROR', `快手 webweapon 预言机 ${basename(file)} 执行失败${detail ? `：${detail}` : ''}`, { cause: e })
    }
  }
  return out.join('').trim()
}

function lastJson(out: string): any {
  const lines = out.split(/\r?\n/)
  try {
    return JSON.parse(lines[lines.length - 1] ?? '')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- kwf

/**
 * 按持久化的 kwfcv1 计数器或 gdfp 下发的 fpUrl 选择 kwf 脚本（_kwf_script_for_counter）：
 * fpUrl 只接受已抓包的两个内容寻址文件名，未知脚本直接失败；没有 fpUrl 时计数器 >= 999 用 0.1.1。
 */
export function kwfScriptFor(kwfcv1 = '', scriptPath = ''): string {
  if (scriptPath) {
    if (fs.existsSync(scriptPath)) return scriptPath
    let name: string
    try {
      name = basename(decodeURIComponent(new URL(scriptPath).pathname)).toLowerCase()
    } catch {
      name = basename(scriptPath).toLowerCase()
    }
    if (name === KWF_CURRENT_CAPTURE_NAME) return KWF_CURRENT_SCRIPT
    if (name === KWF_LEGACY_NAME.toLowerCase()) return KWF_LEGACY_SCRIPT
    throw new CatbusError('UPSTREAM', `快手下发了未收录的 kwf 脚本：${scriptPath}`, { detail: { kind: 'webweapon', fpUrl: scriptPath } })
  }
  if (Number.parseInt(kwfcv1, 10) >= KWF_NEW_GENERATION_COUNTER) return KWF_CURRENT_SCRIPT
  return ''
}

function hostnameOf(href: string, fallback: string): string {
  return /^https?:\/\/([^/]+)/.exec(href)?.[1] ?? fallback
}

export interface KwfState {
  value: string
  kwfv1: string
  kwfcv1: string
}

/** gen_kwfv1：跑官方 kwf 脚本产出当前 kwfv1（174 或 218 字符），连同更新后的 kwfcv1 计数器。 */
export function genKwfv1(o: { did: string; href: string; kwfcv1?: string; currentKwfv1?: string; cookie?: string; scriptPath?: string }): KwfState {
  const script = kwfScriptFor(o.kwfcv1 ?? '', o.scriptPath ?? '')
  const out = runOracle(KWF_ORACLE, {
    argv: ['--json'],
    env: {
      KS_DID: o.did,
      KS_HREF: o.href,
      KS_HOSTNAME: hostnameOf(o.href, 'www.kuaishou.com'),
      KS_COOKIE: o.cookie || (o.did ? `did=${o.did}` : ''),
      KS_KWFCV1: o.kwfcv1 ?? '',
      KS_KWFV1: o.currentKwfv1 ?? '',
      KS_HARDWARE_CONCURRENCY: '20',
      KS_KWF_SCRIPT: script || undefined,
    },
  })
  const state = lastJson(out) ?? {}
  const value = String(state.value ?? '')
  return { value, kwfv1: String(state.kwfv1 || value), kwfcv1: String(state.kwfcv1 || o.kwfcv1 || '') }
}

/** gen_fingerprint_report：kwf 的 getData(1)，作为 gdfp /s/w/p 的 data。 */
export function genFingerprintReport(o: { did: string; href: string; cookie: string; kwfcv1?: string; currentKwfv1?: string }): string {
  const script = kwfScriptFor(o.kwfcv1 ?? '', '')
  const out = runOracle(KWF_ORACLE, {
    argv: ['--json'],
    env: {
      KS_DID: o.did,
      KS_HREF: o.href,
      KS_HOSTNAME: hostnameOf(o.href, 'cp.kuaishou.com'),
      KS_COOKIE: o.cookie || (o.did ? `did=${o.did}` : ''),
      KS_KWFCV1: o.kwfcv1 ?? '',
      KS_KWFV1: o.currentKwfv1 ?? '',
      KS_HARDWARE_CONCURRENCY: '20',
      KS_KWF_REPORT_MODE: '1',
      KS_KWF_SCRIPT: script || undefined,
    },
  })
  return String(lastJson(out)?.value ?? '')
}

// ---------------------------------------------------------------- kws

function looksLikeOfficialKws(content: Buffer): boolean {
  if (content.length < KWS_MIN_BYTES || content.length > KWS_MAX_BYTES) return false
  if (!content.subarray(0, 256).toString('latin1').trimStart().startsWith('(function(){')) return false
  return content.subarray(0, 16_000).includes('function') && content.includes('window') && /[A-Za-z0-9+/=]{20000,}/.test(content.toString('latin1'))
}

/** 文件名里的 hash 是脚本 MD5 的中间 16 位。 */
function kwsHashMatches(name: string, content: Buffer): boolean {
  const m = KWS_FILENAME.exec(name)
  return Boolean(m && createHash('md5').update(content).digest('hex').slice(8, 24) === m[2])
}

/** 校验 signUrl（官方内容寻址的 static.yximgs.com 地址），返回文件名。 */
function kwsName(signUrl: string): string {
  let u: URL
  try {
    u = new URL(signUrl)
  } catch {
    throw new CatbusError('UPSTREAM', `KWS signUrl 不合法：${signUrl}`)
  }
  const host = u.hostname.toLowerCase()
  const name = basename(decodeURIComponent(u.pathname))
  const query = [...u.searchParams]
  const ok =
    u.protocol === 'https:' &&
    !u.username &&
    !u.password &&
    (u.port === '' || u.port === '443') &&
    (host === 'static.yximgs.com' || host.endsWith('.static.yximgs.com')) &&
    !u.hash &&
    u.pathname.toLowerCase().includes('/kws/') &&
    (query.length === 0 || (query.length === 1 && query[0]![0] === 'x-kcdn-pid' && /^\d+$/.test(query[0]![1]))) &&
    KWS_FILENAME.test(name)
  if (!ok) throw new CatbusError('UPSTREAM', `KWS signUrl 不符合官方脚本地址：${signUrl}`, { detail: { kind: 'webweapon' } })
  return name
}

/**
 * 找到 signUrl 指定的那一份 kws 脚本：先找随包的已抓副本，再找本机缓存，都没有就下载（校验内容与 MD5）。
 * 绝不用别的变体替代。
 */
export async function resolveKwsScript(signUrl: string, href: string, http: HttpClient): Promise<string> {
  const name = kwsName(signUrl)
  const bundled = join(WEAPON_DIR, name)
  if (fs.existsSync(bundled)) return bundled
  const cached = join(cacheDir(P), 'kws', name)
  if (fs.existsSync(cached)) {
    const content = await readFile(cached)
    if (looksLikeOfficialKws(content) && kwsHashMatches(name, content)) return cached
  }
  const res = await http.request({
    url: signUrl,
    redirect: 'manual',
    cookies: false,
    headers: [
      ['user-agent', UA],
      ['accept', '*/*'],
      ['accept-encoding', ACCEPT_ENCODING],
      ['accept-language', ACCEPT_LANGUAGE],
      ['referer', href || 'https://www.kuaishou.com/new-reco'],
      ['sec-fetch-dest', 'script'],
      ['sec-fetch-mode', 'no-cors'],
      ['sec-fetch-site', 'cross-site'],
    ],
  })
  if (res.status !== 200) throw new CatbusError('UPSTREAM', `下载 KWS 脚本失败：HTTP ${res.status}`, { detail: { kind: 'webweapon', url: signUrl } })
  const content = Buffer.from(await res.arrayBuffer())
  if (!looksLikeOfficialKws(content) || !kwsHashMatches(name, content)) {
    throw new CatbusError('UPSTREAM', 'KWS 脚本内容与文件名 hash 不一致', { detail: { kind: 'webweapon', url: signUrl } })
  }
  await mkdir(dirname(cached), { recursive: true })
  const tmp = `${cached}.${process.pid}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, cached)
  return cached
}

/** gen_kwscode：执行 /s/w/c 指派的那一份 kws 脚本，产出 64 位小写 hex 的 kwscode。 */
export async function genKwscode(o: { secToken: string; did: string; href: string; signUrl: string; http: HttpClient }): Promise<string> {
  const script = await resolveKwsScript(o.signUrl, o.href, o.http)
  const out = runOracle(KWS_ORACLE, {
    argv: [isAbsolute(script) ? script : join(WEAPON_DIR, script), '--json'],
    env: {
      KS_SECTOKEN: o.secToken,
      KS_DID: o.did,
      KS_HREF: o.href,
      KS_COOKIE: o.did ? `did=${o.did}` : '',
      KS_KWS_SCRIPT_URL: o.signUrl,
    },
  })
  const code = String(lastJson(out)?.kwscode ?? '')
  if (!HEX64.test(code)) {
    throw new CatbusError('UPSTREAM', 'KWS 脚本没有产出合法的 kwscode（环境检测或脚本漂移）', { detail: { kind: 'webweapon', kwscode: code.slice(0, 80) } })
  }
  return code
}

// ---------------------------------------------------------------- like token

/** likeDataQuery 的 56 位 hex token：输入是 {did, ts, uri} 的值按键排序后用 `:` 连接，交给抓包 bundle 的 $encode 引擎。 */
export function genLikeToken(did: string, ts: number, uri = '/rest/v/feed/myfollow'): string {
  const out = runOracle(LIKE_ORACLE, { stdin: compactJson({ did, ts, uri }), env: {} })
  if (!/^[0-9a-f]{56}$/.test(out)) throw new CatbusError('ERROR', `like token 引擎输出不合法：${out.slice(0, 80)}`)
  return out
}
