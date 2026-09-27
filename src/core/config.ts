import { parse, stringify } from 'smol-toml'
import { CatbusError } from './errors.js'
import { readTextIfExists, writeFileAtomic } from './fsutil.js'
import { configFile } from './paths.js'

/** config.toml（AGENTS 5.5）：proxy、timeout、<platform>.proxy。 */

export const DEFAULT_TIMEOUT = 30
const PROXY_SCHEMES = ['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:']
const KEYS_HINT = '可用的配置项：proxy、timeout、<platform>.proxy'

type Table = Record<string, unknown>

export function checkProxy(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CatbusError('USAGE', `代理地址不合法：${value}`, { hint: '例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080' })
  }
  if (!PROXY_SCHEMES.includes(url.protocol)) {
    throw new CatbusError('USAGE', `不支持的代理协议：${url.protocol}`, { hint: '支持 http、https、socks4、socks5、socks5h' })
  }
  return value
}

function checkTimeout(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new CatbusError('USAGE', `timeout 必须是大于 0 的秒数：${String(value)}`)
  }
  return n
}

/**
 * 解析配置键，平台段用规范 id。`resolvePlatform` 把平台 id 或别名映射成规范 id。
 */
export function parseKey(key: string, resolvePlatform: (name: string) => string | undefined): [string] | [string, 'proxy'] {
  if (key === 'proxy' || key === 'timeout') return [key]
  const m = /^([^.]+)\.proxy$/.exec(key)
  const id = m && resolvePlatform(m[1]!)
  if (!id) throw new CatbusError('USAGE', `未知的配置项：${key}`, { hint: KEYS_HINT })
  return [id, 'proxy']
}

export async function loadConfig(): Promise<Table> {
  const file = configFile()
  const text = await readTextIfExists(file)
  if (text == null) return {}
  try {
    return parse(text) as Table
  } catch (err) {
    throw new CatbusError('ERROR', `config.toml 格式错误：${(err as Error).message.split('\n')[0]}`, { hint: file })
  }
}

async function saveConfig(config: Table): Promise<void> {
  await writeFileAtomic(configFile(), stringify(config) + '\n')
}

function lookup(config: Table, path: string[]): unknown {
  let v: unknown = config
  for (const k of path) v = v && typeof v === 'object' ? (v as Table)[k] : undefined
  return v ?? null
}

export async function getConfig(path: string[]): Promise<unknown> {
  return lookup(await loadConfig(), path)
}

export async function setConfig(path: string[], raw: string): Promise<{ key: string; value: unknown }> {
  const key = path.join('.')
  const value = key === 'timeout' ? checkTimeout(raw) : checkProxy(raw)
  const config = await loadConfig()
  if (path.length === 1) config[path[0]!] = value
  else {
    const table = config[path[0]!]
    config[path[0]!] = { ...(table && typeof table === 'object' ? table : {}), [path[1]!]: value }
  }
  await saveConfig(config)
  return { key, value }
}

export async function unsetConfig(path: string[]): Promise<{ key: string; value: null }> {
  const config = await loadConfig()
  if (path.length === 1) delete config[path[0]!]
  else {
    const table = config[path[0]!] as Table | undefined
    if (table && typeof table === 'object') {
      delete table[path[1]!]
      if (Object.keys(table).length === 0) delete config[path[0]!]
    }
  }
  await saveConfig(config)
  return { key: path.join('.'), value: null }
}

/** 所有已设置的项，键用点号展开，例如 `{ "proxy": "...", "xhs.proxy": "..." }`。 */
export async function listConfig(): Promise<Table> {
  const out: Table = {}
  const walk = (table: Table, prefix: string) => {
    for (const [k, v] of Object.entries(table)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) walk(v as Table, `${prefix}${k}.`)
      else out[prefix + k] = v
    }
  }
  walk(await loadConfig(), '')
  return out
}

/** 一次调用的网络设置。代理优先级：--proxy > <platform>.proxy > proxy；不读 HTTP(S)_PROXY。 */
export async function resolveNetwork(platform: string, cliProxy: string | undefined): Promise<{ proxy: string | null; timeout: number }> {
  const config = await loadConfig()
  const fromFile = (path: string[]) => {
    const v = lookup(config, path)
    if (v == null) return null
    if (typeof v !== 'string') throw new CatbusError('ERROR', `config.toml 里的 ${path.join('.')} 必须是字符串`, { hint: configFile() })
    return checkProxy(v)
  }
  const proxy = cliProxy != null ? checkProxy(cliProxy) : (fromFile([platform, 'proxy']) ?? fromFile(['proxy']))
  const t = lookup(config, ['timeout'])
  return { proxy, timeout: t == null ? DEFAULT_TIMEOUT : checkTimeout(t) }
}
