import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as mock from '@/api/mock'
import { listLiveGifts, listLiveHistory, listLiveProducts, listLiveRank, listLiveReplays, listLives, searchLives } from '@/api/live'

// 直播页的发现直播间与直播间标签（AGENTS.md 7.9「直播弹幕」）：演示数据与能力表
describe('直播的演示能力与注册表一致', () => {
  it('mockFilters 带上发现与标签的能力位', () => {
    const f = mock.mockFilters()
    // 与 tests/webui-bridge.test.ts 里注册表的结果相同
    expect(f.xhs).toMatchObject({ liveList: true, liveSearch: false, liveCategories: true, liveGifts: true, liveProducts: true, liveRank: false, liveHistory: false })
    expect(f.douyin).toMatchObject({ liveList: true, liveSearch: true, liveCategories: true, liveRank: true, liveProducts: true, liveHistory: true })
    expect(f.bilibili).toMatchObject({ liveList: true, liveSearch: true, liveCategories: true, liveGifts: true, liveHistory: true })
    expect(f.kuaishou).toMatchObject({ liveList: true, liveReplays: true, liveGifts: true })
    expect(f.weibo).toMatchObject({ liveList: false, liveSearch: false, liveGifts: false, liveReplays: false })
    // 有发现或标签的平台都有直播页
    for (const [id, caps] of Object.entries(mock.MOCK_LIVE_CAPS)) {
      if (Object.values(caps).some(Boolean)) expect(mock.MOCK_LIVE_PLATFORMS, id).toContain(id)
    }
  })
})

describe('直播的演示数据', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    history.replaceState(null, '', '/xhs/live?demo')
  })
  afterEach(() => history.replaceState(null, '', '/'))

  it('推荐列表、分类与搜索：可翻页，关键词里有「没有」时为空', async () => {
    const first = await listLives('xhs', null, { limit: 6 })
    expect(first.ok).toBe(true)
    expect(first.data).toHaveLength(6)
    expect(first.page).toEqual({ cursor: '1', has_more: true })
    const next = await listLives('xhs', null, { limit: 6, cursor: first.page!.cursor })
    expect(next.data![0]!.id).not.toBe(first.data![0]!.id)
    const cat = await listLives('xhs', 'xhs_cat_2', { limit: 6 })
    expect(cat.data![0]!.id).not.toBe(first.data![0]!.id)
    const hit = await searchLives('douyin', '露营', { limit: 4 })
    expect(hit.data![0]!.title).toContain('露营')
    expect((await searchLives('douyin', '没有这个', { limit: 4 })).data).toEqual([])
    for (const l of first.data!) {
      expect(l.cover).toMatch(/^https:/)
      expect(['live', 'offline']).toContain(l.status)
    }
    expect(mock.mockLiveCategories('xhs').data!.length).toBeGreaterThan(3)
  })

  it('礼物、榜单、商品、回放与最近弹幕', async () => {
    const gifts = await listLiveGifts('bilibili', 'r1')
    expect(gifts.data!.every((g) => g.price && g.price.currency)).toBe(true)
    const rank = await listLiveRank('douyin', 'r1')
    expect(rank.data!.map((r) => r.rank)).toEqual([...rank.data!.keys()].map((i) => i + 1))
    // 商品是 goods，带人民币价格；有的直播间没有带货
    const rooms = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']
    const products = await Promise.all(rooms.map((r) => listLiveProducts('xhs', r)))
    expect(products.some((p) => p.data!.length === 0)).toBe(true)
    const some = products.find((p) => p.data!.length)!.data!
    expect(some.every((it) => it.kind === 'goods' && it.price?.currency === 'CNY')).toBe(true)
    const replays = await listLiveReplays('kuaishou', 'u1', { limit: 20 })
    expect(replays.data!.every((it) => it.kind === 'video')).toBe(true)
    expect(replays.page!.has_more).toBe(true)
    const recent = await listLiveHistory('bilibili', 'r1')
    expect(recent.data!.length).toBeGreaterThan(0)
    expect(recent.data!.every((e) => e.type === 'chat' && e.text)).toBe(true)
  })
})
