import { CatbusError } from '../../../core/errors.js'
import * as rand from '../../../core/rand.js'
import type { UserRef } from '../../../core/schemas.js'
import type { MaoyanClient } from './client.js'

const UUID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** preselect 接口对已开售的项目返回这个业务码。 */
const CODE_ON_SALE = 1007
/** 每个场次查一次票档，场次可能有十几个，间隔开避免触发限频。 */
const TICKETS_GAP = 1000

const newUuid = () => rand.string(64, UUID_ALPHABET)

/** 城市热门演出（在售 / 预售），一次返回全部，没有分页。 */
export async function hotShows(client: MaoyanClient, cityId: string): Promise<any[]> {
  const data = await client.list('/my/ianvs/movie/hotShows', [['cityId', cityId]])
  return data?.recordList ?? []
}

/** 演出项目详情：场次时间、场馆、票价档、售卖状态。cityId 不影响返回内容，照网页固定为 1。 */
export async function projectDetail(client: MaoyanClient, projectId: string): Promise<any> {
  // 服务端不校验 uuid，每次随机；query 与请求头里用同一个值
  const uuid = newUuid()
  const query: [string, string][] = [
    ['buyInstructionType', '1'],
    ['supportNewPromotion', 'true'],
    ['projectId', projectId],
    ['detailType', '1'],
    ['optimus_risk_level', '71'],
    ['optimus_code', '10'],
    ['uuid', uuid],
    ['clientPlatform', '3'],
    ['sellChannel', '1'],
    ['cityId', '1'],
    ['yodaReady', 'h5'],
    ['csecplatform', '4'],
    ['csecversion', '4.2.4'],
  ]
  const data = await client.signed('/my/odea/project/detail', query, uuid)
  if (!data?.baseProjectVO?.performanceId) {
    throw new CatbusError('UPSTREAM', `没有这个演出：${projectId}`, { detail: { response: data } })
  }
  return data
}

/** 登录后接口的公共 query；token 是 .dianping.com 的 dper。 */
function ticketQuery(uuid: string, cityId: string, token: string): [string, string][] {
  return [
    ['optimus_risk_level', '71'],
    ['optimus_code', '10'],
    ['uuid', uuid],
    ['clientPlatform', '3'],
    ['sellChannel', '1'],
    ['cityId', cityId],
    ['token', token],
    ['yodaReady', 'h5'],
    ['csecplatform', '4'],
    ['csecversion', '4.2.4'],
  ]
}

/** 在售项目的场次。 */
async function onSaleShows(client: MaoyanClient, projectId: string, cityId: string, token: string): Promise<any[]> {
  const uuid = newUuid()
  const data = await client.signed('/my/odea/project/shows', ticketQuery(uuid, cityId, token), uuid, JSON.stringify({ projectId }))
  return data?.showListVO ?? []
}

/** 在售项目某个场次的票档。 */
async function onSaleTickets(client: MaoyanClient, projectId: string, showId: string, cityId: string, token: string): Promise<any[]> {
  const uuid = newUuid()
  const query: [string, string][] = [
    ['showId', showId],
    ['projectId', projectId],
    ['clientPlatform', '3'],
    ['supportNewPromotion', 'true'],
    ...ticketQuery(uuid, cityId, token).filter(([k]) => k !== 'clientPlatform'),
  ]
  const data = await client.signed('/my/odea/show/tickets', query, uuid)
  return data?.ticketsVO ?? []
}

/** 未开售项目的预选场次；已开售时返回 null。 */
async function preselectShows(client: MaoyanClient, projectId: string, cityId: string, token: string): Promise<any[] | null> {
  try {
    const data = await client.list('/my/odea/project/shows/preselect', [
      ['projectId', projectId],
      ['cityId', cityId],
      ['token', token],
      ['cn_pt', 'RN'],
    ])
    return data?.showListVO ?? []
  } catch (e) {
    if (e instanceof CatbusError && (e.detail as any)?.code === CODE_ON_SALE) return null
    throw e
  }
}

async function preselectTickets(client: MaoyanClient, projectId: string, showId: string, cityId: string, token: string): Promise<any[]> {
  const data = await client.list('/my/odea/show/tickets/preselect', [
    ['projectId', projectId],
    ['showId', showId],
    ['cityId', cityId],
    ['token', token],
    ['cn_pt', 'RN'],
  ])
  return data?.ticketsVO ?? []
}

/** 场次和票档：先按未开售查预选，返回「已开售」时改查在售接口。每个场次带上 tickets。 */
export async function showsWithTickets(client: MaoyanClient, projectId: string, cityId: string, token: string): Promise<any[]> {
  const preselect = await preselectShows(client, projectId, cityId, token)
  const shows = preselect ?? (await onSaleShows(client, projectId, cityId, token))
  const tickets = preselect ? preselectTickets : onSaleTickets
  const out: any[] = []
  for (const show of shows) {
    if (out.length) await rand.sleep(TICKETS_GAP)
    out.push({ ...show, tickets: await tickets(client, projectId, String(show.showId), cityId, token) })
  }
  return out
}

export async function currentUser(client: MaoyanClient, token: string): Promise<UserRef> {
  const u = await client.userInfo(token)
  return { id: String(u.userId), name: u.nickName ?? u.nickname ?? u.userName ?? u.username ?? null, url: null }
}
