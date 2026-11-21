import { MOCK_RELATED_PLATFORMS } from './content'
import { MOCK_LIVE_MEDIA_PLATFORMS, MOCK_LIVE_PLATFORMS, MOCK_MEDIA_PLATFORMS } from './extras'
import { MOCK_KEYWORD_SUPPORT } from './keyword'
import { MOCK_MINE } from './mine'
import { MOCK_LIVE_CAPS } from './live'
import { MOCK_INBOX } from './inbox'

export function mockFilters(): Record<string, { search: boolean; sort: string[] | null; type: string[] | null; time: string[] | null; kind: string[] | null; order: string[] | null; author: boolean; suggest: boolean; hot: boolean; related: boolean; comments: boolean; mine: string[]; subtitles: boolean; danmaku: boolean; media: boolean; live: boolean; liveGet: boolean; liveMedia: boolean; liveList: boolean; liveSearch: boolean; liveCategories: boolean; liveGifts: boolean; liveRank: boolean; liveProducts: boolean; liveReplays: boolean; liveHistory: boolean; inbox: { notices: boolean; count: boolean; messages: boolean } }> {
  const base = mockFilterValues()
  // 作者页、联想 / 热搜、相关推荐的能力同样照注册表：演示模式下这几项也能演示
  return Object.fromEntries(
    Object.entries(base).map(([id, f]) => [
      id,
      {
        ...f,
        author: MOCK_AUTHOR_PLATFORMS.includes(id),
        suggest: MOCK_KEYWORD_SUPPORT[id]?.suggest ?? false,
        hot: MOCK_KEYWORD_SUPPORT[id]?.hot ?? false,
        related: MOCK_RELATED_PLATFORMS.includes(id),
        comments: MOCK_COMMENT_PLATFORMS.includes(id),
        mine: MOCK_MINE[id] ?? [],
        subtitles: id === 'bilibili',
        danmaku: id === 'bilibili',
        media: MOCK_MEDIA_PLATFORMS.includes(id),
        live: MOCK_LIVE_PLATFORMS.includes(id),
        liveGet: MOCK_LIVE_PLATFORMS.includes(id),
        liveMedia: MOCK_LIVE_MEDIA_PLATFORMS.includes(id),
        liveList: MOCK_LIVE_CAPS[id]?.list ?? false,
        liveSearch: MOCK_LIVE_CAPS[id]?.search ?? false,
        liveCategories: MOCK_LIVE_CAPS[id]?.categories ?? false,
        liveGifts: MOCK_LIVE_CAPS[id]?.gifts ?? false,
        liveRank: MOCK_LIVE_CAPS[id]?.rank ?? false,
        liveProducts: MOCK_LIVE_CAPS[id]?.products ?? false,
        liveReplays: MOCK_LIVE_CAPS[id]?.replays ?? false,
        liveHistory: MOCK_LIVE_CAPS[id]?.history ?? false,
        inbox: MOCK_INBOX[id] ?? { notices: false, count: false, messages: false },
      },
    ]),
  )
}

/** web 端 `comment list` 已实现的平台（与注册表一致）：下载时可以带评论 */
const MOCK_COMMENT_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'weibo', 'jd', 'x', 'youtube']

/** web 端 `user get` 和 `user items` 都已实现的平台（与注册表一致） */
const MOCK_AUTHOR_PLATFORMS = ['xhs', 'douyin', 'tiktok', 'bilibili', 'kuaishou', 'weibo', 'x', 'youtube']

function mockFilterValues(): Record<string, { search: boolean; sort: string[] | null; type: string[] | null; time: string[] | null; kind: string[] | null; order: string[] | null }> {
  const f = (sort: string[] | null, type: string[] | null, time: string[] | null, kind: string[] | null, search = true) =>
    ({ search, sort, type, time, kind, order: null as string[] | null })
  const T = ['all', 'video', 'image']
  const HALF = ['all', 'day', 'week', 'half_year']
  const RF = ['recommend', 'following']
  return {
    xhs: f(['general', 'latest', 'popular', 'comments', 'collects'], T, HALF, RF),
    douyin: f(['general', 'popular', 'latest'], T, HALF, ['recommend', 'hot', 'following']),
    bilibili: f(['general', 'views', 'latest', 'collects'], ['video', 'article'], null, ['recommend', 'hot', 'following']),
    tiktok: f(null, null, null, RF),
    kuaishou: f(null, null, null, RF),
    weibo: f(null, null, null, RF),
    x: f(['general', 'latest'], T, null, RF),
    youtube: f(['general', 'popular'], ['all', 'video'], ['all', 'day', 'week', 'month', 'year'], RF),
    xianyu: f(null, null, null, null, false),
    taobao: f(null, null, null, null, false),
    jd: f(['general', 'sales', 'price_asc', 'price_desc', 'comments'], null, null, null),
    maoyan: f(null, null, null, ['recommend'], false),
    mteam: { ...f(null, null, null, null), order: ['date', 'size', 'seeders', 'leechers', 'name'] },
  }
}
