import { CatbusError } from '../core/errors.js'
import type { Logger } from '../core/log.js'
import type { Command, Page, Platform } from '../core/registry.js'
import { invoke, splitCursor } from '../cli/exec.js'
import { runnable } from './model.js'

// 在进程内运行一条读取类命令，返回结构化结果（AGENTS 4.13）。
// 校验、身份和凭证落盘都在 cli/exec.ts（与 CLI 同一份规则）；这里只管“界面允许运行哪些命令”和分页。

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
  // 界面一次取一页；翻页由界面按 page.cursor 继续。cursor 里的 #skip=N 与 CLI 的 --limit 截断约定相同：
  // 重取这一页，跳过已经显示过的 N 条。
  const { cursor, skip } = splitCursor(req.cursor ?? null)
  const given = { ...req.given }
  if (cursor != null) given.cursor = cursor
  const signal = req.signal ?? new AbortController().signal
  const { data, account } = await invoke({ platform, command, words: req.words, given, log, signal })
  if (command.paged) {
    const result = data as { data: unknown[]; page: Page }
    return { data: result.data.slice(skip), page: result.page, account }
  }
  return { data, page: null, account }
}
