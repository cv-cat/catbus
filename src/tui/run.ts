import { resolveNetwork } from '../core/config.js'
import { CatbusError } from '../core/errors.js'
import type { Logger } from '../core/log.js'
import type { Command, Page, Platform } from '../core/registry.js'
import { createHandlerContext, credentialSnapshot, persistCredential, readFileOptions, resolveIdentity, splitCursor, validate } from '../cli/exec.js'
import { runnable } from './model.js'

// 在进程内运行一条读取类命令，返回结构化结果（AGENTS 4.13）。
// 与 CLI 共用 exec.ts 的校验、身份和凭证落盘；不写信封，也不碰 stdout / stderr。

export interface RunResult {
  /** 归一化对象；列表命令为数组，其余为单个对象。 */
  data: unknown
  /** 分页命令的下一页信息，其余为 null。 */
  page: Page | null
  account: string | null
}

export interface RunRequest {
  platform: Platform
  command: Command
  /** 位置参数，按命令声明的顺序。 */
  words: string[]
  /** 选项，键为 camelCase。 */
  given: Record<string, unknown>
  /** 分页：上一页返回的 page.cursor。 */
  cursor?: string | null
  log: Logger
  signal?: AbortSignal
}

export async function runCommand(req: RunRequest): Promise<RunResult> {
  const { platform, command, log } = req
  if (!runnable(command)) {
    throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} ${command.key} 不能在界面里运行`, {
      hint: `在终端运行：catbus ${platform.id} ${command.key} --help`,
    })
  }
  const endpoint = 'web' as const
  const ep = platform.endpoints[endpoint]
  if (ep === 'planned') throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} 的 web 端尚未实现`)

  const given = { ...req.given }
  if (req.cursor != null) given.cursor = req.cursor
  const { args, options } = validate(platform, command, req.words, given)
  const identity = await resolveIdentity(platform, endpoint, command, args, {}, log)
  await readFileOptions(options)
  const network = await resolveNetwork(platform.id, undefined)
  const handler = await command.handler!()
  const controller = new AbortController()
  req.signal?.addEventListener('abort', () => controller.abort(), { once: true })
  const ctx = createHandlerContext({ platform, endpoint, command, args, options, identity, network, log, raw: false, signal: controller.signal })
  const snapshot = credentialSnapshot(ctx.credential, ep)
  try {
    if (command.paged) {
      // 界面一次取一页；翻页由界面按 page.cursor 继续。cursor 里的 #skip=N 与 CLI 的 --limit 截断约定相同。
      const { cursor, skip } = splitCursor(ctx.cursor)
      const result = (await handler({ ...ctx, cursor })) as { data: unknown[]; page: Page }
      return { data: result.data.slice(skip), page: result.page, account: identity.account }
    }
    return { data: await handler(ctx), page: null, account: identity.account }
  } finally {
    await persistCredential(ctx.credential, snapshot)
  }
}

