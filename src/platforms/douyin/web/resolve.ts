import { CatbusError } from '../../../core/errors.js'
import { jsonLoads } from '../../../core/py.js'
import * as api from './api.js'
import type { Douyin } from './client.js'
import { LIVE } from './profile.js'

/** 参数归一化（AGENTS 4.8）：ID、URL、分享短链、`me`。 */

const SHORT_RE = /^https?:\/\/(v\.douyin\.com|www\.iesdouyin\.com\/share)\//i

/** 分享短链（v.douyin.com）跟一次跳转，取 Location。分享文案里夹着的链接也能认出来。 */
async function expand(d: Douyin, input: string): Promise<string> {
  const s = input.trim()
  const link = /https?:\/\/v\.douyin\.com\/[\w-]+\/?/i.exec(s)?.[0] ?? s
  if (!SHORT_RE.test(link)) return s
  const res = await d.http.request({ url: link, redirect: 'manual', cookies: false, headers: [['user-agent', 'Mozilla/5.0']] })
  return res.headers.get('location') ?? link
}

/** 已展开的字符串里的作品 ID：作品页路径、modal_id= 等参数，或纯数字 ID。 */
function itemIdOf(s: string): string | undefined {
  return /\/(?:video|note|slides|share\/video|share\/note)\/(\d+)/.exec(s)?.[1] ?? /[?&](?:modal_id|aweme_id|item_id)=(\d+)/.exec(s)?.[1] ?? /^\d{8,}$/.exec(s)?.[0]
}

/** 已展开的字符串里的 sec_uid：主页路径、sec_uid= 参数，或 MS4w 开头的 sec_uid；/user/self 不算。 */
function secUidOf(s: string): string | undefined {
  const m = /\/(?:user|share\/user)\/([\w-]+)/.exec(s)?.[1] ?? /[?&]sec_uid=([\w-]+)/.exec(s)?.[1] ?? /^MS4w[\w-]+$/.exec(s)?.[0]
  return m && m !== 'self' ? m : undefined
}

/** 作品：aweme_id、作品页 URL（/video/、/note/、/slides/、modal_id=）或分享短链。 */
export async function resolveItem(d: Douyin, input: string): Promise<string> {
  const m = itemIdOf(await expand(d, input))
  if (m) return m
  throw new CatbusError('USAGE', `无法识别的作品：${input}`, { hint: '传作品 ID 或作品链接，例如 https://www.douyin.com/video/7433523124836060416' })
}

/** 用户：sec_uid、主页 URL、分享短链、`me`。 */
export async function resolveUser(d: Douyin, input: string): Promise<string> {
  if (input.trim() === 'me') {
    const saved = d.credential.user?.id
    if (saved) return saved
    if (!d.isLogin) throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: 'catbus douyin auth login' })
    return (await api.mySecUid(d)).secUid
  }
  const m = secUidOf(await expand(d, input))
  if (m) return m
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 sec_uid（MS4wLjAB 开头）或主页链接 https://www.douyin.com/user/<sec_uid>' })
}

export type ShareTarget = { kind: 'item'; id: string } | { kind: 'user'; secUid: string } | { kind: 'web'; url: string }

/**
 * `msg send --share` 的目标：作品（ID / 链接）、用户（sec_uid / 主页 / me）、其余 http(s) 链接当网页卡片。
 * 先认作品：主页上点开的作品是 `/user/<sec_uid>?modal_id=<作品>`，与 resolveItem 一样当作品。
 */
export async function resolveShare(d: Douyin, input: string): Promise<ShareTarget> {
  if (input.trim() === 'me') return { kind: 'user', secUid: await resolveUser(d, 'me') }
  const s = await expand(d, input)
  const item = itemIdOf(s)
  if (item) return { kind: 'item', id: item }
  const user = secUidOf(s)
  if (user) return { kind: 'user', secUid: user }
  if (/^https?:\/\//i.test(s)) return { kind: 'web', url: s }
  throw new CatbusError('USAGE', `无法识别的分享目标：${input}`, { hint: '传作品 ID / 链接、用户 sec_uid / 主页链接，或一个网页链接' })
}

/** 直播分享页（reflow）的接口，不用登录：按场次的 room_id 取主播的直播间号 owner.web_rid。 */
const REFLOW_INFO = 'https://webcast.amemv.com/webcast/room/reflow/info/'

async function webRidOfRoom(d: Douyin, roomId: string): Promise<string | undefined> {
  const q = new URLSearchParams({ type_id: '0', live_id: '1', room_id: roomId, app_id: '1128' })
  const res = await d.http.request({ url: `${REFLOW_INFO}?${q}`, cookies: false, headers: [['user-agent', 'Mozilla/5.0']] })
  const rid = (jsonLoads(await res.text()) ?? {})?.data?.room?.owner?.web_rid
  return typeof rid === 'string' && /^\d+$/.test(rid) ? rid : undefined
}

/**
 * 直播间：直播间号（web_rid）、live.douyin.com 链接，或直播分享短链 / 分享文案。
 * 直播的分享短链跳到 webcast.amemv.com/douyin/webcast/reflow/<room_id>（浏览器里再由页面 JS 跳到 live.douyin.com），
 * room_id 是这一场的场次 ID，要经 reflow 接口换成直播间号。
 */
export async function resolveRoom(d: Douyin, input: string): Promise<string> {
  const s = await expand(d, input)
  const reflow = /webcast\.amemv\.com\/douyin\/webcast\/reflow\/(\d+)/.exec(s)?.[1]
  if (reflow) {
    const rid = await webRidOfRoom(d, reflow)
    if (rid) return rid
    throw new CatbusError('UPSTREAM', `直播分享链接里的场次取不到直播间号：${reflow}`, { hint: `直播可能已经结束；也可以传直播间链接 ${LIVE}/<直播间号>` })
  }
  const m = /live\.douyin\.com\/(\d+)/.exec(s)?.[1] ?? /^\d+$/.exec(s)?.[0]
  if (m) return m
  throw new CatbusError('USAGE', `无法识别的直播间：${input}`, { hint: `传直播间号、直播间链接 ${LIVE}/<直播间号>，或直播分享链接` })
}

export interface ProductRef {
  promotionId: string
  productId: string | null
  shopId: string | null
}

/** 商品：promotion_id，或带 id / promotion_id / shop_id 参数的商品链接（live products 输出的 url）。 */
export function resolveProduct(input: string): ProductRef {
  const s = input.trim()
  if (/^\d+$/.test(s)) return { promotionId: s, productId: null, shopId: null }
  let q: URLSearchParams
  try {
    q = new URL(s).searchParams
  } catch {
    throw new CatbusError('USAGE', `无法识别的商品：${input}`, { hint: '传商品 promotion_id，或 catbus douyin live products 输出的商品 url' })
  }
  const promotionId = q.get('promotion_id') ?? q.get('id')
  if (!promotionId) throw new CatbusError('USAGE', `商品链接里没有 id：${input}`)
  return { promotionId, productId: q.get('product_id') ?? q.get('id'), shopId: q.get('shop_id') }
}
