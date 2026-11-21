import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket, Transfer } from '@/api/types'
import {
  addDays,
  cnMinutes,
  crossDays,
  dayIndex,
  dayLabel,
  durationText,
  fromMark,
  inRange,
  kindLabel,
  kindOf,
  minutes,
  remainText,
  seatCells,
  shortDate,
  sortTickets,
  sortTransfers,
  toMark,
  transferDays,
  yuan,
} from '@/composables/rail'

const ticket = (over: Partial<Ticket>) => over as Ticket
const transfer = (over: Partial<Transfer>) => over as Transfer

describe('12306 查询页（7.9「12306 查询页」）', () => {
  afterEach(() => vi.useRealTimers())

  it('车型按车次首字母，其余归「其他」', () => {
    expect(kindOf('g')).toBe('G')
    expect(kindOf('K')).toBe('K')
    expect(kindOf('S')).toBe('other')
    expect(kindOf('1')).toBe('other')
    expect(kindLabel('G')).toBe('高铁')
  })

  it('时间与历时', () => {
    expect(minutes('05:56')).toBe(356)
    expect(minutes('乱写')).toBe(0)
    expect(minutes(null)).toBe(0)
    expect(crossDays('22:00', '03:00')).toBe(1)
    expect(crossDays('08:00', '04:54')).toBe(0)
    expect(durationText(294)).toBe('4小时54分')
    expect(durationText(120)).toBe('2小时')
    expect(durationText(5)).toBe('5分')
    expect(cnMinutes('1小时3分钟')).toBe(63)
    expect(cnMinutes('2分钟')).toBe(2)
    expect(cnMinutes('3小时')).toBe(180)
    expect(cnMinutes('')).toBeNull()
    expect(cnMinutes('abc')).toBeNull()
  })

  it('余票：{min:21} →「有」，0 →「无」，≤ 9 张紧张，不可预订时为「—」', () => {
    expect(remainText({ min: 21 })).toEqual({ text: '有', low: false, none: false })
    expect(remainText(0)).toEqual({ text: '无', low: false, none: true })
    expect(remainText(9)).toEqual({ text: '9 张', low: true, none: false })
    expect(remainText(10)).toEqual({ text: '10 张', low: false, none: false })
    expect(remainText(5, false)).toEqual({ text: '—', low: false, none: true })
    expect(remainText(undefined)).toEqual({ text: '—', low: false, none: true })
  })

  it('席别按 remaining 的键序排，缺的从 prices 补', () => {
    const cells = seatCells({
      remaining: { 二等座: { min: 21 }, 一等座: 3 },
      prices: { 一等座: { amount: 1000, currency: 'CNY' }, 商务座: { amount: 2000, currency: 'CNY' } },
    })
    expect(cells.map((c) => c.name)).toEqual(['二等座', '一等座', '商务座'])
    expect(cells[0]).toMatchObject({ text: '有', price: null })
    expect(cells[1]).toMatchObject({ text: '3 张', low: true, price: 1000 })
    expect(cells[2]).toMatchObject({ text: '—', none: true, price: 2000 })
  })

  it('票价：整数不带小数，半价带一位', () => {
    expect(yuan(553)).toBe('¥553')
    expect(yuan(283.5)).toBe('¥283.5')
    expect(yuan(null)).toBe('')
  })

  it('始 / 终 / 过', () => {
    const x = ticket({ start: { code: 'VNP', name: '' }, end: { code: 'AOH', name: '' }, from: { code: 'VNP', name: '', no: '01' }, to: { code: 'NKH', name: '', no: '05' } })
    expect(fromMark(x)).toBe('start')
    expect(toMark(x)).toBe('pass')
    expect(toMark({ ...x, to: { code: 'AOH', name: '', no: '09' } })).toBe('end')
    expect(fromMark({ ...x, from: { code: 'TJP', name: '', no: '02' } })).toBe('pass')
  })

  it('直达排序：出发最早 / 最晚 / 历时最短（同历时按出发）', () => {
    const list = [ticket({ id: 'a', depart: '09:00', duration: '05:00' }), ticket({ id: 'b', depart: '07:00', duration: '04:30' }), ticket({ id: 'c', depart: '08:00', duration: '04:30' })]
    expect(sortTickets(list, 'early').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(sortTickets(list, 'late').map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(sortTickets(list, 'fast').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    // 不改原数组
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('中转排序：全程最短 / 出发最早 / 等候最短（解析不了的等候排最后）', () => {
    const list = [
      transfer({ id: 'a', duration_minutes: 300, depart: '2026-11-16 09:00', wait: '1小时' }),
      transfer({ id: 'b', duration_minutes: 200, depart: '2026-11-16 10:00', wait: '乱写' }),
      transfer({ id: 'c', duration_minutes: 250, depart: '2026-11-16 08:00', wait: '20分钟' }),
    ]
    expect(sortTransfers(list, 'fast').map((x) => x.id)).toEqual(['b', 'c', 'a'])
    expect(sortTransfers(list, 'early').map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(sortTransfers(list, 'wait').map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(transferDays(transfer({ depart: '2026-11-16 22:00', arrive: '2026-11-17 06:00' }))).toBe(1)
    expect(transferDays(transfer({ depart: '2026-11-16 08:00', arrive: '2026-11-16 12:00' }))).toBe(0)
  })

  it('日期：今天起 15 天内（含今天）', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 16, 10, 0) })
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(dayIndex('2026-11-16')).toBe(0)
    expect(inRange('2026-11-16')).toBe(true)
    expect(inRange('2026-11-30')).toBe(true)
    expect(inRange('2026-12-01')).toBe(false)
    expect(inRange('2026-11-15')).toBe(false)
    expect(inRange('2026-11-1')).toBe(false)
    expect(dayLabel('2026-11-16')).toBe('今天')
    expect(dayLabel('2026-11-17')).toBe('明天')
    expect(dayLabel('2026-11-18')).toBe('周三')
    expect(shortDate('2026-01-05')).toBe('1/5')
  })
})
