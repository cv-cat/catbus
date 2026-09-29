import { brotliDecompressSync, inflateSync } from 'node:zlib'
import { GUEST } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { downloadMedia, readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential, loginContext, poll, readPassword, showQrcode, smsLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as pb from '../../../core/pb.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Credential, Danmaku, Media, Subtitle } from '../../../core/schemas.js'
import { openSocket, reconnecting } from '../../../core/stream.js'
import { paged, scope } from '../../../core/toolkit.js'
import * as api from './api.js'
import { Bili, bili, check } from './client.js'
import { CANVAS_1 } from './gaia.js'
import * as geetest from './geetest.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, headers, PROFILE } from './profile.js'
import { resolveItem, resolveReplyTarget, resolveRoom, resolveUser } from './resolve.js'
import { encryptPassword } from './sign.js'
import { uploadVideo } from './upos.js'

type Ctx = HandlerContext
const page = (ctx: Ctx) => Number(ctx.cursor ?? 1) || 1

// ================================================================ auth

/** 登录用的临时上下文：凭证是新建的，身份按游客走一遍匿名设备初始化。 */
function guestLoginContext(ctx: Ctx, method: Credential['method']): Ctx {
  return { ...ctx, account: GUEST, credential: freshCredential(ctx, method) }
}

async function completeLogin(ctx: Ctx, b: Bili, refreshToken?: string) {
  const nav = await api.nav(b)
  if (!nav.data?.isLogin) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期')
  const credential = b.ctx.credential
  if (refreshToken) scope(credential).tokens.refresh_token = refreshToken
  credential.extra.refresh_checked_at = rand.now()
  return finishLogin(ctx, credential, norm.ref(nav.data.mid, nav.data.uname)!)
}

export async function authLogin(ctx: Ctx) {
  const method = ctx.options.method as string
  if (method === 'cookie') {
    const credential = cookieCredential(ctx, COOKIE_DOMAIN)
    const b = await bili(loginContext(ctx, credential))
    return completeLogin(ctx, b)
  }
  if (method === 'sms') {
    // 非 TTY 的第二步（--code）沿用第一步保存的设备 cookie，不重新初始化
    const b = ctx.options.code ? new Bili(guestLoginContext(ctx, 'sms')) : await bili(guestLoginContext(ctx, 'sms'))
    return smsLogin(ctx, {
      send: async (phone) => {
        const gt = await geetest.solve(b)
        const r = await api.smsSend(b, phone, gt)
        check(ctx, r)
        return { phone, captcha_key: r.data.captcha_key, cookies: [...b.jar.cookies] }
      },
      verify: async (state, code) => {
        b.jar.cookies.splice(0, b.jar.cookies.length, ...(state.cookies as Credential['scopes'][string]['cookies']))
        const r = await api.smsLogin(b, state.phone, code, state.captcha_key)
        check(ctx, r)
        return completeLogin(ctx, b, r.data?.refresh_token)
      },
    })
  }
  const b = await bili(guestLoginContext(ctx, method as Credential['method']))
  if (method === 'qrcode') {
    const gen = await api.qrcodeGenerate(b)
    check(ctx, gen)
    await showQrcode(ctx, gen.data.url, '请用 B 站 App 扫码并确认')
    let last: number | null = null
    const token = await poll(async () => {
      const r = await api.qrcodePoll(b, gen.data.qrcode_key, CANVAS_1)
      const code = r.data?.code
      if (code === 0) return r.data.refresh_token ?? ''
      if (code === 86038) throw new CatbusError('AUTH_REQUIRED', '二维码已失效', { hint: '重新执行 catbus bilibili auth login' })
      if (code === 86090 && last !== code) ctx.log.info('已扫码，请在手机上确认')
      last = code ?? null
      return undefined
    })
    return completeLogin(ctx, b, token)
  }
  if (method === 'password') {
    const username = ctx.options.username as string | undefined
    if (!username) throw new CatbusError('USAGE', '账密登录需要 --username', { hint: 'catbus bilibili auth login --method password --username <手机号或邮箱> --password-stdin' })
    const password = await readPassword(ctx)
    const gt = await geetest.solve(b)
    const key = await api.loginKey(b)
    check(ctx, key)
    const r = await api.passwordLogin(b, username, encryptPassword(key.data.hash, password, key.data.key), gt)
    check(ctx, r)
    return completeLogin(ctx, b, r.data?.refresh_token)
  }
  throw new CatbusError('USAGE', `不支持的登录方式：${method}`)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const b = await bili(ctx)
  const nav = await api.nav(b)
  const d = nav.data ?? {}
  const sess = b.jar.cookies.find((c) => c.name === 'SESSDATA')
  return {
    logged_in: Boolean(d.isLogin),
    user: d.isLogin ? norm.ref(d.mid, d.uname) : null,
    method: d.isLogin ? ctx.credential.method : null,
    expires_at: d.isLogin && sess?.expires ? n.time(sess.expires) : null,
  }
}

/** 服务端登出：`auth logout` 删除本地凭证前调用。 */
export async function serverLogout(ctx: Ctx): Promise<void> {
  const b = new Bili(ctx)
  if (b.isLogin && b.csrf) await api.logout(b)
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  const b = await bili(ctx)
  if (ctx.args.user === 'me') {
    const nav = await api.nav(b)
    check(ctx, nav)
    return norm.navUser(nav.data)
  }
  return norm.spaceUser(await api.userInfo(b, await resolveUser(b, ctx.args.user!)))
}

export async function userSearch(ctx: Ctx) {
  const b = await bili(ctx)
  const p = page(ctx)
  const d = await api.searchType(b, ctx.args.keyword!, 'totalrank', p, 'bili_user')
  const list = (d.result ?? []).map(norm.searchUser)
  return paged(list, p + 1, p < Number(d.numPages ?? 0))
}

const USER_ORDER: Record<string, string> = { latest: 'pubdate', views: 'click', collects: 'stow' }

export async function userItems(ctx: Ctx) {
  const b = await bili(ctx)
  const mid = await resolveUser(b, ctx.args.user!)
  const p = page(ctx)
  const order = USER_ORDER[(ctx.options.sort as string) ?? 'latest'] ?? 'pubdate'
  const d = await api.userVideos(b, mid, p, 42, order, (ctx.options.keyword as string | undefined) ?? '')
  const list = (d.list?.vlist ?? []).map(norm.spaceVideo)
  const total = Number(d.page?.count ?? 0)
  return paged(list, p + 1, list.length > 0 && p * Number(d.page?.ps ?? 42) < total)
}

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const b = await bili(ctx)
  const { bvid } = await resolveItem(b, ctx.args.item!)
  return norm.video(await api.videoInfo(b, bvid))
}

const SEARCH_ORDER: Record<string, string> = { general: 'totalrank', views: 'click', latest: 'pubdate', collects: 'stow' }

/** --type → 上游 search_type：video 视频、article 专栏。 */
export async function itemSearch(ctx: Ctx) {
  const b = await bili(ctx)
  const p = page(ctx)
  const article = ctx.options.type === 'article'
  const d = await api.searchType(b, ctx.args.keyword!, SEARCH_ORDER[(ctx.options.sort as string) ?? 'general'], p, article ? 'article' : 'video')
  const result: any[] = d.result ?? []
  // 视频搜索会混进课程、广告卡片，只留真正的稿件（上游 search_by_num）
  const list = article ? result.filter((v) => v.id).map(norm.searchArticle) : result.filter((v) => v.type === 'video' && v.bvid).map(norm.searchVideo)
  return paged(list, p + 1, p < Number(d.numPages ?? 0))
}

/** 相关推荐：稿件完整信息里的 Related（上游 get_video_detail）。 */
export async function itemRelated(ctx: Ctx) {
  const b = await bili(ctx)
  const { bvid } = await resolveItem(b, ctx.args.item!)
  const d = await api.videoDetail(b, bvid)
  return paged((d?.Related ?? []).filter((v: any) => v.bvid).map(norm.video), null, false)
}

export async function itemList(ctx: Ctx) {
  const b = await bili(ctx)
  const p = page(ctx)
  const d = await api.myArchives(b, p)
  const list = (d.arc_audits ?? []).map(norm.archive)
  return paged(list, p + 1, p * Number(d.page?.ps ?? 20) < Number(d.page?.count ?? 0))
}

/** 播放地址：DASH 取最高画质的视频轨和音频轨；老稿件是 durl 整段。 */
async function playMedia(b: Bili, bvid: string, cid: string | number): Promise<Media[]> {
  const d = await api.playUrl(b, bvid, cid)
  if (d.dash) {
    const duration = n.seconds(d.dash.duration)
    const video = [...(d.dash.video ?? [])].sort((a: any, c: any) => c.id - a.id || c.bandwidth - a.bandwidth)[0]
    const audio = [...(d.dash.audio ?? []), ...(d.dash.flac?.audio ? [d.dash.flac.audio] : [])].sort((a: any, c: any) => c.bandwidth - a.bandwidth)[0]
    const out: Media[] = []
    if (video) out.push(n.media({ id: String(video.id), type: 'video', url: video.baseUrl ?? video.base_url, width: video.width, height: video.height, duration }, video))
    if (audio) out.push(n.media({ id: String(audio.id), type: 'audio', url: audio.baseUrl ?? audio.base_url, duration }, audio))
    return out
  }
  return (d.durl ?? []).map((x: any) => n.media({ id: String(x.order), type: 'video', url: x.url, duration: n.seconds(x.length / 1000) }, x))
}

export async function itemMedia(ctx: Ctx) {
  const b = await bili(ctx)
  const { bvid } = await resolveItem(b, ctx.args.item!)
  const info = await api.videoInfo(b, bvid)
  return playMedia(b, bvid, info.cid)
}

export async function itemDownload(ctx: Ctx) {
  const b = await bili(ctx)
  const { bvid } = await resolveItem(b, ctx.args.item!)
  const info = await api.videoInfo(b, bvid)
  const media = await playMedia(b, bvid, info.cid)
  return downloadMedia(ctx, b.http, bvid, media, {
    headers: [
      ['user-agent', PROFILE.ua],
      ['referer', 'https://www.bilibili.com/'],
    ],
    ext: (m) => (m.type === 'audio' ? 'm4a' : 'mp4'),
  })
}

async function likeItem(ctx: Ctx, on: boolean) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid } = await resolveItem(b, ctx.args.item!)
  await api.like(b, bvid, on)
  return { id: bvid }
}
export const itemLike = (ctx: Ctx) => likeItem(ctx, true)
export const itemUnlike = (ctx: Ctx) => likeItem(ctx, false)

/** --folder 指定收藏夹（上游 favour 的 add_media_ids）；不给时收进第一个收藏夹。 */
export async function itemCollect(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  await api.favour(b, aid, (ctx.options.folder as string | undefined) ?? '')
  return { id: bvid }
}

/** --folder 指定从哪些收藏夹移出（上游 favour 的 del_media_ids）；不给时从所有收着它的收藏夹移出。 */
export async function itemUncollect(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  let del = ctx.options.folder as string | undefined
  if (!del) {
    const folders = ((await api.favFolders(b, undefined, aid))?.list ?? []).filter((f: any) => f.fav_state === 1)
    del = folders.map((f: any) => f.id).join(',')
  }
  if (del) await api.favour(b, aid, '', del)
  return { id: bvid }
}

export async function itemPublish(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const o = ctx.options as Record<string, any>
  if (!o.video) throw new CatbusError('USAGE', 'B 站投稿需要 --video', { hint: 'catbus bilibili item publish --video <文件> --title <标题> --tag <标签> --category <分区 id>' })
  if (!o.title) throw new CatbusError('USAGE', 'B 站投稿需要 --title')
  if (!o.tag?.length) throw new CatbusError('USAGE', 'B 站投稿至少需要一个 --tag')
  if (!o.category) throw new CatbusError('USAGE', 'B 站投稿需要 --category（分区 id）', { hint: 'catbus bilibili item categories' })
  const video = await uploadVideo(b, await readMedia(b.http, o.video))
  let cover = ''
  if (o.cover) {
    const img = await readMedia(b.http, o.cover)
    const r = await api.uploadCover(b, img.data, img.contentType.split('/')[1] ?? 'jpeg')
    cover = r.url
  }
  const d = await api.submitArchive(b, {
    videos: [video],
    title: o.title,
    tid: Number(o.category),
    tag: (o.tag as string[]).join(','),
    cover,
    desc: o.text ?? '',
    copyright: o.source ? 2 : 1,
    source: o.source ?? '',
    private: o.visibility === 'private',
    dynamic: o.dynamic ?? '',
    noReprint: o.allowReprint ? 0 : 1,
  })
  return n.item({ id: d.bvid, kind: 'video', url: norm.videoUrl(d.bvid), title: o.title, text: o.text ?? null, cover: cover || null, status: 'reviewing' }, d)
}

/**
 * 撤稿。平台要求先过极验点选，网页端真人也要过；不带验证结果固定返回 340022（上游 delete_archive）。
 * catbus 还不能自动过这一步，报 RISK_CONTROL 时在 hint 里说明。
 */
export async function itemDelete(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  try {
    await api.deleteArchive(b, aid)
  } catch (err) {
    if (err instanceof CatbusError && err.code === 'RISK_CONTROL' && (err.detail as { kind?: string } | null)?.kind === 'captcha') {
      throw new CatbusError('RISK_CONTROL', `撤稿需要人机验证：${err.message}`, {
        hint: 'B 站撤稿要先过极验点选（网页端同样如此），catbus 还不能自动通过。请到创作中心手动删除：https://member.bilibili.com/platform/upload-manager/article',
        detail: err.detail,
      })
    }
    throw err
  }
  return { id: bvid }
}

export async function itemCategories(ctx: Ctx) {
  const b = await bili(ctx)
  const d = await api.archivePre(b)
  return (d.typelist ?? []).flatMap((p: any) => [
    n.category({ id: n.id(p.id), name: p.name }, p),
    ...(p.children ?? []).map((c: any) => n.category({ id: n.id(c.id), name: c.name, parent_id: n.id(p.id) }, c)),
  ])
}

// ---------------------------------------------------------------- 扩展：投币、三连、字幕

export async function itemCoin(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid } = await resolveItem(b, ctx.args.item!)
  await api.addCoin(b, bvid, Number(ctx.options.count ?? 1), Boolean(ctx.options.like))
  return { id: bvid }
}

export async function itemTriple(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid } = await resolveItem(b, ctx.args.item!)
  await api.triple(b, bvid)
  return { id: bvid }
}

export async function itemSubtitles(ctx: Ctx): Promise<Subtitle[]> {
  const b = await bili(ctx)
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  const info = await api.videoInfo(b, bvid)
  const player = await api.playerInfo(b, aid, info.cid)
  const out: Subtitle[] = []
  for (const s of player.subtitle?.subtitles ?? []) {
    const url = n.url(s.subtitle_url)
    let lines: Subtitle['lines'] = []
    if (url) {
      const body = await (await b.http.request({ url, cookies: false, headers: [['user-agent', PROFILE.ua], ['referer', 'https://www.bilibili.com/']] })).json<any>()
      lines = (body.body ?? []).map((l: any) => ({ from: Number(l.from), to: Number(l.to), text: String(l.content ?? '') }))
    }
    out.push({ lang: s.lan, name: n.str(s.lan_doc), url, lines })
  }
  return out
}

// ================================================================ comment

/** 评论排序 → 上游 get_replies 的 mode：3 热门、2 时间。 */
const REPLY_MODE: Record<string, number> = { popular: 3, latest: 2 }

/** 评论区按参数形态识别：稿件 1、专栏 12、动态 17（见 resolveReplyTarget）。 */
export async function commentList(ctx: Ctx) {
  const b = await bili(ctx)
  const t = await resolveReplyTarget(b, ctx.args.item!)
  const p = page(ctx)
  const d = await api.replies(b, t.oid, t.type, p, REPLY_MODE[(ctx.options.sort as string) ?? 'popular'] ?? 3)
  const list = [...(p === 1 ? (d.top_replies ?? []) : []), ...(d.replies ?? [])].map((r: any) => norm.reply(r, t.itemId))
  return paged(list, p + 1, !d.cursor?.is_end && list.length > 0)
}

/** 回复楼中楼：--root 给根评论、--reply-to 给被回复的那条；只给 --reply-to 时它就是根评论（上游 add_reply 的 root / parent）。 */
export async function commentAdd(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const t = await resolveReplyTarget(b, ctx.args.item!)
  const to = ctx.options.replyTo as string | undefined
  const root = (ctx.options.root as string | undefined) ?? to ?? ''
  const d = await api.addReply(b, t.oid, ctx.args.text!, t.type, root, to ?? '')
  return d.reply ? norm.reply(d.reply, t.itemId) : n.comment({ id: n.id(d.rpid_str ?? d.rpid), item_id: t.itemId, text: ctx.args.text!, parent_id: to ?? null }, d)
}

export async function commentDelete(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const t = await resolveReplyTarget(b, ctx.args.item!)
  await api.deleteReply(b, t.oid, ctx.args.comment!, t.type)
  return { id: ctx.args.comment! }
}

// ================================================================ 弹幕（扩展）

/** 解 DmSegMobileReply：elems=1，每条 id=1 progress=2 ctime=8 content=7 idStr=12。 */
function decodeDanmaku(buf: Uint8Array, bvid: string): Danmaku[] {
  return pb.messages(pb.decode(buf), 1).map((e) => ({
    id: pb.str(e, 12) ?? pb.int64(e, 1) ?? '',
    item_id: bvid,
    offset: (pb.int(e, 2) ?? 0) / 1000,
    text: pb.str(e, 7) ?? '',
    created_at: n.time(pb.int(e, 8)),
  }))
}

export async function danmakuList(ctx: Ctx) {
  const b = await bili(ctx)
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  const info = await api.videoInfo(b, bvid)
  const segments = Math.max(1, Math.ceil(Number(info.pages?.[0]?.duration ?? info.duration ?? 360) / 360))
  const out: Danmaku[] = []
  for (let i = 1; i <= segments; i++) out.push(...decodeDanmaku(await api.danmakuSeg(b, aid, info.cid, i), bvid))
  return out.sort((a, c) => a.offset - c.offset)
}

/** 弹幕位置 → 上游的 mode：1 滚动、5 顶部、4 底部。 */
const DANMAKU_MODE: Record<string, number> = { scroll: 1, top: 5, bottom: 4 }

/** --color（#RRGGBB 或十进制）、--font-size、--position → 上游 send_danmaku 的 color / fontsize / mode。 */
export function danmakuStyle(o: Record<string, unknown>): api.DanmakuStyle {
  const style: api.DanmakuStyle = {}
  const color = o.color as string | undefined
  if (color) style.color = color.startsWith('#') ? parseInt(color.slice(1), 16) : Number(color)
  if (o.fontSize != null) style.fontsize = Number(o.fontSize)
  if (o.position) style.mode = DANMAKU_MODE[o.position as string]
  return style
}

export async function danmakuSend(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const { bvid, aid } = await resolveItem(b, ctx.args.item!)
  const info = await api.videoInfo(b, bvid)
  const d = await api.sendVideoDanmaku(b, aid, info.cid, ctx.args.text!, Math.round(Number(ctx.options.offset ?? 0) * 1000), danmakuStyle(ctx.options))
  return { id: n.id(d?.dmid_str ?? d?.dmid) }
}

// ================================================================ feed

/**
 * 推荐流的翻页游标：`<页号>:<上一批的 last_showlist>`。
 * last_showlist 是上一批稿件的 `av_<aid>`（已关注的 UP 主为 `av_n_<aid>`），逗号分隔，服务端据此去重。
 */
export function parseFeedCursor(cursor: string | null): { page: number; showlist: string } {
  const m = /^(\d+)(?::(.*))?$/s.exec(cursor ?? '')
  return { page: Number(m?.[1] ?? 1) || 1, showlist: m?.[2] ?? '' }
}

export function showlist(items: any[]): string {
  return items
    .filter((v) => v.goto === 'av' && v.id)
    .map((v) => (v.is_followed ? `av_n_${v.id}` : `av_${v.id}`))
    .join(',')
}

export async function feedList(ctx: Ctx) {
  const kind = (ctx.options.kind as string) ?? 'recommend'
  if (kind === 'following') throw new CatbusError('NOT_IMPLEMENTED', 'bilibili 的 feed list --kind following 尚未实现', { detail: { upstream: 'none' } })
  const b = await bili(ctx)
  if (kind === 'hot') {
    const p = page(ctx)
    const d = await api.popular(b, p)
    return paged((d.list ?? []).map(norm.video), p + 1, !d.no_more)
  }
  const c = parseFeedCursor(ctx.cursor)
  const d = await api.rcmdFeed(b, c.page, 12, c.showlist)
  const items: any[] = d.item ?? []
  const list = items.filter((v) => v.goto === 'av' && v.bvid).map(norm.feedVideo)
  return paged(list, `${c.page + 1}:${showlist(items)}`, true)
}

// ================================================================ folder

export async function folderList(ctx: Ctx) {
  const b = await bili(ctx)
  const mid = await resolveUser(b, ctx.args.user ?? 'me')
  const d = await api.favFolders(b, mid)
  const list = (d?.list ?? []).map((f: any) =>
    n.folder({ id: n.id(f.id), name: String(f.title ?? ''), count: n.count(f.media_count), url: `https://space.bilibili.com/${mid}/favlist?fid=${f.id}` }, f),
  )
  return paged(list, null, false)
}

export async function folderItems(ctx: Ctx) {
  const b = await bili(ctx)
  const p = page(ctx)
  const d = await b.get(`https://api.bilibili.com/x/v3/fav/resource/list`, {
    headers: headers('GET').referer('https://space.bilibili.com/').get(),
    query: [
      ['media_id', ctx.args.folder!],
      ['pn', p],
      ['ps', 20],
      ['keyword', ''],
      ['order', 'mtime'],
      ['type', 0],
      ['tid', 0],
      ['platform', 'web'],
      ['web_location', '333.1387'],
    ],
  })
  return paged((d?.medias ?? []).filter((m: any) => m.bvid).map(norm.favVideo), p + 1, Boolean(d?.has_more))
}

// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const b = await bili(ctx)
  b.requireLogin()
  const file = await readMedia(b.http, ctx.args.file!)
  if (file.contentType.startsWith('video/')) {
    const v = await uploadVideo(b, file)
    return n.media({ id: v.filename, type: 'video', url: v.key }, v)
  }
  const d = await api.uploadDynamicImage(b, file.data, file.filename, file.contentType)
  return n.media({ type: 'image', url: d.image_url, width: n.count(d.image_width), height: n.count(d.image_height) }, d)
}

// ================================================================ 动态、专栏（扩展）

async function uploadPics(b: Bili, inputs: string[]): Promise<api.DynPic[]> {
  const pics: api.DynPic[] = []
  for (const input of inputs) {
    const file = await readMedia(b.http, input)
    const d = await api.uploadDynamicImage(b, file.data, file.filename, file.contentType)
    pics.push({ img_src: d.image_url, img_width: d.image_width, img_height: d.image_height, img_size: d.img_size ?? 0 })
  }
  return pics
}

export async function dynamicPublish(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const pics = await uploadPics(b, (ctx.options.image as string[] | undefined) ?? [])
  const d = await api.createDynamic(b, String(ctx.options.text), pics)
  const id = n.id(d.dyn_id_str ?? d.dyn_id)
  return { id, url: `https://t.bilibili.com/${id}` }
}

export async function dynamicDelete(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  await api.removeDynamic(b, ctx.args.id!)
  return { id: ctx.args.id! }
}

/** 先存草稿再提交（上游 save_article_draft + submit_article）；--draft 时只存草稿。 */
export async function articlePublish(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const o = ctx.options as Record<string, any>
  let banner = ''
  if (o.cover) {
    const img = await readMedia(b.http, o.cover)
    banner = (await api.uploadCover(b, img.data, img.contentType.split('/')[1] ?? 'jpeg')).url
  }
  const article: api.ArticleInput = {
    title: o.title,
    content: o.text,
    category: Number(o.category ?? 0),
    bannerUrl: banner,
    tags: ((o.tag as string[] | undefined) ?? []).join(','),
    summary: o.summary ?? '',
  }
  const draft = await api.saveArticleDraft(b, article)
  const aid = n.id(draft.aid)
  if (o.draft) return { id: aid, url: null }
  try {
    await api.submitArticle(b, aid, article)
  } catch (err) {
    if (err instanceof CatbusError) {
      throw new CatbusError(err.code, `专栏提交失败，草稿 ${aid} 已保存：${err.message}`, {
        hint: err.hint ?? `查看草稿：catbus bilibili draft get ${aid}；删除：catbus bilibili draft delete ${aid}`,
        detail: err.detail,
      })
    }
    throw err
  }
  return { id: aid, url: norm.articleUrl(aid) }
}

export async function draftGet(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const id = ctx.args.id!
  return norm.articleDraft((await api.articleDraft(b, id)) ?? {}, id, b.mid)
}

export async function draftDelete(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  await api.deleteArticleDraft(b, ctx.args.id!)
  return { id: ctx.args.id! }
}

// ================================================================ live

async function room(b: Bili, input: string) {
  const init = await api.roomInit(b, await resolveRoom(b, input))
  return { roomId: String(init.room_id), uid: String(init.uid), status: init.live_status as number }
}

export async function liveGet(ctx: Ctx) {
  const b = await bili(ctx)
  const r = await room(b, ctx.args.room!)
  const d = await api.roomInfo(b, r.roomId)
  const info = d.room_info ?? {}
  const host = d.anchor_info?.base_info ?? {}
  return n.live(
    {
      id: r.roomId,
      url: norm.liveUrl(r.roomId),
      title: n.str(info.title),
      status: (info.live_status ?? r.status) === 1 ? 'live' : 'offline',
      host: norm.ref(r.uid, host.uname),
      cover: n.url(info.cover),
      stats: { viewers: n.count(info.online) },
    },
    d,
  )
}

export async function liveSearch(ctx: Ctx) {
  const b = await bili(ctx)
  const p = page(ctx)
  const d = await api.searchType(b, ctx.args.keyword!, 'totalrank', p, 'live_room')
  const list = (Array.isArray(d.result) ? d.result : (d.result?.live_room ?? [])).map(norm.searchLive)
  return paged(list, p + 1, p < Number(d.numPages ?? 0))
}

export async function liveCategories(ctx: Ctx) {
  const b = await bili(ctx)
  const d = await api.areaList(b)
  return (d.data ?? []).flatMap((p: any) => [
    n.category({ id: n.id(p.id), name: p.name }, p),
    ...(p.list ?? []).map((c: any) => n.category({ id: n.id(c.id), name: c.name, parent_id: n.id(c.parent_id ?? p.id) }, c)),
  ])
}

export async function liveHistory(ctx: Ctx) {
  const b = await bili(ctx)
  const r = await room(b, ctx.args.room!)
  const d = await api.danmakuHistory(b, r.roomId)
  return [...(d.admin ?? []), ...(d.room ?? [])].map(norm.historyEvent)
}

export async function liveGifts(ctx: Ctx) {
  const b = await bili(ctx)
  const r = await room(b, ctx.args.room!)
  const info = (await api.roomInfo(b, r.roomId)).room_info ?? {}
  const d = await api.giftList(b, r.roomId, info.parent_area_id ?? 0, info.area_id ?? 0, r.uid)
  const inRoom = new Set((d.gift_data?.room_gift_list?.gold_list ?? []).map((g: any) => String(g.gift_id)))
  const all: any[] = d.gift_config?.base_config?.list ?? []
  return all
    .filter((g) => !inRoom.size || inRoom.has(String(g.id)))
    .map((g) =>
      n.gift(
        {
          id: n.id(g.id),
          name: String(g.name ?? ''),
          price: g.coin_type === 'gold' ? n.price(Number(g.price) / 1000) : { amount: Number(g.price ?? 0), currency: 'BILI_SILVER' },
        },
        g,
      ),
    )
}

export async function liveMedia(ctx: Ctx): Promise<Media[]> {
  const b = await bili(ctx)
  const r = await room(b, ctx.args.room!)
  const d = await api.roomPlayInfo(b, r.roomId)
  const out: Media[] = []
  for (const s of d.playurl_info?.playurl?.stream ?? []) {
    for (const f of s.format ?? []) {
      for (const c of f.codec ?? []) {
        for (const u of c.url_info ?? []) out.push(n.media({ id: `${s.protocol_name}-${f.format_name}-${c.codec_name}-${c.current_qn}`, type: 'video', url: `${u.host}${c.base_url}${u.extra}` }, c))
      }
    }
  }
  return out
}

export async function liveSend(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const r = await room(b, ctx.args.room!)
  const giftId = ctx.options.gift as string | undefined
  if (!giftId) {
    const style: api.LiveDanmakuStyle = danmakuStyle(ctx.options)
    const replyUser = ctx.options.replyUser as string | undefined
    if (replyUser) {
      style.replyMid = await resolveUser(b, replyUser)
      style.replyUname = await userName(b, style.replyMid)
    }
    const d = await api.sendLiveDanmaku(b, r.roomId, ctx.args.text!, style)
    let id = r.roomId
    try {
      id = JSON.parse(d?.mode_info?.extra ?? '{}').id_str ?? id
    } catch {}
    return { id }
  }
  const count = Number(ctx.options.count ?? 1)
  const bag = ((await api.bagList(b, r.roomId))?.list ?? []).find((g: any) => String(g.gift_id) === giftId && g.gift_num >= count)
  if (bag) {
    await api.sendGift(b, r.roomId, r.uid, giftId, count, bag.bag_id, 'silver', 0)
    return { id: r.roomId }
  }
  const info = (await api.roomInfo(b, r.roomId)).room_info ?? {}
  const list = (await api.giftList(b, r.roomId, info.parent_area_id ?? 0, info.area_id ?? 0, r.uid)).gift_config?.base_config?.list ?? []
  const gift = list.find((g: any) => String(g.id) === giftId)
  if (!gift) throw new CatbusError('USAGE', `礼物 ${giftId} 不在这个直播间的礼物列表里`, { hint: `catbus bilibili live gifts ${ctx.args.room}` })
  await api.sendGift(b, r.roomId, r.uid, giftId, count, 0, gift.coin_type, gift.price)
  return { id: r.roomId }
}

/** 直播弹幕回复对象的昵称（上游 send_danmaku 的 reply_uname）：取不到时留空，只带 reply_mid。 */
async function userName(b: Bili, mid: string): Promise<string> {
  try {
    return String((await api.userInfo(b, mid))?.name ?? '')
  } catch (err) {
    b.ctx.log.debug(`取用户 ${mid} 的昵称失败：${(err as Error).message}`)
    return ''
  }
}

async function ownRoom(b: Bili): Promise<string> {
  const d = await api.roomByMid(b, b.mid)
  if (!d?.roomid || d.roomStatus === 0) throw new CatbusError('UPSTREAM', '这个账号还没有开通直播间')
  return String(d.roomid)
}

export async function liveStart(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const area = ctx.options.category as string | undefined
  if (!area) throw new CatbusError('USAGE', '开播需要 --category（直播分区 id）', { hint: 'catbus bilibili live categories' })
  const roomId = await ownRoom(b)
  const d = await api.startLive(b, roomId, area)
  return { id: roomId, push: { url: d.rtmp?.addr ?? null, key: d.rtmp?.code ?? null } }
}

export async function liveStop(ctx: Ctx) {
  const b = await bili(ctx)
  b.requireLogin()
  const roomId = await ownRoom(b)
  await api.stopLive(b, roomId)
  return { id: roomId }
}

// ---------------------------------------------------------------- 弹幕长连（上游 live/server.py）

const OP_HEARTBEAT = 2
const OP_HEARTBEAT_REPLY = 3
const OP_MESSAGE = 5
const OP_AUTH = 7

function pack(body: Uint8Array, op: number, ver = 1): Buffer {
  const head = Buffer.alloc(16)
  head.writeUInt32BE(16 + body.length, 0)
  head.writeUInt16BE(16, 4)
  head.writeUInt16BE(ver, 6)
  head.writeUInt32BE(op, 8)
  head.writeUInt32BE(1, 12)
  return Buffer.concat([head, body])
}

function unpack(data: Buffer, out: [number, unknown][] = []): [number, unknown][] {
  let offset = 0
  while (offset + 16 <= data.length) {
    const len = data.readUInt32BE(offset)
    const headLen = data.readUInt16BE(offset + 4)
    const ver = data.readUInt16BE(offset + 6)
    const op = data.readUInt32BE(offset + 8)
    const body = data.subarray(offset + headLen, offset + len)
    if (ver === 2) unpack(inflateSync(body), out)
    else if (ver === 3) unpack(brotliDecompressSync(body), out)
    else if (ver === 1) out.push([op, body.length >= 4 ? body.readUInt32BE(0) : 0])
    else out.push([op, body.length ? JSON.parse(body.toString('utf8')) : {}])
    offset += len
  }
  return out
}

export function liveListen(ctx: Ctx) {
  return (async function* () {
    const b = await bili(ctx)
    const r = await room(b, ctx.args.room!)
    const cookie = b.jar.forUrl('https://live.bilibili.com/').map((c) => `${c.name}=${c.value}`).join('; ')
    yield* reconnecting(ctx, async function* () {
      const info = await api.danmuInfo(b, r.roomId)
      const host = info.host_list?.[0]
      if (!host) throw new Error('getDanmuInfo 没有返回接入点')
      const socket = await openSocket(`wss://${host.host}:${host.wss_port}/sub`, {
        headers: { 'User-Agent': PROFILE.ua, Origin: 'https://live.bilibili.com', Cookie: cookie },
        ...(ctx.config.proxy ? { proxy: ctx.config.proxy } : {}),
        signal: ctx.signal,
      })
      const auth = JSON.stringify({ uid: Number(b.mid || 0), roomid: Number(r.roomId), protover: 3, buvid: b.jar.get('buvid3') ?? '', platform: 'web', type: 2, key: info.token })
      await socket.send(pack(Buffer.from(auth), OP_AUTH, 0))
      const heartbeat = () => socket.send(pack(Buffer.from('[object Object]'), OP_HEARTBEAT)).catch(() => {})
      void heartbeat()
      const beat = setInterval(heartbeat, 30_000).unref()
      try {
        for await (const raw of socket.messages) {
          if (typeof raw === 'string') continue
          for (const [op, payload] of unpack(raw)) {
            ctx.log.debug(`ws op=${op} ${op === OP_MESSAGE ? String((payload as { cmd?: string }).cmd) : JSON.stringify(payload)}`)
            if (op === OP_HEARTBEAT_REPLY) yield norm.popularityEvent(Number(payload))
            else if (op === OP_MESSAGE) yield norm.liveEvent(payload)
          }
        }
      } finally {
        clearInterval(beat)
        socket.close()
      }
    })
  })()
}
