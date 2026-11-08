import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openChromium, type Page } from '../src/core/chromium.js'
import { fakeResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { passwordToken } from '../src/platforms/discord/pc/auth.js'
import { captchaChallenge, serveCaptcha, solveCaptcha } from '../src/platforms/discord/pc/captcha.js'
import { DiscordClient } from '../src/platforms/discord/pc/client.js'
import { assertionCode, requestOptions } from '../src/platforms/discord/pc/webauthn.js'
import { makeCtx } from './golden.js'
import { cli, useTempHome } from './helpers.js'

vi.mock('../src/core/chromium.js', async (load) => ({ ...await load<typeof import('../src/core/chromium.js')>(), openChromium: vi.fn() }))
vi.mock('../src/platforms/discord/pc/captcha.js', async (load) => ({ ...await load<typeof import('../src/platforms/discord/pc/captcha.js')>(), solveCaptcha: vi.fn() }))
useTempHome()

const captcha = { captcha_key: ['required'], captcha_service: 'hcaptcha', captcha_sitekey: 'synthetic-sitekey',
  captcha_rqdata: 'opaque<&>data', captcha_rqtoken: 'synthetic-rqtoken', captcha_session_id: 'synthetic-session' }
const b64 = (value: string) => Buffer.from(value).toString('base64url')
const challenge = { publicKey: { rpId: 'discord.com', challenge: b64('synthetic challenge'), userVerification: 'required',
  allowCredentials: [{ id: b64('synthetic credential'), type: 'public-key', transports: ['usb'] }] } }

function signedResponse(origin = 'https://discord.com', flags = 0x1d) {
  // UP + UV + BE + BS reflects a backed-up passkey, with a synthetic signature.
  const id = challenge.publicKey.allowCredentials[0]!.id
  return { id, rawId: id, type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {}, response: {
    authenticatorData: Buffer.concat([createHash('sha256').update('discord.com').digest(), Buffer.from([flags, 0, 0, 0, 0])]).toString('base64url'),
    clientDataJSON: b64(JSON.stringify({ type: 'webauthn.get', origin, challenge: challenge.publicKey.challenge, crossOrigin: false })),
    signature: b64('synthetic signature'), userHandle: null,
  } }
}

function passwordClient() {
  const ctx = makeCtx({ platform: 'discord', options: { captcha: true } })
  return { ctx, client: new DiscordClient(ctx) }
}

function webAuthnBrowser(value: unknown = { assertion: signedResponse() }) {
  const send = vi.fn(async (method: string) => {
    if (method === 'Page.navigate') return { frameId: 'verified-frame' }
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 42 }
    if (method === 'Runtime.evaluate') return { result: { value } }
    return {}
  })
  const page: Page = { send, evaluate: vi.fn(async () => ({ href: 'https://discord.com/robots.txt', ready: true, content: 'text/plain' })) }
  const close = vi.fn(async () => {})
  vi.mocked(openChromium).mockResolvedValueOnce({ page, close })
  return { send, close }
}

async function withConfiguredBrowser<T>(run: () => Promise<T>): Promise<T> {
  const value = process.env.CATBUS_DISCORD_BROWSER
  process.env.CATBUS_DISCORD_BROWSER = process.execPath
  try { return await run() } finally {
    if (value === undefined) delete process.env.CATBUS_DISCORD_BROWSER
    else process.env.CATBUS_DISCORD_BROWSER = value
  }
}

async function withCaptchaPage(run: (local: Awaited<ReturnType<typeof serveCaptcha>>, csrf: string) => Promise<void>) {
  const controller = new AbortController()
  const local = await serveCaptcha(captchaChallenge(captcha), controller.signal)
  try {
    const response = await fetch(local.url)
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors')
    const html = await response.text()
    expect(html).not.toContain(captcha.captcha_rqtoken)
    expect(html).not.toContain(captcha.captcha_session_id)
    expect(html).toContain('opaque&lt;&amp;&gt;data')
    const meta = /name="captcha-config" content="([^"]+)"/.exec(html)![1]!
    const config = JSON.parse(meta.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'))
    await run(local, config.csrf)
  } finally {
    controller.abort(new Error('test finished'))
    await local.close()
  }
}

function callback(url: string, csrf: string, token = 'synthetic-solved-token', origin = new URL(url).origin) {
  return fetch(new URL('callback', url), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Captcha-CSRF': csrf },
    body: JSON.stringify({ token }) })
}

describe('Discord 人工验证码本地页面', () => {
  it('绑定本机源与 CSRF，接受一次合法结果，响应不回显 token', async () => {
    await withCaptchaPage(async (local, csrf) => {
      expect((await callback(local.url, csrf, 'synthetic-token', 'https://other.invalid')).status).toBe(403)
      expect((await callback(local.url, 'wrong')).status).toBe(403)
      expect((await callback(local.url, csrf, 'not valid')).status).toBe(400)
      const [one, two] = await Promise.all([callback(local.url, csrf), callback(local.url, csrf)])
      expect([one.status, two.status].sort()).toEqual([200, 409])
      expect(await (one.ok ? one : two).text()).toBe('{"state":"submitted"}')
      await expect(local.result).resolves.toBe('synthetic-solved-token')
    })
  })

  it('浏览器取消后阻止进一步提交', async () => {
    await withCaptchaPage(async (local, csrf) => {
      const cancelled = expect(local.result).rejects.toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
      expect((await fetch(new URL('cancel', local.url), { method: 'POST', headers: { Origin: new URL(local.url).origin, 'X-Captcha-CSRF': csrf } })).status).toBe(200)
      await cancelled
      expect((await callback(local.url, csrf)).status).toBe(409)
    })
  })
})

describe('Discord 登录验证', () => {
  it('同一份密码请求先完成人工验证，随后把浏览器断言作为 WebAuthn code 提交', async () => {
    const browser = webAuthnBrowser()
    vi.mocked(solveCaptcha).mockResolvedValueOnce([['X-Captcha-Key', 'synthetic-key'], ['X-Captcha-Rqtoken', captcha.captcha_rqtoken], ['X-Captcha-Session-Id', captcha.captcha_session_id]])
    const requests: PreparedRequest[] = []
    const restore = mockSender((request) => {
      requests.push(request)
      if (request.url.endsWith('/auth/login')) {
        return request.headers.some(([name]) => name === 'X-Captcha-Key')
          ? fakeResponse({ ticket: 'synthetic-ticket', allowed_methods: ['webauthn'], webauthn: JSON.stringify(challenge), login_instance_id: 'synthetic-instance' })
          : fakeResponse({ ...captcha, ticket: 'challenge-is-not-mfa' }, { status: 400 })
      }
      if (request.url.endsWith('/auth/mfa/webauthn')) return fakeResponse({ token: 'synthetic-token' })
      return fakeResponse({})
    })
    try {
      const { ctx, client } = passwordClient()
      await expect(withConfiguredBrowser(() => passwordToken(ctx, client, 'example@example.test', 'synthetic-password'))).resolves.toBe('synthetic-token')
      const logins = requests.filter((request) => request.url.endsWith('/auth/login'))
      expect(logins).toHaveLength(2)
      expect(logins[0]?.body).toBe(logins[1]?.body)
      expect(logins[0]?.headers).not.toContainEqual(['X-Captcha-Key', 'synthetic-key'])
      expect(logins[1]?.headers).toContainEqual(['X-Captcha-Rqtoken', captcha.captcha_rqtoken])
      const mfa = requests.at(-1)!
      const body = JSON.parse(String(mfa.body))
      expect(mfa.url).toBe('https://discord.com/api/v9/auth/mfa/webauthn')
      expect(mfa.headers.some(([name]) => name.startsWith('X-Captcha-'))).toBe(false)
      expect(body).toMatchObject({ ticket: 'synthetic-ticket', login_instance_id: 'synthetic-instance' })
      expect(JSON.parse(body.code)).toEqual(signedResponse())
      const evaluate = browser.send.mock.calls.find(([method]) => method === 'Runtime.evaluate') as unknown as [string, { expression: string; contextId: number }]
      expect(evaluate[1].contextId).toBe(42)
      expect(evaluate[1].expression).toContain('navigator.credentials.get')
      expect(evaluate[1].expression).not.toMatch(/synthetic-password|synthetic-ticket|synthetic-rqtoken/)
      expect(browser.close).toHaveBeenCalledOnce()
    } finally { restore() }
  })

  it('重复挑战只允许两次人工提交，各自使用新的 rqtoken', async () => {
    vi.mocked(solveCaptcha).mockClear()
    vi.mocked(solveCaptcha).mockImplementation(async (_ctx, data) => [['X-Captcha-Key', 'key-' + data.captcha_rqtoken], ['X-Captcha-Rqtoken', String(data.captcha_rqtoken)]])
    const requests: PreparedRequest[] = []
    const restore = mockSender((request) => {
      if (!request.url.endsWith('/auth/login')) return fakeResponse({})
      requests.push(request)
      return fakeResponse({ ...captcha, captcha_rqtoken: `challenge-${requests.length}` }, { status: 400 })
    })
    try {
      const { ctx, client } = passwordClient()
      await expect(passwordToken(ctx, client, 'synthetic-login', 'synthetic-password')).rejects.toMatchObject({ code: 'RISK_CONTROL' })
      expect(solveCaptcha).toHaveBeenCalledTimes(2)
      expect(requests).toHaveLength(3)
      expect(requests[1]?.headers).toContainEqual(['X-Captcha-Rqtoken', 'challenge-1'])
      expect(requests[2]?.headers).toContainEqual(['X-Captcha-Rqtoken', 'challenge-2'])
    } finally { restore() }
  })

  it('WebAuthn 页面取消时关闭浏览器且不发送 MFA 请求', async () => {
    const browser = webAuthnBrowser({ error: 'cancelled' })
    const requests: string[] = []
    const restore = mockSender((request) => {
      requests.push(request.url)
      return fakeResponse(request.url.endsWith('/auth/login') ? { ticket: 'synthetic-ticket', allowed_methods: ['webauthn'], webauthn: challenge } : {})
    })
    try {
      const { ctx, client } = passwordClient()
      await expect(withConfiguredBrowser(() => passwordToken(ctx, client, 'example', 'synthetic-password'))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
      expect(requests.some((url) => url.includes('/auth/mfa/'))).toBe(false)
      expect(browser.close).toHaveBeenCalledOnce()
    } finally { restore() }
  })

  it('拒绝其他 RP、其他来源、不同 challenge 和缺少 UV 的断言', () => {
    const options = requestOptions(challenge)
    expect(() => requestOptions({ publicKey: { ...challenge.publicKey, rpId: 'other.invalid' } })).toThrow(/RP ID/)
    expect(() => assertionCode(signedResponse('https://other.invalid'), options)).toThrow(/来源/)
    expect(() => assertionCode(signedResponse(), { ...options, challenge: b64('different') })).toThrow(/challenge/)
    expect(() => assertionCode(signedResponse('https://discord.com', 1), options)).toThrow(/标记/)
  })

  it('使用 Catbus 配置存取 Discord 浏览器路径', async () => {
    const set = await cli('config', 'set', 'discord.browser', process.execPath)
    expect(set.code).toBe(0)
    expect((await cli('config', 'get', 'discord.browser')).env.data).toBe(process.execPath)
  })
})
