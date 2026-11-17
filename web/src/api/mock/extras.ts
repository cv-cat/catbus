import type { Envelope, Item, Media } from '../types'
import { DEMO_VIDEO, hash } from './shared'

// ---------- 详情卡片的字幕、弹幕、媒体链接与直播弹幕（AGENTS.md 7.9），能力与注册表一致 ----------
export const MOCK_MEDIA_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'x', 'youtube']
/** web 端 `live media` 已实现的平台（与注册表一致） */
export const MOCK_LIVE_MEDIA_PLATFORMS = ['douyin', 'bilibili', 'tiktok', 'kuaishou']

export const MOCK_LIVE_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'youtube']
const SUB_LINES = ['大家好，今天带大家看看这次的露营地', '这里海拔大概一千二百米', '晚上会比较冷，记得多带一件外套', '先把天幕搭起来', '炉子我用的是分体式的', '好，我们开始做晚饭', '这个汤真的很香', '今天就到这里，下次见']

export function mockSubtitles(item: Item): Envelope<import('../types').Subtitle[]> {
  const n = hash(`sub:${item.id}`)
  if (n % 5 === 0) return { ok: true, data: [], page: null, error: null }
  const mk = (lang: string, name: string, f: (s: string) => string) => ({
    lang,
    name,
    url: null,
    lines: Array.from({ length: 24 }, (_, i) => ({ from: i * 4.2, to: i * 4.2 + 3.8, text: f(SUB_LINES[(n + i) % SUB_LINES.length]!) })),
  })
  const data = [mk('zh-CN', '中文（自动生成）', (s) => s)]
  if (n % 2) data.push(mk('en', 'English', (s) => `[EN] ${s}`))
  return { ok: true, data, page: null, error: null }
}

export function mockDanmaku(item: Item): Envelope<import('../types').Danmaku[]> {
  const n = hash(`dm:${item.id}`)
  const words = ['前排', '哈哈哈哈', '好美', '这是哪里', '收藏了', '下次也去', '氛围感拉满', '666', '求装备清单', '火好旺']
  const data = Array.from({ length: 40 + (n % 60) }, (_, i) => ({
    id: `${item.id}-dm${i}`,
    item_id: item.id,
    offset: ((n + i * 37) % 600) + (i % 10) / 10,
    text: words[(n + i) % words.length]!,
    created_at: null,
  }))
  return { ok: true, data, page: null, error: null }
}

export function mockMedia(item: Item): Envelope<Media[]> {
  const data: Media[] = item.media.length ? item.media : [{ id: null, type: 'video', url: DEMO_VIDEO, width: 1280, height: 720, duration: 30 }]
  return { ok: true, data, page: null, error: null }
}
