import { getConfig, listConfig, parseKey, setConfig, unsetConfig } from '../../core/config.js'
import { CatbusError } from '../../core/errors.js'
import { findPlatform } from '../../platforms/index.js'

const resolvePlatform = (name: string) => findPlatform(name)?.id

const USAGE: Record<string, number> = { get: 1, set: 2, unset: 1, list: 0 }

export async function config(action: string, words: string[]): Promise<unknown> {
  const arity = USAGE[action]
  if (arity === undefined) {
    throw new CatbusError('USAGE', `未知的 config 子命令：${action}`, { hint: 'catbus config --help' })
  }
  if (words.length !== arity) {
    const usage = { get: 'get <key>', set: 'set <key> <value>', unset: 'unset <key>', list: 'list' }[action]
    throw new CatbusError('USAGE', `参数个数不对，用法：catbus config ${usage}`, { hint: 'catbus config --help' })
  }
  if (action === 'list') return listConfig()
  const path = parseKey(words[0]!, resolvePlatform)
  if (action === 'get') return getConfig(path)
  if (action === 'set') return setConfig(path, words[1]!)
  return unsetConfig(path)
}
