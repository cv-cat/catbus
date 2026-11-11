import douyin from '@/data/emoji/douyin.json'
import xhs from '@/data/emoji/xhs.json'

/**
 * 平台表情码 → 图片（AGENTS.md 7.9 详情卡片）。
 * 小红书的正文和评论里只有 `[点赞R]` 这样的文字码，图片对照表取自小红书网页版
 * （localStorage 的 `redmoji.redmojiMap`），图片都在公开 CDN 上。
 * 抖音的 `[捂脸]` 等码，对照表取自抖音网页版免登录的表情列表接口
 * `https://www.douyin.com/aweme/v1/web/emoji/list`（`display_name` 去掉方括号 →
 * `emoji_url.url_list[0]`）。douyinpic.com 不带签名的地址返回 403，所以存的是接口给的
 * 带签名长效链接（x-expires 约为 2036 年），不需要 Referer / cookie；过期后重新生成这份表。
 */
const XHS_BASE = 'https://picasso-static.xiaohongshu.com/fe-platform/'

function expand(map: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [name, v] of Object.entries(map)) {
    const url = v.startsWith('https://') ? v : XHS_BASE + v + (/[./]/.test(v) ? '' : '.png')
    out.set(`[${name}]`, url)
  }
  return out
}

const TABLES: Record<string, Map<string, string>> = { xhs: expand(xhs), douyin: expand(douyin) }

export type EmojiSeg = { t: string; img?: string }

/** 把文本按表情码切开；不认识的码原样保留为文字 */
export function emojiSegments(platform: string, text: string): EmojiSeg[] {
  const table = TABLES[platform]
  if (!table || !text.includes('[')) return [{ t: text }]
  const out: EmojiSeg[] = []
  for (const part of text.split(/(\[[^[\]\n]{1,12}\])/)) {
    if (!part) continue
    const img = table.get(part)
    const last = out[out.length - 1]
    if (img) out.push({ t: part, img })
    else if (last && !last.img) last.t += part
    else out.push({ t: part })
  }
  return out
}
