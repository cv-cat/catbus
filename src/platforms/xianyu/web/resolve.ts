import { CatbusError } from '../../../core/errors.js'
import type { Xianyu } from './client.js'

/** 参数归一化（AGENTS 4.8）：商品 ID、商品链接、分享短链、分享口令文本；用户 ID、主页链接；会话 ID。 */

const URL_RE = /https?:\/\/[^\s"'<>，。「」【】]+/
const ID_PARAM_RE = /[?&#](?:id|itemId|item_id)=(\d+)/
const USER_PARAM_RE = /[?&#](?:userId|userid|user_id)=(\d+)/

type Pick = (s: string) => string | undefined

const itemFrom: Pick = (s) => ID_PARAM_RE.exec(s)?.[1]
const userFrom: Pick = (s) => USER_PARAM_RE.exec(s)?.[1]

/** 分享短链（m.tb.cn 等）：跟一次跳转取 Location；没有跳转时从页面里找。 */
async function expand(x: Xianyu, url: string, pick: Pick, fromPage: Pick = pick): Promise<string | undefined> {
  const res = await x.http.request({ url, redirect: 'manual', cookies: false, headers: [['user-agent', 'Mozilla/5.0']] })
  const location = res.headers.get('location')
  if (location) return pick(location) ?? (location !== url && /^https?:/.test(location) ? expand(x, location, pick, fromPage) : undefined)
  return fromPage((await res.text()).replaceAll('&amp;', '&'))
}

/** 闲置商品：纯数字 ID、商品页 URL（`?id=`）、分享短链，或整段分享文本。 */
export async function resolveItem(x: Xianyu, input: string): Promise<string> {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  const url = URL_RE.exec(s)?.[0]
  const fromPage: Pick = (body) => itemFrom(body) ?? /["']itemId["']\s*[:=]\s*["']?(\d+)/.exec(body)?.[1]
  const id = url ? (itemFrom(url) ?? (await expand(x, url, itemFrom, fromPage))) : undefined
  if (id) return id
  throw new CatbusError('USAGE', `无法识别的闲鱼商品：${input}`, { hint: '传商品 ID、商品链接 https://www.goofish.com/item?id=<id>，或分享链接' })
}

/** 用户：`me`、纯数字 ID（可带 `@goofish`）、主页链接（`personal?userId=`）、分享短链，或整段分享文本。 */
export async function resolveUser(x: Xianyu, input: string): Promise<string> {
  const s = input.trim()
  if (s === 'me') return x.myId
  const m = /^(\d+)(?:@goofish)?$/.exec(s)
  if (m) return m[1]!
  const url = URL_RE.exec(s)?.[0]
  const id = url ? (userFrom(url) ?? (await expand(x, url, userFrom))) : undefined
  if (id) return id
  throw new CatbusError('USAGE', `无法识别的闲鱼用户：${input}`, { hint: '传用户 ID，或主页链接 https://www.goofish.com/personal?userId=<id>' })
}

/** 会话 ID：纯数字，或带 `@goofish` 后缀。 */
export function resolveConversation(input: string): string {
  const m = /^(\d+)(?:@goofish)?$/.exec(input.trim())
  if (m) return m[1]!
  throw new CatbusError('USAGE', `无法识别的会话 ID：${input}`, { hint: '会话 ID 是数字，来自 msg listen / msg send 输出的 conversation_id' })
}
