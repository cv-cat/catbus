import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CatbusError } from '../../../core/errors.js'
import type { HeaderPairs } from '../../../core/http.js'
import { staticFile } from '../../../core/paths.js'
import { jsonLoads } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Json } from './client.js'
import { withVerification } from './verification.js'

const HOST = '127.0.0.1'
const MAX_BODY = 65536
const TOKEN = /^[A-Za-z0-9._~+/=-]{1,20000}$/

function captchaError(message: string): CatbusError {
  return new CatbusError('RISK_CONTROL', message, { detail: { kind: 'captcha' } })
}

function field(data: Json, key: string, limit: number): string | undefined {
  const value = data[key]
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw captchaError(`Discord 返回了无效的验证码字段 ${key}`)
  return value
}

export function captchaChallenge(data: Json) {
  const service = field(data, 'captcha_service', 64)
  const sitekey = field(data, 'captcha_sitekey', 512)
  if (service !== 'hcaptcha' || !sitekey) throw captchaError('Discord 未提供可在浏览器中完成的 hCaptcha challenge')
  return {
    service, sitekey, rqdata: field(data, 'captcha_rqdata', 8192),
    rqtoken: field(data, 'captcha_rqtoken', 8192), sessionId: field(data, 'captcha_session_id', 512),
    invisible: data.should_serve_invisible === true,
  }
}

type Challenge = ReturnType<typeof captchaChallenge>

function htmlAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function render(challenge: Challenge, prefix: string, csrf: string, nonce: string, css: string): string {
  const config = htmlAttribute(JSON.stringify({
    mode: 'official', service: challenge.service, sitekey: challenge.sitekey, rqdata: challenge.rqdata,
    serveInvisible: challenge.invisible, assetPath: `${prefix}captcha-modal.svg`, callbackPath: `${prefix}callback`,
    cancelPath: `${prefix}cancel`, csrf,
  }))
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="captcha-config" content="${config}">
<title>Catbus · Discord 人机验证</title><style nonce="${nonce}">${css}
#catbus-controls { position: fixed; z-index: 10000; bottom: 8px; left: 12px; right: 12px; }
</style></head><body><div id="root"></div><div id="catbus-controls">
<p id="status" role="status" aria-live="polite">请在官方组件中完成人机验证。</p>
<button type="button" id="cancel">取消本次验证</button></div>
<script src="${prefix}captcha-react.js" defer></script><script nonce="${nonce}">
document.getElementById('cancel').addEventListener('click', () => {
  const config = JSON.parse(document.querySelector('meta[name="captcha-config"]').content);
  fetch(config.cancelPath, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Captcha-CSRF': config.csrf }, body: '{}', credentials: 'omit' })
    .then(() => { document.getElementById('status').textContent = '已取消，可以关闭本页。'; })
    .catch(() => { document.getElementById('status').textContent = '取消失败，请回到终端按 Ctrl+C。'; });
});
</script></body></html>`
}

async function tokenBody(req: IncomingMessage): Promise<string | undefined> {
  const length = Number(req.headers['content-length'])
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_BODY) return
  const parts: Buffer[] = []
  let size = 0
  for await (const part of req) {
    size += part.length
    if (size > length || size > MAX_BODY) return
    parts.push(part)
  }
  if (size !== length) return
  try {
    const data = jsonLoads<{ token?: unknown }>(Buffer.concat(parts).toString('utf8'))
    if (data && Object.keys(data).length === 1 && typeof data.token === 'string' && TOKEN.test(data.token)) return data.token
  } catch {
    // The browser can retry after a malformed callback.
  }
}

/** 与浏览器之间的 loopback 接口；不携带登录密码、票据或服务端 rqtoken。 */
export async function serveCaptcha(challenge: Challenge, signal: AbortSignal) {
  const [css, bundle, asset] = await Promise.all([
    readFile(staticFile('discord', 'captcha-react.css'), 'utf8'),
    readFile(staticFile('discord', 'captcha-react.js')),
    readFile(staticFile('discord', 'captcha-modal.svg')),
  ])
  signal.throwIfAborted()
  const prefix = `/${randomBytes(24).toString('hex')}/`
  const csrf = randomBytes(24).toString('hex')
  const nonce = randomBytes(18).toString('base64')
  const widget = 'https://hcaptcha.com https://*.hcaptcha.com'
  const policy = `default-src 'none'; script-src 'self' 'nonce-${nonce}' ${widget}; style-src 'nonce-${nonce}' ${widget}; frame-src ${widget}; connect-src 'self' ${widget}; img-src 'self' data: ${widget}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  let origin = ''
  let settled = false
  const { promise: result, resolve, reject } = Promise.withResolvers<string>()
  void result.catch(() => {})
  const abort = () => {
    settled = true
    reject(signal.reason)
  }

  const send = (res: ServerResponse, status: number, body: string | Buffer, type = 'application/json', done?: () => void) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': policy })
    res.end(body, done)
  }
  const server = createServer((req, res) => {
    const handle = async () => {
      const path = req.url
      if (req.headers.host !== origin.slice('http://'.length)) return send(res, 403, '{}')
      if (req.method === 'GET') {
        if (path === prefix) return send(res, 200, render(challenge, prefix, csrf, nonce, css), 'text/html; charset=utf-8')
        if (path === `${prefix}captcha-react.js`) return send(res, 200, bundle, 'application/javascript')
        if (path === `${prefix}captcha-modal.svg`) return send(res, 200, asset, 'image/svg+xml')
        return send(res, 404, '{}')
      }
      if (req.method !== 'POST' || (path !== `${prefix}callback` && path !== `${prefix}cancel`)) return send(res, 404, '{}')
      if (req.headers.origin !== origin || req.headers['x-captcha-csrf'] !== csrf) return send(res, 403, '{}')
      if (settled) return send(res, 409, '{}')
      if (path === `${prefix}cancel`) {
        settled = true
        return send(res, 200, '{"state":"cancelled"}', undefined, () => reject(captchaError('Discord 人机验证已取消')))
      }
      if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return send(res, 415, '{}')
      const token = await tokenBody(req)
      if (!token) return send(res, 400, '{}')
      if (settled) return send(res, 409, '{}')
      settled = true
      send(res, 200, '{"state":"submitted"}', undefined, () => resolve(token))
    }
    void handle().catch(() => { if (!res.headersSent && !res.destroyed) send(res, 400, '{}') })
  })
  await new Promise<void>((ready, fail) => {
    server.once('error', fail)
    server.listen(0, HOST, () => { server.off('error', fail); ready() })
  })
  origin = `http://${HOST}:${(server.address() as AddressInfo).port}`
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  return { url: `${origin}${prefix}`, result, async close() {
    signal.removeEventListener('abort', abort)
    const closed = new Promise<void>((done) => server.close(() => done()))
    server.closeAllConnections()
    await closed
  } }
}

function openPage(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
  child.on('error', () => {}) // The URL in stderr also works when a default browser is unavailable.
  child.unref()
}

export async function solveCaptcha(ctx: HandlerContext, data: Json): Promise<HeaderPairs> {
  const challenge = captchaChallenge(data)
  return withVerification(ctx.signal, 180_000, (timeout) => captchaError(timeout ? 'Discord 人机验证超时' : 'Discord 人机验证已取消'), async (signal) => {
    const local = await serveCaptcha(challenge, signal)
    try {
      signal.throwIfAborted()
      process.stderr.write(`[catbus] 请在浏览器打开 ${local.url} 完成 Discord 人机验证（180 秒内）\n`)
      openPage(local.url)
      const token = await local.result
      const headers: HeaderPairs = [['X-Captcha-Key', token]]
      if (challenge.rqtoken) headers.push(['X-Captcha-Rqtoken', challenge.rqtoken])
      if (challenge.sessionId) headers.push(['X-Captcha-Session-Id', challenge.sessionId])
      return headers
    } finally {
      await local.close()
    }
  })
}
