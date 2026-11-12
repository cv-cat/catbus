import type { Platform } from '../core/registry.js'

/**
 * 筛选能力（AGENTS.md 7.9「筛选」）：GET /api/filters，从本包的注册表读出各平台 web 端
 * `item search` 支持的 `--sort` / `--type` 取值，页面据此把不支持的筛选置灰。
 * 只是注册表里的公开信息，不碰账号，演示模式下同样可用。
 */

/** null 表示该命令没有这个筛选（只能用默认值）；platform 的 search 为 false 表示没有已实现的 item search */
export interface PlatformFilters {
  search: boolean
  sort: string[] | null
  type: string[] | null
  /** 平台私有的字段排序 `--order-by` 的取值（目前只有 mteam）；没有时为 null */
  order: string[] | null
  /** web 端的 `item related` 已实现：详情卡片显示相关推荐（AGENTS.md 7.9「相关推荐」） */
  related: boolean
}

const FILTERS = ['sort', 'type'] as const

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
      const entry: PlatformFilters = { search: cmd?.status === 'implemented', sort: null, type: null, order: null, related: web.commands.get('item related')?.status === 'implemented' }
      for (const k of FILTERS) entry[k] = cmd ? enumValues(cmd.options[k]) : null
      entry.order = cmd ? enumValues(cmd.options.orderBy) : null
      out[p.id] = entry
    }
    return out
  })
  return cached
}
