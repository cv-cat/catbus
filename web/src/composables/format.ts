import { currentLocale, t } from '@/i18n'

/**
 * 计数的简写：中文沿用平台的显示习惯（12000 → 1.2w，1.2 亿 → 1.2亿），
 * 其他语言用 Intl 的 compact 写法（12K、1.2万、1.2만）。
 */
export function compact(n: number | null | undefined): string {
  if (n == null) return '—'
  const loc = currentLocale()
  if (loc === 'zh-CN') {
    if (n >= 1e8) return `${trim(n / 1e8)}亿` // i18n-ignore
    if (n >= 1e4) return `${trim(n / 1e4)}w`
    return n.toLocaleString(loc)
  }
  if (n < 1e4) return n.toLocaleString(loc)
  return new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '')
}

/** 整数按当前语言加千分位：12000 → 12,000 */
export const number = (n: number) => n.toLocaleString(currentLocale())

/** 字节 → 「20.8 GB」（1024 进制，三位有效数字） */
export function bytes(n: number | null | undefined): string | null {
  if (n == null || n < 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 || v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

export function duration(sec: number | null | undefined): string | null {
  if (!sec) return null
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** ISO 时间 → 相对时间：「刚刚」「3 分钟前」「2 天前」，一个月以上给日期。按当前语言输出 */
export function since(iso: string | null | undefined): string {
  const t0 = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t0)) return ''
  const loc = currentLocale()
  const m = Math.max(0, Math.floor((Date.now() - t0) / 60_000))
  if (m < 1) return t('common.time.justNow')
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'always' })
  if (m < 60) return rtf.format(-m, 'minute')
  if (m < 1440) return rtf.format(-Math.floor(m / 60), 'hour')
  if (m < 43_200) return rtf.format(-Math.floor(m / 1440), 'day')
  return new Date(t0).toLocaleDateString(loc)
}

/** 日期时间按当前语言格式化，options 同 Intl.DateTimeFormat */
export function dateTime(iso: string | number | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (iso == null) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(currentLocale(), options).format(d)
}

/** 头像占位色：按用户 id 哈希取一种品牌色 */
const PALETTE = ['#E8414F', '#5A6BD8', '#F0B429', '#2BA673', '#8E5CD9']
export function tintOf(id: string | null | undefined): string {
  let h = 2166136261
  for (const c of id ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return PALETTE[(h >>> 0) % PALETTE.length]!
}

/** 头像占位里的首字 */
export const initial = (name: string | null | undefined) => (name?.trim() || '?').slice(0, 1).toUpperCase()
