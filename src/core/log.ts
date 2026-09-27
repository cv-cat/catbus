const SENSITIVE = /cookie|token|authorization|password|secret|ticket|sessdata|ct0/i
const URL_USERINFO = /\/\/[^/\s:@]+:[^/\s@]+@/g
const COOKIE_HEADER = /\b((?:set-)?cookie)(["']?\s*:\s*)[^\n]*/gi
const SENSITIVE_PAIR = /\b(authorization|[\w-]*token|password|secret|ticket|sessdata|ct0)(["']?\s*[:=]\s*)((?:bearer|basic)\s+)?("[^"]*"|'[^']*'|[^\s,;&]+)/gi

/**
 * 给凭证打码：对象里键名敏感的值换成 ***；字符串里的 Cookie 头整行打码，key=value / key: value 只打码值，
 * URL 里的用户名密码（代理地址）也打码。
 */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(URL_USERINFO, '//***@').replace(COOKIE_HEADER, '$1$2***').replace(SENSITIVE_PAIR, '$1$2$3***')
  }
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) && v != null ? '***' : redact(v)
    return out
  }
  return value
}

export interface Logger {
  /** -v 时输出，已脱敏。 */
  debug(message: string, data?: unknown): void
  /** 提示与进度，-q 时不输出。 */
  info(message: string): void
  warn(message: string): void
}

export function createLogger(options: { verbose?: boolean; quiet?: boolean } = {}): Logger {
  const write = (line: string) => process.stderr.write(line + '\n')
  return {
    debug(message, data) {
      if (!options.verbose) return
      const suffix = data === undefined ? '' : ' ' + JSON.stringify(redact(data))
      write(`[catbus:debug] ${redact(message)}${suffix}`)
    },
    info(message) {
      if (!options.quiet) write(`[catbus] ${message}`)
    },
    warn(message) {
      write(`[catbus] 警告：${message}`)
    },
  }
}
