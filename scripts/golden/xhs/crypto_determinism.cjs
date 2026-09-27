// xhs 对拍专用：上游 rap.js / rap_crypto.js / sign.js（webSsk 的 x6/x7）用 crypto.randomBytes 取随机字节。
// 对拍时让它从已被 node_determinism.cjs 固定的 Math.random 取值：每字节 floor(Math.random() * 256)。
// catbus 在确定性模式下给签名 vm 的 require('crypto') 做了同样的替换（src/platforms/xhs/web/js.ts）。
'use strict'

if (process.env.CATBUS_GOLDEN_SEED) {
  const crypto = require('crypto')
  crypto.randomBytes = (n, cb) => {
    const b = Buffer.alloc(n)
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256)
    if (cb) return void cb(null, b)
    return b
  }
}
