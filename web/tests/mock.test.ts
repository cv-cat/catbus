import { describe, expect, it } from 'vitest'
import * as mock from '@/api/mock'
import { mockSubs } from '@/api/mock/subs'

// 演示数据按领域拆在 src/api/mock/ 下，index.ts 统一导出：调用方用到的名字都要还在，各模块跨文件的引用在运行时也要能用
describe('演示数据模块', () => {
  it('index 导出调用方用到的全部名字', () => {
    const names = [
      'mockItems', 'mockItem', 'mockComments', 'mockReplies', 'mockRelated', 'MOCK_RELATED_PLATFORMS',
      'mockAccounts', 'mockLogout', 'mockUse', 'mockFilters', 'mockUser', 'mockUserItems', 'MOCK_MINE',
      'mockMineItems', 'mockMineFolders', 'mockHot', 'mockSuggest', 'MOCK_KEYWORD_SUPPORT', 'demoExport', 'demoText',
      'mockStations', 'mockTickets', 'mockRoute', 'mockTransfers', 'mockCities', 'mockShows', 'mockShowTickets',
      'mockTorrents', 'mockCategories', 'mockSeedStats', 'mockBonusRate', 'mockExams', 'mockSeedList',
      'mockBonusHistory', 'mockCollects', 'mockQbit', 'mockSubtitles', 'mockDanmaku', 'mockMedia', 'MOCK_LIVE_PLATFORMS',
      'mockLive', 'mockLiveEvent', 'mockLives', 'mockLiveCategories', 'mockLiveGifts', 'mockLiveRank', 'mockLiveHistory', 'mockLiveProducts', 'mockLiveReplays', 'MOCK_LIVE_CAPS',
    ]
    for (const n of names) expect(mock, n).toHaveProperty(n)
    expect(typeof mockSubs).toBe('object')
  })

  it('跨模块的演示数据能生成', () => {
    const items = mock.mockItems('xhs', '露营', 0, 5)
    expect(items.ok).toBe(true)
    expect(items.data).toHaveLength(5)
    expect(mock.mockItems('maoyan', '', 0, 3).data!.length).toBeGreaterThan(0)
    expect(mock.mockUser('xhs', 'me').data!.name).toBeTruthy()
    expect(mock.mockMineItems('xhs', 'works', null, 0, 4).data).toHaveLength(4)
    expect(mock.mockTickets('北京南', '上海虹桥', '2026-11-16').data!.length).toBeGreaterThan(0)
    expect(mock.mockTorrents('', 0, 4).data).toHaveLength(4)
    expect(Object.keys(mock.mockFilters())).toContain('xhs')
    expect(mock.mockLiveEvent().type).toBeTruthy()
  })
})
