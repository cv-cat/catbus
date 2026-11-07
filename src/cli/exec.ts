import { readFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { text as readStdin } from 'node:stream/consumers'
import { z } from 'zod'
import { checkAccountName, endpointFlag, getCurrent, GUEST, newCredential, readCredential, writeCredential } from '../core/auth-store.js'
import { CatbusError } from '../core/errors.js'
import type { Logger } from '../core/log.js'
import { describeOption, flagName, PAGING, STANDARD_VALUES } from '../core/options.js'
import type { AvailableEndpoint, Command, Endpoint, HandlerContext, Platform } from '../core/registry.js'
import type { Credential } from '../core/schemas.js'
import type { Args, Options } from '../core/vocab.js'
import type { GlobalFlags } from './argv.js'

// 命令执行的共用部分：CLI（dispatch.ts）和 TUI（src/tui）都从这里取，行为只有一份。

/**
 * 请求中更新过的凭证（Set-Cookie、刷新的 token、新生成的游客设备数据）落盘。
 * 账号文件已被删除（logout）时不再写回。
 */
export async function persistCredential(credential: Credential, snapshot: string | null): Promise<void> {
  if (snapshot == null || JSON.stringify(credential) === snapshot) return
  const { platform, endpoint, account } = credential
  if (account !== GUEST && !(await readCredential(platform, endpoint as Endpoint, account).catch(() => null))) return
  await writeCredential(credential)
}

/** 选项与参数校验：不适用的选项 → 标准取值 → 位置参数个数 → zod → 跨参数约束。 */
export function validate(platform: Platform, command: Command, words: string[], given: Options): { args: Args; options: Options } {
  const p = platform.id
  const help = `catbus ${p} ${command.key} --help`
  for (const key of Object.keys(given)) {
    if (command.unsupported.includes(key)) {
      const usable = Object.keys(command.options).filter((k) => !(k in PAGING))
      throw new CatbusError('UNSUPPORTED', `${p} 的 ${command.key} 不支持 --${flagName(key)}`, {
        hint: usable.length ? `可用的选项：${usable.map((k) => `--${flagName(k)}`).join('、')}` : help,
      })
    }
    if (!(key in command.options)) {
      throw new CatbusError('USAGE', `选项 --${flagName(key)} 不适用于 ${p} ${command.key}`, { hint: help })
    }
    const standard = STANDARD_VALUES[key]
    if (!standard) continue
    if (command.extension && !describeOption(command.options[key]!).values?.some((v) => standard.includes(v))) continue
    const value = String(given[key])
    const flag = `--${flagName(key)}`
    // 两种错误的 hint 都只列本平台支持的取值，照着 hint 改不会再撞 UNSUPPORTED
    const supported = describeOption(command.options[key]!).values ?? standard
    if (!standard.includes(value)) {
      throw new CatbusError('USAGE', `${flag} 的取值不对：${value}`, { hint: `可选：${supported.join('、')}` })
    }
    if (!supported.includes(value)) {
      throw new CatbusError('UNSUPPORTED', `${p} 的 ${command.key} 不支持 ${flag} ${value}`, { hint: `可选：${supported.join('、')}` })
    }
  }

  const min = command.args.filter((a) => !a.optional).length
  if (words.length < min) {
    throw new CatbusError('USAGE', `缺少参数 <${command.args[words.length]!.name}>`, { hint: help })
  }
  if (words.length > command.args.length) {
    throw new CatbusError('USAGE', `多余的参数：${words.slice(command.args.length).join(' ')}`, {
      hint: `含空格的文本请加引号；以 - 开头的参数放在 -- 之后。${help}`,
    })
  }

  const result = z.object(command.options).safeParse(given)
  if (!result.success) {
    const issue = result.error.issues[0]!
    const key = String(issue.path[0] ?? '')
    throw new CatbusError('USAGE', `${key ? `--${flagName(key)}：` : ''}${issue.message}`, { hint: help })
  }
  const options = result.data as Options
  const args: Args = Object.fromEntries(command.args.map((a, i) => [a.name, words[i] ?? a.default]))
  const problem = command.check?.(args, options)
  if (problem) throw new CatbusError('USAGE', problem, { hint: help })
  return { args, options }
}

/** 身份：-a > _current > 游客（AGENTS 5.2）。auth 命令只解析账号名，不做登录检查。 */
export async function resolveIdentity(
  platform: Platform,
  endpoint: Endpoint,
  command: Command,
  args: Args,
  g: GlobalFlags,
  log: Logger,
): Promise<{ account: string | null; credential: Credential }> {
  const p = platform.id
  const e = endpointFlag(endpoint)
  const ep = platform.endpoints[endpoint] as AvailableEndpoint
  const blank = () => newCredential({ platform: p, endpoint, account: GUEST, method: 'guest' })
  // 不支持游客态的端上没有 guest.json：auth 命令没有账号时用一份不落盘的空凭证（AGENTS 5.2）
  const guest = async () => (ep.guest ? ((await readCredential(p, endpoint, GUEST).catch(() => null)) ?? blank()) : blank())
  if (command.resource === 'auth') {
    // -a guest 只对 auth status 有意义；登录、登出到 guest 都不行（guest 是保留名）
    const allowGuest = command.key === 'auth status'
    const account = g.account != null ? checkAccountName(g.account, { allowGuest }) : await getCurrent(p, endpoint)
    const credential = account == null || account === GUEST ? null : await readCredential(p, endpoint, account).catch(() => null)
    return { account: account === GUEST ? null : account, credential: credential ?? (await guest()) }
  }

  if (g.account != null && g.account !== GUEST) {
    const account = checkAccountName(g.account)
    const credential = await readCredential(p, endpoint, account)
    if (!credential) {
      throw new CatbusError('AUTH_REQUIRED', `账号 ${account} 不存在`, { hint: `catbus ${p} auth login -a ${account}${e}` })
    }
    return { account, credential }
  }
  const current = g.account == null ? await getCurrent(p, endpoint) : null
  if (current) return { account: current, credential: (await readCredential(p, endpoint, current))! }

  const login = `catbus ${p} auth login${e}`
  if (command.auth === 'required') throw new CatbusError('AUTH_REQUIRED', `${command.key} 需要登录`, { hint: login })
  if (command.args.some((a) => a.name === 'user' && args[a.name] === 'me')) {
    throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: login })
  }
  if (g.account !== GUEST && ep.login.methods.length > 0) {
    log.info(`未登录 ${p} (${endpoint})，本次以游客身份访问，结果可能不完整；很多操作需要登录。登录：${login}`)
  }
  return { account: GUEST, credential: await guest() }
}

/**
 * `--text @file`、`--cookie @file|-`：从文件或 stdin 读取。
 * `--text @file` 同时把文件的绝对路径记在 `textFile` 里，正文里的相对路径（如 Markdown 插图）按它所在目录解析。
 */
export async function readFileOptions(options: Options): Promise<void> {
  for (const key of ['text', 'cookie']) {
    const v = options[key]
    if (typeof v !== 'string') continue
    if (key === 'cookie' && v === '-') options[key] = (await readStdin(process.stdin)).trim()
    else if (v.startsWith('@')) {
      options[key] = await readFile(v.slice(1), 'utf8').catch(() => {
        throw new CatbusError('USAGE', `读取文件失败：${v.slice(1)}`)
      })
      if (key === 'text') options.textFile = resolvePath(v.slice(1))
    }
  }
}

/** 截在一页中间时的游标后缀：`<这一页的游标>#skip=N`，续翻时重取这一页、跳过已经输出的 N 条。 */
const SKIP_RE = /#skip=(\d+)$/

export function splitCursor(cursor: string | null): { cursor: string | null; skip: number } {
  const m = cursor == null ? null : SKIP_RE.exec(cursor)
  if (!m) return { cursor, skip: 0 }
  const base = cursor!.slice(0, m.index)
  return { cursor: base === '' ? null : base, skip: Number(m[1]) }
}

/** 构造 handler 的上下文；保存凭证只经 core（AGENTS 5.4）。 */
export function createHandlerContext(init: {
  platform: Platform
  endpoint: Endpoint
  command: Command
  args: Args
  options: Options
  identity: { account: string | null; credential: Credential }
  network: { proxy: string | null; timeout: number }
  log: Logger
  raw: boolean
  signal: AbortSignal
}): HandlerContext {
  const { platform, endpoint, command, options, identity } = init
  return {
    platform,
    endpoint,
    resource: command.resource,
    action: command.action,
    args: init.args,
    options,
    account: identity.account,
    credential: identity.credential,
    cursor: (options.cursor as string | undefined) ?? null,
    raw: init.raw,
    config: init.network,
    log: init.log,
    signal: init.signal,
    saveCredential: async (credential: Credential) => {
      if (credential.platform !== platform.id || credential.endpoint !== endpoint) throw new Error('saveCredential：平台或端不匹配')
      await writeCredential(credential)
    },
  }
}

/** 凭证改动前的快照；不支持游客态的端上，游客凭证只在内存里，不落盘（返回 null）。 */
export function credentialSnapshot(credential: Credential, ep: AvailableEndpoint): string | null {
  return credential.account === GUEST && !ep.guest ? null : JSON.stringify(credential)
}
