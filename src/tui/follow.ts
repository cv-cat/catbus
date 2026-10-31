import type { Command, Platform } from '../core/registry.js'
import { availability, groupCommands, listenable } from './model.js'
import { kindOf, type Kind } from './summary.js'

// 结果页“接着做什么”（AGENTS 4.13）：选中一项后，列出同一平台里可以拿它当参数的命令，并把参数填好。
// 对应 4.8 “输出里的 id 和 url 可以直接作为下一条命令的参数”。纯函数，不含 React。

type Obj = Record<string, any>
const isObj = (v: unknown): v is Obj => v != null && typeof v === 'object'

export interface Next {
  platform: Platform
  command: Command
  /** 位置参数，已按命令声明的顺序填好。 */
  words: string[]
  /** 选项（如 ticket price 的 --from-no）。 */
  given: Record<string, unknown>
  /** 一句话说明这条建议是什么。 */
  label: string
  /** 能直接运行（读取类或监听）；否则只显示等价命令。 */
  runnable: boolean
}

/** xhs 的 URL 带 xsec_token，必须优先传 URL（4.8）；其余平台 ID 更短更稳。 */
function ref(o: Obj, platform: Platform): string | null {
  if (platform.id === 'xhs' && typeof o.url === 'string' && o.url) return o.url
  if (o.id != null && o.id !== '') return String(o.id)
  return typeof o.url === 'string' && o.url ? o.url : null
}

/** 作者 / 主播 / 对端的引用：UserRef 的 url 优先（它自带平台信息），其次 id。 */
function userRef(u: unknown): string | null {
  if (!isObj(u)) return null
  if (typeof u.url === 'string' && u.url) return u.url
  return u.id != null && u.id !== '' ? String(u.id) : null
}

/** 参数名 → 这一项能提供什么值。拿不到的返回 null，该命令就不列出。 */
function provide(kind: Kind, o: Obj, platform: Platform): Record<string, string | null> {
  const self = ref(o, platform)
  switch (kind) {
    case 'item':
      return { item: self, user: userRef(o.author), product: o.kind === 'goods' ? self : null, room: null }
    case 'user':
      return { user: self }
    case 'comment':
      return { item: o.item_id != null ? String(o.item_id) : null, comment: o.id != null ? String(o.id) : null, user: userRef(o.author) }
    case 'live':
      return { room: self, user: userRef(o.host) }
    case 'ticket':
      return { train: o.train_no != null ? String(o.train_no) : null, from: o.from?.name ?? null, to: o.to?.name ?? null }
    case 'transfer':
      return {}
    case 'named':
      // Folder / Series / Category：id 就是收藏夹 / 合集 id
      return { folder: self, series: self }
    default:
      // 会话：Conversation 有 peer 和 last_message
      if ('peer' in o && 'last_message' in o) return { conversation: self, user: userRef(o.peer) }
      return {}
  }
}

/** 一个命令能不能用这一项当参数：它的位置参数全部有来源，且至少用到一个来自这一项的值。 */
function fill(command: Command, provided: Record<string, string | null>): string[] | null {
  const words: string[] = []
  let used = 0
  for (const a of command.args) {
    const v = provided[a.name]
    // 可选的用户参数（user likes、folder list……）省略时是“我自己的”；填成别人的会去查对方没公开的内容，所以不当作建议
    if (a.optional) break
    if (v == null) return null
    words.push(v)
    used++
  }
  return used > 0 && words.length === command.args.filter((x) => !x.optional).length ? words : null
}

const LABELS: Record<string, string> = {
  'comment list': '看评论',
  'comment replies': '看这条评论的回复',
  'item get': '详情',
  'item related': '相关推荐',
  'item media': '媒体地址',
  'item subtitles': '字幕',
  'danmaku list': '弹幕',
  'coupon list': '优惠券',
  'user get': '作者资料',
  'user items': '作者的作品',
  'live get': '直播间信息',
  'live history': '最近的弹幕',
  'live gifts': '礼物列表',
  'live rank': '排行榜',
  'live media': '直播流地址',
  'live products': '直播间商品',
  'live listen': '监听弹幕',
  'live replays': '直播回放',
  'msg history': '消息记录',
  'folder items': '收藏夹里的内容',
  'series items': '合集里的内容',
  'route get': '经停站',
  'product get': '商品详情',
}

/** 同一类对象，常用的排在前面。 */
const ORDER = ['item get', 'comment list', 'live get', 'live listen', 'user get', 'user items', 'route get', 'ticket price', 'folder items', 'series items', 'msg history', 'item related', 'item media']

/**
 * 选中的 item 之后可以做的命令。排除：自己（已经在看了）、auth、需要额外选项才能跑的（除 ticket price，它的选项能从 Ticket 里带出）。
 */
export function nextSteps(platform: Platform, current: Command, item: unknown): Next[] {
  if (!isObj(item)) return []
  const kind = kindOf(item)
  const provided = provide(kind, item, platform)
  const out: Next[] = []
  for (const group of groupCommands(platform)) {
    for (const command of group.commands) {
      if (command.key === current.key) continue
      const state = availability(command)
      if (state !== 'run' && !listenable(command)) continue
      if (kind === 'ticket' && command.key === 'ticket price') {
        const seatTypes = typeof item.seat_types === 'string' ? item.seat_types : ''
        const from = item.from?.no
        const to = item.to?.no
        if (!item.train_no || !from || !to || !seatTypes) continue
        out.push({
          platform,
          command,
          words: [String(item.train_no)],
          given: { fromNo: String(from), toNo: String(to), seatTypes, date: String(item.date ?? '') },
          label: '票价详情',
          runnable: true,
        })
        continue
      }
      if (kind === 'ticket' && command.key === 'route get') {
        const from = item.from?.name
        const to = item.to?.name
        if (!item.train_no || !from || !to) continue
        out.push({ platform, command, words: [String(item.train_no), String(from), String(to)], given: { date: String(item.date ?? '') }, label: '经停站', runnable: true })
        continue
      }
      if (command.key === 'ticket search' || command.key === 'transfer search' || command.key === 'item search') continue
      const words = fill(command, provided)
      if (!words) continue
      out.push({ platform, command, words, given: {}, label: LABELS[command.key] ?? command.summary, runnable: true })
    }
  }
  const rank = (n: Next) => {
    const i = ORDER.indexOf(n.command.key)
    return i < 0 ? ORDER.length : i
  }
  return out.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n)
}
