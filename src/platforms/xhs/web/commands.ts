import { CatbusError } from '../../../core/errors.js'
import { imageSize } from '../../../core/image.js'
import { downloadMedia, type LocalMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential, interactive, loginContext, poll, prompt, showQrcode, smsLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import { parseCookieInput } from '../../../core/cookies.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Category, Conversation, Credential, Event, Media, Message, Notice, NoticeCount } from '../../../core/schemas.js'
import { reconnecting } from '../../../core/stream.js'
import { authError, isGuest, paged } from '../../../core/toolkit.js'
import { GUEST } from '../../../core/auth-store.js'
import * as api from './api.js'
import { isAuthFailure, Pc } from './client.js'
import { Creator } from './creator.js'
import * as capi from './creator-api.js'
import { CreatorLogin } from './creator-api.js'
import * as login from './login.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, CREATOR, WEB } from './profile.js'
import * as push from './push.js'
import { resolveNote, resolveRoom, resolveUser } from './resolve.js'

type Ctx = HandlerContext

// ================================================================ 会话

/**
 * 主站会话。游客（AGENTS 5.2）：凭证里没有访客会话时走一遍匿名设备初始化（a1 / webId / websectiga / gid /
 * 访客 web_session），缓存在 guest.json；访客会话失效时自动重建一次。
 */
async function pc(ctx: Ctx): Promise<Pc> {
  const p = new Pc(ctx)
  if (isGuest(ctx) && !p.isLogin) await guestInit(p)
  return p
}

async function guestInit(p: Pc): Promise<void> {
  p.ctx.log.info('正在初始化小红书游客设备（首次需要几秒）')
  await login.initAnonymous(p)
  await login.webprofile(p)
  p.ctx.credential.extra.user_id = ''
  p.save()
}

/** 跑一条主站命令：访客会话被判定为未登录时重建一次；结束时保存签名状态。 */
async function run<T>(ctx: Ctx, fn: (p: Pc) => Promise<T>): Promise<T> {
  const p = await pc(ctx)
  try {
    return await fn(p)
  } catch (err) {
    if (!(isGuest(ctx) && err instanceof CatbusError && err.code === 'AUTH_REQUIRED' && !ctx.credential.extra.guest_retry)) throw err
    ctx.credential.extra.guest_retry = true
    await guestInit(p)
    return await fn(p)
  } finally {
    delete ctx.credential.extra.guest_retry
    p.save()
  }
}

/** 主站已登录（有 web_session），可以用来换取创作者中心的登录态。 */
function canBridge(ctx: Ctx): boolean {
  if (isGuest(ctx)) return false
  return (ctx.credential.scopes.main?.cookies ?? []).some((c) => c.name === 'web_session' && c.value)
}

/**
 * 创作者中心的会话。上游 XHSUnifiedAuth.creator_auth 每个进程都从主站会话重新桥接（XHSCreatorAuth.from_pc_auth）；
 * catbus 把桥接结果存在 creator scope 里复用：
 * - creator scope 为空、主站已登录：先桥接；
 * - creator scope 已有 cookie，但创作者接口报登录失效：用主站登录态重新桥接一次，再重试。
 *   主站本身也失效时，桥接的 user/info 验收会报 AUTH_EXPIRED，照常报错。
 */
async function creator<T>(ctx: Ctx, fn: (c: Creator) => Promise<T>): Promise<T> {
  let c: Creator
  const bridged = canBridge(ctx) && !ctx.credential.scopes.creator?.cookies.length
  if (bridged) {
    ctx.log.info('第一次使用创作者中心：用主站的登录态初始化，不需要再扫码')
    c = await capi.creatorFromPc(ctx)
  } else c = new Creator(ctx)
  c.requireScope()
  try {
    return await fn(c)
  } catch (err) {
    const expired = err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')
    if (!expired || bridged || !canBridge(ctx)) throw err
    ctx.log.info('创作者中心的登录态失效了：用主站的登录态重新初始化')
    const saved = ctx.credential.scopes.creator
    try {
      c = await capi.creatorFromPc(ctx)
    } catch (bridgeErr) {
      // 桥接没成功：creator scope 还原成原来的，和 finally 里保存的签名状态对得上
      if (saved) ctx.credential.scopes.creator = saved
      throw bridgeErr
    }
    c.requireScope()
    return await fn(c)
  } finally {
    c.save()
  }
}

const cursorPage = (ctx: Ctx) => Number(ctx.cursor ?? 1) || 1

// ================================================================ auth

function loginCtx(ctx: Ctx, method: Credential['method']): Ctx {
  return { ...ctx, account: GUEST, credential: freshCredential(ctx, method) }
}

/** 主站登录成功后：user/me 校验、user 写入凭证、落盘。 */
async function completeLogin(ctx: Ctx, p: Pc) {
  const me = await login.loginUserMe(p)
  if (!me || me.guest !== false || !me.user_id) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：拿到的仍是访客会话')
  p.save()
  delete p.credential.extra.user_id
  return finishLogin(ctx, p.credential, norm.ref(me)!)
}

async function loginQrcode(ctx: Ctx) {
  const p = new Pc(loginCtx(ctx, 'qrcode'))
  await login.initAnonymous(p)
  const qr = await login.qrcodeCreate(p)
  // 浏览器顺序：建码 → 第一次匿名轮询 → webprofile
  const first = await login.qrcodeStatus(p, qr.qrId, qr.code)
  if (first !== 0) throw new CatbusError('AUTH_REQUIRED', `二维码状态异常：${first}`)
  await login.webprofile(p)
  await showQrcode(ctx, qr.url, '请用小红书 App 扫码并确认')
  let last = -1
  await poll(async () => {
    const s = await login.qrcodeStatus(p, qr.qrId, qr.code)
    if (s === 2) return true
    if (s === 3) throw new CatbusError('AUTH_REQUIRED', '二维码已过期', { hint: '重新执行 catbus xhs auth login' })
    if (s === 1 && last !== 1) ctx.log.info('已扫码，请在手机上确认')
    last = s
    return undefined
  })
  return completeLogin(ctx, p)
}

async function loginSms(ctx: Ctx) {
  const p = new Pc(loginCtx(ctx, 'sms'))
  return smsLogin(ctx, {
    send: async (phone) => {
      await login.initAnonymous(p)
      await login.webprofile(p)
      await login.sendSmsCode(p, phone)
      p.save()
      return { phone, cookies: [...p.jar.cookies], device: p.credential.device.pc, extra: { pc_dsl: p.credential.extra.pc_dsl } }
    },
    verify: async (state, code) => {
      if (!p.shared().a1) {
        p.jar.cookies.splice(0, p.jar.cookies.length, ...(state.cookies as Credential['scopes'][string]['cookies']))
        p.credential.device.pc = state.device as never
        Object.assign(p.credential.extra, state.extra)
        const again = new Pc(p.ctx)
        again.webprofileReported = true
        await login.smsLoginCode(again, String(state.phone), code)
        return completeLogin(ctx, again)
      }
      p.webprofileReported = true
      await login.smsLoginCode(p, String(state.phone), code)
      return completeLogin(ctx, p)
    },
  })
}

async function loginCookie(ctx: Ctx, scopeName: string) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  if (scopeName === 'creator') return creatorCookie(ctx, credential)
  const p = new Pc(loginContext(ctx, credential))
  const a1 = p.shared().a1 ?? ''
  if (!a1 || !p.shared().web_session) throw new CatbusError('USAGE', 'cookie 里需要有 a1 和 web_session', { hint: '从浏览器请求头复制完整的 Cookie' })
  if (a1.length !== 52) throw new CatbusError('USAGE', `cookie 里的 a1 长度不对（${a1.length}，应为 52）`, { hint: '从浏览器请求头复制完整的 Cookie' })
  const me = p.check(await api.userMe(p))
  if (!me?.user_id || me.guest === true) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期')
  p.save()
  return finishLogin(ctx, credential, norm.ref(me)!)
}

/** 创作者中心 scope：导入到已有账号（或新账号）的 creator 分区。 */
async function creatorCookie(ctx: Ctx, imported: Credential) {
  const target = await existingOrFresh(ctx, 'cookie')
  target.scopes.creator = { cookies: imported.scopes.main!.cookies, tokens: {} }
  return finishCreator(ctx, target)
}

async function existingOrFresh(ctx: Ctx, method: Credential['method']): Promise<Credential> {
  const { readCredential } = await import('../../../core/auth-store.js')
  const account = ctx.account ?? 'default'
  return (await readCredential(ctx.platform.id, ctx.endpoint, account).catch(() => null)) ?? freshCredential(ctx, method)
}

async function finishCreator(ctx: Ctx, credential: Credential) {
  const c = new Creator(loginContext(ctx, credential))
  c.requireScope()
  const info = c.check(await capi.userInfo(c))
  if (!info?.userId) throw new CatbusError('AUTH_REQUIRED', '创作者中心登录没有成功')
  c.save()
  const user = credential.user ?? norm.ref({ user_id: info.userId, nickname: info.userName })!
  if (credential.user && credential.user.id !== String(info.userId)) {
    throw new CatbusError('USAGE', `创作者中心登录的是另一个用户（${info.userName ?? info.userId}）`, { hint: '用 -a <新名字> 登录，或者先 logout' })
  }
  return finishLogin(ctx, credential, user)
}

/** 创作者中心扫码 / 短信登录（上游 XHSCreatorLoginApi，406 时整包重建匿名设备重试）。 */
async function loginCreator(ctx: Ctx, method: 'qrcode' | 'sms') {
  const credential = await existingOrFresh(ctx, method)
  const saved = credential.scopes.creator
  const temp = freshCredential(ctx, method)
  const c = new Creator({ ...ctx, account: GUEST, credential: temp })
  const l = new CreatorLogin(c)
  let qr: { id: string; url: string } | null = null
  const phone = method === 'sms' ? ((ctx.options.phone as string | undefined) ?? (interactive() ? await prompt('手机号：') : undefined)) : undefined
  if (method === 'sms' && !phone) throw new CatbusError('USAGE', '短信登录需要 --phone', { hint: 'catbus xhs auth login --scope creator --method sms --phone <手机号>' })
  for (let attempt = 1; attempt <= 16; attempt++) {
    await l.initCookies()
    await l.bootstrap()
    const session = await l.probeSession()
    await l.completeSecurity()
    if (session.active) break
    if (method === 'qrcode') {
      qr = await l.qrcode()
      if (qr) break
    } else {
      const r = await l.sendCode(phone!)
      if (r.ok) break
    }
    ctx.log.warn(`当前设备会话被拒绝，重建匿名设备重试（${attempt}/16）`)
  }
  if (method === 'qrcode') {
    if (!qr) throw new CatbusError('RISK_CONTROL', '创作者中心获取二维码失败', { detail: { kind: 'blocked' } })
    await showQrcode(ctx, qr.url, '请用小红书 App 扫码并确认（创作者中心）')
    let last: number | null = null
    await poll(
      async () => {
        const s = await l.qrcodeStatus(qr!.id)
        if (s === 1) return true
        if (s === 0 || s === 4 || s == null) throw new CatbusError('AUTH_REQUIRED', s === 4 ? '二维码已过期' : '二维码状态异常', { hint: '重新执行 catbus xhs auth login --scope creator' })
        if (s === 3 && last !== 3) ctx.log.info('已扫码，请在手机上确认')
        last = s
        return undefined
      },
      { interval: 1000 },
    )
  } else {
    const code = (ctx.options.code as string | undefined) ?? (interactive() ? (await prompt('验证码：')).trim() : undefined)
    if (!code) throw new CatbusError('USAGE', '创作者中心短信登录需要在终端里输入验证码，或加 --code', { hint: 'catbus xhs auth login --scope creator --method sms --phone <手机号> --code <验证码>' })
    await l.loginByCode(phone!, code)
  }
  const info = await l.userInfo()
  if (!info) {
    if (saved) credential.scopes.creator = saved
    throw new CatbusError('AUTH_REQUIRED', '创作者中心用户信息验收失败')
  }
  c.save()
  credential.scopes.creator = temp.scopes.creator!
  credential.device.creator = temp.device.creator!
  Object.assign(credential.extra, { creator_ds: temp.extra.creator_ds })
  const user = credential.user ?? norm.ref({ user_id: info.userId, nickname: info.userName })!
  return finishLogin(ctx, credential, user)
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  const scopeName = (ctx.options.scope as string | undefined) ?? 'main'
  if (method === 'cookie') return loginCookie(ctx, scopeName)
  if (scopeName === 'creator') {
    if (method !== 'qrcode' && method !== 'sms') throw new CatbusError('USAGE', `创作者中心不支持 ${method} 登录`)
    return loginCreator(ctx, method)
  }
  if (method === 'qrcode') return loginQrcode(ctx)
  if (method === 'sms') return loginSms(ctx)
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const p = new Pc(ctx)
  if (isGuest(ctx) || !p.isLogin) return { logged_in: false, user: null, method: null, expires_at: null }
  const r = await api.userMe(p)
  const me = r?.data
  const ok = r?.success !== false && me?.user_id && me?.guest !== true
  const sess = p.jar.cookies.find((c) => c.name === 'web_session')
  return { logged_in: Boolean(ok), user: ok ? norm.ref(me) : null, method: ok ? ctx.credential.method : null, expires_at: ok && sess?.expires ? n.time(sess.expires) : null }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  return run(ctx, async (p) => {
    if (ctx.args.user === 'me') return norm.me(p.check(await api.userMe(p)))
    const u = await resolveUser(p, ctx.args.user!)
    return norm.profile(p.check(await api.userInfo(p, u.id)), u.id, u.token)
  })
}

export async function userSearch(ctx: Ctx) {
  return run(ctx, async (p) => {
    const page = cursorPage(ctx)
    const d = p.check(await api.searchUsers(p, ctx.args.keyword!, page))
    return paged((d?.users ?? []).map(norm.searchUser), page + 1, Boolean(d?.has_more))
  })
}

function notesOf(kind: 'items' | 'likes' | 'collects') {
  const fn = kind === 'items' ? api.userNotes : kind === 'likes' ? api.userLikes : api.userCollects
  const defaultSource = kind === 'likes' ? 'pc_user' : 'pc_search'
  return (ctx: Ctx) =>
    run(ctx, async (p) => {
      const u = await resolveUser(p, ctx.args.user ?? 'me')
      const d = p.check(await fn(p, u.id, ctx.cursor ?? '', u.token, u.source || defaultSource))
      const list = (d?.notes ?? []).map(norm.card)
      return paged(list, d?.cursor, Boolean(d?.has_more) && list.length > 0)
    })
}

export const userItems = notesOf('items')
export const userLikes = notesOf('likes')
export const userCollects = notesOf('collects')

const FOLLOWING_SIZE = 200

/** 关注列表：上游只有私信页取当前账号关注列表的接口（get_following），别人的关注列表报 UNSUPPORTED。 */
export async function userFollowing(ctx: Ctx) {
  return run(ctx, async (p) => {
    const who = ctx.args.user ?? 'me'
    if (who !== 'me' && (await resolveUser(p, who)).id !== p.credential.user?.id) {
      throw new CatbusError('UNSUPPORTED', 'xhs 只能查看自己的关注列表', { hint: 'catbus xhs user following' })
    }
    const page = cursorPage(ctx)
    const d = p.check(await api.following(p, page, FOLLOWING_SIZE))
    const raw: any[] = d?.follow_user_d_t_o_list ?? d?.users ?? []
    return paged(raw.map(norm.followingUser), page + 1, Boolean(d?.has_more) || raw.length >= FOLLOWING_SIZE)
  })
}

// ================================================================ item

async function noteDetail(p: Pc, input: string) {
  const ref = await resolveNote(p, input)
  const d = p.check(await api.noteInfo(p, ref.id, ref.token, ref.source))
  const raw = d?.items?.[0]
  if (!raw) throw new CatbusError('UPSTREAM', '笔记不存在或需要 xsec_token（传完整的笔记链接）', { detail: { id: ref.id } })
  return { ref, item: norm.note(raw, ref.token) }
}

export async function itemGet(ctx: Ctx) {
  return run(ctx, async (p) => (await noteDetail(p, ctx.args.item!)).item)
}

const SORT: Record<string, string> = { general: 'general', latest: 'time_descending', popular: 'popularity_descending', comments: 'comment_descending', collects: 'collect_descending' }
const TYPE: Record<string, number> = { all: 0, video: 1, image: 2 }
/** 上游 note_time：0 不限、1 一天内、2 一周内、3 半年内。 */
const TIME: Record<string, number> = { all: 0, day: 1, week: 2, half_year: 3 }

export async function itemSearch(ctx: Ctx) {
  return run(ctx, async (p) => {
    // cursor 里带着第一页的 search_id（上游 search_some_note 翻页时复用同一个 root_search_id）
    let page = 1
    let sid: string | undefined
    if (ctx.cursor) {
      const [pg, s] = ctx.cursor.split(':')
      page = Number(pg) || 1
      sid = s || undefined
    }
    sid ??= api.searchId()
    const o = ctx.options as Record<string, string | undefined>
    const d = p.check(await api.searchNotes(p, ctx.args.keyword!, page, SORT[o.sort ?? 'general']!, TYPE[o.type ?? 'all']!, sid, TIME[o.time ?? 'all']!))
    const list = (d?.items ?? []).filter((x: any) => x.model_type ? x.model_type === 'note' : true).map(norm.card)
    return paged(list, `${page + 1}:${sid}`, Boolean(d?.has_more))
  })
}

export async function itemList(ctx: Ctx) {
  return creator(ctx, async (c) => {
    const page = Number(ctx.cursor ?? 0) || 0
    const d = c.check(await capi.postedNotes(c, page, 0, page > 0))
    const next = Number(d?.page ?? -1)
    return paged((d?.notes ?? []).map(norm.postedNote), next, next !== -1)
  })
}

async function noteMedia(p: Pc, input: string): Promise<{ id: string; media: Media[] }> {
  const { ref, item } = await noteDetail(p, input)
  let media = norm.mediaOf(item)
  if (item.kind === 'video' && !media.length) {
    const url = await api.noteVideo(p, ref.id)
    if (url) media = [n.media({ type: 'video', url })]
  }
  return { id: ref.id, media }
}

export async function itemMedia(ctx: Ctx) {
  return run(ctx, async (p) => (await noteMedia(p, ctx.args.item!)).media)
}

export async function itemDownload(ctx: Ctx) {
  return run(ctx, async (p) => {
    const { id, media } = await noteMedia(p, ctx.args.item!)
    return downloadMedia(ctx, p.http, id, media, {
      headers: [
        ['user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'],
        ['referer', `${WEB}/`],
      ],
      ext: (m) => (m.type === 'image' ? 'jpg' : 'mp4'),
    })
  })
}

const uploadImage = (c: Creator, file: LocalMedia) => capi.uploadImage(c, file.data, file.filename)

export async function itemPublish(ctx: Ctx) {
  const o = ctx.options as Record<string, any>
  if (!o.image?.length && !o.video) throw new CatbusError('USAGE', '小红书发布需要 --image 或 --video', { hint: 'catbus xhs item publish --title <标题> --text <正文> --image <图片>' })
  if (o.image?.length && o.video) throw new CatbusError('USAGE', '--image 和 --video 只能用一个')
  // 上游用 opencv 截视频首帧当封面；catbus 不带视频解码器，封面要自己给
  if (o.video && !o.cover) throw new CatbusError('USAGE', '小红书视频发布需要 --cover（catbus 不解码视频，截不了首帧）', { hint: 'catbus xhs item publish --video a.mp4 --cover a.jpg --title <标题>' })
  return creator(ctx, async (c) => {
    const postTime = o.schedule ? Date.parse(o.schedule) : null
    let postLoc: Record<string, unknown> | null = null
    if (o.poi) {
      const pois = c.check(await capi.searchPoi(c, o.poi))?.poi_list ?? []
      const loc = pois.find((x: any) => String(x.poi_id) === o.poi) ?? pois[0]
      if (!loc) throw new CatbusError('USAGE', `未找到地点：${o.poi}`, { hint: 'catbus xhs poi search <关键词>' })
      postLoc = { name: loc.name, subname: loc.full_address, poi_id: loc.poi_id, poi_type: loc.poi_type }
    }
    const note = { title: o.title ?? '', desc: o.text ?? '', postTime, postLoc, privacy: o.visibility === 'private' ? 1 : 0 }
    let data: Record<string, any>
    if (o.video) {
      const video = await readMedia(c.http, o.video)
      const cover = await readMedia(c.http, o.cover)
      if (!imageSize(cover.data)) throw new CatbusError('USAGE', `无法识别的图片：${cover.filename}`)
      data = await capi.videoNoteData(c, note, video.data, cover.data)
    } else {
      const images: capi.ImageInfo[] = []
      for (const input of o.image as string[]) images.push(await uploadImage(c, await readMedia(c.http, input)))
      data = capi.imageNoteData(note, images)
    }
    for (const topic of [...((o.topic as string[] | undefined) ?? []), ...((o.tag as string[] | undefined) ?? [])]) {
      const t = c.check(await capi.searchTopic(c, topic))?.topic_info_dtos?.[0]
      if (!t) throw new CatbusError('USAGE', `未找到话题：${topic}`)
      data.common.hash_tag.push({ id: t.id, link: t.link, name: t.name, type: 'topic' })
      data.common.desc += ` #${t.name}[话题]# `
    }
    const body = await capi.postNote(c, data)
    if (!body?.success && isAuthFailure(body)) throw authError(ctx, String(body?.msg ?? body?.message ?? '') || undefined)
    if (!body?.success) throw new CatbusError('UPSTREAM', String(body?.msg ?? body?.message ?? '发布失败'), { detail: { code: body?.code, result: body?.result } })
    const id = String(body?.data?.id ?? body?.data?.note_id ?? '')
    return n.item({ id, kind: o.video ? 'video' : 'image', url: id ? norm.noteUrl(id) : null, title: o.title ?? null, text: o.text ?? null, status: 'reviewing' }, body)
  })
}

// ================================================================ comment

export async function commentList(ctx: Ctx) {
  if (ctx.options.product) throw new CatbusError('NOT_IMPLEMENTED', 'xhs 的商品评价（--product）尚未实现', { detail: { upstream: 'none' } })
  return run(ctx, async (p) => {
    const ref = await resolveNote(p, ctx.args.item!)
    const d = p.check(await api.comments(p, ref.id, ctx.cursor ?? '', ref.token))
    const list = (d?.comments ?? []).map((x: any) => norm.comment(x, ref.id))
    return paged(list, d?.cursor, Boolean(d?.has_more))
  })
}

export async function commentReplies(ctx: Ctx) {
  return run(ctx, async (p) => {
    const ref = await resolveNote(p, ctx.args.item!)
    const d = p.check(await api.subComments(p, ref.id, ctx.args.comment!, ctx.cursor ?? '', ref.token))
    const list = (d?.comments ?? []).map((x: any) => norm.comment(x, ref.id, ctx.args.comment!))
    return paged(list, d?.cursor, Boolean(d?.has_more))
  })
}

// ================================================================ feed

export async function feedList(ctx: Ctx) {
  if (ctx.options.kind === 'following') throw new CatbusError('NOT_IMPLEMENTED', 'xhs 的 feed list --kind following 尚未实现', { detail: { upstream: 'none' } })
  return run(ctx, async (p) => {
    // cursor：note_index:cursor_score:频道
    let [index, score, category] = [0, '', (ctx.options.category as string | undefined) ?? 'homefeed_recommend']
    if (ctx.cursor) {
      const parts = ctx.cursor.split(':')
      index = Number(parts[0]) || 0
      score = parts[1] ?? ''
      category = parts.slice(2).join(':') || category
    }
    const d = p.check(await api.homefeed(p, category, score, index ? 3 : 1, index))
    const list = (d?.items ?? []).filter((x: any) => !x.model_type || x.model_type === 'note').map(norm.card)
    return paged(list, `${index + 20}:${d?.cursor_score ?? ''}:${category}`, list.length > 0)
  })
}

export async function feedCategories(ctx: Ctx): Promise<Category[]> {
  return run(ctx, async (p) => {
    const d = p.check(await api.homefeedCategories(p))
    return (d?.categories ?? []).map((x: any) => n.category({ id: String(x.id), name: String(x.name ?? x.id) }, x))
  })
}

// ================================================================ keyword / notice

/** 搜索联想词（上游 get_search_keyword，响应的 sug_items）。 */
export async function keywordSuggest(ctx: Ctx) {
  return run(ctx, async (p) => {
    const d = p.check(await api.searchKeyword(p, ctx.args.prefix!))
    return (d?.sug_items ?? [])
      .map((x: any) => n.keyword({ text: String(x?.text ?? x?.search_word ?? '') }, x))
      .filter((k: { text: string }) => k.text)
  })
}

export async function keywordHot(ctx: Ctx) {
  return run(ctx, async (p) => {
    const d = p.check(await api.trendingQueries(p))
    return (d?.queries ?? d?.hint_words ?? []).map((x: any) => n.keyword({ text: String(x.search_word ?? x.title ?? x.name ?? ''), heat: n.count(x.hot_value ?? x.heat ?? x.score) }, x))
  })
}

export async function noticeCount(ctx: Ctx): Promise<NoticeCount> {
  return run(ctx, async (p) => {
    const d = p.check(await api.unreadCount(p))
    return n.noticeCount({ total: n.count(d?.unread_count) ?? undefined, comment: null, mention: n.count(d?.mentions), like: n.count(d?.likes), follow: n.count(d?.connections), system: null }, d)
  })
}

const NOTICE_KINDS = { mentions: 'comment', likes: 'like', connections: 'follow' } as const

function noticeOf(kind: keyof typeof NOTICE_KINDS, v: any): Notice {
  const type: Notice['type'] = kind === 'mentions' ? (v.type === 'mention' || /at|mention/.test(String(v.type ?? '')) ? 'mention' : 'comment') : NOTICE_KINDS[kind]
  const target = v.item_info ?? v.comment_info?.target_note ?? null
  return n.notice(
    {
      id: String(v.id),
      type,
      user: norm.ref(v.user_info),
      target: target?.id ? { id: String(target.id), url: norm.noteUrl(String(target.id), target.xsec_token) } : null,
      text: n.str(v.comment_info?.content ?? v.title),
      created_at: n.time(v.time),
    },
    v,
  )
}

/** 通知：评论和 @、赞和收藏、新增关注三类，cursor 是三个游标（第一页三类都取）。 */
export async function noticeList(ctx: Ctx) {
  return run(ctx, async (p) => {
    const kinds = Object.keys(NOTICE_KINDS) as (keyof typeof NOTICE_KINDS)[]
    let cursors: Record<string, string | null> = Object.fromEntries(kinds.map((k) => [k, '']))
    if (ctx.cursor) cursors = JSON.parse(ctx.cursor)
    const out: Notice[] = []
    const next: Record<string, string | null> = {}
    for (const k of kinds) {
      if (cursors[k] == null) {
        next[k] = null
        continue
      }
      const d = p.check(await api.youMessages(p, k, cursors[k]!))
      out.push(...(d?.message_list ?? []).map((x: any) => noticeOf(k, x)))
      next[k] = d?.has_more && d?.cursor != null ? String(d.cursor) : null
    }
    out.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    const more = Object.values(next).some((v) => v != null)
    return paged(out, JSON.stringify(next), more)
  })
}

// ================================================================ folder / topic / poi

export async function folderList(ctx: Ctx) {
  return run(ctx, async (p) => {
    const u = await resolveUser(p, ctx.args.user ?? 'me')
    const page = cursorPage(ctx)
    const d = p.check(await api.userBoards(p, u.id, page))
    const list = (d?.boards ?? []).map((b: any) => n.folder({ id: String(b.id), name: String(b.name ?? ''), count: n.count(b.total), url: `${WEB}/board/${b.id}` }, b))
    return paged(list, page + 1, Boolean(d?.has_more))
  })
}

export async function topicSearch(ctx: Ctx) {
  return creator(ctx, async (c) => {
    const d = c.check(await capi.searchTopic(c, ctx.args.keyword!))
    const list = (d?.topic_info_dtos ?? []).map((t: any) => n.topic({ id: String(t.id), name: String(t.name ?? ''), url: n.url(t.link), stats: { views: n.count(t.view_num) } }, t))
    return paged(list, null, false)
  })
}

export async function poiSearch(ctx: Ctx) {
  return creator(ctx, async (c) => {
    const d = c.check(await capi.searchPoi(c, ctx.args.keyword!))
    const list = (d?.poi_list ?? []).map((x: any) => n.poi({ id: String(x.poi_id), name: String(x.name ?? ''), address: n.str(x.full_address ?? x.address) }, x))
    return paged(list, null, false)
  })
}

// ================================================================ media upload

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  return creator(ctx, async (c) => {
    const file = await readMedia(c.http, ctx.args.file!)
    if (file.contentType.startsWith('video/')) {
      const up = await capi.uploadMedia(c, file.data, 'video')
      return n.media({ id: up.fileId, type: 'video', url: `spectrum/${up.fileId}` }, up)
    }
    const img = await uploadImage(c, file)
    return n.media({ id: img.fileId, type: 'image', url: `spectrum/${img.fileId}`, width: img.width, height: img.height }, img)
  })
}

// ================================================================ live

async function room(p: Pc, input: string) {
  const roomId = await resolveRoom(p, input)
  if (!p.userId) await p.bootstrap()
  const d = p.check(await api.liveRoomInfo(p, roomId, p.userId))
  return { roomId, d }
}

function liveOf(roomId: string, d: any) {
  const info = d?.room_info ?? d ?? {}
  const host = d?.host_info ?? info.host_info ?? {}
  return n.live(
    {
      id: roomId,
      url: `${WEB}/livestream/${roomId}`,
      title: n.str(info.room_title ?? info.title ?? d?.room_title),
      status: Number(info.room_status ?? info.status ?? d?.room_status ?? 0) === 0 || info.live_status === 'living' || d?.live_status === 1 ? 'live' : 'offline',
      host: norm.ref(host),
      cover: n.url(info.room_cover ?? info.cover),
      stats: { viewers: n.count(info.members_count ?? d?.members_count) },
    },
    d,
  )
}

export async function liveGet(ctx: Ctx) {
  return run(ctx, async (p) => {
    const { roomId, d } = await room(p, ctx.args.room!)
    return liveOf(roomId, d)
  })
}

export async function liveList(ctx: Ctx) {
  return run(ctx, async (p) => {
    const d = p.check(await api.liveSquare(p, (ctx.options.category as string | undefined) ?? ''))
    const list = (d?.feeds ?? [])
      .map((x: any) => x.live)
      .filter((l: any) => l?.t_room_info)
      .map((l: any) => {
        const r = l.t_room_info
        const id = String(r.room_id_str ?? r.room_id)
        const host = l.t_live_host_info ?? {}
        return n.live(
          {
            id,
            url: `${WEB}/livestream/${id}`,
            title: n.str(r.name),
            status: 'live',
            host: norm.ref(host),
            cover: n.url(r.cover ?? r.cover_info?.cover_image),
            stats: { viewers: n.count(r.member_count ?? r.display_count) },
          },
          l,
        )
      })
    return paged(list, null, false)
  })
}

export async function liveCategories(ctx: Ctx) {
  return run(ctx, async (p) => {
    const d = p.check(await api.liveCategories(p))
    return (Array.isArray(d) ? d : (d?.categories ?? [])).map((x: any) => n.category({ id: String(x.id), name: String(x.desc ?? x.name ?? x.id) }, x))
  })
}

const hostOf = (d: any) => String(d?.host_info?.user_id ?? d?.room_info?.host_id ?? d?.host_id ?? '')

export async function liveGifts(ctx: Ctx) {
  return run(ctx, async (p) => {
    const { roomId, d } = await room(p, ctx.args.room!)
    const g = p.check(await api.liveGiftPanel(p, hostOf(d), roomId))
    const gifts = (g?.tabs ?? []).flatMap((t: any) => t.gifts ?? t.gift_list ?? []).concat(g?.gifts ?? g?.gift_list ?? [])
    const seen = new Set<string>()
    return gifts
      .filter((x: any) => !seen.has(String(x.gift_id ?? x.id)) && seen.add(String(x.gift_id ?? x.id)))
      .map((x: any) => n.gift({ id: String(x.gift_id ?? x.id), name: String(x.name ?? x.gift_name ?? ''), price: x.price != null ? { amount: Number(x.price), currency: 'XHS_COIN' } : null }, x))
  })
}

export async function liveProducts(ctx: Ctx) {
  return run(ctx, async (p) => {
    const { roomId, d } = await room(p, ctx.args.room!)
    const b = p.check(await api.liveBusiness(p, roomId, hostOf(d)))
    const goods = b?.goods_info?.goods_list ?? b?.goods_list ?? b?.goods ?? []
    return goods.map((x: any) =>
      n.item(
        { id: String(x.goods_id ?? x.id), kind: 'goods', url: n.url(x.link ?? x.url), title: n.str(x.title ?? x.name), cover: n.url(x.image ?? x.cover), price: n.price(x.price ?? x.sale_price) },
        x,
      ),
    )
  })
}

/**
 * 发弹幕。上游有两条通道：HTTP 的 send_comment 和长连的 send_room_text，注释说浏览器「按房间状态」二选一，
 * 但没有写出判断条件。这里先走 HTTP；HTTP 报业务错误（UPSTREAM）时改走直播间长连。
 */
export async function liveSend(ctx: Ctx) {
  if (ctx.options.gift) throw new CatbusError('NOT_IMPLEMENTED', 'xhs 的 live send --gift 尚未实现（上游只发文本弹幕）', { detail: { upstream: 'partial' } })
  return run(ctx, async (p) => {
    const { roomId, d } = await room(p, ctx.args.room!)
    try {
      p.check(await api.liveSendComment(p, roomId, ctx.args.text!, hostOf(d)))
    } catch (err) {
      if (!(err instanceof CatbusError && err.code === 'UPSTREAM')) throw err
      ctx.log.info(`HTTP 发弹幕失败（${err.message}），改走直播间长连`)
      await sendRoomText(p, roomId, ctx.args.text!)
    }
    return { id: roomId }
  })
}

const ROOM_ACK_TIMEOUT = 10_000

/** 长连发弹幕（上游 send_room_text）：连上并进房间，发 sendMessage 帧，等同一个 m 的回执（c=0 为成功）。 */
async function sendRoomText(p: Pc, roomId: string, text: string): Promise<void> {
  const me = p.check(await api.userMe(p))
  const userId = String(me?.user_id ?? p.userId)
  const controller = new AbortController()
  const conn = await push.connectPush(p, controller.signal, roomId)
  const timer = setTimeout(() => controller.abort(), ROOM_ACK_TIMEOUT)
  try {
    const [frame, mid] = push.roomTextFrame({ roomId, nickname: String(me?.nickname ?? ''), avatar: String(me?.images ?? me?.imageb ?? ''), userId, content: text })
    await conn.send(frame)
    for await (const f of conn.frames) {
      if (f?.m !== mid) continue
      const c = f?.b?.a?.c
      if (c != null && c !== 0) throw new CatbusError('UPSTREAM', `直播间长连拒绝了弹幕：c=${c} ${f?.b?.a?.m ?? ''}`.trim(), { detail: { code: c, message: f?.b?.a?.m } })
      return
    }
    p.ctx.log.warn('直播间长连没有返回发送回执，弹幕可能没有发出去')
  } finally {
    clearTimeout(timer)
    conn.close()
  }
}

/** 直播间事件：customData.type → Event.type。 */
function roomEvent(payload: any): Event | null {
  const c = payload?.customData
  if (!c || typeof c !== 'object') return null
  const t = String(c.type ?? '')
  const user = norm.ref(c.profile)
  const time = n.time(payload.ts ?? c.current_time) ?? undefined
  switch (t) {
    case 'text':
      return n.event({ type: 'chat', time, user, text: n.str(c.desc) }, payload)
    case 'gift':
      return n.event({ type: 'gift', time, user, gift: { name: String(c.gift?.name ?? c.gift_info?.name ?? c.desc ?? ''), count: Number(c.gift?.count ?? c.gift_info?.count ?? c.count ?? 1) } }, payload)
    case 'praise':
    case 'light':
      return n.event({ type: 'like', time, user }, payload)
    case 'come':
    case 'enter':
    case 'enter_room':
      return n.event({ type: 'enter', time, user }, payload)
    case 'follow':
      return n.event({ type: 'follow', time, user }, payload)
    case 'viewer_heart':
    case 'audience_num':
      return null
    default:
      return n.event({ type: 'other', time, user, text: n.str(c.desc) }, payload)
  }
}

export function liveListen(ctx: Ctx) {
  return (async function* () {
    const p = await pc(ctx)
    try {
      const { roomId } = await room(p, ctx.args.room!)
      yield* reconnecting(ctx, async function* () {
        const conn = await push.connectPush(p, ctx.signal, roomId)
        try {
          for await (const frame of conn.frames) {
            for (const payload of push.decodeRoomPush(frame)) {
              const e = roomEvent(payload)
              if (e) yield e
            }
          }
        } finally {
          conn.close()
        }
      })
    } finally {
      p.save()
    }
  })()
}

// ================================================================ msg

/**
 * 会话 id：单聊是对方的用户 id（24 位十六进制）；群聊是 `group:<群 id>`。
 * 两种 id 都能直接传给 msg history；群聊不支持 msg read / revoke / delete / send（上游没有对应的群聊接口）。
 */
const GROUP_PREFIX = 'group:'

const groupIdOf = (conversation: string): string | null => (conversation.startsWith(GROUP_PREFIX) ? conversation.slice(GROUP_PREFIX.length) || null : null)

function privateOnly(conversation: string, what: string): void {
  if (conversation.startsWith(GROUP_PREFIX)) throw new CatbusError('UNSUPPORTED', `xhs 的群聊会话不支持${what}`, { hint: '群聊会话只支持 msg list、msg history' })
}

/** 单聊的会话 id：user_id 是当前账号自己，对方是 chat_user_id（对方资料在 info 里）。 */
const peerOf = (v: any) => v.info ?? v.user_info ?? v.chat_user ?? {}
export const chatIdOf = (v: any): string => String(v.chat_user_id ?? peerOf(v).user_id ?? v.chat_id ?? v.id)

const lastMessageOf = (v: any) => n.str(push.innerText(v.last_msg_content ?? v.last_message?.content ?? ''))
const updatedAtOf = (v: any) => n.time(v.last_msg_ts ?? v.last_msg_time ?? v.update_time)

/** 单聊会话列表的一项（v3/chats 的 chat_list[i]）。 */
export function conversationOf(v: any) {
  const peer = peerOf(v)
  const peerId = v.chat_user_id ?? peer.user_id
  return n.conversation(
    {
      id: chatIdOf(v),
      peer: norm.ref({ user_id: peerId, nickname: peer.nickname ?? peer.user_name ?? v.nickname }),
      unread: n.count(v.unread_count),
      last_message: lastMessageOf(v),
      updated_at: updatedAtOf(v),
    },
    v,
  )
}

/** 群聊的群 id（chats/group 的列表项；字段名按私信列表的习惯兼容几种写法）。 */
const groupIdOfChat = (v: any) => v?.group_id ?? v?.group_info?.group_id ?? v?.chat_id ?? v?.id

/** 群聊会话列表的一项：没有单个对方，peer 为 null（群名在 --raw 里）。 */
export function groupConversationOf(v: any) {
  return n.conversation({ id: `${GROUP_PREFIX}${groupIdOfChat(v)}`, peer: null, unread: n.count(v.unread_count), last_message: lastMessageOf(v), updated_at: updatedAtOf(v) }, v)
}

const groupList = (d: any): any[] => (Array.isArray(d) ? d : (d?.group_chat_list ?? d?.group_chats ?? d?.chat_list ?? d?.chats ?? d?.groups ?? []))

/**
 * 会话列表：单聊（get_chats）和群聊（get_group_chats）合在一起，按最后一条消息的时间排。
 * cursor 是「单聊页码:群聊页码」，没有更多的一方写 -。群聊列表取不到时只列单聊，并在 stderr 提示。
 */
export async function msgList(ctx: Ctx) {
  return run(ctx, async (p) => {
    const page = (s: string | undefined) => (s == null || s === '-' ? null : Number(s) || 0)
    const [chatPage, groupPage] = ctx.cursor ? [page(ctx.cursor.split(':')[0]), page(ctx.cursor.split(':')[1])] : [0, 0]
    const out: Conversation[] = []
    let nextChat: number | null = null
    let nextGroup: number | null = null
    if (chatPage != null) {
      const d = p.check(await api.chats(p, chatPage))
      out.push(...(d?.chat_list ?? d?.chats ?? []).map(conversationOf))
      if (d?.has_more) nextChat = chatPage + 1
    }
    if (groupPage != null) {
      try {
        const d = p.check(await api.groupChats(p, groupPage))
        out.push(...groupList(d).filter((v) => groupIdOfChat(v) != null).map(groupConversationOf))
        if (d?.has_more) nextGroup = groupPage + 1
      } catch (err) {
        if (!(err instanceof CatbusError && err.code === 'UPSTREAM')) throw err
        ctx.log.warn(`群聊列表取不到，只列单聊：${err.message}`)
      }
    }
    out.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
    const more = nextChat != null || nextGroup != null
    return paged(out, `${nextChat ?? '-'}:${nextGroup ?? '-'}`, more)
  })
}

const HISTORY_LIMIT = 30

/** 消息类型：顶层没有时在 content 里（content 是一段 JSON 字符串：{content, content_type, ...}）。 */
function contentType(v: any): number {
  const top = v.type ?? v.content_type
  if (top != null) return Number(top)
  try {
    return Number(JSON.parse(v.content)?.content_type ?? 1)
  } catch {
    return 1
  }
}

/**
 * 一条消息。单聊里没有 sender 时按 is_self 在自己和对方之间取；群聊没有「对方」，取不到发送者时为 null。
 */
export function messageOf(v: any, conversation: string, self: string): Message {
  const type = contentType(v)
  const peer = groupIdOf(conversation) == null ? conversation : null
  const sender = v.sender_id ?? v.sender ?? (v.is_self ? self : peer)
  const info = v.sender_info ?? v.user_info ?? {}
  return n.message(
    {
      id: String(v.message_id ?? v.id ?? v.mid),
      conversation_id: conversation,
      from: norm.ref({ user_id: sender, nickname: info.nickname ?? v.sender_nickname ?? v.nickname }),
      type: type === 1 ? 'text' : type === 2 ? 'image' : type === 4 ? 'video' : type === 3 ? 'card' : 'other',
      text: n.str(push.innerText(v.content ?? '')),
      created_at: n.time(v.created_at ?? v.create_time ?? v.ts),
    },
    v,
  )
}

/**
 * 消息记录：单聊走 get_message_history，群聊（`group:<群 id>`）走 get_group_message_history。
 * 从新到旧排列；cursor 是这一页最早一条的 store_id（下一页的 last_id）。响应里没有 has_more，取满一页就认为还有更早的消息。
 */
export async function msgHistory(ctx: Ctx) {
  return run(ctx, async (p) => {
    const conv = ctx.args.conversation!
    const group = groupIdOf(conv)
    const lastId = Number(ctx.cursor ?? 0) || 0
    const d = p.check(group != null ? await api.groupMessageHistory(p, group, lastId, HISTORY_LIMIT) : await api.messageHistory(p, conv, lastId, HISTORY_LIMIT))
    const raw: any[] = d?.out_message_list ?? d?.message_list ?? d?.messages ?? []
    const list = raw.map((m) => messageOf(m, conv, p.userId))
    const ids = raw.map((m) => Number(m.store_id ?? m.id)).filter(Number.isFinite)
    const next = ids.length ? Math.min(...ids) : null
    // 游标不前进（边界那条被重复返回）时到头了
    return paged(list, next, (Boolean(d?.has_more) || raw.length >= HISTORY_LIMIT) && next != null && next !== lastId)
  })
}

export async function msgSend(ctx: Ctx): Promise<Message> {
  if (ctx.options.image || ctx.options.video) throw new CatbusError('UNSUPPORTED', 'xhs 私信目前只支持文本（上游只发文本）')
  if (ctx.options.item) throw new CatbusError('UNSUPPORTED', 'xhs 没有商品客服私信', { hint: '用 --to <user> 或 --conversation <id>' })
  const text = ctx.args.text
  if (!text) throw new CatbusError('USAGE', '需要 <text>')
  if (ctx.options.conversation) privateOnly(String(ctx.options.conversation), '发消息（上游只发单聊私信）')
  return run(ctx, async (p) => {
    if (!p.userId) await p.bootstrap()
    const receiver = ctx.options.to ? (await resolveUser(p, String(ctx.options.to))).id : String(ctx.options.conversation)
    const mid = rand.uuid4()
    const chat = push.encodeChatMessage({ mid, ts: rand.now(), sender: p.userId, receiver, content: text, contentType: 1 })
    // 优先走长连（上游 send_private_message）；连不上时走 HTTP 短链兜底（send_short_link_message）
    const controller = new AbortController()
    try {
      const conn = await push.connectPush(p, controller.signal)
      try {
        await conn.send(push.imFrame(chat))
        const deadline = rand.now() + 10_000
        for await (const frame of conn.frames) {
          for (const d of push.decodeImFrame(frame)) {
            if (d.ack?.mid === mid) {
              if (d.ack.code !== 0) throw new CatbusError('UPSTREAM', d.ack.msg || `私信发送失败：${d.ack.code}`, { detail: { code: d.ack.code } })
              return n.message({ id: d.ack.messageId || mid, conversation_id: receiver, from: norm.ref({ user_id: p.userId }), text, created_at: n.time(d.ack.ts) }, d.ack)
            }
          }
          if (rand.now() > deadline) break
        }
      } finally {
        conn.close()
      }
    } catch (err) {
      if (err instanceof CatbusError && err.code === 'UPSTREAM') throw err
      ctx.log.debug(`长连发送失败，改走 HTTP：${(err as Error).message}`)
    } finally {
      controller.abort()
    }
    const r = p.check(await api.sendShortLink(p, push.rsaShortLink(chat)))
    return n.message({ id: String(r?.message_id ?? mid), conversation_id: receiver, from: norm.ref({ user_id: p.userId }), text, created_at: n.time(rand.now()) }, r)
  })
}

export function msgListen(ctx: Ctx) {
  return (async function* () {
    const p = await pc(ctx)
    try {
      if (!p.userId) await p.bootstrap()
      const seen = new Set<string>()
      yield* reconnecting(ctx, async function* () {
        const conn = await push.connectPush(p, ctx.signal)
        const beat = setInterval(() => void conn.send(push.stateSyncFrame()).catch(() => {}), 60_000).unref()
        try {
          for await (const frame of conn.frames) {
            for (const d of push.decodeImFrame(frame)) {
              const m = d.message
              if (!m || seen.has(m.messageId || m.mid)) continue
              seen.add(m.messageId || m.mid)
              const sender = String(m.json?.sender ?? m.json?.sender_id ?? '')
              const receiver = String(m.json?.receiver ?? m.json?.receiver_id ?? '')
              const peer = sender && sender !== p.userId ? sender : receiver || sender
              yield n.message({ id: m.messageId || m.mid, conversation_id: peer, from: norm.ref({ user_id: sender || null }), text: n.str(push.innerText(m.json ?? m.payload)), created_at: n.time(m.ts) }, m)
            }
          }
        } finally {
          clearInterval(beat)
          conn.close()
        }
      })
    } finally {
      p.save()
    }
  })()
}

/** 标记已读：从会话列表里找到这个会话（会话 id 与 msg list 相同，是对方的 chat_user_id），带上它的 store_id 与未读数。 */
export async function msgRead(ctx: Ctx) {
  const conv = ctx.args.conversation!
  privateOnly(conv, '标记已读')
  return run(ctx, async (p) => {
    const d = p.check(await api.chats(p))
    const chat = (d?.chat_list ?? d?.chats ?? []).find((c: any) => chatIdOf(c) === conv)
    p.check(
      await api.markRead(p, [{ chat_id: conv, read_store_id: Number(chat?.last_store_id ?? chat?.store_id ?? 0), unread_count: Number(chat?.unread_count ?? 0), type: 1, need_rm_offline: true }]),
    )
    return { id: conv }
  })
}

export async function msgRevoke(ctx: Ctx) {
  privateOnly(ctx.args.conversation!, '撤回消息')
  return run(ctx, async (p) => {
    p.check(await api.revokeMessage(p, { chat_user_id: ctx.args.conversation!, message_id: ctx.args.message! }))
    return { id: ctx.args.message! }
  })
}

export async function msgDelete(ctx: Ctx) {
  privateOnly(ctx.args.conversation!, '删除会话')
  return run(ctx, async (p) => {
    p.check(await api.deleteMessage(p, [['chat_user_id', ctx.args.conversation!]]))
    return { id: ctx.args.conversation! }
  })
}

export { CREATOR, parseCookieInput }
