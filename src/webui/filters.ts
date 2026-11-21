import type { Platform } from '../core/registry.js'

/**
 * 筛选能力（AGENTS.md 7.9「筛选」）：GET /api/filters，从本包的注册表读出各平台 web 端
 * `item search` 支持的 `--sort` / `--type` / `--time` 取值和 `feed list` 的 `--kind` 取值，页面据此把不支持的筛选置灰。
 * 只是注册表里的公开信息，不碰账号，演示模式下同样可用。
 */

/** null 表示该命令没有这个筛选（只能用默认值）；platform 的 search 为 false 表示没有已实现的 item search */
export interface PlatformFilters {
  search: boolean
  sort: string[] | null
  type: string[] | null
  /** `item search` 的时间范围 `--time` */
  time: string[] | null
  /** 已实现的 `feed list` 的流种类 `--kind`（推荐 / 热门 / 关注）；没有已实现的 feed list 时为 null */
  kind: string[] | null
  /** 平台私有的字段排序 `--order-by` 的取值（目前只有 mteam）；没有时为 null */
  order: string[] | null
  /** `user get` 和 `user items` 都已实现：作者可以做成站内的作者页（AGENTS.md 7.9「作者页」） */
  author: boolean
  /** 搜索联想 `keyword suggest`、热搜 `keyword hot` 是否已实现（AGENTS.md 7.9「搜索联想与热搜」） */
  suggest: boolean
  hot: boolean
  /** web 端的 `item related` 已实现：详情卡片显示相关推荐（AGENTS.md 7.9「相关推荐」） */
  related: boolean
  /** web 端的 `comment list` 已实现：下载时可以带上评论（AGENTS.md 7.9「批量选择与下载」） */
  comments: boolean
  /** 「我的」页可用的标签，按显示顺序（AGENTS.md 7.9「各平台的「我的」页」）；收藏夹、合集要列表和内容都已实现 */
  mine: MineTab[]
  /** 详情卡片的字幕 `item subtitles`、弹幕 `danmaku list`、媒体链接 `item media`（AGENTS.md 7.9「详情卡片的字幕、弹幕与媒体链接」） */
  subtitles: boolean
  danmaku: boolean
  media: boolean
  /** `live listen` 已实现：有直播弹幕页（AGENTS.md 7.9「直播弹幕」）；`liveGet` 为 `live get` 已实现（直播间头部） */
  live: boolean
  liveGet: boolean
  /** `live media` 已实现：直播页可以播放直播画面 */
  liveMedia: boolean
  /** 直播页的发现直播间（AGENTS.md 7.9「直播弹幕」）：推荐列表 `live list`、搜索 `live search`；
   * `liveCategories` 要 `live categories` 已实现、且 `live list` 接受 `--category`（分类 chip 才有用） */
  liveList: boolean
  liveSearch: boolean
  liveCategories: boolean
  /** 直播间标签：礼物、榜单、带货商品、回放；`liveHistory` 为进入直播间时预填最近弹幕 */
  liveGifts: boolean
  liveRank: boolean
  liveProducts: boolean
  liveReplays: boolean
  liveHistory: boolean
  /** 收件箱（AGENTS.md 7.9「通知与私信」）：notice list、notice count 已实现；私信要 msg list 和 msg history 都已实现 */
  inbox: { notices: boolean; count: boolean; messages: boolean }
}

export type MineTab = 'works' | 'likes' | 'collects' | 'reposts' | 'folders' | 'series' | 'history'
/** 标签 → 需要都已实现的命令 */
export const MINE_TABS: readonly (readonly [MineTab, readonly string[]])[] = [
  ['works', ['item list']],
  ['likes', ['user likes']],
  ['collects', ['user collects']],
  ['reposts', ['user reposts']],
  ['folders', ['folder list', 'folder items']],
  ['series', ['series list', 'series items']],
  ['history', ['history list']],
]
/** 有自己的「我的」页的平台，不走通用的标签 */
const OWN_MINE = new Set(['mteam'])

const FILTERS = ['sort', 'type', 'time'] as const

/** zod 的 enum 外面可能包了 optional / default：一层层拆开取 options */
function enumValues(schema: unknown): string[] | null {
  let s = schema as { options?: unknown; unwrap?: () => unknown; def?: { innerType?: unknown } } | undefined
  for (let i = 0; s && i < 4; i++) {
    if (Array.isArray(s.options)) return s.options.map(String)
    s = (typeof s.unwrap === 'function' ? s.unwrap() : s.def?.innerType) as typeof s
  }
  return null
}

let cached: Promise<Record<string, PlatformFilters>> | null = null

export function platformFilters(): Promise<Record<string, PlatformFilters>> {
  cached ??= import('../platforms/index.js').then(({ PLATFORMS }: { PLATFORMS: Platform[] }) => {
    const out: Record<string, PlatformFilters> = {}
    for (const p of PLATFORMS) {
      const web = p.endpoints.web
      if (!web || web === 'planned') continue
      const cmd = web.commands.get('item search')
      const entry: PlatformFilters = { search: cmd?.status === 'implemented', sort: null, type: null, time: null, kind: null, order: null, author: false, related: web.commands.get('item related')?.status === 'implemented', suggest: web.commands.get('keyword suggest')?.status === 'implemented', hot: web.commands.get('keyword hot')?.status === 'implemented', comments: web.commands.get('comment list')?.status === 'implemented', mine: [], subtitles: false, danmaku: false, media: false, live: false, liveGet: false, liveMedia: false, liveList: false, liveSearch: false, liveCategories: false, liveGifts: false, liveRank: false, liveProducts: false, liveReplays: false, liveHistory: false, inbox: { notices: false, count: false, messages: false } }
      for (const k of FILTERS) entry[k] = cmd ? enumValues(cmd.options[k]) : null
      const feed = web.commands.get('feed list')
      entry.kind = feed?.status === 'implemented' ? enumValues(feed.options.kind) : null
      entry.order = cmd ? enumValues(cmd.options.orderBy) : null
      entry.author = ['user get', 'user items'].every((k) => web.commands.get(k)?.status === 'implemented')
      const done = (k: string) => web.commands.get(k)?.status === 'implemented'
      entry.subtitles = done('item subtitles')
      entry.danmaku = done('danmaku list')
      entry.media = done('item media')
      entry.live = done('live listen')
      entry.liveGet = done('live get')
      entry.liveMedia = done('live media')
      entry.liveList = done('live list')
      entry.liveSearch = done('live search')
      entry.liveCategories = done('live categories') && entry.liveList && Boolean(web.commands.get('live list')?.options.category)
      entry.liveGifts = done('live gifts')
      entry.liveRank = done('live rank')
      entry.liveProducts = done('live products')
      entry.liveReplays = done('live replays')
      entry.liveHistory = done('live history')
      entry.inbox = { notices: done('notice list'), count: done('notice count'), messages: done('msg list') && done('msg history') }
      if (!OWN_MINE.has(p.id)) entry.mine = MINE_TABS.filter(([, cmds]) => cmds.every(done)).map(([t]) => t)
      out[p.id] = entry
    }
    return out
  })
  return cached
}
