import { call } from './client'
import type { Envelope, Station, Stop, Ticket, Transfer } from './types'
import { isDemo } from '@/stores/source'

/**
 * 12306 查询页的四条免登录只读命令（AGENTS.md 7.9「12306 查询页」）。不带 -a；
 * bridge 把车站、车次放到 `--` 之后。演示模式下用 mock/rail.ts 的数据，不请求服务端。
 */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** 演示数据（车站表、车次）只有演示模式的查询页用到：按需加载 */
const demo = () => import('./mock/rail')

/** 车站联想：`12306 station search -- <关键词>` */
export async function searchStations(keyword: string, signal?: AbortSignal): Promise<Envelope<Station[]>> {
  if (isDemo()) {
    const [m] = await Promise.all([demo(), wait(160)])
    return m.mockStations(keyword)
  }
  return call<Station[]>(['12306', 'station', 'search', keyword], signal)
}

/** 直达：`12306 ticket search --date <日期> -- <from> <to>`（车型、只看有票在页面里筛） */
export async function searchTickets(from: string, to: string, date: string, signal?: AbortSignal): Promise<Envelope<Ticket[]>> {
  if (isDemo()) {
    const [m] = await Promise.all([demo(), wait(650)])
    return m.mockTickets(from, to, date)
  }
  return call<Ticket[]>(['12306', 'ticket', 'search', from, to, '--date', date], signal)
}

/** 经停：站取这一趟车自己的上下车站（结果里有同城车站），用电报码 */
export async function getRoute(t: Ticket, signal?: AbortSignal): Promise<Envelope<Stop[]>> {
  if (isDemo()) {
    const [m] = await Promise.all([demo(), wait(420)])
    return m.mockRoute(t)
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
    const [m] = await Promise.all([demo(), wait(900)])
    return m.mockTransfers(from, to, date, via)
  }
  const argv = ['12306', 'transfer', 'search', from, to, '--date', date]
  if (via) argv.push('--via', via)
  return call<Transfer[]>(argv, signal)
}
