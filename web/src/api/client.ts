import { mockAccounts, mockComments, mockFilters, mockHot, mockReplies, mockItem, mockItems, mockLogout, mockRelated, mockSuggest, mockUse } from './mock'
import { loginApi } from './login'
import type { Account, CatbusError, Comment, Envelope, Item, Keyword } from './types'
import { isDemo, useSourceStore, type Source } from '@/stores/source'
import { parseOrder } from '@/data/filters'
import { t } from '@/i18n'
import { errorTitle } from '@/i18n/errors'

/**
 * 跑一条 catbus 命令（bridge 的 POST /api/catbus）。`signal` 中止时 fetch 断开连接，
 * bridge 随之让排队中的出队、结束运行中的子进程（AGENTS.md 7.9「bridge 的边界」）；这里 reject AbortError。
 */
export async function call<T>(argv: string[], signal?: AbortSignal): Promise<Envelope<T>> {
  const res = await fetch('/api/catbus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
    signal,
  })
  return (await res.json()) as Envelope<T>
}

/**
 * bridge 返回的错误信封（code / message / hint）。message 是抛出时按当前语言取的 errorTitle，
 * 只取 e.message 的调用方也能显示译文；常驻显示的地方用 errorText(e)，随语言切换。
 */
export class BridgeError extends Error {
  constructor(readonly error: CatbusError) {
    super(errorTitle(error))
    this.name = 'BridgeError'
  }
}

/** 显示用的错误文字：bridge 的错误按 code 取译文（AGENTS.md 7.9「多语言」），其他错误用 message */
export function errorText(e: unknown): string {
  return e instanceof BridgeError ? errorTitle(e.error) : (e as Error).message
}

/** 被主动取消的请求（过期了）：调用方当作没发生过，不显示错误、不弹提示、不标失效 */
export function isAbort(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'AbortError'
}

/** 各平台 `item search` 支持的筛选取值（来自注册表）；null 表示没有这个筛选 */
export interface PlatformFilters {
  search: boolean
  sort: string[] | null
  type: string[] | null
  /** `item search` 的时间范围 `--time`；旧版 bridge 不给 */
  time?: string[] | null
  /** 已实现的 `feed list` 的流种类 `--kind`；旧版 bridge 不给 */
  kind?: string[] | null
  /** 平台私有的字段排序 `--order-by` 的取值；旧版 bridge 不给 */
  order?: string[] | null
  /** `user get` 和 `user items` 都已实现（作者页，AGENTS.md 7.9）；旧版 bridge 不给 */
  author?: boolean
  /** 搜索联想 / 热搜是否已实现；旧版 bridge 不给，当作不支持 */
  suggest?: boolean
  hot?: boolean
  /** web 端的 `item related` 已实现（详情卡片的相关推荐）；旧版 bridge 不给，当作不支持 */
  related?: boolean
  /** web 端的 `comment list` 已实现（下载时可以带评论）；旧版 bridge 不给 */
  comments?: boolean
}

/** 读不到（旧版 bridge、纯静态预览）时返回 null，页面不置灰任何筛选；演示模式不请求服务端，用演示的取值表 */
export async function loadFilters(): Promise<Record<string, PlatformFilters> | null> {
  if (new URLSearchParams(location.search).has('demo')) return mockFilters()
  try {
    const res = await fetch('/api/filters')
    const env = (await res.json()) as Envelope<Record<string, PlatformFilters>>
    return env.ok ? env.data : null
  } catch {
    return null
  }
}

/** 启动时探测一次 bridge 和 catbus 是否可用 */
export async function detectSource(): Promise<Source> {
  const store = useSourceStore()
  // ?demo 强制使用演示数据（调试界面时不打扰真实账号）
  if (new URLSearchParams(location.search).has('demo')) return (store.source = 'demo')
  try {
    const env = await call<unknown>(['version'])
    store.source = env.ok ? 'live' : 'demo'
  } catch {
    store.source = 'demo'
  }
  return store.source
}

export interface SearchParams {
  platform: string
  keyword: string
  mode: 'search' | 'feed'
  sort?: string
  type?: string
  /** 推荐流的种类（feed list --kind） */
  kind?: string
  /** 搜索的时间范围（item search --time） */
  time?: string
  /** 猫眼演出的城市（feed list --city，AGENTS.md 7.9「猫眼演出的城市」）；空串或不给时用默认城市，别的平台忽略 */
  city?: string
  cursor?: string | null
  limit?: number
  /** 本页浏览用的账号（-a），不传时用 _current */
  account?: string | null
  /** 取消过期的请求 */
  signal?: AbortSignal
}

export async function searchItems(p: SearchParams): Promise<Envelope<Item[]>> {
  // 条数由调用方给（发现页取设置里的每页条数）；没给时 20
  const limit = p.limit ?? 20
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 450))
    // 演示数据按分类 / 时间换一批种子，切换后能看到结果变化
    const variant = p.keyword ? (p.time ?? 'all') : (p.kind ?? 'recommend')
    // 演示账号 acc-<k> 的结果比默认账号错开半页：几个账号同时加载时部分重叠，能看到合并去重
    const k = Number(/^acc-(\d+)$/.exec(p.account ?? '')?.[1] ?? 0)
    if (p.platform === 'maoyan') return mockItems(p.platform, p.keyword, Number(p.cursor ?? 0), limit, p.city ?? '')
    return mockItems(p.platform, p.keyword, Number(p.cursor ?? 0), limit, variant === 'all' || variant === 'recommend' ? '' : variant, k * Math.ceil(limit / 2))
  }
  const argv =
    p.mode === 'feed' || !p.keyword
      ? [p.platform, 'feed', 'list']
      : [p.platform, 'item', 'search', p.keyword]
  if (p.account) argv.push('-a', p.account)
  argv.push('--limit', String(limit))
  if (p.cursor) argv.push('--cursor', p.cursor)
  // 字段排序（--order-by，M-Team）：搜索和浏览都能用
  const order = parseOrder(p.sort)
  if (order) {
    argv.push('--order-by', order.field)
    if (order.asc) argv.push('--asc')
  }
  if (argv[1] === 'item') {
    if (p.sort && p.sort !== 'general' && !order) argv.push('--sort', p.sort)
    if (p.type && p.type !== 'all') argv.push('--type', p.type)
    if (p.time && p.time !== 'all') argv.push('--time', p.time)
  } else if (p.kind && p.kind !== 'recommend') argv.push('--kind', p.kind)
  if (p.platform === 'maoyan' && p.city) argv.push('--city', p.city)
  return call<Item[]>(argv, p.signal)
}

/** 详情：`item get`，补全正文和媒体（AGENTS.md 7.9 详情卡片） */
export async function getItem(platform: string, item: Item, account?: string | null, signal?: AbortSignal): Promise<Envelope<Item>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 350))
    return mockItem(item)
  }
  const argv = [platform, 'item', 'get', item.url || item.id]
  if (account) argv.push('-a', account)
  return call<Item>(argv, signal)
}

/** 评论：`comment list`，一次一页，用 cursor 续翻 */
export async function listComments(
  platform: string,
  item: Item,
  cursor?: string | null,
  account?: string | null,
  signal?: AbortSignal,
): Promise<Envelope<Comment[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 500))
    return mockComments(item, Number(cursor ?? 0))
  }
  const argv = [platform, 'comment', 'list', item.url || item.id]
  if (account) argv.push('-a', account)
  if (cursor) argv.push('--cursor', cursor)
  return call<Comment[]>(argv, signal)
}

/** 楼中楼：`comment replies`，limit 为 1 时用作默认展开的那一条 */
export async function listReplies(
  platform: string,
  item: Item,
  comment: string,
  cursor?: string | null,
  limit?: number,
  account?: string | null,
  signal?: AbortSignal,
): Promise<Envelope<Comment[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 400))
    return mockReplies(item, comment, Number(cursor ?? 0), limit ?? 10)
  }
  const argv = [platform, 'comment', 'replies', item.url || item.id, comment]
  if (account) argv.push('-a', account)
  if (limit) argv.push('--limit', String(limit))
  if (cursor) argv.push('--cursor', cursor)
  return call<Comment[]>(argv, signal)
}

/** 相关推荐：`item related`，只取一页（AGENTS.md 7.9「相关推荐」） */
export async function listRelated(
  platform: string,
  item: Item,
  limit: number,
  account?: string | null,
  signal?: AbortSignal,
): Promise<Envelope<Item[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 600))
    return mockRelated(platform, item, limit)
  }
  const argv = [platform, 'item', 'related', item.url || item.id]
  if (account) argv.push('-a', account)
  argv.push('--limit', String(limit))
  return call<Item[]>(argv, signal)
}

/** 支持楼中楼的平台（注册表里实现了 comment replies） */
export const REPLY_PLATFORMS = new Set(['xhs', 'douyin', 'bilibili', 'kuaishou', 'tiktok', 'youtube'])

/** 视频 CDN 校验 Referer 的平台，经 bridge 的 /api/media 转发（见 server/media.ts） */
const PROXIED = new Set(['douyin', 'xhs', 'kuaishou', 'weibo', 'tiktok', 'x'])
export function mediaSrc(platform: string, url: string): string {
  if (isDemo() || !PROXIED.has(platform) || !url.startsWith('https://')) return url
  return `/api/media?${new URLSearchParams({ platform, url })}`
}

/**
 * 校验 Referer 的图床（AGENTS.md 7.9「媒体代理」）：新浪图床对浏览器 UA 不带 weibo.com 的 Referer 返回 403，
 * <img> 设不了 Referer，所以经 /api/media 转发。按主机判断，头像、评论图片等拿不到平台的地方也能用。
 */
const IMG_PROXY_HOSTS: [suffix: string, platform: string][] = [
  ['sinaimg.cn', 'weibo'],
  ['weibocdn.com', 'weibo'],
]
export function imgSrc(url: string): string
export function imgSrc(url: string | null | undefined): string | undefined
export function imgSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  if (isDemo()) return url
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const host = u.hostname.toLowerCase()
  const hit = IMG_PROXY_HOSTS.find(([h]) => host === h || host.endsWith(`.${h}`))
  if (!hit || (u.protocol !== 'https:' && u.protocol !== 'http:')) return url
  u.protocol = 'https:'
  return `/api/media?${new URLSearchParams({ platform: hit[1], url: u.href })}`
}

export async function listAccounts(): Promise<Envelope<Account[]>> {
  if (isDemo()) return mockAccounts()
  return call<Account[]>(['auth', 'list'])
}

/** 设为默认账号（auth use），改的是 ~/.catbus 里的 _current */
/** 删除账号（auth logout）：删本地凭证，B 站、快手同时服务端登出 */
export async function removeAccount(platform: string, account: string): Promise<void> {
  if (isDemo()) return mockLogout(platform, account)
  const { envelope } = await loginApi.logout(platform, account)
  if (!envelope.ok) throw envelope.error ? new BridgeError(envelope.error) : new Error(t('account.error.removeFailed'))
}

export async function useAccount(platform: string, account: string): Promise<void> {
  if (isDemo()) return mockUse(platform, account)
  const { envelope } = await loginApi.use(platform, account)
  if (!envelope.ok) throw envelope.error ? new BridgeError(envelope.error) : new Error(t('account.error.useFailed'))
}

/** 热搜（AGENTS.md 7.9「搜索联想与热搜」）：`catbus <p> keyword hot [-a <账号>]` */
export async function keywordHot(platform: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<Keyword[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 380))
    return mockHot(platform)
  }
  const argv = [platform, 'keyword', 'hot']
  if (account) argv.push('-a', account)
  return call<Keyword[]>(argv, signal)
}

/** 搜索联想：`catbus <p> keyword suggest [-a <账号>] -- <前缀>`（bridge 把前缀放到 `--` 之后） */
export async function keywordSuggest(
  platform: string,
  prefix: string,
  account?: string | null,
  signal?: AbortSignal,
): Promise<Envelope<Keyword[]>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 220))
    return mockSuggest(platform, prefix)
  }
  const argv = [platform, 'keyword', 'suggest', prefix]
  if (account) argv.push('-a', account)
  return call<Keyword[]>(argv, signal)
}
