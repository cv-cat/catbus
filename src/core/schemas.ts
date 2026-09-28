import { z } from 'zod'
import { LOGIN_METHODS } from './options.js'

/** 归一化类型（AGENTS 6.2）。新增类型或字段先改 AGENTS。 */

export interface UserRef {
  id: string
  name: string | null
  url: string | null
}

export interface Price {
  amount: number
  currency: string
}

export interface Media {
  id: string | null
  type: 'image' | 'video' | 'audio'
  url: string
  width: number | null
  height: number | null
  duration: number | null
}

export interface User {
  id: string
  name: string | null
  handle: string | null
  avatar: string | null
  url: string | null
  bio: string | null
  stats: { followers: number | null; following: number | null; items: number | null; likes: number | null }
}

export type ItemKind = 'video' | 'image' | 'text' | 'article' | 'goods'
export type ItemStatus = 'published' | 'reviewing' | 'rejected' | 'private' | 'draft' | 'on_sale' | 'sold' | 'off_shelf'

export interface Item {
  id: string
  kind: ItemKind
  url: string | null
  title: string | null
  text: string | null
  author: UserRef | null
  created_at: string | null
  cover: string | null
  media: Media[]
  stats: { views: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null }
  price: Price | null
  status: ItemStatus | null
}

export interface Comment {
  id: string
  item_id: string
  parent_id: string | null
  author: UserRef | null
  text: string
  created_at: string | null
  stats: { likes: number | null; replies: number | null }
}

export interface Folder {
  id: string
  name: string
  count: number | null
  url: string | null
}

export type Series = Folder

export interface Category {
  id: string
  name: string
  parent_id: string | null
}

export interface Keyword {
  text: string
  heat: number | null
}

export interface Topic {
  id: string
  name: string
  url: string | null
  stats: { views: number | null; items: number | null }
}

export interface Poi {
  id: string
  name: string
  address: string | null
}

export interface Live {
  id: string
  url: string | null
  title: string | null
  status: 'live' | 'offline'
  host: UserRef | null
  cover: string | null
  stats: { viewers: number | null }
}

export interface Event {
  type: 'chat' | 'gift' | 'like' | 'enter' | 'follow' | 'other'
  time: string
  user: UserRef | null
  text: string | null
  gift: { name: string; count: number } | null
}

export interface Gift {
  id: string
  name: string
  price: Price | null
}

export interface Rank {
  rank: number
  user: UserRef
  score: number | null
}

export interface Conversation {
  id: string
  peer: UserRef | null
  unread: number | null
  last_message: string | null
  updated_at: string | null
}

export interface Message {
  id: string
  conversation_id: string
  from: UserRef | null
  type: 'text' | 'image' | 'video' | 'card' | 'other'
  text: string | null
  media: Media[]
  created_at: string | null
}

export interface Notice {
  id: string
  type: 'comment' | 'mention' | 'like' | 'follow' | 'system'
  user: UserRef | null
  target: { id: string; url: string | null } | null
  text: string | null
  created_at: string | null
}

export interface NoticeCount {
  total: number
  comment: number | null
  mention: number | null
  like: number | null
  follow: number | null
  system: number | null
}

export interface AuthStatus {
  logged_in: boolean
  user: UserRef | null
  method: string | null
  expires_at: string | null
}

export interface Account {
  platform: string
  endpoint: string
  account: string
  current: boolean
  user: UserRef | null
  method: string | null
  updated_at: string | null
}

export interface File {
  path: string
  type: 'image' | 'video' | 'audio'
  url: string | null
  size: number
}

export interface Subtitle {
  lang: string
  name: string | null
  url: string | null
  lines: { from: number; to: number; text: string }[]
}

export interface Danmaku {
  id: string
  item_id: string
  offset: number
  text: string
  created_at: string | null
}

export interface Order {
  id: string
  status: string | null
  total: Price | null
  items: Item[]
  created_at: string | null
}

export interface Coupon {
  id: string
  title: string | null
  discount: Price | null
  threshold: Price | null
  start_at: string | null
  end_at: string | null
}

/** 输出类型名，注册表的 `output` 只能用这些（加 `[]` 表示数组），或 `{...}` 形式的内联结构。 */
export const OUTPUT_TYPES = new Set([
  'User', 'Item', 'Comment', 'Folder', 'Series', 'Category', 'Keyword', 'Topic', 'Poi', 'Live', 'Event', 'Gift',
  'Rank', 'Conversation', 'Message', 'Notice', 'NoticeCount', 'Media', 'AuthStatus', 'Account', 'File', 'Subtitle',
  'Danmaku', 'Order', 'Coupon',
])

/** 归一化对象上挂平台原始对象，`--raw` 时用它替换。JSON 序列化会忽略 symbol 键。 */
export const RAW = Symbol.for('catbus.raw')

export function withRaw<T extends object>(value: T, raw: unknown): T {
  Object.defineProperty(value, RAW, { value: raw, enumerable: false })
  return value
}

// ---- 凭证文件（AGENTS 5.4） ----

const UserRefSchema = z.object({ id: z.string(), name: z.string().nullable(), url: z.string().nullable() })

const CookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string().default('/'),
  /** Unix 秒；会话 cookie 为 null。 */
  expires: z.number().nullable().default(null),
})

const ScopeSchema = z.object({
  cookies: z.array(CookieSchema).default([]),
  tokens: z.record(z.string(), z.unknown()).default({}),
})

export const CredentialSchema = z.object({
  schema: z.literal(1),
  platform: z.string(),
  endpoint: z.enum(['web', 'app', 'pc']),
  account: z.string(),
  user: UserRefSchema.nullable(),
  method: z.enum([...LOGIN_METHODS, 'guest']),
  created_at: z.string(),
  updated_at: z.string(),
  scopes: z.record(z.string(), ScopeSchema),
  device: z.record(z.string(), z.unknown()).default({}),
  extra: z.record(z.string(), z.unknown()).default({}),
})

export type Cookie = z.infer<typeof CookieSchema>
export type Credential = z.infer<typeof CredentialSchema>
