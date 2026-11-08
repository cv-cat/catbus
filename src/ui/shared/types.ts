/**
 * Web 面板服务端与浏览器之间传递的数据结构（AGENTS 4.13）。只有类型，两端共用。
 */

export const ENDPOINT_NAMES = ['web', 'app', 'pc'] as const
export type EndpointName = (typeof ENDPOINT_NAMES)[number]

export type OptionKindName = 'string' | 'number' | 'boolean' | 'array'
export type OptionValue = string | number | boolean | string[]

/** 选项分组：翻页、标准选项（AGENTS 4.9）、平台私有选项。 */
export type OptionGroup = 'paging' | 'standard' | 'private'

/** 危险操作确认：总是、取决于选项（如 `live send --gift`）、不需要。 */
export type ConfirmKind = 'always' | 'conditional' | 'never'

export interface ArgMeta {
  name: string
  summary: string
  optional: boolean
  default: string | null
}

export interface OptionMeta {
  /** 选项名（kebab-case，不带 --）。 */
  flag: string
  kind: OptionKindName
  required: boolean
  default: string | number | boolean | null
  values: string[] | null
  description: string | null
  group: OptionGroup
}

export interface CommandMeta {
  resource: string
  action: string
  summary: string
  args: ArgMeta[]
  options: OptionMeta[]
  auth: 'required' | 'optional'
  output: string
  paged: boolean
  stream: boolean
  confirm: ConfirmKind
  status: 'implemented' | 'planned'
  upstream: 'full' | 'partial' | 'none' | null
  note: string | null
  extension: boolean
}

export interface LoginMeta {
  methods: string[]
  default: string | null
  scopes: string[]
}

export type EndpointMeta =
  | { status: 'available'; label?: string; guest: boolean; login: LoginMeta; commands: CommandMeta[] }
  | { status: 'planned' }

export interface PlatformMeta {
  id: string
  name: string
  aliases: string[]
  item: string
  defaultEndpoint: EndpointName
  endpoints: Record<EndpointName, EndpointMeta>
}

export interface PanelMeta {
  version: string
  /** 启动面板时的当前目录：子进程的工作目录，也是下载的默认目录。 */
  cwd: string
  platforms: PlatformMeta[]
}

/** 执行一条 catbus 命令的请求。 */
export interface RunRequest {
  /** 平台规范 id；全局命令为 null。 */
  platform: string | null
  endpoint: EndpointName
  resource: string
  /** 没有子命令的全局命令（doctor、version）为 null。 */
  action: string | null
  /** 位置参数，按注册表的顺序。 */
  args: string[]
  /** 键是选项名（kebab-case，不带 --）。 */
  options: Record<string, OptionValue>
  account: string | null
  raw: boolean
  verbose: boolean
  proxy: string | null
  /** 带 -y：用户已在面板上确认危险操作。 */
  yes: boolean
}

/** 新建任务。stdin 只交给子进程，不进任务记录（AGENTS 4.13「敏感输入」）。 */
export interface CreateJobBody {
  request: RunRequest
  stdin: string | null
  /** false 表示面板内部的查询（例如刷新账号列表），不出现在「任务」里。 */
  track: boolean
}

export type JobState = 'running' | 'succeeded' | 'failed' | 'stopped'

export interface JobSummary {
  id: string
  request: RunRequest
  /** 等价的 CLI 命令。 */
  command: string
  state: JobState
  started_at: string
  ended_at: string | null
  exit_code: number | null
  /** 长连接命令和 auth login 可以停止。 */
  stoppable: boolean
  track: boolean
}

/**
 * 任务事件。信封和流式条目保留子进程输出的原文，避免大整数在解析时丢精度。
 */
export type JobEvent =
  | { type: 'log'; text: string }
  | { type: 'item'; text: string }
  | { type: 'qrcode'; version: number }
  | { type: 'dropped'; count: number }
  | { type: 'end'; state: JobState; exit_code: number | null; envelope: string | null; ended_at: string }

export interface UploadResult {
  path: string
  name: string
  size: number
}
