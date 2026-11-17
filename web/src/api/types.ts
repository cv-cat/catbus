// 与 AGENTS.md 6.1 / 6.2 的信封和归一化类型一致（只列 WebUI 用到的字段）

export interface UserRef {
  id: string
  name: string | null
  url: string | null
  /** https 绝对地址；取不到时为 null。旧版 CLI 不输出这个字段 */
  avatar?: string | null
}

/** 作者页的用户（AGENTS 6.2 User）：`stats` 里的计数取不到时为 null */
export interface User {
  id: string
  name: string | null
  handle: string | null
  avatar: string | null
  url: string | null
  bio: string | null
  stats: { followers: number | null; following: number | null; items: number | null; likes: number | null }
}

export interface Media {
  id: string | null
  type: 'image' | 'video' | 'audio'
  url: string | null
  width: number | null
  height: number | null
  duration: number | null
}

export interface Item {
  id: string
  kind: 'video' | 'image' | 'text' | 'article' | 'goods' | 'torrent'
  url: string
  title: string | null
  text: string | null
  author: UserRef | null
  created_at: string | null
  cover: string | null
  media: Media[]
  stats: { views: number | null; likes: number | null; comments: number | null; collects: number | null; shares: number | null }
  price: { amount: number; currency: string } | null
  status: string | null
  /** 以下只有种子（`kind: torrent`，AGENTS 6.2 的 Torrent）才有 */
  size?: number | null
  file_count?: number | null
  seeders?: number | null
  leechers?: number | null
  completed?: number | null
  discount?: string | null
}

export interface Comment {
  id: string
  item_id: string
  parent_id: string | null
  author: UserRef | null
  text: string | null
  /** 评论里附带的图片 / 表情包（AGENTS 6.2）；旧版 CLI 不输出这个字段 */
  media?: Media[]
  created_at: string | null
  stats: { likes: number | null; replies: number | null }
}

/** 账号的用户：UserRef 加上登录时存下的头像（AGENTS 6.2 AccountUser） */
export interface AccountUser extends UserRef {
  avatar: string | null
}

export interface Account {
  platform: string
  endpoint: string
  account: string
  current: boolean
  user: AccountUser | null
  method: string
  updated_at: string
}

export interface CatbusError {
  code: string
  message: string
  hint: string | null
  detail: unknown
}

export interface Envelope<T> {
  ok: boolean
  data: T | null
  page: { cursor: string | null; has_more: boolean } | null
  error: CatbusError | null
}

/** 搜索联想 / 热搜词（AGENTS.md 6.2 Keyword） */
export interface Keyword {
  text: string
  heat: number | null
}

// ---------- 12306（AGENTS.md 6.2 的铁路扩展类型；查询页见 7.9「12306 查询页」） ----------

/** 余票：≤ 20 张是精确数，≥ 21 张是封顶对象 `{ min: 21 }` */
export type Remaining = number | { min: number }

export interface Station {
  id: string
  name: string
  code: string
  pinyin: string
  abbr: string
  city: string
  url: null
}

export interface Ticket {
  /** 车次，如 G1 */
  id: string
  /** 12306 官方余票查询深链 */
  url: string
  train_no: string
  /** 车次首字母（G / D / C / Z / T / K…），纯数字车次为数字 */
  type: string
  /** 始发站、终到站：与 from / to 比较，得出「始」「终」「过」 */
  start: { code: string; name: string }
  end: { code: string; name: string }
  from: { code: string; name: string; no: string }
  to: { code: string; name: string; no: string }
  depart: string
  arrive: string
  /** HH:MM */
  duration: string
  date: string
  bookable: boolean
  has_ticket: boolean
  seats: Record<string, string>
  remaining: Record<string, Remaining>
  prices: Record<string, { amount: number; currency: string }>
  seat_types: string
}

export interface Stop {
  id: string
  station: string
  /** HH:MM；始发站为 ---- */
  arrive: string
  /** HH:MM；终到站为 ---- */
  depart: string
  /** 「2分钟」；始发、终到为 ---- */
  stopover: string
  in_range: boolean
  url: null
}

export interface TransferLeg {
  id: string
  /** 这一段的余票深链；取不到时为 null */
  url: string | null
  train_no: string
  from: string
  to: string
  depart: string
  arrive: string
  duration: string
  seats: Record<string, string>
  remaining: Record<string, Remaining>
  prices: Record<string, { amount: number; currency: string }>
}

export interface Transfer {
  id: string
  url: null
  via: string
  same_station: boolean
  same_train: boolean
  kind: string
  /** YYYY-MM-DD HH:MM */
  depart: string
  arrive: string
  duration_minutes: number
  /** 「2分钟」「1小时3分钟」 */
  wait: string
  legs: TransferLeg[]
}

/** 地点（AGENTS.md 6.2）：猫眼演出的 `poi search` 只搜演出城市，id 即 `feed list --city` 的取值，address 恒为 null */
export interface Poi {
  id: string
  name: string
  address: string | null
}

// ---------- M-Team（AGENTS.md 4.7 mteam、7.9「M-Team「我的」页与筛选」） ----------

/** `seed stats`：tracker 上当前的做种数和下载数 */
export interface SeedStats {
  seeding: number | null
  leeching: number | null
}

/** `bonus get`：时魔 */
export interface BonusRate {
  per_hour: number | null
  a: number | null
  seeding_count: number | null
  seeding_size_gb: number | null
  two_factor: boolean | null
}

/** `exam get` 的一项考核 */
export interface Exam {
  id: string
  title: string | null
  status: string | null
  start_at: string | null
  end_at: string | null
  note: string | null
  items: { name: 'download' | 'upload' | 'bonus' | string; current: number | null; target: number | null; done: boolean }[]
}

/** `bonus history` 的一条（AGENTS 6.2 BonusRecord） */
export interface BonusRecord {
  id: string
  time: string | null
  type: string | null
  before: number | null
  after: number | null
  change: number | null
  user: UserRef | null
  note: string | null
  url: string | null
}

/** `item categories`（AGENTS 6.2 Category） */
export interface Category {
  id: string
  name: string
  parent_id: string | null
}

/** 收藏夹 / 合集（AGENTS 6.2 Folder / Series） */
export interface Folder {
  id: string
  name: string | null
  count: number | null
  url: string | null
}

/** AGENTS 6.2 Subtitle（B 站 item subtitles） */
export interface Subtitle {
  lang: string | null
  name: string | null
  url: string | null
  lines: { from: number; to: number; text: string }[]
}

/** AGENTS 6.2 Danmaku：offset 为视频内的秒数 */
export interface Danmaku {
  id: string
  item_id: string | null
  offset: number | null
  text: string
  created_at: string | null
}

/** AGENTS 6.2 Live */
export interface Live {
  id: string
  url: string | null
  title: string | null
  status: 'live' | 'offline' | null
  host: UserRef | null
  cover: string | null
  stats: { viewers: number | null }
}

/** AGENTS 6.2 Gift（live gifts 的一条）：价格可能是平台的虚拟货币 */
export interface Gift {
  id: string
  name: string | null
  price: { amount: number; currency: string } | null
}

/** AGENTS 6.2 Rank（live rank 的一条） */
export interface Rank {
  rank: number | null
  user: UserRef | null
  score: number | null
}

/** AGENTS 6.2 Event（live listen 的一条） */
export interface LiveEvent {
  type: 'chat' | 'gift' | 'like' | 'enter' | 'follow' | 'other'
  time: string | null
  user: UserRef | null
  text: string | null
  gift: { name: string | null; count: number | null } | null
  /** 直播间实时数据：在线人数、累计点赞；旧版 CLI 没有这个字段 */
  stats?: { viewers: number | null; likes: number | null } | null
}

/** AGENTS 6.2 Notice（notice list 的一条） */
export interface Notice {
  id: string
  type: 'comment' | 'mention' | 'like' | 'follow' | 'system'
  user: UserRef | null
  target: { id: string; url: string | null } | null
  text: string | null
  created_at: string | null
}

/** AGENTS 6.2 NoticeCount */
export interface NoticeCount {
  total: number
  comment: number | null
  mention: number | null
  like: number | null
  follow: number | null
  system: number | null
}

/** AGENTS 6.2 Conversation（msg list 的一条） */
export interface Conversation {
  id: string
  peer: UserRef | null
  unread: number | null
  last_message: string | null
  updated_at: string | null
}

/** AGENTS 6.2 Message（msg history 的一条） */
export interface Message {
  id: string
  conversation_id: string
  from: UserRef | null
  type: 'text' | 'image' | 'video' | 'card' | 'other'
  text: string | null
  media: Media[]
  created_at: string | null
}
