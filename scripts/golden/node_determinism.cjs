// 对拍数据生成时，上游起的 node 进程通过 NODE_OPTIONS 预加载本文件：
// Math.random 换成与 src/core/rand.ts 相同的 mulberry32 序列，Date 固定在同一时刻。
// catbus 在确定性模式下给签名 vm 注入的是同样的东西（src/core/vm.ts）。
'use strict'

const seed = Number(process.env.CATBUS_GOLDEN_SEED)
const now = Number(process.env.CATBUS_GOLDEN_NOW)

if (Number.isFinite(seed) && Number.isFinite(now)) {
  let a = seed >>> 0
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [now]))
    }
    static now() {
      return now
    }
  }
  globalThis.Date = FixedDate
}
