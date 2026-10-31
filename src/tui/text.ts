import stringWidth from 'string-width'

// 终端单元格宽度计算（AGENTS 4.13）。中文占 2 列，所以不能用 string.length 对齐。

export const width = (s: string): number => stringWidth(s)

/** 截到最多 max 列，放不下时以省略号结尾。省略号本身占 1 列（ASCII 模式下 3 列）。 */
export function clip(s: string, max: number, ellipsis = '…'): string {
  if (max <= 0) return ''
  if (width(s) <= max) return s
  const room = max - width(ellipsis)
  if (room <= 0) return ellipsis.slice(0, max)
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = width(ch)
    if (used + w > room) break
    out += ch
    used += w
  }
  return out + ellipsis
}

/** 左对齐补空格到 cols 列；超出则截断。 */
export function padEnd(s: string, cols: number, ellipsis = '…'): string {
  const c = clip(s, cols, ellipsis)
  return c + ' '.repeat(Math.max(0, cols - width(c)))
}

/** 右对齐补空格到 cols 列；超出则截断（保留左侧）。 */
export function padStart(s: string, cols: number, ellipsis = '…'): string {
  const c = clip(s, cols, ellipsis)
  return ' '.repeat(Math.max(0, cols - width(c))) + c
}

/** 数字缩写：12000 → 1.2万，100000000 → 1.0亿；null → "-"。 */
export function count(n: number | null | undefined): string {
  if (n == null) return '-'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(n)
}

/** 时刻 `HH:mm:ss`（本地时间）。解析不了就用 fallback（事件没带时间时用收到的时间）。 */
export function clock(iso: string | null | undefined, fallback: Date = new Date()): string {
  const parsed = iso ? new Date(iso) : null
  const d = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** ISO 时间 → 本地 `YYYY-MM-DD HH:mm`；解析不了就原样返回。 */
export function when(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
