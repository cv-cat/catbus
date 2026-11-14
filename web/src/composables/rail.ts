import type { Remaining, Ticket, Transfer } from '@/api/types'
import { currentLocale, t } from '@/i18n'

/**
 * 12306 查询页的纯函数（AGENTS.md 7.9「12306 查询页」）：车型、时间、余票、排序、日期。
 * 文案在 locales/<语言>/rail.json；常量里只放 key，渲染时再 t()。
 */

/** 车型 chip：按车次首字母；其余（纯数字、S、Y…）归「其他」 */
export const TRAIN_KINDS = ['G', 'D', 'C', 'Z', 'T', 'K', 'other'] as const
export type TrainKind = (typeof TRAIN_KINDS)[number]
export const kindOf = (type: string): TrainKind => {
  const k = type.toUpperCase()
  return (TRAIN_KINDS as readonly string[]).includes(k) ? (k as TrainKind) : 'other'
}
/** 车次的车型名（高铁、动车……）；车次号本身不翻译 */
export const kindLabel = (type: string) => t(`rail.kind.${kindOf(type)}`)

export const DIRECT_SORTS = ['early', 'late', 'fast'] as const
export type DirectSort = (typeof DIRECT_SORTS)[number]
export const TRANSFER_SORTS = ['fast', 'early', 'wait'] as const
export type TransferSort = (typeof TRANSFER_SORTS)[number]

/** 「05:56」→ 356 */
export function minutes(hhmm: string | null | undefined): number {
  const m = /^(\d{1,3}):(\d{2})$/.exec(hhmm ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** 出发后跨了几天（0 表示当天到） */
export const crossDays = (depart: string, duration: string) => Math.floor((minutes(depart) + minutes(duration)) / 1440)

/** 历时：「4小时54分」 */
export function durationText(total: number): string {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return t('rail.time.minutes', { m })
  return m ? t('rail.time.hoursMinutes', { h, m }) : t('rail.time.hours', { h })
}

/** CLI 给的中文时长（「2分钟」「1小时3分钟」）→ 分钟；解析不了时为 null */
export function cnMinutes(s: string | null | undefined): number | null {
  if (!s) return null
  const h = /(\d+)\s*小时/.exec(s) // i18n-ignore
  const m = /(\d+)\s*分/.exec(s) // i18n-ignore
  if (!h && !m) return null
  return Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0)
}

/** 一格席别：余票文字、是否紧张（≤ 9 张）、是否无票 */
export interface SeatCell {
  name: string
  text: string
  low: boolean
  none: boolean
  price: number | null
}

/** 余票的显示：`{min:21}` →「有」，0 →「无」，其余「N 张」 */
export function remainText(r: Remaining | undefined, bookable = true): { text: string; low: boolean; none: boolean } {
  if (!bookable || r == null) return { text: '—', low: false, none: true }
  if (typeof r === 'object') return { text: t('rail.seat.plenty'), low: false, none: false }
  if (r <= 0) return { text: t('rail.seat.none'), low: false, none: true }
  return { text: t('rail.seat.count', { n: r }, r), low: r <= 9, none: false }
}

/** 按这一趟车自己的席别排（`remaining` 的键序，缺的从 prices 补） */
export function seatCells(x: Pick<Ticket, 'remaining' | 'prices'> & { bookable?: boolean }): SeatCell[] {
  const names = [...new Set([...Object.keys(x.remaining ?? {}), ...Object.keys(x.prices ?? {})])]
  return names.map((name) => ({ name, ...remainText(x.remaining?.[name], x.bookable ?? true), price: x.prices?.[name]?.amount ?? null }))
}

/** 票价：整数不带小数，半价带一位（¥283.5） */
export const yuan = (n: number | null) => (n == null ? '' : `¥${Number.isInteger(n) ? n : n.toFixed(1)}`)

/** 站名前的小标记：始发 / 终到 / 路过 */
export type Mark = 'start' | 'end' | 'pass'
export const fromMark = (x: Ticket): Mark => (x.from.code === x.start.code ? 'start' : 'pass')
export const toMark = (x: Ticket): Mark => (x.to.code === x.end.code ? 'end' : 'pass')

export function sortTickets(list: readonly Ticket[], by: DirectSort): Ticket[] {
  const out = [...list]
  if (by === 'early') out.sort((a, b) => minutes(a.depart) - minutes(b.depart))
  else if (by === 'late') out.sort((a, b) => minutes(b.depart) - minutes(a.depart))
  else out.sort((a, b) => minutes(a.duration) - minutes(b.duration) || minutes(a.depart) - minutes(b.depart))
  return out
}

/** 「2026-11-16 19:24」→ 毫秒（按本地时间，只用来比较先后） */
const stamp = (s: string) => Date.parse(s.replace(' ', 'T')) || 0

export function sortTransfers(list: readonly Transfer[], by: TransferSort): Transfer[] {
  const out = [...list]
  if (by === 'fast') out.sort((a, b) => a.duration_minutes - b.duration_minutes || stamp(a.depart) - stamp(b.depart))
  else if (by === 'early') out.sort((a, b) => stamp(a.depart) - stamp(b.depart))
  else out.sort((a, b) => (cnMinutes(a.wait) ?? 1e9) - (cnMinutes(b.wait) ?? 1e9) || a.duration_minutes - b.duration_minutes)
  return out
}

/** 中转方案全程跨了几天 */
export const transferDays = (x: Transfer) =>
  Math.round((Date.parse(x.arrive.slice(0, 10)) - Date.parse(x.depart.slice(0, 10))) / 86_400_000) || 0

// ---------- 日期：只能选今天起 15 天内 ----------

/** 可选的天数（含今天） */
export const DATE_SPAN = 15
/** 日期条显示几天 */
export const DATE_STRIP = 9

const pad2 = (n: number) => String(n).padStart(2, '0')
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
/** YYYY-MM-DD → 本地零点 */
export function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
export const todayIso = () => isoOf(new Date())
export function addDays(iso: string, n: number): string {
  const d = dateOf(iso)
  d.setDate(d.getDate() + n)
  return isoOf(d)
}
/** 今天起第几天（今天为 0） */
export const dayIndex = (iso: string) => Math.round((dateOf(iso).getTime() - dateOf(todayIso()).getTime()) / 86_400_000)
export const inRange = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && dayIndex(iso) >= 0 && dayIndex(iso) < DATE_SPAN

/** 「11月16日」 */
export const monthDay = (iso: string) => new Intl.DateTimeFormat(currentLocale(), { month: 'long', day: 'numeric' }).format(dateOf(iso))
/** 「11/16」 */
export const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
/** 「周一」 */
export const weekday = (iso: string) => new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(dateOf(iso))
/** 日期条上的说明：今天、明天，其余写星期 */
export function dayLabel(iso: string): string {
  const i = dayIndex(iso)
  if (i === 0) return t('rail.date.today')
  if (i === 1) return t('rail.date.tomorrow')
  return weekday(iso)
}
