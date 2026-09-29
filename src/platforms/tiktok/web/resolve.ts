import { CatbusError } from '../../../core/errors.js'
import { jsonLoads } from '../../../core/py.js'
import * as api from './api.js'
import { hydration, type TikTok } from './client.js'
import { ORIGIN } from './profile.js'

/** 参数归一化（AGENTS 4.8）：ID、URL、分享短链、@用户名、secUid、`me`。 */

const SHORT_RE = /^https?:\/\/(vt\.tiktok\.com|vm\.tiktok\.com|www\.tiktok\.com\/t)\//i

/** 分享短链跟一次跳转，取 Location。 */
export async function expand(t: TikTok, input: string): Promise<string> {
  const s = input.trim()
  if (!SHORT_RE.test(s)) return s
  const res = await t.send({ url: s, redirect: 'manual', cookies: false, headers: [['user-agent', t.ua]] })
  return res.headers.get('location') ?? s
}

export interface ItemRef {
  id: string
  /** 视频页 URL（去掉 query）。 */
  url: string
  /** 链接里的作者用户名；只给了 ID 时为 null。 */
  handle: string | null
}

/** 作品：纯数字 ID、视频 / 图文页 URL、分享短链。 */
export async function resolveItem(t: TikTok, input: string): Promise<ItemRef> {
  const s = await expand(t, input)
  const m = /tiktok\.com\/@([^/?#]+)\/(?:video|photo)\/(\d+)/.exec(s)
  if (m) return { id: m[2]!, handle: decodeURIComponent(m[1]!), url: `${ORIGIN}/@${m[1]}/video/${m[2]}` }
  const id = /(?:^|\/(?:video|photo|v)\/)(\d{15,21})(?:\.html)?(?:[/?#]|$)/.exec(s)?.[1]
  if (id) return { id, handle: null, url: `${ORIGIN}/@_/video/${id}` }
  throw new CatbusError('USAGE', `无法识别的作品：${input}`, { hint: '传作品 ID 或视频链接，例如 https://www.tiktok.com/@tiktok/video/7300000000000000000' })
}

export interface UserRefInput {
  handle: string | null
  secUid: string | null
  id: string | null
}

const SEC_UID_RE = /^MS4wLj[A-Za-z0-9_-]{20,}$/

/** 用户：@用户名、主页 URL、secUid、数字 uid、`me`。 */
export async function parseUser(t: TikTok, input: string): Promise<UserRefInput> {
  const s = (await expand(t, input)).trim()
  if (s === 'me') {
    if (!t.loggedIn) throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: 'catbus tiktok auth login' })
    const me = await currentUser(t)
    return { handle: me.uniqueId ?? null, secUid: me.secUid ?? null, id: me.uid ?? t.uid }
  }
  const url = /tiktok\.com\/@([^/?#]+)/.exec(s)?.[1]
  if (url) return { handle: decodeURIComponent(url), secUid: null, id: null }
  if (SEC_UID_RE.test(s)) return { handle: null, secUid: s, id: null }
  if (/^\d{5,21}$/.test(s)) return { handle: null, secUid: null, id: s }
  const handle = /^@?([A-Za-z0-9_.]{1,64})$/.exec(s)?.[1]
  if (handle) return { handle, secUid: null, id: null }
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户名（@tiktok）、主页链接、secUid 或 me' })
}

/** 登录用户（首页 hydration 的 app-context.user）。 */
export async function currentUser(t: TikTok): Promise<{ uid?: string; uniqueId?: string; secUid?: string; nickName?: string; [k: string]: unknown }> {
  const html = await t.document(`${ORIGIN}/`, `${ORIGIN}/`)
  const user = hydration(html)?.['webapp.app-context']?.user
  if (!user?.uid && !user?.uniqueId) throw new CatbusError('AUTH_EXPIRED', 'TikTok 首页没有返回当前登录用户，登录态可能已失效', { hint: 'catbus tiktok auth login' })
  return user
}

/** 主页 SSR 里的 userInfo（上游 get_user_info：webapp.user-detail）。 */
export async function userDetail(t: TikTok, handle: string): Promise<any> {
  const html = await api.userHtml(t, `${ORIGIN}/@${encodeURIComponent(handle).replace(/%40/g, '@')}`)
  const detail = hydration(html)?.['webapp.user-detail'] ?? matchUserDetail(html)
  if (!detail) throw new CatbusError('UPSTREAM', '页面中没有 webapp.user-detail', { hint: '确认用户名是否正确' })
  if (detail.statusCode && detail.statusCode !== 0) {
    throw new CatbusError('UPSTREAM', `用户不存在或不可见：@${handle}`, { detail: { statusCode: detail.statusCode, statusMsg: detail.statusMsg } })
  }
  return detail.userInfo
}

/** 上游的正则取法：`"webapp.user-detail":(.*?),"webapp.a-b"`。 */
function matchUserDetail(html: string): any {
  const m = /"webapp\.user-detail":(.*?),"webapp\.a-b"/.exec(html)
  if (!m) return null
  try {
    return jsonLoads(m[1]!)
  } catch {
    return null
  }
}

/** 数字 uid → 用户名（私信页的用户卡片接口，需要登录）。 */
async function handleById(t: TikTok, id: string): Promise<string> {
  const r = await api.imUserProfile(t, [id])
  const handle = r.users?.[0]?.im_user_profile?.unique_id
  if (!handle) throw new CatbusError('UPSTREAM', `找不到用户 ${id}`)
  return handle
}

/** 需要完整资料时：返回 userInfo（含 user.id / secUid / uniqueId）。 */
export async function resolveUserInfo(t: TikTok, input: string): Promise<any> {
  const u = await parseUser(t, input)
  if (u.handle) return userDetail(t, u.handle)
  if (u.id) return userDetail(t, await handleById(t, u.id))
  throw new CatbusError('USAGE', '只给了 secUid，无法取用户资料', { hint: '传用户名（@tiktok）或主页链接' })
}

/** 只需要 secUid 的列表类接口。 */
export async function resolveSecUid(t: TikTok, input: string): Promise<string> {
  const u = await parseUser(t, input)
  if (u.secUid) return u.secUid
  const info = await resolveUserInfo(t, input)
  const sec = info?.user?.secUid
  if (!sec) throw new CatbusError('UPSTREAM', '用户资料里没有 secUid')
  return sec
}

export interface RoomRef {
  roomId: string
  handle: string | null
  hostId: string | null
  /** /api-live/user/room 的 data（user + liveRoom）；只给了房间号时为 null。 */
  data: any
  /** 只给了房间号且需要主播信息时，/webcast/room/enter/ 返回的房间对象（owner、stream_url 等）。 */
  webcast?: any
}

const ROOM_ID_RE = /^\d{10,21}$/

export const isRoomId = (input: string) => ROOM_ID_RE.test(input.trim())

/** 只有房间号时取主播信息：进房（上游 enter_live_room）拿房间对象里的 owner。 */
export async function enterRoom(t: TikTok, roomId: string): Promise<RoomRef> {
  const r = await api.enterLiveRoom(t, roomId)
  const room = r.data ?? {}
  const owner = room.owner ?? {}
  const hostId = owner.id_str ?? room.owner_user_id_str ?? owner.id ?? room.owner_user_id
  if (!hostId) throw new CatbusError('UPSTREAM', `直播间 ${roomId} 的进房结果里没有主播信息`, { detail: { status: room.status } })
  return { roomId: String(room.id_str ?? roomId), handle: owner.display_id ?? null, hostId: String(hostId), data: null, webcast: room }
}

/**
 * 直播间：@主播、主播主页或直播间 URL（查 /api-live/user/room 得到房间号）、纯数字房间号。
 * 只给房间号、又需要主播信息（点赞、排行榜、发弹幕、直播间信息）时，先进房取房间对象。
 */
export async function resolveRoom(t: TikTok, input: string, o: { needHost?: boolean } = {}): Promise<RoomRef> {
  const s = (await expand(t, input)).trim()
  if (ROOM_ID_RE.test(s)) {
    if (o.needHost) return enterRoom(t, s)
    return { roomId: s, handle: null, hostId: null, data: null }
  }
  const handle = /tiktok\.com\/@([^/?#]+)/.exec(s)?.[1] ?? /^@?([A-Za-z0-9_.]{1,64})$/.exec(s)?.[1]
  if (!handle) throw new CatbusError('USAGE', `无法识别的直播间：${input}`, { hint: '传主播用户名（@tiktok）、直播间链接或房间号' })
  const r = await api.liveUserRoom(t, decodeURIComponent(handle))
  const u = r.data?.user ?? {}
  const roomId = String(u.roomId || r.data?.liveRoom?.roomId || '')
  if (!roomId) throw new CatbusError('UPSTREAM', `@${handle} 当前没有直播间`, { detail: { status: u.status } })
  return { roomId, handle: u.uniqueId ?? decodeURIComponent(handle), hostId: u.id ? String(u.id) : null, data: r.data }
}

/** Shop 商品：PDP URL（/pdp/<slug>/<id>、/view/product/<id>）或纯数字 ID。 */
export function resolveProduct(input: string): { id: string; url: string } {
  const s = input.trim()
  const m = /shop\.tiktok\.com(?:\/[^?#]*?)?(?:\/pdp\/(?:[^/?#]+\/)?|\/view\/product\/)(\d+)/.exec(s)
  if (m) {
    const url = s.split('#')[0]!.split('?')[0]!
    return { id: m[1]!, url: /\/pdp\//.test(url) ? url : `https://shop.tiktok.com/view/product/${m[1]}` }
  }
  if (/^\d{10,21}$/.test(s)) return { id: s, url: `https://shop.tiktok.com/view/product/${s}` }
  throw new CatbusError('USAGE', `无法识别的商品：${input}`, { hint: '传商品 ID 或 https://shop.tiktok.com/.../pdp/<商品ID> 链接' })
}

/** 是否像商品参数（`comment list` 自动识别商品 URL）。 */
export function isProductInput(input: string): boolean {
  return /shop\.tiktok\.com\//.test(input)
}
