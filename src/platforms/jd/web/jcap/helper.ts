import { readFileSync } from 'node:fs'
import { disableEnvProxy, HttpClient } from '../../../../core/http.js'
import { BROWSER } from '../profile.js'
import { imdecode } from './image.js'
import { type Solution, solveClick, solveRotation, solveSlider, solveTrace } from './solver.js'

/**
 * JCAP 运行时的子进程入口（由 host.js 代替上游的 Python 脚本）：
 *   `helper.js bridge`：上游 static/jcap/env/http_bridge.py，stdin 一个请求，stdout 一个响应（JSON）。
 *   `helper.js solve --tp N ...`：上游 static/jcap/run/captcha_solver.py，stdin 图片字节，stdout 解（JSON）。
 */

async function bridge(): Promise<string> {
  disableEnvProxy()
  const req = JSON.parse(readFileSync(0, 'utf8'))
  const method = String(req.method || 'GET').toUpperCase()
  const http = new HttpClient({ browser: BROWSER, os: 'windows', proxy: process.env.CATBUS_JD_PROXY || null, timeout: 20 })
  const headers = Object.entries((req.headers ?? {}) as Record<string, string>).map(([k, v]) => [k, String(v)] as [string, string])
  const res = await http.request({ method, url: String(req.url), headers, body: method === 'GET' ? undefined : String(req.body ?? '') })
  const raw = new Uint8Array(await res.arrayBuffer())
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    body = new TextDecoder('gb18030').decode(raw)
  }
  const pairs: [string, string][] = []
  ;(res.headers as unknown as globalThis.Headers).forEach((v, k) => {
    if (k !== 'set-cookie') pairs.push([k, v])
  })
  const setCookies = res.headers.getSetCookie()
  for (const c of setCookies) pairs.push(['set-cookie', c])
  return JSON.stringify({ status: res.status, statusText: '', url: res.url || String(req.url), headers: pairs, setCookies, body })
}

function options(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]!
    if (!k.startsWith('--') || i + 1 >= argv.length) throw new Error('invalid solver arguments')
    out[k.slice(2)] = argv[i + 1]!
  }
  if (!('tp' in out)) throw new Error('missing challenge type')
  return out
}

async function solve(argv: string[]): Promise<string> {
  const o = options(argv)
  const tp = Number.parseInt(o.tp!, 10)
  const image = imdecode(readFileSync(0), 'color')
  if (!image) throw new Error('invalid challenge image')
  let solution: Solution
  if (tp === 2 || tp === 3) {
    const model = o.model
    if (!model) throw new Error('missing saliency model')
    if (tp === 2) {
      const tip = imdecode(Buffer.from(o['tip-base64'] ?? '', 'base64'), 'color')
      if (!tip) throw new Error('invalid tip image')
      solution = await solveClick(image, tip, model)
    } else solution = await solveTrace(image, model)
  } else if (tp === 26) {
    const model = o['orientation-model']
    if (!model) throw new Error('missing orientation model')
    solution = await solveRotation(image, model)
  } else if (tp === 30) {
    const slot = imdecode(Buffer.from(o['slot-base64'] ?? '', 'base64'), 'unchanged')
    if (!slot) throw new Error('invalid slot image')
    solution = await solveSlider(image, slot)
  } else throw new Error(`unsupported challenge type: ${tp}`)
  return JSON.stringify(solution) + '\n'
}

const [mode, ...rest] = process.argv.slice(2)
const run = mode === 'bridge' ? bridge() : mode === 'solve' ? solve(rest) : Promise.reject(new Error(`unknown mode ${mode}`))
// 管道写在 POSIX 上是异步的：写完再退出
run.then(
  (out) => process.stdout.write(out, () => process.exit(0)),
  (err) => {
    process.stderr.write(String(err?.message ?? err) + '\n')
    process.exit(1)
  },
)
