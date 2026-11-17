import type { Comment, Envelope, Item } from '../types'
import { mockShowDetail, mockShows, showCity } from './maoyan'
import { COMMENTS, DEMO_VIDEO, TAGS, TEXTS, TITLES, demoAuthor, hash } from './shared'

export function mockItems(platform: string, keyword: string, page: number, limit = 20, variant = '', shift = 0): Envelope<Item[]> {
  // 猫眼演出：演出卡片（variant 是城市，见 client.ts）
  if (platform === 'maoyan') return mockShows(variant, page, limit)
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

export function mockItem(item: Item): Envelope<Item> {
  if (showCity.has(item.id)) return { ok: true, data: mockShowDetail(item), page: null, error: null }
  const n = hash(item.id)
  // 种子：详情的 text 是整段 BBCode 简介（种子详情按块渲染）
  if (item.kind === 'torrent') {
    const zh = (item.text ?? '').split('\n').find((l) => l.includes('|')) ?? item.title ?? ''
    const text = `[img]https://picsum.photos/seed/mt-intro-${item.id}/800/450[/img]\n[b]${zh}[/b]\n\n[quote]演示简介：这里是站点的种子简介。[/quote]\n[code]${item.title ?? ''}\nVideo: HEVC 2160p\nAudio: DDP 5.1[/code]` // i18n-ignore 演示数据
    return { ok: true, data: { ...item, text }, page: null, error: null }
  }
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
