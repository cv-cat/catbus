import type { Envelope, Item, Poi } from '../types'
import { hash } from './shared'

// ---------- 猫眼演出（AGENTS.md 7.9「猫眼演出的城市」「猫眼演出的场次与票档」） ----------

const SHOW_TITLES = [
  '开心麻花惊怂爆笑贺岁大戏《出马》',
  '【{city}】2026 跨年演唱会',
  '黑灯单口喜剧专场《先上车》',
  '烛光音乐会·久石让作品选',
  '原版音乐剧《猫》巡演',
  '话剧《雷雨》经典复排',
  '沉浸式悬疑剧场《第七夜》',
  '交响音乐会：贝多芬第九',
  '迪士尼百年特展',
  '脱口秀周末大会',
]
const SHOW_CATEGORIES = ['话剧音乐剧', '演唱会', '脱口秀', '音乐会', '音乐剧', '话剧', '话剧音乐剧', '音乐会', '休闲展览', '脱口秀']
const SHOW_PERFORMERS = ['开心麻花', '许嵩', '黑灯', 'Candlelight', '原版音乐剧团', '北京人艺', '黑盒剧场', '国家交响乐团', null, '笑果文化']
/** 场馆：{city} 换成演出所在的城市，地址用各地都常见的路名，不和城市对不上 */
const SHOW_VENUES = ['{city}大剧院（文化路88号）', '{city}体育馆（体育路1号）', '{city}喜剧中心（人民路20号）', '开心麻花剧场·{city}站（中山路120号）']
const SHOW_TIERS: [string, number][] = [['N', 80], ['L', 180], ['I', 280], ['F', 380], ['D', 480], ['C', 680], ['B', 880], ['A', 1080]]
/** 演示条目属于哪个城市（详情、场次要用） */
export const showCity = new Map<string, string>()

/** 演示城市表（poi search 的子串匹配用） */
const DEMO_CITIES = '北京 上海 广州 深圳 成都 杭州 南京 武汉 西安 重庆 天津 苏州 扬州 福州 常州 温州 湖州 衢州 郑州 兰州 长沙 厦门 青岛 大连 沈阳 哈尔滨 昆明 合肥 济南 宁波 无锡 呼和浩特 乌鲁木齐 上饶'.split(' ')

export function mockCities(keyword: string): Envelope<Poi[]> {
  const kw = keyword.trim()
  const data = DEMO_CITIES.flatMap((name, i) => (name.includes(kw) ? [{ id: String(i + 1), name, address: null }] : []))
  return { ok: true, data, page: { cursor: null, has_more: false }, error: null }
}

/**
 * 演示的演出列表：卡片（分类、演出者、开售）都从 text 里取；城市换一批（`city` 进种子）。
 * 第一页固定两条：`-auth` 查场次时报未登录，`-soon` 还没有场次。
 */
export function mockShows(city: string, page: number, limit = 20): Envelope<Item[]> {
  const name = city || '北京'
  const seed = hash(`maoyan:${name}`)
  const data: Item[] = Array.from({ length: limit }, (_, i) => {
    const n = seed + page * limit + i
    const k = n % SHOW_TITLES.length
    const suffix = page === 0 && i === 1 ? '-auth' : page === 0 && i === 2 ? '-soon' : ''
    const id = `maoyan-${(n % 1e8).toString(36)}${suffix}`
    showCity.set(id, name)
    const performer = SHOW_PERFORMERS[k] ?? null
    const soon = suffix === '-soon' || n % 5 === 0
    const sale = soon ? new Date(Date.now() + (1 + (n % 3)) * 864e5 + 3_600_000) : new Date(Date.now() - 30 * 864e5)
    const lines = [`分类：${SHOW_CATEGORIES[k]}`, performer && `演出者：${performer}`, `开售：${soon ? '后天开售' : '已开售'}`, `开售时间：${sale.toISOString()}`]
    return {
      id,
      kind: 'goods',
      url: `https://show.maoyan.com/qqw#/detail/${id}`,
      title: SHOW_TITLES[k]!.replace('{city}', name),
      text: lines.filter(Boolean).join('\n'),
      author: performer ? { id: String(k), name: performer, url: null, avatar: k % 2 ? `https://picsum.photos/seed/show-ava-${k}/96/96` : null } : null,
      created_at: null,
      cover: `https://picsum.photos/seed/${id}/540/750`,
      media: [],
      stats: { views: null, likes: null, comments: null, collects: null, shares: null },
      price: { amount: SHOW_TIERS[n % 4]![1], currency: 'CNY' },
      status: null,
    }
  })
  // 与 CLI 一样一次返回全部，没有分页
  return { ok: true, data, page: { cursor: null, has_more: false }, error: null }
}

/** 演示的演出详情：时间、城市、场馆、票价各一行，media 是详情长图 */
export function mockShowDetail(item: Item): Item {
  const n = hash(item.id)
  const city = showCity.get(item.id) ?? '北京'
  const day = (k: number) => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10).replace(/-/g, '.')
  const text = [
    `时间：${day(1)} - ${day(15).slice(5)}`,
    `城市：${city}`,
    `场馆：${SHOW_VENUES[n % SHOW_VENUES.length]!.replace('{city}', city)}`,
    `票价：${SHOW_TIERS[0]![1]}、${SHOW_TIERS[SHOW_TIERS.length - 1]![1]}`,
    '状态：立即预定',
  ].join('\n')
  const media: Item['media'] = [0, 1].map((i) => ({ id: null, type: 'image', url: `https://picsum.photos/seed/${item.id}-d${i}/731/${380 + i * 300}`, width: 731, height: 380 + i * 300, duration: null }))
  return { ...item, text, media }
}

/** 演示的场次与票档：几场里有整场售罄、打折（票面价划线）、余票不足（标红）和一场没有票档 */
export function mockShowTickets(item: Item): Envelope<Item> {
  if (item.id.endsWith('-auth')) {
    return { ok: false, data: null, page: null, error: { code: 'AUTH_REQUIRED', message: '未登录 maoyan (web)', hint: 'catbus maoyan auth login', detail: null } }
  }
  const base = mockShowDetail(item)
  if (item.id.endsWith('-soon')) return { ok: true, data: base, page: null, error: null }
  const n = hash(item.id)
  const lines: string[] = []
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  for (let s = 0; s < 7; s++) {
    const at = new Date(Date.now() + (s + 1) * 864e5)
    const matinee = s % 3 === 1
    const iso = `${at.toISOString().slice(0, 10)}T${matinee ? '14:30' : '19:30'}:00+08:00`
    const d = new Date(iso)
    lines.push(`场次：${iso.slice(0, 10)} ${WEEK[d.getUTCDay()]} ${matinee ? '14:30' : '19:30'}`, `场次时间：${iso}`)
    if (s === 5) continue // 这一场暂时没有票档
    const allGone = s === 2
    const sale = s === 3 || s === 4
    SHOW_TIERS.forEach(([name, face], j) => {
      const sell = sale && j >= 2 ? Math.round(face * 0.6) : face
      const stock = allGone || j === 0 || (j === 2 && s % 2 === 0) ? 0 : (n + s + j) % 7 === 0 ? 3 : j === 6 && sale ? 4 : 6
      lines.push(`票档：${name}，票面价 ${face}，实售价 ${sell}，余票 ${stock}，限购 6${stock === 0 ? '，售罄' : ''}`)
    })
  }
  return { ok: true, data: { ...base, text: `${base.text}\n${lines.join('\n')}` }, page: null, error: null }
}
