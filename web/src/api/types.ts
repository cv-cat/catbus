// 与 AGENTS.md 6.1 / 6.2 的信封和归一化类型一致（只列 WebUI 用到的字段）

export interface UserRef {
  id: string
  name: string | null
  url: string | null
  /** https 绝对地址；取不到时为 null。旧版 CLI 不输出这个字段 */
  avatar?: string | null
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
