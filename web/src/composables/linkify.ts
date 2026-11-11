/**
 * 正文和评论里的 http(s) 链接识别。只认带协议的地址，避免把普通文字误判成链接；
 * 结尾的中英文标点、未配对的右括号不算进链接。
 */
const URL_RE = /https?:\/\/[^\s<>"'`，。！？；：、（）【】「」《》]+/g
const TRAIL_RE = /[.,;:!?'")\]}>~*_]+$/

export type LinkSeg = { t: string; href?: string }

function trimUrl(raw: string): string {
  let url = raw.replace(TRAIL_RE, '')
  // 维基百科这类带括号的地址：括号配对时把右括号留回去
  while (raw.length > url.length && raw[url.length] === ')' && count(url, '(') > count(url, ')')) url += ')'
  return url
}

function count(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

/** 把文本切成普通文字和链接；没有链接时原样返回一段 */
export function linkSegments(text: string): LinkSeg[] {
  if (!text.includes('http')) return [{ t: text }]
  const out: LinkSeg[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0])
    let ok = true
    try {
      ok = /^https?:$/.test(new URL(url).protocol) && url.length > 'https://'.length
    } catch {
      ok = false
    }
    if (!ok) continue
    const start = m.index ?? 0
    if (start > last) out.push({ t: text.slice(last, start) })
    out.push({ t: url, href: url })
    last = start + url.length
  }
  if (last < text.length) out.push({ t: text.slice(last) })
  return out.length ? out : [{ t: text }]
}

/** 链接的显示文字：去掉协议和 www.，太长时截断中间部分，完整地址放在 title 里 */
export function linkLabel(url: string, max = 46): string {
  const s = url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  if (s.length <= max) return s
  const head = Math.ceil((max - 1) * 0.7)
  return `${s.slice(0, head)}…${s.slice(s.length - (max - 1 - head))}`
}
