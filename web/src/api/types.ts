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
