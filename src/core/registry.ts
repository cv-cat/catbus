import { z } from 'zod'
import type { Logger } from './log.js'
import { type LoginMethod, PAGING } from './options.js'
import { type Credential, OUTPUT_TYPES } from './schemas.js'
import { type Args, type CommandSpec, CORE_COMMANDS, type Options, RESOURCES, VOCAB } from './vocab.js'

export const ENDPOINTS = ['web', 'app', 'pc'] as const
export type Endpoint = (typeof ENDPOINTS)[number]

/** 上游支持程度：矩阵里的 ✓ / ◐ / ○。 */
export type Upstream = 'full' | 'partial' | 'none'
export type Status = 'implemented' | 'planned'

export interface Page {
  cursor: string | null
  has_more: boolean
}

export interface HandlerContext {
  platform: Platform
  endpoint: Endpoint
  resource: string
  action: string
  args: Args
  options: Options
  /** 账号名，游客为 `guest`。auth 命令没有 -a、也没有当前账号时为 null。 */
  account: string | null
  /** 当前身份的凭证；游客时为 guest.json（可能还没生成）。 */
  credential: Credential | null
  /** 分页命令本次要取的页，第一页为 `--cursor` 或 null。 */
  cursor: string | null
  raw: boolean
  config: { proxy: string | null; timeout: number }
  log: Logger
  /** 长连接命令结束时（Ctrl-C、--duration 到期）触发。 */
  signal: AbortSignal
  /** 凭证只由 core 落盘：平台更新凭证后交回这里。 */
  saveCredential(credential: Credential): Promise<void>
}

/**
 * 普通命令返回 data；分页命令返回 `{ data, page }`，由 core 按 `--limit` / `--all` 翻页；
 * 长连接命令返回 AsyncIterable，由 core 处理 `--duration` 和 Ctrl-C。
 */
export type Handler = (ctx: HandlerContext) => Promise<unknown> | AsyncIterable<unknown>
export type HandlerLoader = () => Promise<Handler>

export interface CommandDecl extends Partial<CommandSpec> {
  upstream: Upstream
  note?: string
  handler?: HandlerLoader
}

export interface LoginDecl {
  methods: LoginMethod[]
  default: LoginMethod
  /** 需要单独登录的子站点。 */
  scopes?: string[]
}

export interface EndpointDecl {
  login: LoginDecl
  /** 词表里的命令可以只写 `'full' | 'partial' | 'none'`；矩阵里 — 的命令不写。 */
  commands: Record<string, Upstream | CommandDecl>
}

export interface PlatformDecl {
  id: string
  name: string
  aliases: string[]
  /** item 在该平台的叫法，替换 summary 里的 `{item}`。 */
  item: string
  /** 自动翻页的间隔（毫秒），默认 1000。 */
  pageInterval?: number
  endpoints: Record<Endpoint, EndpointDecl | 'planned'>
}

export interface Command extends CommandSpec {
  key: string
  resource: string
  action: string
  /** core 实现的命令（auth list / use / logout）为 null。 */
  upstream: Upstream | null
  note: string | null
  status: Status
  /** 不在第 4.5 节词表里的平台扩展。 */
  extension: boolean
  handler: HandlerLoader | null
}

export interface AvailableEndpoint {
  login: LoginDecl
  commands: Map<string, Command>
}

export interface Platform {
  id: string
  name: string
  aliases: string[]
  item: string
  pageInterval: number
  endpoints: Record<Endpoint, AvailableEndpoint | 'planned'>
}

const coreHandler = (name: 'list' | 'use' | 'logout'): HandlerLoader => () =>
  import('./auth-handlers.js').then((m) => m[name])

export function definePlatform(decl: PlatformDecl): Platform {
  const endpoints = {} as Platform['endpoints']
  for (const endpoint of ENDPOINTS) {
    const e = decl.endpoints[endpoint]
    endpoints[endpoint] = e === 'planned' ? 'planned' : { login: e.login, commands: resolveCommands(decl, e) }
  }
  return {
    id: decl.id,
    name: decl.name,
    aliases: decl.aliases,
    item: decl.item,
    pageInterval: decl.pageInterval ?? 1000,
    endpoints,
  }
}

function resolveCommands(decl: PlatformDecl, e: EndpointDecl): Map<string, Command> {
  const commands = new Map<string, Command>()
  const fail = (key: string, message: string) => {
    throw new Error(`注册表错误 ${decl.id} "${key}"：${message}`)
  }

  for (const [key, value] of Object.entries(e.commands)) {
    const parts = key.split(' ')
    if (parts.length !== 2 || !parts.every((p) => /^[a-z]+$/.test(p))) fail(key, '命令名必须是 "resource action"')
    if (CORE_COMMANDS.includes(key)) fail(key, '由 core 自动注册，不要声明')
    const d: CommandDecl = typeof value === 'string' ? { upstream: value } : value
    const base = VOCAB[key]
    if (!base) {
      for (const field of ['summary', 'args', 'auth', 'output'] as const) {
        if (d[field] === undefined) fail(key, `扩展命令必须写全字段，缺少 ${field}`)
      }
    }
    const spec = { ...base, ...d } as CommandSpec & CommandDecl
    const options: Record<string, z.ZodType> = { ...(spec.paged ? PAGING : {}), ...base?.options, ...d.options }
    if (key === 'auth login') {
      options.method = z.enum(e.login.methods).default(e.login.default).describe('登录方式')
      if (e.login.scopes?.length) options.scope = z.enum(e.login.scopes).optional().describe('子站点')
    }
    const output = spec.output.replace(/\[\]$/, '')
    if (!output.startsWith('{') && !OUTPUT_TYPES.has(output)) fail(key, `未知的输出类型 ${spec.output}`)

    commands.set(key, {
      ...spec,
      key,
      resource: parts[0]!,
      action: parts[1]!,
      summary: spec.summary.replaceAll('{item}', decl.item),
      args: spec.args.map((a) => ({ ...a, summary: a.summary.replaceAll('{item}', decl.item) })),
      options,
      note: d.note ?? null,
      status: d.handler ? 'implemented' : 'planned',
      extension: !base,
      handler: d.handler ?? null,
    })
  }

  for (const key of CORE_COMMANDS) {
    const [resource, action] = key.split(' ') as [string, 'list' | 'use' | 'logout']
    commands.set(key, {
      ...VOCAB[key]!,
      key,
      resource,
      action,
      upstream: null,
      note: null,
      status: 'implemented',
      extension: false,
      handler: coreHandler(action),
    })
  }
  return commands
}

const VOCAB_ORDER = new Map(Object.keys(VOCAB).map((k, i) => [k, i]))

/** 按词表顺序排列命令；扩展 action 排在同 resource 的词表命令之后，新增的 resource 排在最后。 */
export function sortCommands(commands: Iterable<Command>): Command[] {
  const list = [...commands]
  const extra = [...new Set(list.map((c) => c.resource).filter((r) => !RESOURCES.includes(r)))]
  const rank = (c: Command) => {
    const r = RESOURCES.indexOf(c.resource)
    return [r >= 0 ? r : RESOURCES.length + extra.indexOf(c.resource), VOCAB_ORDER.get(c.key) ?? Infinity] as const
  }
  return list
    .map((c, i) => ({ c, i, k: rank(c) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.c)
}
