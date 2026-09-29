import { CatbusError } from '../../../core/errors.js'
import { authError } from '../../../core/toolkit.js'
import * as api from './api.js'
import type { Ks } from './client.js'
import { UA } from './profile.js'

/** 参数归一化（AGENTS 4.8）：ID、URL、分享短链、`me`。 */

const SHORT_HOSTS = /^(v\.kuaishou\.com|v\.m\.chenzhongtech\.com|kuaishou\.cn|c\.kuaishou\.com)$/i

/** 分享短链跟一次跳转，取 Location。 */
async function expand(ks: Ks, input: string): Promise<string> {
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return input
  }
  if (!SHORT_HOSTS.test(u.hostname)) return input
  const res = await ks.http.request({ url: input, redirect: 'manual', cookies: false, headers: [['user-agent', UA]] })
  return res.headers.get('location') ?? input
}

/** 作品：photoId，或 www.kuaishou.com/short-video/<id>、/fw/photo/<id>、live.kuaishou.com/u/<eid>/<id>、分享短链。 */
export async function resolveItem(ks: Ks, input: string): Promise<string> {
  const s = (await expand(ks, input.trim())).trim()
  if (!/^https?:\/\//i.test(s)) {
    if (/^[0-9A-Za-z_-]{6,}$/.test(s)) return s
    throw new CatbusError('USAGE', `无法识别的作品：${input}`, { hint: '传作品 ID 或链接，例如 https://www.kuaishou.com/short-video/<id>' })
  }
  const u = new URL(s)
  const fromQuery = u.searchParams.get('photoId') ?? u.searchParams.get('shareObjectId')
  if (fromQuery) return fromQuery
  const m = /\/(?:short-video|fw\/photo|photo|video)\/([^/?#]+)/.exec(u.pathname) ?? /^\/u\/[^/]+\/([^/?#]+)/.exec(u.pathname)
  if (m) return decodeURIComponent(m[1]!)
  const last = u.pathname.replace(/\/+$/, '').split('/').pop()
  if (last) return last
  throw new CatbusError('USAGE', `无法识别的作品：${input}`, { hint: '传作品 ID 或链接，例如 https://www.kuaishou.com/short-video/<id>' })
}

/** 当前登录用户的 eid（来自 profile/get，带缓存）。 */
export async function selfEid(ks: Ks): Promise<string> {
  if (ks.s.selfEid) return ks.s.selfEid
  const p = await api.profile(ks)
  ks.check(p, 'profile/get')
  if (!ks.s.selfEid) throw authError(ks.ctx, '没有取到当前账号的用户 ID，请重新登录')
  return ks.s.selfEid
}

/** 用户：eid、主页 URL（www.kuaishou.com/profile/<eid>）、分享短链或 `me`。直播间链接（live.kuaishou.com）报 USAGE。 */
export async function resolveUser(ks: Ks, input: string): Promise<string> {
  const s = (await expand(ks, input.trim())).trim()
  if (s === 'me') return selfEid(ks)
  if (/^https?:\/\//i.test(s)) {
    const url = new URL(s)
    // 直播间链接里的是直播用的主播 id（快手号），和主页的 eid 是两套，主页接口查不到
    if (url.hostname === 'live.kuaishou.com') {
      throw new CatbusError('USAGE', `这是直播间链接，不是用户主页：${input}`, {
        hint: '直播间里的主播 id 和主页 id 是两套，快手没有互查的接口；请传主页链接 https://www.kuaishou.com/profile/<id>',
      })
    }
    const m = /\/(?:profile|u)\/([^/?#]+)/.exec(url.pathname)
    if (m) return decodeURIComponent(m[1]!)
    throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 ID（如 3x...）或主页链接 https://www.kuaishou.com/profile/<id>' })
  }
  if (/^[0-9A-Za-z_-]+$/.test(s)) return s
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 ID（如 3x...）或主页链接 https://www.kuaishou.com/profile/<id>' })
}

/** 直播间：主播 eid 或 live.kuaishou.com/u/<eid>。 */
export async function resolveRoom(ks: Ks, input: string): Promise<string> {
  const s = (await expand(ks, input.trim())).trim()
  if (/^https?:\/\//i.test(s)) {
    const m = /\/(?:u|profile)\/([^/?#]+)/.exec(new URL(s).pathname)
    if (m) return decodeURIComponent(m[1]!)
  } else if (/^[0-9A-Za-z_-]+$/.test(s)) return s
  throw new CatbusError('USAGE', `无法识别的直播间：${input}`, { hint: '传主播 ID 或直播间链接 https://live.kuaishou.com/u/<id>' })
}
