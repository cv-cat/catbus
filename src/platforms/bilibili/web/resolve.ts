import { CatbusError } from '../../../core/errors.js'
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

/** 直播间：房间号或直播间 URL（短号在调用 room_init 时换成真实房间号）。 */
export async function resolveRoom(b: Bili, input: string): Promise<string> {
  const s = (await expand(b, input.trim())).trim()
  const m = /live\.bilibili\.com\/(?:h5\/)?(\d+)/.exec(s)?.[1] ?? /^\d+$/.exec(s)?.[0]
  if (m) return m
  throw new CatbusError('USAGE', `无法识别的直播间：${input}`, { hint: '传房间号或直播间链接 https://live.bilibili.com/<房间号>' })
}
