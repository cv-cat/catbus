import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Item, Media } from '../../../core/schemas.js'
import { authError, isGuest, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { Weibo } from './client.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN } from './profile.js'
import { resolveItem, resolveUser } from './resolve.js'

type Ctx = HandlerContext

// ================================================================ auth

export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const w = new Weibo({ ...ctx, account: 'login', credential })
  const self = await api.selfInfo(w)
  if (!self) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '在浏览器登录 weibo.com 后，复制请求头里完整的 Cookie' })
  return finishLogin(ctx, credential, { id: self.uid, name: n.str(self.nick), url: norm.userUrl(self.uid) })
}

/** 登录态的过期时间：cookie ALF 是 SUB 的过期秒数（可能带 `02_` 前缀）。 */
function expiresAt(w: Weibo): string | null {
  const alf = /(\d{9,})$/.exec(w.jar.get('ALF') ?? '')?.[1]
  const sub = w.jar.forUrl('https://weibo.com/').find((c) => c.name === 'SUB')?.expires
  return n.time(alf ?? sub)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const w = new Weibo(ctx)
  const self = isGuest(ctx) ? null : await api.selfInfo(w)
  return {
    logged_in: Boolean(self),
    user: self ? n.userRef({ id: self.uid, name: self.nick, url: norm.userUrl(self.uid) }) : null,
    method: self ? ctx.credential.method : null,
    expires_at: self ? expiresAt(w) : null,
  }
}

/** 需要登录的操作：取当前账号的 uid 与昵称（上游 post_weibo 每次都先调 get_self_info）。 */
async function self(w: Weibo): Promise<api.SelfInfo> {
  w.requireLogin()
  const me = await api.selfInfo(w)
  if (!me) throw authError(w.ctx)
  return me
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const w = new Weibo(ctx)
  const uid = await resolveUser(w, ctx.args.user!)
  const body = await api.userInfo(w, uid)
  const u = body.data?.user
  if (!u) throw new CatbusError('UPSTREAM', `用户 ${uid} 不存在或不可见`, { detail: { uid } })
  return norm.user(u)
}

/** cursor：`<page>:<since_id>`。 */
export async function userItems(ctx: Ctx) {
  const w = new Weibo(ctx)
  const uid = await resolveUser(w, ctx.args.user!)
  const cursor = ctx.cursor ?? '1:'
  const at = cursor.indexOf(':')
  const page = Number(at < 0 ? cursor : cursor.slice(0, at)) || 1
  const body = await api.userPosted(w, uid, page, at < 0 ? '' : cursor.slice(at + 1))
  const own = uid === ctx.credential.user?.id
  const list = ((body.data?.list ?? []) as any[]).map((m) => norm.mblog(m, own))
  const next = n.str(body.data?.since_id)
  return paged(list, `${page + 1}:${next ?? ''}`, Boolean(next))
}

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const w = new Weibo(ctx)
  const { mid } = resolveItem(ctx.args.item!)
  const d = await api.mobileDetail(w, mid)
  if (!d?.status) throw new CatbusError('UPSTREAM', `微博 ${mid} 不存在、已删除或不可见`)
  return norm.mblog(d.status, d.status.user?.id != null && String(d.status.user.id) === ctx.credential.user?.id)
}

/** 搜索结果：顶层 card_type=9 的卡片，以及 card_group 里的 card_type=9。 */
function searchMblogs(cards: any[]): any[] {
  const out: any[] = []
  const seen = new Set<string>()
  const add = (c: any) => {
    if (c?.card_type !== 9 || !c.mblog) return
    const id = String(c.mblog.mid ?? c.mblog.id)
    if (!seen.has(id)) (seen.add(id), out.push(c.mblog))
  }
  for (const c of cards ?? []) {
    add(c)
    for (const g of c.card_group ?? []) add(g)
  }
  return out
}

export async function itemSearch(ctx: Ctx) {
  const w = new Weibo(ctx)
  const page = Number(ctx.cursor ?? 1) || 1
  let body
  try {
    // 第二页起访客会遇到登录墙，那是真的要登录，不用重新生成访客身份
    body = await api.mobileSearch(w, ctx.args.keyword!, page, { retry: page === 1 })
  } catch (err) {
    if (page > 1 && err instanceof CatbusError && err.code === 'AUTH_REQUIRED') {
      ctx.log.warn('m.weibo.cn 只允许游客查看第一页搜索结果，已停止翻页')
      return paged([], null, false)
    }
    throw err
  }
  const list = searchMblogs(body.data?.cards).map((m) => norm.mblog(m))
  const next = Number(body.data?.cardlistInfo?.page ?? 0)
  return paged(list, next, next > page && list.length > 0)
}

const VISIBLE: Record<string, string> = { public: '0', private: '1', friends: '6' }
const MAX_IMAGES = 15

/** 上游 post_weibo 的正文：话题追加成 ` #话题# `，地点追加成 ` #地点[地点]#`。 */
function content(text: string, topics: string[], location: string): string {
  let s = text
  for (const t of topics) s += ` #${t}# `
  if (location) s += ` #${location}[地点]#`
  return s
}

export async function itemPublish(ctx: Ctx): Promise<Item> {
  const o = ctx.options as Record<string, any>
  for (const key of ['title', 'cover', 'tag', 'mention', 'category', 'schedule', 'price']) {
    if (o[key] != null && !(Array.isArray(o[key]) && !o[key].length)) {
      throw new CatbusError('UNSUPPORTED', `微博发布不支持 --${key}`, { hint: '可用：--text、--image、--video、--topic、--poi（地点名称）、--visibility' })
    }
  }
  const images = (o.image as string[] | undefined) ?? []
  if (images.length && o.video) throw new CatbusError('USAGE', '--image 和 --video 不能同时使用')
  if (images.length > MAX_IMAGES) throw new CatbusError('USAGE', `微博最多 ${MAX_IMAGES} 张图片`)
  const text = (o.text as string | undefined) ?? ''
  if (!text && !images.length && !o.video) throw new CatbusError('USAGE', '需要 --text、--image 或 --video', { hint: 'catbus weibo item publish --text "正文" [--image <图片>...]' })

  const w = new Weibo(ctx)
  const me = await self(w)
  const body = content(text, (o.topic as string[] | undefined) ?? [], (o.poi as string | undefined) ?? '')
  const visible = VISIBLE[(o.visibility as string) ?? 'public'] ?? '0'
  let result
  if (o.video) {
    const file = await readMedia(w.http, o.video)
    const mediaId = await uploadVideoFile(w, file.data, true)
    result = await api.postVideo(w, body, visible, mediaId)
  } else {
    const pids: string[] = []
    for (const input of images) {
      const file = await readMedia(w.http, input)
      pids.push(String((await api.uploadImage(w, me.uid, me.nick, file.data)).pic.pid))
    }
    result = await api.postImage(w, body, visible, pids)
  }
  const d = result.data
  if (!d) throw new CatbusError('UPSTREAM', '发布没有返回微博', { detail: { body: result } })
  return norm.mblog(d, true)
}

/** 视频上传：init → 整个文件一次上传 → check；waitOutput 时再轮询转码结果（上游 post_weibo 的做法）。返回 media_id。 */
async function uploadVideoFile(w: Weibo, data: Uint8Array, waitOutput: boolean): Promise<string | number> {
  const init = await api.videoInit(w, data)
  const { upload_id: uploadId, media_id: mediaId, auth } = init
  if (uploadId == null || mediaId == null || !auth) throw new CatbusError('UPSTREAM', '申请上传视频没有返回 upload_id / media_id', { detail: { body: init } })
  await api.uploadVideo(w, String(uploadId), String(mediaId), data, String(auth))
  await api.videoCheck(w, String(uploadId), String(mediaId), data.length, String(auth))
  if (waitOutput) {
    // 上游每 2 秒轮询一次、没有上限；这里最多等 5 分钟
    for (let i = 0; ; i++) {
      const out = await api.videoOutput(w, String(mediaId))
      if (out.data && Object.keys(out.data).length > 0) break
      if (i >= 150) throw new CatbusError('UPSTREAM', '视频转码超时（5 分钟）', { detail: { media_id: String(mediaId) } })
      w.ctx.log.info('视频转码中…')
      await rand.sleep(2000, w.ctx.signal)
    }
  }
  return mediaId
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  const w = new Weibo(ctx)
  const ref = resolveItem(ctx.args.item!)
  let uid = ref.uid
  if (!uid) {
    const d = await api.mobileDetail(w, ref.mid)
    uid = d?.status?.user?.id != null ? String(d.status.user.id) : null
    if (!uid) throw new CatbusError('UPSTREAM', `微博 ${ref.mid} 不存在、已删除或不可见`)
  }
  const body = await api.comments(w, uid, ref.mid, ctx.cursor ?? undefined)
  const list = ((body.data ?? []) as any[]).map((c) => norm.comment(c, ref.mid))
  const next = n.str(body.max_id)
  return paged(list, next, Boolean(next && next !== '0' && list.length))
}

// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const w = new Weibo(ctx)
  const file = await readMedia(w.http, ctx.args.file!)
  if (file.contentType.startsWith('video/')) {
    w.requireLogin()
    const mediaId = String(await uploadVideoFile(w, file.data, false))
    return n.media({ id: mediaId, type: 'video', url: `https://video.weibo.com/show?fid=1034:${mediaId}` })
  }
  const me = await self(w)
  const d = await api.uploadImage(w, me.uid, me.nick, file.data)
  const pic = d.pic
  return n.media({ id: String(pic.pid), type: 'image', url: `https://wx1.sinaimg.cn/large/${pic.pid}.jpg`, width: n.count(pic.width), height: n.count(pic.height) }, d)
}
