/**
 * BotGuard：Google 的网页环境校验。Studio 的写操作（建视频、删视频）要在请求里带它的结果（AGENTS 5.7）。
 * 它依赖真实浏览器的环境，只能在无头 Chromium 的 Studio 页面里算；其余请求都由 Node 发出。
 *
 * runBotGuard 经 Runtime.evaluate 注入页面执行，所以必须自包含：函数体不能引用本模块的任何变量或导入，
 * 页面里只能用 globalThis 上的东西。
 */

/** att/get 返回的 bgChallenge（或 botguardData）。这里只列用到的字段，其余原样保留。 */
export interface BgChallenge {
  program: string
  globalName?: string
  interpreterUrl?: unknown
  interpreterSafeUrl?: unknown
  interpreterScript?: unknown
  interpreterSafeScript?: unknown
}

/**
 * 在页面里跑一次 BotGuard，返回 webResponse。
 * binding 是 Studio 传给 vm.snapshot 的内容绑定：att/get 的 atr_challenge，或建视频时的 {c, e, scottyResourceId}。
 * 调用前 interpreter 必须已经在页面里求值（定义了 fallbackGlobal 或 bg.globalName 指向的全局对象）。
 */
export async function runBotGuard(bg: BgChallenge, binding: unknown, timeoutMs: number, fallbackGlobal: string): Promise<string> {
  const withTimeout = <T>(p: Promise<T>, what: string): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), timeoutMs))])
  const page = globalThis as any
  const name = bg.globalName || fallbackGlobal
  const vm = page[name]
  if (!vm || typeof vm.a !== 'function') throw new Error(`global ${name} not defined in page`)
  const noop = () => {}
  // 参数顺序与 Studio 的 bundle、bgutils-js 一致：(program, setupCb, true, interactionEl, telemetryCb, [[], []], undefined, false, loggers)
  const snapshot = await withTimeout(
    new Promise<any>((res) => {
      // 页面里交互元素是 body；没有 document 的环境（如单测）传 undefined
      const interactionEl = page.document?.body
      vm.a(bg.program, (asyncSnapshot: any) => res(asyncSnapshot), true, interactionEl, noop, [[], []], undefined, false, [noop, noop, noop, noop, noop])
    }),
    'vm setup',
  )
  return withTimeout(
    new Promise<string>((res) => {
      snapshot((webResponse: string) => res(webResponse), [binding, undefined, undefined, undefined])
    }),
    'snapshot',
  )
}
