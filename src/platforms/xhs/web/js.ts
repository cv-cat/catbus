import { spawn } from 'node:child_process'
import * as nodeCrypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import { CatbusError } from '../../../core/errors.js'
import { PACKAGE_ROOT, staticFile } from '../../../core/paths.js'
import * as rand from '../../../core/rand.js'
import { createContext } from '../../../core/vm.js'

/**
 * 上游签名 JS（static/xhs/，原样复制，保持 xhs_core/js、xhs_pc/js、xhs_creator/js 的相对结构）。
 *
 * 上游按命令行脚本起 node 子进程（`node sign.js <json>`、`node b1.js --generate` 等），脚本本身都是 CommonJS 模块、
 * 导出了真正干活的函数；这里在 node:vm 里按 CommonJS 加载它们，直接调用导出的函数。
 * 确定性模式（对拍）下每次调用都新建 context——上游每次签名都新起一个进程，Math.random / Date 从头开始。
 *
 * websectiga_cli.js 例外：它改写进程级全局（隐藏 process、接管 Function.prototype.toString、
 * `vm.runInThisContext` 跑服务端下发的程序），放不进 vm，和上游一样起子进程（AGENTS 7.4 的退路）。
 */

const hostRequire = createRequire(import.meta.url)
const P = 'xhs'

export const CORE_JS = (f: string) => staticFile(P, `xhs_core/js/${f}`)
export const PC_JS = (f: string) => staticFile(P, `xhs_pc/js/${f}`)
export const CREATOR_JS = (f: string) => staticFile(P, `xhs_creator/js/${f}`)

type Exports = Record<string, any>

interface Realm {
  context: vm.Context
  modules: Map<string, { exports: Exports }>
  crypto: typeof nodeCrypto
}

/**
 * 脚本里的 `require('crypto')`：确定性模式下 randomBytes 改为从该 context 已固定的 Math.random 取值
 * （每字节 floor(Math.random() * 256)），与对拍时预加载的 scripts/golden/xhs/crypto_determinism.cjs 相同。
 */
function newRealm(): Realm {
  const context = createContext()
  if (!rand.isDeterministic()) return { context, modules: new Map(), crypto: nodeCrypto }
  const random = vm.runInContext('Math.random', context) as () => number
  const randomBytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(random() * 256)))
  const crypto = new Proxy(nodeCrypto, { get: (t, k) => (k === 'randomBytes' ? randomBytes : Reflect.get(t, k)) })
  return { context, modules: new Map(), crypto }
}

let shared: Realm | null = null

function realm(): Realm {
  if (rand.isDeterministic()) return newRealm()
  return (shared ??= newRealm())
}

function load(r: Realm, file: string): Exports {
  const cached = r.modules.get(file)
  if (cached) return cached.exports
  const module = { exports: {} as Exports }
  r.modules.set(file, module)
  if (file.endsWith('.json')) {
    module.exports = JSON.parse(readFileSync(file, 'utf8'))
    return module.exports
  }
  const dir = dirname(file)
  const req = (id: string) => {
    if (id.startsWith('.')) {
      const target = resolve(dir, id)
      return load(r, /\.(js|json)$/.test(target) ? target : `${target}.js`)
    }
    return id === 'crypto' ? r.crypto : hostRequire(id)
  }
  const wrapper = vm.runInContext(`(function (exports, require, module, __filename, __dirname) {${readFileSync(file, 'utf8')}\n})`, r.context, {
    filename: file,
  }) as (...a: unknown[]) => void
  wrapper(module.exports, req, module, file, dir)
  return module.exports
}

/** 加载一个模块（及其依赖），返回 module.exports。 */
export function jsModule(file: string): Exports {
  return load(realm(), file)
}

// ---------------------------------------------------------------- 签名（xhs_core/js/sign.js signFull）

export interface SignResult {
  x3: string
  xs: string
  xt: string
  xs_common?: string
}

/** mns + X-s + X-t（+ X-S-Common，给了 dslPair 时）。入参与上游 runtime.run_signer 写给 node 的 JSON 相同。 */
export function signFull(input: Record<string, unknown>): SignResult {
  return jsModule(CORE_JS('sign.js')).signFull(input) as SignResult
}

/** 上游 run_signer 的输出门禁：mns 前缀与长度（PC）或长度集合（Creator）。 */
export function checkSign(result: SignResult, tier: string, lengths: number[], what = 'X-s'): SignResult {
  const x3 = String(result?.x3 ?? '')
  if (!result?.xs || !x3.startsWith(`mns${tier}_`) || !lengths.includes(x3.length)) {
    throw new CatbusError('ERROR', `小红书 ${what} 签名失败（mns${tier}，长度 ${x3.length}）`)
  }
  return result
}

/** b1：19 个字段的环境快照 → RC4 → 自定义 base64（xhs_core/js/b1.js generateB1）。 */
export function generateB1(options: Record<string, unknown>): string {
  const value = String(jsModule(CORE_JS('b1.js')).generateB1(options).b1)
  if (value.length < 500 || value.length % 4) throw new CatbusError('ERROR', `小红书 b1 长度不对：${value.length}`)
  return value
}

/** PC webprofile 的 profileData（xhs_pc/js/profile.js）。 */
export function pcProfileData(options: Record<string, unknown>): string {
  return String(jsModule(PC_JS('profile.js')).generateProfileData(options))
}

/** Creator webprofile 的 profileData（xhs_creator/js/profile.js）。 */
export function creatorProfileData(options: Record<string, unknown>): string {
  return String(jsModule(CREATOR_JS('profile.js')).generateProfileData(options))
}

/** x-rap-param（xhs_pc/js/rap.js buildRapPure）；fingerprintHex 为空时用 PC 的采集模板（与 rap_cli.js 相同）。 */
export function rapParam(api: string, data: string, fingerprintHex = ''): string {
  const r = realm()
  const fingerprint = Buffer.from(fingerprintHex || load(r, PC_JS('rap_fingerprint_template.json')).bodyUnmaskedHex, 'hex')
  const value = String(load(r, PC_JS('rap.js')).buildRapPure({ api, data, fingerprint }))
  if (!value.startsWith('ByQ')) throw new CatbusError('ERROR', '小红书 x-rap-param 生成失败')
  return value
}

/** Creator 发布接口的 rap 指纹模板：03ea 段的 16 字符 Uuid 每次随机（上游 load_creator_rap_fingerprint_hex）。 */
export function creatorRapFingerprint(): string {
  const raw = Buffer.from(jsModule(CREATOR_JS('rap_fingerprint_creator.json')).bodyUnmaskedHex, 'hex')
  if (raw.subarray(0, 6).toString('hex') !== '03ea00000010') throw new CatbusError('ERROR', 'Creator rap 指纹模板缺少 03ea 段')
  Buffer.from(rand.string(16, '0123456789abcdefghijklmnopqrstuvwxyz'), 'ascii').copy(raw, 6)
  return raw.toString('hex')
}

// ---------------------------------------------------------------- webSsk（xhs_pc/js/web_ssk.js）

export interface Handshake {
  private_key_base64: string
  client_public_key_base64: string
}

/**
 * 登录激活的 X25519 握手。上游用 generateKeyPairSync；这里私钥取 32 个随机字节（经 core/rand，对拍可固定），
 * 公钥用 web_ssk.js 的 privateKeyFromRaw 导出——两者产出的密钥对等价。
 */
export function createHandshake(): Handshake {
  const priv = Buffer.from(rand.bytes(32))
  const key = jsModule(PC_JS('web_ssk.js')).privateKeyFromRaw(priv)
  const pub = nodeCrypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32)
  return { private_key_base64: priv.toString('base64'), client_public_key_base64: pub.toString('base64') }
}

/** 激活响应里的加密 SSK：X25519 + AES-256-GCM 解开，返回 base64。 */
export function acceptSsk(privateKeyBase64: string, encryptedSskBase64: string): string {
  return String(jsModule(PC_JS('web_ssk.js')).acceptSsk(privateKeyBase64, encryptedSskBase64))
}

// ---------------------------------------------------------------- Creator 上传（xhs_creator/js）

/** 文件加密接口的 sign：md5(固定盐 + fileId + 秒级时间戳的十六进制)。 */
export function urlSign(fileId: string): string {
  return String(jsModule(CREATOR_JS('xhs_creator_sign.js')).urlSing(fileId))
}

/**
 * ROS 上传的 q-signature（xhs_creator_signature.js 的 getSignature）。
 * 这个脚本是给 PyExecJS 用的：没有 module.exports，只有一个顶层函数，所以按普通脚本在 context 里执行后取出。
 */
export function uploadSignature(message: string, fileId: string, size: number, host: string): string {
  const r = realm()
  const file = CREATOR_JS('xhs_creator_signature.js')
  if (!r.modules.has(file)) {
    vm.runInContext(readFileSync(file, 'utf8'), r.context, { filename: file })
    r.modules.set(file, { exports: {} })
  }
  return String((r.context.getSignature as (...a: unknown[]) => unknown)(message, fileId, size, host))
}

// ---------------------------------------------------------------- websectiga（子进程）

/**
 * 执行服务端下发的 seccallback 程序，得到 cookie `websectiga`（上游 runtime.generate_websectiga）。
 * 确定性模式下和上游对拍时一样预加载 scripts/golden/node_determinism.cjs。
 */
export async function generateWebsectiga(code: string, profile: { userAgent: string; platform: string; pageUrl: string; timeoutMs?: number }): Promise<string> {
  if (code.length < 1000) throw new CatbusError('UPSTREAM', '小红书 seccallback 程序为空或被截断')
  const deterministic = rand.isDeterministic()
  const env: Record<string, string> = deterministic
    ? {
        NODE_OPTIONS: `--require "${join(PACKAGE_ROOT, 'scripts', 'golden', 'node_determinism.cjs').replaceAll('\\', '/')}"`,
        CATBUS_GOLDEN_SEED: String(rand.DEFAULT_SEED),
        CATBUS_GOLDEN_NOW: String(rand.now()),
      }
    : { NODE_OPTIONS: '' }
  const script = CORE_JS('websectiga_cli.js')
  const input = JSON.stringify({ code, userAgent: profile.userAgent, platform: profile.platform, pageUrl: profile.pageUrl, ...(profile.timeoutMs ? { timeoutMs: profile.timeoutMs } : {}) })
  const stdout = await new Promise<string>((ok, fail) => {
    const child = spawn(process.execPath, [script], { cwd: dirname(script), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const out: Buffer[] = []
    const timer = setTimeout(() => child.kill(), 30_000)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', () => {})
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(new CatbusError('ERROR', `websectiga 进程启动失败：${e.message}`))
    })
    child.on('close', () => {
      clearTimeout(timer)
      ok(Buffer.concat(out).toString('utf8'))
    })
    child.stdin.end(input)
  })
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      const token = String(JSON.parse(line).websectiga ?? '')
      if (/^[0-9a-f]{64}$/i.test(token)) return token
    } catch {}
  }
  throw new CatbusError('RISK_CONTROL', '小红书安全程序执行失败，拿不到 websectiga', { detail: { kind: 'blocked' } })
}
