import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CatbusError } from '../../../core/errors.js'
import { interactive } from '../../../core/login.js'
import type { HandlerContext } from '../../../core/registry.js'

/**
 * 人工过极验（上游 tools/geetest_helper.py 的 serve）：在 127.0.0.1 起一个页面，加载极验官方控件，
 * 用户在浏览器里完成验证后页面把 validate / seccode 回传过来。
 *
 * 只要有 gt 和 challenge 就能用：登录的自动识别失败时由 geetest.solve 调用；
 * 撤稿（item delete，需要 validate / seccode / challenge）等其他挡着极验的操作也可以直接调 manualGeetest。
 */

export interface ManualResult {
  challenge: string
  validate: string
  seccode: string
}

/** 上游默认端口；被占用时换一个空闲端口。 */
const PORT = 8777
/** 秒。 */
const TIMEOUT = 300

function page(gt: string, challenge: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>B站登录 - 人机验证</title>
<script src="https://static.geetest.com/static/tools/gt.js"></script>
<style>
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background:#f6f7f9;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
  .card { background:#fff; padding:32px 40px; border-radius:12px; text-align:center;
          box-shadow:0 8px 30px rgba(0,0,0,.08); min-width:360px; }
  h1 { font-size:18px; margin:0 0 6px; color:#18191c; }
  p  { font-size:13px; color:#9499a0; margin:0 0 20px; }
  #done { display:none; color:#00a1d6; font-size:15px; font-weight:600; margin-top:16px; }
</style>
</head>
<body>
<div class="card">
  <h1>完成人机验证</h1>
  <p>验证通过后本页会自动回传结果，可直接关闭</p>
  <div id="captcha"></div>
  <div id="done">验证已通过，结果已回传，可以关闭本页</div>
</div>
<script>
initGeetest({
  gt: ${JSON.stringify(gt)},
  challenge: ${JSON.stringify(challenge)},
  offline: false,
  new_captcha: true,
  product: "bind",
  https: true
}, function (captchaObj) {
  captchaObj.onReady(function () { captchaObj.verify(); });
  captchaObj.onSuccess(function () {
    var r = captchaObj.getValidate();
    window.__geetest_result = r;
    fetch("/result", { method: "POST", body: JSON.stringify(r) });
    document.getElementById("done").style.display = "block";
  });
});
</script>
</body>
</html>
`
}

export interface ManualServer {
  url: string
  /** 页面回传验证结果时兑现；超时或取消时报错。 */
  result: Promise<ManualResult>
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

/** 起本地验证页面（不检查 TTY，也不打印），返回地址和等待结果的 Promise。 */
export async function serveManual(gt: string, challenge: string, options: { port?: number; timeout?: number; signal?: AbortSignal } = {}): Promise<ManualServer> {
  const timeout = options.timeout ?? TIMEOUT
  let current: Record<string, unknown> = {}
  let settle!: { resolve: (r: ManualResult) => void; reject: (e: unknown) => void }
  const result = new Promise<ManualResult>((resolve, reject) => (settle = { resolve, reject }))
  result.catch(() => {})

  const json = (res: ServerResponse, status: number, payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload))
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Length': body.length })
    res.end(body)
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'POST') {
      let r: Record<string, unknown> = {}
      try {
        r = JSON.parse((await readBody(req)) || '{}')
      } catch {}
      const validate = typeof r.geetest_validate === 'string' ? r.geetest_validate : ''
      if (!validate) return json(res, 400, { ok: false })
      current = r
      json(res, 200, { ok: true })
      settle.resolve({
        challenge: typeof r.geetest_challenge === 'string' && r.geetest_challenge ? r.geetest_challenge : challenge,
        validate,
        seccode: typeof r.geetest_seccode === 'string' && r.geetest_seccode ? r.geetest_seccode : `${validate}|jordan`,
      })
      return
    }
    if (path === '/poll') return json(res, 200, current)
    // 每个 challenge 只能用一次，页面被缓存会报 GeetestError: old challenge
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' })
    res.end(page(gt, challenge))
  })

  let port: number
  try {
    port = await listen(server, options.port ?? PORT)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || options.port === 0) throw err
    port = await listen(server, 0)
  }

  const timer = setTimeout(
    () => settle.reject(new CatbusError('RISK_CONTROL', `人机验证超时：${timeout} 秒内没有在浏览器里完成`, { hint: '重新执行命令', detail: { kind: 'captcha' } })),
    timeout * 1000,
  )
  const onAbort = () => settle.reject(new CatbusError('RISK_CONTROL', '人机验证已取消', { detail: { kind: 'captcha' } }))
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const close = async () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return { url: `http://127.0.0.1:${port}`, result, close }
}

/**
 * 在浏览器里手动过极验。只在终端里可用（stdin 与 stderr 都是 TTY），否则报 RISK_CONTROL。
 * 地址直接写到 stderr（-q 也会显示，这一步必须由用户操作）。
 */
export async function manualGeetest(ctx: HandlerContext, gt: string, challenge: string, options: { port?: number; timeout?: number } = {}): Promise<ManualResult> {
  if (!interactive()) {
    throw new CatbusError('RISK_CONTROL', '需要在浏览器里手动完成人机验证，但当前不是交互式终端', {
      hint: '在终端里重新执行这条命令，按提示在浏览器里完成验证',
      detail: { kind: 'captcha' },
    })
  }
  const s = await serveManual(gt, challenge, { ...options, signal: ctx.signal })
  process.stderr.write(`[catbus] 请在浏览器打开 ${s.url} 完成人机验证（${options.timeout ?? TIMEOUT} 秒内），完成后自动继续\n`)
  try {
    return await s.result
  } finally {
    await s.close()
  }
}
