import type { Envelope, Item } from './types'
import { isDemo } from '@/stores/source'
import { call } from './client'
import { t } from '@/i18n'

/**
 * 原始 JSON（AGENTS.md 7.9「设置」→ 实验性）：`catbus <p> item get --raw -- <item>`，
 * data 是平台返回的原始对象。原始对象里可能有带签名的媒体链接，不写进日志、不打印到控制台。
 */
export async function getRawItem(platform: string, item: Item, account?: string | null, signal?: AbortSignal): Promise<Envelope<unknown>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 300))
    return { ok: true, data: demoRaw(platform, item), page: null, error: null }
  }
  const argv = [platform, 'item', 'get', item.url || item.id]
  if (account) argv.push('-a', account)
  argv.push('--raw')
  return call<unknown>(argv, signal)
}

/** 演示模式：把演示条目包成一个「像平台原始对象」的结构，字段名是平台风格的 */
function demoRaw(platform: string, item: Item): unknown {
  if (platform === 'bilibili') return demoBili(item)
  return {
    _demo: t('detail.raw.demoNote'),
    platform,
    note_id: item.id,
    type: item.kind === 'video' ? 'video' : 'normal',
    title: item.title,
    desc: item.text,
    user: item.author && { user_id: item.author.id, nickname: item.author.name, avatar: item.author.avatar ?? null },
    time: item.created_at ? Date.parse(item.created_at) : null,
    interact_info: {
      liked_count: String(item.stats.likes ?? 0),
      comment_count: String(item.stats.comments ?? 0),
      collected_count: String(item.stats.collects ?? 0),
      share_count: String(item.stats.shares ?? 0),
      liked: false,
      collected: false,
    },
    image_list: item.media
      .filter((m) => m.type === 'image')
      .map((m, i) => ({ index: i, url_default: m.url, width: m.width, height: m.height })),
    video: item.kind === 'video' ? { duration: item.media[0]?.duration ?? null, media: { stream: { h264: [] } } } : null,
    tag_list: [],
    share_info: { un_share: false },
  }
}

/** B 站：照 x/web-interface/view 的 data（稿件信息） */
function demoBili(item: Item): unknown {
  const sec = item.created_at ? Math.floor(Date.parse(item.created_at) / 1000) : null
  const duration = item.media[0]?.duration ?? null
  return {
    _demo: t('detail.raw.demoNote'),
    bvid: item.id,
    aid: Number.parseInt(item.id.replace(/\D/g, '').slice(0, 9) || '0', 10),
    videos: 1,
    tid: 250,
    tname: '出行', // i18n-ignore
    copyright: 1,
    pic: item.cover,
    title: item.title,
    pubdate: sec,
    ctime: sec,
    desc: item.text ?? '',
    duration,
    owner: item.author && { mid: Number(item.author.id) || item.author.id, name: item.author.name, face: item.author.avatar ?? null },
    stat: {
      view: item.stats.views ?? 0,
      danmaku: 0,
      reply: item.stats.comments ?? 0,
      favorite: item.stats.collects ?? 0,
      coin: 0,
      share: item.stats.shares ?? 0,
      like: item.stats.likes ?? 0,
    },
    dimension: { width: item.media[0]?.width ?? 0, height: item.media[0]?.height ?? 0, rotate: 0 },
    pages: [{ cid: 0, page: 1, part: item.title ?? '', duration, dimension: { width: item.media[0]?.width ?? 0, height: item.media[0]?.height ?? 0, rotate: 0 } }],
    rights: { download: 1, no_reprint: 1 },
  }
}
