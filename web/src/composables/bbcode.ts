/**
 * PT 站简介里的 BBCode → 可以直接渲染的块（AGENTS.md 7.9「种子详情」）。
 * 只认图片、引用、代码三种块，其余样式标记（[b]、[color=…]、[font=…]、[size=…] 等）去掉、保留里面的文字。
 * 不生成 HTML：每一块都由模板按文本渲染。
 */
export type BbBlock = { type: 'text' | 'quote' | 'code'; text: string } | { type: 'img'; url: string }

const BLOCK_RE =
  /\[code\]([\s\S]*?)\[\/code\]|\[quote(?:=[^\]]*)?\]([\s\S]*?)\[\/quote\]|\[img(?:=[^\]]*)?\]\s*(https?:\/\/[^\s[\]]+)\s*\[\/img\]|\[img=(https?:\/\/[^\]\s]+)\]|!\[[^\]\n]*\]\((https?:\/\/[^)\s]+)\)/gi
const TAG_RE = /\[\/?(?:b|i|u|s|color|font|size|center|left|right|align|url|img|quote|code|pre|hide|spoiler|table|tr|td|th|list|\*|hr|mediainfo|info)(?:=[^\]\n]*)?\]/gi

/** 去掉样式标记；[url=地址]文字[/url] 留下文字和地址（地址由调用方识别成链接） */
function strip(s: string): string {
  return s
    .replace(/\[url=([^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, (_, href: string, t: string) => (t.trim() && t.trim() !== href ? `${t} ${href}` : href))
    .replace(TAG_RE, '')
}

const tidy = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '')

export function bbcodeBlocks(src: string | null | undefined): BbBlock[] {
  if (!src) return []
  const out: BbBlock[] = []
  const text = (s: string, type: 'text' | 'quote' | 'code' = 'text') => {
    const t = tidy(type === 'code' ? s.replace(TAG_RE, '') : strip(s))
    if (t) out.push({ type, text: t })
  }
  let last = 0
  for (const m of src.matchAll(BLOCK_RE)) {
    const at = m.index ?? 0
    if (at > last) text(src.slice(last, at))
    if (m[1] != null) text(m[1], 'code')
    else if (m[2] != null) text(m[2].replace(BLOCK_RE, ''), 'quote')
    else out.push({ type: 'img', url: (m[3] ?? m[4] ?? m[5])! })
    last = at + m[0].length
  }
  if (last < src.length) text(src.slice(last))
  return out
}
