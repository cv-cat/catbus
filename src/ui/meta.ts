import { describeOption, flagName, PAGING, STANDARD_OPTIONS } from '../core/options.js'
import { packageJson } from '../core/paths.js'
import { type Command, ENDPOINTS, type Platform, sortCommands } from '../core/registry.js'
import { PLATFORMS } from '../platforms/index.js'
import type { CommandMeta, ConfirmKind, EndpointMeta, OptionGroup, OptionMeta, PanelMeta, PlatformMeta } from './shared/types.js'

/**
 * 面板的表单、导航都由注册表生成（AGENTS 4.13「表单」），与 --help 同源。
 */

/** auth login 的 --method / --scope 由 core 按端的登录声明生成，按标准选项归类。 */
const CORE_LOGIN_OPTIONS = ['method', 'scope']

/**
 * 选项分组：翻页、标准选项、平台私有选项。
 */
function optionGroup(key: string): OptionGroup {
  if (key in PAGING) return 'paging'
  return key in STANDARD_OPTIONS || CORE_LOGIN_OPTIONS.includes(key) ? 'standard' : 'private'
}

/**
 * 命令的危险操作确认方式。
 */
function confirmKind(command: Command): ConfirmKind {
  if (typeof command.confirm === 'function') return 'conditional'
  return command.confirm === true ? 'always' : 'never'
}

/**
 * 默认值只保留能放进 JSON、表单能展示的标量。
 */
function scalarDefault(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

/**
 * 注册表里的一个选项 → 表单字段描述。
 */
function optionMeta(key: string, command: Command): OptionMeta {
  const info = describeOption(command.options[key]!)
  return {
    flag: flagName(key),
    kind: info.kind,
    required: info.required,
    default: scalarDefault(info.default),
    values: info.values ? [...info.values] : null,
    description: info.description,
    group: optionGroup(key),
  }
}

/**
 * 注册表里的一条命令 → 面板的命令描述。
 */
export function commandMeta(command: Command): CommandMeta {
  return {
    resource: command.resource,
    action: command.action,
    summary: command.summary,
    args: command.args.map((a) => ({ name: a.name, summary: a.summary, optional: a.optional ?? false, default: a.default ?? null })),
    options: Object.keys(command.options).map((key) => optionMeta(key, command)),
    auth: command.auth,
    output: command.output,
    paged: command.paged ?? false,
    stream: command.stream ?? false,
    confirm: confirmKind(command),
    status: command.status,
    upstream: command.upstream,
    note: command.note,
    extension: command.extension,
  }
}

/**
 * 一个平台的面板描述：各端的登录方式与命令。
 */
export function platformMeta(platform: Platform): PlatformMeta {
  const endpoints = {} as Record<(typeof ENDPOINTS)[number], EndpointMeta>
  for (const endpoint of ENDPOINTS) {
    const ep = platform.endpoints[endpoint]
    endpoints[endpoint] =
      ep === 'planned'
        ? { status: 'planned' }
        : {
            status: 'available',
            label: ep.label,
            guest: ep.guest,
            login: { methods: [...ep.login.methods], default: ep.login.default ?? null, scopes: [...(ep.login.scopes ?? [])] },
            commands: sortCommands(ep.commands.values()).map(commandMeta),
          }
  }
  return { id: platform.id, name: platform.name, aliases: platform.aliases, item: platform.item, defaultEndpoint: platform.defaultEndpoint, endpoints }
}

/**
 * 面板启动时下发给浏览器的全部元数据。
 */
export function panelMeta(cwd: string): PanelMeta {
  return { version: packageJson().version, cwd, platforms: PLATFORMS.map(platformMeta) }
}
