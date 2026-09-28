import * as n from '../../../core/normalize.js'
import type { Comment, Conversation, Coupon, Item, Keyword, Message, Order, Price, User, UserRef } from '../../../core/schemas.js'
import { withRaw } from '../../../core/schemas.js'
import type { RawOrder } from './api.js'
import { stripTags } from './util.js'

/**
 * 京东原始对象 → 归一化类型（AGENTS 6.2）。
 * 上游对商品详情、评价、优惠券、咚咚等接口只返回原始 JSON，这里按字段名在对象里查找，缺失时为 null；原始对象用 --raw 取。
 */

export const itemUrl = (sku: unknown) => `https://item.jd.com/${sku}.html`
export const shopUrl = (shopId: unknown) => `https://mall.jd.com/index-${shopId}.html`

/** 京东图片：`jfs/t1/...` 这类相对路径补成 CDN 地址。 */
export function image(path: unknown): string | null {
  const s = n.str(path)
  if (!s) return null
  if (/^(https?:)?\/\//.test(s)) return n.url(s)
  return `https://img14.360buyimg.com/n1/${s.replace(/^\/+/, '')}`
}

/** 京东的时间字符串是北京时间（`2025-08-01 12:00:00`）。 */
export function time(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) {
    return n.time(v.trim().replace(' ', 'T') + (v.trim().length === 16 ? ':00' : '') + '+08:00')
  }
  return n.time(v)
}

/** 金额：`¥1,099.00`、`总额 ¥23.28`、数字。 */
export function money(v: unknown): Price | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return n.price(v)
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(String(v))
  return m ? n.price(m[0].replaceAll(',', '')) : null
}

/** 在对象里按键名找第一个非空值（广度优先，限深度）。 */
export function find(obj: unknown, keys: string[], depth = 5): any {
  let level: unknown[] = [obj]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: unknown[] = []
    for (const o of level) {
      if (!o || typeof o !== 'object') continue
      if (!Array.isArray(o)) {
        for (const k of keys) {
          const v = (o as Record<string, unknown>)[k]
          if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) return v
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') next.push(v)
    }
    level = next
  }
  return undefined
}

/** 找第一个"元素带某些键"的对象数组。 */
/** 按键名找数组（广度优先）；找不到返回 null。 */
export function findArrayByKey(obj: unknown, key: string, depth = 6): any[] | null {
  let level: unknown[] = [obj]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: unknown[] = []
    for (const o of level) {
      if (!o || typeof o !== 'object') continue
      const v = (o as Record<string, unknown>)[key]
      if (!Array.isArray(o) && Array.isArray(v)) return v
      for (const x of Object.values(o)) if (x && typeof x === 'object') next.push(x)
    }
    level = next
  }
  return null
}

export function findList(obj: unknown, keys: string[], depth = 6): any[] {
  let level: unknown[] = [obj]
  for (let d = 0; d <= depth && level.length; d++) {
    const next: unknown[] = []
    for (const o of level) {
      if (!o || typeof o !== 'object') continue
      if (Array.isArray(o) && o.some((e) => e && typeof e === 'object' && keys.some((k) => k in e))) return o
      for (const v of Object.values(o)) if (v && typeof v === 'object') next.push(v)
    }
    level = next
  }
  return []
}

export function shopRef(shopId: unknown, name: unknown): UserRef | null {
  const id = n.str(shopId)
  return id ? { id, name: n.str(name), url: shopUrl(id) } : name ? { id: String(name), name: String(name), url: null } : null
}

/** 搜索结果里的一件商品（wareList 的元素，字段同上游 search_wares）。 */
export function ware(w: any): Item {
  const id = n.id(w.wareId ?? w.skuId ?? w.sku)
  return n.item(
    {
      id,
      kind: 'goods',
      url: n.url(w.productUrl) ?? itemUrl(id),
      title: stripTags(w.wareName ?? w.shortName ?? w.skuName ?? w.name) || null,
      author: shopRef(w.shopId ?? w.venderId, w.shopName),
      cover: image(w.imageurl ?? w.imageUrl ?? w.imgUrl ?? w.image),
      stats: { comments: n.count(w.comment ?? w.commentCount) },
      price: money(w.jdPrice ?? w.finalPrice?.price ?? w.price),
    },
    w,
  )
}

/** 商品详情（pc_detailpage_wareBusiness）。 */
export function detail(sku: string, d: any): Item {
  const shop = find(d, ['shop']) ?? {}
  const images = findList(d, ['big', 'imgUrl', 'imageUrl', 'url']).map((x: any) => image(x.big ?? x.imgUrl ?? x.imageUrl ?? x.url)).filter(Boolean) as string[]
  return n.item(
    {
      id: sku,
      kind: 'goods',
      url: itemUrl(sku),
      title: n.str(find(d, ['wname', 'skuName', 'wareName', 'name'])) ,
      author: shopRef(shop.shopId ?? find(d, ['shopId']), shop.name ?? find(d, ['shopName'])),
      cover: images[0] ?? image(find(d, ['imageUrl', 'imgUrl', 'image'])),
      media: images.map((url, i) => n.media({ id: String(i + 1), type: 'image', url })),
      stats: { comments: n.count(find(d, ['commentCount', 'allCnt', 'commentNum'])) },
      price: money(d?.price?.p ?? find(d, ['p', 'jdPrice', 'finalPrice'])),
    },
    d,
  )
}

/** 商品评价（getLegoWareDetailComment）。 */
/**
 * 商品评价（getLegoWareDetailComment）。响应里同时有评价 `commentInfoList` 和问答 `questionList`，
 * 问答条目也有 `content`，按字段名去猜会拿成问答，所以先按键名取评价列表。
 */
export function comments(sku: string, d: any): Comment[] {
  const list = findArrayByKey(d, 'commentInfoList') ?? findList(d, ['commentData', 'commentId'])
  return list.map((c: any) =>
    n.comment(
      {
        id: n.id(c.commentId ?? c.id ?? c.guid),
        item_id: sku,
        author: n.userRef({ id: c.userNickName ?? c.nickName ?? c.nickname ?? c.userId, name: c.userNickName ?? c.nickName ?? c.nickname }),
        text: String(c.commentData ?? c.content ?? ''),
        created_at: time(c.commentDate ?? c.creationTime ?? c.date),
        stats: { likes: n.count(c.praiseCnt ?? c.usefulVoteCount ?? c.likeCount), replies: n.count(c.replyCnt ?? c.replyCount) },
      },
      c,
    ),
  )
}

/** 推荐优惠券（getRecommendCoupon）。 */
export function coupons(d: any): Coupon[] {
  return findList(d, ['discount', 'quota', 'couponId', 'batchId']).map((c: any) => {
    const quota = money(c.quota ?? c.threshold)
    return withRaw(
      {
        id: n.id(c.couponId ?? c.batchId ?? c.roleId ?? c.key ?? c.id),
        title: n.str(c.name ?? c.couponTitle ?? c.title ?? c.desc ?? c.limitStr),
        discount: money(c.discount ?? c.discountAmount ?? c.parValue),
        threshold: quota && quota.amount > 0 ? quota : null,
        start_at: time(c.beginTime ?? c.startTime),
        end_at: time(c.endTime),
      },
      c,
    )
  })
}

/** 浏览历史 / 关注商品里的一件商品。 */
export function listed(w: any): Item {
  const id = n.id(w.skuId ?? w.wareId ?? w.sku ?? w.productId)
  return n.item(
    {
      id,
      kind: 'goods',
      url: itemUrl(id),
      title: n.str(stripTags(w.wname ?? w.skuName ?? w.wareName ?? w.name ?? w.title)),
      author: shopRef(w.shopId ?? w.venderId, w.shopName),
      cover: image(w.imgUrl ?? w.imageUrl ?? w.image ?? w.img),
      price: money(w.jdPrice ?? w.price ?? w.p),
    },
    w,
  )
}

export function listedItems(d: any): Item[] {
  return findList(d, ['skuId', 'wareId', 'productId']).map(listed)
}

/** 订单（订单中心 HTML）。skus 是同一订单里商品链接的 SKU，按出现顺序。 */
export function order(o: RawOrder, skus: string[] = []): Order {
  return withRaw(
    {
      id: o.orderId,
      status: o.status || null,
      total: money(o.amount),
      items: o.products.map((title, i) => n.item({ id: skus[i] ?? '', kind: 'goods', url: skus[i] ? itemUrl(skus[i]) : null, title })),
      created_at: time(o.time),
    },
    o,
  )
}

/** 订单 HTML 里每个订单的商品 SKU（按商品名链接的顺序）。 */
export function orderSkus(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const m of html.matchAll(/<tbody id="tb-(\d+)"[^>]*>([\s\S]*?)<\/tbody>/g)) {
    const skus = [...m[2]!.matchAll(/class="p-name"[^>]*>\s*<a[^>]*href="[^"]*item\.jd\.com\/(\d+)\.html/g)].map((x) => x[1]!)
    out.set(m[1]!, skus)
  }
  return out
}

export function keywordsFromHot(d: any): Keyword[] {
  return (Array.isArray(d?.data) ? d.data : [])
    .map((x: any) => n.str(x.n ?? x.ext_columns?.text ?? x.keyword))
    .filter(Boolean)
    .map((text: string, i: number) => n.keyword({ text }, d.data[i]))
}

export function keywordsFromRel(d: any): Keyword[] {
  const list = Array.isArray(d?.data) ? d.data : Array.isArray(d?.resultKeywords) ? d.resultKeywords : []
  return list.filter((x: any) => x?.keyword).map((x: any) => n.keyword({ text: String(x.keyword) }, x))
}

/** 当前账号（passport loginservice）。 */
export function me(pin: string, data: any): User {
  const id = data?.Identity?.Name || pin
  return n.user({ id: String(pin || id), name: n.str(data?.Identity?.Unick || data?.Identity?.Name), handle: pin || null, url: 'https://home.jd.com/' }, data)
}

export const meRef = (pin: string, name: string | null): UserRef => ({ id: pin, name: name || pin, url: 'https://home.jd.com/' })

// ---------------------------------------------------------------- 咚咚

export function conversations(d: any): Conversation[] {
  return findList(d, ['venderId']).map((s: any) => {
    const last = s.lastMsg ?? s.lastMessage ?? s.msg ?? {}
    return n.conversation(
      {
        id: n.id(s.venderId),
        peer: { id: n.id(s.venderId), name: n.str(s.venderName ?? s.shopName ?? s.name), url: s.shopId ? shopUrl(s.shopId) : null },
        unread: n.count(s.unreadCount ?? s.unread ?? s.unReadNum),
        last_message: n.str(typeof last === 'string' ? last : (last.content ?? last.body?.content)),
        updated_at: time(s.timestamp ?? s.lastTime ?? last.timestamp ?? last.datetime),
      },
      s,
    )
  })
}

/** 咚咚消息正文里尽量抽出可读文本（JdChatWS.extract_text）。 */
export function extractText(body: any): string | null {
  if (!body || typeof body !== 'object') return null
  if (typeof body.content === 'string' && body.content.trim()) return body.content
  const data = body.data && typeof body.data === 'object' ? body.data : {}
  const tpl = data.tplData
  for (const holder of [tpl, data, body]) {
    if (!holder || typeof holder !== 'object') continue
    for (const key of ['message', 'title', 'text', 'content', 'answer', 'desc']) {
      const v = holder[key]
      if (typeof v === 'string' && v.trim()) return v
    }
  }
  return null
}

const MSG_TYPES: Record<string, Message['type']> = { text: 'text', image: 'image', img: 'image', video: 'video', template2: 'card', card: 'card' }

const userOf = (pin: unknown): UserRef | null => (pin ? { id: String(pin), name: String(pin), url: null } : null)

/**
 * WS 下行帧 → msg listen 输出的消息（JdChatWS._handle 的分支）：
 * - chat_message / event_message：有可读文本或图片时输出；
 * - sys_msg（系统消息）、revoke_message（撤回）、chat_session_open / chat_session_close（会话建立 / 结束）：type 为 other，
 *   text 是上游日志里的那段说明，撤回时带上被撤回的消息 id；
 * - 心跳、回执、失败等协议帧：不输出（返回 null）。
 */
export function chatEvent(p: any): Message | null {
  if (!p || typeof p !== 'object') return null
  const body = p.body && typeof p.body === 'object' ? p.body : {}
  const vender = String(body.chatinfo?.venderId ?? body.venderId ?? '')
  const other = (text: string | null, from: UserRef | null = null) => n.message({ id: n.id(p.id), conversation_id: vender, from, type: 'other', text, created_at: time(p.timestamp ?? p.datetime) }, p)
  switch (p.type) {
    case 'chat_message':
    case 'event_message': {
      const m = message(p, vender)
      return m.text || m.media.length ? m : null
    }
    case 'sys_msg':
      return other(extractText(body))
    case 'revoke_message': {
      const text = n.str(body.revokeContentToC) ?? '对方撤回了一条消息'
      const revoked = n.str(body.revokeMsgId ?? body.msgId ?? body.mid ?? body.id)
      return other(revoked ? `${text}（被撤回的消息：${revoked}）` : text, userOf(p.from?.pin))
    }
    case 'chat_session_open': {
      const waiter = n.str(body.waiter?.pin)
      return other(`会话建立：商家 ${vender || '-'}，客服 ${waiter ?? '-'}`, userOf(waiter))
    }
    case 'chat_session_close':
      return other('会话结束')
    default:
      return null
  }
}

/** 一条咚咚消息（WS 下行帧或 queryLastLogs 的元素）。 */
export function message(p: any, venderId: string): Message {
  const body = p.body ?? {}
  const from = p.from ?? {}
  const kind = String(body.type ?? '')
  const url = kind === 'image' ? n.url(body.url ?? body.content) : null
  return n.message(
    {
      id: n.id(p.id ?? p.mid ?? p.msgId),
      conversation_id: n.id(body.chatinfo?.venderId ?? p.venderId ?? venderId),
      from: from.pin ? { id: String(from.pin), name: n.str(from.nickname ?? from.pin), url: null } : null,
      type: MSG_TYPES[kind] ?? (extractText(body) ? 'text' : 'other'),
      text: extractText(body),
      media: url ? [n.media({ type: 'image', url })] : [],
      created_at: time(p.timestamp ?? p.datetime ?? p.time),
    },
    p,
  )
}
