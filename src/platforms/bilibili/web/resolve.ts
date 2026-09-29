import { CatbusError } from '../../../core/errors.js'
import * as api from './api.js'
import type { Bili } from './client.js'
import { av2bv, bv2av } from './sign.js'

/** 参数归一化（AGENTS 4.8）：ID、URL、分享短链、BV 号、`me`。 */

const BV_RE = /BV1[0-9A-Za-z]{9}/
const SHORT_RE = /^https?:\/\/(b23\.tv|bili2233\.cn)\//i

/** 分享短链跟一次跳转，取 Location。 */
async function expand(b: Bili, url: string): Promise<string> {
  if (!SHORT_RE.test(url)) return url
  const res = await b.http.request({ url, redirect: 'manual', cookies: false })
  return res.headers.get('location') ?? url
}

export interface VideoRef {
  bvid: string
  aid: string
}

/** 稿件：BV 号、av 号、纯数字 aid、视频页 URL 或 b23.tv 短链。 */
export async function resolveItem(b: Bili, input: string): Promise<VideoRef> {
  const s = (await expand(b, input.trim())).trim()
  const bv = BV_RE.exec(s)?.[0]
  if (bv) return { bvid: bv, aid: bv2av(bv) }
  const av = /(?:^|\/|\b)av(\d+)/i.exec(s)?.[1] ?? (/^\d+$/.test(s) ? s : undefined)
  if (av) return { bvid: av2bv(av), aid: av }
  throw new CatbusError('USAGE', `无法识别的稿件：${input}`, { hint: '传 BV 号、av 号或视频链接，例如 BV1GJ411x7h7' })
}

/** 评论区类型（上游 get_replies 的 type_）：1 视频、12 专栏、17 动态。 */
export type ReplyType = 1 | 12 | 17

export interface ReplyTarget {
  type: ReplyType
  /** 评论区的 oid：视频为 aid，专栏为 cv 号的数字，动态为动态 ID。 */
  oid: string
  /** 输出里 Comment.item_id 用的标识：BV 号、`cv<id>`、动态 ID。 */
  itemId: string
}

/**
 * 动态的评论区只有纯文字和转发动态是 type 17 + 动态 ID；图文动态（带图）的评论区挂在相簿上（type 11 + 相簿 rid），
 * 专栏动态挂在专栏上（type 12 + cv 号）。从动态 ID 查 rid / cv 号要动态详情接口，上游没有，catbus 也不自己加。
 */
export const DYNAMIC_REPLY_HINT = '动态只支持纯文字和转发：图文动态（带图）的评论区挂在相簿上，上游没有查相簿 ID 的接口；专栏请传 cv 号或专栏链接'

const ARTICLE_RE = [/(?:^|\/read\/)cv(\d+)/i, /\/read\/mobile(?:\/|\?id=)(\d+)/i]
const DYNAMIC_RE = [/t\.bilibili\.com\/(\d+)/i, /bilibili\.com\/opus\/(\d+)/i, /m\.bilibili\.com\/dynamic\/(\d+)/i, /^dyn(?:amic)?:(\d+)$/i]
/** aid 最大 2^51，16 位以内；动态 ID 是 18、19 位。更长的纯数字按动态处理。 */
const MIN_DYNAMIC_DIGITS = 17

function firstMatch(res: RegExp[], s: string): string | undefined {
  for (const re of res) {
    const m = re.exec(s)?.[1]
    if (m) return m
  }
}

/**
 * 评论区：稿件（BV 号、av 号、视频链接）→ 1；专栏（cv 号、专栏链接）→ 12；
 * 动态（动态链接、17 位以上的动态 ID、`dyn:<id>`）→ 17，只对纯文字和转发动态成立（见 DYNAMIC_REPLY_HINT）。
 * opus 链接既可能是动态也可能是专栏，不发请求分不出来，按动态处理。
 */
export async function resolveReplyTarget(b: Bili, input: string): Promise<ReplyTarget> {
  const s = (await expand(b, input.trim())).trim()
  const cv = firstMatch(ARTICLE_RE, s)
  if (cv) return { type: 12, oid: cv, itemId: `cv${cv}` }
  const dyn = firstMatch(DYNAMIC_RE, s) ?? (/^\d+$/.test(s) && s.length >= MIN_DYNAMIC_DIGITS ? s : undefined)
  if (dyn) return { type: 17, oid: dyn, itemId: dyn }
  try {
    const { bvid, aid } = await resolveItem(b, s)
    return { type: 1, oid: aid, itemId: bvid }
  } catch {
    throw new CatbusError('USAGE', `无法识别的评论区：${input}`, {
      hint: `传稿件（BV 号、av 号、视频链接）、专栏（cv 号或专栏链接）或动态（动态链接或动态 ID）；${DYNAMIC_REPLY_HINT}`,
    })
  }
}

/** 动态：动态链接（t.bilibili.com、opus、m.bilibili.com/dynamic）、`dyn:<id>` 或纯数字的动态 ID。dynamic publish 输出的 id、url 都能直接用。 */
export async function resolveDynamic(b: Bili, input: string): Promise<string> {
  const s = (await expand(b, input.trim())).trim()
  const id = firstMatch(DYNAMIC_RE, s) ?? /^\d+$/.exec(s)?.[0]
  if (id) return id
  throw new CatbusError('USAGE', `无法识别的动态：${input}`, { hint: '传动态 ID 或动态链接 https://t.bilibili.com/<id>（dynamic publish 输出的 id、url 都可以）' })
}

/** 收藏夹：folder list 输出的 url（`…/favlist?fid=<id>`）、播放列表链接（`ml<id>`）或纯数字的收藏夹 ID。 */
export async function resolveFolder(b: Bili, input: string): Promise<string> {
  const s = (await expand(b, input.trim())).trim()
  const id = /[?&]fid=(\d+)/.exec(s)?.[1] ?? /(?:^|\/)ml(\d+)/.exec(s)?.[1] ?? /^\d+$/.exec(s)?.[0]
  if (id) return id
  throw new CatbusError('USAGE', `无法识别的收藏夹：${input}`, { hint: '传收藏夹 ID 或 folder list 输出的 url（https://space.bilibili.com/<mid>/favlist?fid=<id>）' })
}

/** 用户：mid、空间 URL、`me`。 */
export async function resolveUser(b: Bili, input: string): Promise<string> {
  const s = (await expand(b, input.trim())).trim()
  if (s === 'me') {
    if (!b.mid) throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: 'catbus bilibili auth login' })
    return b.mid
  }
  const m = /space\.bilibili\.com\/(\d+)/.exec(s)?.[1] ?? /^(?:uid:?)?(\d+)$/i.exec(s)?.[1]
  if (m) return m
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 mid（数字）或空间链接 https://space.bilibili.com/<mid>' })
}

/**
 * 直播间：房间号或直播间 URL（短号在调用 room_init 时换成真实房间号）；
 * 也可以传主播（空间链接、`uid:<mid>`、`me`），按上游 get_room_by_mid 换成房间号。纯数字按房间号处理。
 */
export async function resolveRoom(b: Bili, input: string): Promise<string> {
  const s = (await expand(b, input.trim())).trim()
  const m = /live\.bilibili\.com\/(?:h5\/)?(\d+)/.exec(s)?.[1] ?? /^\d+$/.exec(s)?.[0]
  if (m) return m
  const mid = s === 'me' || /space\.bilibili\.com\/\d+/.test(s) || /^uid:?\d+$/i.test(s) ? await resolveUser(b, s) : null
  if (mid) {
    const d = await api.roomByMid(b, mid)
    if (!d?.roomid || d.roomStatus === 0) throw new CatbusError('UPSTREAM', s === 'me' ? '这个账号还没有开通直播间' : `用户 ${mid} 没有开通直播间`, { detail: { mid } })
    return String(d.roomid)
  }
  throw new CatbusError('USAGE', `无法识别的直播间：${input}`, {
    hint: '传房间号、直播间链接 https://live.bilibili.com/<房间号>，或主播的空间链接 / uid:<mid>',
  })
}
