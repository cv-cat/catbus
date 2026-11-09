import { readFileSync } from 'node:fs'
import { CatbusError } from '../../../core/errors.js'
import { staticFile } from '../../../core/paths.js'

/**
 * 演出城市表（static/maoyan/cities.json）：`[cityId, 城市名, mtCityId, 是否官方核对]`。
 * cityId 是 hotShows / 详情用的演出城市 ID（1=上海、2=北京），不是 App 城市选择器的 mtCityId。
 * 官方核对过的取自详情响应的 baseProjectVO.cityId / cityName；其余是按列表内容反推的，同名城市优先取官方的。
 */
export interface City {
  id: string
  name: string
  official: boolean
}

let cities: City[] | undefined

export function loadCities(): City[] {
  cities ??= (JSON.parse(readFileSync(staticFile('maoyan', 'cities.json'), 'utf8')) as [number, string, number | null, number][])
    .map(([id, name, , official]) => ({ id: String(id), name, official: official === 1 }))
    .sort((a, b) => Number(b.official) - Number(a.official) || Number(a.id) - Number(b.id))
  return cities
}

/** 每个城市名一条：官方核对过的优先，其次 ID 最小的。 */
export function cityList(): City[] {
  const seen = new Set<string>()
  return loadCities().filter((c) => !seen.has(c.name) && seen.add(c.name))
}

/** 城市：演出 cityId 或城市名（「北京」「北京市」都可以）。 */
export function resolveCity(input: string): City {
  const q = input.trim()
  if (/^\d+$/.test(q)) return loadCities().find((c) => c.id === q) ?? { id: q, name: q, official: false }
  const name = q.replace(/市$/, '')
  const hit = cityList().find((c) => c.name === name)
  if (!hit) {
    const near = cityList().filter((c) => c.name.includes(name) || name.includes(c.name)).slice(0, 5)
    throw new CatbusError('USAGE', `找不到城市：${input}`, {
      hint: near.length ? `相近的城市：${near.map((c) => c.name).join('、')}` : 'catbus maoyan poi search <城市名>',
    })
  }
  return hit
}

/** 演出项目：projectId，或含 `/detail/<id>`、`projectId=<id>` 的链接（包括 App 的 dianping:// 跳转链接）。 */
export function resolveProject(input: string): string {
  const q = input.trim()
  if (/^\d+$/.test(q)) return q
  let s = q
  try {
    s = decodeURIComponent(q)
  } catch {}
  const id = s.match(/\/detail\/(\d+)/)?.[1] ?? s.match(/[?&#]projectId=(\d+)/)?.[1]
  if (!id) throw new CatbusError('USAGE', `无法识别的演出：${input}`, { hint: '传 projectId 或演出详情链接' })
  return id
}
