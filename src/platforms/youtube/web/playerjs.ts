/**
 * player JS 与签名解算（yt-dlp 的 EJS 方式）：
 * tv_samsung 客户端的格式地址全是 signatureCipher（s 挑战）且 URL 带 n 挑战，两者都要用 player JS 解开
 * （yt-dlp 的 jsc/_builtin：vendor/yt.solver.core.js 用 AST 找到 URL helper 与变换函数，借它解出签名和 n）。
 * player JS 同时提供 signatureTimestamp（STS）：tv_samsung 的 player 请求必须带它，否则整个响应 UNPLAYABLE。
 *
 * player JS 缓存在 cache/youtube/（可随时删除，AGENTS 5.1）：按 player id 存文件，版本轮转后重新下载。
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { CatbusError } from '../../../core/errors.js'
import { cacheDir, staticFile } from '../../../core/paths.js'
import { loadScript } from '../../../core/vm.js'
import type { YtClient } from './client.js'

const require = createRequire(import.meta.url)

/** yt-dlp vendor 的 solver core（Unlicense，yt-dlp/ejs 0.8.0 生成），原样复制进 static/。 */
const SOLVER_FILE = staticFile('youtube', 'yt.solver.core.js')

const ORIGIN = 'https://www.youtube.com'
/** player 版本页：iframe_api 里 `player?/<id>?/` 给出当前 player 版本（yt-dlp 同款）。 */
const IFRAME_API_URL = `${ORIGIN}/iframe_api`
/** signatureTimestamp（STS）：player JS 里的赋值，yt-dlp 同款正则。 */
const STS_RE = /(?:signatureTimestamp|sts)\s*:\s*([0-9]{5})/
/** player JS 的体积下限（几 MB 的混淆脚本；HTML 错误页、截断响应不落缓存）。测试可注入更小的值。 */
let MIN_CODE_BYTES = 100_000

/** 离线测试注入点（ESM 命名导入绑定无法 spyOn）。 */
export const playerJsTest = {
  /** 体积下限（合成 player fixture 远小于真实 player）。 */
  setMinCodeBytes(n: number) {
    MIN_CODE_BYTES = n
  },
  /** (playerCode, sig 挑战列表, n 挑战列表) → 解算结果；给定时替代真实 solver。 */
  solve: null as ((player: string, sig: string[], n: string[]) => { sig: Map<string, string>; n: Map<string, string> }) | null,
}

export interface PlayerJs {
  /** player JS 的路径（/s/player/<id>/…），也作缓存键。 */
  path: string
  code: string
  /** tv_samsung 的 player 请求要带的 signatureTimestamp。 */
  sts: number
}

/** player id 从路径里取：/s/player/<id>/…。 */
function playerId(path: string): string {
  const m = /\/s\/player\/([0-9a-fA-F]+)\//.exec(path)
  if (!m) throw new CatbusError('UPSTREAM', `player 地址不符合预期格式：${path}`, { hint: 'YouTube 页面结构可能已变更' })
  return m[1]
}

function cachePath(id: string): string {
  return join(cacheDir('youtube'), `player-${id}.js`)
}

async function readCache(id: string): Promise<string | null> {
  try {
    const s = await stat(cachePath(id))
    if (!s.isFile() || s.size === 0) return null
    return await readFile(cachePath(id), 'utf8')
  } catch {
    return null
  }
}

/** 缓存写失败不影响功能（只是下次重新下载），静默忽略。 */
async function writeCache(id: string, code: string): Promise<void> {
  try {
    await mkdir(cacheDir('youtube'), { recursive: true })
    await writeFile(cachePath(id), code)
  } catch {
    // ignore
  }
}

/**
 * player JS：ytcfg 的 PLAYER_JS_URL 优先（与 watch 页一致），没有时按 yt-dlp 的方式从
 * iframe_api 拿当前版本再拼地址。缓存命中直接用；下载失败时报 UPSTREAM
 * （tv_samsung 需要 STS，player JS 拿不到时这条客户端走不通，上层退回 visionos）。
 */
export async function playerJs(c: YtClient, cfgPath?: string): Promise<PlayerJs> {
  const path = cfgPath ?? (await iframeApiPlayerPath(c))
  const id = playerId(path)
  const cached = await readCache(id)
  if (cached) return { path, code: cached, sts: stsOf(cached) }
  const url = `${ORIGIN}${path}`
  const res = await c.get(url, [
    ['User-Agent', c.ua],
    ['Accept', '*/*'],
    ['Referer', `${ORIGIN}/`],
  ])
  // player JS 是静态资产：非 200 一律 UPSTREAM（不区分登录态）
  if (!res.ok) {
    throw new CatbusError('UPSTREAM', `player JS 下载失败：HTTP ${res.status}`, { detail: { url, status: res.status } })
  }
  const code = await res.text()
  if (code.length < MIN_CODE_BYTES || !STS_RE.test(code)) {
    throw new CatbusError('UPSTREAM', 'player JS 内容不对（可能页面结构已变更）', { detail: { url, bytes: code.length } })
  }
  await writeCache(id, code)
  return { path, code, sts: stsOf(code) }
}

/** iframe_api 的响应里拿当前 player 版本，拼出 base.js 路径。 */
async function iframeApiPlayerPath(c: YtClient): Promise<string> {
  const res = await c.get(IFRAME_API_URL, [
    ['User-Agent', c.ua],
    ['Accept', '*/*'],
    ['Referer', `${ORIGIN}/`],
  ])
  if (!res.ok) {
    throw new CatbusError('UPSTREAM', `iframe_api 下载失败：HTTP ${res.status}`, { detail: { url: IFRAME_API_URL, status: res.status } })
  }
  const text = await res.text()
  const m = /player\\?\/([0-9a-fA-F]{8})\\?\//.exec(text)
  if (!m) throw new CatbusError('UPSTREAM', 'iframe_api 里没有 player 版本号', { detail: { url: IFRAME_API_URL } })
  return `/s/player/${m[1]}/base.js`
}

/** signatureTimestamp：player JS 里的赋值（yt-dlp 同款正则）。 */
export function stsOf(code: string): number {
  const m = STS_RE.exec(code)
  if (!m) throw new CatbusError('UPSTREAM', 'player JS 里没有 signatureTimestamp', { hint: 'YouTube 的 player 可能已改用别的校验方式' })
  return Number(m[1])
}

// ---------------------------------------------------------------- solver

/**
 * solver 脚本的 context：core/vm.ts 的 context 自带 require（指向 catbus 自己的 node_modules，AGENTS 7.4），
 * solver core 以 `(meriyah, astring)` 结尾，两个 AST 库要在装载前放进 context。
 */
function solverContext() {
  return loadScript(SOLVER_FILE, {
    meriyah: require('meriyah'),
    astring: { generate: require('astring').generate },
  })
}

function runSolver(player: string, requests: { type: 'sig' | 'n'; challenges: string[] }[]): SolverOutput {
  const ctx = solverContext()
  // 脚本顶层 `var jsc = (function (meriyah, astring) { … })(meriyah, astring)` 挂在 context 全局
  const jsc = (ctx as Record<string, unknown>).jsc
  if (typeof jsc !== 'function') throw new CatbusError('UPSTREAM', 'solver core 没有暴露 jsc', {})
  return jsc({ type: 'player', player, requests }) as SolverOutput
}

interface SolverOutput {
  type: string
  error?: string
  responses?: { type: string; error?: string; data?: Record<string, string> }[]
}

/**
 * 批量解 s 签名（signatureCipher 的 s 参数）与 n 挑战（URL 的 n 参数）。
 * 调用方拿到解算结果后拼回 URL。
 */
export function solveChallenges(
  player: string,
  sigChallenges: string[],
  nChallenges: string[],
): { sig: Map<string, string>; n: Map<string, string> } {
  const requests: { type: 'sig' | 'n'; challenges: string[] }[] = []
  if (sigChallenges.length) requests.push({ type: 'sig', challenges: sigChallenges })
  if (nChallenges.length) requests.push({ type: 'n', challenges: nChallenges })
  if (!requests.length) return { sig: new Map(), n: new Map() }
  const out = runSolver(player, requests)
  if (out.type !== 'result' || !out.responses) {
    throw new CatbusError('UPSTREAM', `签名解算失败：${out.error ?? out.type}`, { hint: 'YouTube 的 player JS 可能已变更解算方式' })
  }
  const take = (i: number, what: string): Map<string, string> => {
    const r = out.responses![i]
    if (r?.type !== 'result' || !r.data) {
      throw new CatbusError('UPSTREAM', `签名解算失败（${what}）：${r?.error ?? r?.type ?? '空响应'}`, { hint: 'YouTube 的 player JS 可能已变更解算方式' })
    }
    return new Map(Object.entries(r.data))
  }
  let i = 0
  const sig = sigChallenges.length ? take(i++, 'sig') : new Map()
  const n = nChallenges.length ? take(i++, 'n') : new Map()
  return { sig, n }
}
