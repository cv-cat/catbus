/**
 * 抖音、TikTok 共用的评论媒体解析：两边的评论对象同源，图片评论是 `image_list`，表情包是 `sticker`。
 */
import * as n from '../../core/normalize.js'
import type { Media } from '../../core/schemas.js'

/** `{uri, url_list, width, height}` 里第一个 https 地址。 */
function firstUrl(u: any): string | null {
  for (const s of u?.url_list ?? []) {
    const url = n.url(s)
    if (url?.startsWith('https://')) return url
  }
  return null
}

/**
 * 评论附带的图片与表情包。
 * - `image_list[i]`：`origin_url` 是原图（另有 crop / thumb / medium / download），宽高在各个 url 对象上。
 * - `sticker`：`animate_url` 是动图（没有时用 `static_url`），宽高在 sticker 本身。
 */
export function commentMedia(c: any): Media[] {
  const out: Media[] = []
  for (const img of Array.isArray(c?.image_list) ? c.image_list : []) {
    const u = img?.origin_url ?? img?.medium_url ?? img?.crop_url
    const url = firstUrl(img?.origin_url) ?? firstUrl(img?.medium_url) ?? firstUrl(img?.crop_url)
    if (!url) continue
    out.push(n.media({ id: n.idOrNull(u?.uri), type: 'image', url, width: n.count(u?.width), height: n.count(u?.height) }, img))
  }
  const s = c?.sticker
  if (s && typeof s === 'object') {
    const url = firstUrl(s.animate_url) ?? firstUrl(s.static_url)
    if (url) out.push(n.media({ id: n.idOrNull(s.id_str ?? s.id), type: 'image', url, width: n.count(s.width), height: n.count(s.height) }, s))
  }
  return out
}

/**
 * 商品评价的晒图：抖音商城（`Photos`，大写驼峰）和 TikTok Shop（`images` / `review_images`）。
 * 条目可能是地址字符串，也可能是 `{url | Url | url_list | UrlList, width, height}`。
 */
export function reviewMedia(list: unknown): Media[] {
  const out: Media[] = []
  for (const p of Array.isArray(list) ? list : []) {
    const o: any = typeof p === 'string' ? { url: p } : (p ?? {})
    const url = n.url(o.url ?? o.Url ?? o.url_list?.[0] ?? o.UrlList?.[0] ?? o.origin_url?.url_list?.[0])
    if (!url?.startsWith('https://')) continue
    out.push(n.media({ id: n.idOrNull(o.uri ?? o.Uri ?? o.id), type: 'image', url, width: n.count(o.width ?? o.Width), height: n.count(o.height ?? o.Height) }, p))
  }
  return out
}
