import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { format } from 'node:util'
import vm from 'node:vm'
import { DEFAULT_NOW, DEFAULT_SEED, isDeterministic, mulberry32, now } from './rand.js'

/**
 * 上游签名 JS 的执行环境（AGENTS 7.4）：每个脚本一个 vm context，懒创建、复用。
 * `require` 指向 catbus 自己的 node_modules；console 输出到 stderr，保证 stdout 纯净。
 *
 * 确定性模式（对拍测试）下，每次调用都新建 context，并注入与 scripts/golden/node_determinism.cjs
 * 相同的 Math.random 和 Date——上游每次签名都新起一个 node 进程，序列从头开始，这里保持一致。
 */

const require = createRequire(import.meta.url)
const contexts = new Map<string, vm.Context>()
const sources = new Map<string, string>()

const stderrConsole = Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].map((k) => [k, (...a: unknown[]) => process.stderr.write(format(...a) + '\n')]),
)

/** 新建 context，带上签名 JS 常用的宿主全局对象。 */
export function createContext(globals: Record<string, unknown> = {}): vm.Context {
  const context = vm.createContext({
    require,
    console: stderrConsole,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    ...globals,
  })
  if (isDeterministic()) {
    context.__catbus_random = mulberry32(DEFAULT_SEED)
    context.__catbus_now = now() || DEFAULT_NOW
    vm.runInContext(
      `Math.random = __catbus_random;
       (() => { const D = Date; globalThis.Date = class extends D {
         constructor(...a) { super(...(a.length ? a : [__catbus_now])) }
         static now() { return __catbus_now }
       } })();`,
      context,
    )
  }
  return context
}

function source(file: string): string {
  let s = sources.get(file)
  if (s == null) sources.set(file, (s = readFileSync(file, 'utf8')))
  return s
}

/** 在该脚本专属的 context 里执行一次，返回 context（即脚本的全局对象），之后复用。 */
export function loadScript(file: string, globals?: Record<string, unknown>): vm.Context {
  const deterministic = isDeterministic()
  let context = deterministic ? undefined : contexts.get(file)
  if (!context) {
    context = createContext(globals)
    vm.runInContext(source(file), context, { filename: file })
    if (!deterministic) contexts.set(file, context)
  }
  return context
}

/** 在脚本的 context 里调用一个全局函数。 */
export function callScript<T = unknown>(file: string, fn: string, args: unknown[], globals?: Record<string, unknown>): T {
  const context = loadScript(file, globals)
  const f = context[fn]
  if (typeof f !== 'function') throw new Error(`${file} 里没有函数 ${fn}`)
  return f(...args) as T
}
