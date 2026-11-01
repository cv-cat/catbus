import type { HandlerContext } from '../../../core/registry.js'
import type { Category, Item, Poi } from '../../../core/schemas.js'
import { paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { MaoyanClient } from './client.js'
import { CATEGORIES, category, cityPoi, detailItem, showItem } from './normalize.js'
import { cityList, resolveCity, resolveProject } from './resolve.js'

export async function feedList(ctx: HandlerContext) {
  const client = new MaoyanClient(ctx)
  const city = resolveCity(String(ctx.options.city))
  const wanted = ctx.options.category as string | undefined
  const list = (await api.hotShows(client, city.id)).filter((r) => !wanted || String(r.categoryId) === wanted)
  return paged(list.map(showItem), null, false)
}

export async function feedCategories(_ctx: HandlerContext): Promise<Category[]> {
  return CATEGORIES.map(category)
}

export async function itemGet(ctx: HandlerContext): Promise<Item> {
  const client = new MaoyanClient(ctx)
  return detailItem(await api.projectDetail(client, resolveProject(String(ctx.args.item))))
}

export async function poiSearch(ctx: HandlerContext) {
  const q = String(ctx.args.keyword).trim().replace(/市$/, '')
  const pois: Poi[] = cityList()
    .filter((c) => c.name.includes(q) || c.id === q)
    .map(cityPoi)
  return paged(pois, null, false)
}
