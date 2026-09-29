#!/usr/bin/env node
// 用 Node 的 child_process 调 catbus 的最小封装：解析信封、按退出码把错误分类，给 Agent / 脚本直接用。
//
// 用法：
//   node examples/node-api.mjs <platform> <resource> <action> [参数...] [选项...]
//   node examples/node-api.mjs bilibili item get BV1xx411c7mD
//   node examples/node-api.mjs xhs item search 露营 --limit 5
//   node examples/node-api.mjs platforms douyin
//
// 在自己的代码里：
//   import { catbus, CatbusError } from './node-api.mjs'
//   const { data, page } = await catbus(['bilibili', 'item', 'search', '猫', '--limit', '20'])
//   for await (const event of catbusStream(['bilibili', 'live', 'listen', '<room>', '--duration', '10m'])) { ... }
//
// 环境变量：CATBUS 为 catbus 命令，默认 catbus；从源码运行时可设为 "node /path/to/catbus/dist/cli/main.js"。
//
// 约定（AGENTS.md 6.1 / 6.4）：
// - stdout 只有 JSON：-o json（默认）时恰好一个信封 {ok, platform, ..., data, page, error}；
//   stdout 不是终端时是紧凑的一行。
// - 退出码：0 成功；1 ERROR；2 USAGE / UNSUPPORTED / CONFIRM_REQUIRED；3 AUTH_REQUIRED / AUTH_EXPIRED；
//   4 NOT_IMPLEMENTED；5 RISK_CONTROL；6 NETWORK；7 UPSTREAM。
// - 帮助（--help）是 stdout 上唯一不是 JSON 的输出，这个封装不处理帮助。
//
// 依赖：Node（catbus 要求的版本即可），没有第三方依赖。
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

const CATBUS = (process.env.CATBUS ?? 'catbus').split(/\s+/).filter(Boolean)

/** 退出码 → 调用方该怎么办。retry 表示稍后重试可能成功。 */
export const EXIT = {
  0: { kind: 'ok', retry: false },
  1: { kind: 'error', retry: false },
  2: { kind: 'usage', retry: false }, // USAGE / UNSUPPORTED / CONFIRM_REQUIRED：改命令
  3: { kind: 'auth', retry: false }, // AUTH_REQUIRED / AUTH_EXPIRED：先登录（hint 里有登录命令）
  4: { kind: 'not_implemented', retry: false }, // 规划中的能力
  5: { kind: 'risk_control', retry: true }, // 风控：放慢、过一会儿再试
  6: { kind: 'network', retry: true }, // 网络 / 代理
  7: { kind: 'upstream', retry: false }, // 平台业务错误，原始错误码在 detail
}

export class CatbusError extends Error {
  /**
   * @param {{code: string, message: string, hint: string | null, detail: unknown}} error 信封里的 error
   * @param {number} exitCode
   * @param {string[]} args
   */
  constructor(error, exitCode, args) {
    super(`${error.code}: ${error.message}`)
    this.name = 'CatbusError'
    this.code = error.code
    this.hint = error.hint ?? null
    this.detail = error.detail ?? null
    this.exitCode = exitCode
    this.kind = (EXIT[exitCode] ?? EXIT[1]).kind
    this.retryable = (EXIT[exitCode] ?? EXIT[1]).retry
    this.args = args
  }
}

/** 找最后一个能解析成 JSON 对象的行（信封总是最后输出）。 */
function lastEnvelope(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i])
    } catch {}
  }
  return null
}

function run(args, { stdin } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, ...pre] = CATBUS
    const child = spawn(cmd, [...pre, ...args], { stdio: [stdin == null ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    const out = []
    const err = []
    child.stdout.on('data', (b) => out.push(b))
    child.stderr.on('data', (b) => err.push(b))
    child.on('error', (e) => reject(new Error(`无法启动 ${CATBUS.join(' ')}：${e.message}（没有安装？可以用 CATBUS 环境变量指定命令）`)))
    child.on('close', (code, signal) => resolve({ code: code ?? (signal ? 130 : 1), stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }))
    if (stdin != null) child.stdin.end(stdin)
  })
}

/**
 * 执行一条 catbus 命令，返回信封里的 {data, page, account}；失败时抛 CatbusError。
 * 不要传 -o jsonl（那是给管道用的）；列表用 --limit / --all / --cursor 翻页即可。
 *
 * @param {string[]} args 例如 ['bilibili', 'item', 'get', 'BV1xx411c7mD']
 * @param {{stdin?: string}} [options] stdin：例如 auth login --cookie - 时从这里传 cookie
 */
export async function catbus(args, options = {}) {
  if (args.includes('--help') || args.includes('-h')) throw new Error('帮助不是 JSON，请直接在终端里运行')
  const { code, stdout, stderr } = await run(args, options)
  const envelope = lastEnvelope(stdout)
  if (!envelope) {
    throw new CatbusError({ code: 'ERROR', message: `stdout 里没有信封（退出码 ${code}）：${(stderr || stdout).trim().slice(0, 300)}`, hint: null, detail: null }, code || 1, args)
  }
  if (!envelope.ok) throw new CatbusError(envelope.error, code, args)
  return { data: envelope.data, page: envelope.page, account: envelope.account }
}

/**
 * 长连接命令（live listen、msg listen）：逐条产出事件，结束（--duration 到期）时返回。
 * 失败时抛 CatbusError（错误信封在 stderr 的最后一行）。
 */
export async function* catbusStream(args) {
  const [cmd, ...pre] = CATBUS
  const child = spawn(cmd, [...pre, ...args, '-o', 'jsonl'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (b) => (stderr += b.toString('utf8')))
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code ?? 1)))
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      if (line.trim()) yield JSON.parse(line)
    }
    const code = await exited
    if (code !== 0) {
      const env = lastEnvelope(stderr)
      throw new CatbusError(env?.error ?? { code: 'ERROR', message: `退出码 ${code}`, hint: null, detail: null }, code, args)
    }
  } finally {
    // 调用方提前 break 时，像 Ctrl-C 一样让 catbus 正常收尾
    if (child.exitCode == null) child.kill('SIGINT')
  }
}

/** 风控 / 网络错误时按指数退避重试；其余错误直接抛出。 */
export async function catbusWithRetry(args, { attempts = 3, baseDelayMs = 30_000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await catbus(args)
    } catch (err) {
      if (!(err instanceof CatbusError) || !err.retryable || i >= attempts) throw err
      const wait = baseDelayMs * 2 ** (i - 1)
      process.stderr.write(`[node-api] ${err.code}，${Math.round(wait / 1000)} 秒后重试（${i}/${attempts - 1}）\n`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

// 直接运行时：执行命令行参数里的 catbus 命令，打印 data（缩进 JSON），按错误类型给出下一步
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  if (!args.length) {
    process.stderr.write('用法：node examples/node-api.mjs <platform> <resource> <action> [参数...] [选项...]\n')
    process.exit(2)
  }
  try {
    const { data, page } = await catbus(args)
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
    if (page?.has_more) process.stderr.write(`还有更多，下一页：--cursor=${page.cursor}\n`)
  } catch (err) {
    if (!(err instanceof CatbusError)) {
      process.stderr.write(`${err.message}\n`)
      process.exit(1)
    }
    const next = {
      auth: `先登录：${err.hint ?? 'catbus <platform> auth login'}`,
      usage: `检查命令和参数${err.hint ? `：${err.hint}` : ''}`,
      not_implemented: '这个能力还在规划中，换一个平台或命令',
      risk_control: `被平台风控拦下（${err.detail?.kind ?? '未知'}），放慢频率，过一会儿再试`,
      network: '网络或代理出错，检查 catbus config get proxy',
      upstream: `平台返回业务错误：${JSON.stringify(err.detail)}`,
      error: err.hint ?? '未分类错误',
    }[err.kind]
    process.stderr.write(`${err.message}\n${next}\n`)
    process.exit(err.exitCode)
  }
}
