import type { CommandMeta, EndpointMeta, EndpointName, PanelMeta, PlatformMeta } from '../shared/types.js'
import { runQuiet } from './api.js'
import { isObject, type Json, str } from './json.js'

/**
 * 面板的会话状态：注册表元数据、账号列表、每个平台选中的端与账号、每条命令的表单记忆。只在内存里。
 */

export interface AccountInfo {
  platform: string
  endpoint: EndpointName
  account: string
  current: boolean
  userName: string | null
  userId: string | null
  userUrl: string | null
  method: string | null
  updatedAt: string | null
}

export interface Selection {
  endpoint: EndpointName
  /** null 表示用当前账号（CLI 的 _current）；guest 表示游客。 */
  account: string | null
}

/** 表单记忆：返回命令页时恢复填过的值和上一次的结果（intent-ui：返回时恢复浏览位置）。密码、cookie 等敏感输入不记。 */
export interface FormMemory {
  values: Record<string, string | string[] | boolean>
  jobIds: string[]
}

type Listener = () => void

let meta: PanelMeta | null = null
let accounts: AccountInfo[] | null = null
let accountsError: string | null = null
const selections = new Map<string, Selection>()
const memories = new Map<string, FormMemory>()
const listeners = new Set<Listener>()

/**
 * 设置启动时取到的元数据。
 */
export function setMeta(value: PanelMeta): void {
  // 已打开的面板服务可能尚未重启；兼容它没有下发默认连接方式的旧数据。
  for (const platform of value.platforms) {
    platform.defaultEndpoint ??= (['web', 'app', 'pc'] as const).find((e) => platform.endpoints[e].status === 'available') ?? 'web'
  }
  meta = value
}

/**
 * 当前的元数据（启动后一定存在）。
 */
export function getMeta(): PanelMeta {
  if (!meta) throw new Error('页面信息还没有加载，请刷新后重试')
  return meta
}

/**
 * 按规范 id 找平台。
 */
export function findPlatform(id: string): PlatformMeta | undefined {
  return getMeta().platforms.find((p) => p.id === id)
}

/**
 * 平台某个端上的命令；端为 planned 或没有这条命令时为 undefined。
 */
export function findCommand(platform: PlatformMeta, endpoint: EndpointName, resource: string, action: string): CommandMeta | undefined {
  const ep: EndpointMeta = platform.endpoints[endpoint]
  return ep.status === 'available' ? ep.commands.find((c) => c.resource === resource && c.action === action) : undefined
}

/**
 * 订阅账号列表的变化（侧栏的登录状态、首页卡片）。
 */
export function onAccountsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 把 `auth list` 的一条 Account 转成面板用的结构。
 */
function toAccountInfo(value: Json): AccountInfo | null {
  if (!isObject(value)) return null
  const platform = str(value, 'platform')
  const account = str(value, 'account')
  if (!platform || !account) return null
  const user = value.user ?? null
  return {
    platform,
    endpoint: (str(value, 'endpoint') ?? 'web') as EndpointName,
    account,
    current: value.current === true,
    userName: str(user, 'name'),
    userId: str(user, 'id'),
    userUrl: str(user, 'url'),
    method: str(value, 'method'),
    updatedAt: str(value, 'updated_at'),
  }
}

/**
 * 重新读取所有平台的账号（全局 `auth list`），通知订阅者。
 */
export async function refreshAccounts(): Promise<void> {
  try {
    const envelope = await runQuiet({ platform: null, resource: 'auth', action: 'list' })
    if (!envelope.ok) throw new Error(envelope.error?.message ?? '读取账号失败')
    accounts = (Array.isArray(envelope.data) ? envelope.data : []).map(toAccountInfo).filter((a): a is AccountInfo => a != null)
    accountsError = null
  } catch (err) {
    accountsError = err instanceof Error ? err.message : String(err)
  }
  for (const listener of listeners) listener()
}

/**
 * 账号列表；还没读到时为 null。
 */
export function getAccounts(): AccountInfo[] | null {
  return accounts
}

/**
 * 读取账号列表时的错误。
 */
export function getAccountsError(): string | null {
  return accountsError
}

/**
 * 某个平台、某个端的账号。
 */
export function accountsOf(platform: string, endpoint: EndpointName): AccountInfo[] {
  return (accounts ?? []).filter((a) => a.platform === platform && a.endpoint === endpoint)
}

/**
 * 某个平台选中的端和账号；没有选过时为 web 端、当前账号。
 */
export function getSelection(platform: string): Selection {
  return selections.get(platform) ?? { endpoint: findPlatform(platform)?.defaultEndpoint ?? 'web', account: null }
}

/**
 * 记录某个平台选中的端和账号。
 */
export function setSelection(platform: string, selection: Selection): void {
  selections.set(platform, selection)
}

/**
 * 命令页的表单记忆。
 */
export function getMemory(key: string): FormMemory | undefined {
  return memories.get(key)
}

/**
 * 保存命令页的表单记忆。
 */
export function setMemory(key: string, memory: FormMemory): void {
  memories.set(key, memory)
}
