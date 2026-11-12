import type { Platform } from '../core/registry.js'

/**
 * 筛选能力（AGENTS.md 7.9「筛选」）：GET /api/filters，从本包的注册表读出各平台 web 端
 * `item search` 支持的 `--sort` / `--type` / `--time` 取值和 `feed list` 的 `--kind` 取值，页面据此把不支持的筛选置灰。
 * 只是注册表里的公开信息，不碰账号，演示模式下同样可用。
 */

/** null 表示该命令没有这个筛选（只能用默认值）；platform 的 search 为 false 表示没有已实现的 item search */
export interface PlatformFilters {
  search: boolean
  sort: string[] | null
  type: string[] | null
  /** `item search` 的时间范围 `--time` */
  time: string[] | null
  /** 已实现的 `feed list` 的流种类 `--kind`（推荐 / 热门 / 关注）；没有已实现的 feed list 时为 null */
  kind: string[] | null
  /** 平台私有的字段排序 `--order-by` 的取值（目前只有 mteam）；没有时为 null */
  order: string[] | null
  /** `user get` 和 `user items` 都已实现：作者可以做成站内的作者页（AGENTS.md 7.9「作者页」） */
  author: boolean
}

const FILTERS = ['sort', 'type', 'time'] as const

/** zod 的 enum 外面可能包了 optional / default：一层层拆开取 options */
function enumValues(schema: unknown): string[] | null {
  let s = schema as { options?: unknown; unwrap?: () => unknown; def?: { innerType?: unknown } } | undefined
  for (let i = 0; s && i < 4; i++) {
    if (Array.isArray(s.options)) return s.options.map(String)
    s = (typeof s.unwrap === 'function' ? s.unwrap() : s.def?.innerType) as typeof s
  }
  return null
}

let cached: Promise<Record<string, PlatformFilters>> | null = null

export function platformFilters(): Promise<Record<string, PlatformFilters>> {
  cached ??= import('../platforms/index.js').then(({ PLATFORMS }: { PLATFORMS: Platform[] }) => {
    const out: Record<string, PlatformFilters> = {}
    for (const p of PLATFORMS) {
      const web = p.endpoints.web
      if (!web || web === 'planned') continue
      const cmd = web.commands.get('item search')
      const entry: PlatformFilters = { search: cmd?.status === 'implemented', sort: null, type: null, time: null, kind: null, order: null, author: false }
      for (const k of FILTERS) entry[k] = cmd ? enumValues(cmd.options[k]) : null
      const feed = web.commands.get('feed list')
      entry.kind = feed?.status === 'implemented' ? enumValues(feed.options.kind) : null
      entry.order = cmd ? enumValues(cmd.options.orderBy) : null
      entry.author = ['user get', 'user items'].every((k) => web.commands.get(k)?.status === 'implemented')
      out[p.id] = entry
    }
    return out
  })
  return cached
}
