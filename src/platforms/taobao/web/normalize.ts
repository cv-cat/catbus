import * as n from '../../../core/normalize.js'
import type { Media, Message, User, UserRef } from '../../../core/schemas.js'
import type { Seller } from './api.js'
import { IM_DOMAIN } from './profile.js'
import { plainId } from './im.js'

/** 淘宝原始对象 → 归一化类型（AGENTS 6.2）。 */

/** 私信里的 sender_nick 带 `cntaobao` 前缀。 */
function nickOf(senderNick: unknown): string | null {
  const s = n.str(senderNick)
  return s == null ? null : s.startsWith(IM_DOMAIN) ? s.slice(IM_DOMAIN.length) || null : s
}

function ref(uid: unknown, senderNick: unknown): UserRef | null {
  return n.userRef({ id: plainId(uid) || null, name: nickOf(senderNick), url: null })
}

/** 自定义消息的 data：上游发送时是 base64 的 JSON；推送里可能已经是 JSON 字符串。 */
function customData(data: unknown): any {
  if (data == null || typeof data === 'object') return data ?? null
  const s = String(data)
  for (const text of [s, Buffer.from(s, 'base64').toString('utf8')]) {
    try {
      return JSON.parse(text)
    } catch {}
  }
  return null
}

type Body = Pick<Message, 'type' | 'text' | 'media'>

/** contentType 1 为文字，101 为自定义消息（type 7 是图片）。 */
function body(contentType: unknown, text: unknown, custom: { type?: unknown; data?: unknown; summary?: unknown } | null): Body {
  const type = Number(contentType)
  if (type === 1) return { type: 'text', text: n.str(text), media: [] }
  if (type === 101 && custom) {
    const data = customData(custom.data)
    const url = n.url(data?.url)
    if (url && (Number(custom.type) === 7 || data?.fileId != null)) {
      return {
        type: 'image',
        text: null,
        media: [n.media({ id: n.idOrNull(data.fileId), type: 'image', url, width: n.count(data.width), height: n.count(data.height) })],
      }
    }
    return { type: 'card', text: n.str(custom.summary) ?? (typeof data?.title === 'string' ? data.title : null), media: [] }
  }
  return { type: 'other', text: n.str(text), media: [] }
}

/** listUserMessages 返回的一条（userMessageModels[]）。 */
export function historyMessage(model: any, cid: string): Message {
  const m = model?.message ?? {}
  const content = m.content ?? {}
  const text = typeof content.text === 'string' ? content.text : (content.text?.content ?? content.text?.text)
  return n.message(
    {
      id: n.id(m.messageId ?? m.uuid),
      conversation_id: plainId(m.cid) || cid,
      from: ref(m.sender?.uid, m.extension?.sender_nick),
      ...body(content.contentType, text, content.custom ?? null),
      created_at: n.time(m.createAt),
    },
    model,
  )
}

/**
 * 推送里解码后的消息（上游 handle_message）：字段是编号，
 * 1.1.1 发送者、1.2 会话、1.3 消息 ID、1.5 时间、1.6 内容（1 类型、2.1 文字、3 自定义）、1.10.sender_nick 昵称。
 * 不是聊天消息的推送（会话状态、已读等）返回 null。
 */
export function pushMessage(decoded: any): Message | null {
  const m = decoded?.['1']
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const sender = m['1']?.['1']
  const cid = m['2']
  const c = m['6']
  if (typeof sender !== 'string' || typeof cid !== 'string' || !c || typeof c !== 'object') return null
  const custom = c['3'] && typeof c['3'] === 'object' ? { type: c['3']['4'], data: c['3']['5'], summary: c['3']['2'] } : null
  return n.message(
    {
      id: n.id(m['3']),
      conversation_id: plainId(cid),
      from: ref(sender, m['10']?.sender_nick),
      ...body(c['1'], c['2']?.['1'], custom),
      created_at: n.time(m['5']),
    },
    decoded,
  )
}

/** upload_media 返回的 object：pix 为 `宽x高`。 */
export function uploaded(obj: any): Media {
  const [w, h] = String(obj?.pix ?? '').split('x')
  return n.media({ id: n.idOrNull(obj?.fileId), type: 'image', url: n.url(obj?.url) ?? '', width: n.count(w), height: n.count(h) }, obj)
}

function jsonString(raw: string | undefined): string | null {
  if (raw == null) return null
  try {
    return n.str(JSON.parse(`"${raw}"`))
  } catch {
    return n.str(raw)
  }
}

/** 商品页里的卖家（上游 get_goods_uid_encrypt_uid）。昵称、店铺名、店铺链接能取到就带上。 */
export function seller(s: Seller, html: string): User {
  const nick = jsonString(/"sellerNick":"(.*?)"/.exec(html)?.[1])
  const shop = jsonString(/"shopName":"(.*?)"/.exec(html)?.[1])
  const shopUrl = n.url(jsonString(/"shopUrl":"(.*?)"/.exec(html)?.[1]))
  return n.user({ id: s.uid, name: shop ?? nick, handle: nick, url: shopUrl }, { ...s, seller_nick: nick, shop_name: shop, shop_url: shopUrl })
}
