import { constants, createHash, generateKeyPairSync, type KeyObject, privateDecrypt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { text as readStreamText } from 'node:stream/consumers'
import { CatbusError } from '../../../core/errors.js'
import { finishLogin, freshCredential, interactive, loginContext, prompt, readPassword, showQrcode } from '../../../core/login.js'
import { random, sleep } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus } from '../../../core/schemas.js'
import { openSocket } from '../../../core/stream.js'
import { BROWSER, credentialToken, DiscordClient, DiscordResponseError, type Json, object, ORIGIN, storeToken } from './client.js'
import { userRef } from './normalize.js'
import { heartbeat, packet } from './socket.js'

export function decrypt(privateKey: KeyObject, value: unknown): Buffer {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new CatbusError('UPSTREAM', 'Discord 扫码登录返回了无效密文')
  }
  try {
    return privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(value, 'base64'))
  } catch {
    throw new CatbusError('UPSTREAM', 'Discord 扫码登录密文解密失败')
  }
}

async function qrSession(ctx: HandlerContext, client: DiscordClient, signal: AbortSignal, ready: () => void): Promise<string | null> {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 })
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' })
  const fingerprint = createHash('sha256').update(publicKey).digest('base64url')
  const socket = await openSocket('wss://remote-auth-gateway.discord.gg/?v=2', {
    browser: BROWSER, os: 'macos', proxy: ctx.config.proxy ?? undefined, headers: { Origin: ORIGIN }, signal,
  })
  const send = (value: Json) => socket.send(JSON.stringify(value))
  let timer: ReturnType<typeof heartbeat> | undefined
  let displayed = false
  try {
    if (signal.aborted) return null
    await send({ op: 'init', encoded_public_key: publicKey.toString('base64') })
    for await (const raw of socket.messages) {
      if (signal.aborted) return null
      const data = packet(raw)
      if (data.op === 'hello') {
        timer?.stop()
        const interval = data.heartbeat_interval
        timer = heartbeat(socket, interval, typeof interval === 'number' ? Math.floor(interval * random()) : 0, () => send({ op: 'heartbeat' }))
      } else if (data.op === 'heartbeat_ack') {
        timer?.ack()
      } else if (data.op === 'nonce_proof') {
        await send({ op: 'nonce_proof', nonce: decrypt(keys.privateKey, data.encrypted_nonce).toString('base64url') })
      } else if (data.op === 'pending_remote_init') {
        if (data.fingerprint !== fingerprint) throw new CatbusError('UPSTREAM', 'Discord 二维码指纹校验失败')
        await showQrcode(ctx, `${ORIGIN}/ra/${fingerprint}`, '请用 Discord 手机端扫码确认登录')
        displayed = true
        ready()
      } else if (data.op === 'pending_ticket' && displayed) {
        decrypt(keys.privateKey, data.encrypted_user_payload)
        ctx.log.info('已扫码，请在 Discord 手机端确认')
      } else if (data.op === 'pending_login' && displayed && typeof data.ticket === 'string' && data.ticket) {
        const result = object(await client.request('POST', '/users/@me/remote-auth/login', { auth: false, json: { ticket: data.ticket } }))
        return decrypt(keys.privateKey, result.encrypted_token).toString('utf8')
      } else if (data.op === 'cancel') {
        return null
      }
    }
    if (signal.aborted) return null
    throw new CatbusError('NETWORK', 'Discord 扫码连接已断开')
  } finally {
    timer?.stop()
    socket.close()
  }
}

async function qrToken(ctx: HandlerContext, client: DiscordClient): Promise<string> {
  // Catbus 的扫码等待预算与 core/poll 一致。断线退避参数来自 Python Remote Auth。
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(180_000)])
  let delay = 1500
  while (!signal.aborted) {
    try {
      const token = await qrSession(ctx, client, signal, () => { delay = 1500 })
      if (token) return token
    } catch (error) {
      if (signal.aborted) break
      if (!(error instanceof CatbusError) || error.code !== 'NETWORK') throw error
      delay = Math.min(30_000, delay + 2 * delay * random())
      await sleep(delay, signal)
    }
  }
  throw new CatbusError('AUTH_REQUIRED', 'Discord 扫码登录已结束', { hint: '重新执行 catbus discord auth login' })
}

async function importedToken(ctx: HandlerContext): Promise<string> {
  if (typeof ctx.options.tokenFile === 'string') {
    try { return await readFile(ctx.options.tokenFile, 'utf8') } catch { throw new CatbusError('USAGE', '无法读取 Discord 凭证文件') }
  }
  if (ctx.options.tokenStdin) return process.stdin.isTTY ? prompt('Discord 凭证：', { hidden: true }) : readStreamText(process.stdin)
  throw new CatbusError('USAGE', '请使用 --token-file 或 --token-stdin 导入 Discord 凭证')
}

async function codeFor(ctx: HandlerContext, method: string): Promise<string> {
  const code = typeof ctx.options.code === 'string' ? ctx.options.code : interactive() ? await prompt('Discord 验证码：', { hidden: true }) : ''
  const digits = code.replace(/[^0-9]/g, '')
  if (!digits || (method === 'totp' && digits.length !== 6 && digits.length !== 8)) {
    throw new CatbusError('AUTH_REQUIRED', '需要有效的 Discord 验证码', { hint: '用 --code 提供已有验证码' })
  }
  return digits
}

export async function passwordToken(ctx: HandlerContext, client: DiscordClient, login: string, password: string): Promise<string> {
  await client.initialize()
  await client.request('GET', '/auth/location-metadata', { auth: false }).catch((error) => {
    if (!(error instanceof DiscordResponseError) && (!(error instanceof CatbusError) || error.code !== 'NETWORK')) throw error
  })
  let data = object(await client.request('POST', '/auth/login', {
    auth: false, login: true, captcha: true,
    json: { login, password, undelete: ctx.options.undelete === true, login_source: null, gift_code_sku_id: null },
  }))
  if (data.suspended_user_token != null) throw new CatbusError('AUTH_REQUIRED', 'Discord 账号处于停用状态')
  if (data.code === 70007) {
    data = object(await client.request('POST', '/auth/authorize-ip', { auth: false, json: { token: await codeFor(ctx, 'sms') } }))
  } else if (typeof data.token !== 'string' && typeof data.ticket === 'string' && data.ticket) {
    const advertised = data.allowed_methods === undefined ? (data.webauthn == null ? ['totp'] : ['webauthn']) : data.allowed_methods
    if (!Array.isArray(advertised) || !advertised.length || advertised.some((value) => typeof value !== 'string')) {
      throw new CatbusError('UPSTREAM', 'Discord 没有返回可用的 MFA 方式')
    }
    const allowed = data.webauthn != null && !advertised.includes('webauthn') ? [...advertised, 'webauthn'] : advertised
    const method = ctx.options.mfaMethod ?? (allowed.length === 1 && allowed[0] === 'webauthn' ? 'webauthn' : 'totp')
    if ((method !== 'totp' && method !== 'sms' && method !== 'webauthn') || !allowed.includes(method)) throw new CatbusError('AUTH_REQUIRED', 'Discord 未允许选择的 MFA 方式')
    let code: string
    if (method === 'webauthn') {
      const { solveWebAuthn } = await import('./webauthn.js')
      code = await solveWebAuthn(ctx, data.webauthn)
    } else {
      code = await codeFor(ctx, method)
    }
    data = object(await client.request('POST', `/auth/mfa/${method}`, {
      auth: false,
      json: { code, ticket: data.ticket, login_source: null, gift_code_sku_id: null,
        login_instance_id: typeof data.login_instance_id === 'string' ? data.login_instance_id : null },
    }))
  }
  if (typeof data.token !== 'string' || !data.token) throw new CatbusError('AUTH_REQUIRED', 'Discord 登录未返回有效凭证')
  return data.token
}

export async function authLogin(ctx: HandlerContext) {
  const method = ctx.options.method
  if (method !== 'token' && method !== 'qrcode' && method !== 'password') throw new CatbusError('USAGE', 'Discord 登录方式无效')
  const credential = freshCredential(ctx, method)
  const pending = loginContext(ctx, credential)
  const client = new DiscordClient(pending)
  let token: string
  if (method === 'token') {
    token = await importedToken(ctx)
  } else if (method === 'password') {
    const login = typeof ctx.options.username === 'string' ? ctx.options.username : interactive() ? await prompt('Discord 邮箱或用户名：') : ''
    if (!login) throw new CatbusError('USAGE', '账密登录需要 --username')
    token = await passwordToken(ctx, client, login, await readPassword(ctx))
  } else {
    await client.initialize()
    token = await qrToken(ctx, client)
  }
  storeToken(pending, token)
  client.clearFingerprint()
  const user = userRef(object(await client.request('GET', '/users/@me')))
  if (!user) throw new CatbusError('UPSTREAM', 'Discord 未返回当前用户 ID')
  return finishLogin(ctx, credential, user)
}

export async function authStatus(ctx: HandlerContext): Promise<AuthStatus> {
  const loggedOut: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  if (!credentialToken(ctx)) return loggedOut
  try {
    const user = userRef(object(await new DiscordClient(ctx).request('GET', '/users/@me')))
    return user ? { logged_in: true, user, method: ctx.credential.method, expires_at: null } : loggedOut
  } catch (error) {
    if (error instanceof CatbusError && (error.code === 'AUTH_EXPIRED' || error.code === 'AUTH_REQUIRED')) return loggedOut
    throw error
  }
}

export async function authLogout(ctx: HandlerContext) {
  await new DiscordClient(ctx).request('POST', '/auth/logout', { json: {} })
}
