import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { CatbusError } from '../../../core/errors.js'
import { interactive } from '../../../core/login.js'
import type { Douyin } from './client.js'

/**
 * 2046 二次验证（浏览器内 MFA）。
 *
 * 真机实录（2026-11-03）：扫码后 check_qrconnect 返回 error_code=2046，
 * data.url 指向 auth.zijieapi.com 的 second_verification_web 组件 **脚本**（UMD，不是页面）。
 * 真实登录页把脚本加载进 www.douyin.com 后调用 window.ucWebSecondVerify(options) 渲染
 * 短信 / 密码 / 人脸验证弹窗；弹窗的业务请求（/passport/web/send_code/ 等）打向页面同域，
 * cookie 用用户浏览器里与登录会话同源的 passport_csrf_token 等。
 *
 * login.douyin.com 的 CORS 只放行 https://www.douyin.com（实测），本地壳页无法直连
 * passport 接口。所以这里在 127.0.0.1 起一个页面 + 转发器：
 *   - 页面加载官方脚本，以 check_qrconnect 返回的 data 作为 options 调 ucWebSecondVerify；
 *   - 组件的 API 请求由页面 fetch 到本服务 /proxy，转发器用 catbus 的 cookie 罐、
 *     passport 头序与公共 query（sdkParams）原样代发 login.douyin.com；
 *   - verifyFinishCallback 触发时回传本服务，catbus 继续轮询同一个二维码 token，
 *     风控放行后轮询读到 confirmed 自动登录。
 */

/** 秒。 */
const TIMEOUT = 300

const VERIFY_URL_KEY = 'url'

interface VerifyDecision {
  url?: string
  verify_url?: string
  [k: string]: unknown
}

function page(scriptUrl: string, origin: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>抖音登录 - 安全验证</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f6f7f9;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { background:#fff; padding:28px 36px; border-radius:12px; text-align:center;
          box-shadow:0 8px 30px rgba(0,0,0,.08); min-width:360px; }
  h1 { font-size:18px; margin:0 0 6px; color:#18191c; }
  p  { font-size:13px; color:#9499a0; margin:0 0 18px; }
  #done { display:none; color:#fe2c55; font-size:15px; font-weight:600; margin-top:16px; }
  #err { color:#d9534f; font-size:13px; margin-top:12px; word-break:break-all; }
</style>
</head>
<body>
<div class="card">
  <h1>完成安全验证</h1>
  <p>选择一种方式（短信 / 密码 / 人脸）完成验证，通过后本页会自动通知终端继续登录</p>
  <div id="uc-second-verify"></div>
  <div id="done">验证已通过，回到终端即可继续；本页可以关闭</div>
  <div id="err"></div>
</div>
<script>
(function () {
  var SCRIPT_URL = ${JSON.stringify(scriptUrl)};
  var ORIGIN = ${JSON.stringify(origin)};
  function proxy(path, body) {
    return fetch(ORIGIN + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, body: body || null })
    }).then(function (r) { return r.json(); });
  }
  fetch(ORIGIN + '/decision').then(function (r) { return r.json(); }).then(function (decision) {
    var s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.onload = function () {
      var call = window.ucWebSecondVerify;
      if (!call) {
        document.getElementById('err').textContent = '验证组件加载失败（window.ucWebSecondVerify 不存在）';
        return;
      }
      // options：真实登录页把 verifyDecision 的 data（含 verify_ways、verify_ticket、
      // event_params…）合并进去再传给组件；业务请求经本页代理到 catbus。
      var options = Object.assign({}, decision, {
        aid: 6383,
        verifyFinishCallback: function (r) {
          fetch(ORIGIN + '/result', { method: 'POST', body: JSON.stringify(r || {}) });
          if (r && r.status) document.getElementById('done').style.display = 'block';
          else document.getElementById('err').textContent = '验证未通过：' + JSON.stringify(r);
        },
        // 组件内部把请求发往 baseURL（空则 location.hostname）。给出本服务地址即走代理。
        host: ORIGIN,
        newSecondVerifyRequestHost: ORIGIN,
        requestHost: ORIGIN,
        // 劫持组件的传输层：所有 /passport/... 请求转给 catbus 转发器
        getGeneralParams: function () { return Promise.resolve({}); },
        generalParams: { baseURL: ORIGIN }
      });
      // 组件 axios baseURL 兜底是 location.hostname（127.0.0.1），恰好就是本服务；
      // 只要请求都发到 http://127.0.0.1:<port>/passport/...，转发器按 path 转发。
      try { call(options); }
      catch (e) { document.getElementById('err').textContent = String(e); }
    };
    s.onerror = function () {
      document.getElementById('err').textContent = '验证组件脚本加载失败：' + SCRIPT_URL;
    };
    document.head.appendChild(s);
  });
})();
</script>
</body>
</html>
`
}

export interface ManualVerifyServer {
  url: string
  /** 用户完成（或放弃/超时）时兑现：status 为组件 verifyFinishCallback 的返回。 */
  result: Promise<{ status: boolean; raw: unknown }>
  close(): Promise<void>
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 在浏览器里打开 URL（macOS / Linux / Windows）。 */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {}
}

/**
 * 起本地二次验证页面。proxy: 把页面 /proxy 的 {path, body} 用 catbus 会话代发 login.douyin.com。
 * decision 是 check_qrconnect 2046 响应的 data（含 url、verify_ways 等）。
 */
export async function serveSecondVerify(
  d: Douyin,
  decision: VerifyDecision,
  options: { port?: number; timeout?: number; signal?: AbortSignal; open?: boolean } = {},
): Promise<ManualVerifyServer> {
  const timeout = options.timeout ?? TIMEOUT
  const scriptUrl = String(decision[VERIFY_URL_KEY] ?? decision.verify_url ?? '')
  if (!scriptUrl) throw new CatbusError('RISK_CONTROL', '2046 响应里没有验证脚本地址', { detail: { kind: 'captcha' } })
  let settle!: { resolve: (r: { status: boolean; raw: unknown }) => void; reject: (e: unknown) => void }
  const result = new Promise<{ status: boolean; raw: unknown }>((resolve, reject) => (settle = { resolve, reject }))
  result.catch(() => {})

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status: number, payload: unknown) => {
      const body = Buffer.from(JSON.stringify(payload))
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': body.length })
      res.end(body)
    }
    try {
      if (u.pathname === '/decision') return json(200, decision)
      if (u.pathname === '/result') {
        const raw: unknown = JSON.parse((await readBody(req)) || '{}') as unknown
        const ok = Boolean((raw as { status?: boolean }).status)
        json(200, { ok })
        settle.resolve({ status: ok, raw })
        return
      }
      if (u.pathname === '/proxy' && req.method === 'POST') {
        const reqBody = (JSON.parse((await readBody(req)) || '{}') ?? {}) as { path?: string; body?: unknown }
        const path = String(reqBody.path ?? '')
        const out = await d.request({
          method: 'POST',
          url: `https://login.douyin.com${path}`,
          form: typeof reqBody.body === 'string' ? ([...new URLSearchParams(reqBody.body).entries()] as [string, string][]) : undefined,
          json: typeof reqBody.body === 'string' ? undefined : reqBody.body,
          timeout: 20,
        })
        const text = await out.text()
        res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(text)
        return
      }
      // 组件 axios 的 baseURL 兜底是 location.hostname（=本服务），所以业务请求直接
      // POST 到 http://127.0.0.1:<port>/passport/...；按 path 转发到 login.douyin.com。
      if ((u.pathname.startsWith('/passport/web/') || u.pathname.startsWith('/passport/safe/')) && req.method === 'POST') {
        // 组件发 urlencoded 表单；query 里带公共参数
        const raw = await readBody(req)
        const form: [string, string][] = [...new URLSearchParams(raw).entries()] as [string, string][]
        const query = [...u.searchParams.entries()] as [string, string][]
        const out = await d.request({
          method: 'POST',
          url: `https://login.douyin.com${u.pathname}`,
          query,
          form,
          timeout: 20,
        })
        const text = await out.text()
        res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(text)
        return
      }
      if (u.pathname.startsWith('/passport/safe/') && req.method === 'GET') {
        const out = await d.request({
          method: 'GET',
          url: `https://login.douyin.com${u.pathname}`,
          query: [...u.searchParams.entries()] as [string, string][],
          timeout: 20,
        })
        const text = await out.text()
        res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(text)
        return
      }
      // 其余一律是壳页
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' })
      res.end(page(scriptUrl, u.origin))
    } catch (err) {
      json(502, { error: String((err as Error)?.message ?? err) })
    }
  })

  let port: number
  try {
    port = await listen(server, options.port ?? 0)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || options.port === 0) throw err
    port = await listen(server, 0)
  }
  const url = `http://127.0.0.1:${port}`

  const timer = setTimeout(
    () => settle.reject(new CatbusError('RISK_CONTROL', `二次验证超时：${timeout} 秒内没有在浏览器里完成`, { hint: '重新执行 catbus douyin auth login', detail: { kind: 'captcha' } })),
    timeout * 1000,
  )
  const onAbort = () => settle.reject(new CatbusError('RISK_CONTROL', '二次验证已取消', { detail: { kind: 'captcha' } }))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const close = async () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  // 只在交互式终端自动打开浏览器；非交互（Agent / 脚本）一律不弹，URL 由调用方写到
  // stderr 与 cache 文件，谁消费由使用者决定（对齐二维码 PNG 落盘的模式）。
  if (options.open === true || (options.open === undefined && interactive())) openBrowser(url)
  return { url, result, close }
}
