import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, loginContext } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Item, Media } from '../../../core/schemas.js'
import { authError, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { Weibo } from './client.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN } from './profile.js'
import { resolveItem, resolveUser } from './resolve.js'

type Ctx = HandlerContext

// ================================================================ auth

export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const w = new Weibo(loginContext(ctx, credential))
  const self = await api.selfInfo(w)
  if (!self) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '在浏览器登录 weibo.com 后，复制请求头里完整的 Cookie' })
  return finishLogin(ctx, credential, { id: self.uid, name: n.str(self.nick), url: norm.userUrl(self.uid), avatar: self.avatar })
}

/** 登录态的过期时间：cookie ALF 是 SUB 的过期秒数（可能带 `02_` 前缀）。 */
function expiresAt(w: Weibo): string | null {
  const alf = /(\d{9,})$/.exec(w.jar.get('ALF') ?? '')?.[1]
  const sub = w.jar.forUrl('https://weibo.com/').find((c) => c.name === 'SUB')?.expires
  return n.time(alf ?? sub)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const w = new Weibo(ctx)
  // 没有账号时凭证是空的，不用请求
  const self = w.isLogin ? await api.selfInfo(w) : null
  return {
    logged_in: Boolean(self),
    user: self ? n.accountUser(n.userRef({ id: self.uid, name: self.nick, url: norm.userUrl(self.uid) }), self.avatar) : null,
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

/**
 * 旧实现（上游 searchSome，m.weibo.cn 容器 100103type=1）：m.weibo.cn 用访客身份访问（登录 cookie
 * 不发往 .weibo.cn），访客从第二页起就是登录墙；即使换用登录会话，容器接口也从第二页起返回 ok=-100
 * （2026-11 实测）。只能取第一页，保留为回退（item search 现走主站搜索页，见下面的 itemSearch）。
 */
export async function itemSearchM(ctx: Ctx) {
  const w = new Weibo(ctx)
  const body = await api.mobileSearch(w, ctx.args.keyword!, 1)
  return paged(searchMblogs(body.data?.cards).map((m) => norm.mblog(m)), null, false)
}

// ---------------------------------------------------------------- item search：主站综合搜索（非上游，见 api.siteSearch）

/**
 * 主站搜索卡片的时间（`今天13:14`、`11月20日 11:30`、`3分钟前`、`2026-11-20`，可能带「转赞人数…」尾巴）
 * → `YYYY-MM-DD HH:MM`（n.time 按北京时间解析这个格式）。
 * 页面上的时间都是北京时间：日期运算一律在 UTC+8 上做（UTC getter + 8 小时偏移），不依赖运行机器的时区。
 */
const BJ = 8 * 3_600_000
function siteTime(raw: unknown, now: Date): string | null {
  const s = String(raw ?? '').replace(/转赞人数.*$/, '').trim()
  if (!s) return null
  const two = (v: number | string) => String(v).padStart(2, '0')
  /** 时间戳 → 北京时间的「墙上时间」（用 UTC getter 读）。 */
  const wall = (ms: number) => new Date(ms + BJ)
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`
  const hm = (d: Date) => `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`
  const today = wall(now.getTime())
  /** 只有月日的时间：取今年，比现在晚一天以上时算去年。 */
  const monthDay = (mo: number, day: number, h: number, mi: number) => {
    let year = today.getUTCFullYear()
    if (Date.UTC(year, mo - 1, day, h, mi) - BJ > now.getTime() + 86_400_000) year -= 1
    return `${year}-${two(mo)}-${two(day)} ${two(h)}:${two(mi)}`
  }
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(s))) return `${m[1]}-${m[2]}-${m[3]} ${two(Number(m[4]))}:${m[5]}`
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]} 00:00`
  if ((m = /^今天\s*(\d{1,2}):(\d{2})/.exec(s))) return `${ymd(today)} ${two(Number(m[1]))}:${m[2]}`
  if ((m = /^昨天\s*(\d{1,2}):(\d{2})/.exec(s))) return `${ymd(wall(now.getTime() - 86_400_000))} ${two(Number(m[1]))}:${m[2]}`
  if ((m = /^(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/.exec(s))) return monthDay(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))
  if ((m = /^(\d{1,2})月(\d{1,2})日$/.exec(s))) return monthDay(Number(m[1]), Number(m[2]), 0, 0)
  if (/^\d+\s*秒前/.test(s)) return `${ymd(today)} ${hm(today)}`
  if ((m = /^(\d+)\s*分钟前/.exec(s))) {
    const d = wall(now.getTime() - Number(m[1]) * 60_000)
    return `${ymd(d)} ${hm(d)}`
  }
  if ((m = /^(\d+)\s*小时前/.exec(s))) {
    const d = wall(now.getTime() - Number(m[1]) * 3_600_000)
    return `${ymd(d)} ${hm(d)}`
  }
  return null
}

/** 缩略图地址换成原图：/orj360、/thumb180、/mw1024 这类尺寸段 → /large。 */
const LARGE_RE = /\/(orj360|thumb\d*|bmiddle|mw\d+)\//
/** 图片列表：<a action-data=…pic_id=…> 后面紧跟的 <img src=…sinaimg…>。 */
const IMG_TAGS_RE = /action-data="[^"]*pic_id=([0-9A-Za-z_-]+)[^"]*"[\s\S]{0,600}?<img[^>]*?src="((?:https?:)?\/\/[^"\s]+?sinaimg[^"\s]+)"/g

/** 主站搜索的一张微博卡（feed_list_item 锚点块）→ 伪 mblog，喂给 norm.mblog 走统一归一化；非微博卡返回 null。 */
function parseSiteCard(block: string, now: Date): any | null {
  if (/wb-ad-tile|sinaads|data-aid=|>推广<|>广告</.test(block)) return null
  const mid = /mid="(\d+)"/.exec(block)?.[1]
  if (!mid) return null
  const uid = /uid=(\d+)/.exec(block)?.[1] ?? /weibo\.com\/(\d+)/.exec(block)?.[1] ?? null
  const nick = /nick-name="([^"]*)"/.exec(block)?.[1] ?? null
  const bid =
    (uid ? new RegExp(`weibo\\.com/${uid}/([0-9A-Za-z]+)`).exec(block)?.[1] : null) ??
    /weibo\.com\/\d+\/([0-9A-Za-z]+)/.exec(block)?.[1] ??
    null
  // 长微博有两个节点：先是截断版 feed_list_content（末尾带「展开」链接），再是隐藏的 feed_list_content_full；优先取完整版。
  // 「展开 / 收起」链接（action-type="fl_unfold" / "fl_fold"）不是正文，先去掉
  const node = (full: boolean) => new RegExp(`node-type="feed_list_content${full ? '_full' : ''}"[^>]*>([\\s\\S]*?)<\\/p>`).exec(block)?.[1]
  const txt = (node(true) ?? node(false))?.replace(/<a[^>]*action-type="fl_(?:un)?fold"[^>]*>[\s\S]*?<\/a>/g, '') ?? null
  const text = txt
    ? (n.plainText(txt) ?? '')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n') || null
    : null
  const from = /class="from"[^>]*>\s*(?:<a[^>]*>)?([\s\S]*?)<\//.exec(block)?.[1] ?? null
  const pics = [...block.matchAll(IMG_TAGS_RE)]
    .map((mm) => ({ pid: mm[1]!, url: mm[2]!.replace(LARGE_RE, '/large/') }))
    .filter((p) => p.pid && p.url)
  // 视频在 WB_video_h5 的 data-str 里：JS 对象字面量，单引号字符串（HTML 里转义成 \'，也有不转义的），poster 后可能带空格
  const vsrc = /src:\s*\\?'((?:\/\/|https?:\/\/)f\.video\.weibocdn\.com[^']+?)\\?'/.exec(block)?.[1] ?? null
  const vposter = /poster:\s*\\?'([^']+?)\\?'/.exec(block)?.[1] ?? null
  let likes: number | null = null
  let comments: number | null = null
  let shares: number | null = null
  for (const m of block.matchAll(/action-type="feed_list_(forward|comment|like)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const num = n.count(m[2]!.replace(/<[^>]+>/g, ' ').trim())
    if (m[1] === 'forward') shares = num
    else if (m[1] === 'comment') comments = num
    else likes = num
  }
  return {
    idstr: mid,
    mid,
    mblogid: bid,
    user: uid ? { idstr: uid, screen_name: nick } : null,
    text_raw: text,
    created_at: siteTime(from, now),
    ...(pics.length ? { pics } : {}),
    ...(vsrc
      ? { page_info: { type: 'video', media_info: { mp4_hd_url: vsrc }, ...(vposter ? { page_pic: { url: vposter } } : {}) } }
      : {}),
    attitudes_count: likes,
    comments_count: comments,
    reposts_count: shares,
  }
}

/** s.weibo.com 综合搜索页 HTML → 伪 mblog[]（按 mid 去重、保序；导出供离线测试）。 */
export function parseSiteSearch(html: string, now: Date = new Date(rand.now())): any[] {
  // 先剥掉 HTML 注释：注释紧跟在卡片 div 之间，里面若提到 wb-ad-tile 这类标记词，会污染上一张卡的块
  const clean = html.replace(/<!--[\s\S]*?-->/g, '')
  const out: any[] = []
  const seen = new Set<string>()
  // 锚点是卡片 div 标签里的 action-type="feed_list_item" 属性，在 class 之后：块从所在 div 的开标签起切。
  // 否则广告位自己的 class（wb-ad-tile）会落在上一张卡的块里（把上一张误杀），而自己的块反而没有它。
  const anchors = [...clean.matchAll(/action-type="feed_list_item"/g)].map((m) => Math.max(0, clean.lastIndexOf('<div', m.index!)))
  for (let i = 0; i < anchors.length; i++) {
    const block = clean.slice(anchors[i], Math.min(anchors[i + 1] ?? anchors[i] + 20_000, anchors[i] + 20_000))
    const mb = parseSiteCard(block, now)
    if (!mb || seen.has(mb.mid)) continue
    seen.add(mb.mid)
    out.push(mb)
  }
  return out
}

/**
 * 综合搜索改走主站 s.weibo.com（非上游，见 api.siteSearch）：.weibo.com 的登录 cookie 天然覆盖
 * s.weibo.com，page 参数直接翻页（2026-11 协议实验实测）。cursor 即页码；has_more 看分页器里
 * 有没有 page=N+1 的链接。
 */
export async function itemSearch(ctx: Ctx) {
  const w = new Weibo(ctx)
  const page = Math.max(1, Number(ctx.cursor) || 1)
  const res = await api.siteSearch(w, ctx.args.keyword!, page)
  // 未登录（或登录态失效）时 s.weibo.com 302 到 passport
  if (res.status >= 300 && res.status < 400) throw authError(w.ctx, '微博搜索需要登录')
  const html = res.text ?? ''
  if (/passport\.weibo\.com\/(anon|verifyuser)|wt_?captcha|geetest|\/aj\/captcha/.test(html)) {
    throw new CatbusError('RISK_CONTROL', '微博搜索触发验证，请稍后再试', { detail: { kind: 'blocked', page } })
  }
  const mblogs = parseSiteSearch(html)
  // 只看分页器：某一页的卡片全被过滤（广告、解析不出 mid）时也要继续翻；游标是页码，每次都前进，不会死循环
  const hasNext = new RegExp(`[?&]page=${page + 1}["&]`).test(html)
  return paged(mblogs.map((m) => norm.mblog(m)), hasNext ? String(page + 1) : null, hasNext)
}

/** post_weibo 的 type（请求里的 visible）：0 公开、1 仅自己可见、6 朋友圈可见、10 粉丝可见。 */
const VISIBLE: Record<string, string> = { public: '0', private: '1', friends: '6', fans: '10' }
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
  const images = (o.image as string[] | undefined) ?? []
  if (images.length && o.video) throw new CatbusError('USAGE', '--image 和 --video 不能同时使用')
  if (images.length > MAX_IMAGES) throw new CatbusError('USAGE', `微博最多 ${MAX_IMAGES} 张图片`)
  const text = (o.text as string | undefined) ?? ''
  if (!text && !images.length && !o.video) throw new CatbusError('USAGE', '需要 --text、--image 或 --video', { hint: 'catbus weibo item publish --text "正文" [--image <图片>...]' })

  const w = new Weibo(ctx)
  const me = await self(w)
  const body = content(text, (o.topic as string[] | undefined) ?? [], (o.poiName as string | undefined) ?? '')
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

// ================================================================ feed

/**
 * 推荐流（hottimeline）与关注流（friendstimeline）来自 weibo.com 网页版自己的接口，上游没有
 * （AGENTS 7.5 的无上游命令，测试用真机响应裁剪的 fixture 回放）。都需要登录。
 * 推荐：cursor 是上一页响应里的 since_id 对象（JSON 原样回传）；关注：cursor 是上一页的 max_id。
 */
export async function feedList(ctx: Ctx) {
  const w = new Weibo(ctx)
  w.requireLogin()
  const kind = (ctx.options as Record<string, any>).kind ?? 'recommend'
  if (kind === 'following') {
    const body = await api.feedFollowing(w, ctx.cursor ?? null)
    const next = n.str(body.max_id)
    const list = ((body.statuses ?? []) as any[]).filter((m) => !m.mblogtype || m.mblogtype === 0)
    return paged(list.map((m) => norm.mblog(m)), next, Boolean(next && next !== '0' && list.length))
  }
  // recommend（hot 是同一条流）。cursor 是上一页响应里的 since_id 对象的 JSON 原文（紧凑），翻页时原样回传
  const body = await api.feedRecommend(w, ctx.cursor ?? null)
  const sid = body.since_id
  const next = sid == null ? null : typeof sid === 'object' ? JSON.stringify(sid) : n.str(sid)
  const list = ((body.statuses ?? []) as any[]).filter((m) => !m.mblogtype || m.mblogtype === 0)
  return paged(list.map((m) => norm.mblog(m)), next, Boolean(next && list.length))
}

// ================================================================ keyword

/** 热搜榜（非上游，见 api.hotSearch）：按榜单顺序，去掉广告位；置顶词（hotgov）没有热度，不收。 */
export async function keywordHot(ctx: Ctx) {
  const w = new Weibo(ctx)
  const body = await api.hotSearch(w)
  return ((body.data?.realtime ?? []) as any[])
    .filter((x) => !x?.is_ad)
    .map((x) => n.keyword({ text: String(x?.word || x?.note || ''), heat: n.count(x?.num) }, x))
    .filter((k) => k.text)
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
    // 还没发布的视频没有可播放的地址（转码结果只有截图），url 为空串；发布时用的是 id（media_id）
    const mediaId = String(await uploadVideoFile(w, file.data, false))
    return n.media({ id: mediaId, type: 'video', url: null })
  }
  const me = await self(w)
  const d = await api.uploadImage(w, me.uid, me.nick, file.data)
  const pic = d.pic
  return n.media({ id: String(pic.pid), type: 'image', url: `https://wx1.sinaimg.cn/large/${pic.pid}.jpg`, width: n.count(pic.width), height: n.count(pic.height) }, d)
}
