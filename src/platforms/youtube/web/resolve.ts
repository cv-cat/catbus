import { CatbusError } from '../../../core/errors.js'
import { protobuf } from '../../../core/pb.js'
import type { YtClient } from './client.js'

const VIDEO_ID = /^[\w-]{11}$/
const CHANNEL_ID = /^UC[\w-]{22}$/
const PLAYLIST_ID = /^(PL|UU|OL|LL|FL|RD|UL|PU|WL|OLAK5uy_)[\w-]*$/
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/

function parseUrl(input: string): URL | null {
  const s = input.trim()
  if (!/^(https?:\/\/)?([\w-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be)(\/|$)/i.test(s)) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    return YT_HOST.test(u.hostname) ? u : null
  } catch {
    return null
  }
}

/** 视频：11 位 ID，或 watch / youtu.be / shorts / live / embed 链接。 */
export function videoId(input: string): string {
  const s = input.trim()
  if (VIDEO_ID.test(s)) return s
  const u = parseUrl(s)
  if (u) {
    const v = u.searchParams.get('v')
    if (v && VIDEO_ID.test(v)) return v
    const seg = u.pathname.split('/').filter(Boolean)
    const id = u.hostname.endsWith('youtu.be') ? seg[0] : ['shorts', 'live', 'embed', 'v', 'e'].includes(seg[0] ?? '') ? seg[1] : undefined
    if (id && VIDEO_ID.test(id)) return id
  }
  throw new CatbusError('USAGE', `无法识别的视频：${input}`, { hint: '传 11 位视频 ID，或 youtube.com/watch?v=… / youtu.be/… / shorts/… 链接' })
}

/** 播放列表：ID，或带 `list=` 的链接。 */
export function playlistId(input: string): string {
  const s = input.trim()
  if (s.startsWith('VL') && PLAYLIST_ID.test(s.slice(2))) return s.slice(2)
  if (PLAYLIST_ID.test(s)) return s
  const list = parseUrl(s)?.searchParams.get('list')
  if (list && PLAYLIST_ID.test(list)) return list
  throw new CatbusError('USAGE', `无法识别的播放列表：${input}`, { hint: '传播放列表 ID（PL…），或带 list= 的链接' })
}

/**
 * 频道：`UC…` ID、`@handle`、或 /channel/ /@ /c/ /user/ 链接。除了频道 ID，都用 navigation/resolve_url 换成 ID。
 */
export async function channelId(client: YtClient, input: string): Promise<string> {
  const s = input.trim()
  if (CHANNEL_ID.test(s)) return s
  let path: string | null = null
  if (s.startsWith('@')) path = `/${s}`
  else {
    const u = parseUrl(s)
    const seg = u?.pathname.split('/').filter(Boolean) ?? []
    if (seg[0] === 'channel' && seg[1] && CHANNEL_ID.test(seg[1])) return seg[1]
    if (seg[0]?.startsWith('@')) path = `/${seg[0]}`
    else if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) path = `/${seg[0]}/${seg[1]}`
    else if (seg.length === 1 && u) path = `/${seg[0]}`
  }
  if (!path) {
    if (/^[\w.-]{3,30}$/.test(s)) path = `/@${s}`
    else throw new CatbusError('USAGE', `无法识别的频道：${input}`, { hint: '传频道 ID（UC…）、@handle 或频道链接' })
  }
  const res = await client.innertube('navigation/resolve_url', { url: `https://www.youtube.com${path}` }).catch((err) => {
    // 不存在的 @handle：resolve_url 返回 404
    if (err instanceof CatbusError && err.code === 'UPSTREAM' && (err.detail as { status?: number } | undefined)?.status === 404) return null
    throw err
  })
  const id = res?.endpoint?.browseEndpoint?.browseId
  if (typeof id !== 'string' || !CHANNEL_ID.test(id)) {
    throw new CatbusError('UPSTREAM', `找不到频道：${input}`, { hint: '确认 @handle 拼写正确', detail: { path } })
  }
  return id
}

// ---------------------------------------------------------------- protobuf 参数

type W = ReturnType<typeof protobuf.Writer.create>
const pb = () => protobuf.Writer.create()
const int = (w: W, field: number, v: number) => w.uint32((field << 3) | 0).uint32(v)
const str = (w: W, field: number, v: string) => w.uint32((field << 3) | 2).string(v)
const msg = (w: W, field: number, sub: W) => w.uint32((field << 3) | 2).bytes(sub.finish())

const b64 = (w: W) => Buffer.from(w.finish()).toString('base64')
/** URL 安全的 base64，保留 `=` 填充：评论框、回复框的参数和评论 action 用这种。 */
const b64url = (w: W) => b64(w).replace(/\+/g, '-').replace(/\//g, '_')

/** 频道各 tab 的 browse params（取自频道页 tab 的 browseEndpoint）。 */
export const CHANNEL_TAB = {
  videos: 'EgZ2aWRlb3PyBgQKAjoA',
  playlists: 'EglwbGF5bGlzdHPyBgQKAkIA',
} as const

// 2025 年改版后搜索页只剩「Relevance / Popularity」两种排序，按上传时间排序已下线
const SORT = { general: 0, popular: 3 } as const
const UPLOAD_DATE = { day: 2, week: 3, month: 4, year: 5 } as const
const TYPE = { video: 1, channel: 2, playlist: 3 } as const

export interface SearchFilter {
  sort?: keyof typeof SORT
  time?: keyof typeof UPLOAD_DATE | 'all'
  type?: keyof typeof TYPE
  live?: boolean
}

/** 搜索筛选：`{1: 排序, 2: {1: 上传日期, 2: 类型, 8: 直播}}` 的 base64，与搜索页筛选菜单生成的 `sp` 相同。没有筛选时为 undefined。 */
export function searchParams(f: SearchFilter): string | undefined {
  const filters = pb()
  if (f.time && f.time !== 'all') int(filters, 1, UPLOAD_DATE[f.time])
  if (f.type) int(filters, 2, TYPE[f.type])
  if (f.live) int(filters, 8, 1)
  const w = pb()
  if (f.sort && SORT[f.sort]) int(w, 1, SORT[f.sort])
  if (filters.len) msg(w, 2, filters)
  return w.len ? b64(w) : undefined
}

/**
 * 发评论：`{2: 视频, 5: {1: 0}, 10: 7, 45: 1, 53: 0}`，与评论框提交按钮里的 createCommentParams 相同。
 * 回复时另有 `4: 根评论` 与 `27: 0, 29: 0, 43: {}`，与回复框里的 createReplyParams 相同。
 */
function commentParams(video: string, root?: string): string {
  const w = pb()
  str(w, 2, video)
  if (root) str(w, 4, root)
  msg(w, 5, int(pb(), 1, 0))
  int(w, 10, 7)
  if (root) (int(w, 27, 0), int(w, 29, 0), msg(w, 43, pb()))
  int(w, 45, 1)
  int(w, 53, 0)
  return b64url(w)
}

export const createCommentParams = (video: string) => commentParams(video)
export const createReplyParams = (video: string, root: string) => commentParams(video, root)

/** perform_comment_action 的动作类型。 */
const COMMENT_ACTION = { like: 5, delete: 6 } as const

/**
 * perform_comment_action 的 action：`{1: 类型, 2: 2, 3: 评论, 5: 视频, 6: 0, 7: 0 点赞 | 1 取消（只有点赞有）, 21: 12, 23: 视频频道, …, 56: 2（只有点赞有）}`，
 * 与评论工具栏的 likeCommand / unlikeCommand、自己评论菜单里「删除」的 action 相同。
 */
export function commentAction(kind: 'like' | 'unlike' | 'delete', video: string, comment: string, channel: string): string {
  const like = kind !== 'delete'
  const w = pb()
  int(w, 1, COMMENT_ACTION[like ? 'like' : 'delete'])
  int(w, 2, 2)
  str(w, 3, comment)
  str(w, 5, video)
  int(w, 6, 0)
  if (like) int(w, 7, kind === 'unlike' ? 1 : 0)
  int(w, 21, 12)
  str(w, 23, channel)
  int(w, 30, 0)
  int(w, 47, 1)
  int(w, 54, 0)
  if (like) int(w, 56, 2)
  int(w, 57, 0)
  return b64url(w)
}

/**
 * 评论回复的 continuation：`{2: {2: 视频}, 3: 6, 6: {3: {2: 评论, 4: {1: 0}, 5: 频道, 6: 视频, 8: 1, 9: 10, 16: {1: 1}}, 8: 面板 id}}`，
 * 与评论区「查看回复」按钮里的 token 结构相同。
 */
export function repliesToken(video: string, comment: string, channel: string): string {
  const inner = pb()
  str(inner, 2, comment)
  msg(inner, 4, int(pb(), 1, 0))
  str(inner, 5, channel)
  str(inner, 6, video)
  int(inner, 8, 1)
  int(inner, 9, 10)
  msg(inner, 16, int(pb(), 1, 1))
  const six = pb()
  msg(six, 3, inner)
  str(six, 8, `comment-replies-item-${comment}`)
  const w = pb()
  msg(w, 2, str(pb(), 2, video))
  int(w, 3, 6)
  msg(w, 6, six)
  return encodeURIComponent(b64(w))
}
