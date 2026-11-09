import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { text as readStreamText } from 'node:stream/consumers'
import QRCode from 'qrcode'
import { ACCOUNT_RE, GUEST, endpointFlag, getCurrent, listAccounts, newCredential, readCredential, setCurrent, toAccount, writeCredential } from './auth-store.js'
import { parseCookieInput } from './cookies.js'
import { CatbusError } from './errors.js'
import { writeFileAtomic } from './fsutil.js'
import { cacheDir } from './paths.js'
import { now, sleep } from './rand.js'
import type { HandlerContext } from './registry.js'
import type { Account, Credential, UserRef } from './schemas.js'

/** 登录流程的公共部分（AGENTS 5.3）。各平台的 `auth login` handler 调用这些函数。 */

/** 登录到哪个账号：`-a` > 当前账号 > `default`。 */
export function loginTarget(ctx: HandlerContext): string {
  return ctx.account ?? 'default'
}

/**
 * 登录流程里校验新凭证用的上下文：账号是要登录到的那个（出错时提示里的账号名对得上），凭证是还没落盘的新凭证。
 */
export function loginContext(ctx: HandlerContext, credential: Credential): HandlerContext {
  return { ...ctx, account: loginTarget(ctx), credential }
}

/** 登录方式对应的新凭证（还没落盘）。 */
export function freshCredential(ctx: HandlerContext, method: Credential['method']): Credential {
  return newCredential({ platform: ctx.platform.id, endpoint: ctx.endpoint, account: loginTarget(ctx), method })
}

/**
 * 登录成功后落盘（AGENTS 5.3）。
 *
 * - 默认：写到目标账号（`-a` > 当前账号 > `default`）。那里原来存的是另一个用户时，视为先登出再登录：
 *   旧凭证被替换，stderr 提示一行。
 * - `--auto-bind`：不看目标账号，按用户 id 在本平台本端的账号里找。找到就刷新那个账号的凭证；
 *   找不到就新增账号（`default` 没被占用时用 `default`，否则按用户 id 起名）。
 *
 * 两种方式下，还没有当前账号时都把它设为当前账号。
 */
export async function finishLogin(ctx: HandlerContext, credential: Credential, user: UserRef): Promise<Account> {
  const p = ctx.platform.id
  const account = ctx.options.autoBind ? await bindTarget(ctx, user) : loginTarget(ctx)
  const existing = await readCredential(p, ctx.endpoint, account).catch(() => null)
  const replaced = existing?.user && existing.user.id !== user.id ? existing.user : null
  if (replaced) {
    ctx.log.warn(`账号 ${account} 原来登录的是 ${replaced.name ?? replaced.id}，已替换为 ${user.name ?? user.id}`)
  }
  credential.account = account
  credential.user = user
  if (existing && !replaced) credential.created_at = existing.created_at
  await writeCredential(credential)
  let current = await getCurrent(p, ctx.endpoint)
  if (!current) {
    await setCurrent(p, ctx.endpoint, account)
    current = account
  }
  ctx.log.info(`已登录 ${ctx.platform.name}：${user.name ?? user.id}（账号 ${account}）`)
  return toAccount(credential, current === account)
}

/** `--auto-bind` 的目标账号：同一用户的已有账号 > `default` > 按用户 id 起的名字。 */
async function bindTarget(ctx: HandlerContext, user: UserRef): Promise<string> {
  const accounts = await listAccounts(ctx.platform.id, ctx.endpoint)
  const same = accounts.find((a) => a.user?.id === user.id)
  if (same) {
    ctx.log.info(`${user.name ?? user.id} 已经保存在账号 ${same.account}，刷新它的登录态`)
    return same.account
  }
  const taken = new Set(accounts.map((a) => a.account))
  return taken.has('default') ? accountNameFor(user, taken) : 'default'
}

/** 按用户 id 起一个没被占用的账号名（AGENTS 5.1 的格式），起不出来时用 account-<n>。 */
export function accountNameFor(user: UserRef, taken: ReadonlySet<string>): string {
  const base = user.id
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 32)
  const free = (name: string) => ACCOUNT_RE.test(name) && name !== GUEST && !taken.has(name)
  if (base && free(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const name = base ? base.slice(0, 32 - suffix.length) + suffix : `account${suffix}`
    if (free(name)) return name
  }
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

