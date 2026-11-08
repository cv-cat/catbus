import { checkAccountName } from '../core/auth-store.js'
import { describeOption, flagName, type OptionKind } from '../core/options.js'
import { type Command, ENDPOINTS, type Endpoint } from '../core/registry.js'
import { findPlatform } from '../platforms/index.js'
import type { EndpointName, OptionValue, RunRequest } from './shared/types.js'

/**
 * 校验浏览器提交的任务：只做「能安全地拼成 argv」所需的检查，语义校验交给 CLI 本身（AGENTS 4.13「执行」）。
 * 选项名必须是这条命令声明过的，防止借选项塞进 -y、-o 等全局选项。
 */

export class RequestError extends Error {}

/** 面板可以执行的全局命令。`ui` 自己不在其中。 */
const GLOBAL_COMMANDS: Record<string, readonly (string | null)[]> = {
  auth: ['list'],
  config: ['list', 'get', 'set', 'unset'],
  doctor: [null],
  version: [null],
  platforms: [null],
}

/** 全局命令允许的参数个数上限（config set <key> <value>）。 */
const GLOBAL_MAX_ARGS = 2

/** 执行的命令：平台命令带注册表里的声明，全局命令为 null。 */
export interface ResolvedRequest {
  request: RunRequest
  stdin: string | null
  track: boolean
  command: Command | null
}

/**
 * 是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 是否为字符串数组。
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}

/**
 * 取可选的字符串字段（null 表示没有）。
 */
function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  if (value == null) return null
  if (typeof value !== 'string') throw new RequestError(`${key} 必须是字符串`)
  return value
}

/**
 * 选项值与注册表声明的类型是否一致。
 */
function matchesKind(value: unknown, kind: OptionKind): value is OptionValue {
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'array') return isStringArray(value)
  return typeof value === 'string'
}

/**
 * 平台命令：命令存在，选项名都是它声明过的，类型一致，参数不多于声明的个数。
 * 端为 planned 时不在这里拦，交给 CLI 报 NOT_IMPLEMENTED。
 */
function checkPlatformCommand(request: RunRequest): Command | null {
  const platform = findPlatform(request.platform!)
  if (!platform || platform.id !== request.platform) throw new RequestError(`未知的平台：${request.platform}`)
  const ep = platform.endpoints[request.endpoint as Endpoint]
  if (ep === 'planned') {
    if (Object.keys(request.options).length) throw new RequestError(`${request.endpoint} 端尚未实现，不接受选项`)
    return null
  }
  const command = request.action == null ? undefined : ep.commands.get(`${request.resource} ${request.action}`)
  if (!command) throw new RequestError(`${platform.id} 没有命令 ${request.resource} ${request.action ?? ''}`.trim())
  const kinds = new Map(Object.keys(command.options).map((key) => [flagName(key), describeOption(command.options[key]!).kind]))
  for (const [flag, value] of Object.entries(request.options)) {
    const kind = kinds.get(flag)
    if (!kind) throw new RequestError(`选项 --${flag} 不适用于 ${platform.id} ${command.key}`)
    if (!matchesKind(value, kind)) throw new RequestError(`选项 --${flag} 的值类型不对，应为 ${kind}`)
  }
  if (request.args.length > command.args.length) throw new RequestError('参数个数多于命令声明的个数')
  return command
}

/**
 * 全局命令：只允许面板用得到的几个，不带选项。
 */
function checkGlobalCommand(request: RunRequest): void {
  const actions = GLOBAL_COMMANDS[request.resource]
  if (!actions || !actions.includes(request.action)) throw new RequestError(`面板不支持全局命令 ${request.resource} ${request.action ?? ''}`.trim())
  if (Object.keys(request.options).length) throw new RequestError('全局命令不接受选项')
  if (request.args.length > GLOBAL_MAX_ARGS) throw new RequestError('参数过多')
  if (request.account != null) throw new RequestError('全局命令不接受账号')
}

/**
 * 解析并校验 POST /api/jobs 的请求体。
 */
export function checkCreateJob(body: unknown): ResolvedRequest {
  if (!isRecord(body) || !isRecord(body.request)) throw new RequestError('请求体格式不对')
  const r = body.request
  const endpoint = r.endpoint
  if (typeof endpoint !== 'string' || !(ENDPOINTS as readonly string[]).includes(endpoint)) throw new RequestError('endpoint 不合法')
  if (typeof r.resource !== 'string' || !/^[a-z]+$/.test(r.resource)) throw new RequestError('resource 不合法')
  const action = optionalString(r, 'action')
  if (action != null && !/^[a-z]+$/.test(action)) throw new RequestError('action 不合法')
  if (!isStringArray(r.args)) throw new RequestError('args 必须是字符串数组')
  if (!isRecord(r.options)) throw new RequestError('options 必须是对象')
  for (const flag of Object.keys(r.options)) if (!/^[a-z][a-z0-9-]*$/.test(flag)) throw new RequestError(`选项名不合法：${flag}`)
  const request: RunRequest = {
    platform: optionalString(r, 'platform'),
    endpoint: endpoint as EndpointName,
    resource: r.resource,
    action,
    args: r.args,
    options: r.options as Record<string, OptionValue>,
    account: optionalString(r, 'account'),
    raw: r.raw === true,
    verbose: r.verbose === true,
    proxy: optionalString(r, 'proxy'),
    yes: r.yes === true,
  }
  if (request.account != null) {
    try {
      checkAccountName(request.account, { allowGuest: true })
    } catch (err) {
      throw new RequestError((err as Error).message)
    }
  }
  const command = request.platform == null ? (checkGlobalCommand(request), null) : checkPlatformCommand(request)
  if (request.options.cookie != null && request.options.cookie !== '-') {
    throw new RequestError('登录信息请填写在专用输入框中，不要放进命令参数')
  }
  return { request, stdin: optionalString(body, 'stdin'), track: body.track !== false, command }
}

/**
 * 可以停止的任务：长连接命令与 auth login（等待扫码、授权）。
 */
export function isStoppable(command: Command | null): boolean {
  return command != null && (command.stream === true || command.key === 'auth login')
}
