import type { Account, Comment, Envelope, Item, User, UserRef } from './types'

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
export function mockItems(platform: string, keyword: string, page: number, limit = 20, variant = ''): Envelope<Item[]> {
  const seed = hash(variant ? `${platform}:${keyword}:${variant}` : `${platform}:${keyword}`)
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
export function mockFilters(): Record<string, { search: boolean; sort: string[] | null; type: string[] | null; time: string[] | null; kind: string[] | null; order: string[] | null }> {
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
    weibo: f(null, null, null, null),
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
