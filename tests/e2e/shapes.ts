import { z } from 'zod'

/** 归一化类型（AGENTS 6.2）的结构校验，在线测试用。字段总是存在：缺失时为 null 或 []。 */

const str = z.string()
const nstr = z.string().nullable()
const nint = z.number().int().nullable()
const nnum = z.number().nullable()
/** 带时区的 ISO 8601。 */
const time = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, '不是带时区的 ISO 8601')
const ntime = time.nullable()

const UserRef = z.strictObject({ id: str, name: nstr, url: nstr })
const Price = z.strictObject({ amount: z.number(), currency: str })
const Media = z.strictObject({
  id: nstr,
  type: z.enum(['image', 'video', 'audio']),
  url: str,
  width: nint,
  height: nint,
  duration: nnum,
})

const User = z.strictObject({
  id: str,
  name: nstr,
  handle: nstr,
  avatar: nstr,
  url: nstr,
  bio: nstr,
  stats: z.strictObject({ followers: nint, following: nint, items: nint, likes: nint }),
})

const Item = z.strictObject({
  id: str,
  kind: z.enum(['video', 'image', 'text', 'article', 'goods']),
  url: nstr,
  title: nstr,
  text: nstr,
  author: UserRef.nullable(),
  created_at: ntime,
  cover: nstr,
  media: z.array(Media),
  stats: z.strictObject({ views: nint, likes: nint, comments: nint, collects: nint, shares: nint }),
  price: Price.nullable(),
  status: z.enum(['published', 'reviewing', 'rejected', 'private', 'draft', 'on_sale', 'sold', 'off_shelf']).nullable(),
})

const Comment = z.strictObject({
  id: str,
  item_id: str,
  parent_id: nstr,
  author: UserRef.nullable(),
  text: str,
  created_at: ntime,
  stats: z.strictObject({ likes: nint, replies: nint }),
})

const Folder = z.strictObject({ id: str, name: str, count: nint, url: nstr })
const Category = z.strictObject({ id: str, name: str, parent_id: nstr })
const Keyword = z.strictObject({ text: str, heat: nint })
const Topic = z.strictObject({ id: str, name: str, url: nstr, stats: z.strictObject({ views: nint, items: nint }) })
const Poi = z.strictObject({ id: str, name: str, address: nstr })

const Live = z.strictObject({
  id: str,
  url: nstr,
  title: nstr,
  status: z.enum(['live', 'offline']),
  host: UserRef.nullable(),
  cover: nstr,
  stats: z.strictObject({ viewers: nint }),
})
const Event = z.strictObject({
  type: z.enum(['chat', 'gift', 'like', 'enter', 'follow', 'other']),
  time,
  user: UserRef.nullable(),
  text: nstr,
  gift: z.strictObject({ name: str, count: z.number().int() }).nullable(),
})
const Gift = z.strictObject({ id: str, name: str, price: Price.nullable() })
const Rank = z.strictObject({ rank: z.number().int(), user: UserRef, score: nnum })

const Conversation = z.strictObject({ id: str, peer: UserRef.nullable(), unread: nint, last_message: nstr, updated_at: ntime })
const Message = z.strictObject({
  id: str,
  conversation_id: str,
  from: UserRef.nullable(),
  type: z.enum(['text', 'image', 'video', 'card', 'other']),
  text: nstr,
  media: z.array(Media),
  created_at: ntime,
})
const Notice = z.strictObject({
  id: str,
  type: z.enum(['comment', 'mention', 'like', 'follow', 'system']),
  user: UserRef.nullable(),
  target: z.strictObject({ id: str, url: nstr }).nullable(),
  text: nstr,
  created_at: ntime,
})
const NoticeCount = z.strictObject({ total: z.number().int(), comment: nint, mention: nint, like: nint, follow: nint, system: nint })

const AuthStatus = z.strictObject({ logged_in: z.boolean(), user: UserRef.nullable(), method: nstr, expires_at: ntime })
const Account = z.strictObject({
  platform: str,
  endpoint: str,
  account: str,
  current: z.boolean(),
  user: UserRef.nullable(),
  method: nstr,
  updated_at: ntime,
})

const Subtitle = z.strictObject({
  lang: str,
  name: nstr,
  url: nstr,
  lines: z.array(z.strictObject({ from: z.number(), to: z.number(), text: str })),
})
const Danmaku = z.strictObject({ id: str, item_id: str, offset: z.number(), text: str, created_at: ntime })
const Order = z.strictObject({ id: str, status: nstr, total: Price.nullable(), items: z.array(Item), created_at: ntime })
const Coupon = z.strictObject({
  id: str,
  title: nstr,
  discount: Price.nullable(),
  threshold: Price.nullable(),
  start_at: ntime,
  end_at: ntime,
})

const Station = z.strictObject({
  id: str,
  name: str,
  code: str,
  pinyin: str,
  abbr: str,
  city: str,
  url: nstr,
})

const TicketStation = z.strictObject({ code: str, name: str, no: str })
const TicketRemaining = z.union([z.number().int(), z.strictObject({ min: z.number().int() })])

const Ticket = z.strictObject({
  id: str,
  url: str,
  train_no: str,
  type: str,
  from: TicketStation,
  to: TicketStation,
  depart: str,
  arrive: str,
  duration: str,
  date: str,
  bookable: z.boolean(),
  has_ticket: z.boolean(),
  seats: z.record(str, str),
  remaining: z.record(str, TicketRemaining),
  prices: z.record(str, Price),
  seat_types: str,
})

const Stop = z.strictObject({
  id: str,
  url: nstr,
  station: str,
  arrive: str,
  depart: str,
  stopover: str,
  in_range: z.boolean(),
})

const Fare = z.strictObject({
  id: str,
  url: nstr,
  train_no: str,
  date: str,
  prices: z.record(str, Price),
})

const TransferLeg = z.strictObject({
  id: str,
  url: nstr,
  train_no: str,
  from: str,
  to: str,
  depart: str,
  arrive: str,
  duration: str,
  seats: z.record(str, str),
  remaining: z.record(str, TicketRemaining),
  prices: z.record(str, Price),
})

const Transfer = z.strictObject({
  id: str,
  url: nstr,
  via: str,
  same_station: z.boolean(),
  same_train: z.boolean(),
  kind: z.enum(['同车换座', '换乘']),
  depart: str,
  arrive: str,
  duration_minutes: z.number().int(),
  wait: str,
  legs: z.array(TransferLeg),
})

export const SHAPES: Record<string, z.ZodType> = {
  User, Item, Comment, Folder, Series: Folder, Category, Keyword, Topic, Poi, Live, Event, Gift, Rank,
  Conversation, Message, Notice, NoticeCount, Media, AuthStatus, Account, Subtitle, Danmaku, Order, Coupon,
  Station, Ticket, Stop, Fare, Transfer,
}

/** 按注册表的 output（如 `Item[]`、`{count}`）取校验器；内联结构只校验是对象。 */
export function shapeOf(output: string): z.ZodType {
  const list = output.endsWith('[]')
  const name = output.replace(/\[\]$/, '')
  const one = name.startsWith('{') ? z.record(z.string(), z.unknown()) : SHAPES[name]
  if (!one) throw new Error(`没有 ${output} 的校验器`)
  return list ? z.array(one) : one
}
