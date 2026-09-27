import { mockSender } from '../src/core/http.js'

// 离线测试（AGENTS 7.5）：默认禁止联网，误发的真实请求直接报错。对拍用例用 replay() 临时换成回放。
mockSender((p) => {
  throw new Error(`测试里不允许联网：${p.method} ${p.url}`)
})
