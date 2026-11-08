import type { CommandMeta, EndpointName, PlatformMeta } from '../shared/types.js'
import { commandTitle, endpointLabel } from './copy.js'
import { type Child, h, linkify } from './dom.js'
import { formatBytes, formatCount, formatDuration, formatPrice, formatTime, MISSING, relativeTime } from './format.js'
import { icon, type IconName } from './icons.js'
import { EVENT_LABELS, FIELD_LABELS, KIND_LABELS, METHOD_INFO, STATUS_LABELS } from './labels.js'
import { field, isObject, type Json, type JsonObject, list, num, str } from './json.js'
import { ARG_PARAM, href, OPTION_PARAM } from './router.js'
import { findPlatform } from './state.js'
import { avatar, callout, chip, emptyState, linkButton } from './ui.js'

/**
 * 结果渲染（AGENTS 6.2）：按输出类型排版；--raw 或未登记的类型用通用表格 / 键值列表。
 * 结果对象的 url（没有时 id）可以直接作为下一条命令的参数（AGENTS 4.8），渲染出「下一步」链接。
 */

export interface RenderContext {
  platform: PlatformMeta | null
  endpoint: EndpointName
  /** 页面上选中的账号，带进「下一步」链接。 */
  account: string | null
  command: CommandMeta | null
  raw: boolean
}

/** 结果类型 → 下一条命令里接收它的参数名。 */
const TYPE_ARG: Record<string, string> = { Item: 'item', Torrent: 'item', User: 'user', Live: 'room', Conversation: 'conversation', Folder: 'folder', Series: 'series' }
/** 每种结果直接露出的下一步，其余收进「更多」。 */
const PRIMARY_NEXT: Record<string, string[]> = {
  Item: ['item get', 'comment list'],
  Torrent: ['item get', 'item download'],
  User: ['user get', 'user items'],
  Live: ['live get', 'live listen'],
  Conversation: ['msg history'],
  Folder: ['folder items'],
  Series: ['series items'],
}
/** 只读的动作（AGENTS 4.4）：从链接进入时自动执行，网络出错可以直接重试；写操作和长连接只预填，等用户自己点运行。 */
const READ_ACTIONS = ['get', 'list', 'search', 'related', 'media', 'items', 'likes', 'collects', 'reposts', 'followers', 'following', 'replies', 'history', 'suggest', 'hot', 'count', 'categories', 'rank', 'gifts', 'products', 'replays', 'subtitles', 'pins', 'stats', 'status']
/** 通用表格最多展示的列数，避免横向过宽。 */
const MAX_COLUMNS = 10
/** 推断列时最多看前多少行。 */
const COLUMN_SAMPLE = 30
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/**
 * 只读命令（AGENTS 4.4 的读取类动作）。
 */
export function isReadAction(command: CommandMeta | null): boolean {
  return command == null || READ_ACTIONS.includes(command.action)
}

/**
 * 链接进入时是否自动执行：只读、不需要确认、不是长连接。
 */
export function autoRuns(command: CommandMeta): boolean {
  return isReadAction(command) && command.confirm === 'never' && !command.stream
}

/**
 * 命令页的链接：参数依次放在 a0、a1……，选项放在 o.<选项名>，自动执行的命令带 run=1。
 */
export function commandHref(ctx: Pick<RenderContext, 'platform' | 'endpoint' | 'account'>, command: CommandMeta, args: string[], options: Record<string, string> = {}): string {
  const query: Record<string, string | null> = { e: ctx.endpoint, acct: ctx.account, run: autoRuns(command) ? '1' : null }
  args.forEach((a, i) => (query[`${ARG_PARAM}${i}`] = a))
  for (const [flag, value] of Object.entries(options)) query[`${OPTION_PARAM}${flag}`] = value
  return href(['p', ctx.platform!.id, command.resource, command.action], query)
}

/**
 * 可以接收某个参数的已实现命令（第一个参数是它，其余参数都可省略）。
 */
function commandsFor(ctx: RenderContext, argName: string): CommandMeta[] {
  const ep = ctx.platform?.endpoints[ctx.endpoint]
  if (!ep || ep.status !== 'available') return []
  const current = ctx.command ? `${ctx.command.resource} ${ctx.command.action}` : null
  return ep.commands.filter((c) => c.status === 'implemented' && c.args[0]?.name === argName && c.args.slice(1).every((a) => a.optional) && `${c.resource} ${c.action}` !== current && c.resource !== 'auth')
}

/**
 * 对象作为参数时的取值：优先 url（xhs 的 url 带 xsec_token），没有时用 id。
 */
function targetOf(value: Json | undefined): string | null {
  return str(value, 'url') ?? str(value, 'id')
}

/**
 * 「下一步」：主要动作直接露出，其余放进「更多」菜单（原生 details，键盘可达）。
 */
function nextActions(ctx: RenderContext, type: string, value: Json): HTMLElement | null {
  const argName = TYPE_ARG[type]
  const target = targetOf(value)
  if (!argName || !target || !ctx.platform) return null
  const commands = commandsFor(ctx, argName)
  const primaryKeys = PRIMARY_NEXT[type] ?? []
  const primary = commands.filter((c) => primaryKeys.includes(`${c.resource} ${c.action}`))
  const rest = commands.filter((c) => !primary.includes(c))
  const external = str(value, 'url')
  return h(
    'div',
    { class: 'next-actions' },
    primary.map((c) => linkButton(commandTitle(c).split(/[，；（(]/)[0]!, commandHref(ctx, c, [target]), { variant: 'ghost', size: 'sm' })),
    rest.length
      ? h(
          'details',
          { class: 'menu' },
          h('summary', { class: 'btn btn-ghost btn-sm', 'aria-label': '更多操作' }, icon('more'), h('span', { class: 'btn-label' }, '更多')),
          h('div', { class: 'menu-panel', role: 'list' }, rest.map((c) => h('a', { class: 'menu-item', href: commandHref(ctx, c, [target]), role: 'listitem' }, commandTitle(c)))),
        )
      : null,
    external?.startsWith('http') ? h('a', { class: 'btn btn-ghost btn-sm', href: external, target: '_blank', rel: 'noreferrer noopener' }, icon('external'), h('span', { class: 'btn-label' }, '在平台打开')) : null,
  )
}

/**
 * 外部图片：不带 Referer、懒加载，加载失败时换成占位。
 */
function remoteImage(url: string | null, alt: string, className: string, fallbackIcon: IconName = 'image'): HTMLElement {
  const placeholder = h('span', { class: `${className} img-placeholder` }, icon(fallbackIcon))
  if (!url || !/^https?:/.test(url)) return placeholder
  const img = h('img', { class: className, src: url, alt, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })
  img.addEventListener('error', () => img.replaceWith(placeholder))
  return img
}

/**
 * 用户名：有对应命令时链接到用户资料。
 */
function userLink(ctx: RenderContext, user: Json | undefined): Child {
  const name = str(user, 'name') ?? str(user, 'id') ?? MISSING
  const target = targetOf(user)
  const get = ctx.platform && target ? commandsFor(ctx, 'user').find((c) => c.action === 'get') : undefined
  return get ? h('a', { class: 'user-link', href: commandHref(ctx, get, [target!]) }, name) : h('span', { class: 'user-link' }, name)
}

/**
 * 计数行：只显示有值的项。
 */
function statsRow(stats: Json | undefined, entries: [string, IconName, string][]): HTMLElement | null {
  const items = entries
    .map(([key, iconName, label]) => [num(stats, key), iconName, label] as const)
    .filter(([value]) => value != null)
    .map(([value, iconName, label]) => h('li', { title: `${label} ${value}` }, icon(iconName), h('span', null, formatCount(value)), h('span', { class: 'sr-only' }, label)))
  return items.length ? h('ul', { class: 'stats' }, items) : null
}

const ITEM_STATS: [string, IconName, string][] = [
  ['views', 'eye', '浏览'],
  ['likes', 'heart', '点赞'],
  ['comments', 'comment', '评论'],
  ['collects', 'star', '收藏'],
  ['shares', 'share', '分享'],
]

/**
 * Item 上的标签：类型、状态、价格。
 */
function itemBadges(item: Json): Child[] {
  const kind = str(item, 'kind')
  const status = str(item, 'status')
  const price = field(item, 'price')
  return [
    kind ? chip(KIND_LABELS[kind] ?? kind, 'neutral') : null,
    status ? chip(STATUS_LABELS[status]?.label ?? status, STATUS_LABELS[status]?.tone ?? 'neutral') : null,
    isObject(price) ? chip(formatPrice(num(price, 'amount'), str(price, 'currency')), 'brand') : null,
  ]
}

/**
 * 内容卡片（Item / Torrent 列表）。
 */
function itemCard(ctx: RenderContext, item: Json): HTMLElement {
  const title = str(item, 'title')
  const text = str(item, 'text')
  const heading = title || text || str(item, 'id') || '（无标题）'
  const getCommand = commandsFor(ctx, 'item').find((c) => c.action === 'get')
  const target = targetOf(item)
  const detail = getCommand && target ? commandHref(ctx, getCommand, [target]) : (str(item, 'url') ?? null)
  const firstMedia = list(item, 'media')[0]
  const duration = num(firstMedia, 'duration')
  const kind = str(item, 'kind')
  const cover = remoteImage(str(item, 'cover') ?? (str(firstMedia, 'type') === 'image' ? str(firstMedia, 'url') : null), '', 'item-cover-img', kind === 'video' ? 'video' : kind === 'torrent' ? 'download' : 'image')
  const coverBox = h('div', { class: 'item-cover' }, cover, duration ? h('span', { class: 'item-duration' }, formatDuration(duration)) : null)
  const size = num(item, 'size')
  return h(
    'article',
    { class: 'item-card' },
    detail ? h('a', { class: 'item-cover-link', href: detail, tabindex: '-1', 'aria-hidden': 'true', target: detail.startsWith('http') ? '_blank' : null, rel: 'noreferrer noopener' }, coverBox) : coverBox,
    h(
      'div',
      { class: 'item-body' },
      h('div', { class: 'item-badges' }, itemBadges(item), size != null ? chip(formatBytes(size), 'neutral') : null),
      h('h3', { class: 'item-title' }, detail ? h('a', { href: detail, target: detail.startsWith('http') ? '_blank' : null, rel: 'noreferrer noopener' }, heading) : heading),
      title && text ? h('p', { class: 'item-text' }, text) : null,
      h('div', { class: 'item-meta' }, avatar(str(field(item, 'author'), 'name')), userLink(ctx, field(item, 'author')), h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'), h('time', { datetime: str(item, 'created_at') ?? null, title: formatTime(str(item, 'created_at')) }, relativeTime(str(item, 'created_at')))),
      statsRow(field(item, 'stats'), ITEM_STATS),
      ctx.platform ? nextActions(ctx, 'Item', item) : null,
    ),
  )
}

/**
 * 媒体预览：图片直接显示；视频尝试内嵌播放，失败时给原链接。
 */
function mediaPreview(media: Json, poster: string | null): HTMLElement {
  const url = str(media, 'url')
  const type = str(media, 'type')
  if (type === 'video' && url) {
    const video = h('video', { class: 'media-main', controls: true, preload: 'none', poster: poster && /^https?:/.test(poster) ? poster : null, src: url })
    const fallback = h('p', { class: 'media-fallback' }, '这个视频不能在面板里播放（平台限制了来源）。', h('a', { href: url, target: '_blank', rel: 'noreferrer noopener' }, '打开原链接'))
    video.addEventListener('error', () => video.replaceWith(fallback))
    return video
  }
  return remoteImage(url, '', 'media-main')
}

/**
 * 单个内容的详情（Item / Torrent / 商品）。
 */
function itemDetail(ctx: RenderContext, item: Json): HTMLElement {
  const media = list(item, 'media')
  const cover = str(item, 'cover')
  const gallery = media.length || cover
    ? h(
        'div',
        { class: 'item-gallery' },
        media.length ? mediaPreview(media[0]!, cover) : remoteImage(cover, '', 'media-main'),
        media.length > 1
          ? h('ul', { class: 'thumbs' }, media.slice(1).map((m) => h('li', null, h('a', { href: str(m, 'url') ?? '#', target: '_blank', rel: 'noreferrer noopener', 'aria-label': `打开第 ${media.indexOf(m) + 1} 个媒体` }, str(m, 'type') === 'video' ? h('span', { class: 'thumb img-placeholder' }, icon('video')) : remoteImage(str(m, 'url'), '', 'thumb')))))
          : null,
      )
    : null
  const text = str(item, 'text')
  return h(
    'article',
    { class: `item-detail ${gallery ? '' : 'item-detail-text'}`.trim() },
    gallery,
    h(
      'div',
      { class: 'item-info' },
      h('div', { class: 'item-badges' }, itemBadges(item)),
      h('h2', { class: 'item-detail-title' }, str(item, 'title') || (text ? text.split('\n')[0]!.slice(0, 80) : str(item, 'id') ?? '')),
      h('div', { class: 'item-meta' }, avatar(str(field(item, 'author'), 'name'), null, 'md'), userLink(ctx, field(item, 'author')), h('span', { class: 'dot', 'aria-hidden': 'true' }, '·'), h('time', { datetime: str(item, 'created_at') ?? null }, formatTime(str(item, 'created_at')))),
      statsRow(field(item, 'stats'), ITEM_STATS),
      text ? h('div', { class: 'prose' }, linkify(text)) : null,
      ctx.raw ? null : torrentFacts(item),
      nextActions(ctx, str(item, 'kind') === 'torrent' ? 'Torrent' : 'Item', item),
    ),
  )
}

/**
 * Torrent 的 PT 字段（AGENTS 6.2）。
 */
function torrentFacts(item: Json): HTMLElement | null {
  if (str(item, 'kind') !== 'torrent') return null
  return kvList([
    ['大小', formatBytes(num(item, 'size'))],
    ['文件数', formatCount(num(item, 'file_count'))],
    ['做种', formatCount(num(item, 'seeders'))],
    ['下载', formatCount(num(item, 'leechers'))],
    ['完成', formatCount(num(item, 'completed'))],
    ['优惠', str(item, 'discount') ?? MISSING],
  ])
}

const USER_STATS: [string, IconName, string][] = [
  ['followers', 'users', '粉丝'],
  ['following', 'user', '关注'],
  ['items', 'image', '作品'],
  ['likes', 'heart', '获赞'],
]

/**
 * 用户资料卡。
 */
function userProfile(ctx: RenderContext, user: Json): HTMLElement {
  const handle = str(user, 'handle')
  return h(
    'article',
    { class: 'user-profile' },
    avatar(str(user, 'name'), str(user, 'avatar'), 'lg'),
    h(
      'div',
      { class: 'user-profile-body' },
      h('h2', { class: 'user-name' }, str(user, 'name') ?? str(user, 'id') ?? MISSING),
      handle ? h('p', { class: 'user-handle' }, `@${handle.replace(/^@/, '')}`) : null,
      str(user, 'bio') ? h('p', { class: 'user-bio' }, str(user, 'bio')) : null,
      statsRow(field(user, 'stats'), USER_STATS),
      nextActions(ctx, 'User', user),
    ),
  )
}

/**
 * 用户列表的一行。
 */
function userRow(ctx: RenderContext, user: Json): HTMLElement {
  const get = commandsFor(ctx, 'user').find((c) => c.action === 'get')
  const target = targetOf(user)
  const name = str(user, 'name') ?? str(user, 'id') ?? MISSING
  return h(
    'li',
    { class: 'row' },
    avatar(str(user, 'name'), str(user, 'avatar')),
    h(
      'div',
      { class: 'row-main' },
      h('p', { class: 'row-title' }, get && target ? h('a', { href: commandHref(ctx, get, [target]) }, name) : name, str(user, 'handle') ? h('span', { class: 'row-sub' }, ` @${str(user, 'handle')!.replace(/^@/, '')}`) : null),
      str(user, 'bio') ? h('p', { class: 'row-text' }, str(user, 'bio')) : null,
    ),
    h('div', { class: 'row-side' }, statsRow(field(user, 'stats'), USER_STATS.slice(0, 1)), nextActions(ctx, 'User', user)),
  )
}

/**
 * 评论（含楼中楼入口）。
 */
function commentRow(ctx: RenderContext, comment: Json): HTMLElement {
  const replies = num(field(comment, 'stats'), 'replies')
  const repliesCommand = findImplemented(ctx, 'comment', 'replies')
  const itemId = str(comment, 'item_id')
  const id = str(comment, 'id')
  return h(
    'li',
    { class: 'comment' },
    avatar(str(field(comment, 'author'), 'name')),
    h(
      'div',
      { class: 'comment-main' },
      h('p', { class: 'comment-head' }, userLink(ctx, field(comment, 'author')), h('time', { class: 'muted', datetime: str(comment, 'created_at') ?? null, title: formatTime(str(comment, 'created_at')) }, relativeTime(str(comment, 'created_at')))),
      h('p', { class: 'comment-text' }, linkify(str(comment, 'text') ?? '')),
      h(
        'div',
        { class: 'comment-foot' },
        statsRow(field(comment, 'stats'), [['likes', 'heart', '点赞']]),
        replies && repliesCommand && itemId && id ? h('a', { class: 'btn btn-ghost btn-sm', href: commandHref(ctx, repliesCommand, [itemId, id]) }, icon('comment'), h('span', { class: 'btn-label' }, `${formatCount(replies)} 条回复`)) : null,
      ),
    ),
  )
}

/**
 * 当前平台、端上某条已实现的命令。
 */
function findImplemented(ctx: RenderContext, resource: string, action: string): CommandMeta | undefined {
  const ep = ctx.platform?.endpoints[ctx.endpoint]
  return ep?.status === 'available' ? ep.commands.find((c) => c.resource === resource && c.action === action && c.status === 'implemented') : undefined
}

/**
 * 媒体列表（item media、live media、media upload）。
 */
function mediaTile(media: Json): HTMLElement {
  const url = str(media, 'url')
  const type = str(media, 'type') ?? 'image'
  const facts = [
    num(media, 'width') && num(media, 'height') ? `${num(media, 'width')}×${num(media, 'height')}` : null,
    num(media, 'duration') != null ? formatDuration(num(media, 'duration')) : null,
  ].filter(Boolean)
  return h(
    'li',
    { class: 'media-tile' },
    type === 'image' ? remoteImage(url, '', 'media-thumb') : h('span', { class: 'media-thumb img-placeholder' }, icon(type === 'video' ? 'video' : 'file')),
    h('div', { class: 'media-tile-body' }, h('p', { class: 'media-tile-title' }, { image: '图片', video: '视频', audio: '音频' }[type] ?? type, facts.length ? h('span', { class: 'muted' }, ` · ${facts.join(' · ')}`) : null), url ? h('a', { href: url, target: '_blank', rel: 'noreferrer noopener', class: 'media-url' }, url) : h('p', { class: 'muted' }, '平台还没有给出可访问的地址')),
  )
}

/**
 * 下载结果（File[]）。
 */
function fileRow(file: Json): HTMLElement {
  const type = str(file, 'type')
  return h(
    'li',
    { class: 'row' },
    h('span', { class: 'row-icon' }, icon(type === 'video' ? 'video' : type === 'image' ? 'image' : 'file')),
    h('div', { class: 'row-main' }, h('p', { class: 'row-title mono' }, str(file, 'path') ?? str(file, 'filename') ?? MISSING), h('p', { class: 'row-text' }, formatBytes(num(file, 'size')))),
  )
}

/**
 * 直播间卡片。
 */
function liveCard(ctx: RenderContext, live: Json): HTMLElement {
  const status = str(live, 'status')
  return h(
    'article',
    { class: 'item-card' },
    h('div', { class: 'item-cover' }, remoteImage(str(live, 'cover'), '', 'item-cover-img', 'broadcast')),
    h(
      'div',
      { class: 'item-body' },
      h('div', { class: 'item-badges' }, status ? chip(STATUS_LABELS[status]?.label ?? status, STATUS_LABELS[status]?.tone ?? 'neutral', status === 'live' ? 'broadcast' : undefined) : null),
      h('h3', { class: 'item-title' }, str(live, 'title') ?? str(live, 'id') ?? MISSING),
      h('div', { class: 'item-meta' }, avatar(str(field(live, 'host'), 'name')), userLink(ctx, field(live, 'host'))),
      statsRow(field(live, 'stats'), [['viewers', 'eye', '在看']]),
      nextActions(ctx, 'Live', live),
    ),
  )
}

/**
 * 直播事件 / 弹幕的一行。
 */
export function eventRow(event: Json): HTMLElement {
  const type = str(event, 'type') ?? 'other'
  const gift = field(event, 'gift')
  const time = str(event, 'time')
  return h(
    'li',
    { class: `event event-${type}` },
    h('time', { class: 'event-time', datetime: time }, time ? formatTime(time).slice(-5) : ''),
    h('span', { class: 'event-type' }, EVENT_LABELS[type] ?? type),
    h('span', { class: 'event-user' }, str(field(event, 'user'), 'name') ?? ''),
    h('span', { class: 'event-text' }, isObject(gift) ? `送出 ${str(gift, 'name') ?? '礼物'} ×${num(gift, 'count') ?? 1}` : (str(event, 'text') ?? '')),
  )
}

/**
 * 私信消息（Message）。
 */
export function messageRow(message: Json): HTMLElement {
  const from = field(message, 'from')
  const media = list(message, 'media')
  return h(
    'li',
    { class: 'message' },
    avatar(str(from, 'name')),
    h(
      'div',
      { class: 'message-main' },
      h('p', { class: 'message-head' }, h('span', { class: 'user-link' }, str(from, 'name') ?? str(from, 'id') ?? MISSING), h('time', { class: 'muted', datetime: str(message, 'created_at') }, formatTime(str(message, 'created_at')))),
      h('div', { class: 'bubble' }, linkify(str(message, 'text') ?? (str(message, 'type') ? `[${EVENT_LABELS[str(message, 'type')!] ?? str(message, 'type')}]` : ''))),
      media.length ? h('ul', { class: 'thumbs' }, media.map((m) => h('li', null, remoteImage(str(m, 'url'), '', 'thumb')))) : null,
    ),
  )
}

/**
 * 会话列表的一行。
 */
function conversationRow(ctx: RenderContext, conversation: Json): HTMLElement {
  const peer = field(conversation, 'peer')
  const unread = num(conversation, 'unread')
  const history = findImplemented(ctx, 'msg', 'history')
  const id = str(conversation, 'id')
  const name = str(peer, 'name') ?? str(peer, 'id') ?? id ?? MISSING
  return h(
    'li',
    { class: 'row' },
    avatar(str(peer, 'name')),
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, history && id ? h('a', { href: commandHref(ctx, history, [id]) }, name) : name, unread ? chip(`${unread} 未读`, 'danger') : null), h('p', { class: 'row-text' }, str(conversation, 'last_message') ?? '')),
    h('time', { class: 'row-side muted', datetime: str(conversation, 'updated_at') }, relativeTime(str(conversation, 'updated_at'))),
  )
}

/**
 * 账号（Account）。
 */
function accountRow(account: Json): HTMLElement {
  const user = field(account, 'user')
  const method = str(account, 'method')
  const platform = str(account, 'platform') ?? ''
  return h(
    'li',
    { class: 'row' },
    avatar(str(user, 'name') ?? str(account, 'account')),
    h('div', { class: 'row-main' }, h('p', { class: 'row-title' }, str(user, 'name') ?? '（未知用户）', field(account, 'current') === true ? chip('当前使用', 'success') : null), h('p', { class: 'row-text' }, `${findPlatform(platform)?.name ?? platform} · ${endpointLabel(str(account, 'endpoint') ?? '', findPlatform(platform))} · ${str(account, 'account')}`)),
    h('div', { class: 'row-side muted' }, method ? (METHOD_INFO[method]?.label ?? method) : null),
  )
}

/**
 * 登录态（AuthStatus）。
 */
function authStatus(ctx: RenderContext, status: Json): HTMLElement {
  if (status === null || !isObject(status) || status.logged_in !== true) {
    return callout('warning', '未登录，或者登录已失效', ctx.platform ? h('p', null, h('a', { href: href(['p', ctx.platform.id, 'login'], { e: ctx.endpoint, acct: ctx.account }) }, '去登录')) : null)
  }
  const user = field(status, 'user')
  const method = str(status, 'method')
  return callout('success', `已登录：${str(user, 'name') ?? str(user, 'id') ?? '（未知用户）'}`, kvList([
    ['登录方式', method ? (METHOD_INFO[method]?.label ?? method) : MISSING],
    ['过期时间', formatTime(str(status, 'expires_at'))],
  ]))
}

/**
 * 搜索词（Keyword）：点一下就去搜。
 */
function keywordChips(ctx: RenderContext, keywords: Json[]): HTMLElement {
  const search = findImplemented(ctx, 'item', 'search')
  return h(
    'ol',
    { class: 'keywords' },
    keywords.map((k, i) => {
      const text = str(k, 'text') ?? ''
      const heat = num(k, 'heat')
      const body: Child[] = [h('span', { class: 'keyword-rank' }, String(i + 1)), h('span', null, text), heat != null ? h('span', { class: 'muted' }, formatCount(heat)) : null]
      return h('li', null, search && ctx.platform ? h('a', { class: 'keyword', href: commandHref(ctx, search, [text]) }, body) : h('span', { class: 'keyword' }, body))
    }),
  )
}

/**
 * 通用单元格：区分缺失、布尔、时间、链接、价格、用户、计数对象。
 */
export function formatCell(value: Json | undefined): Child {
  if (value == null) return h('span', { class: 'muted' }, MISSING)
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return value.toLocaleString('zh-CN')
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value)) return h('a', { href: value, target: '_blank', rel: 'noreferrer noopener', class: 'cell-link' }, value)
    if (ISO_TIME.test(value)) return h('time', { datetime: value }, formatTime(value))
    return value
  }
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return value.map(String).join('、') || h('span', { class: 'muted' }, '无')
    return `${value.length} 项`
  }
  if (isPrice(value)) return formatPrice(num(value, 'amount'), str(value, 'currency'))
  if (typeof value.name === 'string') {
    const url = str(value, 'url')
    return url ? h('a', { href: url, target: '_blank', rel: 'noreferrer noopener' }, value.name) : value.name
  }
  const entries = Object.entries(value).filter(([, v]) => v != null)
  if (!entries.length) return h('span', { class: 'muted' }, MISSING)
  return entries.map(([k, v]) => `${FIELD_LABELS[k] ?? k} ${shortValue(v)}`).join('、')
}

/**
 * 是否为 Price（AGENTS 6.2）。
 */
function isPrice(value: Json | undefined): boolean {
  return isObject(value) && typeof value.amount === 'number' && 'currency' in value
}

/**
 * 映射里的一个值：价格、计数、封顶对象（如余票 {min: 21}）写成一小段文字。
 */
function shortValue(value: Json): string {
  if (typeof value === 'number') return formatCount(value)
  if (isPrice(value)) return formatPrice(num(value, 'amount'), str(value, 'currency'))
  if (isObject(value) && typeof value.min === 'number') return `${value.min}+`
  if (isObject(value) && typeof value.name === 'string') return value.name
  return typeof value === 'object' ? '…' : String(value)
}

/**
 * 键值列表（单个对象）。
 */
function kvList(entries: [string, Child][]): HTMLElement {
  return h('dl', { class: 'kv' }, entries.map(([k, v]) => h('div', { class: 'kv-row' }, h('dt', null, k), h('dd', null, v))))
}

/**
 * 单个对象的键值展示。
 */
function objectKv(value: JsonObject): HTMLElement {
  return kvList(Object.entries(value).map(([k, v]) => [FIELD_LABELS[k] ?? k, typeof v === 'string' && v.includes('\n') ? h('div', { class: 'prose' }, linkify(v)) : formatCell(v)]))
}

/**
 * 通用表格：列取前若干行出现过的字段。
 */
function genericTable(rows: Json[]): HTMLElement {
  const objects = rows.filter(isObject)
  if (objects.length !== rows.length) {
    return h('ol', { class: 'plain-list' }, rows.map((r) => h('li', null, formatCell(r))))
  }
  const columns: string[] = []
  const sample = objects.slice(0, COLUMN_SAMPLE)
  for (const row of sample) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
  // 整列都没有值的不展示；链接放到最后一列，只给「打开」
  const filled = columns.filter((c) => sample.some((row) => row[c] != null && row[c] !== ''))
  const ordered = [...filled.filter((c) => c !== 'url'), ...filled.filter((c) => c === 'url')]
  const shown = ordered.slice(0, MAX_COLUMNS)
  const cell = (row: JsonObject, column: string): Child => {
    const v = row[column]
    if (column === 'url' && typeof v === 'string' && /^https?:/.test(v)) return h('a', { href: v, target: '_blank', rel: 'noreferrer noopener', class: 'cell-open' }, icon('external'), '打开')
    return formatCell(v)
  }
  return h(
    'div',
    { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': '结果表格' },
    h(
      'table',
      { class: 'table' },
      h('thead', null, h('tr', null, shown.map((c) => h('th', { scope: 'col' }, FIELD_LABELS[c] ?? c)))),
      h('tbody', null, objects.map((row) => h('tr', null, shown.map((c) => h('td', { class: c === 'id' ? 'cell-id' : null }, cell(row, c)))))),
    ),
    ordered.length > shown.length ? h('p', { class: 'table-note' }, `还有 ${ordered.length - shown.length} 项信息，完整内容可在“原始数据”中查看。`) : null,
  )
}

/**
 * 某个席别的余票：数字、封顶对象（{min: 21} 表示 21 张以上），没有数据时为 null。
 */
function remainingText(value: Json | undefined): { text: string; soldOut: boolean } | null {
  if (typeof value === 'number') return { text: value === 0 ? '无票' : `${value} 张`, soldOut: value === 0 }
  if (isObject(value) && typeof value.min === 'number') return { text: `${value.min}+ 张`, soldOut: false }
  return null
}

/**
 * 12306 车次（AGENTS 6.2 Ticket）：排成一张车票，席别逐个列出余票和票价，下一步是经停站和票价详情。
 */
function ticketCard(ctx: RenderContext, ticket: Json): HTMLElement {
  const from = field(ticket, 'from')
  const to = field(ticket, 'to')
  const prices = field(ticket, 'prices')
  const remaining = field(ticket, 'remaining')
  const seats = field(ticket, 'seats')
  const names = [...new Set([...Object.keys(isObject(prices) ? prices : {}), ...Object.keys(isObject(remaining) ? remaining : {}), ...Object.keys(isObject(seats) ? seats : {})])]
  const trainNo = str(ticket, 'train_no')
  const date = str(ticket, 'date')
  const route = findImplemented(ctx, 'route', 'get')
  const fare = findImplemented(ctx, 'ticket', 'price')
  const actions: Child[] = []
  if (route && trainNo && str(from, 'code') && str(to, 'code')) actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: commandHref(ctx, route, [trainNo, str(from, 'code')!, str(to, 'code')!], date ? { date } : {}) }, icon('tasks'), h('span', { class: 'btn-label' }, '经停站')))
  if (fare && trainNo && str(from, 'no') && str(to, 'no') && str(ticket, 'seat_types')) {
    actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: commandHref(ctx, fare, [trainNo], { 'from-no': str(from, 'no')!, 'to-no': str(to, 'no')!, 'seat-types': str(ticket, 'seat_types')!, ...(date ? { date } : {}) }) }, icon('ticket'), h('span', { class: 'btn-label' }, '票价详情')))
  }
  const url = str(ticket, 'url')
  if (url) actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noreferrer noopener' }, icon('external'), h('span', { class: 'btn-label' }, '在 12306 打开')))
  const hasTicket = field(ticket, 'has_ticket') === true
  return h(
    'article',
    { class: 'train' },
    h('header', { class: 'train-head' }, h('span', { class: 'train-code' }, str(ticket, 'id') ?? MISSING), date ? h('span', { class: 'muted' }, date) : null, h('span', { class: 'train-flag' }, hasTicket ? chip('有票', 'success', 'check') : chip(field(ticket, 'bookable') === true ? '无票' : '暂不可订', 'neutral'))),
    h(
      'div',
      { class: 'train-route' },
      h('div', { class: 'train-stop' }, h('strong', null, str(ticket, 'depart') ?? MISSING), h('span', null, str(from, 'name') ?? MISSING)),
      h('div', { class: 'train-line', 'aria-hidden': 'true' }, h('span', null, str(ticket, 'duration') ?? '')),
      h('span', { class: 'sr-only' }, `历时 ${str(ticket, 'duration') ?? '未知'}`),
      h('div', { class: 'train-stop train-stop-end' }, h('strong', null, str(ticket, 'arrive') ?? MISSING), h('span', null, str(to, 'name') ?? MISSING)),
    ),
    names.length
      ? h(
          'ul',
          { class: 'train-seats' },
          names.map((name) => {
            const left = remainingText(field(remaining, name)) ?? (str(seats, name) ? { text: str(seats, name)!, soldOut: str(seats, name) === '无' } : null)
            const price = field(prices, name)
            return h('li', { class: `seat ${left?.soldOut ? 'is-sold-out' : ''}`.trim() }, h('span', { class: 'seat-name' }, name), h('span', { class: 'seat-left' }, left?.text ?? MISSING), isPrice(price) ? h('span', { class: 'seat-price' }, formatPrice(num(price, 'amount'), str(price, 'currency'))) : null)
          }),
        )
      : null,
    actions.length ? h('div', { class: 'next-actions' }, actions) : null,
  )
}

/**
 * 写操作的结果（{id} 等）：只说明实际发生的事。
 */
function writeResult(value: Json): HTMLElement {
  const body = isObject(value) ? objectKv(value) : null
  return callout('success', '已完成', body)
}

/**
 * 空列表：区分「搜索无匹配」和「本来就没有」。
 */
function emptyList(ctx: RenderContext): HTMLElement {
  const searching = ctx.command?.action === 'search'
  return emptyState({ art: 'bus', title: searching ? '没有找到匹配的结果' : '这里还没有内容', text: searching ? '换个关键词，或者调整筛选条件再试。' : '可以稍后再来看看。' })
}

/**
 * 输出类型的基本名：`Item[]` → Item。
 */
export function outputBase(output: string): { base: string; isList: boolean } {
  return { base: output.replace(/\[\]$/, ''), isList: output.endsWith('[]') }
}

/**
 * 按命令的输出类型渲染 data。
 */
export function renderData(data: Json, output: string, ctx: RenderContext): Node {
  const { base, isList } = outputBase(output)
  if (data === null && base !== 'AuthStatus') return emptyState({ title: '这次操作没有可展示的内容' })
  if (ctx.raw) return Array.isArray(data) ? (data.length ? genericTable(data) : emptyList(ctx)) : isObject(data) ? objectKv(data) : h('p', null, formatCell(data))
  if (Array.isArray(data) && data.length === 0) return emptyList(ctx)
  if (base.startsWith('{')) return Array.isArray(data) ? genericTable(data) : writeResult(data)
  const rows = Array.isArray(data) ? data : [data]
  switch (base) {
    case 'Item':
    case 'Torrent':
      return isList ? h('div', { class: 'item-grid' }, rows.map((r) => itemCard(ctx, r))) : itemDetail(ctx, data)
    case 'User':
      return isList ? h('ul', { class: 'rows' }, rows.map((r) => userRow(ctx, r))) : userProfile(ctx, data)
    case 'Comment':
      return h('ol', { class: 'comments' }, rows.map((r) => commentRow(ctx, r)))
    case 'Media':
      return h('ul', { class: 'media-list' }, rows.map(mediaTile))
    case 'File':
      return h('ul', { class: 'rows' }, rows.map(fileRow))
    case 'Live':
      return h('div', { class: 'item-grid' }, rows.map((r) => liveCard(ctx, r)))
    case 'Event':
      return h('ol', { class: 'events' }, rows.map(eventRow))
    case 'Message':
      return h('ol', { class: 'messages' }, rows.map(messageRow))
    case 'Conversation':
      return h('ul', { class: 'rows' }, rows.map((r) => conversationRow(ctx, r)))
    case 'Account':
      return h('ul', { class: 'rows' }, rows.map(accountRow))
    case 'AuthStatus':
      return authStatus(ctx, data)
    case 'Keyword':
      return keywordChips(ctx, rows)
    case 'Ticket':
      return h('div', { class: 'trains' }, rows.map((r) => ticketCard(ctx, r)))
    default:
      return isList ? genericTable(rows) : isObject(data) ? objectKv(data) : h('p', null, formatCell(data))
  }
}
