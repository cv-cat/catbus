import { mockConversations, mockMessages, mockNoticeCount, mockNotices } from './mock'
import type { Conversation, Envelope, Message, Notice, NoticeCount } from './types'
import { isDemo } from '@/stores/source'
import { call } from './client'

/**
 * 收件箱（AGENTS.md 7.9「通知与私信」）：notice list / count、msg list / history，全部只读。
 * 会话 id 放在位置参数里，bridge 规范化时挪到 `--` 之后。
 */
export type InboxTab = 'notices' | 'messages'
export const INBOX_TABS: readonly InboxTab[] = ['notices', 'messages']
export const NOTICE_TYPES = ['comment', 'mention', 'like', 'follow', 'system'] as const
export type NoticeType = (typeof NOTICE_TYPES)[number]

export interface PageOpts {
  cursor?: string | null
  limit: number
  account?: string | null
  signal?: AbortSignal
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const offsetOf = (c: string | null | undefined) => Number(c ?? 0) || 0

function paged(argv: string[], o: PageOpts): string[] {
  if (o.account) argv.push('-a', o.account)
  argv.push('--limit', String(o.limit))
  if (o.cursor) argv.push('--cursor', o.cursor)
  return argv
}

export async function listNotices(platform: string, o: PageOpts): Promise<Envelope<Notice[]>> {
  if (isDemo()) {
    await wait(500)
    return mockNotices(platform, offsetOf(o.cursor), o.limit)
  }
  return call<Notice[]>(paged([platform, 'notice', 'list'], o), o.signal)
}

export async function getNoticeCount(platform: string, account?: string | null, signal?: AbortSignal): Promise<Envelope<NoticeCount>> {
  if (isDemo()) {
    await wait(300)
    return mockNoticeCount(platform)
  }
  const argv = [platform, 'notice', 'count']
  if (account) argv.push('-a', account)
  return call<NoticeCount>(argv, signal)
}

export async function listConversations(platform: string, o: PageOpts): Promise<Envelope<Conversation[]>> {
  if (isDemo()) {
    await wait(450)
    return mockConversations(platform, o.account ?? null, offsetOf(o.cursor), o.limit)
  }
  return call<Conversation[]>(paged([platform, 'msg', 'list'], o), o.signal)
}

export async function listMessages(platform: string, conversation: string, o: PageOpts): Promise<Envelope<Message[]>> {
  if (isDemo()) {
    await wait(450)
    return mockMessages(platform, o.account ?? null, conversation, offsetOf(o.cursor), o.limit)
  }
  return call<Message[]>(paged([platform, 'msg', 'history', conversation], o), o.signal)
}

/** 当前列表的等价命令（AGENTS.md 7.9「复制等价命令」）：[argv, 位置参数个数] */
export function inboxArgv(platform: string, tab: InboxTab, conversation: string | null, account: string | null, limit: number): [string[], number] {
  const argv = tab === 'notices' ? [platform, 'notice', 'list'] : conversation ? [platform, 'msg', 'history', conversation] : [platform, 'msg', 'list']
  if (account) argv.push('-a', account)
  argv.push('--limit', String(limit))
  return [argv, tab === 'messages' && conversation ? 1 : 0]
}
