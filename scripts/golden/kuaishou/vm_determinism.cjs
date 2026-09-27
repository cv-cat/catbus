// 对拍专用预加载：上游预言机脚本会自己 vm.createContext 再在里面跑官方 kwf / kws / like token 脚本，
// 新 context 有自己的 Math / Date，node_determinism.cjs 管不到。这里给每个新建的 context
// 注入确定性的 Math.random（每个 context 从种子重新开始）与固定时间的 Date。
// catbus 侧在确定性模式下注入完全相同的代码（src/platforms/kuaishou/web/oracle.ts 的 INNER_PATCH）。
//
// Date 不能用 `class extends Date`：like token 的 VM 用 `constructor.prototype` 找原型，
// 子类实例会在 FixedDate.prototype 上无限循环。这里让 new Date() 直接返回真 Date 实例。
'use strict'
const vm = require('vm')

const seed = Number(process.env.CATBUS_GOLDEN_SEED)
const now = Number(process.env.CATBUS_GOLDEN_NOW)

const patch = (seed, now) => `(() => {
  let a = ${seed} >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const D = Date
  const F = function Date(...a) {
    if (!new.target) return new D(${now}).toString()
    return new D(...(a.length ? a : [${now}]))
  }
  F.prototype = D.prototype
  F.now = () => ${now}
  F.parse = D.parse
  F.UTC = D.UTC
  globalThis.Date = F
})()`

if (Number.isFinite(seed) && Number.isFinite(now)) {
  const create = vm.createContext
  vm.createContext = function (sandbox, ...rest) {
    const ctx = create.call(this, sandbox, ...rest)
    vm.runInContext(patch(seed, now), ctx)
    return ctx
  }
}

module.exports = { patch }
