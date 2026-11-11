import type { Envelope, Item } from './types'
import { isDemo } from '@/stores/source'

/**
 * 原始 JSON（AGENTS.md 7.9「设置」→ 实验性）：`catbus <p> item get --raw -- <item>`，
 * data 是平台返回的原始对象。原始对象里可能有带签名的媒体链接，不写进日志、不打印到控制台。
 */
export async function getRawItem(platform: string, item: Item, account?: string | null): Promise<Envelope<unknown>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 300))
    return { ok: true, data: demoRaw(platform, item), page: null, error: null }
  }
  const argv = [platform, 'item', 'get', item.url || item.id]
  if (account) argv.push('-a', account)
  argv.push('--raw')
  const res = await fetch('/api/catbus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
  })
  return (await res.json()) as Envelope<unknown>
}

/** 演示模式：把演示条目包成一个「像平台原始对象」的结构，字段名是平台风格的 */
function demoRaw(platform: string, item: Item): unknown {
  return {
    _demo: '演示数据：真实模式下这里是平台接口返回的原始对象',
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
