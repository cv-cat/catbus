import type { Envelope } from '../types'
import { AUTHORS, TITLES, hash } from './shared'

export function mockLive(platform: string, room: string): Envelope<import('../types').Live> {
  const n = hash(`live:${platform}:${room}`)
  const host = AUTHORS[n % AUTHORS.length]!
  return {
    ok: true,
    data: {
      id: room,
      url: null,
      title: `${host}的直播间 · ${TITLES[n % TITLES.length]}`,
      status: n % 7 === 0 ? 'offline' : 'live',
      host: { id: `u${n}`, name: host, url: null, avatar: null },
      cover: null,
      stats: { viewers: 800 + (n % 40000) },
    },
    page: null,
    error: null,
  }
}

const LIVE_CHATS = ['主播好', '来了来了', '今天去哪露营', '这个灯好看', '求链接', '哈哈哈[捂脸]', '晚上好', '声音有点小', '画面好清楚[舔屏]', '关注了[比心]']
const LIVE_GIFTS = ['小心心', '玫瑰', '啤酒', '火箭', '棒棒糖']
/** 观众昵称：同一个 id 总是同一个昵称 */
const LIVE_VIEWERS = [...AUTHORS, '小熊不吃辣', '夏天的风', '一颗柠檬', '路过的猫', '晚安星球', '周末探店', '爱吃饭团', 'Kiko', '阿树', 'momo', '慢慢走', '山顶见']
let liveSeq = 0
/** 一条演示事件：大多是聊天，夹着礼物、进场、点赞、关注 */
let liveViewers = 12480
let liveLikes = 386520
export function mockLiveEvent(): import('../types').LiveEvent {
  const k = liveSeq++
  const r = (k * 2654435761) % 100
  const v = (k * 7) % LIVE_VIEWERS.length
  const user = { id: `v${v}`, name: LIVE_VIEWERS[v]!, url: null, avatar: null }
  const time = new Date().toISOString()
  // 直播间实时数据：在线人数上下浮动，累计点赞只增不减
  if (k % 7 === 3) {
    liveViewers = Math.max(800, liveViewers + Math.round((Math.random() - 0.45) * 160))
    return { type: 'other', time, user: null, text: `${liveViewers}在线观众`, gift: null, stats: { viewers: liveViewers, likes: null } }
  }
  if (r < 28 && r >= 22) {
    liveLikes += 1 + Math.floor(Math.random() * 30)
    return { type: 'like', time, user, text: null, gift: null, stats: { viewers: null, likes: liveLikes } }
  }
  if (r < 8) return { type: 'gift', time, user, text: null, gift: { name: LIVE_GIFTS[k % LIVE_GIFTS.length]!, count: 1 + (k % 5) } }
  if (r < 22) return { type: 'enter', time, user, text: null, gift: null }
  if (r < 31) return { type: 'follow', time, user, text: null, gift: null }
  return { type: 'chat', time, user, text: LIVE_CHATS[k % LIVE_CHATS.length]!, gift: null }
}

// ---------- 发现直播间与直播间标签（AGENTS.md 7.9「直播弹幕」），能力与注册表一致 ----------
type LiveCaps = { list: boolean; search: boolean; categories: boolean; gifts: boolean; rank: boolean; products: boolean; replays: boolean; history: boolean }
const caps = (o: Partial<LiveCaps>): LiveCaps => ({ list: false, search: false, categories: false, gifts: false, rank: false, products: false, replays: false, history: false, ...o })
export const MOCK_LIVE_CAPS: Record<string, LiveCaps> = {
  xhs: caps({ list: true, categories: true, gifts: true, products: true }),
  douyin: caps({ list: true, search: true, categories: true, rank: true, products: true, history: true }),
  tiktok: caps({ list: true, search: true, rank: true, gifts: true, history: true }),
  bilibili: caps({ list: true, search: true, categories: true, gifts: true, history: true }),
  kuaishou: caps({ list: true, gifts: true, replays: true }),
  youtube: caps({ search: true, history: true }),
}

const LIVE_CATEGORIES = ['户外', '美食', '穿搭', '游戏', '音乐', '好物', '旅行', '学习'] // i18n-ignore 演示数据
const ok = <T>(data: T, page: Envelope<T>['page'] = null): Envelope<T> => ({ ok: true, data, page, error: null })

export function mockLiveCategories(platform: string): Envelope<import('../types').Category[]> {
  return ok(LIVE_CATEGORIES.map((name, i) => ({ id: `${platform}_cat_${i + 1}`, name, parent_id: null })))
}

/** 推荐列表或搜索结果：关键词里有「没有」时返回空列表（演示空态） */
export function mockLives(platform: string, query: string, page: number, limit = 20): Envelope<import('../types').Live[]> {
  if (query.includes('没有')) return ok([], { cursor: null, has_more: false }) // i18n-ignore 演示数据
  const seed = hash(`lives:${platform}:${query}`)
  const data = Array.from({ length: limit }, (_, i) => {
    const n = seed + page * limit + i
    const host = AUTHORS[n % AUTHORS.length]!
    const id = `${platform}-room-${(n % 1e7).toString(36)}`
    return {
      id,
      url: `https://example.com/${platform}/live/${id}`,
      title: `${query && !query.startsWith('cat:') ? `${query} · ` : ''}${TITLES[n % TITLES.length]}`,
      status: (n % 11 === 5 ? 'offline' : 'live') as 'live' | 'offline',
      host: { id: `u${n % 997}`, name: host, url: `https://example.com/${platform}/user/u${n % 997}`, avatar: null },
      cover: `https://picsum.photos/seed/${id}/640/360`,
      stats: { viewers: n % 11 === 5 ? null : 120 + ((n * 7919) % 86000) },
    }
  })
  return ok(data, { cursor: String(page + 1), has_more: page < 2 })
}

const GIFT_NAMES = ['小心心', '玫瑰', '啤酒', '棒棒糖', '墨镜', '跑车', '火箭', '嘉年华'] // i18n-ignore 演示数据
const GIFT_PRICES = [1, 1, 2, 9, 99, 1200, 3000, 30000]
const CURRENCY: Record<string, string> = { douyin: 'DOU', tiktok: 'COIN', bilibili: 'BCOIN', kuaishou: 'KSCOIN', xhs: 'XHSCOIN' }

export function mockLiveGifts(platform: string): Envelope<import('../types').Gift[]> {
  return ok(GIFT_NAMES.map((name, i) => ({ id: `g${i + 1}`, name, price: { amount: GIFT_PRICES[i]!, currency: CURRENCY[platform] ?? 'COIN' } })))
}

export function mockLiveRank(platform: string, room: string): Envelope<import('../types').Rank[]> {
  const n = hash(`rank:${platform}:${room}`)
  return ok(
    Array.from({ length: 15 }, (_, i) => ({
      rank: i + 1,
      user: { id: `v${(n + i) % 50}`, name: LIVE_VIEWERS[(n + i) % LIVE_VIEWERS.length]!, url: null, avatar: null },
      score: Math.round(98000 / (i + 1) + (n % 500)),
    })),
  )
}

/** 进入直播间前的最近弹幕 */
export function mockLiveHistory(platform: string, room: string): Envelope<import('../types').LiveEvent[]> {
  const n = hash(`history:${platform}:${room}`)
  const now = Date.now()
  return ok(
    Array.from({ length: 12 }, (_, i) => {
      const v = (n + i * 3) % LIVE_VIEWERS.length
      return {
        type: 'chat' as const,
        time: new Date(now - (12 - i) * 9000).toISOString(),
        user: { id: `v${v}`, name: LIVE_VIEWERS[v]!, url: null, avatar: null },
        text: LIVE_CHATS[(n + i) % LIVE_CHATS.length]!,
        gift: null,
      }
    }),
  )
}

const PRODUCT_NAMES = ['轻量折叠露营椅', '铝合金蛋卷桌', '便携卡式炉', '防风营地灯', '速干冲锋衣', '保温咖啡杯'] // i18n-ignore 演示数据

function demoItem(platform: string, id: string, kind: 'goods' | 'video', title: string, n: number): import('../types').Item {
  return {
    id,
    kind,
    url: `https://example.com/${platform}/${kind}/${id}`,
    title,
    text: null,
    author: null,
    created_at: kind === 'video' ? new Date(Date.now() - (n % 20 + 1) * 864e5).toISOString() : null,
    cover: `https://picsum.photos/seed/${id}/400/${kind === 'video' ? 225 : 400}`,
    media: kind === 'video' ? [{ id: null, type: 'video', url: null, width: 1280, height: 720, duration: 1800 + (n % 7200) }] : [],
    stats: { views: kind === 'video' ? 800 + (n % 90000) : null, likes: null, comments: null, collects: null, shares: null },
    price: kind === 'goods' ? { amount: 39 + (n % 400) + 0.9, currency: 'CNY' } : null,
    status: null,
  }
}

export function mockLiveProducts(platform: string, room: string): Envelope<import('../types').Item[]> {
  const n = hash(`products:${platform}:${room}`)
  // 大约四个直播间里有一个没有带货（演示空态）
  if (n % 4 === 1) return ok([])
  return ok(PRODUCT_NAMES.map((name, i) => demoItem(platform, `${platform}-p-${(n + i) % 1e6}`, 'goods', name, n + i * 37)))
}

export function mockLiveReplays(platform: string, user: string, page: number, limit = 20): Envelope<import('../types').Item[]> {
  const n = hash(`replays:${platform}:${user}`)
  const count = Math.min(limit, 8)
  return ok(
    Array.from({ length: count }, (_, i) => demoItem(platform, `${platform}-r-${(n + page * count + i) % 1e6}`, 'video', `${TITLES[(n + i) % TITLES.length]}（回放）`, n + i * 53)), // i18n-ignore 演示数据
    { cursor: String(page + 1), has_more: page < 1 },
  )
}
