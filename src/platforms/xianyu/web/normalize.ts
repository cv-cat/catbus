import * as n from '../../../core/normalize.js'
import { jsonLoads } from '../../../core/py.js'
import type { Item, ItemStatus, Media, Message, User, UserRef } from '../../../core/schemas.js'
import { plainId } from './im.js'
import { itemUrl, userUrl } from './profile.js'

/** 闲鱼原始对象 → 归一化类型（AGENTS 6.2）。 */

function ref(id: unknown, name: unknown): UserRef | null {
  const s = plainId(id)
  return n.userRef({ id: s || null, name, url: s ? userUrl(s) : null })
}

/** 商品状态：itemStatus 0 在售，1 已售出，其余下架。 */
function status(v: any): ItemStatus | null {
  const s = v?.itemStatus
  if (s == null) return null
  return Number(s) === 0 ? 'on_sale' : Number(s) === 1 ? 'sold' : 'off_shelf'
}

/** 商品详情（mtop.taobao.idle.pc.detail 的 data：itemDO + sellerDO）。 */
export function item(d: any, myId = ''): Item {
  const it = d?.itemDO ?? {}
  const seller = d?.sellerDO ?? {}
  const id = n.id(it.itemId ?? it.id)
  const media: Media[] = (it.imageInfos ?? []).map((img: any) =>
    n.media({ type: 'image', url: n.url(img.url) ?? '', width: n.count(img.widthSize), height: n.count(img.heightSize) }, img),
  )
  const title = n.str(it.title)
  const text = n.str(it.desc)
  const video = it.videoPlayInfo?.videoUrl ?? it.videoUrl
  if (video) media.unshift(n.media({ type: 'video', url: n.url(video)! }))
  return n.item(
    {
      id,
      kind: 'goods',
      url: itemUrl(id),
      title: title ?? text,
      text,
      author: ref(seller.sellerId ?? it.sellerId, seller.nick ?? seller.uniqueName),
      created_at: n.time(it.gmtCreate),
      cover: media.find((m) => m.type === 'image')?.url ?? null,
      media,
      stats: { views: n.count(it.browseCnt), collects: n.count(it.wantCnt ?? it.collectCnt), comments: null },
      price: n.price(it.soldPrice ?? it.defaultPrice),
      // 只有自己的商品才带状态
      status: myId && String(seller.sellerId ?? it.sellerId) === myId ? status(it) : null,
    },
    d,
  )
}

/** 当前登录用户（loginuser.get 的 data，缺的字段用 cookie 补）。 */
export function me(d: any, fallback: UserRef): User {
  const id = n.id(d?.userId ?? d?.userID ?? d?.uid ?? fallback.id)
  return n.user(
    {
      id,
      name: n.str(d?.nick ?? d?.displayName ?? d?.userNick) ?? fallback.name,
      avatar: n.url(d?.avatar ?? d?.portraitUrl ?? d?.headPic),
      url: userUrl(id),
    },
    d,
  )
}

/** custom.data：上游发送时是 base64 的 JSON；推送里是 JSON 字符串。 */
function customData(data: unknown): any {
  if (data == null || typeof data === 'object') return data ?? null
  const s = String(data)
  for (const text of [s, Buffer.from(s, 'base64').toString('utf8')]) {
    try {
      return jsonLoads(text)
    } catch {}
  }
  return null
}

type Body = Pick<Message, 'type' | 'text' | 'media'>

/** 消息内容：contentType 1 文字、2 图片，其余（交易卡片等）按卡片处理，文字取摘要。 */
function body(payload: any, summary: unknown): Body {
  const type = Number(payload?.contentType)
  if (type === 1) return { type: 'text', text: n.str(payload.text?.text) ?? n.str(summary), media: [] }
  if (type === 2) {
    const pics: any[] = payload.image?.pics ?? []
    return {
      type: 'image',
      text: null,
      media: pics.map((p) => n.media({ type: 'image', url: n.url(p.url) ?? '', width: n.count(p.width), height: n.count(p.height) })),
    }
  }
  if (payload == null) return { type: 'other', text: n.str(summary), media: [] }
  return { type: 'card', text: n.str(summary) ?? n.str(payload?.dxCard?.item?.main?.exContent?.title), media: [] }
}

/** listUserMessages 返回的一条（userMessageModels[]）。 */
export function historyMessage(model: any, cid: string): Message {
  const m = model?.message ?? {}
  const ext = m.extension ?? {}
  const payload = customData(m.content?.custom?.data)
  return n.message(
    {
      id: n.id(m.messageId ?? m.uuid),
      conversation_id: plainId(m.cid) || cid,
      from: ref(ext.senderUserId ?? m.sender?.uid, ext.reminderTitle),
      ...body(payload, ext.reminderContent ?? m.content?.custom?.summary),
      created_at: n.time(m.createAt),
    },
    model,
  )
}

/**
 * 推送里解码后的消息（上游 handle_message）：字段是编号，
 * 1.2 会话、1.3 消息 ID、1.5 时间、1.6.3.5 内容（JSON）、1.10 扩展（reminderTitle 昵称、senderUserId、reminderContent 摘要）。
 * 不是聊天消息的推送（会话状态、已读、正在输入等）返回 null。
 */
export function pushMessage(decoded: any): Message | null {
  const m = decoded?.['1']
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null
  const ext = m['10']
  const cid = m['2']
  if (!ext || typeof ext !== 'object' || ext.senderUserId == null || typeof cid !== 'string') return null
  const custom = m['6']?.['3']
  return n.message(
    {
      id: n.id(m['3']),
      conversation_id: plainId(cid),
      from: ref(ext.senderUserId, ext.reminderTitle),
      ...body(customData(custom?.['5']), ext.reminderContent ?? custom?.['2']),
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
