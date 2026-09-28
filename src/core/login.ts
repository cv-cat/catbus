import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { text as readStreamText } from 'node:stream/consumers'
import { setTimeout as sleep } from 'node:timers/promises'
import QRCode from 'qrcode'
import { endpointFlag, getCurrent, newCredential, readCredential, setCurrent, toAccount, writeCredential } from './auth-store.js'
import { parseCookieInput } from './cookies.js'
import { CatbusError } from './errors.js'
import { writeFileAtomic } from './fsutil.js'
import { cacheDir } from './paths.js'
import { now } from './rand.js'
import type { HandlerContext } from './registry.js'
import type { Account, Credential, UserRef } from './schemas.js'

/** 登录流程的公共部分（AGENTS 5.3）。各平台的 `auth login` handler 调用这些函数。 */

/** 登录到哪个账号：`-a` > 当前账号 > `default`。 */
export function loginTarget(ctx: HandlerContext): string {
  return ctx.account ?? 'default'
}

/** 登录方式对应的新凭证（还没落盘）。 */
export function freshCredential(ctx: HandlerContext, method: Credential['method']): Credential {
  return newCredential({ platform: ctx.platform.id, endpoint: ctx.endpoint, account: loginTarget(ctx), method })
}

/**
 * 登录成功后落盘：账号名下已经存了另一个用户时报 USAGE，新凭证不保存；
 * 还没有当前账号时，把它设为当前账号。
 */
export async function finishLogin(ctx: HandlerContext, credential: Credential, user: UserRef): Promise<Account> {
  const p = ctx.platform.id
  const account = loginTarget(ctx)
  const existing = await readCredential(p, ctx.endpoint, account).catch(() => null)
  if (existing?.user && existing.user.id !== user.id) {
    throw new CatbusError('USAGE', `账号名 ${account} 下已经保存了另一个用户（${existing.user.name ?? existing.user.id}）`, {
      hint: `用 -a <新名字> 登录，或者先 catbus ${p} auth logout -a ${account}${endpointFlag(ctx.endpoint)}`,
    })
  }
  credential.account = account
  credential.user = user
  if (existing) credential.created_at = existing.created_at
  await writeCredential(credential)
  let current = await getCurrent(p, ctx.endpoint)
  if (!current) {
    await setCurrent(p, ctx.endpoint, account)
    current = account
  }
  ctx.log.info(`已登录 ${ctx.platform.name}：${user.name ?? user.id}（账号 ${account}）`)
  return toAccount(credential, current === account)
}

/** `--cookie <str|@file|->`：dispatch 已经把 @file 和 - 读成字符串。 */
export function cookieCredential(ctx: HandlerContext, defaultDomain: string): Credential {
  const input = ctx.options.cookie as string | undefined
  if (!input?.trim()) {
    throw new CatbusError('USAGE', 'cookie 登录需要 --cookie', { hint: `catbus ${ctx.platform.id} auth login --method cookie --cookie "<cookie>"` })
  }
  const credential = freshCredential(ctx, 'cookie')
  try {
    credential.scopes.main!.cookies = parseCookieInput(input, defaultDomain)
  } catch {
    throw new CatbusError('USAGE', '无法解析 --cookie 的内容', { hint: '传浏览器请求头里的 Cookie 字符串，或导出的 cookie JSON 数组' })
  }
  if (!credential.scopes.main!.cookies.length) throw new CatbusError('USAGE', '--cookie 里没有 cookie')
  return credential
}

/** 二维码：画到 stderr，同时把 PNG 存到 cache/<p>/qrcode.png。 */
export async function showQrcode(ctx: HandlerContext, content: string, hint = '请用 App 扫码'): Promise<string> {
  const png = join(cacheDir(ctx.platform.id), 'qrcode.png')
  await writeFileAtomic(png, await QRCode.toBuffer(content, { margin: 2, scale: 8 }))
  const art = await QRCode.toString(content, { type: 'terminal', small: true })
  process.stderr.write(art + '\n')
  ctx.log.info(`${hint}。二维码图片：${png}`)
  return png
}

/** 轮询时最多容忍的连续网络错误次数（含最后一次）。 */
const POLL_NETWORK_RETRIES = 4

/** 按间隔轮询，直到返回非 undefined 的值；超时报 AUTH_REQUIRED。 */
export async function poll<T>(fn: () => Promise<T | undefined>, options: { interval?: number; timeout?: number; what?: string } = {}): Promise<T> {
  const deadline = now() + (options.timeout ?? 180_000)
  // 扫码要等几分钟，期间偶发的网络错误（连接被重置、本机地址暂不可用等）不该让整个登录失败；连续失败才放弃
  let networkErrors = 0
  for (;;) {
    let result: T | undefined
    try {
      result = await fn()
      networkErrors = 0
    } catch (err) {
      if (!(err instanceof CatbusError && err.code === 'NETWORK') || ++networkErrors >= POLL_NETWORK_RETRIES) throw err
      process.stderr.write(`[catbus] 警告：轮询时网络出错，稍后重试（${networkErrors}/${POLL_NETWORK_RETRIES - 1}）：${err.message}\n`)
    }
    if (result !== undefined) return result
    if (now() >= deadline) throw new CatbusError('AUTH_REQUIRED', `${options.what ?? '登录'}超时`, { hint: '重新执行登录命令' })
    await sleep(options.interval ?? 2000)
  }
}

/** 是否可以交互输入（stdin 与 stderr 都是 TTY）。 */
export function interactive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY)
}

/** 在 stderr 上提问，读一行。hidden 时不回显（密码）。 */
export async function prompt(question: string, options: { hidden?: boolean } = {}): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  if (options.hidden) {
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput
    ;(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, s)
    }
  }
  try {
    return await new Promise<string>((resolve) => rl.question(question, resolve))
  } finally {
    if (options.hidden) process.stderr.write('\n')
    rl.close()
  }
}

/** `--password-stdin`：TTY 下隐藏输入，否则读完整个 stdin。 */
export async function readPassword(ctx: HandlerContext): Promise<string> {
  if (!ctx.options.passwordStdin) {
    throw new CatbusError('USAGE', '密码只从 stdin 读取，请加 --password-stdin', {
      hint: `catbus ${ctx.platform.id} auth login --method password --username <name> --password-stdin`,
    })
  }
  const password = process.stdin.isTTY ? await prompt('密码：', { hidden: true }) : (await readStreamText(process.stdin)).replace(/\r?\n$/, '')
  if (!password) throw new CatbusError('USAGE', '密码为空')
  return password
}

const SMS_TTL = 10 * 60 * 1000

function smsFile(ctx: HandlerContext): string {
  return join(cacheDir(ctx.platform.id), `sms-${ctx.endpoint}-${loginTarget(ctx)}.json`)
}

/** 短信登录的中间态（非 TTY 分两步时用），10 分钟有效。 */
export const smsState = {
  async save(ctx: HandlerContext, data: Record<string, unknown>): Promise<void> {
    await writeFileAtomic(smsFile(ctx), JSON.stringify({ saved_at: now(), data }))
  },
  async load<T = Record<string, unknown>>(ctx: HandlerContext): Promise<T | null> {
    try {
      const { saved_at, data } = JSON.parse(await readFile(smsFile(ctx), 'utf8'))
      return now() - saved_at < SMS_TTL ? (data as T) : null
    } catch {
      return null
    }
  },
  async clear(ctx: HandlerContext): Promise<void> {
    await rm(smsFile(ctx), { force: true })
  },
}

/**
 * 短信登录的通用流程。平台提供 send（发验证码，返回需要保存的中间态）和 verify（用验证码完成登录）。
 * TTY 下一步完成；非 TTY 下先 `--phone` 发码，再单独用 `--code` 完成。
 */
export async function smsLogin<S extends Record<string, unknown>>(
  ctx: HandlerContext,
  flow: { send(phone: string): Promise<S>; verify(state: S, code: string): Promise<Account> },
): Promise<Account | { sent: true; phone: string }> {
  const phone = ctx.options.phone as string | undefined
  const code = ctx.options.code as string | undefined
  const p = ctx.platform.id
  const cmd = `catbus ${p} auth login --method sms${ctx.account ? ` -a ${ctx.account}` : ''}${endpointFlag(ctx.endpoint)}`
  if (code) {
    const state = await smsState.load<S>(ctx)
    if (!state) throw new CatbusError('USAGE', '没有找到有效的短信登录中间态（10 分钟内有效）', { hint: `${cmd} --phone <手机号>` })
    const account = await flow.verify(state, code)
    await smsState.clear(ctx)
    return account
  }
  if (!phone) {
    if (!interactive()) throw new CatbusError('USAGE', '短信登录需要 --phone', { hint: `${cmd} --phone <手机号>` })
  }
  const target = phone ?? (await prompt('手机号：'))
  const state = await flow.send(target)
  if (!interactive()) {
    await smsState.save(ctx, state)
    ctx.log.info(`验证码已发送到 ${target}。收到后执行：${cmd} --code <验证码>`)
    return { sent: true, phone: target }
  }
  const input = await prompt('验证码：')
  return flow.verify(state, input.trim())
}

