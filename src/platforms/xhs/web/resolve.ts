import { CatbusError } from '../../../core/errors.js'
import type { Pc } from './client.js'

/**
 * 参数归一化（AGENTS 4.8）：笔记 / 用户 / 直播间的 ID、URL、分享短链（xhslink.com）、`me`。
 * 小红书取详情需要 xsec_token，只能从 URL 里带进来（上游 get_note_info(url) 同样从 URL 解析）。
 */

const SHORT_RE = /^https?:\/\/(xhslink\.com|xhs\.link)\//i
const ID_RE = /^[0-9a-f]{24}$/i

/** 分享短链跟一次跳转，取 Location。 */
async function expand(p: Pc, input: string): Promise<string> {
  const s = input.trim()
  if (!SHORT_RE.test(s)) return s
  const res = await p.http.request({ url: s, redirect: 'manual', cookies: false })
  return res.headers.get('location') ?? s
}

function query(u: URL): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of u.searchParams) out[k] = v
  return out
}

export interface NoteRef {
  id: string
  token: string
  source: string
}

/** 笔记：24 位 ID，或 /explore/<id>、/discovery/item/<id>、/user/profile/<uid>/<id> 的链接（带 xsec_token）。 */
export async function resolveNote(p: Pc, input: string): Promise<NoteRef> {
  const s = await expand(p, input)
  if (ID_RE.test(s)) return { id: s, token: '', source: 'pc_feed' }
  try {
    const u = new URL(s)
    const id = u.pathname.split('/').filter(Boolean).at(-1) ?? ''
    if (ID_RE.test(id)) {
      const q = query(u)
      return { id, token: q.xsec_token ?? '', source: q.xsec_source || 'pc_search' }
    }
  } catch {}
  throw new CatbusError('USAGE', `无法识别的笔记：${input}`, { hint: '传带 xsec_token 的笔记链接，例如 https://www.xiaohongshu.com/explore/<id>?xsec_token=...' })
}

export interface UserRefInput {
  id: string
  token: string
  source: string
}

/** 用户：24 位 ID、主页链接 /user/profile/<id>?xsec_token=...，或 `me`。 */
export async function resolveUser(p: Pc, input: string): Promise<UserRefInput> {
  const s = await expand(p, input)
  if (s === 'me') {
    const id = p.credential.user?.id
    if (!id) throw new CatbusError('AUTH_REQUIRED', 'me 表示当前账号，需要先登录', { hint: 'catbus xhs auth login' })
    return { id, token: '', source: '' }
  }
  if (ID_RE.test(s)) return { id: s, token: '', source: '' }
  try {
    const u = new URL(s)
    const m = /\/user\/profile\/([0-9a-f]{24})/i.exec(u.pathname)
    if (m) {
      const q = query(u)
      return { id: m[1]!, token: q.xsec_token ?? '', source: q.xsec_source ?? '' }
    }
  } catch {}
  throw new CatbusError('USAGE', `无法识别的用户：${input}`, { hint: '传用户 ID（24 位十六进制）或主页链接 https://www.xiaohongshu.com/user/profile/<id>' })
}

/** 直播间：房间号（数字）或直播间链接 /livestream/<room_id>。 */
export async function resolveRoom(p: Pc, input: string): Promise<string> {
  const s = await expand(p, input)
  if (/^\d+$/.test(s)) return s
  const m = /\/livestream\/(?:[^/?]+\/)?(\d+)/.exec(s) ?? /[?&]room_id=(\d+)/.exec(s)
  if (m) return m[1]!
  throw new CatbusError('USAGE', `无法识别的直播间：${input}`, { hint: '传房间号或直播间链接' })
}
