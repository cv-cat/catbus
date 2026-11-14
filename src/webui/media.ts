import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

/**
 * 详情卡片的视频代理（AGENTS.md 7.9）：GET /api/media?platform=<p>&url=<地址>
 *
 * 部分平台的视频 CDN 校验 Referer（抖音不带 douyin.com 的 Referer 返回 403），
 * 浏览器里的 <video> 改不了 Referer，所以经 bridge 转发。
 * - 只接受 https，主机必须在该平台的 CDN 后缀白名单里；
 * - 透传 Range，支持拖动进度；
 * - 不跟随重定向到白名单外，不带 cookie。
 */
const PLATFORMS: Record<string, { hosts: string[]; referer: string | null }> = {
  douyin: { hosts: ['douyinvod.com'], referer: 'https://www.douyin.com/' },
  xhs: { hosts: ['xhscdn.com'], referer: 'https://www.xiaohongshu.com/' },
  kuaishou: { hosts: ['kwaicdn.com', 'yximgs.com', 'ndcimgs.com'], referer: 'https://www.kuaishou.com/' },
  weibo: { hosts: ['weibocdn.com', 'sinaimg.cn'], referer: 'https://weibo.com/' },
  tiktok: { hosts: ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com'], referer: 'https://www.tiktok.com/' },
  x: { hosts: ['twimg.com'], referer: null },
}
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']
const MAX_REDIRECTS = 3

export class MediaError extends Error {}

/** 校验地址：https、主机在平台白名单里 */
export function checkMediaUrl(platform: string, raw: string): URL {
  const conf = PLATFORMS[platform]
  if (!conf) throw new MediaError('这个平台的视频不需要代理')
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new MediaError('视频地址不合法')
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new MediaError('只接受 https 视频地址')
  if (!conf.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    // 平台换了新 CDN 时从这行就能看出该补哪个域名
    process.stderr.write(`[catbus] 视频代理拒绝了 ${platform} 白名单外的域名：${host}\n`)
    throw new MediaError('视频地址不在平台 CDN 白名单里')
  }
  return u
}

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy()
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.end(message)
}

export async function proxyMedia(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '只接受 GET')
  const q = new URL(req.url ?? '/', 'http://localhost').searchParams
  const platform = q.get('platform') ?? ''
  const abort = new AbortController()
  res.on('close', () => abort.abort())
  try {
    let url = checkMediaUrl(platform, q.get('url') ?? '')
    const referer = PLATFORMS[platform]!.referer
    const headers: Record<string, string> = { 'user-agent': UA, accept: '*/*' }
    if (referer) headers.referer = referer
    const range = req.headers.range
    if (typeof range === 'string' && /^bytes=[\d,\s-]{1,64}$/.test(range)) headers.range = range

    let upstream: Response | null = null
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      upstream = await fetch(url, { method: req.method, headers, redirect: 'manual', signal: abort.signal })
      const loc = upstream.status >= 300 && upstream.status < 400 ? upstream.headers.get('location') : null
      if (!loc) break
      await upstream.body?.cancel()
      url = checkMediaUrl(platform, new URL(loc, url).href)
      upstream = null
    }
    if (!upstream) return fail(res, 502, '视频地址重定向次数过多')

    res.statusCode = upstream.status
    for (const h of PASS_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    res.setHeader('cache-control', 'private, max-age=600')
    if (!upstream.body || req.method === 'HEAD') return res.end()
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res)
  } catch (e) {
    if (abort.signal.aborted) return
    fail(res, e instanceof MediaError ? 400 : 502, (e as Error).message)
  }
}
