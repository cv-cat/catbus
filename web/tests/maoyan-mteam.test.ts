import { afterEach, describe, expect, it, vi } from 'vitest'
import { discounted, firstOpen, money, parseSessions, sessionLines, sessionTitle, stockOf, type Tier } from '@/composables/tickets'
import { showInfo, yuan } from '@/composables/show'
import { torrentInfo } from '@/composables/torrent'
import { item } from './fixtures'

const tier = (over: Partial<Tier>): Tier => ({ name: 'A', face: null, sell: null, stock: null, limit: null, soldOut: false, ...over })

describe('猫眼场次与票档（4.8、7.9「猫眼演出的场次与票档」）', () => {
  const text = [
    '分类：演唱会',
    '场次：2026-11-14 周六 19:30',
    '场次时间：2026-11-14T19:30:00+08:00',
    '票档：A，票面价 1080，实售价 648，余票 3，限购 6',
    '票档：B，票面价 380，实售价 380，余票 0，限购 6',
    '场次：2026-11-15 周日 19:30',
    '票档：L，票面价 1280，售罄',
    '票档：M，实售价 99.5',
  ].join('\n')

  it('按行拆出场次和票档，取不到的项为 null', () => {
    const s = parseSessions(text)
    expect(s).toHaveLength(2)
    expect(s[0]!.name).toBe('2026-11-14 周六 19:30')
    expect(s[0]!.at).toBe(Date.parse('2026-11-14T19:30:00+08:00'))
    expect(s[0]!.tiers).toEqual([
      { name: 'A', face: 1080, sell: 648, stock: 3, limit: 6, soldOut: false },
      // 余票 0 视为售罄
      { name: 'B', face: 380, sell: 380, stock: 0, limit: 6, soldOut: true },
    ])
    expect(s[1]!.at).toBeNull()
    expect(s[1]!.tiers).toEqual([
      { name: 'L', face: 1280, sell: null, stock: null, limit: null, soldOut: true },
      { name: 'M', face: null, sell: 99.5, stock: null, limit: null, soldOut: false },
    ])
  })

  it('没有场次行（还没开票）时为空；场次之前的票档行忽略', () => {
    expect(parseSessions('分类：话剧\n开售：明天开售')).toEqual([])
    expect(parseSessions(null)).toEqual([])
    expect(parseSessions('票档：A，票面价 1')).toEqual([])
  })

  it('场次时间解析不了时为 null', () => {
    expect(parseSessions('场次：x\n场次时间：乱写')[0]!.at).toBeNull()
  })

  it('一场全部售罄才算售罄；没有票档的场次不算售罄', () => {
    const s = parseSessions('场次：a\n票档：A，售罄\n场次：b\n场次：c\n票档：A，余票 1')
    expect(s.map((x) => x.soldOut)).toEqual([true, false, false])
    expect(firstOpen(s)).toBe(1)
    expect(firstOpen(parseSessions('场次：a\n票档：A，售罄'))).toBe(0)
    expect(firstOpen([])).toBe(0)
  })

  it('余票显示：售罄 / 有票 / 余 N 张（少于限购标红）', () => {
    expect(stockOf(tier({ soldOut: true }))).toEqual({ kind: 'soldOut' })
    expect(stockOf(tier({ stock: null }))).toEqual({ kind: 'plenty' })
    expect(stockOf(tier({ stock: 6, limit: 6 }))).toEqual({ kind: 'plenty' })
    expect(stockOf(tier({ stock: 8, limit: 6 }))).toEqual({ kind: 'plenty' })
    expect(stockOf(tier({ stock: 2, limit: 6 }))).toEqual({ kind: 'few', n: 2, warn: true })
    expect(stockOf(tier({ stock: 2 }))).toEqual({ kind: 'few', n: 2, warn: false })
  })

  it('票面价与实售价不同时才划线', () => {
    expect(discounted(tier({ face: 100, sell: 80 }))).toBe(true)
    expect(discounted(tier({ face: 100, sell: 100 }))).toBe(false)
    expect(discounted(tier({ face: 100 }))).toBe(false)
  })

  it('场次卡按北京时间显示；没有开始时间时拆场次名', () => {
    const [s] = parseSessions(text)
    expect(sessionLines(s!)).toEqual(['11月14日', '周六 19:30'])
    expect(sessionTitle(s!)).toBe('11月14日 周六 19:30')
    const plain = { name: '2026-11-15 周日 19:30', at: null, tiers: [], soldOut: false }
    expect(sessionLines(plain)).toEqual(['2026-11-15', '周日 19:30'])
    expect(sessionTitle(plain)).toBe('2026-11-15 周日 19:30')
    expect(sessionLines({ ...plain, name: '待定' })).toEqual(['待定', ''])
  })

  it('金额', () => {
    expect(money(648)).toBe('¥648')
    expect(money(99.5)).toBe('¥99.50')
    expect(money(null)).toBe('')
  })
})

describe('演出卡片 / 详情（7.9「演出卡片」「演出详情」）', () => {
  afterEach(() => vi.useRealTimers())

  const listText = '分类：演唱会\n演出者：甲、乙\n开售：明天开售\n开售时间：2026-11-17T12:00:00+08:00'
  const detailText = '时间：2026.11.20 19:30\n城市：北京\n场馆：国家体育馆（天辰东路9号）\n票价：380、680、1080'

  it('只认 maoyan', () => {
    expect(showInfo(item(), null, 'xhs')).toBeNull()
    expect(showInfo(null, null, 'maoyan')).toBeNull()
  })

  it('分类、演出者、开售取自列表那一条，其余取自详情', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-16T12:00:00+08:00') })
    const info = showInfo(item({ text: detailText, price: { amount: 380, currency: 'CNY' } }), item({ text: listText }), 'maoyan')!
    expect(info.category).toBe('演唱会')
    expect(info.performers).toBe('甲、乙')
    expect(info.saleText).toBe('明天开售')
    expect(info.saleAt).toBe(Date.parse('2026-11-17T12:00:00+08:00'))
    expect(info.upcoming).toBe('明天开售')
    expect(info.city).toBe('北京')
    expect(info.venue).toBe('国家体育馆')
    expect(info.address).toBe('天辰东路9号')
    expect(info.prices).toEqual(['380', '680', '1080'])
    expect(info.price).toBe('¥380')
  })

  it('开售时间已过时算已开售', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-18T12:00:00+08:00') })
    expect(showInfo(item({ text: listText }), null, 'maoyan')!.upcoming).toBeNull()
  })

  it('没有开售时间时按开售文案判断', () => {
    expect(showInfo(item({ text: '开售：已开售' }), null, 'maoyan')!.upcoming).toBeNull()
    expect(showInfo(item({ text: '' }), null, 'maoyan')!.upcoming).toBeNull()
    expect(showInfo(item({ text: '开售：即将开售' }), null, 'maoyan')!.upcoming).toBe('即将开售')
  })

  it('场馆没有括号时整段是场馆名；没有演出者时用作者名', () => {
    const info = showInfo(item({ text: '场馆：某剧场', author: { id: 'u', name: '某人', url: null } }), null, 'maoyan')!
    expect(info.venue).toBe('某剧场')
    expect(info.address).toBeNull()
    expect(info.performers).toBe('某人')
    expect(info.prices).toEqual([])
    expect(info.price).toBeNull()
  })

  it('yuan', () => {
    expect(yuan(380)).toBe('¥380')
    expect(yuan(1.5)).toBe('¥1.50')
  })
})

describe('种子卡片 / 详情（7.9「种子卡片」）', () => {
  const t = (over = {}) => item({ kind: 'torrent', title: 'Movie.2026.2160p', text: '电影名 | 2026 | 剧情', size: 22_333_829_939, seeders: 3, leechers: 0, file_count: 2, ...over })

  it('不是种子时为 null', () => {
    expect(torrentInfo(item())).toBeNull()
    expect(torrentInfo(null)).toBeNull()
  })

  it('中文名取 text 的第一段，种子名降为第二行', () => {
    const info = torrentInfo(t())!
    expect(info.title).toBe('电影名')
    expect(info.name).toBe('Movie.2026.2160p')
    expect(info.size).toBe('20.8 GB')
    expect(info.files).toBe(2)
    expect(info.seeders).toBe(3)
  })

  it('详情的 text 是整段简介：中文名从列表那一条取，取不到时种子名当标题', () => {
    expect(torrentInfo(t({ text: '简介\n第二行' }), t())!.title).toBe('电影名')
    const solo = torrentInfo(t({ text: '简介\n第二行' }))!
    expect(solo.title).toBe('Movie.2026.2160p')
    expect(solo.name).toBe('')
  })

  it('优惠标签：已知代码转写，NORMAL / null 不显示，不认识的原样', () => {
    const d = (discount: string | null) => torrentInfo(t({ discount }))!
    expect(d('FREE')).toMatchObject({ discount: 'FREE', free: true })
    expect(d('_2X_FREE')).toMatchObject({ discount: '2X FREE', free: true })
    expect(d('PERCENT_50')).toMatchObject({ discount: '50%', free: false })
    expect(d('PERCENT_70').discount).toBe('30%')
    expect(d('_2X').discount).toBe('2X')
    expect(d('_2X_PERCENT_50').discount).toBe('2X 50%')
    expect(d('NORMAL').discount).toBeNull()
    expect(d(null).discount).toBeNull()
    expect(d('WEIRD').discount).toBe('WEIRD')
  })
})
