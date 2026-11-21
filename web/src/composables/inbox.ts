import { currentLocale, t } from '@/i18n'
import type { Notice } from '@/api/types'

/**
 * 收件箱的时间与分组（AGENTS.md 7.9「通知与私信」的「时间」）：
 * 1 分钟内「刚刚」，1 小时内「N 分钟前」，今天「N 小时前」，昨天「昨天 HH:mm」，7 天内「N 天前」，今年「M月D日」，更早带年份。
 */

export type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier'

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
/** now 那天往前数第几天（0 = 今天，1 = 昨天）；按日历日算，不按 24 小时 */
function daysAgo(ms: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
}

export function inboxTime(iso: string | null | undefined, now = Date.now()): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(ms)) return ''
  const loc = currentLocale()
  const days = daysAgo(ms, now)
  const min = Math.max(0, Math.floor((now - ms) / 60_000))
  if (days <= 0) {
    if (min < 1) return t('common.time.justNow')
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'always' })
    return min < 60 ? rtf.format(-min, 'minute') : rtf.format(-Math.floor(min / 60), 'hour')
  }
  if (days === 1) {
    const day = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }).format(-1, 'day')
    const hm = new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
    return `${day} ${hm}`
  }
  if (days < 7) return new Intl.RelativeTimeFormat(loc, { numeric: 'always' }).format(-days, 'day')
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(loc, sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(ms)
}

/** 完整时间（悬停和详情栏） */
export function fullTime(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(ms)) return ''
  return new Intl.DateTimeFormat(currentLocale(), { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)
}

export function dayGroup(iso: string | null | undefined, now = Date.now()): DayGroup {
  const ms = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(ms)) return 'earlier'
  const days = daysAgo(ms, now)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? 'week' : 'earlier'
}

/** 按日期分组，保持原顺序；相邻的同组通知合在一起（平台给的顺序本来就是新的在前） */
export function groupByDay(list: Notice[], now = Date.now()): { group: DayGroup; items: Notice[] }[] {
  const out: { group: DayGroup; items: Notice[] }[] = []
  for (const n of list) {
    const g = dayGroup(n.created_at, now)
    const last = out.at(-1)
    if (last?.group === g) last.items.push(n)
    else out.push({ group: g, items: [n] })
  }
  return out
}

/** 会话 id 的短码：群聊没有名字时显示后 6 位 */
export const shortId = (id: string) => id.replace(/^.*:/, '').slice(-6)
