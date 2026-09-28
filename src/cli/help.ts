import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeOption, flagName } from '../core/options.js'
import { PACKAGE_ROOT } from '../core/paths.js'
import { type AvailableEndpoint, type Command, ENDPOINTS, type Endpoint, type Platform, sortCommands } from '../core/registry.js'
import { PLATFORMS } from '../platforms/index.js'

/** 帮助（AGENTS 4.10）：内容由注册表生成，写到 stdout。 */

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/

function width(s: string): number {
  let w = 0
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1
  return w
}

/** 按显示宽度对齐的多列文本，最后一列不补空格。 */
function table(rows: string[][], indent = '  '): string {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, width(cell))))
  return rows
    .map((row) => {
      const cells = row.map((cell, i) => (i === row.length - 1 ? cell : cell + ' '.repeat(widths[i]! - width(cell))))
      return (indent + cells.join('  ')).trimEnd()
    })
    .join('\n')
}

const GLOBAL_OPTIONS = [
  ['-a, --account <name>', '使用哪个账号'],
  ['-e, --endpoint <端>', 'web | app | pc，默认 web'],
  ['-o, --output <格式>', 'json | jsonl，默认 json'],
  ['    --raw', '用平台原始对象代替归一化对象'],
  ['    --proxy <url>', '本次调用使用的代理'],
  ['-v, --verbose', '在 stderr 输出调试日志（已脱敏）'],
  ['-q, --quiet', '不输出提示和进度，只保留错误'],
  ['-y, --yes', '跳过危险操作的确认'],
  ['-h, --help', '帮助'],
  ['    --version', '版本信息'],
]

export function rootHelp(): string {
  const banner = readFileSync(join(PACKAGE_ROOT, 'assets', 'banner.txt'), 'utf8').trimEnd()
  const platforms = PLATFORMS.map((p) => [p.id, p.name, p.aliases.length ? `别名 ${p.aliases.join('、')}` : ''])
  return [
    banner,
    '',
    '用法:',
    '  catbus <platform> <resource> <action> [参数...] [选项...]',
    '  catbus <全局命令>',
    '',
    '平台:',
    table(platforms),
    '',
    '全局命令:',
    table([
      ['platforms [platform]', '能力矩阵：平台 × 端 × 命令的状态'],
      ['doctor', '检查运行环境'],
      ['auth list', '所有平台、所有端的账号'],
      ['config get|set|unset|list', '读写配置（~/.catbus/config.toml）'],
      ['version', '版本、Node 版本、系统与架构'],
    ]),
    '',
    '全局选项:',
    table(GLOBAL_OPTIONS),
    '',
    '示例:',
    '  catbus xhs item get "https://www.xiaohongshu.com/explore/<id>?xsec_token=..."',
    '  catbus bilibili item get BV1xx411c7mD',
    '  catbus douyin comment list <item> --limit 100',
    '  catbus xhs auth login',
    '',
    '平台的命令：catbus <platform> --help',
  ].join('\n')
}

function endpointsLine(platform: Platform): string {
  return ENDPOINTS.map((e) => (platform.endpoints[e] === 'planned' ? `${e} ○ planned` : `${e} ✓`)).join(' · ')
}

function title(platform: Platform): string {
  const aliases = platform.aliases.length ? `   别名：${platform.aliases.join('、')}` : ''
  return `${platform.name} (${platform.id})${aliases}`
}

/** 请求的端还是 planned 时，列出 web 端的命令作参考。 */
function listedEndpoint(platform: Platform, endpoint: Endpoint): { ep: AvailableEndpoint; notice: string | null } {
  const ep = platform.endpoints[endpoint]
  if (ep !== 'planned') return { ep, notice: null }
  return {
    ep: platform.endpoints.web as AvailableEndpoint,
    notice: `${endpoint} 端尚未实现，所有命令都返回 NOT_IMPLEMENTED。下面是 web 端的命令。`,
  }
}

export function platformHelp(platform: Platform, endpoint: Endpoint): string {
  const { ep, notice } = listedEndpoint(platform, endpoint)
  const login = ep.login.methods.map((m) => (m === ep.login.default ? `${m}（默认）` : m)).join(' · ')
  const scopes = ep.login.scopes?.length ? `；子站点：${ep.login.scopes.join('、')}` : ''
  const groups = new Map<string, string[]>()
  for (const c of sortCommands(ep.commands.values())) {
    const list = groups.get(c.resource) ?? groups.set(c.resource, []).get(c.resource)!
    list.push(c.status === 'planned' ? `${c.action}○` : c.action)
  }
  return [
    title(platform),
    `端:   ${endpointsLine(platform)}`,
    `登录: ${login}${scopes}`,
    '',
    `用法: catbus ${platform.id} <resource> <action> [参数...] [选项...]`,
    '',
    ...(notice ? [notice, ''] : []),
    '命令（带 ○ 的是规划中，执行时返回 NOT_IMPLEMENTED）:',
    table([...groups].map(([r, actions]) => [r, actions.join(' ')])),
    '',
    `命令详情：catbus ${platform.id} <resource> --help`,
  ].join('\n')
}

export function resourceHelp(platform: Platform, endpoint: Endpoint, resource: string): string {
  const { ep, notice } = listedEndpoint(platform, endpoint)
  const commands = sortCommands([...ep.commands.values()].filter((c) => c.resource === resource))
  const label = resource === 'item' ? `item（${platform.item}）` : resource
  return [
    `${platform.name} (${platform.id}) · ${label}`,
    '',
    ...(notice ? [notice, ''] : []),
    table(commands.map((c) => [c.action, c.summary, c.status === 'planned' ? '○ 规划中' : ''])),
    '',
    `用法: catbus ${platform.id} ${resource} <action> [参数...] [选项...]`,
    `命令详情：catbus ${platform.id} ${resource} <action> --help`,
  ].join('\n')
}

const UPSTREAM_TEXT = { full: '✓ 上游已有', partial: '◐ 上游部分支持', none: '○ 上游没有，规划中' }

function optionUsage(key: string, command: Command): string {
  const info = describeOption(command.options[key]!)
  const flag = `--${flagName(key)}`
  if (info.kind === 'boolean') return flag
  if (info.values) return `${flag} <${info.values.join('|')}>`
  return `${flag} <${info.kind === 'number' ? 'n' : '值'}>`
}

export function commandHelp(platform: Platform, endpoint: Endpoint, command: Command): string {
  const p = platform.id
  const e = endpoint === 'web' ? '' : ` -e ${endpoint}`
  const argUsage = command.args.map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`))
  const optionKeys = Object.keys(command.options)
  const requiredOptions = optionKeys.filter((k) => describeOption(command.options[k]!).required)
  const endpoints = ENDPOINTS.map((name) => {
    const ep = platform.endpoints[name]
    if (ep === 'planned') return `${name} ○ planned`
    const c = ep.commands.get(command.key)
    return !c ? `${name} —` : c.status === 'planned' ? `${name} ○ planned` : `${name} ✓`
  })
  const confirm = command.confirm === true ? '危险操作，执行前需要确认；-y 跳过' : command.confirm ? '部分情况需要确认（见选项）；-y 跳过' : null

  const lines = [
    `用法: catbus ${p} ${command.key}${argUsage.map((a) => ' ' + a).join('')}${optionKeys.length ? ' [选项...]' : ''}`,
    '',
    command.summary,
    '',
    `端:   ${endpoints.join(' · ')}`,
    `登录: ${command.auth === 'required' ? '需要' : '可选'}`,
    `上游: ${command.upstream ? UPSTREAM_TEXT[command.upstream] : 'core 实现'}`,
    ...(command.note ? [`说明: ${command.note}`] : []),
    ...(confirm ? [`确认: ${confirm}`] : []),
    `输出: ${command.output}${command.paged ? '，分页' : ''}${command.stream ? '，持续输出 jsonl' : ''}`,
  ]
  if (command.args.length) {
    lines.push('', '参数:')
    lines.push(table(command.args.map((a) => [a.optional ? `[${a.name}]` : `<${a.name}>`, a.summary])))
  }
  lines.push('', '选项:')
  if (optionKeys.length) {
    lines.push(
      table(
        optionKeys.map((k) => {
          const info = describeOption(command.options[k]!)
          const notes = [
            info.required ? '必填' : null,
            info.default !== undefined ? `默认 ${String(info.default)}` : null,
            info.kind === 'array' ? '可重复' : null,
          ].filter(Boolean)
          return [optionUsage(k, command), `${info.description ?? ''}${notes.length ? `（${notes.join('，')}）` : ''}`]
        }),
      ),
    )
  }
  lines.push('  全局选项见 catbus --help')
  const example = [`catbus ${p} ${command.key}`, ...command.args.filter((a) => !a.optional).map((a) => `<${a.name}>`)]
  for (const k of requiredOptions) example.push(optionUsage(k, command))
  lines.push('', '示例:', `  ${example.join(' ')}${e}`)
  return lines.join('\n')
}

export const GLOBAL_HELP: Record<string, string> = {
  platforms: [
    '用法: catbus platforms [platform]',
    '',
    '能力矩阵：每个平台的端、命令、登录要求、状态（implemented / planned）和上游支持程度。',
    '带平台参数时只输出这个平台。',
  ].join('\n'),
  doctor: [
    '用法: catbus doctor',
    '',
    '逐项检查运行环境：Node 版本、~/.catbus 权限、签名 vm、HTTP 库、canvas、onnx、京东模型包。',
    '有检查项不通过时退出码为 1，data 里仍是完整的检查结果。',
  ].join('\n'),
  auth: [
    '用法: catbus auth list',
    '',
    '列出所有平台、所有端的账号。',
    '登录、切换、登出请在平台下操作：',
    '  catbus <platform> auth login|status|logout|list|use',
  ].join('\n'),
  config: [
    '用法:',
    '  catbus config get <key>',
    '  catbus config set <key> <value>',
    '  catbus config unset <key>',
    '  catbus config list',
    '',
    '配置项:',
    table([
      ['proxy', '全局代理，例如 http://127.0.0.1:7890、socks5://127.0.0.1:1080'],
      ['timeout', '单次请求超时（秒），默认 30'],
      ['<platform>.proxy', '平台代理，例如 xhs.proxy'],
    ]),
    '',
    '代理的优先级：--proxy > <platform>.proxy > proxy。不读取 HTTP(S)_PROXY 环境变量。',
  ].join('\n'),
  version: ['用法: catbus version（或 catbus --version）', '', '输出 catbus 版本、Node 版本、系统与架构。'].join('\n'),
}
