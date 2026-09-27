import { CatbusError } from '../../../core/errors.js'
import * as api from './api.js'
import type { Weibo } from './client.js'
import { bidToMid } from './sign.js'

/** 参数归一化（AGENTS 4.8）：数字 mid、9 位 mblogid、各种微博链接、`me`。 */

export interface ItemRef {
  mid: string
  /** 作者 uid，链接里带了才有。 */
  uid: string | null
}

const toMid = (token: string) => (/^\d+$/.test(token) ? token : bidToMid(token))

/**
 * 微博：mid（16 位数字）、mblogid（如 OuIv3hbiw），或链接
 * weibo.com/<uid>/<mblogid|mid>、weibo.com/detail/<mid>、m.weibo.cn/detail|status/<mid|mblogid>、m.weibo.cn/<uid>/<mid>。
 */
export function resolveItem(input: string): ItemRef {
  const s = input.trim()
  if (/^\d+$/.test(s) || /^[0-9A-Za-z]{8,10}$/.test(s)) return { mid: toMid(s), uid: null }
  let url: URL | null = null
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {}
  if (url && /(^|\.)weibo\.(com|cn)$/.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && /^(detail|status)$/.test(parts[0]!) && /^[0-9A-Za-z]+$/.test(parts[1]!)) return { mid: toMid(parts[1]!), uid: null }
    if (parts.length >= 2 && /^\d+$/.test(parts[0]!) && /^[0-9A-Za-z]+$/.test(parts[1]!)) return { mid: toMid(parts[1]!), uid: parts[0]! }
    const q = url.searchParams.get('id') ?? url.searchParams.get('mid')
    if (q && /^[0-9A-Za-z]+$/.test(q)) return { mid: toMid(q), uid: null }
  }
  throw new CatbusError('USAGE', `无法识别的微博：${input}`, { hint: '传 mid、mblogid 或微博链接，例如 https://weibo.com/<uid>/<mblogid>' })
}

/** 用户：uid、主页链接（weibo.com/u/<uid>、weibo.com/<uid>、m.weibo.cn/u|profile/<uid>）或 `me`。 */
export async function resolveUser(w: Weibo, input: string): Promise<string> {
  const s = input.trim()
  if (s === 'me') {
    const saved = w.ctx.credential.user?.id
    if (saved) return saved
    const self = await api.selfInfo(w)
    if (!self) throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: 'catbus weibo auth login' })
    return self.uid
  }
  if (/^\d+$/.test(s)) return s
  let url: URL | null = null
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {}
  if (url && /(^|\.)weibo\.(com|cn)$/.test(url.hostname)) {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && /^(u|profile)$/.test(parts[0]!) && /^\d+$/.test(parts[1]!)) return parts[1]!
    if (parts.length >= 1 && /^\d+$/.test(parts[0]!)) return parts[0]!
    const uid = url.searchParams.get('uid')
    if (uid && /^\d+$/.test(uid)) return uid
  }
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 uid（数字）或主页链接 https://weibo.com/u/<uid>' })
}
