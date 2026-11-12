import { resolveNetwork } from '../core/config.js'
import { CatbusError } from '../core/errors.js'
import type { Logger } from '../core/log.js'
import type { Command, Endpoint, HandlerContext, Platform } from '../core/registry.js'
import type { GlobalFlags } from './argv.js'
import { checkAutoBind, createHandlerContext, credentialSnapshot, persistCredential, readFileOptions, resolveIdentity, settle, validate } from './dispatch.js'

// 进程内运行一条平台命令（AGENTS 4.13）。给终端界面用：不解析 argv、不写信封、不碰 stdout。
//
// 校验、身份解析、凭证落盘这些规则都在 dispatch.ts 里，这里只是按 runPlatform 的顺序把它们串起来。
// CLI 独有的几步不在这里：帮助、端为 planned 的判断、--dry-run、危险操作确认（界面不运行需要确认的命令）、从 stdin 读选项。
//
// dispatch.ts 的 runPlatform 新增一步检查或加工时，在这里补上同一步；tests/exec.test.ts 检查两边结果一致。

export interface Invocation {
  platform: Platform
  /** 目前界面只用 web 端。 */
  endpoint?: Endpoint
  command: Command
  /** 位置参数，按命令声明的顺序。 */
  words: string[]
  /** 选项，键为 camelCase（与 argv 解析后的形状相同）。 */
  given: Record<string, unknown>
  /** 相当于 `-a <账号>`；不给时取当前账号。 */
  account?: string
  log: Logger
  signal: AbortSignal
}

export interface Prepared {
  command: Command
  ctx: HandlerContext
  handler: (ctx: HandlerContext) => unknown
  /** 使用的账号名：游客为 `guest`，auth 命令没有账号时为 null。 */
  account: string | null
  /** 命令结束时调用：把请求中更新过的凭证落盘。 */
  finish(): Promise<void>
}

/** 运行前的准备，顺序与 runPlatform 一致：校验 → 身份 → 读文件选项 → 网络配置 → handler 与上下文 → 凭证快照。 */
export async function prepare(inv: Invocation): Promise<Prepared> {
  const { platform, command, log } = inv
  const endpoint = inv.endpoint ?? 'web'
  const ep = platform.endpoints[endpoint]
  if (ep === 'planned') throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} 的 ${endpoint} 端尚未实现`, { detail: { endpoint, status: 'planned' } })

  const { args, options } = validate(platform, command, inv.words, inv.given)
  if (command.status === 'planned') {
    throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} (${endpoint}) 的 ${command.key} 尚未实现`, { detail: { upstream: command.upstream } })
  }
  const g: GlobalFlags = inv.account == null ? {} : { account: inv.account }
  if (command.key === 'auth login') checkAutoBind(platform, endpoint, options, g)
  const identity = await resolveIdentity(platform, endpoint, command, args, g, log)
  // `--cookie -` 是从 stdin 读取。进程内的调用方（界面）自己占着 stdin，读它会一直等下去并和界面抢输入
  if (options.cookie === '-') {
    throw new CatbusError('USAGE', '这里不能从 stdin 读取 cookie（--cookie -）', { hint: '直接给出 cookie，或用 @文件 从文件读取' })
  }
  await readFileOptions(options)
  const network = await resolveNetwork(platform.id, undefined)
  const handler = await command.handler!()
  const ctx = createHandlerContext({ platform, endpoint, command, args, options, identity, network, log, raw: false, signal: inv.signal })
  const snapshot = credentialSnapshot(ctx.credential, ep, command)
  return { command, ctx, handler, account: identity.account, finish: () => persistCredential(ctx.credential, snapshot) }
}

/** 运行一条一次返回结果的命令（不是长连接）。分页命令返回 handler 的 `{ data, page }`，翻页由调用方按 page.cursor 继续。 */
export async function invoke(inv: Invocation): Promise<{ data: unknown; account: string | null }> {
  const run = await prepare(inv)
  try {
    const data = settle(run.command, run.ctx, await run.handler(run.ctx))
    return { data, account: run.account }
  } finally {
    await run.finish()
  }
}

export { splitCursor } from './dispatch.js'
