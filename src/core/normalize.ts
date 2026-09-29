import { isoNow } from './fsutil.js'
import { now } from './rand.js'
import type {
  Category,
  Comment,
  Conversation,
  Event,
  File,
  Folder,
  Gift,
  Item,
  Keyword,
  Live,
  Media,
  Message,
  Notice,
  NoticeCount,
  Poi,
  Price,
  Rank,
  Topic,
  User,
  UserRef,
} from './schemas.js'
import { withRaw } from './schemas.js'

/**
 * 归一化工具（AGENTS 6.2）：计数、时间、ID 的转换，以及各类型的构造函数。
 * 构造函数补齐缺省字段（null / []），保证"字段总是存在"；传入 raw 时挂上原始对象供 `--raw` 使用。
 */

const UNITS: Record<string, number> = { 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8, k: 1e3, K: 1e3, m: 1e6, M: 1e6, 千: 1e3 }

/** 计数转整数：`1.2万` → 12000，`10w+` → 100000，`1,234` → 1234。无法识别时为 null。 */
export function count(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null
  if (typeof value === 'bigint') return Number(value)
  const m = /^\s*([\d.,]+)\s*([万wW亿kKmM千]?)\+?\s*$/.exec(String(value))
  if (!m) return null
  const n = Number(m[1]!.replaceAll(',', ''))
  return Number.isFinite(n) ? Math.round(n * (m[2] ? UNITS[m[2]]! : 1)) : null
}

/** ID 一律是字符串。 */
export function id(value: unknown): string {
  return value == null ? '' : String(value)
}

export function idOrNull(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

export function str(value: unknown): string | null {
  return value == null || value === '' ? null : String(value)
}

/** 不带时区的日期时间：`2025-08-01 12:00`、`2025-08-01T12:00:00`。 */
const NAIVE_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?$/

/**
 * 时间转带时区的 ISO 8601。数字按量级判断：小于 1e11 视为秒，小于 1e14 为毫秒，再大是微秒；
 * 字符串先按数字处理；不带时区的日期时间按北京时间（这些平台给的本地时间都是北京时间，
 * 不能按运行 catbus 的机器所在时区解析）；其余交给 Date 解析。
 */
export function time(value: unknown): string | null {
  if (value == null || value === '' || value === 0 || value === '0') return null
  let ms: number
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value)
    ms = n < 1e11 ? n * 1000 : n < 1e14 ? n : Math.floor(n / 1000)
  } else if (value instanceof Date) ms = value.getTime()
  else {
    const s = String(value).trim()
    const naive = NAIVE_TIME.exec(s)
    ms = Date.parse(naive ? `${naive[1]}T${naive[2]}${naive[3] ?? ':00'}+08:00` : s)
  }
  return Number.isFinite(ms) ? isoNow(new Date(ms)) : null
}

/** 秒数（可带小数）；毫秒请先除以 1000。 */
export function seconds(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** `//host/path` 与 `http://` 统一成 `https://`。 */
export function url(value: unknown): string | null {
  if (value == null || value === '') return null
  const s = String(value)
  if (s.startsWith('//')) return 'https:' + s
  if (s.startsWith('http://')) return 'https://' + s.slice(7)
  return s
}

/** 金额（元）：数字，或 `¥1,099.00`、`总额 -23.28` 这类带符号、千分位的字符串。 */
export function price(amount: unknown, currency = 'CNY'): Price | null {
  if (amount == null || amount === '') return null
  const m = typeof amount === 'number' ? null : /-?\d[\d,]*(?:\.\d+)?/.exec(String(amount))
  const n = typeof amount === 'number' ? amount : m ? Number(m[0].replaceAll(',', '')) : NaN
  return Number.isFinite(n) ? { amount: n, currency } : null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥', middot: '·', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '—', ndash: '–', times: '×' }

/** HTML 实体解码（`html.unescape` 的常用子集）：命名实体与 `&#39;` / `&#x27;` 这类数字实体。 */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * HTML 片段 → 纯文本：`<br>` 还原成换行，图片（表情）取 alt，其余标签去掉，实体解码。空串为 null。
 * 用于搜索结果的高亮标签、微博正文等。
 */
export function plainText(html: unknown): string | null {
  if (html == null || html === '') return null
  const text = unescapeHtml(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<img[^>]*?\balt=(["'])(.*?)\1[^>]*>/gi, '$2')
      .replace(/<[^>]+>/g, ''),
  )
  return text === '' ? null : text
}

/** 构造函数的入参：字段都可省略，stats 也可以只给一部分。 */
type Input<T, K extends keyof T> = Partial<Omit<T, 'stats'>> & Pick<T, K> & (T extends { stats: infer S } ? { stats?: Partial<S> } : unknown)

function attach<T extends object>(value: T, raw: unknown): T {
  return raw === undefined ? value : withRaw(value, raw)
}

export function userRef(v: { id: unknown; name?: unknown; url?: unknown } | null | undefined): UserRef | null {
  if (!v || v.id == null || v.id === '') return null
  return { id: id(v.id), name: str(v.name), url: url(v.url) }
}

export function user(v: Input<User, 'id'>, raw?: unknown): User {
  return attach(
    {
      id: v.id,
      name: v.name ?? null,
      handle: v.handle ?? null,
      avatar: v.avatar ?? null,
      url: v.url ?? null,
      bio: v.bio ?? null,
      stats: { followers: null, following: null, items: null, likes: null, ...v.stats },
    },
    raw,
  )
}

export function media(v: Partial<Media> & { url: string; type: Media['type'] }, raw?: unknown): Media {
  return attach({ id: v.id ?? null, type: v.type, url: v.url, width: v.width ?? null, height: v.height ?? null, duration: v.duration ?? null }, raw)
}

export function item(v: Input<Item, 'id' | 'kind'>, raw?: unknown): Item {
  return attach(
    {
      id: v.id,
      kind: v.kind,
      url: v.url ?? null,
      title: v.title ?? null,
      text: v.text ?? null,
      author: v.author ?? null,
      created_at: v.created_at ?? null,
      cover: v.cover ?? null,
      media: v.media ?? [],
      stats: { views: null, likes: null, comments: null, collects: null, shares: null, ...v.stats },
      price: v.price ?? null,
      status: v.status ?? null,
    },
    raw,
  )
}

export function comment(v: Input<Comment, 'id' | 'item_id' | 'text'>, raw?: unknown): Comment {
  return attach(
    {
      id: v.id,
      item_id: v.item_id,
      parent_id: v.parent_id ?? null,
      author: v.author ?? null,
      text: v.text,
      created_at: v.created_at ?? null,
      stats: { likes: null, replies: null, ...v.stats },
    },
    raw,
  )
}

export function folder(v: Partial<Folder> & { id: string; name: string }, raw?: unknown): Folder {
  return attach({ id: v.id, name: v.name, count: v.count ?? null, url: v.url ?? null }, raw)
}

export function category(v: Partial<Category> & { id: string; name: string }, raw?: unknown): Category {
  return attach({ id: v.id, name: v.name, parent_id: v.parent_id ?? null }, raw)
}

export function keyword(v: Partial<Keyword> & { text: string }, raw?: unknown): Keyword {
  return attach({ text: v.text, heat: v.heat ?? null }, raw)
}

export function topic(v: Input<Topic, 'id' | 'name'>, raw?: unknown): Topic {
  return attach({ id: v.id, name: v.name, url: v.url ?? null, stats: { views: null, items: null, ...v.stats } }, raw)
}

export function poi(v: Partial<Poi> & { id: string; name: string }, raw?: unknown): Poi {
  return attach({ id: v.id, name: v.name, address: v.address ?? null }, raw)
}

export function live(v: Input<Live, 'id' | 'status'>, raw?: unknown): Live {
  return attach(
    { id: v.id, url: v.url ?? null, title: v.title ?? null, status: v.status, host: v.host ?? null, cover: v.cover ?? null, stats: { viewers: null, ...v.stats } },
    raw,
  )
}

export function event(v: Partial<Event> & { type: Event['type'] }, raw?: unknown): Event {
  return attach({ type: v.type, time: v.time ?? isoNow(new Date(now())), user: v.user ?? null, text: v.text ?? null, gift: v.gift ?? null }, raw)
}

export function gift(v: Partial<Gift> & { id: string; name: string }, raw?: unknown): Gift {
  return attach({ id: v.id, name: v.name, price: v.price ?? null }, raw)
}

export function rank(v: Partial<Rank> & { rank: number; user: UserRef }, raw?: unknown): Rank {
  return attach({ rank: v.rank, user: v.user, score: v.score ?? null }, raw)
}

export function conversation(v: Partial<Conversation> & { id: string }, raw?: unknown): Conversation {
  return attach({ id: v.id, peer: v.peer ?? null, unread: v.unread ?? null, last_message: v.last_message ?? null, updated_at: v.updated_at ?? null }, raw)
}

export function message(v: Partial<Message> & { id: string; conversation_id: string }, raw?: unknown): Message {
  return attach(
    {
      id: v.id,
      conversation_id: v.conversation_id,
      from: v.from ?? null,
      type: v.type ?? 'text',
      text: v.text ?? null,
      media: v.media ?? [],
      created_at: v.created_at ?? null,
    },
    raw,
  )
}

export function notice(v: Partial<Notice> & { id: string; type: Notice['type'] }, raw?: unknown): Notice {
  return attach({ id: v.id, type: v.type, user: v.user ?? null, target: v.target ?? null, text: v.text ?? null, created_at: v.created_at ?? null }, raw)
}

export function noticeCount(v: Partial<NoticeCount>, raw?: unknown): NoticeCount {
  const parts = { comment: v.comment ?? null, mention: v.mention ?? null, like: v.like ?? null, follow: v.follow ?? null, system: v.system ?? null }
  const total = v.total ?? Object.values(parts).reduce<number>((s, n) => s + (n ?? 0), 0)
  return attach({ total, ...parts }, raw)
}

export function file(v: File): File {
  return v
}
