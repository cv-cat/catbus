import cp from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * JCAP 子进程的预加载（node --import），run.js 原样运行，这里只做两处宿主适配：
 *
 * 1. run.js 用 `spawnSync(python, [http_bridge.py | captcha_solver.py, ...])` 起网络桥和图像求解器，
 *    这两种调用换成 `node helper.js bridge|solve ...`，入参出参协议不变。
 * 2. env_core.js 用递归 Proxy 包住 document / navigator 及其返回的对象。上游的 jsdom 25 靠 impl 符号做品牌检查，
 *    Proxy 能透传；jsdom 30 用私有字段，Proxy 当 this 或参数时一律报"不是合法实例"。这里记下 env_core 的每个 Proxy
 *    包的目标，jsdom 取 impl 时先换回目标，效果与 jsdom 25 下一致。
 * 3. env_core.init() 把全局的 Buffer / process 藏成 undefined（让 JCAP 看不出 Node）；jsdom 30 的依赖
 *    （@exodus/bytes 等）解析 URL 时要用 Buffer。藏起来的这两个全局改成访问器：调用方在 node_modules 里时
 *    给真对象，其余（JCAP 包）仍是 undefined。
 */

const execPath = process.execPath
const helper = process.env.CATBUS_JD_HELPER ?? ''
const original = cp.spawnSync

cp.spawnSync = function (command: string, args?: readonly string[] | cp.SpawnSyncOptions, options?: cp.SpawnSyncOptions) {
  const list = Array.isArray(args) ? args : []
  const script = String(list[0] ?? '')
  if (helper && script.endsWith('http_bridge.py')) return original.call(cp, execPath, [helper, 'bridge'], options ?? {})
  if (helper && script.endsWith('captcha_solver.py')) return original.call(cp, execPath, [helper, 'solve', ...list.slice(1)], options ?? {})
  return (original as (...a: unknown[]) => cp.SpawnSyncReturns<Buffer>).call(cp, command, args, options)
} as typeof cp.spawnSync

const targets = new WeakMap<object, object>()
const NativeProxy = Proxy
const source = Function.prototype.toString
/** 只处理 env_core.createProxy 造的 Proxy（jsdom 自己也用 Proxy，那些不能动）。 */
const isEnvCoreHandler = (h: unknown) => {
  const get = (h as { get?: unknown } | null)?.get
  try {
    return typeof get === 'function' && source.call(get).includes('recordUndefined')
  } catch {
    return false
  }
}
globalThis.Proxy = new NativeProxy(NativeProxy, {
  construct(T, args, newTarget) {
    const p = Reflect.construct(T, args, newTarget) as object
    if (args[0] && (typeof args[0] === 'object' || typeof args[0] === 'function') && isEnvCoreHandler(args[1])) targets.set(p, args[0])
    return p
  },
})
const unwrap = (v: unknown): unknown => (v && (typeof v === 'object' || typeof v === 'function') && targets.has(v) ? unwrap(targets.get(v)) : v)

// jsdom 30 用私有字段做品牌检查（`#impl in wrapper`），Proxy 永远过不了；生成代码经 utils 的这几个函数取 impl。
// 在 jsdom 加载之前先载入它的 utils 并替换：参数或 this 是 env_core 的 Proxy 时先换成被包的对象。
{
  const req = createRequire(process.argv[1] ?? import.meta.url)
  const utils = req(join(dirname(req.resolve('jsdom')), 'generated', 'idl', 'utils.js')) as Record<string, (...a: unknown[]) => unknown>
  for (const name of ['implForWrapper', 'implForWrapperWithInterface', 'tryImplForWrapper']) {
    const fn = utils[name]!
    utils[name] = (wrapper: unknown, ...rest: unknown[]) => fn(unwrap(wrapper), ...rest)
  }
}

const nativeLike = <F extends (...a: never[]) => unknown>(fn: F, name: string): F => {
  Object.defineProperty(fn, 'name', { value: name })
  Object.defineProperty(fn, 'toString', { value: () => `function ${name}() { [native code] }` })
  return fn
}

const realGlobals: Record<string, unknown> = { Buffer: globalThis.Buffer, process: globalThis.process }
const nativeDefine = Object.defineProperty

/** 访问全局的调用方是否在依赖包里（不经 run.js 自定义的 prepareStackTrace）。 */
function fromDependency(self: (...a: never[]) => unknown): boolean {
  const prepare = Error.prepareStackTrace
  const limit = Error.stackTraceLimit
  try {
    Error.stackTraceLimit = 2
    Error.prepareStackTrace = (_e, frames) => frames
    const holder: { stack?: unknown } = {}
    Error.captureStackTrace(holder, self)
    const frames = holder.stack as NodeJS.CallSite[] | undefined
    const file = String(frames?.[0]?.getFileName() ?? '')
    return /[\\/]node_modules[\\/]/.test(file) || file.startsWith('node:')
  } catch {
    return false
  } finally {
    Error.prepareStackTrace = prepare
    Error.stackTraceLimit = limit
  }
}

Object.defineProperty = nativeLike(function defineProperty<T>(o: T, key: PropertyKey, d: PropertyDescriptor & ThisType<unknown>): T {
  if (o === (globalThis as unknown) && (key === 'Buffer' || key === 'process') && d && 'value' in d && d.value === undefined) {
    const real = realGlobals[key]
    let override: { value: unknown } | null = null
    const get = function (): unknown {
      if (override) return override.value
      return fromDependency(get) ? real : undefined
    }
    return nativeDefine(o, key, {
      configurable: true,
      enumerable: false,
      get,
      set(value: unknown) {
        override = { value }
      },
    })
  }
  return nativeDefine(o, key, d)
} as typeof Object.defineProperty, 'defineProperty')
