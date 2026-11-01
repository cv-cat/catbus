import { type Category, type Item, type Media, type Poi, type Price, type UserRef, withRaw } from '../../../core/schemas.js'
import type { City } from './resolve.js'

/**
 * 演出分类（列表的 categoryId / categoryName）。列表接口不接受分类参数，`--category` 在本地筛选。
 * 取自各城市 hotShows 的实际返回（2026-11-01）。
 */
export const CATEGORIES: [string, string][] = [
  ['1', '演唱会'],
  ['2', '体育赛事'],
  ['3', '戏曲艺术'],
  ['4', '话剧音乐剧'],
  ['5', '舞蹈芭蕾'],
  ['6', '音乐会'],
  ['7', '亲子演出'],
  ['9', '休闲展览'],
  ['10', '音乐节'],
  ['12', '电竞赛事'],
  ['15', '脱口秀'],
  ['16', '相声'],
  ['17', 'Livehouse'],
]

export const projectUrl = (id: string) => `https://show.maoyan.com/qqw#/detail/${id}`

const STATS = () => ({ views: null, likes: null, comments: null, collects: null, shares: null })

function price(v: unknown): Price | null {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) ? { amount: n, currency: 'CNY' } : null
}

function performer(c: any): UserRef | null {
  return c?.celebrityId != null ? { id: String(c.celebrityId), name: c.celebrityName ?? null, url: null } : null
}

/** 场次、场馆、售卖状态没有对应的 Item 字段，按「键：值」逐行写进 text；原始字段用 --raw。 */
function lines(pairs: [string, unknown][]): string | null {
  const out = pairs.filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => `${k}：${String(v).trim()}`)
  return out.length ? out.join('\n') : null
}

/** hotShows 的 recordList 条目。 */
export function showItem(r: any): Item {
  const id = String(r.projectId)
  const performers = (r.celebrityVOList ?? []).map((c: any) => c.celebrityName).filter(Boolean)
  return withRaw(
    {
      id,
      kind: 'goods',
      url: projectUrl(id),
      title: r.projectName ?? null,
      text: lines([
        ['分类', r.categoryName],
        ['演出者', performers.join('、')],
        ['开售', r.onSaleTimeDisplay],
      ]),
      author: performer(r.celebrityVOList?.[0]),
      created_at: null,
      cover: r.posterUrl ?? null,
      media: [],
      stats: STATS(),
      price: price(r.price),
      status: null,
    },
    r,
  )
}

/** 详情介绍（HTML）里的图片。 */
function detailImages(html: unknown): Media[] {
  return [...String(html ?? '').matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => ({
    id: null,
    type: 'image' as const,
    url: m[1]!.replace(/&amp;/g, '&'),
    width: null,
    height: null,
    duration: null,
  }))
}

/** project/detail 的 data。 */
export function detailItem(d: any): Item {
  const b = d.baseProjectVO ?? {}
  const shop = d.shopVO ?? {}
  const id = String(b.performanceId)
  const venue = shop.shopName ? `${shop.shopName}${shop.address ? `（${shop.address}）` : ''}` : null
  return withRaw(
    {
      id,
      kind: 'goods',
      url: projectUrl(id),
      title: b.name ?? null,
      text: lines([
        ['时间', b.showTimeRange],
        ['城市', b.cityName],
        ['场馆', venue],
        ['票价', (d.priceVO?.sellPriceList ?? []).join('、')],
        ['状态', b.buttonContext?.message],
      ]),
      author: null,
      created_at: null,
      cover: b.posterUrl ?? null,
      media: detailImages(d.projectParticularsVO?.detail),
      stats: STATS(),
      price: price(b.lowestPrice),
      status: null,
    },
    d,
  )
}

export function category([id, name]: [string, string]): Category {
  return { id, name, parent_id: null }
}

/** 演出城市作为地点：id 是 `feed list --city` 的取值。 */
export function cityPoi(c: City): Poi {
  return withRaw({ id: c.id, name: c.name, address: null }, c)
}
