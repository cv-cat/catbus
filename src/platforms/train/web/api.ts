import { CatbusError } from '../../../core/errors.js'
import type { Fare, Stop, Ticket, Transfer } from '../../../core/schemas.js'
import type { TrainClient } from './client.js'
import { parsePrices, parseTickets, parseTransfers } from './normalize.js'
import { resolveStation } from './resolve.js'

export async function ticketSearch(
  client: TrainClient,
  params: { from: string; to: string; date: string; types?: string },
): Promise<Ticket[]> {
  const [f, t] = await Promise.all([resolveStation(client, params.from), resolveStation(client, params.to)])
  let path = await client.ensureSession()
  const query: Record<string, string> = {
    'leftTicketDTO.train_date': params.date,
    'leftTicketDTO.from_station': f.code,
    'leftTicketDTO.to_station': t.code,
    purpose_codes: 'ADULT',
  }
  let res = await client.requestJson(path, query)
  if (res.c_url) {
    client.leftTicketPath = path = `/otn/${res.c_url}`
    res = await client.requestJson(path, query)
  }
  if (!res.data?.result) {
    throw new CatbusError('UPSTREAM', [res.messages].flat().filter(Boolean).join('；') || '余票查询失败', {
      hint: '检查日期是否在预售期内（YYYY-MM-DD）',
      detail: { response: res },
    })
  }
  const wanted = params.types ? new Set(params.types.toUpperCase().split(',').map((s) => s.trim())) : null
  return parseTickets(res.data, params.date).filter((x) => !wanted || wanted.has(x.type))
}

export async function trainRoute(
  client: TrainClient,
  params: { trainNo: string; from: string; to: string; date: string },
): Promise<Stop[]> {
  const [f, t] = await Promise.all([resolveStation(client, params.from), resolveStation(client, params.to)])
  const res = await client.requestJson('/otn/czxx/queryByTrainNo', {
    train_no: params.trainNo,
    from_station_telecode: f.code,
    to_station_telecode: t.code,
    depart_date: params.date,
  })
  const rows = res.data?.data
  if (!rows?.length) {
    throw new CatbusError('UPSTREAM', '没有查到经停信息', {
      hint: 'train_no 用 ticket search 输出里的 train_no（如 240000G53106），不是车次号',
    })
  }
  return rows.map((r: any) => ({
    id: r.station_no,
    url: null,
    station: r.station_name,
    arrive: r.arrive_time,
    depart: r.start_time,
    stopover: r.stopover_time,
    in_range: r.isEnabled,
  }))
}

export async function ticketPrice(
  client: TrainClient,
  params: { trainNo: string; fromNo: string; toNo: string; seatTypes: string; date: string },
): Promise<Fare> {
  const res = await client.requestJson('/otn/leftTicket/queryTicketPrice', {
    train_no: params.trainNo,
    from_station_no: params.fromNo,
    to_station_no: params.toNo,
    seat_types: params.seatTypes,
    train_date: params.date,
  })
  if (!res.status || !res.data) {
    throw new CatbusError('UPSTREAM', [res.messages].flat().filter(Boolean).join('；') || '票价查询失败', {
      detail: { response: res },
    })
  }
  return { id: params.trainNo, url: null, train_no: params.trainNo, date: params.date, prices: parsePrices(res.data) }
}

export async function transferSearch(
  client: TrainClient,
  params: { from: string; to: string; date: string; via?: string; limit?: number },
): Promise<Transfer[]> {
  const [f, t] = await Promise.all([resolveStation(client, params.from), resolveStation(client, params.to)])
  const m = params.via ? await resolveStation(client, params.via) : null
  await client.ensureSession()
  const res = await client.requestJson('/lcquery/queryG', {
    train_date: params.date,
    from_station_telecode: f.code,
    to_station_telecode: t.code,
    middle_station: m?.code ?? '',
    result_index: '0',
    can_query: 'Y',
    isShowWZ: 'N',
    purpose_codes: '00',
    channel: 'E',
  })
  const list = res.data?.middleList
  if (!Array.isArray(list)) {
    throw new CatbusError('UPSTREAM', res.errorMsg || res.data?.message || '中转查询失败', {
      detail: { response: res },
    })
  }
  return parseTransfers(list.slice(0, params.limit ?? list.length))
}
