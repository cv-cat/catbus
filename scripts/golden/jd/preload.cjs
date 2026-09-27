// jd 对拍：上游起的 node 进程（h5st5_server / pc_tk_server / summer_cryptico_runner / webm run.js）预加载本文件，
// 在 scripts/golden/node_determinism.cjs 之后运行：
//   - navigator 改成可写：h5st5_env.js 的 `navigator = window.navigator` 在 Node 21+ 上会静默失败，
//     指纹里的 hardwareConcurrency 于是泄漏成本机 CPU 数；catbus 按画像的 32 走，这里让上游也生效。
//   - crypto.getRandomValues 与 jsdom window realm 的 Math.random / Date / crypto 固定下来（catbus 确定性模式同款）。
//   - https.request 不发网络：cactus 的 request_algo、jra 的 jsTk.do 回假数据，请求与响应记到 CATBUS_JD_NODE_LOG，
//     由 gen.py 按顺序并进用例。
'use strict'

const fs = require('fs')
const Module = require('module')
const { EventEmitter } = require('events')

const seed = Number(process.env.CATBUS_GOLDEN_SEED)
const now = Number(process.env.CATBUS_GOLDEN_NOW)
const LOG = process.env.CATBUS_JD_NODE_LOG

function mulberry32(s) {
  let a = s >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fillRandom(array, random) {
  const span = 2 ** (8 * array.BYTES_PER_ELEMENT)
  for (let i = 0; i < array.length; i++) array[i] = Math.floor(random() * span)
  return array
}

Object.defineProperty(globalThis, 'navigator', { value: globalThis.navigator, writable: true, configurable: true, enumerable: true })
try {
  globalThis.crypto.getRandomValues = (a) => fillRandom(a, () => Math.random())
} catch (e) {}

// jsdom window realm 的确定性（与 src/platforms/jd/web/webm.ts 的 patchRealm 相同）
const REALM_JS = `(() => {
  let a = __catbus_seed >>> 0
  Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const D = Date
  globalThis.Date = class extends D { constructor(...x) { super(...(x.length ? x : [__catbus_now])) } static now() { return __catbus_now } }
  try { const fill = (arr) => { const span = 2 ** (8 * arr.BYTES_PER_ELEMENT); for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * span); return arr }; Object.defineProperty(crypto, 'getRandomValues', { value: fill, configurable: true, writable: true }) } catch (e) {}
  try { const t0 = __catbus_now; Object.defineProperty(performance, 'now', { value: () => 0, configurable: true, writable: true }); Object.defineProperty(performance, 'timeOrigin', { value: t0, configurable: true }) } catch (e) {}
})()`

const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  const exported = origLoad.apply(this, arguments)
  if (request === 'jsdom' && exported && exported.JSDOM && !exported.__catbusWrapped) {
    const Base = exported.JSDOM
    class JSDOM extends Base {
      constructor(...args) {
        super(...args)
        try {
          const ctx = this.getInternalVMContext()
          ctx.__catbus_seed = seed
          ctx.__catbus_now = now
          require('vm').runInContext(REALM_JS, ctx)
        } catch (e) {}
      }
    }
    return Object.assign(Object.create(exported), { JSDOM, __catbusWrapped: true })
  }
  return exported
}

const FAKE_TK = 'tk03wcafe000018nFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAK'
const FAKE_EID = 'FAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEIDFAKEEI'

function fakeResponse(host, body) {
  if (host === 'cactus.jd.com') {
    const fp = JSON.parse(body).fp
    return {
      status: 200,
      message: '',
      data: {
        version: '5.3',
        result: {
          tk: FAKE_TK,
          fp,
          algo: "function test(tk,fp,ts,ai,algo){var rd='FAKErdFAKErd';var str=\"\".concat(tk).concat(fp).concat(ts).concat(ai).concat(rd);return algo.SHA256(str);}",
        },
        rConfig: {},
        ts: now,
      },
    }
  }
  if (host === 'jra.jd.com') {
    return { code: 0, msg: '成功', data: { token: `jdd03${FAKE_EID}AAAAAFAKEFAKEFAKEAAAAAAFAKEFAKEFAKEFAKX`, eid: FAKE_EID, gia_d: 1, deMap: null, ds: 120 } }
  }
  return {}
}

require('https').request = function (options, callback) {
  const req = new EventEmitter()
  const chunks = []
  req.write = (d) => chunks.push(Buffer.from(d))
  req.end = () => {
    const body = Buffer.concat(chunks).toString('utf8')
    const url = `https://${options.hostname}${options.path}`
    const resp = JSON.stringify(fakeResponse(options.hostname, body))
    const headers = { 'content-type': 'application/json' }
    if (LOG) fs.appendFileSync(LOG, JSON.stringify({ method: options.method || 'GET', url, headers: options.headers || {}, body, status: 200, respHeaders: headers, resp }) + '\n')
    setImmediate(() => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.headers = headers
      callback(res)
      res.emit('data', Buffer.from(resp))
      res.emit('end')
    })
  }
  return req
}

