import type { Fare, Price, Station, Stop, Ticket, TicketRemaining, Transfer, TransferLeg } from '../../../core/schemas.js'
import { BASE } from './client.js'

export function parseStations(js: string): Station[] {
  const body = js.match(/'(.*)'/s)?.[1] ?? ''
  return body
    .split('@')
    .filter(Boolean)
    .map((s) => {
      const f = s.split('|')
      return { id: f[2]!, name: f[1]!, code: f[2]!, pinyin: f[3]!, abbr: f[4]!, city: f[7] || f[1]!, url: null }
    })
    .filter((s) => Boolean(s.code))
}

const SEATS: Record<string, string> = {
  swz_num: '商务座',
  tz_num: '特等座',
  zy_num: '一等座',
  ze_num: '二等座',
  gr_num: '高级软卧',
  rw_num: '软卧',
  srrb_num: '动卧',
  yw_num: '硬卧',
  rz_num: '软座',
  yz_num: '硬座',
  wz_num: '无座',
  qt_num: '其他',
}

const FIELD: Record<string, number> = {
  train_no: 2, code: 3, from: 6, to: 7, depart: 8, arrive: 9, duration: 10, can_buy: 11,
  from_no: 16, to_no: 17, yp_info_new: 39, gr_num: 21, qt_num: 22, rw_num: 23, rz_num: 24, tz_num: 25, wz_num: 26,
  yw_num: 28, yz_num: 29, ze_num: 30, zy_num: 31, swz_num: 32, srrb_num: 33, seat_types: 35,
}

export function extractSeats(get: (key: string) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, name] of Object.entries(SEATS)) {
    const v = get(k)
    if (v && v !== '--') out[name] = v
  }
  return out
}

/** `有` 或剩余张数算有票；`无`、`候补`、`*`（未开售）不算。 */
export function hasTicket(v: string): boolean {
  return v === '有' || /^\d+$/.test(v)
}

const SEAT_CODES: Record<string, string> = {
  '9': '商务座',
  P: '特等座',
  M: '一等座',
  D: '优选一等座',
  O: '二等座',
  '6': '高级软卧',
  '4': '软卧',
  F: '动卧',
  I: '一等卧',
  J: '二等卧',
  '3': '硬卧',
  '2': '软座',
  '1': '硬座',
}

/**
 * 解析 yp_info_new：每 10 位一段，席别 1 位 + 票价（角）5 位 + 张数 4 位。
 * 张数 ≥ 3000 表示无座，真实张数为减去 3000，不封顶；其他席别在 21 封顶，表示"至少 21 张"。
 */
export function parseYp(yp: string | null | undefined): { remaining: Record<string, TicketRemaining>; prices: Record<string, Price> } {
  const remaining: Record<string, TicketRemaining> = {}
  const prices: Record<string, Price> = {}
  const str = yp ?? ''
  for (let i = 0; i + 10 <= str.length; i += 10) {
    const seg = str.slice(i, i + 10)
    const count = Number(seg.slice(6))
    const standing = count >= 3000
    const code = seg[0]!
    const name = standing ? '无座' : (SEAT_CODES[code] ?? `席别${code}`)
    const n = standing ? count - 3000 : count
    remaining[name] = !standing && n >= 21 ? { min: 21 } : n
    prices[name] = { amount: Number(seg.slice(1, 6)) / 10, currency: 'CNY' }
  }
  return { remaining, prices }
}

export function ticketUrl(from: { name: string; code: string }, to: { name: string; code: string }, date: string): string {
  const q = new URLSearchParams({ linktypeid: 'dc', fs: `${from.name},${from.code}`, ts: `${to.name},${to.code}`, date, flag: 'N,N,Y' })
  return `${BASE}/otn/leftTicket/init?${q}`
}

export function parseTickets(data: { map?: Record<string, string>; result: string[] }, date: string): Ticket[] {
  const names = data.map ?? {}
  return data.result.map((row) => {
    const p = row.split('|')
    const get = (k: string) => p[FIELD[k]!]
    const code = get('code')!
    const s = extractSeats(get)
    const yp = parseYp(get('yp_info_new'))
    const from = { code: get('from')!, name: names[get('from')!] ?? get('from')!, no: get('from_no')! }
    const to = { code: get('to')!, name: names[get('to')!] ?? get('to')!, no: get('to_no')! }
    return {
      id: code,
      url: ticketUrl(from, to, date),
      train_no: get('train_no')!,
      type: code[0]!,
      from,
      to,
      depart: get('depart')!,
      arrive: get('arrive')!,
      duration: get('duration')!,
      date,
      bookable: get('can_buy') === 'Y',
      has_ticket: Object.values(s).some(hasTicket),
      seats: s,
      remaining: yp.remaining,
      prices: yp.prices,
      seat_types: get('seat_types')!,
    }
  })
}

const PRICE_KEYS: Record<string, string> = {
  A9: '商务座',
  P: '特等座',
  M: '一等座',
  O: '二等座',
  A6: '高级软卧',
  A4: '软卧',
  F: '动卧',
  A3: '硬卧',
  A2: '软座',
  A1: '硬座',
  WZ: '无座',
}

export function parsePrices(data: Record<string, any>): Record<string, Price> {
  const prices: Record<string, Price> = {}
  for (const [k, name] of Object.entries(PRICE_KEYS)) {
    if (data[k]) prices[name] = { amount: Number(String(data[k]).replace(/[^\d.]/g, '')), currency: 'CNY' }
  }
  return prices
}

export function parseTransfers(list: any[]): Transfer[] {
  return list.map((r) => {
    const legs: TransferLeg[] = r.fullList.map((l: any) => ({
      id: l.station_train_code,
      url: null,
      train_no: l.train_no,
      from: l.from_station_name,
      to: l.to_station_name,
      depart: l.start_time,
      arrive: l.arrive_time,
      duration: l.lishi,
      seats: extractSeats((k) => l[k]),
      ...parseYp(l.yp_info),
    }))
    return {
      id: `${legs.map((l) => l.id).join('+')}@${r.middle_station_name}`,
      url: null,
      via: r.middle_station_name,
      same_station: r.same_station === '0',
      same_train: r.same_train === 'Y',
      kind: r.same_train === 'Y' ? '同车换座' : '换乘',
      depart: `${r.train_date} ${r.start_time}`,
      arrive: `${r.arrive_date} ${r.arrive_time}`,
      duration_minutes: r.all_lishi_minutes,
      wait: r.wait_time,
      legs,
    }
  })
}
