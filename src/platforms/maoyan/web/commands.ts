import { CatbusError } from '../../../core/errors.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Account, AuthStatus, Category, Item, Poi } from '../../../core/schemas.js'
import { authError, isGuest, jarOf, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { MaoyanClient } from './client.js'
import { cookieLogin, qrcodeLogin } from './login.js'
import { CATEGORIES, category, cityPoi, detailItem, showItem } from './normalize.js'
import { cityList, resolveCity, resolveProject } from './resolve.js'

export async function authLogin(ctx: HandlerContext): Promise<Account> {
  const method = ctx.options.method as string
  if (method === 'cookie') return cookieLogin(ctx)
  if (method === 'qrcode') return qrcodeLogin(ctx)
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

const token = (ctx: HandlerContext) => (isGuest(ctx) ? undefined : jarOf(ctx.credential).get('dper'))

export async function authStatus(ctx: HandlerContext): Promise<AuthStatus> {
  const empty: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  const dper = token(ctx)
  if (!dper) return empty
  try {
    const user = await api.currentUser(new MaoyanClient(ctx), dper)
    return { logged_in: true, user, method: ctx.credential.method, expires_at: null }
  } catch (e) {
    if (e instanceof CatbusError && (e.code === 'AUTH_REQUIRED' || e.code === 'AUTH_EXPIRED')) return empty
    throw e
  }
}

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
  const projectId = resolveProject(String(ctx.args.item))
  const dper = ctx.options.tickets ? token(ctx) : undefined
  if (ctx.options.tickets && !dper) throw authError(ctx, '查询场次、票档、余票需要登录')
  const client = new MaoyanClient(ctx)
  const detail = await api.projectDetail(client, projectId)
  if (!dper) return detailItem(detail)
  return detailItem(detail, await api.showsWithTickets(client, projectId, String(detail.baseProjectVO.cityId ?? 1), dper))
}

export async function poiSearch(ctx: HandlerContext) {
  const q = String(ctx.args.keyword).trim().replace(/市$/, '')
  const pois: Poi[] = cityList()
    .filter((c) => c.name.includes(q) || c.id === q)
    .map(cityPoi)
  return paged(pois, null, false)
}
