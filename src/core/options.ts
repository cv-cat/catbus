import { z } from 'zod'

/** 标准选项（AGENTS 4.9）。平台私有选项不能与它们重名。 */

export const PAGING = {
  limit: z.number().int().positive().optional().describe('取满 N 条，自动翻页'),
  cursor: z.string().optional().describe('从上次返回的 page.cursor 继续翻'),
  all: z.boolean().optional().describe('一直翻到没有更多'),
}

export const FILTER_VALUES = {
  sort: ['general', 'latest', 'popular', 'views', 'comments', 'collects', 'sales', 'price_asc', 'price_desc'],
  type: ['all', 'video', 'image', 'text', 'article', 'goods'],
  time: ['all', 'day', 'week', 'month', 'half_year', 'year'],
  kind: ['recommend', 'hot', 'following'],
} as const

export type FilterName = keyof typeof FILTER_VALUES
type FilterValue<N extends FilterName> = (typeof FILTER_VALUES)[N][number]

export const LOGIN_METHODS = ['qrcode', 'sms', 'password', 'cookie'] as const
export type LoginMethod = (typeof LOGIN_METHODS)[number]

export const VISIBILITY_VALUES = ['public', 'private', 'friends', 'fans'] as const
type Visibility = (typeof VISIBILITY_VALUES)[number]

/**
 * 有标准取值的选项。取值是标准值、但平台不支持时报 UNSUPPORTED；不是标准值时报 USAGE。
 */
export const STANDARD_VALUES: Record<string, readonly string[]> = { ...FILTER_VALUES, method: LOGIN_METHODS, visibility: VISIBILITY_VALUES }

const FILTER_SUMMARY: Record<FilterName, string> = { sort: '排序', type: '类型', time: '时间范围', kind: '流的种类' }

function makeFilter<N extends FilterName>(name: N, values: FilterValue<N>[], preferred?: FilterValue<N>) {
  if (values.length === 0) throw new Error(`filter.${name}() 至少要一个取值`)
  const schema = z.enum(values as [string, ...string[]]).describe(FILTER_SUMMARY[name])
  return preferred && values.includes(preferred) ? schema.default(preferred) : schema.optional()
}

/** 在注册表里声明平台支持的筛选取值，例如 `filter.sort('general', 'latest')`。 */
export const filter = {
  sort: (...values: FilterValue<'sort'>[]) => makeFilter('sort', values),
  type: (...values: FilterValue<'type'>[]) => makeFilter('type', values),
  time: (...values: FilterValue<'time'>[]) => makeFilter('time', values),
  kind: (...values: FilterValue<'kind'>[]) => makeFilter('kind', values, 'recommend'),
}

/** `--visibility` 的取值。平台支持的与默认的 public / private / friends 不同时，在注册表里声明，例如 `visibility('public', 'fans')`。 */
export const visibility = (...values: Visibility[]) => z.enum(values as [Visibility, ...Visibility[]]).default('public').describe('可见范围')

export const CATEGORY = z.string().optional().describe('分类 id，取值来自对应的 categories 命令')

/** `comment list --product`：传纯 ID 时按商品处理，列出商品评价（AGENTS 4.8）。 */
export const PRODUCT = z.boolean().optional().describe('把参数当作商品，列出商品评价')

export const PUBLISH = {
  title: z.string().optional().describe('标题'),
  text: z.string().optional().describe('正文，@file 表示从文件读取'),
  image: z.array(z.string()).optional().describe('图片（路径或 URL）'),
  video: z.string().optional().describe('视频（路径或 URL）'),
  cover: z.string().optional().describe('封面（路径或 URL）'),
  tag: z.array(z.string()).optional().describe('标签'),
  topic: z.array(z.string()).optional().describe('话题'),
  mention: z.array(z.string()).optional().describe('@ 的用户'),
  poi: z.string().optional().describe('地点 id'),
  category: CATEGORY,
  visibility: visibility('public', 'private', 'friends'),
  schedule: z.iso.datetime({ offset: true, local: true }).optional().describe('定时发布（ISO 时间）'),
  price: z.number().positive().optional().describe('商品价格（元）'),
}

export const DOWNLOAD = {
  dir: z.string().optional().describe('下载目录，默认当前目录'),
  overwrite: z.boolean().optional().describe('覆盖已有文件，默认跳过'),
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(s|m|h)?$/

export const STREAM = {
  duration: z.string().regex(DURATION_RE, '格式为秒数，或 30s、10m、1h').optional().describe('运行时长，例如 600、10m、1h'),
}

/** `--duration` 转成毫秒。 */
export function parseDuration(value: string): number {
  const m = DURATION_RE.exec(value)
  if (!m) throw new Error(`无效的时长：${value}`)
  const unit = { s: 1, m: 60, h: 3600 }[(m[2] ?? 's') as 's' | 'm' | 'h']
  return Number(m[1]) * unit * 1000
}

export const STANDARD_OPTIONS: Record<string, z.ZodType> = {
  ...PAGING,
  ...Object.fromEntries(Object.keys(FILTER_VALUES).map((k) => [k, z.string().optional()])),
  ...PUBLISH,
  ...DOWNLOAD,
  ...STREAM,
}

export type OptionKind = 'string' | 'number' | 'boolean' | 'array'

export interface OptionInfo {
  kind: OptionKind
  required: boolean
  default: unknown
  values: readonly string[] | null
  description: string | null
}

/** 从 zod schema 读出 argv 需要的信息：类型、是否必填、默认值、枚举值、说明。 */
export function describeOption(schema: z.ZodType): OptionInfo {
  let s = schema as any
  let required = true
  let dflt: unknown
  let description: string | null = s.description ?? null
  for (;;) {
    const def = s._zod.def
    if (def.type === 'optional' || def.type === 'nullable') required = false
    else if (def.type === 'default') {
      required = false
      dflt = def.defaultValue
    } else break
    s = def.innerType
    description ??= s.description ?? null
  }
  const type = s._zod.def.type
  const kind: OptionKind = type === 'boolean' ? 'boolean' : type === 'number' ? 'number' : type === 'array' ? 'array' : 'string'
  const values = type === 'enum' ? (s.options as string[]) : null
  return { kind, required, default: dflt, values, description }
}

/** camelCase 键名 → kebab-case 选项名。 */
export function flagName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}
