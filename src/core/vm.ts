import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { format } from 'node:util'
import vm from 'node:vm'

/**
 * 上游签名 JS 的执行环境（AGENTS 7.4）：每个脚本一个 vm context，懒创建、复用。
 * `require` 指向 catbus 自己的 node_modules；console 输出到 stderr，保证 stdout 纯净。
 */

const require = createRequire(import.meta.url)
const contexts = new Map<string, vm.Context>()

const stderrConsole = Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].map((k) => [k, (...a: unknown[]) => process.stderr.write(format(...a) + '\n')]),
)

/** 新建 context，带上签名 JS 常用的宿主全局对象。 */
export function createContext(globals: Record<string, unknown> = {}): vm.Context {
  return vm.createContext({
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
}

/** 在该脚本专属的 context 里执行一次，返回 context（即脚本的全局对象），之后复用。 */
export function loadScript(file: string, globals?: Record<string, unknown>): vm.Context {
  let context = contexts.get(file)
  if (!context) {
    context = createContext(globals)
    vm.runInContext(readFileSync(file, 'utf8'), context, { filename: file })
    contexts.set(file, context)
  }
  return context
}
