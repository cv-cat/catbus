// tiktok 签名 JS（WebMssdk / Shop BSID）的确定性预加载。
// 在 scripts/golden/node_determinism.cjs 的基础上：
// - Date 子类保持 name === 'Date'（Shop 运行器按构造函数名挂到 fakeWindow 上）；
// - crypto.getRandomValues / randomUUID / randomBytes 走同一个 mulberry32 序列。
// catbus 在确定性模式下给签名 worker 注入的是同一段代码（src/platforms/tiktok/web/jsvm.ts）。
'use strict'

const seed = Number(process.env.CATBUS_GOLDEN_SEED)
const now = Number(process.env.CATBUS_GOLDEN_NOW)

if (Number.isFinite(seed) && Number.isFinite(now)) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  Math.random = next
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]))
    }
    static now() {
      return now
    }
  }
  Object.defineProperty(FixedDate, 'name', { value: 'Date' })
  globalThis.Date = FixedDate
  const fill = (view) => {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256)
    return view
  }
  const nodeCrypto = require('crypto')
  nodeCrypto.webcrypto.getRandomValues = fill
  if (globalThis.crypto) globalThis.crypto.getRandomValues = fill
  nodeCrypto.randomBytes = (n) => fill(Buffer.alloc(n))
  const { performance } = require('perf_hooks')
  performance.now = () => 0
}

// sign.js 用 vm.runInNewContext 在新 realm 里跑 WebMssdk：新 realm 有自己的 Math / Date，同样换掉。
if (Number.isFinite(seed) && Number.isFinite(now)) {
  const vm = require('vm')
  const seeded = new WeakSet()
  const prepare = (ctx) => {
    if (!ctx || typeof ctx !== 'object') return ctx
    if (!vm.isContext(ctx)) vm.createContext(ctx)
    if (!seeded.has(ctx)) {
      seeded.add(ctx)
      ctx.__catbus_random = Math.random
      ctx.__catbus_now = now
      vm.runInContext(
        `Math.random = __catbus_random;
         (() => { const D = Date; const F = class extends D {
           constructor(...a) { super(...(a.length ? a : [__catbus_now])) }
           static now() { return __catbus_now }
         }; Object.defineProperty(F, 'name', { value: 'Date' }); globalThis.Date = F })();`,
        ctx,
      )
    }
    return ctx
  }
  const runInNewContext = vm.runInNewContext
  vm.runInNewContext = function (code, ctx, options) {
    if (ctx && typeof ctx === 'object') return vm.runInContext(code, prepare(ctx), options)
    return runInNewContext.call(this, code, ctx, options)
  }
}
