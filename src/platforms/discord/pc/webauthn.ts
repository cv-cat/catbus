import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { findChrome, openChromium, type Page } from '../../../core/chromium.js'
import { getConfig } from '../../../core/config.js'
import { CatbusError } from '../../../core/errors.js'
import { jsonLoads } from '../../../core/py.js'
import { sleep } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { type Json, object, ORIGIN } from './client.js'
import { untilAbort, withVerification } from './verification.js'

const RP = new URL(ORIGIN).hostname
const DOCUMENT_URL = `${ORIGIN}/robots.txt`
const DEFAULT_TIMEOUT = 120_000
const TRANSPORTS = new Set(['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'])

interface RequestOptions {
  rpId: string
  challenge: string
  timeout: number
  userVerification: 'required' | 'preferred' | 'discouraged'
  allowCredentials: { id: string; type: 'public-key'; transports: string[] }[]
}

function invalid(message: string): never {
  throw new CatbusError('UPSTREAM', message)
}

function base64url(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.length > 87384) {
    invalid(`Discord WebAuthn 的 ${field} 无效`)
  }
  const canonical = Buffer.from(value, 'base64url').toString('base64url')
  if (!canonical || canonical !== value.replace(/=+$/, '')) invalid(`Discord WebAuthn 的 ${field} 无效`)
  return canonical
}

export function requestOptions(challenge: unknown): RequestOptions {
  let data: Json
  try { data = object(typeof challenge === 'string' ? jsonLoads(challenge) : challenge) } catch { invalid('Discord WebAuthn challenge 不是有效的 JSON') }
  const key = object(data.publicKey)
  if ((key.rpId ?? object(data.rp).id) !== RP) invalid('Discord WebAuthn challenge 的 RP ID 与 Discord 域名不符')
  const list = key.allowCredentials === undefined ? [] : key.allowCredentials
  if (!Array.isArray(list) || list.length > 128) invalid('Discord WebAuthn 凭证列表无效')
  const allowCredentials = list.map((value) => {
    const item = object(value)
    if (item.type !== 'public-key') invalid('Discord WebAuthn 凭证类型无效')
    const transports = item.transports === undefined ? [] : item.transports
    if (!Array.isArray(transports) || transports.some((value) => typeof value !== 'string' || !TRANSPORTS.has(value))) {
      invalid('Discord WebAuthn 凭证传输方式无效')
    }
    return { id: base64url(item.id, 'allowCredentials.id'), type: 'public-key' as const, transports }
  })
  const userVerification = key.userVerification ?? 'preferred'
  if (userVerification !== 'required' && userVerification !== 'preferred' && userVerification !== 'discouraged') invalid('Discord WebAuthn 用户验证要求无效')
  const timeout = key.timeout ?? DEFAULT_TIMEOUT
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 3_600_000) invalid('Discord WebAuthn 等待时长无效')
  return { rpId: RP, challenge: base64url(key.challenge, 'challenge'), timeout, userVerification, allowCredentials }
}

/** 校验浏览器返回的签名范围，按原项目的字段顺序构造 MFA code。 */
export function assertionCode(value: unknown, request: RequestOptions): string {
  const data = object(value)
  const id = base64url(data.rawId, 'rawId')
  if (data.type !== 'public-key' || data.id !== id || (request.allowCredentials.length && !request.allowCredentials.some((c) => c.id === id))) {
    invalid('Discord WebAuthn 断言凭证不匹配')
  }
  const attachment = data.authenticatorAttachment ?? null
  if (attachment !== null && attachment !== 'platform' && attachment !== 'cross-platform') invalid('Discord WebAuthn 验证器类型无效')
  const response = object(data.response)
  const authenticatorData = base64url(response.authenticatorData, 'authenticatorData')
  const clientDataJSON = base64url(response.clientDataJSON, 'clientDataJSON')
  const signature = base64url(response.signature, 'signature')
  const userHandle = response.userHandle == null ? null : base64url(response.userHandle, 'userHandle')
  let clientData: Json
  try { clientData = object(jsonLoads(Buffer.from(clientDataJSON, 'base64url').toString('utf8'))) } catch { invalid('Discord WebAuthn 客户端数据无效') }
  if (clientData.type !== 'webauthn.get' || clientData.origin !== ORIGIN || ('crossOrigin' in clientData && clientData.crossOrigin !== false) ||
      base64url(clientData.challenge, 'clientDataJSON.challenge') !== request.challenge) {
    invalid('Discord WebAuthn 断言的 challenge 或来源不匹配')
  }
  const authData = Buffer.from(authenticatorData, 'base64url')
  const flags = authData[32] ?? 0
  if (authData.length < 37 || !authData.subarray(0, 32).equals(createHash('sha256').update(request.rpId).digest()) ||
      (flags & 0x63) !== 0x01 || ((flags & 0x10) && !(flags & 0x08)) || (request.userVerification === 'required' && !(flags & 4))) {
    invalid('Discord WebAuthn 断言的 RP 或验证标记无效')
  }
  return JSON.stringify({
    authenticatorAttachment: attachment, clientExtensionResults: object(data.clientExtensionResults), id, rawId: id,
    response: { authenticatorData, clientDataJSON, signature, userHandle }, type: 'public-key',
  })
}

function browserCandidates(): string[] {
  if (process.platform === 'darwin') return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  if (process.platform === 'win32') return [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].flatMap((root) =>
    root ? [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')] : [])
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge']
}

/** The browser requests user presence from the original HTTPS RP origin. */
function verificationPage(request: RequestOptions): string {
  return `(async () => {
    if (location.href !== ${JSON.stringify(DOCUMENT_URL)} || document.contentType !== 'text/plain' || self !== top || !isSecureContext) return { error: 'origin' };
    if (!window.PublicKeyCredential?.parseRequestOptionsFromJSON) return { error: 'browser' };
    const publicKey = PublicKeyCredential.parseRequestOptionsFromJSON(${JSON.stringify(request)});
    const button = document.createElement('button');
    button.textContent = '使用通行密钥或安全密钥验证';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    const text = document.createElement('p');
    text.textContent = 'Catbus 正在验证本次 Discord 登录。请点击按钮，并在系统提示中确认。';
    document.title = 'Catbus · Discord WebAuthn';
    document.body.replaceChildren(text, button, cancel);
    const controller = new AbortController();
    const b64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    return await new Promise(resolve => {
      cancel.addEventListener('click', () => { controller.abort(); resolve({ error: 'cancelled' }); });
      button.addEventListener('click', async event => {
        if (!event.isTrusted || button.disabled) return;
        button.disabled = true;
        try {
          const credential = await navigator.credentials.get({ publicKey, signal: controller.signal });
          if (!credential) return resolve({ error: 'cancelled' });
          const response = credential.response;
          resolve({ assertion: {
            authenticatorAttachment: credential.authenticatorAttachment, clientExtensionResults: credential.getClientExtensionResults(),
            id: credential.id, rawId: b64(credential.rawId), type: credential.type,
            response: { authenticatorData: b64(response.authenticatorData), clientDataJSON: b64(response.clientDataJSON),
              signature: b64(response.signature), userHandle: response.userHandle == null ? null : b64(response.userHandle) },
          } });
        } catch (error) { resolve({ error: error.name === 'NotAllowedError' || error.name === 'AbortError' ? 'cancelled' : 'failed' }); }
      });
      button.focus();
    });
  })()`
}

async function assertionFromPage(page: Page, request: RequestOptions, signal: AbortSignal): Promise<unknown> {
  const navigation = await untilAbort(page.send('Page.navigate', { url: DOCUMENT_URL }), signal)
  if (navigation.errorText || typeof navigation.frameId !== 'string') throw new CatbusError('NETWORK', 'Chromium 无法打开 Discord 的 HTTPS 验证页面')
  for (;;) {
    signal.throwIfAborted()
    const state = await untilAbort(page.evaluate('({ href: location.href, ready: !!document.body, content: document.contentType })').catch(() => null), signal)
    if (state?.href === DOCUMENT_URL && state.ready && state.content === 'text/plain') break
    if (state?.ready && state.href !== 'about:blank') invalid('Discord WebAuthn 页面被重定向或返回了非文本内容')
    await sleep(100, signal)
  }
  const world = await untilAbort(page.send('Page.createIsolatedWorld', { frameId: navigation.frameId, worldName: 'catbus-discord-webauthn' }), signal)
  if (typeof world.executionContextId !== 'number') invalid('Chromium 无法创建 Discord WebAuthn 验证上下文')
  await untilAbort(page.send('Page.bringToFront'), signal)
  const result = await untilAbort(page.send('Runtime.evaluate', {
    expression: verificationPage(request), contextId: world.executionContextId, awaitPromise: true, returnByValue: true,
  }, request.timeout), signal)
  if (result.exceptionDetails) invalid('Chromium 无法执行 Discord WebAuthn 验证')
  const data = object(result.result?.value)
  if (data.error === 'cancelled') throw new CatbusError('AUTH_REQUIRED', 'Discord WebAuthn 验证已取消或超时')
  if (data.error === 'browser') throw new CatbusError('USAGE', '该 Chromium 版本不支持 Discord WebAuthn 验证')
  if (!data.assertion) throw new CatbusError('AUTH_REQUIRED', 'Discord WebAuthn 验证未完成')
  return data.assertion
}

export async function solveWebAuthn(ctx: HandlerContext, challenge: unknown): Promise<string> {
  const request = requestOptions(challenge)
  const configured = await getConfig(['discord', 'browser'])
  const executable = findChrome({ platformId: 'discord', configured: typeof configured === 'string' ? configured : undefined, candidates: browserCandidates() })
  return withVerification(ctx.signal, request.timeout, (timeout) => new CatbusError('AUTH_REQUIRED', `Discord WebAuthn 验证${timeout ? '超时' : '已取消'}`), async (signal) => {
    const browser = await openChromium({ executable, proxy: ctx.config.proxy, log: ctx.log, headed: true })
    try {
      signal.throwIfAborted()
      process.stderr.write('[catbus] 请在打开的 Chromium 窗口点击验证，并确认系统的安全密钥或通行密钥提示\n')
      return assertionCode(await assertionFromPage(browser.page, request, signal), request)
    } finally {
      await browser.close()
    }
  })
}
