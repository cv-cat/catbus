import type { HandlerContext } from '../../../core/registry.js'
import type { Fare, Station, Stop, Ticket, Transfer } from '../../../core/schemas.js'
import * as api from './api.js'
import { checkDate, TrainClient } from './client.js'
import { searchStations } from './resolve.js'

export async function stationSearch(ctx: HandlerContext): Promise<Station[]> {
  const client = new TrainClient(ctx)
  const keyword = String(ctx.args.keyword ?? '')
  return searchStations(client, keyword)
}

export async function ticketSearch(ctx: HandlerContext): Promise<Ticket[]> {
  const client = new TrainClient(ctx)
  const from = String(ctx.args.from ?? '')
  const to = String(ctx.args.to ?? '')
  const date = checkDate(ctx.options.date as string | undefined)
  const types = ctx.options.type as string | undefined
  const available = ctx.options.available as boolean | undefined
  const list = await api.ticketSearch(client, { from, to, date, types })
  return available ? list.filter((x) => x.has_ticket) : list
}

export async function ticketPrice(ctx: HandlerContext): Promise<Fare> {
  const client = new TrainClient(ctx)
  const train = String(ctx.args.train ?? '')
  const fromNo = String(ctx.options.fromNo ?? '')
  const toNo = String(ctx.options.toNo ?? '')
  const seatTypes = String(ctx.options.seatTypes ?? '')
  const date = checkDate(ctx.options.date as string | undefined)
  return api.ticketPrice(client, { trainNo: train, fromNo, toNo, seatTypes, date })
}

export async function routeGet(ctx: HandlerContext): Promise<Stop[]> {
  const client = new TrainClient(ctx)
  const train = String(ctx.args.train ?? '')
  const from = String(ctx.args.from ?? '')
  const to = String(ctx.args.to ?? '')
  const date = checkDate(ctx.options.date as string | undefined)
  return api.trainRoute(client, { trainNo: train, from, to, date })
}

export async function transferSearch(ctx: HandlerContext): Promise<Transfer[]> {
  const client = new TrainClient(ctx)
  const from = String(ctx.args.from ?? '')
  const to = String(ctx.args.to ?? '')
  const date = checkDate(ctx.options.date as string | undefined)
  const via = ctx.options.via as string | undefined
  const limit = ctx.options.limit as number | undefined
  return api.transferSearch(client, { from, to, date, via, limit })
}
