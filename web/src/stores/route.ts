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
