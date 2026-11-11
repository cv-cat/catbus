import { GUEST, checkAccountName, getCurrent, listAccounts } from '../core/auth-store.js'
import { CatbusError, toCatbusError } from '../core/errors.js'
import { type LoginUi, setLoginUi } from '../core/login.js'
import { describeOption, flagName, type LoginMethod } from '../core/options.js'
import type { Command, Platform } from '../core/registry.js'
import type { Account, AuthStatus } from '../core/schemas.js'
import { type Invocation, invoke } from '../cli/exec.js'
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
  /** 表单里填的选项，键是 `auth login` 的选项名（camelCase）：文本为字符串，开关为 true。 */
  fields: Record<string, string | boolean>
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

export interface LoginField {
  /** `auth login` 的选项名（camelCase）。 */
  name: string
  /** 表单里的标签：`--kebab-case`。 */
  label: string
  kind: 'text' | 'toggle'
  /** 选项的说明（去掉末尾标注方式的括号）。 */
  hint: string
  /** 输入时不回显（cookie）。 */
  hidden: boolean
  /** 不填就没法开始，界面先拦下来，省得 handler 再报 USAGE。 */
  required: boolean
}

/**
 * 界面不提供的 `auth login` 选项：
 * - method、scope：登录页有单独的两行；
 * - code、user：分步登录（非 TTY 下先发码再带 --code）用的，界面里一步完成，验证码、选账号都由 handler 提问；
 * - 名字以 Stdin 结尾的：从 stdin 读取，界面里 stdin 归界面，相应内容由 handler 在界面里提问（密码、API Key）。
 */
const OMITTED = new Set(['method', 'scope', 'code', 'user'])
/** handler 不会提问、缺了就报 USAGE 的选项。其余选项都可以留空（handler 会问，或者本来就可选）。 */
const REQUIRED: Partial<Record<LoginMethod, string[]>> = { cookie: ['cookie'], password: ['username'] }
const HIDDEN = new Set(['cookie'])
/** 说明末尾的 `（sms）`、`（password）`：选项只用于这些登录方式。没有标注的选项各方式通用。 */
const METHOD_TAG = /（([a-z]+(?:\s*[/、,]\s*[a-z]+)*)）\s*$/
/** 选项说明里「或 - 表示从 stdin 读取」这类话在界面里不适用（stdin 归界面），不显示。 */
const STDIN_NOTE = /[，,]\s*或 - 表示从 stdin 读取/

/**
 * 登录页的表单字段：从注册表里 `auth login` 的选项算出来，不手写。平台或词表新增登录选项时界面自动出现，
 * 只要说明末尾按惯例标注适用的登录方式（如 `手机号（sms）`）；不标注的对所有方式显示。
 */
export function loginFields(platform: Platform, method: LoginMethod): LoginField[] {
  const command = loginCommand(platform)
  if (!command) return []
  const required = REQUIRED[method] ?? []
  const out: LoginField[] = []
  for (const [name, schema] of Object.entries(command.options)) {
    if (OMITTED.has(name) || name.endsWith('Stdin') || command.unsupported.includes(name)) continue
    const info = describeOption(schema)
    if (info.kind !== 'string' && info.kind !== 'boolean') continue
    const description = info.description ?? ''
    const tag = METHOD_TAG.exec(description)
    if (tag && !tag[1]!.split(/\s*[/、,]\s*/).includes(method)) continue
    out.push({
      name,
      label: `--${flagName(name)}`,
      kind: info.kind === 'boolean' ? 'toggle' : 'text',
      hint: (tag ? description.slice(0, tag.index) : description).replace(STDIN_NOTE, ''),
      hidden: HIDDEN.has(name),
      required: required.includes(name),
    })
  }
  // 必填的排在前面
  return out.sort((a, b) => Number(b.required) - Number(a.required))
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
      // 与 CLI 一致：不带 -a 时取当前账号，没有就是 default
      const account = req.account.trim() === '' ? undefined : checkAccountName(req.account.trim())
      onView({ type: 'working', text: '正在准备登录…' })
      const given: Record<string, unknown> = { method: req.method }
      if (req.scope) given.scope = req.scope
      for (const [k, v] of Object.entries(req.fields)) if (v !== '' && v !== false) given[k] = v
      const inv: Invocation = { platform: req.platform, command, words: [], given, log: req.log, signal: controller.signal }
      if (account) inv.account = account
      const { data } = await invoke(inv)
      // 分步登录的中间结果（`{ sent: true, ... }`）只在非交互时返回；界面里 handler 会一直问到登录完成
      if (data == null || typeof data !== 'object' || typeof (data as Account).account !== 'string') {
        throw new CatbusError('ERROR', '登录没有完成：平台还需要下一步操作', { hint: `在终端里完成：catbus ${req.platform.id} auth login --method ${req.method}` })
      }
      onView({ type: 'done', account: data as Account })
    } catch (err) {
      onView({ type: 'error', error: toCatbusError(err) })
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
  const command = webEndpoint(platform)?.commands.get(key)
  if (!command || command.status !== 'implemented') throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} 没有 ${key}`)
  const name = account == null ? undefined : checkAccountName(account, { allowGuest: false })
  const inv: Invocation = { platform, command, words, given: {}, log, signal: new AbortController().signal }
  if (name) inv.account = name
  const { data } = await invoke(inv)
  return data
}

/** 在线检查账号的登录态。未登录或已失效返回 logged_in: false，不抛错。 */
export async function checkAccount(platform: Platform, account: string, log: Logger): Promise<AuthStatus> {
  return (await runAuth(platform, 'auth status', account, log)) as AuthStatus
}

/** 登出：服务端能登出的会调用，然后删除本地凭证（AGENTS 5.3）。确认由界面做。 */
export async function logoutAccount(platform: Platform, account: string, log: Logger): Promise<void> {
  await runAuth(platform, 'auth logout', account, log)
}
