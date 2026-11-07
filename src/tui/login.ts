import { GUEST, checkAccountName, getCurrent, listAccounts } from '../core/auth-store.js'
import { resolveNetwork } from '../core/config.js'
import { CatbusError } from '../core/errors.js'
import { type LoginUi, setLoginUi } from '../core/login.js'
import type { LoginMethod } from '../core/options.js'
import type { Command, Platform } from '../core/registry.js'
import type { Account } from '../core/schemas.js'
import { createHandlerContext, credentialSnapshot, persistCredential, resolveIdentity, validate } from '../cli/exec.js'
import type { Logger } from '../core/log.js'
import { webEndpoint } from './model.js'

// 登录与账号管理的执行部分（AGENTS 4.13）：不含 React。界面通过 LoginSession 拿到“现在该显示什么”。
// 实际登录仍由各平台的 `auth login` handler 完成（5.3 的流程不变），这里只是把它的二维码、提问接到界面上。

export type LoginView =
  | { type: 'working'; text: string }
  | { type: 'qrcode'; content: string; png: string; hint: string }
  | { type: 'prompt'; question: string; hidden: boolean }
  | { type: 'link'; url: string; hint: string; title: string }
  | { type: 'done'; account: Account }
  | { type: 'error'; error: CatbusError }

export interface LoginRequest {
  platform: Platform
  method: LoginMethod
  /** 账号名；空为“当前账号或 default”（与 CLI 不带 -a 一致）。 */
  account: string
  /** 子站点，如 xhs 的 creator。 */
  scope?: string
  /** 方式需要的参数：sms 的 phone，cookie 的 cookie，password 的 username。 */
  fields: Record<string, string>
  log: Logger
}

export interface LoginSession {
  /** 取消登录：轮询、等待输入都会结束，之后不再回调 onView（用户主动取消不是失败）。 */
  cancel(): void
  /** 回答当前的提问。 */
  answer(text: string): void
  done: Promise<void>
}

/** 本平台 web 端的 auth login 命令；没有（如 12306）返回 null。 */
export function loginCommand(platform: Platform): Command | null {
  const ep = webEndpoint(platform)
  const c = ep?.commands.get('auth login')
  return c && c.status === 'implemented' ? c : null
}

export function loginMethods(platform: Platform): { methods: LoginMethod[]; default: LoginMethod | null; scopes: string[] } {
  const ep = webEndpoint(platform)
  return { methods: ep?.login.methods ?? [], default: ep?.login.default ?? null, scopes: ep?.login.scopes ?? [] }
}

/** 各方式需要填的字段（界面据此画表单）。字段名对应 `auth login` 的选项。 */
export function fieldsFor(method: LoginMethod): { name: string; label: string; hidden?: boolean }[] {
  switch (method) {
    case 'sms':
      return [{ name: 'phone', label: '手机号' }]
    case 'password':
      return [{ name: 'username', label: '用户名' }]
    case 'cookie':
      return [{ name: 'cookie', label: 'cookie', hidden: true }]
    default:
      return []
  }
}

/**
 * 开始登录。onView 在每次状态变化时调用；返回的 session 可以取消和回答提问。
 * 登录期间设上 core/login 的界面钩子；结束（成功、失败、取消）后一定撤销。
 */
export function startLogin(req: LoginRequest, emit: (v: LoginView) => void): LoginSession {
  const controller = new AbortController()
  // 取消之后不再通知界面：界面已经回到表单，晚到的“已取消”不能把它盖成失败页
  const onView = (v: LoginView) => {
    if (!controller.signal.aborted) emit(v)
  }
  let waiting: ((text: string) => void) | null = null
  const hook: LoginUi = {
    interactive: true,
    signal: controller.signal,
    qrcode: (content, png, hint) => onView({ type: 'qrcode', content, png, hint }),
    link: (url, hint, title) => onView({ type: 'link', url, hint, title }),
    prompt: (question, options) =>
      new Promise<string>((resolve, reject) => {
        waiting = resolve
        controller.signal.addEventListener('abort', () => reject(new CatbusError('AUTH_REQUIRED', '已取消登录')), { once: true })
        onView({ type: 'prompt', question, hidden: options.hidden ?? false })
      }),
  }

  const done = (async () => {
    const restore = setLoginUi(hook)
    try {
      const command = loginCommand(req.platform)
      if (!command) throw new CatbusError('UNSUPPORTED', `${req.platform.name}没有登录命令`)
      const endpoint = 'web' as const
      const ep = webEndpoint(req.platform)!
      const account = req.account.trim() === '' ? undefined : checkAccountName(req.account.trim())
      onView({ type: 'working', text: '正在准备登录…' })
      const given: Record<string, unknown> = { method: req.method }
      if (req.scope) given.scope = req.scope
      for (const [k, v] of Object.entries(req.fields)) if (v !== '') given[k] = v
      // 与 CLI 一致：不带 -a 时 resolveIdentity 取当前账号，没有就是 default
      const { args, options } = validate(req.platform, command, [], given)
      const identity = await resolveIdentity(req.platform, endpoint, command, args, account ? { account } : {}, req.log)
      const network = await resolveNetwork(req.platform.id, undefined)
      const handler = await command.handler!()
      const ctx = createHandlerContext({ platform: req.platform, endpoint, command, args, options, identity, network, log: req.log, raw: false, signal: controller.signal })
      const snapshot = credentialSnapshot(ctx.credential, ep)
      try {
        const result = (await handler(ctx)) as Account | { sent: true; phone: string }
        if ('sent' in result) {
          // 非交互才会走到这里；界面里 sms 流程是一步完成的
          throw new CatbusError('ERROR', '验证码已发送但没有完成登录')
        }
        onView({ type: 'done', account: result })
      } finally {
        await persistCredential(ctx.credential, snapshot)
      }
    } catch (err) {
      if (!controller.signal.aborted) onView({ type: 'error', error: err instanceof CatbusError ? err : new CatbusError('ERROR', err instanceof Error ? err.message : String(err), { cause: err }) })
    } finally {
      restore()
    }
  })()

  return {
    cancel: () => controller.abort(),
    answer: (text) => {
      const w = waiting
      waiting = null
      w?.(text)
    },
    done,
  }
}

// ---- 账号 ----

export interface AccountRow extends Account {
  /** 是否是这个平台 web 端当前正在用的账号。 */
  active: boolean
}

export async function accountsOf(platform: Platform): Promise<AccountRow[]> {
  if (!webEndpoint(platform)) return []
  const list = await listAccounts(platform.id, 'web')
  return list.map((a) => ({ ...a, active: a.current }))
}

/** 切换当前账号：与 CLI 的 `auth use` 走同一个 handler，端声明了 `use` 钩子的（如即梦写回钥匙串）一并调用（AGENTS 5.3）。 */
export async function useAccount(platform: Platform, account: string, log: Logger): Promise<void> {
  await runAuth(platform, 'auth use', null, log, [account])
}

export async function currentAccount(platform: Platform): Promise<string | null> {
  return getCurrent(platform.id, 'web').catch(() => null)
}

export { GUEST }

/**
 * 运行一条 auth 命令（status / logout / use）。account 按 `-a` 的方式指定，null 时与 CLI 不带 -a 一样取当前账号；
 * words 是位置参数。auth 命令只解析账号名，不做登录检查。
 */
async function runAuth(platform: Platform, key: 'auth status' | 'auth logout' | 'auth use', account: string | null, log: Logger, words: string[] = []): Promise<unknown> {
  const endpoint = 'web' as const
  const ep = webEndpoint(platform)
  const command = ep?.commands.get(key)
  if (!ep || !command || command.status !== 'implemented') throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} 没有 ${key}`)
  const { args, options } = validate(platform, command, words, {})
  const g = account == null ? {} : { account: checkAccountName(account, { allowGuest: false }) }
  const identity = await resolveIdentity(platform, endpoint, command, args, g, log)
  const network = await resolveNetwork(platform.id, undefined)
  const handler = await command.handler!()
  const ctx = createHandlerContext({ platform, endpoint, command, args, options, identity, network, log, raw: false, signal: new AbortController().signal })
  const snapshot = credentialSnapshot(ctx.credential, ep)
  try {
    return await handler(ctx)
  } finally {
    await persistCredential(ctx.credential, snapshot)
  }
}

export interface AuthStatus {
  logged_in: boolean
  user: { id: string; name: string | null } | null
  method: string | null
  expires_at: string | null
}

/** 在线检查账号的登录态。未登录或已失效返回 logged_in: false，不抛错。 */
export async function checkAccount(platform: Platform, account: string, log: Logger): Promise<AuthStatus> {
  return (await runAuth(platform, 'auth status', account, log)) as AuthStatus
}

/** 登出：服务端能登出的会调用，然后删除本地凭证（AGENTS 5.3）。确认由界面做。 */
export async function logoutAccount(platform: Platform, account: string, log: Logger): Promise<void> {
  await runAuth(platform, 'auth logout', account, log)
}
