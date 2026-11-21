import type { BonusRate, BonusRecord, Category, Envelope, Exam, Item, SeedStats } from '../types'
import { hash } from './shared'

// ---------- M-Team（AGENTS.md 7.9「M-Team「我的」页与筛选」「推送到 qBittorrent」） ----------
// 取自真实输出的裁剪：账号信息换成假的，封面用 picsum，不带站点的签名链接

const MT_GIB = 1024 ** 3
/** [种子名, 中文名 | 其余, 体积, 做种, 下载, 优惠, 子类] */
const MT_ROWS: [string, string, number, number, number, string, string][] = [
  ['My Secretary S02E10 1080p friDay WEB-DL AAC2.0 H.264-MWeb', '任何事都为你做 - 秘书镇2 | 2026 | 第10集', 6025796951, 1, 442, 'FREE', '402'],
  ['The Vermilion Mask S01E06 1080p LINETV WEB-DL AAC2.0 H.264-MWeb', '朱色的面具 | 朱色の仮面 | 第06集', 931130475, 403, 84, 'FREE', '405'],
  ['The Vermilion Mask S01E06 1080p Baha WEB-DL AAC2.0 H.264-MWeb', '朱色的面具 | 朱色の仮面 | 巴哈版', 381244615, 346, 66, 'FREE', '405'],
  ['The Confession Truth S01E33 2160p WEB-DL HEVC HDR DDP5.1-MWeb', '杀人真相 | 第33集 | 4K HDR', 2096949293, 537, 34, 'FREE', '402'],
  ['The Confession Truth S01E33 1080p WEB-DL H.264 AAC-MWeb', '杀人真相 | 第33集', 578943612, 404, 22, 'PERCENT_50', '402'],
  ['mametomugi S01E07 1080p NF WEB-DL DDP2.0 H.264-MWeb', '小麦与黄油与复仇 | 第07集', 806248951, 377, 22, 'FREE', '402'],
  ['Please Excuse My Younger Brothers S01E19 1080p WEB-DL', '我家的弟弟们真是让您费心了 | 第19集', 374434552, 318, 14, 'NORMAL', '405'],
  ['Tougen Anki S01E07 1080p CR WEB-DL AAC2.0 H.264', '桃源暗鬼 | 第07集', 502499789, 280, 11, '_2X_FREE', '405'],
  ['Stand Straight Don\'t Bend Over 1993 BluRay 1080p DD1.0 x264-BMDru', '站直啰，别趴下 | 1993 | 黄建新', 14055966815, 166, 4, 'NORMAL', '419'],
  ['Small Town Remedy 2026 S01 2160p WEB-DL HEVC DDP5.1-MWeb', '小城良方 | 2026 | 全24集', 59753019535, 195, 132, 'PERCENT_50', '402'],
  ['Tales of Herding Gods S01 2024 1080p WEB-DL H.264 AAC', '牧神记 | 2024 | 动画', 47 * MT_GIB, 47, 56, 'NORMAL', '405'],
  ['Perfect World 2021 S01E233-E269 1080p WEB-DL H.264', '完美世界 | 第233-269集', 20 * MT_GIB, 88, 9, '_2X', '405'],
  ['Kind Hearts 2025 2160p WEB-DL HEVC DV DDP5.1-MWeb', '仁心 | 2025 | 电影', 18 * MT_GIB, 912, 40, 'FREE', '401'],
  ['Night Train To Lisbon 2013 BluRay 1080p DTS x264', '里斯本夜车 | 2013 | 电影', 11 * MT_GIB, 64, 2, 'NORMAL', '419'],
  ['Yu Garden Jazz Live 2025 FLAC 24bit', '豫园爵士现场 | 2025 | FLAC', 2 * MT_GIB, 31, 1, 'PERCENT_50', '406'],
  ['Mountain Diaries S01 2026 1080p WEB-DL', '山中日记 | 2026 | 纪录片', 9 * MT_GIB, 120, 6, 'FREE', '404'],
]
const MT_CATS = new Set(['401', '419', '420', '402', '403', '405', '406', '404', '427', '434', '410', '424'])
/** 分区 → 这个分区里的子类（与 mockCategories 一致） */
const MT_MODE_CATS: Record<string, string[]> = {
  normal: ['401', '419', '420', '402', '403', '405', '406', '404', '427', '434'],
  movie: ['401', '419', '420'],
  tvshow: ['402', '403'],
  music: ['406', '434'],
  anime: ['405'],
  adult: ['410', '424'],
}

function mtTorrent(n: number, salt = '', text?: string): Item {
  const row = MT_ROWS[n % MT_ROWS.length]!
  const id = String(1291906 - n * 17 - (hash(salt) % 13))
  const [title, zh, size, seeders, leechers, discount] = row
  return {
    id,
    kind: 'torrent',
    url: `https://kp.m-team.cc/detail/${id}`,
    title,
    text: text ?? zh,
    author: null,
    created_at: new Date(Date.now() - (n * 37 + (hash(salt) % 30)) * 60_000).toISOString(),
    // 每 9 条一条没有封面：演示没有海报时的卡片
    cover: n % 9 === 5 ? null : `https://picsum.photos/seed/mt-${id}/400/600`,
    media: [],
    stats: { views: null, likes: null, comments: null, collects: null, shares: null },
    price: null,
    status: null,
    size,
    file_count: 1 + (n % 24),
    // 每 11 条一条没人做种：演示做种为 0 标红
    seeders: n % 11 === 7 ? 0 : seeders,
    leechers,
    completed: 0,
    discount,
  }
}

/** 浏览 / 搜索：按分区、分类、只看免费换一批；`category` 可以是逗号分隔的几个子类 */
export function mockTorrents(keyword: string, offset: number, limit: number, mode = 'normal', category = '', free = false, order = ''): Envelope<Item[]> {
  const cats = category ? category.split(',') : (MT_MODE_CATS[mode] ?? MT_MODE_CATS.normal!)
  const seed = hash(`${keyword}:${mode}:${category}:${free}:${order}`) % 50
  const pool: Item[] = []
  for (let n = 0; pool.length < offset + limit && n < 400; n++) {
    const row = MT_ROWS[(seed + n) % MT_ROWS.length]!
    // 分类不在演示表里的分区（成人）也给结果：按分区换一批
    if (MT_CATS.has(row[6]) && !cats.includes(row[6]) && !(mode === 'adult')) continue
    if (free && row[5] !== 'FREE' && row[5] !== '_2X_FREE') continue
    const it = mtTorrent(seed + n, `${mode}:${category}`)
    if (keyword) it.title = `${it.title} ${keyword}`
    pool.push(it)
  }
  // 分类组合太窄时演示只有半页（能看到没有更多）
  const total = category ? 14 : 100
  const data = pool.slice(offset, Math.min(offset + limit, total))
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total && data.length > 0 }, error: null }
}

export function mockCategories(): Envelope<Category[]> {
  const c = (id: string, name: string, parent_id: string | null = null): Category => ({ id, name, parent_id })
  return {
    ok: true,
    data: [
      c('100', '电影'), c('401', '电影/SD', '100'), c('419', '电影/HD', '100'), c('420', '电影/DVDiSo', '100'), c('421', '电影/Blu-Ray', '100'), c('439', '电影/Remux', '100'),
      c('105', '影剧/综艺'), c('403', '影剧/综艺/SD', '105'), c('402', '影剧/综艺/HD', '105'), c('435', '影剧/综艺/DVDiSo', '105'), c('438', '影剧/综艺/BD', '105'),
      c('110', 'Music'), c('406', '演唱', '110'), c('434', 'Music(无损)', '110'),
      c('444', '纪录'), c('404', '纪录', '444'),
      c('447', '运动'), c('407', '运动', '447'),
      c('449', '动漫'), c('405', '动画', '449'),
      c('450', '其他'), c('427', '电子书', '450'), c('409', 'Misc(其他)', '450'),
      c('115', 'AV(有码)'), c('410', 'AV(有码)/HD Censored', '115'),
      c('120', 'AV(无码)'), c('424', 'AV(无码)/HD Uncensored', '120'),
      c('445', 'IV'), c('425', 'IV(写真影集)', '445'),
      c('446', 'H-ACG'), c('431', 'H-ACG(漫画)', '446'),
    ],
    page: null,
    error: null,
  }
}

export function mockSeedStats(): Envelope<SeedStats> {
  return { ok: true, data: { seeding: 67, leeching: 0 }, page: null, error: null }
}

export function mockBonusRate(): Envelope<BonusRate> {
  return { ok: true, data: { per_hour: 46.579, a: 1107.38, seeding_count: 50, seeding_size_gb: 614.2, two_factor: false }, page: null, error: null }
}

export function mockExams(): Envelope<Exam[]> {
  const day = 86_400_000
  const start = new Date(Date.now() - 13 * day)
  const end = new Date(Date.now() + 2 * day + 5 * 3_600_000)
  return {
    ok: true,
    data: [
      {
        id: '17',
        title: '新人考核',
        status: 'ONGOING',
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        note: '考核期间下载量、上传量和魔力值需同时达标，未通过的账号将被禁用。',
        items: [
          { name: 'download', current: 214.6 * MT_GIB, target: 120 * MT_GIB, done: true },
          { name: 'upload', current: 286.3 * MT_GIB, target: 400 * MT_GIB, done: false },
          { name: 'bonus', current: 9820, target: 6000, done: true },
        ],
      },
    ],
    page: null,
    error: null,
  }
}

/** 本账号的上传 / 下载 / 分享率写在 text 前三行（与 CLI 一致）；「下载中」为空，演示空态 */
const MT_MINE: [string, string, string][] = [
  ['1.57 GiB', '12.93 GiB', '0.121'],
  ['286.30 GiB', '4.20 GiB', '68.115'],
  ['55.03 GiB', '44.38 GiB', '1.240'],
  ['53.98 GiB', '68.17 GiB', '0.792'],
  ['37.74 GiB', '12.72 GiB', '2.966'],
  ['14.86 GiB', '26.90 GiB', '0.552'],
  ['0 B', '8.03 GiB', '0.000'],
  ['10.33 GiB', '20.50 GiB', '0.504'],
]
export function mockSeedList(status: string, offset: number, limit: number): Envelope<Item[]> {
  const total = { seeding: 67, leeching: 0, completed: 31, incomplete: 3, uploaded: 0 }[status] ?? 0
  const data = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => {
    const n = offset + i + hash(status) % 7
    const [up, down, ratio] = MT_MINE[n % MT_MINE.length]!
    const row = MT_ROWS[n % MT_ROWS.length]!
    // 每 13 条一条解析不出来的 text：演示原样显示
    const text = n % 13 === 12 ? `做种时间 3 天\n${row[1]}` : `上传：${up}\n下载：${down}\n分享率：${ratio}\n${row[1]}` // i18n-ignore
    return mtTorrent(n, status, text)
  })
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

const MT_NOTES: [string, number, boolean][] = [
  ['做种积分；考核期间无加成', 46.3, false], // i18n-ignore 演示数据
  ['促销：50%；考核期间；上传：323.17 MiB', 0, true],
  ['促销：免费；上传：1.51 GiB', 0, true],
  ['做种积分', 45.9, false],
  ['下载：6.02 GiB', 0, true],
  ['兑换上传量：10.00 GiB', -2500, false],
  ['考核期间；上传：88.40 MiB', 0, true],
  ['做种积分；考核期间无加成', 46.1, false],
]
export function mockBonusHistory(offset: number, limit: number): Envelope<BonusRecord[]> {
  const total = 90
  const data: BonusRecord[] = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => {
    const k = offset + i
    const [note, change, torrent] = MT_NOTES[k % MT_NOTES.length]!
    const tid = 1282019 - k * 31
    return {
      id: String(9_800_000 - k),
      // 每小时一条，跨越今天、昨天和更早
      time: new Date(Date.now() - (k * 47 + 8) * 60_000).toISOString(),
      type: torrent ? 'TORRENT' : 'BONUS',
      before: null,
      after: null,
      change,
      user: null,
      note,
      url: torrent ? `https://kp.m-team.cc/detail/${tid}` : null,
    }
  })
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

/** 收藏：综合区有几条，其他分区为空 */
export function mockCollects(mode: string): Envelope<Item[]> {
  const data = mode === 'normal' ? [2, 9, 12, 13, 15].map((n) => mtTorrent(n, 'collect')) : []
  return { ok: true, data, page: { cursor: null, has_more: false }, error: null }
}

/** 推送到 qBittorrent 的演示结果：大约每三条一条「已在任务列表」、一条连不上；重试后成功 */
export function mockQbit(itemId: string, attempt: number): 'added' | 'exists' | 'failed' {
  if (attempt > 0) return 'added'
  const r = hash(`qbit:${itemId}`) % 3
  return r === 0 ? 'added' : r === 1 ? 'exists' : 'failed'
}
