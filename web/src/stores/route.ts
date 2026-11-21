import { shallowRef } from 'vue'
import { platformById } from '@/data/platforms'

/**
 * 作者页的地址（AGENTS.md 7.9「地址」「作者页」）：`/<平台规范 id>/user?u=<作者 url 或 id>`，`?demo` 保留在最前。
 * 发现页和作者页共用地址栏：发现页（stores/discover）据此在作者页上不改地址、不响应作者页的前进 / 后退。
 * 单独放一个文件，发现页和作者页的 store 都引用它，避免两个 store 互相引用。
 */
export interface AuthorRoute {
  platform: string
  /** 作者：`url`（小红书的链接带 xsec_token）或 `id` */
  user: string
}

/** 当前地址是不是作者页；不是（或缺 `u`、平台未知）时为 null */
export function parseAuthorPath(): AuthorRoute | null {
  const m = /^\/([^/]+)\/user\/?$/.exec(location.pathname)
  if (!m) return null
  let id = m[1]!
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  const platform = platformById(id)?.id
  const user = new URLSearchParams(location.search).get('u')?.trim()
  return platform && user ? { platform, user } : null
}

export function authorPath(r: AuthorRoute): string {
  const demo = new URLSearchParams(location.search).has('demo') ? 'demo&' : ''
  return `/${encodeURIComponent(r.platform)}/user?${demo}u=${encodeURIComponent(r.user)}`
}

/** 正在看的作者页；null 表示在发现页。打开页面时按地址初始化 */
export const authorRoute = shallowRef<AuthorRoute | null>(parseAuthorPath())

/**
 * 12306 查询页（AGENTS.md 7.9「12306 查询页」）：地址 `/12306?from=…&to=…&date=…&view=transfer&via=…`。
 * 发现页在后台不动（不改地址、不响应查询页的前进 / 后退）；状态在 stores/rail。
 */
export const RAIL_ID = '12306'
export const isRailPath = () => /^\/12306\/?$/.test(location.pathname)
/** 正在看 12306 查询页；打开页面时按地址初始化 */
export const railActive = shallowRef(isRailPath())

/**
 * M-Team「我的」页（AGENTS.md 7.9「M-Team「我的」页与筛选」）：地址 `/mteam/me[?tab=<status>]`。
 * 同样盖在发现页上面，发现页在后台不动；状态在 stores/mteam。
 */
export const isMePath = () => /^\/mteam\/me\/?$/.test(location.pathname)
/** 正在看「我的」页；打开页面时按地址初始化 */
export const meActive = shallowRef(isMePath())

/**
 * 各平台的「我的」页（AGENTS.md 7.9「各平台的「我的」页」）：地址 `/<平台>/me[?tab=<标签>&folder=<id>|series=<id>]`。
 * M-Team 用自己的 `/mteam/me`（上面的 isMePath），不算在这里。同样盖在发现页上面；状态在 stores/mine。
 */
export interface MineRoute {
  platform: string
  /** 地址里的标签；null 表示默认标签（是否可用由 stores/mine 按能力校正） */
  tab: string | null
  /** 收藏夹、合集里点开的那一个 */
  sub: string | null
}
export function parseMinePath(): MineRoute | null {
  const m = /^\/([^/]+)\/me\/?$/.exec(location.pathname)
  if (!m) return null
  let id = m[1]!
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  const platform = platformById(id)?.id
  if (!platform || platform === 'mteam') return null
  const q = new URLSearchParams(location.search)
  return { platform, tab: q.get('tab'), sub: q.get('folder') ?? q.get('series') }
}
export const mineRoute = shallowRef<MineRoute | null>(parseMinePath())

/** 本地收藏（AGENTS.md 7.9「本地收藏与稍后看」）：地址 `/local[?group=<分组 id>]` */
export const isLocalPath = () => /^\/local\/?$/.test(location.pathname)
export const localActive = shallowRef(isLocalPath())

/** 订阅（AGENTS.md 7.9「订阅」）：地址 `/subs[?sub=<订阅 id>]` */
export const isSubsPath = () => /^\/subs\/?$/.test(location.pathname)
export const subsActive = shallowRef(isSubsPath())

/** 直播弹幕（AGENTS.md 7.9「直播弹幕」）：地址 `/<平台>/live[?room=<直播间>]` */
export interface LiveRoute {
  platform: string
  room: string | null
}
export function parseLivePath(): LiveRoute | null {
  const m = /^\/([^/]+)\/live\/?$/.exec(location.pathname)
  if (!m) return null
  let id = m[1]!
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  const platform = platformById(id)?.id
  return platform ? { platform, room: new URLSearchParams(location.search).get('room')?.trim() || null } : null
}
export const liveRoute = shallowRef<LiveRoute | null>(parseLivePath())

/** 收件箱（AGENTS.md 7.9「通知与私信」）：地址 `/<平台>/inbox[?tab=<notices|messages>&type=<通知类型>&c=<会话 id>]` */
export interface InboxRoute {
  platform: string
  /** 地址里的标签；null 表示默认标签（是否可用由 stores/inbox 按能力校正） */
  tab: string | null
  /** 通知的类型过滤；null 表示全部 */
  type: string | null
  /** 选中的会话 */
  conv: string | null
}
export function parseInboxPath(): InboxRoute | null {
  const m = /^\/([^/]+)\/inbox\/?$/.exec(location.pathname)
  if (!m) return null
  let id = m[1]!
  try {
    id = decodeURIComponent(id)
  } catch {
    return null
  }
  const platform = platformById(id)?.id
  if (!platform) return null
  const q = new URLSearchParams(location.search)
  return { platform, tab: q.get('tab'), type: q.get('type'), conv: q.get('c') || null }
}
export const inboxRoute = shallowRef<InboxRoute | null>(parseInboxPath())

/** 当前地址是不是盖在发现页上面的页（作者页、查询页、「我的」页、本地收藏）：发现页不接管这些地址 */
export const isOverlayPath = () => Boolean(parseAuthorPath() || isRailPath() || isMePath() || parseMinePath() || isLocalPath() || isSubsPath() || parseLivePath() || parseInboxPath())
/** 现在是否正盖着一页（发现页在后台更新，不写地址） */
export const overlayActive = () => Boolean(authorRoute.value || railActive.value || meActive.value || mineRoute.value || localActive.value || subsActive.value || liveRoute.value || inboxRoute.value)
/** 进入某一页前收起其余叠加页 */
export function closeOverlays() {
  authorRoute.value = null
  railActive.value = false
  meActive.value = false
  mineRoute.value = null
  localActive.value = false
  subsActive.value = false
  liveRoute.value = null
  inboxRoute.value = null
}
