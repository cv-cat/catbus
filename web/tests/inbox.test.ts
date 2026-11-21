import { afterEach, describe, expect, it } from 'vitest'
import { inboxArgv } from '@/api/inbox'
import { MOCK_INBOX, mockConversations, mockFilters, mockMessages, mockNoticeCount, mockNotices } from '@/api/mock'
import { isOverlayPath, parseInboxPath } from '@/stores/route'
import { orderMessages } from '@/stores/inbox'
import type { Message } from '@/api/types'
import { fromUrl } from '@/stores/discover'
import { go } from './fixtures'

describe('收件箱（7.9「通知与私信」）', () => {
  afterEach(() => go('/'))

  it('地址：平台、标签、类型、会话；未知平台不是收件箱', () => {
    go('/xhs/inbox?tab=messages&c=group%3A42')
    expect(parseInboxPath()).toEqual({ platform: 'xhs', tab: 'messages', type: null, conv: 'group:42' })
    expect(isOverlayPath()).toBe(true)
    go('/douyin/inbox?type=like')
    expect(parseInboxPath()).toMatchObject({ platform: 'douyin', type: 'like' })
    go('/nope/inbox')
    expect(parseInboxPath()).toBeNull()
  })

  it('直接打开别的平台的收件箱：发现页（侧栏）停在同一个平台', () => {
    const d = { platform: 'xhs', sort: 'general', type: 'all' }
    go('/douyin/inbox?demo')
    expect(fromUrl(d).platform).toBe('douyin')
    go('/kuaishou/inbox?tab=messages&c=c1')
    expect(fromUrl(d).platform).toBe('kuaishou')
  })

  it('等价命令：通知和会话列表不带位置参数，消息带会话', () => {
    expect(inboxArgv('xhs', 'notices', null, 'work', 20)).toEqual([['xhs', 'notice', 'list', '-a', 'work', '--limit', '20'], 0])
    expect(inboxArgv('xhs', 'messages', null, null, 20)).toEqual([['xhs', 'msg', 'list', '--limit', '20'], 0])
    expect(inboxArgv('xhs', 'messages', 'c1', null, 20)).toEqual([['xhs', 'msg', 'history', 'c1', '--limit', '20'], 1])
  })

  it('消息按时间从早到晚；缺时间时保持原顺序', () => {
    const m = (id: string, at: string | null): Message => ({ id, conversation_id: 'c', from: null, type: 'text', text: id, media: [], created_at: at })
    expect(orderMessages([m('b', '2026-01-02T00:00:00Z'), m('a', '2026-01-01T00:00:00Z')]).map((x) => x.id)).toEqual(['a', 'b'])
    expect(orderMessages([m('b', null), m('a', '2026-01-01T00:00:00Z')]).map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('演示数据：通知可翻页且覆盖五种类型，消息往更早翻，M-Team 的 API Key 账号报 UNSUPPORTED', () => {
    const first = mockNotices('xhs', 0, 20)
    expect(first.data).toHaveLength(20)
    expect(first.page!.has_more).toBe(true)
    expect(new Set(first.data!.map((n) => n.type))).toEqual(new Set(['comment', 'mention', 'like', 'follow', 'system']))
    expect(mockNoticeCount('xhs').data!.total).toBeGreaterThan(0)
    const convs = mockConversations('xhs', null, 0, 20).data!
    expect(convs.some((c) => c.id.startsWith('group:') && c.peer === null)).toBe(true)
    const page1 = mockMessages('xhs', null, 'c0', 0, 20).data!
    const page2 = mockMessages('xhs', null, 'c0', 20, 20).data!
    expect(Date.parse(page2.at(-1)!.created_at!)).toBeLessThan(Date.parse(page1[0]!.created_at!))
    expect(mockMessages('xhs', null, convs.at(-1)!.id, 0, 20).data).toEqual([])
    expect(mockConversations('mteam', 'default', 0, 20).error?.code).toBe('UNSUPPORTED')
    expect(mockConversations('mteam', 'acc-1', 0, 20).ok).toBe(true)
    expect(mockFilters().xhs!.inbox).toEqual(MOCK_INBOX.xhs)
    expect(mockFilters().weibo!.inbox).toEqual({ notices: false, count: false, messages: false })
  })
})

describe('收件箱的时间与分组', async () => {
  const { dayGroup, groupByDay, shortId } = await import('@/composables/inbox')
  const now = new Date(2026, 10, 17, 15, 0).getTime()
  const at = (d: number, h: number) => new Date(2026, 10, 17 - d, h, 0).toISOString()

  it('按日历日分组：今天、昨天、本周、更早', () => {
    expect(dayGroup(at(0, 1), now)).toBe('today')
    expect(dayGroup(at(1, 23), now)).toBe('yesterday')
    expect(dayGroup(at(6, 12), now)).toBe('week')
    expect(dayGroup(at(7, 12), now)).toBe('earlier')
    expect(dayGroup(null, now)).toBe('earlier')
  })

  it('相邻的同组合在一起，保持原顺序', () => {
    const n = (id: string, created_at: string) => ({ id, type: 'like', user: null, target: null, text: null, created_at })
    const g = groupByDay([n('a', at(0, 9)), n('b', at(0, 8)), n('c', at(1, 9)), n('d', at(9, 9))], now)
    expect(g.map((x) => [x.group, x.items.map((i) => i.id)])).toEqual([['today', ['a', 'b']], ['yesterday', ['c']], ['earlier', ['d']]])
  })

  it('群聊短码取后 6 位', () => {
    expect(shortId('group:1234567890')).toBe('567890')
  })
})
