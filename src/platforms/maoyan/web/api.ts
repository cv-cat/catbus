import { CatbusError } from '../../../core/errors.js'
import * as rand from '../../../core/rand.js'
import type { MaoyanClient } from './client.js'

const UUID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 城市热门演出（在售 / 预售），一次返回全部，没有分页。 */
export async function hotShows(client: MaoyanClient, cityId: string): Promise<any[]> {
  const data = await client.list('/my/ianvs/movie/hotShows', [['cityId', cityId]])
  return data?.recordList ?? []
}

/** 演出项目详情：场次时间、场馆、票价档、售卖状态。cityId 不影响返回内容，照网页固定为 1。 */
export async function projectDetail(client: MaoyanClient, projectId: string): Promise<any> {
  // 服务端不校验 uuid，每次随机；query 与请求头里用同一个值
  const uuid = rand.string(64, UUID_ALPHABET)
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
