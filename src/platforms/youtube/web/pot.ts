/**
 * PO Token（Proof of Origin）：BotGuard 生成的来源证明。
 * player 被「Sign in to confirm you're not a bot」的人机验证拦下（同一出口 IP 请求多了会发生）时，
 * VISIONOS 游客路径走不通，改用 iOS 客户端带 PO token 的 player 请求兜底（见 commands.ts 的 mediaOf）。
 *
 * 流程与 yt-dlp 的 PO Token Provider（bgutil）一致，全部在 Node 里完成，不需要浏览器：
 * 首页的 ytAtN 挑战 → interpreter（www.google.com 白名单 + jsdom 环境）→ BotGuard 快照 →
 * GenerateIT 换 integrity token → WebPoMinter 按内容绑定（视频 ID）铸造 token。
 * 实测（2026-11-10）：player 与 GVS 的 token 都绑视频 ID；iOS 请求带 serviceIntegrityDimensions
 * 后 pbp 门控放开，分组直链 + URL 追加 `&pot=` 能完整下载。
 */

import { BotGuardClient } from 'bgutils-js/botguard'
import { WebPoMinter as Minter } from 'bgutils-js/webpo'
import { createRequire } from 'node:module'
import { format } from 'node:util'
import { CatbusError } from '../../../core/errors.js'
import { jsonLoads } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { retryNetwork, type YtClient } from './client.js'

const require = createRequire(import.meta.url)
const { JSDOM, VirtualConsole } = require('jsdom') as {
  JSDOM: new (html: string, opts?: Record<string, unknown>) => any
  VirtualConsole: new () => any
}

/** GenerateIT 是 Google WAA 的 protobuf 风格 RPC：双元素请求 `[API key, botguard 响应]`，四元素响应。 */
const GENERATE_IT_URL = 'https://youtube-.runtime.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT'
/** YouTube 客户端共用、多年未变的 WAA API key（bgutils-js 同值）。 */
const GENERATE_IT_KEY = 'O43z0dpjhgX20SCx4KAo'
/** interpreter 只能来自 YouTube 网页环境用的 www.google.com 静态脚本（与 Studio 的 BotGuard 白名单一致）。 */
const INTERPRETER_HOST = 'www.google.com'
/** integrity token 的实测 TTL 是 12h（43200s），minter 按一半取保守值缓存。 */
const MINTER_TTL_MS = 6 * 3600 * 1000
/** challenge 里 program 会随部署轮转，短缓存即可（够一条命令内复用，不跨命令依赖它）。 */
const CHALLENGE_TTL_MS = 30 * 60 * 1000

interface BgChallenge {
  program: string
  globalName?: string
  interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string }
}

/** minter 只用到这一项：按内容绑定（visitorData / 视频 ID）铸造 token。 */
interface MintFn {
  mintAsWebsafeString(contentBinding: string): Promise<string>
}

/** 缓存挂凭证 device，随凭证由 core 落盘（guest 凭证同样适用）。 */
export interface PotCache {
  challenge?: { data: BgChallenge; fetchedAt: number }
  minter?: { minter: MintFn; expiresAt: number }
}

/** PO token 链路失败：仍按人机验证报错（上层维持 RISK_CONTROL 语义），与原 VISIONOS 失败的提示不同。 */
export class PotError extends CatbusError {
  constructor(message: string) {
    super('RISK_CONTROL', message, { hint: 'PO Token 链路失败，过一段时间再试，或换一个代理出口', detail: { kind: 'captcha' } })
  }
}

/** 离线测试注入点：给定时跳过 BotGuard 真实链路，直接用假 minter（ESM 命名导入绑定无法 spyOn）。 */
export const potTest = {
  fakeMinter: null as ((binding: string) => Promise<string>) | null,
}

/** 首页 `window.ytAtN({...})` 里的 BotGuard 挑战（与 ytcfg 成对）。 */
async function loadChallenge(c: YtClient, cache: PotCache): Promise<BgChallenge> {
  const cached = cache.challenge
  if (cached && rand.now() - cached.fetchedAt < CHALLENGE_TTL_MS) return cached.data
  const html = await c.homepage()
  const match = html.match(/window\.ytAtN\((\{[\s\S]*?\})\)/)
  if (!match) throw new PotError('YouTube 首页里没有 BotGuard 挑战（ytAtN）')
  // 载荷形如 `{'R': '\x7b…\x7d'}`：R 是再套一层、\xNN 转义的 JSON 字符串。
  // 键等为 JS 字面量，严格 JSON 不认，按 JS 对象字面量求值后 parse R。
  let obj: { R?: unknown }
  try {
    obj = new Function(`return (${match[1]})`)() as { R?: unknown }
  } catch (err) {
    throw new PotError(`ytAtN 载荷解析失败：${err instanceof Error ? err.message : String(err)}`)
  }
  const att = typeof obj.R === 'string' ? jsonLoads(obj.R) : obj.R
  const challenge = (att as { bgChallenge?: BgChallenge } | null)?.bgChallenge
  if (!challenge?.program || !challenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue) {
    throw new PotError('BotGuard 挑战缺 program / interpreterUrl')
  }
  cache.challenge = { data: challenge, fetchedAt: rand.now() }
  return challenge
}

/**
 * 铸造/复用 WebPoMinter：interpreter → BotGuard 快照 → GenerateIT 换 integrity token。
 * minter 可对任意内容绑定（GVS / player 各 bind 一次）反复 mint，缓存复用 6 小时。
 */
export async function poMinter(c: YtClient): Promise<MintFn> {
  if (potTest.fakeMinter) return { mintAsWebsafeString: (binding: string) => potTest.fakeMinter!(binding) }
  const cache = (c.ctx.credential.device.pot ??= {}) as PotCache
  const hit = cache.minter
  if (hit && hit.expiresAt > rand.now()) return hit.minter

  const challenge = await loadChallenge(c, cache)
  // interpreter 的 host 白名单：只认客户端实测使用的 www.google.com 静态脚本（AGENTS 5.7 的口径）
  const interpreterPath = challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  const u = new URL(interpreterPath.startsWith('//') ? `https:${interpreterPath}` : interpreterPath)
  if (u.protocol !== 'https:' || u.host !== INTERPRETER_HOST) {
    throw new PotError(`BotGuard interpreter 来自白名单之外的主机（${u.host}）`)
  }
  const res = await c.get(u.href, [['User-Agent', c.ua]])
  const interpreterJS = await res.text()

  runInterpreter(c, interpreterJS)

  const webPoSignalOutput: unknown[] = []
  const bg = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName ?? 'trayride',
    globalObject: globalThis,
  })
  const botguardResponse = await bg.snapshot({ webPoSignalOutput } as never, 20_000)
  if (!botguardResponse) throw new PotError('BotGuard 快照为空')

  const itRes = await c.postRaw(GENERATE_IT_URL, [
    ['Content-Type', 'application/json+protobuf'],
    ['X-Goog-Api-Key', GENERATE_IT_KEY],
    ['X-User-Agent', 'grpc-web-javascript/0.1'],
    ['User-Agent', c.ua],
  ], JSON.stringify([GENERATE_IT_KEY, botguardResponse]))
  await c.check(itRes, 'GenerateIT')
  const [integrityToken, ttlSecs, mintRefreshThreshold, websafeFallbackToken] = await jsonLoads(await itRes.text())
  if (!integrityToken) throw new PotError('GenerateIT 没有返回 integrity token')
  c.ctx.log.debug(`BotGuard integrity token TTL ${ttlSecs}s`)

  const minter = (await Minter.create(
    { integrityToken, estimatedTtlSecs: ttlSecs, mintRefreshThreshold, websafeFallbackToken },
    webPoSignalOutput as never,
  )) as unknown as MintFn
  cache.minter = { minter, expiresAt: rand.now() + MINTER_TTL_MS }
  return minter
}

/**
 * 在 jsdom 全局环境里执行 interpreter，把 challenge.globalName 指向的 VM 挂到 globalThis。
 * 与实测打通的条件一致：Node 全局 + window/document/location/origin 来自 jsdom；Node 20+ 的
 * navigator 是只读 getter，保持不清除（bgutils 同款处理）。interpreter 由 vm 之外的普通 eval 装载，
 * BotGuardClient.create({globalObject: globalThis}) 会取到 globalThis[globalName]。
 */
function runInterpreter(c: YtClient, interpreterJS: string): void {
  // jsdom 默认把 window.console 转发到 Node 的 stdout，会污染 stdout 上的 JSON 信封；改写到 stderr（AGENTS 8「stdout 纯净」）
  const vc = new VirtualConsole()
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace']) vc.on(k, (...a: unknown[]) => process.stderr.write(format(...a) + '\n'))
  vc.on('jsdomError', (e: Error) => process.stderr.write(`[catbus] jsdom: ${e.message}\n`))
  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
    url: 'https://www.youtube.com/',
    referrer: 'https://www.youtube.com/',
    resources: { userAgent: c.ua },
    pretendToBeVisual: true,
    virtualConsole: vc,
  })
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.location = dom.window.location
  g.origin = (dom.window as { origin?: string }).origin
  if (!Reflect.has(g, 'navigator')) {
    try {
      Object.defineProperty(g, 'navigator', { value: dom.window.navigator })
    } catch { /* Node 的 navigator 只读，保留原生即可 */ }
  }
  // interpreter 的 BotGuard program 会读 ytcfg（EVENT_ID 等），提供与主页同源的最小配置
  g.yt = { config_: c.configNow() }
  // interpreter 是 YouTube 发来的混淆脚本（host 已做 https + www.google.com 白名单），只能 eval 装载
  // biome-ignore lint/security/noGlobalEval: 白名单约束下的静态脚本装载
  new Function(interpreterJS)()
}
