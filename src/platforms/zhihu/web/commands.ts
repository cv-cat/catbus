import { CatbusError } from '../../../core/errors.js'
import { cookieCredential, finishLogin, loginContext } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Item, Question } from '../../../core/schemas.js'
import { paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { cursorPath, nextCursor, Zhihu } from './client.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, WWW } from './profile.js'
import { COMMENT_TYPE, resolveFolder, resolveItem, resolveQuestion, resolveUser } from './resolve.js'

type Ctx = HandlerContext

const isAuthError = (err: unknown) => err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')

/** 本命令接口下的 cursor（见 client.cursorPath）。 */
function cursor(ctx: Ctx, prefix: string): string | null {
  return ctx.cursor ? cursorPath(ctx.cursor, prefix) : null
}

function page<T>(data: T[], body: api.ListBody) {
  const next = nextCursor(body.paging)
  return paged(data, next, next != null)
}

/**
 * 搜索的下一页：paging.next 里的 lc_idx 总是 0，前端翻页用的是 search_action_info.lc_idx（已经展示到第几条），
 * 服务端靠它去掉上一页出现过的结果。不换的话翻页会重复。
 */
function searchPage<T>(data: T[], body: api.ListBody) {
  const next = nextCursor(body.paging)
  const lcIdx = body.search_action_info?.lc_idx
  if (next == null || lcIdx == null) return paged(data, next, next != null)
  const u = new URL(next, WWW)
  u.searchParams.set('lc_idx', String(lcIdx))
  return paged(data, u.pathname + u.search, true)
}

// ================================================================ auth

export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  if (!credential.scopes.main!.cookies.some((c) => c.name === 'z_c0')) {
    throw new CatbusError('USAGE', 'cookie 里没有登录态 z_c0', { hint: '在浏览器登录 www.zhihu.com 后，从 DevTools → Network 复制请求头里完整的 Cookie' })
  }
  const z = new Zhihu(loginContext(ctx, credential))
  let self: api.Me
  try {
    self = await api.me(z)
  } catch (err) {
    if (isAuthError(err)) {
      throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '在浏览器重新登录 www.zhihu.com 后，复制请求头里完整的 Cookie' })
    }
    throw err
  }
  credential.extra.url_token = self.url_token
  return finishLogin(ctx, credential, { id: String(self.id), name: n.str(self.name), url: norm.userUrl(self.url_token || self.id) })
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const z = new Zhihu(ctx)
  let self: api.Me | null = null
  if (z.isLogin) {
    try {
      self = await api.me(z)
    } catch (err) {
      if (!isAuthError(err)) throw err
    }
  }
  const expires = z.jar.forUrl(`${WWW}/`).find((c) => c.name === 'z_c0')?.expires
  return {
    logged_in: Boolean(self),
    user: self ? n.userRef({ id: self.id, name: self.name, url: norm.userUrl(self.url_token || self.id) }) : null,
    method: self ? ctx.credential.method : null,
    expires_at: self ? n.time(expires) : null,
  }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const z = new Zhihu(ctx)
  return norm.user(await api.member(z, await resolveUser(z, ctx.args.user!)))
}

export async function userSearch(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const body = await api.search(z, 'people', ctx.args.keyword!, cursor(ctx, '/api/v4/search_v3'))
  const users = (body.data ?? []).map((x: any) => x?.object).filter((o: any) => o?.type === 'people').map(norm.user)
  return searchPage(users, body)
}

/** `--type text`（默认）是回答，`article` 是文章；`--sort latest`（默认）按时间，`popular` 按赞同数。 */
export async function userItems(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const token = await resolveUser(z, ctx.args.user!)
  const sortBy = ctx.options.sort === 'popular' ? 'voteups' : 'created'
  const c = cursor(ctx, '/api/v4/members/')
  if (ctx.options.type === 'article') {
    const body = await api.memberArticles(z, token, sortBy, c)
    return page((body.data ?? []).map(norm.article), body)
  }
  const body = await api.memberAnswers(z, token, sortBy, c)
  return page((body.data ?? []).map(norm.answer), body)
}

async function relations(ctx: Ctx, kind: 'followers' | 'followees') {
  const z = new Zhihu(ctx)
  const token = await resolveUser(z, ctx.args.user!)
  const body = await api.memberRelations(z, token, kind, cursor(ctx, '/api/v4/members/'))
  return page((body.data ?? []).map(norm.user), body)
}

export const userFollowers = (ctx: Ctx) => relations(ctx, 'followers')
export const userFollowing = (ctx: Ctx) => relations(ctx, 'followees')

/** 返回目标用户的 id（与 user get 的 id 相同，AGENTS 6.3），所以先查一次用户；用户不存在时也不会发出写请求。 */
async function follow(ctx: Ctx, on: boolean) {
  const z = new Zhihu(ctx)
  const target = await api.member(z, await resolveUser(z, ctx.args.user!))
  await api.follow(z, target.url_token || String(target.id), on)
  return { id: String(target.id) }
}

export const userFollow = (ctx: Ctx) => follow(ctx, true)
export const userUnfollow = (ctx: Ctx) => follow(ctx, false)

// ================================================================ item

export async function itemGet(ctx: Ctx): Promise<Item> {
  const z = new Zhihu(ctx)
  const ref = resolveItem(ctx.args.item!)
  if (ref.type === 'article') return norm.article(await api.article(z, ref.id))
  if (ref.type === 'pin') return norm.pin(await api.pin(z, ref.id))
  return norm.answer(await api.answer(z, ref.id))
}

const SEARCH_SORT: Record<string, string> = { popular: 'upvoted_count', latest: 'created_time' }
const SEARCH_TIME: Record<string, string> = { day: 'a_day', week: 'a_week', month: 'a_month', half_year: 'half_a_year', year: 'a_year' }
const SEARCH_TYPE: Record<string, string> = { text: 'answer', article: 'article' }

export async function itemSearch(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const o = ctx.options as Record<string, string | undefined>
  const filter = { sort: SEARCH_SORT[o.sort ?? ''], time: SEARCH_TIME[o.time ?? ''], vertical: SEARCH_TYPE[o.type ?? ''] }
  const body = await api.search(z, 'general', ctx.args.keyword!, cursor(ctx, '/api/v4/search_v3'), filter)
  // 同一页里偶尔会有同一条内容出现两次（前端按 id 去重）
  const unique = new Map(norm.items(body.data, (x) => x?.object).map((x) => [x.id, x]))
  return searchPage([...unique.values()], body)
}

async function vote(ctx: Ctx, up: boolean) {
  const z = new Zhihu(ctx)
  const ref = resolveItem(ctx.args.item!)
  if (ref.type === 'pin') await api.votePin(z, ref.id, up)
  else if (ref.type === 'article') await api.voteArticle(z, ref.id, up)
  else await api.voteAnswer(z, ref.id, up)
  return { id: norm.itemId(ref.type, ref.id) }
}

export const itemLike = (ctx: Ctx) => vote(ctx, true)
export const itemUnlike = (ctx: Ctx) => vote(ctx, false)

// ================================================================ question（扩展）

export async function questionGet(ctx: Ctx): Promise<Question> {
  const z = new Zhihu(ctx)
  return norm.question(await api.question(z, resolveQuestion(ctx.args.question!)))
}

export async function questionAnswers(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const id = resolveQuestion(ctx.args.question!)
  const order = ctx.options.sort === 'latest' ? 'updated' : 'default'
  const body = await api.questionFeeds(z, id, order, cursor(ctx, `/api/v4/questions/${id}/`))
  // feeds 的每一项把回答放在 target 里
  return page(norm.items(body.data, (x) => x?.target ?? x), body)
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const ref = resolveItem(ctx.args.item!)
  const itemId = norm.itemId(ref.type, ref.id)
  const order = ctx.options.sort === 'latest' ? 'ts' : 'score'
  const body = await api.rootComments(z, COMMENT_TYPE[ref.type], ref.id, order, cursor(ctx, '/api/v4/comment_v5/'))
  return page((body.data ?? []).map((c: any) => norm.comment(c, itemId)), body)
}

export async function commentReplies(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const ref = resolveItem(ctx.args.item!)
  const itemId = norm.itemId(ref.type, ref.id)
  const root = ctx.args.comment!.trim()
  if (!/^\d+$/.test(root)) throw new CatbusError('USAGE', `评论 ID 是数字：${root}`)
  const body = await api.childComments(z, root, cursor(ctx, '/api/v4/comment_v5/'))
  return page((body.data ?? []).map((c: any) => norm.comment(c, itemId, root)), body)
}

// ================================================================ feed

export async function feedList(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const kind = (ctx.options.kind as string | undefined) ?? 'recommend'
  if (kind === 'hot') {
    const body = await api.hotList(z)
    return paged((body.data ?? []).map(norm.hotQuestion).filter((x): x is Item => x != null), null, false)
  }
  const body = kind === 'following' ? await api.moments(z, cursor(ctx, '/api/v3/moments')) : await api.recommend(z, cursor(ctx, '/api/v3/feed/topstory/'))
  return page(norm.items(body.data, (x) => x?.target), body)
}

// ================================================================ keyword

export async function keywordSuggest(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const body = await api.suggest(z, ctx.args.prefix!)
  return (body.suggest ?? []).map(norm.suggestion).filter((k) => k.text)
}

export async function keywordHot(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const body = await api.topSearch(z)
  return (body.top_search?.words ?? []).map(norm.hotWord).filter((k) => k.text)
}

// ================================================================ folder

export async function folderList(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const token = await resolveUser(z, ctx.args.user!)
  const body = await api.collections(z, token, cursor(ctx, '/api/v4/people/'))
  return page((body.data ?? []).map(norm.folder), body)
}

export async function folderItems(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const id = resolveFolder(ctx.args.folder!)
  const body = await api.collectionItems(z, id, cursor(ctx, `/api/v4/collections/${id}/`))
  return page(norm.items(body.data, (x) => x?.content ?? x), body)
}

// ================================================================ topic

export async function topicSearch(ctx: Ctx) {
  const z = new Zhihu(ctx)
  const body = await api.search(z, 'topic', ctx.args.keyword!, cursor(ctx, '/api/v4/search_v3'))
  const topics = (body.data ?? []).map((x: any) => x?.object).filter((o: any) => o?.type === 'topic').map(norm.topic)
  return searchPage(topics, body)
}
