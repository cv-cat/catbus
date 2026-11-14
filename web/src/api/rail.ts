import { call } from './client'
import { mockRoute, mockStations, mockTickets, mockTransfers } from './mock'
import type { Envelope, Station, Stop, Ticket, Transfer } from './types'
import { isDemo } from '@/stores/source'

/**
 * 12306 查询页的四条免登录只读命令（AGENTS.md 7.9「12306 查询页」）。不带 -a；
 * bridge 把车站、车次放到 `--` 之后。演示模式下用 mock.ts 的数据，不请求服务端。
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 车站联想：`12306 station search -- <关键词>` */
export async function searchStations(keyword: string, signal?: AbortSignal): Promise<Envelope<Station[]>> {
  if (isDemo()) {
    await wait(160)
    return mockStations(keyword)
  }
  return call<Station[]>(['12306', 'station', 'search', keyword], signal)
}

/** 直达：`12306 ticket search --date <日期> -- <from> <to>`（车型、只看有票在页面里筛） */
export async function searchTickets(from: string, to: string, date: string, signal?: AbortSignal): Promise<Envelope<Ticket[]>> {
  if (isDemo()) {
    await wait(650)
    return mockTickets(from, to, date)
  }
  return call<Ticket[]>(['12306', 'ticket', 'search', from, to, '--date', date], signal)
}

/** 经停：站取这一趟车自己的上下车站（结果里有同城车站），用电报码 */
export async function getRoute(t: Ticket, signal?: AbortSignal): Promise<Envelope<Stop[]>> {
  if (isDemo()) {
    await wait(420)
    return mockRoute(t)
  }
  return call<Stop[]>(['12306', 'route', 'get', t.train_no, t.from.code, t.to.code, '--date', t.date], signal)
}

/** 中转：`12306 transfer search --date <日期> [--via <中转站>] -- <from> <to>` */
export async function searchTransfers(
  from: string,
  to: string,
  date: string,
  via: string | null,
  signal?: AbortSignal,
): Promise<Envelope<Transfer[]>> {
  if (isDemo()) {
    await wait(900)
    return mockTransfers(from, to, date, via)
  }
  const argv = ['12306', 'transfer', 'search', from, to, '--date', date]
  if (via) argv.push('--via', via)
  return call<Transfer[]>(argv, signal)
}
