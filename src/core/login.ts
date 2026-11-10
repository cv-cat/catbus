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
import { accountUser } from './normalize.js'
import type { Account, AccountUser, Credential, UserRef } from './schemas.js'

/** 登录流程的公共部分（AGENTS 5.3）。各平台的 `auth login` handler 调用这些函数。 */

/**
 * 界面钩子（AGENTS 4.13）：二维码、提问、是否可交互三处可以被终端界面接管。
 * CLI 里没有钩子，走 stderr 和 readline；TUI 运行登录时设上，把二维码和提问画在界面里。
 */
export interface LoginUi {
  /** 界面里随时可以提问。 */
  interactive: true
  /** 展示二维码。content 是二维码内容，png 是已经写好的图片路径。 */
  qrcode(content: string, png: string, hint: string): void
  prompt(question: string, options: { hidden?: boolean }): Promise<string>
  /** 需要用户在浏览器里完成的一步（极验人机验证、即梦授权）：显示链接，等用户操作；完成后平台流程自己继续。 */
  link(url: string, hint: string, title: string): void
  /** 取消登录：轮询和等待输入都会在这个信号触发时结束。 */
  signal: AbortSignal
}

let ui: LoginUi | null = null
const uiStack: LoginUi[] = []

/** 终端界面运行期间为 true：stdin 归界面，钩子之外的提问不能去读它。 */
let screenOwnsStdin = false

/**
 * 终端界面启动时调用，返回撤销函数（AGENTS 4.13）。之后没有界面钩子时：`interactive()` 为 false，平台走各自的非交互分支
 *（保存中间态、报 USAGE / RISK_CONTROL 并给出命令行提示）；`prompt()` 直接报 USAGE，不会开 readline 和界面抢输入。
 * CLI 里从不调用，行为不变。
 */
export function claimStdin(): () => void {
  screenOwnsStdin = true
  return () => {
    screenOwnsStdin = false
  }
}

/**
 * 设上界面钩子，返回撤销函数。用栈而不是“恢复上一个”：重新扫码时旧会话的撤销晚于新会话的设置，
 * 如果撤销时去恢复“设置前的值”，新会话结束后会把已取消的旧钩子又装回来。
 */
export function setLoginUi(next: LoginUi | null): () => void {
  if (next) uiStack.push(next)
  ui = uiStack.at(-1) ?? null
  return () => {
    if (next) {
      const i = uiStack.indexOf(next)
      if (i >= 0) uiStack.splice(i, 1)
    }
    ui = uiStack.at(-1) ?? null
  }
}

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
 *
 * `user.avatar` 是登录流程里那次用户信息请求顺带拿到的头像（AGENTS 5.3），没有时沿用同一用户之前存的。
 */
export async function finishLogin(
  ctx: HandlerContext,
  credential: Credential,
  ref: UserRef & { avatar?: string | null },
): Promise<Account> {
  const user: AccountUser = accountUser(ref)
  const p = ctx.platform.id
  const account = ctx.options.autoBind ? await bindTarget(ctx, user) : loginTarget(ctx)
  const existing = await readCredential(p, ctx.endpoint, account).catch(() => null)
  const replaced = existing?.user && existing.user.id !== user.id ? existing.user : null
  if (replaced) {
    ctx.log.warn(`账号 ${account} 原来登录的是 ${replaced.name ?? replaced.id}，已替换为 ${user.name ?? user.id}`)
  }
  credential.account = account
  credential.user = { ...user, avatar: user.avatar ?? (replaced ? null : existing?.user?.avatar) ?? null }
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

/**
 * 请用户在浏览器里打开一个链接（人机验证、浏览器授权）。界面里走钩子：链接单独显示、可按 o 打开，title 是页面标题，
 * hint 是不含链接的说明；CLI 里原样写到 stderr（-q 也显示，这一步必须由用户操作），文案由调用方给出，保持和以前逐字一致。
 */
export function showLink(url: string, hint: string, cliLine: string, title = '需要在浏览器里完成人机验证'): void {
  if (ui) ui.link(url, hint, title)
  else process.stderr.write(`[catbus] ${cliLine}\n`)
}

/** 二维码：画到 stderr，同时把 PNG 存到 cache/<p>/qrcode.png。 */
export async function showQrcode(ctx: HandlerContext, content: string, hint = '请用 App 扫码'): Promise<string> {
  const png = join(cacheDir(ctx.platform.id), 'qrcode.png')
  await writeFileAtomic(png, await QRCode.toBuffer(content, { margin: 2, scale: 8 }))
  if (ui) {
    ui.qrcode(content, png, hint)
    ctx.log.info(`${hint}。二维码图片：${png}`)
    return png
  }
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
    if (ui?.signal.aborted) throw new CatbusError('AUTH_REQUIRED', '已取消登录')
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
    await sleep(options.interval ?? 2000, ui?.signal)
  }
}

/** 是否可以交互输入（stdin 与 stderr 都是 TTY）。 */
export function interactive(): boolean {
  if (ui) return ui.interactive
  if (screenOwnsStdin) return false
  return Boolean(process.stdin.isTTY && process.stderr.isTTY)
}

/** 在 stderr 上提问，读一行。hidden 时不回显（密码）。 */
export async function prompt(question: string, options: { hidden?: boolean } = {}): Promise<string> {
  if (ui) return ui.prompt(question, options)
  if (screenOwnsStdin) throw new CatbusError('USAGE', `这一步需要输入（${question.replace(/[：:]\s*$/, '')}），不能在界面里完成`, { hint: '请在终端里运行界面底部显示的等价命令' })
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
  if (!ui && !ctx.options.passwordStdin) {
    throw new CatbusError('USAGE', '密码只从 stdin 读取，请加 --password-stdin', {
      hint: `catbus ${ctx.platform.id} auth login --method password --username <name> --password-stdin`,
    })
  }
  const password = ui || process.stdin.isTTY ? await prompt('密码：', { hidden: true }) : (await readStreamText(process.stdin)).replace(/\r?\n$/, '')
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

/** 短信登录的中间结果：非 TTY 分步时返回，`sent` 之外的字段平台自定义（如快手 sms 多用户的 `users`）。 */
export type SmsIntermediate = { sent: true } & Record<string, unknown>

/**
 * 短信登录的通用流程。平台提供 send（发验证码，返回需要保存的中间态）和 verify（用验证码完成登录）。
 * 平台验证成功后还要用户选账号的（如快手手机号下有多个账号），额外提供 select（`--user <id>` 完成登录），
 * verify 在非 TTY 下返回 `platforms 自定义的 { sent: true, ... }` 表示还有下一步（此时平台自己保存了新的中间态，core 不清掉）。
 * TTY 下一步完成；非 TTY 下先 `--phone` 发码，再单独用 `--code` 完成，需要选账号时最后用 `--user <id>` 收尾。
 */
export async function smsLogin<S extends Record<string, unknown>>(
  ctx: HandlerContext,
  flow: {
    send(phone: string): Promise<S>
    verify(state: S, code: string): Promise<Account | SmsIntermediate>
    select?(state: S, userId: string): Promise<Account | SmsIntermediate>
  },
): Promise<Account | SmsIntermediate> {
  const phone = ctx.options.phone as string | undefined
  const code = ctx.options.code as string | undefined
  const user = (ctx.options.user as string | undefined)?.trim()
  const p = ctx.platform.id
  const cmd = `catbus ${p} auth login --method sms${ctx.account ? ` -a ${ctx.account}` : ''}${endpointFlag(ctx.endpoint)}`
  if (user) {
    if (!flow.select) throw new CatbusError('USAGE', '该平台不支持用 --user 选择账号', { hint: `${cmd} --code <验证码>` })
    const state = await smsState.load<S>(ctx)
    if (!state) throw new CatbusError('USAGE', '没有找到有效的短信登录中间态（10 分钟内有效）', { hint: `${cmd} --phone <手机号>` })
    const result = await flow.select(state, user)
    // 返回 {sent:true,...} 中间态（例如选号后撞风控、等验证码）时 state 由平台自己维护，不清
    if ('sent' in (result as SmsIntermediate) && (result as SmsIntermediate).sent) return result
    await smsState.clear(ctx)
    return result as Account
  }
  if (code) {
    const state = await smsState.load<S>(ctx)
    if (!state) throw new CatbusError('USAGE', '没有找到有效的短信登录中间态（10 分钟内有效）', { hint: `${cmd} --phone <手机号>` })
    const result = await flow.verify(state, code)
    if ('sent' in result && result.sent) return result
    await smsState.clear(ctx)
    return result
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

