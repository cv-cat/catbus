import { copyText } from '@/stores/toast'

/**
 * 复制等价命令（AGENTS.md 7.9「复制等价命令」）：页面发请求用的 argv → 可以粘到终端里的 `catbus ...`。
 * 去掉 `--cursor`（续翻位置只对这次会话有意义），保留 `-a`、`--limit`；`--` 之后是位置参数。
 */
const SAFE = /^[\w@%+=:,./-]+$/

/** POSIX shell 的单引号写法；不需要引号的原样返回 */
export function shellQuote(v: string): string {
  if (v && SAFE.test(v)) return v
  return `'${v.replace(/'/g, `'\\''`)}'`
}

/**
 * argv 的写法有两种：bridge 规范化后的 `[p, r, a, ...选项, '--', ...位置参数]`，
 * 或页面拼的 `[p, r, a, 位置参数?, ...选项]`（位置参数由调用方用 `positional` 给出个数）。
 */
export function toCommand(argv: string[], positional = 0): string {
  const [p, r, a, ...rest] = argv
  let pos: string[] = []
  let opts: string[] = rest
  const dd = rest.indexOf('--')
  if (dd >= 0) {
    pos = rest.slice(dd + 1)
    opts = rest.slice(0, dd)
  } else if (positional) {
    pos = rest.slice(0, positional)
    opts = rest.slice(positional)
  }
  const kept: string[] = []
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === '--cursor') {
      i++
      continue
    }
    kept.push(opts[i]!)
  }
  const head = ['catbus', p!, r!, a!].filter(Boolean)
  const args = pos.some((v) => v.startsWith('-')) ? ['--', ...pos] : pos
  // 位置参数在前、选项在后（与 AGENTS.md 4.1 的示例一致）；以 - 开头的位置参数放到 -- 之后、选项之后
  const parts = args[0] === '--' ? [...head, ...kept, ...args] : [...head, ...args, ...kept]
  return parts.map((v, i) => (i < 4 ? v : shellQuote(v))).join(' ')
}

/** 复制并提示（copyText 自己会提示「已复制」） */
export const copyCommand = (cmd: string) => copyText(cmd)
