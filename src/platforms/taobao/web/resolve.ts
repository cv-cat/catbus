import { CatbusError } from '../../../core/errors.js'
import type { Taobao } from './client.js'
import { plainId } from './im.js'

/** 参数归一化（AGENTS 4.8）：商品 ID、商品链接、分享短链、会话 ID。 */

const ITEM_HOST = /(^|\.)(taobao|tmall)\.com$/i
const SHORT_HOST = /(^|\.)tb\.cn$/i

const itemUrl = (id: string) => `https://item.taobao.com/item.htm?id=${id}`

/** 分享短链（m.tb.cn）：落地页用脚本跳转，从最终地址或页面里找商品 ID。 */
async function expand(tb: Taobao, url: string): Promise<string | null> {
  const res = await tb.http.request({ url, cookies: false, headers: [['user-agent', 'Mozilla/5.0']] })
  const text = `${res.url}\n${await res.text()}`
  const id = /(?:item\.taobao\.com|detail\.tmall\.com|detail\.m\.tmall\.com)[^"'\s]*?[?&]id=(\d+)/.exec(text)?.[1] ?? /[?&]id=(\d{6,})/.exec(text)?.[1]
  return id ? itemUrl(id) : null
}

/** 商品：纯数字 ID、淘宝 / 天猫商品链接或分享短链，返回要打开的商品页地址（链接原样使用，与上游一致）。 */
export async function resolveItem(tb: Taobao, input: string): Promise<string> {
  const s = input.trim()
  if (/^\d+$/.test(s)) return itemUrl(s)
  let url: URL | null = null
  try {
    url = /^https?:\/\//i.test(s) ? new URL(s) : null
  } catch {}
  if (url && ITEM_HOST.test(url.hostname)) return s
  if (url && SHORT_HOST.test(url.hostname)) {
    const expanded = await expand(tb, s)
    if (expanded) return expanded
  }
  throw new CatbusError('USAGE', `无法识别的商品：${input}`, { hint: '传商品 ID 或商品链接，例如 https://item.taobao.com/item.htm?id=<id>' })
}

/** 用户：淘宝没有按用户 ID 查询的接口，只能通过商品链接取卖家。 */
export async function resolveSellerItem(tb: Taobao, input: string): Promise<string> {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return resolveItem(tb, s)
  throw new CatbusError('USAGE', `淘宝只能通过商品链接查询卖家：${input}`, { hint: 'catbus taobao user get <商品链接>' })
}

/** 会话 ID：`<uid>.1-<uid>.1#11001`，可带 `@cntaobao` 后缀；返回会话 ID 和对方的用户 ID。 */
export function resolveConversation(input: string, myId: string): { cid: string; peer: string } {
  const cid = plainId(input.trim())
  const m = /^(\d+)\.\d+-(\d+)\.\d+#\d+$/.exec(cid)
  if (!m) throw new CatbusError('USAGE', `无法识别的会话 ID：${input}`, { hint: '会话 ID 形如 3888777108.1-2221755722770.1#11001，来自 msg listen 或 msg history 的 conversation_id' })
  const [, a, b] = m as unknown as [string, string, string]
  const peer = a === myId ? b : b === myId ? a : null
  if (!peer) throw new CatbusError('USAGE', `会话 ${cid} 不属于当前账号（${myId}）`)
  return { cid, peer }
}
