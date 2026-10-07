import { CatbusError } from '../../../core/errors.js'
import type { Station } from '../../../core/schemas.js'
import type { TrainClient } from './client.js'

/** 车站：中文名、电报码（BJP）、拼音或城市名。城市名取该城市同名站，没有时取第一个站。 */
export async function resolveStation(client: TrainClient, input: string): Promise<Station> {
  const stations = await client.loadStations()
  const q = input.trim()
  const lower = q.toLowerCase()
  const hit =
    (/^[A-Za-z]{3}$/.test(q) ? stations.find((s) => s.code === q.toUpperCase()) : undefined) ??
    stations.find((s) => s.name === q) ??
    stations.find((s) => s.pinyin === lower) ??
    stations.find((s) => s.city === q && s.name === s.city) ??
    stations.find((s) => s.city === q)
  if (!hit) {
    throw new CatbusError('USAGE', `找不到车站：${input}`, { hint: 'catbus train station search <关键词>' })
  }
  return hit
}

export async function searchStations(client: TrainClient, keyword: string): Promise<Station[]> {
  const stations = await client.loadStations()
  const q = keyword.trim().toLowerCase()
  return stations.filter(
    (s) => s.name.includes(keyword) || s.city.includes(keyword) || s.pinyin.startsWith(q) || s.abbr.startsWith(q) || s.code.toLowerCase() === q,
  )
}
