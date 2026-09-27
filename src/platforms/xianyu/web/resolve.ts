import { CatbusError } from '../../../core/errors.js'
import type { Xianyu } from './client.js'

/** 参数归一化（AGENTS 4.8）：商品 ID、商品链接、分享短链、分享口令文本；会话 ID。 */

const URL_RE = /https?:\/\/[^\s"'<>，。「」【】]+/
const ID_PARAM_RE = /[?&#](?:id|itemId|item_id)=(\d+)/

function idFrom(s: string): string | undefined {
  return ID_PARAM_RE.exec(s)?.[1]
}

/** 分享短链（m.tb.cn 等）：跟一次跳转取 Location；没有跳转时从页面里找商品 ID。 */
async function expand(x: Xianyu, url: string): Promise<string | undefined> {
  const res = await x.http.request({ url, redirect: 'manual', cookies: false, headers: [['user-agent', 'Mozilla/5.0']] })
  const location = res.headers.get('location')
  if (location) return idFrom(location) ?? (location !== url && /^https?:/.test(location) ? expand(x, location) : undefined)
  const body = await res.text()
  return idFrom(body.replaceAll('&amp;', '&')) ?? /["']itemId["']\s*[:=]\s*["']?(\d+)/.exec(body)?.[1]
}

/** 闲置商品：纯数字 ID、商品页 URL（`?id=`）、分享短链，或整段分享文本。 */
export async function resolveItem(x: Xianyu, input: string): Promise<string> {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  const url = URL_RE.exec(s)?.[0]
  const id = url ? (idFrom(url) ?? (await expand(x, url))) : undefined
  if (id) return id
  throw new CatbusError('USAGE', `无法识别的闲鱼商品：${input}`, { hint: '传商品 ID、商品链接 https://www.goofish.com/item?id=<id>，或分享链接' })
}

/** 会话 ID：纯数字，或带 `@goofish` 后缀。 */
export function resolveConversation(input: string): string {
  const m = /^(\d+)(?:@goofish)?$/.exec(input.trim())
  if (m) return m[1]!
  throw new CatbusError('USAGE', `无法识别的会话 ID：${input}`, { hint: '会话 ID 是数字，来自 msg listen / msg send 输出的 conversation_id' })
}
