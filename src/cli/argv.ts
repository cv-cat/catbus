import { parseArgs, type ParseArgsOptionsConfig } from 'node:util'
import { CatbusError } from '../core/errors.js'
import { describeOption, flagName, type OptionKind, STANDARD_OPTIONS } from '../core/options.js'
import type { Platform } from '../core/registry.js'
import { VOCAB } from '../core/vocab.js'

export const GLOBAL_FLAGS = {
  account: { type: 'string', short: 'a' },
  endpoint: { type: 'string', short: 'e' },
  output: { type: 'string', short: 'o' },
  raw: { type: 'boolean' },
  proxy: { type: 'string' },
  verbose: { type: 'boolean', short: 'v' },
  quiet: { type: 'boolean', short: 'q' },
  yes: { type: 'boolean', short: 'y' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
} as const satisfies ParseArgsOptionsConfig

export interface GlobalFlags {
  account?: string
  endpoint?: string
  output?: string
  raw?: boolean
  proxy?: string
  verbose?: boolean
  quiet?: boolean
  yes?: boolean
  help?: boolean
  version?: boolean
}

export interface Parsed {
  positionals: string[]
  global: GlobalFlags
  /** 命令选项，键为 camelCase，只含用户给出的；数字已转换。 */
  options: Record<string, unknown>
}

/**
 * 汇总标准选项、词表和所有平台声明的选项。同名选项在不同命令里的类型必须一致，
 * 也不能与全局选项重名，否则启动时就报错。
 */
export function collectOptionKinds(platforms: Platform[]): Map<string, OptionKind> {
  const kinds = new Map<string, OptionKind>()
  const add = (key: string, schema: Parameters<typeof describeOption>[0], where: string) => {
    if (key in GLOBAL_FLAGS) throw new Error(`选项 --${flagName(key)}（${where}）与全局选项重名`)
    const kind = describeOption(schema).kind
    const prev = kinds.get(key)
    if (prev && prev !== kind) throw new Error(`选项 --${flagName(key)}（${where}）的类型 ${kind} 与别处的 ${prev} 不一致`)
    kinds.set(key, kind)
  }
  for (const [k, s] of Object.entries(STANDARD_OPTIONS)) add(k, s, '标准选项')
  for (const [key, spec] of Object.entries(VOCAB)) for (const [k, s] of Object.entries(spec.options)) add(k, s, key)
  for (const p of platforms) {
    for (const e of Object.values(p.endpoints)) {
      if (e === 'planned') continue
      for (const c of e.commands.values()) for (const [k, s] of Object.entries(c.options)) add(k, s, `${p.id} ${c.key}`)
    }
  }
  return kinds
}

export function parseArgv(argv: string[], kinds: Map<string, OptionKind>): Parsed {
  const config: ParseArgsOptionsConfig = { ...GLOBAL_FLAGS }
  const keyOf = new Map<string, string>()
  for (const [key, kind] of kinds) {
    const flag = flagName(key)
    keyOf.set(flag, key)
    config[flag] = { type: kind === 'boolean' ? 'boolean' : 'string', multiple: kind === 'array' }
  }

  let parsed
  try {
    parsed = parseArgs({ args: argv, options: config, strict: true, allowPositionals: true })
  } catch (err) {
    throw translate(err as NodeJS.ErrnoException)
  }

  const global: Record<string, unknown> = {}
  const options: Record<string, unknown> = {}
  for (const [flag, value] of Object.entries(parsed.values)) {
    if (flag in GLOBAL_FLAGS) {
      global[flag] = value
      continue
    }
    const key = keyOf.get(flag)!
    if (kinds.get(key) === 'number') {
      const n = Number(value)
      if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(n)) {
        throw new CatbusError('USAGE', `选项 --${flag} 需要一个数字，收到的是 ${String(value)}`)
      }
      options[key] = n
    } else options[key] = value
  }
  return { positionals: parsed.positionals, global, options }
}

function translate(err: NodeJS.ErrnoException): CatbusError {
  const quoted = /'([^']+)'/.exec(err.message)?.[1] ?? ''
  const flag = /--[\w-]+/.exec(quoted)?.[0] ?? /-\w/.exec(quoted)?.[0] ?? quoted
  switch (err.code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return new CatbusError('USAGE', `未知选项 ${flag}`, {
        hint: `以 - 开头的参数请放在 -- 之后，例如：-- "${flag}"`,
      })
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return /does not take an argument/.test(err.message)
        ? new CatbusError('USAGE', `选项 ${flag} 不接受值`)
        : new CatbusError('USAGE', `选项 ${flag} 缺少值`, { hint: `值以 - 开头时写成 ${flag}=<值>` })
    default:
      return new CatbusError('USAGE', err.message)
  }
}
