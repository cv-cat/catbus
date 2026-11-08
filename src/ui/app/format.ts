/**
 * 数字、时间、大小、价格的展示格式。缺失值统一显示为「—」，与 0 区分（intent-ui 数据表达）。
 */

export const MISSING = '—'

const WAN = 10_000
const YI = 100_000_000
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** 超过这么久的时间显示具体日期，而不是「x 天前」。 */
const RELATIVE_LIMIT_MS = 7 * DAY_MS
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
const BYTE_STEP = 1024

/**
 * 计数：1.2万、3.4亿。
 */
export function formatCount(value: number | null | undefined): string {
  if (value == null) return MISSING
  if (Math.abs(value) >= YI) return `${trim(value / YI)}亿`
  if (Math.abs(value) >= WAN) return `${trim(value / WAN)}万`
  return String(value)
}

/**
 * 保留一位小数并去掉多余的 .0。
 */
function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/**
 * 本地时间：2026-11-08 20:15。
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return MISSING
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 相对时间：刚刚、5 分钟前、3 小时前；一周以上显示日期。
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return MISSING
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const diff = now - time
  if (diff < 0 || diff >= RELATIVE_LIMIT_MS) return formatTime(iso)
  if (diff < MINUTE_MS) return '刚刚'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分钟前`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小时前`
  return `${Math.floor(diff / DAY_MS)} 天前`
}

/**
 * 时长（秒）：1:05、1:02:03。
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return MISSING
  const s = Math.round(seconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/**
 * 经过的时间（毫秒）：3.2 秒、1 分 05 秒。
 */
export function formatElapsed(ms: number): string {
  if (ms < MINUTE_MS) return `${(ms / SECOND_MS).toFixed(1)} 秒`
  return `${Math.floor(ms / MINUTE_MS)} 分 ${String(Math.floor((ms % MINUTE_MS) / SECOND_MS)).padStart(2, '0')} 秒`
}

/**
 * 字节数：1.5 MB。
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return MISSING
  let value = bytes
  let unit = 0
  while (value >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_STEP
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/**
 * 价格（AGENTS 6.2 Price）：人民币用 ¥，其他货币写代码。
 */
export function formatPrice(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return MISSING
  const fixed = Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
  return currency === 'CNY' || currency == null ? `¥${fixed}` : `${fixed} ${currency}`
}

/**
 * 中文短语接平台名：平台名以字母或数字开头时中间加空格（「登录 B 站」「登录小红书」）。
 */
export function withName(prefix: string, name: string): string {
  return /^[A-Za-z0-9]/.test(name) ? `${prefix} ${name}` : `${prefix}${name}`
}
