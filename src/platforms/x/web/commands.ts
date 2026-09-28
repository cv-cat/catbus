import { CatbusError } from '../../../core/errors.js'
import { downloadMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Media } from '../../../core/schemas.js'
import { authError, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { markdownToContentState, splitTitle } from './article.js'
import { isAuthCode, type XClient, xclient } from './client.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, PROFILE } from './profile.js'
import { isUserId, parseArticleId, parseTweetId } from './resolve.js'

type Ctx = HandlerContext

// ================================================================ 公共

/**
 * 当前账号（Viewer）。cookie 失效时 X 仍回 200 和部分 data，只在 errors 里给 code 32，
 * 所以按错误码判断登录态（上游 main.py 的 _saved_cookie_is_valid）。
 */
async function viewer(x: XClient): Promise<any> {
  const res = await api.getViewer(x)
  const u = res?.data?.viewer?.user_results?.result
  if (u?.rest_id) return u
  const errors: any[] = res?.errors ?? []
  if (errors.some((e) => isAuthCode(e?.code))) throw authError(x.ctx, errors.map((e) => e?.message).join('; '))
  throw new CatbusError('UPSTREAM', 'Viewer 响应里没有当前用户', { detail: res })
}

/** UserByScreenName / UserByRestId 响应里的用户；不存在、被封禁时报错。 */
function userOf(res: any, input: string): any {
  const u = res?.data?.user?.result
  if (!u?.rest_id) {
    const reason = u?.__typename === 'UserUnavailable' ? `：${u.message ?? u.reason ?? '不可用'}` : ''
    throw new CatbusError('UPSTREAM', `用户 ${input} 不存在或不可见${reason}`, { detail: u ?? res })
  }
  return u
}

/** 用户参数 → 数字 rest_id：`me` 取 twid，纯数字直接用，其余按用户名查（上游 get_user_id）。 */
async function resolveUserId(x: XClient, input: string): Promise<string> {
  if (input === 'me') {
    x.requireLogin()
    return x.userId || (await viewer(x)).rest_id
  }
  if (isUserId(input)) return input.trim()
  return userOf(await api.getUserInfo(x, input), input).rest_id
}

/** 推文对象；已删除、受保护等不可见时报错。 */
async function tweetOf(x: XClient, input: string): Promise<any> {
  const res = await api.getWorkResult(x, input)
  const t = res?.data?.tweetResult?.result
  if (!norm.unwrap(t)?.legacy) {
    const reason = t?.reason ?? t?.tombstone?.text?.text
    throw new CatbusError('UPSTREAM', `推文 ${input} 不存在或不可见${reason ? `：${reason}` : ''}`, { detail: t ?? res })
  }
  return t
}

/** 时间线分页：游标没变或这一页是空的就算翻到底了。 */
function timeline<T>(ctx: Ctx, list: T[], res: any) {
  const next = norm.cursorOf(res, 'Bottom')
  return paged(list, next, Boolean(next) && list.length > 0 && next !== ctx.cursor)
}

// ================================================================ auth

/** 只支持 cookie 导入（注册表只声明了 cookie）；上游的账密登录依赖 Castle token，不移植。 */
export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const names = new Set(credential.scopes.main!.cookies.map((c) => c.name))
  if (!names.has('auth_token') || !names.has('ct0')) {
    throw new CatbusError('USAGE', 'X 的 cookie 需要包含 auth_token 和 ct0', { hint: '在已登录的 x.com 页面复制完整的 Cookie 请求头' })
  }
  const x = await xclient({ ...ctx, account: 'login', credential })
  let me: any
  try {
    me = await viewer(x)
  } catch (err) {
    if (err instanceof CatbusError && (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED')) {
      throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '重新在浏览器登录 x.com 后复制 cookie' })
    }
    throw err
  }
  return finishLogin(ctx, credential, norm.userRef(me)!)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const x = await xclient(ctx)
  const out: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  if (!x.isLoggedIn) return out
  let me: any
  try {
    me = await viewer(x)
  } catch (err) {
    if (err instanceof CatbusError && (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED')) return out
    throw err
  }
  const expires = x.jar.cookies.find((c) => c.name === 'auth_token')?.expires
  return { logged_in: true, user: norm.userRef(me), method: ctx.credential.method, expires_at: expires ? n.time(expires) : null }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const x = await xclient(ctx)
  const input = ctx.args.user!
  if (input === 'me') {
    x.requireLogin()
    return norm.user(await viewer(x))
  }
  const res = isUserId(input) ? await api.getUserById(x, input.trim()) : await api.getUserInfo(x, input)
  return norm.user(userOf(res, input))
}

export async function userSearch(ctx: Ctx) {
  const x = await xclient(ctx)
  const res = await api.searchWork(x, ctx.args.keyword!, ctx.cursor ?? undefined, 'People')
  return timeline(ctx, norm.userResults(res).map(norm.user), res)
}

export async function userItems(ctx: Ctx) {
  const x = await xclient(ctx)
  const id = await resolveUserId(x, ctx.args.user!)
  // 登录后主页 Posts 标签是 UserOriginalsTimeline；未登录只能用老的 UserTweets（前者游客 404）
  const op = x.isLoggedIn ? 'UserOriginalsTimeline' : 'UserTweets'
  const res = await api.getUserPostNote(x, id, ctx.cursor ?? undefined, 20, op)
  return timeline(ctx, norm.tweetResults(res).map(norm.item), res)
}

async function follow(ctx: Ctx, on: boolean) {
  const x = await xclient(ctx)
  x.requireLogin()
  const id = await resolveUserId(x, ctx.args.user!)
  await (on ? api.followUser(x, id) : api.unfollowUser(x, id))
  return { id }
}
export const userFollow = (ctx: Ctx) => follow(ctx, true)
export const userUnfollow = (ctx: Ctx) => follow(ctx, false)

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const x = await xclient(ctx)
  return norm.item(await tweetOf(x, ctx.args.item!))
}

const SEARCH_PRODUCT: Record<string, string> = { general: 'Top', latest: 'Latest' }

export async function itemSearch(ctx: Ctx) {
  const x = await xclient(ctx)
  const product = SEARCH_PRODUCT[(ctx.options.sort as string) ?? 'general'] ?? 'Top'
  const res = await api.searchWork(x, ctx.args.keyword!, ctx.cursor ?? undefined, product)
  return timeline(ctx, norm.tweetResults(res).map(norm.item), res)
}

export async function itemMedia(ctx: Ctx): Promise<Media[]> {
  const x = await xclient(ctx)
  return norm.item(await tweetOf(x, ctx.args.item!)).media
}

export async function itemDownload(ctx: Ctx) {
  const x = await xclient(ctx)
  const it = norm.item(await tweetOf(x, ctx.args.item!))
  // 图片显式要 orig 才是原图（上游 download_work）
  const media = it.media.map((m) => (m.type === 'image' ? { ...m, url: `${m.url}?format=jpg&name=orig` } : m))
  return downloadMedia(ctx, x.http, it.id, media, {
    headers: [['user-agent', PROFILE.ua]],
    ext: (m) => (m.type === 'image' ? 'jpg' : 'mp4'),
  })
}

/** 点赞 / 收藏 / 转发这类只带推文 id 的写操作。 */
async function act(ctx: Ctx, target: string, call: (x: XClient, id: string) => Promise<unknown>) {
  const x = await xclient(ctx)
  x.requireLogin()
  const id = parseTweetId(target)
  await call(x, id)
  return { id }
}

export const itemLike = (ctx: Ctx) => act(ctx, ctx.args.item!, api.favoriteTweet)
export const itemUnlike = (ctx: Ctx) => act(ctx, ctx.args.item!, api.unfavoriteTweet)
export const itemCollect = (ctx: Ctx) => act(ctx, ctx.args.item!, api.createBookmark)
export const itemUncollect = (ctx: Ctx) => act(ctx, ctx.args.item!, api.deleteBookmark)
export const itemRepost = (ctx: Ctx) => act(ctx, ctx.args.item!, api.createRetweet)
export const itemUnrepost = (ctx: Ctx) => act(ctx, ctx.args.item!, api.deleteRetweet)
export const itemDelete = (ctx: Ctx) => act(ctx, ctx.args.item!, api.deleteTweet)

/** X 发推不支持的发布选项。 */
const PUBLISH_UNSUPPORTED = ['title', 'cover', 'tag', 'topic', 'mention', 'poi', 'category', 'schedule', 'price'] as const
/** thread 两条之间的间隔（上游 post_thread 的 interval），太快容易触发风控。 */
const THREAD_INTERVAL = 2000

/**
 * 发推：先传媒体（最多 4 张图，或 1 个视频），再发推。正文超过 280 权重时自动改发长推（CreateNoteTweet）。
 * 带 `--thread` 时接着逐条发，每条回复上一条（上游 post_thread），返回第一条。上游 XWriteAPI.post_tweet。
 */
export async function itemPublish(ctx: Ctx) {
  const o = ctx.options as Record<string, any>
  const bad = PUBLISH_UNSUPPORTED.filter((k) => o[k] != null && !(Array.isArray(o[k]) && !o[k].length))
  if (bad.length) throw new CatbusError('UNSUPPORTED', `X 发推不支持 ${bad.map((k) => `--${k}`).join('、')}`)
  if (o.visibility && o.visibility !== 'public') throw new CatbusError('UNSUPPORTED', 'X 的推文只能公开发布')
  const images: string[] = o.image ?? []
  if (images.length && o.video) throw new CatbusError('USAGE', 'X 的一条推文不能同时带图片和视频')
  if (images.length > 4) throw new CatbusError('USAGE', 'X 的一条推文最多 4 张图片')
  const text: string = o.text ?? ''
  if (!text && !images.length && !o.video) throw new CatbusError('USAGE', '发推需要 --text、--image 或 --video')
  const thread: string[] = o.thread ?? []
  if (thread.some((t) => !t.trim())) throw new CatbusError('USAGE', '--thread 的每一条都不能为空')
  const x = await xclient(ctx)
  x.requireLogin()
  const mediaIds: string[] = []
  for (const input of o.video ? [o.video as string] : images) {
    const file = await readMedia(x.http, input)
    mediaIds.push((await api.upload(x, file.data, file.filename)).mediaId)
  }
  const first = api.createdTweet(await api.postTweet(x, text, mediaIds))
  const posted = [norm.item(first)]
  for (const [i, t] of thread.entries()) {
    await rand.sleep(THREAD_INTERVAL)
    try {
      posted.push(norm.item(api.createdTweet(await api.postTweet(x, t, [], posted.at(-1)!.id))))
    } catch (err) {
      const e = err instanceof CatbusError ? err : new CatbusError('ERROR', String((err as Error)?.message ?? err))
      // 中途失败：前面几条已经发出去了，把它们的 id 放进 detail，方便删除或接着发
      throw new CatbusError(e.code, `thread 第 ${i + 2} 条失败：${e.message}`, {
        hint: e.hint,
        detail: { posted: posted.map((p) => ({ id: p.id, url: p.url })), error: e.detail },
      })
    }
  }
  return posted[0]
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  const x = await xclient(ctx)
  const id = parseTweetId(ctx.args.item!)
  const res = await api.getWorkInfo(x, id, ctx.cursor ?? undefined)
  return timeline(ctx, norm.replyResults(res).map((r) => norm.comment(r, id)), res)
}

/** 评论就是一条回复推文；`--reply-to` 时回复那条评论。 */
export async function commentAdd(ctx: Ctx) {
  const x = await xclient(ctx)
  x.requireLogin()
  const id = parseTweetId(ctx.args.item!)
  const to = ctx.options.replyTo as string | undefined
  const created = api.createdTweet(await api.createTweet(x, ctx.args.text!, [], to ? parseTweetId(to) : id))
  return norm.comment(created, id)
}

export const commentDelete = (ctx: Ctx) => act(ctx, ctx.args.comment!, api.deleteTweet)
export const commentLike = (ctx: Ctx) => act(ctx, ctx.args.comment!, api.favoriteTweet)
export const commentUnlike = (ctx: Ctx) => act(ctx, ctx.args.comment!, api.unfavoriteTweet)

// ================================================================ feed

export async function feedList(ctx: Ctx) {
  const kind = (ctx.options.kind as string) ?? 'recommend'
  if (kind === 'following') throw new CatbusError('NOT_IMPLEMENTED', 'x 的 feed list --kind following 尚未实现', { detail: { upstream: 'none' } })
  const x = await xclient(ctx)
  x.requireLogin()
  const res = await api.getHomeTimeline(x, ctx.cursor ?? undefined)
  return timeline(ctx, norm.tweetResults(res).map(norm.item), res)
}

// ================================================================ msg（X Chat）

export async function msgList(ctx: Ctx) {
  const x = await xclient(ctx)
  x.requireLogin()
  const page = (await api.getInitialChatPage(x))?.data?.get_initial_chat_page ?? {}
  const self = x.userId
  return paged((page.items ?? []).map((it: any) => norm.conversation(it, self)), null, false)
}

export async function msgHistory(ctx: Ctx) {
  const x = await xclient(ctx)
  x.requireLogin()
  const conversationId = ctx.args.conversation!
  const page = (await api.getConversationPage(x, conversationId))?.data?.get_conversation_page ?? {}
  const events: string[] = page.encoded_message_events ?? []
  if (events.length) ctx.log.warn('X Chat 的消息是端到端加密的，catbus 不解密：只给出占位的消息，原始事件用 --raw 查看')
  return paged(
    events.map((e, i) => norm.encryptedMessage(e, i, conversationId)),
    null,
    false,
  )
}

/**
 * 上游 XChatAPI.send_message 只是占位：X Chat 端到端加密，要先在网页设置 passcode、
 * 再逆向加密后的发送请求，上游还没有做，这里同样报 NOT_IMPLEMENTED。
 */
// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const x = await xclient(ctx)
  x.requireLogin()
  const file = await readMedia(x.http, ctx.args.file!)
  const { mediaId, mediaType, result } = await api.upload(x, file.data, file.filename)
  const img = result?.image ?? {}
  return n.media({ id: mediaId, type: mediaType.startsWith('video/') ? 'video' : 'image', url: '', width: n.count(img.w), height: n.count(img.h) }, result)
}

// ================================================================ article（平台扩展，AGENTS 4.7）

const articleUrl = (id: string) => `https://x.com/i/article/${id}`

/** 在 catbus 的错误上补充已建草稿的信息：发布失败时草稿还在，方便到网页上处理或删除。 */
function withDraft(err: unknown, articleId: string): CatbusError {
  const e = err instanceof CatbusError ? err : new CatbusError('ERROR', String((err as Error)?.message ?? err))
  return new CatbusError(e.code, `${e.message}（草稿 ${articleId} 已创建）`, {
    hint: e.hint ?? `到 ${api.articleEditUrl(articleId)} 查看，或 catbus x article delete ${articleId}`,
    detail: { article_id: articleId, edit_url: api.articleEditUrl(articleId), error: e.detail },
  })
}

/**
 * 从 Markdown 发文章：传正文插图 → 建草稿 → 标题 → 正文 → 传封面、设封面 → 发布（同时生成一条文章推文）。
 * 没给 `--title` 时取正文第一行的 `# 标题`。上游 XArticleAPI.post_article（publish=True）。
 */
export async function articlePublish(ctx: Ctx) {
  const o = ctx.options as { title?: string; text: string; cover?: string }
  let title: string | null | undefined = o.title
  let body = o.text
  if (title == null) [title, body] = splitTitle(body)
  if (!title) throw new CatbusError('USAGE', '文章标题不能为空：传 --title，或让正文第一行是 `# 标题`')
  const x = await xclient(ctx)
  x.requireLogin()
  const upload = async (input: string) => {
    const file = await readMedia(x.http, input)
    return api.articleUploadImage(x, file.data, file.filename)
  }
  const contentState = await markdownToContentState(body, upload)
  const articleId = api.extractArticleId(await api.articleCreateDraft(x))
  try {
    await api.articleUpdateTitle(x, articleId, title)
    await api.articleUpdateContent(x, articleId, contentState)
    if (o.cover) await api.articleUpdateCover(x, articleId, await upload(o.cover))
    await api.articlePublish(x, articleId)
  } catch (err) {
    throw withDraft(err, articleId)
  }
  return { id: articleId, url: articleUrl(articleId) }
}

/** 删文章：草稿或已发布的都可以，已发布的连同文章推文一起删（不可撤销）。上游 XArticleAPI.delete。 */
export async function articleDelete(ctx: Ctx) {
  const x = await xclient(ctx)
  x.requireLogin()
  const id = parseArticleId(ctx.args.article!)
  await api.articleDelete(x, id)
  return { id }
}
