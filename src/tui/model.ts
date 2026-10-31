import { getCurrent } from '../core/auth-store.js'
import { describeOption, flagName, PAGING } from '../core/options.js'
import { type AvailableEndpoint, type Command, type Platform, sortCommands } from '../core/registry.js'
import { PLATFORMS } from '../platforms/index.js'

// 界面的数据模型：全部从注册表算出来，不含 React（AGENTS 4.13）。

/** 界面里能运行的动作（AGENTS 4.13）。其余命令只显示等价的 CLI 命令。 */
export const READ_ACTIONS: ReadonlySet<string> = new Set([
  'get', 'list', 'search', 'related', 'media', 'items', 'replies', 'categories', 'suggest', 'hot', 'count', 'history',
  'status', 'price', 'likes', 'collects', 'reposts', 'followers', 'following', 'rank', 'gifts', 'products', 'replays', 'subtitles',
])

/** 能在界面里一次取回结果：已实现、动作在读取类集合里，且不是长连接、不需要确认。 */
export function runnable(command: Command): boolean {
  if (command.status !== 'implemented') return false
  if (command.stream || command.confirm) return false
  return READ_ACTIONS.has(command.action)
}

/** 长连接的监听：界面里显示成滚动的事件流（AGENTS 4.13）。 */
export function listenable(command: Command): boolean {
  return command.status === 'implemented' && command.stream === true && command.action === 'listen'
}

export type Availability = 'run' | 'listen' | 'cli-only' | 'planned'

/** 能在界面里用起来：一次取回结果，或持续监听。 */
export const usable = (command: Command): boolean => {
  const a = availability(command)
  return a === 'run' || a === 'listen'
}

export function availability(command: Command): Availability {
  if (command.status === 'planned') return 'planned'
  if (listenable(command)) return 'listen'
  return runnable(command) ? 'run' : 'cli-only'
}

export interface Group {
  resource: string
  commands: Command[]
}

export function webEndpoint(platform: Platform): AvailableEndpoint | null {
  const ep = platform.endpoints.web
  return ep === 'planned' ? null : ep
}

/** 按 resource 分组，顺序与 `--help` 一致；auth 不在命令栏里出现（登录在终端里做）。 */
export function groupCommands(platform: Platform): Group[] {
  const ep = webEndpoint(platform)
  if (!ep) return []
  const groups = new Map<string, Command[]>()
  for (const c of sortCommands(ep.commands.values())) {
    if (c.resource === 'auth') continue
    const list = groups.get(c.resource) ?? []
    list.push(c)
    groups.set(c.resource, list)
  }
  return [...groups].map(([resource, commands]) => ({ resource, commands }))
}

export interface PlatformRow {
  platform: Platform
  /** 已实现的 web 端命令数（不含 auth）。 */
  implemented: number
  /** 免登录可用：web 端所有已实现的命令都不要求登录。 */
  open: boolean
  /** 当前账号名；没有为 null。 */
  account: string | null
  loggedIn: boolean
}

export async function platformRows(platforms: Platform[] = PLATFORMS): Promise<PlatformRow[]> {
  return Promise.all(
    platforms.map(async (platform) => {
      const ep = webEndpoint(platform)
      const commands = ep ? [...ep.commands.values()].filter((c) => c.resource !== 'auth' && c.status === 'implemented') : []
      const current = ep ? await getCurrent(platform.id, 'web').catch(() => null) : null
      return {
        platform,
        implemented: commands.length,
        open: commands.length > 0 && commands.every((c) => c.auth === 'optional') && ep?.guest === true,
        account: current,
        loggedIn: current != null,
      }
    }),
  )
}

// ---- 参数表单 ----

export interface Field {
  /** 位置参数为 `<name>`，选项为 `--flag`。 */
  label: string
  kind: 'arg' | 'string' | 'number' | 'boolean' | 'enum' | 'array'
  required: boolean
  hint: string
  /** 选项的 camelCase 键；位置参数为 null。 */
  key: string | null
  values: readonly string[] | null
  default: unknown
}

/** 命令的表单字段：位置参数在前，选项在后；分页选项（--limit 等）单独处理，不进表单。 */
export function fields(command: Command): Field[] {
  const out: Field[] = command.args.map((a) => ({
    label: `<${a.name}>`,
    kind: 'arg',
    required: !a.optional,
    hint: a.summary,
    key: null,
    values: null,
    default: a.default ?? null,
  }))
  for (const [key, schema] of Object.entries(command.options)) {
    if (key in PAGING) continue
    const info = describeOption(schema)
    out.push({
      label: `--${flagName(key)}`,
      kind: info.values ? 'enum' : info.kind,
      required: false,
      hint: info.description ?? '',
      key,
      values: info.values,
      default: info.default ?? null,
    })
  }
  return out
}

export type FormValue = string | boolean | undefined

/** 把表单值拼成等价的 CLI 命令（AGENTS 4.13）。含空格或特殊字符的值按平台 shell 加引号。 */
export function cliLine(platform: Platform, command: Command, values: Record<string, FormValue>, limit?: number): string {
  const parts = ['catbus', platform.id, command.resource, command.action]
  const shell = process.platform === 'win32' ? 'win' : 'posix'
  for (const f of fields(command)) {
    if (f.kind === 'arg') {
      const v = values[f.label]
      if (typeof v === 'string' && v !== '') parts.push(quote(v, shell))
      else parts.push(f.label)
    }
  }
  for (const f of fields(command)) {
    if (f.kind === 'arg') continue
    const v = values[f.label]
    if (v === undefined || v === '' || v === false) continue
    if (f.default != null && String(v) === String(f.default)) continue
    parts.push(f.label)
    if (v !== true) parts.push(quote(String(v), shell))
  }
  if (limit != null && command.paged) parts.push('--limit', String(limit))
  return parts.join(' ')
}

/**
 * 用已经确定的位置参数和选项拼等价命令（结果页的“下一步”、监听页用）。选项键是 camelCase，转成 --kebab-case；
 * 布尔 true 只写选项名，false / 空值不写。
 */
export function cliFromInvocation(platform: Platform, command: Command, words: string[], given: Record<string, unknown>): string {
  const shell = process.platform === 'win32' ? 'win' : 'posix'
  const parts = ['catbus', platform.id, command.resource, command.action, ...words.map((w) => quote(w, shell))]
  for (const [key, value] of Object.entries(given)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    if (key === 'cursor') continue
    parts.push(`--${flagName(key)}`)
    if (value !== true) parts.push(...(Array.isArray(value) ? value : [value]).map((v) => quote(String(v), shell)))
  }
  return parts.join(' ')
}

/** 够安全的字符不加引号；否则 posix 用单引号，Windows 用双引号（PowerShell 和 cmd 都认）。 */
export function quote(value: string, shell: 'posix' | 'win'): string {
  // 字母（含中日韩）、数字和常见的安全符号不加引号；空格、引号、$、&、| 等对 shell 有意义的都加
  if (/^[\p{L}\p{N}_@%+=:,./-]+$/u.test(value)) return value
  if (shell === 'win') return `"${value.replace(/"/g, '\\"')}"`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** 表单值 → handler 需要的位置参数列表和选项对象（校验由 exec.validate 做）。 */
export function toInvocation(command: Command, values: Record<string, FormValue>): { words: string[]; given: Record<string, unknown> } {
  const words: string[] = []
  const given: Record<string, unknown> = {}
  for (const f of fields(command)) {
    const v = values[f.label]
    if (f.kind === 'arg') {
      if (typeof v === 'string' && v !== '') words.push(v)
      continue
    }
    if (v === undefined || v === '' || v === false) continue
    if (f.key == null) continue
    given[f.key] = f.kind === 'number' ? Number(v) : f.kind === 'array' ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : v
  }
  return { words, given }
}
