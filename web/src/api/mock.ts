import type { Account, Comment, Envelope, Item, Keyword, Remaining, Station, Stop, Ticket, Transfer, TransferLeg, User, UserRef } from './types'

// 演示数据：bridge 不可用（没有 catbus、vite preview 等）时使用，不访问任何平台

const TITLES = [
  '秋天去山里露营，这套装备闭眼入',
  '新手清单｜一次买对不踩坑',
  '湖边日落，咖啡和帐篷',
  '一个人的 48 小时：慢下来',
  '车顶帐篷真的值得买吗？实测三个月',
  '铸铁锅焖饭，户外也能吃好',
  '周末说走就走的营地合集',
  '3 分钟学会天幕搭法',
  '星空下的帐篷，延时摄影教程',
  '6 款露营灯横评',
  '带猫去露营是什么体验',
  '秋日野餐布置灵感',
  '城市边缘的小众营地',
  '机能风也能很温柔',
  '山顶看日出，值了',
  '徒步路线推荐：一天走完的那种',
]
const AUTHORS = ['阿野户外', 'Mia 的周末', '山野来信', '木子', '自驾者老周', '吃在野外', '去野吧', '夜行者', '装备控', '橘子和猫']

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** `variant`：推荐流的分类或搜索的时间范围（默认值为空串），只用来换一批演示数据 */
/** `shift`：演示多账号时按账号错开几条，同一查询的不同账号结果部分重叠（演示合并去重） */
export function mockItems(platform: string, keyword: string, page: number, limit = 20, variant = '', shift = 0): Envelope<Item[]> {
  const seed = hash(variant ? `${platform}:${keyword}:${variant}` : `${platform}:${keyword}`) + shift
  const data: Item[] = Array.from({ length: limit }, (_, i) => {
    const n = seed + page * limit + i
    const ratio = [0.75, 1, 1.33, 0.8, 1.25, 0.66][n % 6]!
    const w = 600
    const h = Math.round(w / ratio)
    const video = n % 3 === 0
    const id = `${platform}-${(n % 1e8).toString(36)}`
    // 每 7 条一条纯文字（没有封面和媒体），演示纯文字卡
    if (n % 7 === 3) {
      const text = n % 2 ? '什么时候能看到雪啊' : TEXTS[n % TEXTS.length]!
      return {
 id, kind: 'text', url: `https://example.com/${platform}/${id}`, title: null, text,
 author: demoAuthor(n), created_at: new Date(Date.now() - (n % 30) * 864e5).toISOString(),
        cover: null, media: [],
 stats: { views: null, likes: hash(id) % 9000, comments: hash(id + 'c') % 400, collects: null, shares: null },
 price: null, status: null,
      }
    }
    return {
      id,
      kind: video ? 'video' : 'image',
      url: `https://example.com/${platform}/${id}`,
      title: keyword ? `${TITLES[n % TITLES.length]} · ${keyword}` : TITLES[n % TITLES.length]!,
      text: null,
      author: demoAuthor(n),
      created_at: new Date(Date.now() - (n % 30) * 864e5).toISOString(),
      cover: `https://picsum.photos/seed/${id}/${w}/${h}`,
      // 视频条目带上演示视频直链：瀑布流的悬停预览（设置 › 实验性）要用
      media: [{ id: null, type: video ? 'video' : 'image', url: video ? DEMO_VIDEO : null, width: w, height: h, duration: video ? 60 + (n % 400) : null }],
      stats: { views: null, likes: hash(id) % 150000, comments: hash(id + "c") % 3000, collects: null, shares: null },
      price: null,
      status: null,
    }
  })
  return { ok: true, data, page: { cursor: String(page + 1), has_more: page < 4 }, error: null }
}

const TEXTS = [
  '第一次带全家去山里过夜，提前做了好多功课。帐篷选的是 4 人速开款，十分钟就能搭好；睡袋一定要看舒适温标，山里后半夜只有 5℃。\n\n最后附上我的完整清单，按需抄作业～',
  '周五下班直接出发，开了两个小时到营地。晚上起了点风，天幕一定要打好地钉。早上被鸟叫醒，煮一壶咖啡看云慢慢散开，这一趟值了。',
  '这次只带了一个 40L 的包，轻量化真的能让徒步轻松很多。把每样东西的重量都称了一遍，清单放在最后一张图。',
]
const TAGS = ['#露营装备', '#秋日露营', '#户外生活', '#周末去哪儿', '#徒步', '#自驾']
const COMMENTS = [
  '帐篷链接可以发一下吗？看着好能装',
  '这是哪个营地呀，求坐标',
  '5℃ 真的要注意，上次冻醒了三次[捂脸]',
  '收藏了，下周就去',
  '画面好治愈，看完想立刻出发',
  '请问天幕是什么牌子的？',
  '小朋友第一次露营会不会害怕呀',
  '咖啡壶好好看！',
]
// CC0 示例视频（MDN）：演示数据只用来看界面，不访问任何平台
/** 演示作者：一半带头像，一半没有（演示占位色 + 首字的退回效果） */
function demoAuthor(n: number) {
  const id = String(n % 997)
  return { id, name: AUTHORS[n % AUTHORS.length]!, url: null, avatar: n % 2 ? `https://picsum.photos/seed/ava-${id}/96/96` : null }
}

const DEMO_VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'

/** 演示用的详情：补上正文、话题和媒体 */
export function mockItem(item: Item): Envelope<Item> {
  const n = hash(item.id)
  // 纯文字条目：详情同样没有媒体，只补收藏和分享数
  if (item.kind === 'text' && !item.cover) {
    return { ok: true, data: { ...item, stats: { ...item.stats, collects: item.stats.collects ?? n % 900, shares: item.stats.shares ?? n % 80 } }, page: null, error: null }
  }
  const base = item.media[0]
  const w = base?.width ?? 600
  const h = base?.height ?? 800
  const media: Item['media'] =
    item.kind === 'video'
      ? [{ id: null, type: 'video', url: DEMO_VIDEO, width: w, height: h, duration: base?.duration ?? null }]
      : Array.from({ length: 1 + (n % 4) }, (_, i) => ({
          id: null,
          type: 'image' as const,
          url: i === 0 && item.cover ? item.cover : `https://picsum.photos/seed/${item.id}-${i}/${w}/${h}`,
          width: w,
          height: h,
          duration: null,
        }))
  const tags = [0, 1, 2].map((i) => TAGS[(n + i * 2) % TAGS.length]).join(' ')
  return {
    ok: true,
    data: {
      ...item,
      text: `${TEXTS[n % TEXTS.length]}\n\n${tags}`,
      media,
      stats: { ...item.stats, collects: item.stats.collects ?? n % 9000, shares: item.stats.shares ?? n % 800 },
    },
    page: null,
    error: null,
  }
}

export function mockComments(item: Item, page: number): Envelope<Comment[]> {
  const n = hash(item.id)
  const data: Comment[] = Array.from({ length: 8 }, (_, i) => {
    const k = n + page * 8 + i
    const replies = k % 3 === 0 ? k % 20 : 0
    return {
      // 回复数编进 id，mockReplies 按它给出同样多的回复
      id: `${item.id}-c${page}-${i}-n${replies}`,
      item_id: item.id,
      parent_id: null,
      author: demoAuthor(k),
      text: k % 5 === 2 ? null : COMMENTS[k % COMMENTS.length]!,
      media: k % 5 === 2 || k % 7 === 3
 ? Array.from({ length: (k % 3) + 1 }, (_, j) => ({ id: null, type: 'image' as const, url: `https://picsum.photos/seed/c-${k}-${j}/480/360`, width: 480, height: 360, duration: null }))
        : [],
      created_at: new Date(Date.now() - ((k % 72) + 1) * 3_600_000).toISOString(),
      stats: { likes: k % 400, replies },
    }
  })
  return { ok: true, data, page: { cursor: String(page + 1), has_more: page < 2 }, error: null }
}

/** 演示用的楼中楼：总数与 mockComments 给的 replies 一致，按 offset 分页 */
export function mockReplies(item: Item, comment: string, offset: number, limit: number): Envelope<Comment[]> {
  const n = hash(comment)
  const total = Number(/-n(\d+)$/.exec(comment)?.[1] ?? 0)
  const data: Comment[] = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => {
    const k = n + offset + i
    return {
      id: `${comment}-r${offset + i}`,
      item_id: item.id,
      parent_id: comment,
      author: demoAuthor(k),
      text: COMMENTS[k % COMMENTS.length]!,
      created_at: new Date(Date.now() - ((k % 48) + 1) * 3_600_000).toISOString(),
      stats: { likes: k % 60, replies: null },
    }
  })
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

/** 演示用的相关推荐：竖封面、一半是带播放数的视频；读不到 /api/filters 时按这几个平台演示（与注册表一致） */
export const MOCK_RELATED_PLATFORMS = ['tiktok', 'bilibili', 'kuaishou', 'jd', 'youtube']
export function mockRelated(platform: string, item: Item, limit: number): Envelope<Item[]> {
  const n = hash(`related:${item.id}`)
  const data: Item[] = Array.from({ length: Math.min(limit, 8 + (n % 5)) }, (_, i) => {
    const k = n + i
    const id = `${platform}-r${(k % 1e8).toString(36)}`
    const video = k % 2 === 0
    return {
      id,
      kind: video ? 'video' : 'image',
      url: `https://example.com/${platform}/${id}`,
      title: TITLES[k % TITLES.length]!,
      text: null,
      author: demoAuthor(k),
      created_at: new Date(Date.now() - (k % 30) * 864e5).toISOString(),
      cover: `https://picsum.photos/seed/${id}/480/600`,
      media: [{ id: null, type: video ? 'video' : 'image', url: video ? DEMO_VIDEO : null, width: 480, height: 600, duration: video ? 30 + (k % 300) : null }],
      stats: { views: video ? 1000 + (hash(id) % 200000) : null, likes: hash(id) % 90000, comments: hash(id + 'c') % 2000, collects: null, shares: null },
      price: null,
      status: null,
    }
  })
  return { ok: true, data, page: { cursor: null, has_more: false }, error: null }
}

const NICKS: Record<string, string[]> = {
  xhs: ['下一站去哪', '丸子是只柴', '露营可可', '小野玩户外', '倒拔垂杨柳'],
  douyin: ['catbus', '飞天', '蜡笔小新', '吴荔斌', '漫逛江南', '丸子是小号', '澄就YOUNG', '霞客湾', '一站一站', '山野来信', '江南小雨', '早睡早起', '周末去哪', '晚风'],
  bilibili: ['catbus'],
  weibo: ['catbus'],
}
const DAY = 86_400_000
const demoAccounts: Account[] = Object.entries(NICKS).flatMap(([platform, nicks]) =>
  nicks.map((name, i) => ({
    platform,
    endpoint: 'web',
    account: i === 0 ? 'default' : `acc-${i}`,
    current: i === 0,
    user: { id: String(i + 1), name, url: null, avatar: null },
    method: 'qrcode',
    updated_at: new Date(Date.now() - i * 2 * DAY).toISOString(),
  })),
)

export function mockAccounts(): Envelope<Account[]> {
  return { ok: true, data: demoAccounts.map((a) => ({ ...a })), page: null, error: null }
}

export function mockLogout(platform: string, account: string) {
  const i = demoAccounts.findIndex((a) => a.platform === platform && a.account === account)
  if (i >= 0) demoAccounts.splice(i, 1)
}

export function mockUse(platform: string, account: string) {
  for (const a of demoAccounts) if (a.platform === platform) a.current = a.account === account
}

/**
 * 演示模式的筛选取值表（与 GET /api/filters 同结构，取值照各平台注册表里的声明），
 * `?demo` 下不请求服务端也能演示分类、时间筛选的置灰。
 */
export function mockFilters(): Record<string, { search: boolean; sort: string[] | null; type: string[] | null; time: string[] | null; kind: string[] | null; order: string[] | null; author: boolean; suggest: boolean; hot: boolean; related: boolean; comments: boolean }> {
  const base = mockFilterValues()
  // 作者页、联想 / 热搜、相关推荐的能力同样照注册表：演示模式下这几项也能演示
  return Object.fromEntries(
    Object.entries(base).map(([id, f]) => [
      id,
      {
        ...f,
        author: MOCK_AUTHOR_PLATFORMS.includes(id),
        suggest: MOCK_KEYWORD_SUPPORT[id]?.suggest ?? false,
        hot: MOCK_KEYWORD_SUPPORT[id]?.hot ?? false,
        related: MOCK_RELATED_PLATFORMS.includes(id),
        comments: MOCK_COMMENT_PLATFORMS.includes(id),
      },
    ]),
  )
}

/** web 端 `comment list` 已实现的平台（与注册表一致）：下载时可以带评论 */
const MOCK_COMMENT_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'weibo', 'jd', 'x', 'youtube']

/** web 端 `user get` 和 `user items` 都已实现的平台（与注册表一致） */
const MOCK_AUTHOR_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'weibo', 'x', 'youtube']

function mockFilterValues(): Record<string, { search: boolean; sort: string[] | null; type: string[] | null; time: string[] | null; kind: string[] | null; order: string[] | null }> {
  const f = (sort: string[] | null, type: string[] | null, time: string[] | null, kind: string[] | null, search = true) =>
    ({ search, sort, type, time, kind, order: null as string[] | null })
  const T = ['all', 'video', 'image']
  const HALF = ['all', 'day', 'week', 'half_year']
  const RF = ['recommend', 'following']
  return {
    xhs: f(['general', 'latest', 'popular', 'comments', 'collects'], T, HALF, RF),
    douyin: f(['general', 'popular', 'latest'], T, HALF, ['recommend', 'hot', 'following']),
    bilibili: f(['general', 'views', 'latest', 'collects'], ['video', 'article'], null, ['recommend', 'hot', 'following']),
    tiktok: f(null, null, null, RF),
    kuaishou: f(null, null, null, RF),
    weibo: f(null, null, null, RF),
    x: f(['general', 'latest'], T, null, RF),
    youtube: f(['general', 'popular'], ['all', 'video'], ['all', 'day', 'week', 'month', 'year'], RF),
    xianyu: f(null, null, null, null, false),
    taobao: f(null, null, null, null, false),
    jd: f(['general', 'sales', 'price_asc', 'price_desc', 'comments'], null, null, null),
    maoyan: f(null, null, null, ['recommend'], false),
    mteam: { ...f(null, null, null, null), order: ['date', 'size', 'seeders', 'leechers', 'name'] },
  }
}

// ---------- 作者页（AGENTS.md 7.9「作者页」） ----------

const BIOS = [
  '浙江安吉 · 带娃露营第 5 年 ⛺ 分享真实用过的装备和路线，不接硬广。周末大概率在山里，私信回复慢请见谅。',
  '周末出逃计划｜城市边缘的小众营地',
  null,
]

/** 演示用的作者：按作者 id 固定生成；有的缺简介、有的缺部分计数，用来演示头部的各种状态 */
export function mockUser(platform: string, ref: string, hint?: UserRef | null): Envelope<User> {
  // 演示作者页的 url 形如 https://example.com/<p>/user/<id>，取回 id，同一位作者的 url 和 id 得到同样的数据
  const id = decodeURIComponent(/\/user\/([^/?#]+)/.exec(ref)?.[1] ?? ref)
  const n = hash(`${platform}:${id}`)
  // 从卡片点进来时沿用卡片上的昵称和头像，演示时前后一致
  const name = hint?.name ?? AUTHORS[n % AUTHORS.length]!
  const missing = n % 5 === 1
  return {
    ok: true,
    data: {
      id,
      name,
      handle: `demo_${(n % 1e6).toString(36)}`,
      avatar: hint?.avatar ?? `https://picsum.photos/seed/ava-${id}/192/192`,
      url: `https://example.com/${platform}/user/${encodeURIComponent(id)}`,
      bio: BIOS[n % BIOS.length] ?? null,
      stats: {
        followers: 1000 + (n % 900_000),
        following: missing ? null : n % 900,
        items: 128,
        likes: missing ? null : 10_000 + (n % 9_000_000),
      },
    },
    page: null,
    error: null,
  }
}

/** 演示用的作品列表：沿用演示条目，作者都换成这位作者；一共 128 条，按 offset 分页 */
export function mockUserItems(platform: string, ref: string, offset: number, limit = 20, hint?: UserRef | null): Envelope<Item[]> {
  const user = mockUser(platform, ref, hint).data!
  const total = user.stats.items ?? 0
  const page = mockItems(platform, `@${user.id}`, Math.floor(offset / limit), limit)
  const author = { id: user.id, name: user.name, url: user.url, avatar: user.avatar }
  const data = page.data!.slice(0, Math.max(0, total - offset)).map((it) => ({ ...it, id: `${it.id}-u`, title: it.title?.replace(/ · @.*$/, '') ?? null, author }))
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

// 搜索联想与热搜的演示词（AGENTS.md 7.9「搜索联想与热搜」）
const HOT_WORDS = [
  '秋季露营装备清单', '城市周边小众营地', '天幕搭建教程', '露营灯横评', '车顶帐篷值不值',
  '户外咖啡器具', '带猫露营', '徒步路线推荐', '星空延时摄影', '铸铁锅食谱', '野餐布置灵感', '机能风穿搭',
]
const SUGGEST_TAILS = ['推荐', '教程', '装备清单', '怎么选', '新手入门', '避坑', '测评', '攻略', '平价替代', '2026']

export function mockHot(platform: string): Envelope<Keyword[]> {
  const seed = hash(platform)
  const words = HOT_WORDS.map((w, i) => ({ w, k: hash(`${seed}:${i}`) })).sort((a, b) => a.k - b.k)
  const data = words.slice(0, 10).map(({ w }, i) => ({ text: w, heat: Math.round(3_200_000 / (i + 1.2) + (seed % 9000)) }))
  return { ok: true, data, page: null, error: null }
}

export function mockSuggest(platform: string, prefix: string): Envelope<Keyword[]> {
  const q = prefix.trim()
  const seed = hash(`${platform}:${q}`)
  const n = 5 + (seed % 4)
  const data = Array.from({ length: n }, (_, i) => ({ text: `${q}${SUGGEST_TAILS[(seed + i * 3) % SUGGEST_TAILS.length]}`, heat: null }))
  return { ok: true, data: [...new Map(data.map((k) => [k.text, k])).values()], page: null, error: null }
}

/** 演示模式下读不到 /api/filters（纯静态预览）时，联想 / 热搜的能力表用这一份（与注册表一致） */
export const MOCK_KEYWORD_SUPPORT: Record<string, { suggest: boolean; hot: boolean }> = {
  xhs: { suggest: true, hot: true },
  jd: { suggest: true, hot: true },
  tiktok: { suggest: true, hot: false },
  youtube: { suggest: true, hot: false },
}

// ---------- 演示下载：帖子信息、评论（与 CLI 写的 ExportDoc 同结构） ----------

/** 演示用的 ExportDoc 选项：与 DownloadOptions 的 comments / replies 一致（0 表示不取） */
interface DemoExportOpts {
  comments: number | 'all'
  replies: number | 'all'
}

export interface DemoExportDoc {
  schema: 1
  platform: string
  exported_at: string
  item: Item
  comments: (Comment & { replies: Comment[] })[]
  comments_truncated: boolean
}

/** 演示：按条目生成帖子信息和评论；取 1000 条或全部时模拟遇到风控、在第 87 条停下 */
export function demoExport(platform: string, it: { id: string; url: string; title: string | null; cover: string | null; kind: string | null }, o: DemoExportOpts): DemoExportDoc {
  const user = (n: number): UserRef => ({ id: `demo-u${n}`, name: `演示用户 ${n}`, url: null, avatar: null })
  const total = 40 + (hash(`export:${it.id}`) % 200)
  const big = o.comments === 'all' || o.comments === 1000
  const want = o.comments === 0 ? 0 : o.comments === 'all' ? total : Math.min(o.comments, total)
  const got = big ? Math.min(want, 87) : want
  const perReply = o.replies === 0 ? 0 : o.replies === 'all' ? 4 : Math.min(o.replies, 4)
  const comment = (id: string, parent: string | null, n: number): Comment => ({
    id, item_id: it.id, parent_id: parent, author: user(n), text: parent ? `演示回复 ${n}` : `演示评论 ${n}：这是演示数据。`,
    media: [], created_at: new Date(Date.now() - n * 3600_000).toISOString(), stats: { likes: hash(id) % 300, replies: parent ? null : perReply },
  })
  return {
    schema: 1,
    platform,
    exported_at: new Date().toISOString(),
    item: {
      id: it.id, kind: (it.kind as Item['kind']) ?? 'image', url: it.url, title: it.title, text: it.title ? `${it.title}\n\n这是演示数据。` : '这是演示数据。',
      author: user(0), created_at: new Date(Date.now() - 86400_000).toISOString(), cover: it.cover, media: [],
      stats: { views: null, likes: hash(`likes:${it.id}`) % 9999, comments: total, collects: hash(`col:${it.id}`) % 999, shares: null },
      price: null, status: null,
    } as Item,
    comments: Array.from({ length: got }, (_, i) => ({
      ...comment(`${it.id}-c${i + 1}`, null, i + 1),
      replies: Array.from({ length: perReply }, (_, k) => comment(`${it.id}-c${i + 1}-r${k + 1}`, `${it.id}-c${i + 1}`, k + 1)),
    })),
    comments_truncated: big && want > got,
  }
}

/** 演示：一条帖子的纯文本（真实下载时由 bridge 生成） */
export function demoText(doc: DemoExportDoc): string {
  const { item } = doc
  const lines = [`标题：${item.title || '（无标题）'}`, `作者：${item.author?.name ?? ''}`, `链接：${item.url ?? ''}`, '', item.text ?? '', '']
  if (doc.comments.length) {
    lines.push(`评论（${doc.comments.length} 条${doc.comments_truncated ? '，遇到风控已停止' : ''}）`)
    for (const c of doc.comments) {
      lines.push(`${c.author?.name ?? ''}：${c.text}`)
      for (const r of c.replies) lines.push(`  ↳ ${r.author?.name ?? ''}：${r.text}`)
    }
  }
  return lines.join('\n')
}

// 12306 演示数据：取自 catbus 12306 的真实输出（2026-11-16 北京南 → 上海虹桥，已裁剪），日期在使用时换成查询的日期
/** 车站：[站名, 电报码, 拼音, 简拼, 城市] */
const RAIL_STATIONS: [string, string, string, string, string][] = [["上海","SHH","shanghai","sh","上海"],["上海南","SNH","shanghainan","shn","上海"],["上海虹桥","AOH","shanghaihongqiao","shhq","上海"],["上海西","SXH","shanghaixi","shx","上海"],["商河北","SOK","shanghebei","shb","济南"],["上海松江","IMH","shanghaisongjiang","shsj","上海"],["上杭","SNS","shanghang","sh","龙岩"],["北京北","VAP","beijingbei","bjb","北京"],["北京","BJP","beijing","bj","北京"],["北京南","VNP","beijingnan","bjn","北京"],["北京西","BXP","beijingxi","bjx","北京"],["北京大兴","IPP","beijingdaxing","bjdx","北京"],["北京朝阳","IFP","beijingchaoyang","bjcy","北京"],["北京丰台","FTP","beijingfengtai","bjft","北京"],["南京","NJH","nanjing","nj","南京"],["南京南","NKH","nanjingnan","njn","南京"],["杭州东","HGH","hangzhoudong","hzd","杭州"],["杭州","HZH","hangzhou","hz","杭州"],["杭州南","XHH","hangzhounan","hzn","杭州"],["杭州西","HVU","hangzhouxi","hzx","杭州"],["天津北","TBP","tianjinbei","tjb","天津"],["天津","TJP","tianjin","tj","天津"],["天津南","TIP","tianjinnan","tjn","天津"],["天津西","TXP","tianjinxi","tjx","天津"],["广州东","GGQ","guangzhoudong","gzd","广州"],["广州","GZQ","guangzhou","gz","广州"],["广州南","IZQ","guangzhounan","gzn","广州"],["深圳北","IOQ","shenzhenbei","szb","深圳"],["深圳东","BJQ","shenzhendong","szd","深圳"],["深圳","SZQ","shenzhen","sz","深圳"],["崇礼","KOP","chongli","cl","张家口"],["张家口","ZMP","zhangjiakou","zjk","张家口"],["张家口南","IXP","zhangjiakounan","zjkn","张家口"],["济南","JNK","jinan","jn","济南"],["济南东","MDK","jinandong","jnd","济南"],["济南西","JGK","jinanxi","jnx","济南"],["苏州北","OHH","suzhoubei","szb","苏州"],["宿州东","SRH","suzhoudong","szd","宿州"],["苏州","SZH","suzhou","sz","苏州"],["武汉","WHN","wuhan","wh","武汉"],["西安北","EAY","xianbei","xab","西安"],["西安","XAY","xian","xa","西安"],["厦门北","XKS","xiamenbei","xmb","厦门"]]
/** 直达：[车次, train_no, 始发站, 码, 终到站, 码, 出发站, 码, 站序, 到达站, 码, 站序, 出发, 到达, 历时, [席别, 余票（21 表示「有」）, 票价][]] */
type RailSeatRow = [string, number, number | null]
const RAIL_TICKETS: [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, RailSeatRow[]][] = [["G531","240000G53106","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","13","06:08","12:04","05:56",[["商务座",9,1744],["一等座",21,836],["二等座",1,498],["无座",40,498]]],["G547","240000G54700","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","13","06:18","12:11","05:53",[["商务座",20,1995],["一等座",21,929],["二等座",21,553],["优选一等座",21,1277],["无座",88,553]]],["G1","24000000G10L","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","07","06:30","11:24","04:54",[["商务座",13,1995],["一等座",21,1005],["二等座",21,598],["无座",48,598]]],["G3","24000000G320","北京南","VNP","上海","SHH","北京南","VNP","01","上海","SHH","05","06:52","11:33","04:41",[["商务座",18,2337],["一等座",21,1069],["二等座",21,667],["优选一等座",9,1468],["无座",66,667]]],["G565","240000G5650J","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","10","07:07","13:12","06:05",[["商务座",18,2315],["一等座",21,1005],["二等座",21,598],["无座",88,598]]],["G5","24000000G520","北京","BJP","上海","SHH","北京","BJP","01","上海","SHH","05","07:40","12:32","04:52",[["商务座",17,2350],["一等座",2,1075],["二等座",0,672],["无座",62,672]]],["G37","2400000G3730","北京南","VNP","杭州东","HGH","北京南","VNP","01","上海虹桥","AOH","05","07:52","12:35","04:43",[["商务座",12,2315],["一等座",21,1058],["二等座",0,661],["无座",78,661]]],["G5","24000000G520","北京","BJP","上海","SHH","北京南","VNP","02","上海","SHH","05","07:59","12:32","04:33",[["商务座",17,2337],["一等座",2,1069],["二等座",0,667],["无座",62,667]]],["G7","24000000G710","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","05","09:00","13:37","04:37",[["商务座",0,2420],["一等座",14,1107],["二等座",4,692],["无座",88,692]]],["G669","240000G66920","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","10","09:07","14:59","05:52",[["商务座",6,1870],["一等座",21,883],["二等座",1,525],["无座",87,525]]],["G9","24000000G907","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","05","10:00","14:35","04:35",[["商务座",17,2420],["一等座",21,1107],["二等座",21,692],["优选一等座",9,1522],["无座",88,692]]],["1461","240000146100","北京","BJP","上海","SHH","北京","BJP","01","上海","SHH","22","11:59","06:45","18:46",[["硬卧",0,283.5],["软卧",0,455.5],["硬座",21,156.5],["无座",312,156.5]]],["G2573","24000G257303","北京南","VNP","横店","HJU","北京南","VNP","01","上海虹桥","AOH","16","12:11","19:58","07:47",[["商务座",2,2045],["一等座",21,1010],["二等座",21,621],["无座",30,621]]],["G13","2400000G130E","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","04","16:00","20:28","04:28",[["商务座",15,2315],["一等座",21,1058],["二等座",21,661],["无座",66,661]]],["G25","2400000G2507","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","03","17:00","21:18","04:18",[["商务座",14,2156],["一等座",21,1033],["二等座",21,626],["优选一等座",8,1420],["无座",66,626]]],["D17","2400000D170O","北京","BJP","杭州","HZH","北京","BJP","01","上海松江","IMH","04","19:10","07:31","12:21",[["二等卧",0,447],["二等座",21,367],["一等卧",6,610],["无座",36,367]]],["Z281","330000Z28412","包头","BTC","杭州","HZH","北京丰台","FTP","11","上海松江","IMH","20","19:10","08:44","13:34",[["硬座",0,177.5],["软卧",0,476.5],["硬卧",0,304.5],["无座",147,177.5]]],["D7","24000000D72M","北京","BJP","上海","SHH","北京","BJP","01","上海","SHH","04","19:18","07:25","12:07",[["二等卧",21,440],["二等座",21,361],["一等卧",21,601],["无座",36,361]]],["G35","2400000G3530","北京南","VNP","上海虹桥","AOH","北京南","VNP","01","上海虹桥","AOH","04","19:24","23:51","04:27",[["商务座",5,2315],["一等座",21,1005],["二等座",21,598],["无座",80,598]]],["D9","24000000D90O","北京南","VNP","上海南","SNH","北京南","VNP","01","上海南","SNH","05","19:36","08:00","12:24",[["二等卧",21,476],["二等座",21,317],["一等卧",21,603]]],["T109","240000T10909","北京","BJP","上海","SHH","北京","BJP","01","上海","SHH","09","20:04","11:02","14:58",[["硬座",21,177.5],["软卧",0,476.5],["硬卧",0,304.5],["无座",156,177.5]]],["D5","24000000D520","北京","BJP","上海","SHH","北京","BJP","01","上海","SHH","05","21:21","09:27","12:06",[["二等卧",21,474],["二等座",21,361],["一等卧",21,644],["无座",36,361]]]]
/** 经停：train_no → [站, 到达, 出发, 停留][] */
const RAIL_ROUTES: Record<string, [string, string, string, string][]> = {"24000000G10L":[["北京南","----","06:30","----"],["沧州西","07:18","07:20","2分钟"],["德州东","07:45","07:47","2分钟"],["曲阜东","08:34","08:36","2分钟"],["南京南","10:13","10:15","2分钟"],["苏州北","10:59","11:01","2分钟"],["上海虹桥","11:24","11:24","----"]],"24000000G520":[["北京","----","07:40","----"],["北京南","07:54","07:59","5分钟"],["济南西","09:22","09:26","4分钟"],["南京南","11:23","11:25","2分钟"],["上海","12:32","12:32","----"]],"2400000G3730":[["北京南","----","07:52","----"],["济南西","09:14","09:18","4分钟"],["南京南","11:15","11:18","3分钟"],["镇江南","11:36","11:47","11分钟"],["上海虹桥","12:35","12:37","2分钟"],["嘉兴南","13:04","13:07","3分钟"],["杭州东","13:31","13:31","----"]],"240000146100":[["北京","----","11:59","----"],["广阳","12:53","12:55","2分钟"],["天津西","13:42","13:46","4分钟"],["青县","14:36","14:38","2分钟"],["沧州","15:01","15:07","6分钟"],["泊头","15:33","15:35","2分钟"],["吴桥","16:10","16:12","2分钟"],["德州","16:37","16:43","6分钟"],["平原","17:06","17:09","3分钟"],["禹城","17:30","17:33","3分钟"],["济南","18:23","18:31","8分钟"],["泰山","19:18","19:21","3分钟"],["磁窑","19:46","19:55","9分钟"],["兖州","20:30","20:33","3分钟"],["徐州","22:35","22:57","22分钟"],["宿州","23:44","23:47","3分钟"],["蚌埠","00:47","00:51","4分钟"],["南京","02:56","03:04","8分钟"],["常州","04:24","04:38","14分钟"],["无锡","05:05","05:09","4分钟"],["苏州","05:37","05:41","4分钟"],["上海","06:45","06:45","----"]],"24000000D72M":[["北京","----","19:18","----"],["沧州","21:29","21:31","2分钟"],["南京","04:52","04:58","6分钟"],["上海","07:25","07:25","----"]]}
/** 中转：[中转站, 同站, 同车, 种类, 出发, 到达, 全程分钟, 等候, [车次, train_no, 出发站, 到达站, 出发, 到达, 历时, 席别][]] */
const RAIL_TRANSFERS: [string, boolean, boolean, string, string, string, number, string, [string, string, string, string, string, string, string, RailSeatRow[]][]][] = [["南京南",true,true,"同车换座","2026-11-16 19:24","2026-11-16 23:51",267,"2分钟",[["G35","2400000G3530","北京南","南京南","19:24","22:49","03:25",[["商务座",0,1861],["一等座",0,808],["二等座",21,481],["无座",0,481]]],["G35","2400000G3530","南京南","上海虹桥","22:51","23:51","01:00",[["商务座",6,567],["一等座",5,246],["二等座",21,147],["无座",0,147]]]]],["南京南",true,true,"同车换座","2026-11-16 16:00","2026-11-16 20:28",268,"2分钟",[["G13","2400000G130E","北京南","南京南","16:00","19:24","03:24",[["商务座",0,1861],["一等座",3,851],["二等座",21,532],["无座",66,532]]],["G13","2400000G130E","南京南","上海虹桥","19:26","20:28","01:02",[["商务座",0,567],["一等座",21,260],["二等座",21,162],["无座",0,162]]]]],["南京南",true,true,"同车换座","2026-11-16 17:04","2026-11-16 21:36",272,"2分钟",[["G27","2400000G2720","北京南","南京南","17:04","20:26","03:22",[["商务座",7,1734],["一等座",0,831],["二等座",19,503],["无座",66,503]]],["G27","2400000G2720","南京南","上海虹桥","20:28","21:36","01:08",[["商务座",4,528],["一等座",21,253],["二等座",21,153],["无座",0,153]]]]],["苏州北",true,true,"同车换座","2026-11-16 14:00","2026-11-16 18:32",272,"2分钟",[["G19","2400000G190T","北京南","苏州北","14:00","18:08","04:08",[["商务座",0,2290],["一等座",2,1047],["二等座",0,654],["优选一等座",0,1440],["无座",0,654]]],["G19","2400000G190T","苏州北","上海虹桥","18:10","18:32","00:22",[["商务座",0,163],["一等座",21,75],["二等座",21,46],["优选一等座",3,103],["无座",0,46]]]]],["南京南",true,true,"同车换座","2026-11-16 15:00","2026-11-16 19:34",274,"2分钟",[["G21","2400000G210D","北京南","南京南","15:00","18:24","03:24",[["商务座",1,1946],["一等座",1,890],["二等座",21,556],["无座",66,556]]],["G21","2400000G210D","南京南","上海虹桥","18:26","19:34","01:08",[["商务座",0,592],["一等座",0,271],["二等座",21,170],["无座",0,170]]]]],["南京南",true,true,"同车换座","2026-11-16 10:00","2026-11-16 14:35",275,"2分钟",[["G9","24000000G907","北京南","南京南","10:00","13:24","03:24",[["商务座",1,1946],["一等座",0,890],["二等座",0,556],["优选一等座",0,1223],["无座",0,556]]],["G9","24000000G907","南京南","上海虹桥","13:26","14:35","01:09",[["商务座",0,592],["一等座",0,271],["二等座",3,170],["优选一等座",0,372],["无座",0,170]]]]],["南京南",true,true,"同车换座","2026-11-16 19:00","2026-11-16 23:35",275,"2分钟",[["G33","2400000G3340","北京南","南京南","19:00","22:14","03:14",[["商务座",1,1861],["一等座",0,808],["二等座",0,481],["无座",0,481]]],["G33","2400000G3340","南京南","上海","22:16","23:35","01:19",[["商务座",0,585],["一等座",7,255],["二等座",21,152],["无座",0,152]]]]]]

const railOk = <T>(data: T): Envelope<T> => ({ ok: true, data, page: null, error: null })
const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad2(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad2(((min % 60) + 60) % 60)}`
const minutesOf = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}
function railStation(text: string): { name: string; code: string; city: string } {
  const q = text.trim().toLowerCase()
  const hit = RAIL_STATIONS.find(([name, code, py]) => name === text.trim() || code.toLowerCase() === q || py === q)
  if (hit) return { name: hit[0], code: hit[1], city: hit[4] }
  // 表里没有的站：演示用，电报码按站名生成
  const code = String.fromCharCode(...[0, 1, 2].map((i) => 65 + (hash(`${text}${i}`) % 26)))
  return { name: text.trim(), code, city: text.trim() }
}
const railUrl = (from: { name: string; code: string }, to: { name: string; code: string }, date: string) =>
  `https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc&fs=${encodeURIComponent(`${from.name},${from.code}`)}&ts=${encodeURIComponent(`${to.name},${to.code}`)}&date=${date}&flag=N%2CN%2CY`
function railSeats(rows: RailSeatRow[]) {
  const remaining: Record<string, Remaining> = {}
  const seats: Record<string, string> = {}
  const prices: Record<string, { amount: number; currency: string }> = {}
  for (const [k, n, price] of rows) {
    remaining[k] = n >= 21 ? { min: 21 } : n
    seats[k] = n >= 21 ? '有' : n === 0 ? '无' : String(n)
    if (price != null) prices[k] = { amount: price, currency: 'CNY' }
  }
  return { remaining, seats, prices }
}
/** 北京 ↔ 上海这一段用真实数据（只有北京 → 上海方向） */
const railCanned = (from: string, to: string) => railStation(from).city === '北京' && railStation(to).city === '上海'

/** 车站联想：按站名、拼音、简拼、电报码匹配 */
export function mockStations(keyword: string): Envelope<Station[]> {
  const q = keyword.trim().toLowerCase()
  if (!q) return railOk([])
  const list = RAIL_STATIONS.filter(([name, code, py, abbr]) => name.includes(keyword.trim()) || py.startsWith(q) || abbr.startsWith(q) || code.toLowerCase() === q)
  return railOk(list.slice(0, 12).map(([name, code, pinyin, abbr, city]) => ({ id: code, name, code, pinyin, abbr, city, url: null })))
}

const RAIL_SEAT_SETS: Record<string, [string, number][]> = {
  G: [['商务座', 1900], ['一等座', 980], ['二等座', 590], ['无座', 590]],
  D: [['一等座', 520], ['二等座', 320], ['无座', 320]],
  C: [['一等座', 90], ['二等座', 55], ['无座', 55]],
  K: [['软卧', 420], ['硬卧', 280], ['硬座', 150], ['无座', 150]],
  T: [['软卧', 470], ['硬卧', 300], ['硬座', 170], ['无座', 170]],
  Z: [['软卧', 480], ['硬卧', 310], ['硬座', 180]],
}
const RAIL_VIA_POOL = ['石家庄', '郑州东', '济南西', '南京南', '武汉', '长沙南', '徐州东', '合肥南', '杭州东', '天津西']

/** 直达：北京 → 上海用真实数据；站名带「崇礼」时为空（演示「没有直达车次」）；其他站之间按种子生成 */
export function mockTickets(from: string, to: string, date: string): Envelope<Ticket[]> {
  if (`${from}${to}`.includes('崇礼')) return railOk([])
  if (railCanned(from, to)) {
    return railOk(
      RAIL_TICKETS.map(([id, train_no, sn, sc, en, ec, fn, fc, fno, tn, tc, tno, depart, arrive, duration, rows]) => ({
        id,
        url: railUrl({ name: fn, code: fc }, { name: tn, code: tc }, date),
        train_no,
        type: id[0]!,
        start: { code: sc, name: sn },
        end: { code: ec, name: en },
        from: { code: fc, name: fn, no: fno },
        to: { code: tc, name: tn, no: tno },
        depart,
        arrive,
        duration,
        date,
        bookable: true,
        has_ticket: rows.some(([, n]) => n > 0),
        ...railSeats(rows),
        seat_types: '',
      })),
    )
  }
  const a = railStation(from)
  const b = railStation(to)
  const seed = hash(`${a.name}>${b.name}@${date}`)
  const n = 8 + (seed % 7)
  const list: Ticket[] = Array.from({ length: n }, (_, i) => {
    const r = hash(`${seed}:${i}`)
    const type = ['G', 'G', 'G', 'D', 'D', 'K', 'T', 'C'][r % 8]!
    const slow = type === 'K' || type === 'T'
    const depart = 360 + Math.round((i * (slow ? 1000 : 900)) / n) + (r % 25)
    const dur = (slow ? 600 : 150) + (r % (slow ? 420 : 240))
    const id = `${type}${(r % 900) + 100}`
    const passStart = r % 5 === 0
    const passEnd = r % 7 === 1
    const rows: RailSeatRow[] = RAIL_SEAT_SETS[type]!.map(([k, price], j) => {
      const v = hash(`${r}:${j}`) % 30
      return [k, v > 22 ? 0 : v < 12 ? 21 : v - 10, price + (r % 60)]
    })
    return {
      id,
      url: railUrl(a, b, date),
      train_no: `24000${id.padStart(5, '0')}0`,
      type,
      start: passStart ? { code: 'XXX', name: RAIL_VIA_POOL[r % RAIL_VIA_POOL.length]! } : { code: a.code, name: a.name },
      end: passEnd ? { code: 'YYY', name: RAIL_VIA_POOL[(r >> 3) % RAIL_VIA_POOL.length]! } : { code: b.code, name: b.name },
      from: { code: a.code, name: a.name, no: passStart ? '03' : '01' },
      to: { code: b.code, name: b.name, no: '09' },
      depart: hhmm(depart),
      arrive: hhmm(depart + dur),
      duration: `${pad2(Math.floor(dur / 60))}:${pad2(dur % 60)}`,
      date,
      bookable: true,
      has_ticket: rows.some(([, v]) => v > 0),
      ...railSeats(rows),
      seat_types: '',
    }
  })
  return railOk(list.sort((x, y) => x.depart.localeCompare(y.depart)))
}

const RAIL_MID_POOL = ['廊坊', '沧州西', '德州东', '济南西', '泰安', '枣庄', '徐州东', '蚌埠南', '定远', '滁州', '南京南', '镇江南', '常州北', '无锡东', '苏州北']

/** 经停：真实数据里有的车次照搬，其余按出发、到达时间插值生成 */
export function mockRoute(t: Ticket): Envelope<Stop[]> {
  const real = RAIL_ROUTES[t.train_no]
  const raw: [string, string, string, string][] = real
    ? real
    : (() => {
        const names = [
          ...(t.start.name !== t.from.name ? [t.start.name] : []),
          t.from.name,
          ...RAIL_MID_POOL.filter((_, i) => (hash(t.id) >> i) % 3 === 0).slice(0, 5),
          t.to.name,
          ...(t.end.name !== t.to.name ? [t.end.name] : []),
        ]
        const d0 = minutesOf(t.depart)
        let d1 = minutesOf(t.arrive)
        if (d1 <= d0) d1 += 1440
        const fi = names.indexOf(t.from.name)
        const ti = names.indexOf(t.to.name)
        const step = (d1 - d0) / Math.max(1, ti - fi)
        return names.map((name, i) => {
          const at = Math.round(d0 + (i - fi) * step)
          const first = i === 0
          const last = i === names.length - 1
          return [name, first ? '----' : hhmm(at - 2), last ? '----' : hhmm(at), first || last ? '----' : '2分钟'] as [string, string, string, string]
        })
      })()
  const fi = raw.findIndex(([s]) => s === t.from.name)
  const ti = raw.findIndex(([s]) => s === t.to.name)
  return railOk(
    raw.map(([station, arrive, depart, stopover], i) => ({
      id: pad2(i + 1),
      station,
      arrive,
      depart,
      stopover,
      in_range: fi >= 0 && ti >= 0 ? i >= fi && i <= ti : true,
      url: null,
    })),
  )
}

/** 中转：北京 → 上海用真实数据（按中转站筛），其他站之间生成几种方案 */
export function mockTransfers(from: string, to: string, date: string, via?: string | null): Envelope<Transfer[]> {
  const a = railStation(from)
  const b = railStation(to)
  const leg = (l: [string, string, string, string, string, string, string, RailSeatRow[]], d: string): TransferLeg => {
    const [id, train_no, f, tt, depart, arrive, duration, rows] = l
    return { id, url: railUrl(railStation(f), railStation(tt), d), train_no, from: f, to: tt, depart, arrive, duration, ...railSeats(rows) }
  }
  if (railCanned(from, to)) {
    const day = (s: string) => `${date}${s.slice(10)}`
    return railOk(
      RAIL_TRANSFERS.filter(([v]) => !via || v === via).map(([v, same_station, same_train, kind, depart, arrive, mins, wait, legs]) => ({
        id: `${legs.map((l) => l[0]).join('+')}@${v}`,
        url: null,
        via: v,
        same_station,
        same_train,
        kind,
        depart: day(depart),
        arrive: day(arrive),
        duration_minutes: mins,
        wait,
        legs: legs.map((l) => leg(l, date)),
      })),
    )
  }
  const seed = hash(`${a.name}>${b.name}@${date}`)
  const plans = Array.from({ length: 4 }, (_, i): Transfer => {
    const r = hash(`${seed}:t${i}`)
    const v = via || RAIL_VIA_POOL[r % RAIL_VIA_POOL.length]!
    const same_train = i === 0
    const same_station = i !== 3
    const d0 = 420 + i * 150 + (r % 40)
    const l1 = 120 + (r % 90)
    const w = same_train ? 2 : 18 + (r % 60)
    const l2 = 90 + ((r >> 4) % 100)
    const id1 = `G${(r % 800) + 100}`
    const id2 = same_train ? id1 : `${i % 2 ? 'D' : 'G'}${((r >> 6) % 800) + 100}`
    const via2 = same_station ? v : `${v}西`
    const seats = (k: number): RailSeatRow[] => RAIL_SEAT_SETS.G!.map(([s, p], j) => [s, hash(`${r}${k}${j}`) % 30 > 20 ? 0 : 21, p])
    const mk = (id: string, f: string, tt: string, s: number, m: number, k: number): [string, string, string, string, string, string, string, RailSeatRow[]] =>
      [id, `24000${id}0`, f, tt, hhmm(s), hhmm(s + m), `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`, seats(k)]
    const total = l1 + w + l2
    return {
      id: `${id1}+${id2}@${v}`,
      url: null,
      via: v,
      same_station,
      same_train,
      kind: same_train ? '同车换座' : '换乘',
      depart: `${date} ${hhmm(d0)}`,
      arrive: `${date} ${hhmm(d0 + total)}`,
      duration_minutes: total,
      wait: w >= 60 ? `${Math.floor(w / 60)}小时${w % 60}分钟` : `${w}分钟`,
      legs: [leg(mk(id1, a.name, v, d0, l1, 1), date), leg(mk(id2, via2, b.name, d0 + l1 + w, l2, 2), date)],
    }
  })
  return railOk(plans)
}
