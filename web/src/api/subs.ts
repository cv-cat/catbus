import type { CatbusError, Envelope, Item } from './types'
import { BridgeError } from './client'
import { isDemo } from '@/stores/source'
import { mockSubs } from './mock/subs'

/**
 * 订阅（AGENTS.md 7.9「订阅」）：`/api/subs/*`，服务端定时检查有没有新内容（src/webui/subscriptions.ts）。
 * 演示模式不请求服务端，订阅只存在内存里（mock/subs.ts）。
 */
export type SubKind = 'keyword' | 'author'
export interface Sub {
  id: string
  platform: string
  kind: SubKind
  /** 关键词，或作者的链接 / ID */
  query: string
  /** 显示名：关键词本身或作者昵称 */
  label: string
  account: string | null
  created_at: string
  /** 上次检查成功的时间；null 表示还没检查过 */
  last_check: string | null
  /** 下次检查的毫秒时间戳 */
  next_check: number
  /** 上次检查的错误（错误信封里的 error）；成功后清掉 */
  error: CatbusError | null
  seen: string[]
  /** 新内容，新的在前 */
  unread: Item[]
}
export interface SubsPaused {
  at: string
  verify_url: string | null
}
export interface SubsState {
  subs: Sub[]
  paused: Record<string, SubsPaused>
}
export interface NewSub {
  platform: string
  kind: SubKind
  query: string
  label?: string
  account?: string | null
}

/** 与服务端一致：最多 50 条订阅 */
export const MAX_SUBS = 50

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/subs${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let env: Envelope<T>
  try {
    env = (await res.json()) as Envelope<T>
  } catch {
    throw new BridgeError({ code: 'BRIDGE', message: `HTTP ${res.status}`, hint: null, detail: null })
  }
  if (!env.ok) throw new BridgeError(env.error ?? { code: 'BRIDGE', message: `HTTP ${res.status}`, hint: null, detail: null })
  return env.data as T
}

export const subsApi = {
  list: (): Promise<SubsState> => (isDemo() ? mockSubs.list() : request<SubsState>('')),
  add: (s: NewSub): Promise<Sub> => (isDemo() ? mockSubs.add(s) : request<Sub>('/add', s)),
  remove: (id: string): Promise<{ removed: boolean }> => (isDemo() ? mockSubs.remove(id) : request('/remove', { id })),
  read: (id: string): Promise<Sub> => (isDemo() ? mockSubs.read(id) : request<Sub>('/read', { id })),
  check: (id: string): Promise<Sub> => (isDemo() ? mockSubs.check(id) : request<Sub>('/check', { id })),
  resume: (platform: string): Promise<{ resumed: boolean }> => (isDemo() ? mockSubs.resume(platform) : request('/resume', { platform })),
}
