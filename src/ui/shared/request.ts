import type { EndpointName, RunRequest } from './types.js'

/**
 * RunRequest → catbus argv，以及页面上展示的等价命令。浏览器与服务端共用，保证页面上看到的就是实际执行的。
 */

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

/**
 * 会被 parseArgs 当成选项的词：以 - 开头且不只是一个 -。
 */
export function looksLikeOption(word: string): boolean {
  return word.length > 1 && word.startsWith('-')
}

/**
 * 一个选项值对应的 argv 词：值像选项时写成 --flag=value（AGENTS 4.9）。
 */
function optionWords(flag: string, value: string): string[] {
  return looksLikeOption(value) ? [`--${flag}=${value}`] : [`--${flag}`, value]
}

/**
 * 请求对应的 argv（不含 `catbus` 本身和输出格式）。参数里有像选项的词时，参数放到 `--` 之后。
 */
export function toArgv(request: RunRequest, defaultEndpoint: EndpointName = 'web'): string[] {
  const words = [request.platform, request.resource, request.action].filter((w): w is string => w != null)
  const flags: string[] = []
  for (const [flag, value] of Object.entries(request.options)) {
    if (value === false) continue
    if (value === true) flags.push(`--${flag}`)
    else for (const v of Array.isArray(value) ? value : [String(value)]) flags.push(...optionWords(flag, v))
  }
  if (request.account) flags.push('-a', request.account)
  if (request.endpoint !== defaultEndpoint) flags.push('-e', request.endpoint)
  if (request.proxy) flags.push(...optionWords('proxy', request.proxy))
  if (request.raw) flags.push('--raw')
  if (request.verbose) flags.push('-v')
  if (request.yes) flags.push('-y')
  const args = request.args
  return args.some(looksLikeOption) ? [...words, ...flags, '--', ...args] : [...words, ...args, ...flags]
}

/**
 * POSIX shell 的单引号转义。
 */
export function shellQuote(word: string): string {
  return SHELL_SAFE.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * 页面上展示、可复制的等价命令。
 */
export function displayCommand(request: RunRequest, defaultEndpoint: EndpointName = 'web'): string {
  return ['catbus', ...toArgv(request, defaultEndpoint)].map(shellQuote).join(' ')
}
