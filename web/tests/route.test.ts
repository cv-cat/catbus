import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULTS, aggFromUrl, fromUrl, toUrl, type DiscoverState } from '@/stores/discover'
import { authorPath, isOverlayPath, parseAuthorPath, parseLivePath, parseMinePath } from '@/stores/route'
import { go } from './fixtures'

/** 设置里的默认排序 / 类型 */
const d = { platform: 'xhs', sort: 'general', type: 'all' }
const state = (over: Partial<DiscoverState> = {}): DiscoverState => ({ ...DEFAULTS, platform: 'xhs', ...over })

describe('发现页地址（7.9「地址」）', () => {
  afterEach(() => go('/'))

  it('/ 和未知平台回到默认平台；非法取值回到默认', () => {
    go('/')
    expect(fromUrl(d)).toEqual(state())
    go('/nope?sort=bogus&type=bogus&kind=bogus&time=bogus')
    expect(fromUrl(d)).toEqual(state())
  })

  it('认得的取值原样读出，关键词解码', () => {
    go(`/douyin?sort=latest&type=video&time=week&keyword=${encodeURIComponent('猫 咪&狗')}`)
    expect(fromUrl(d)).toMatchObject({ platform: 'douyin', sort: 'latest', type: 'video', time: 'week', keyword: '猫 咪&狗' })
    go('/douyin?kind=hot')
    expect(fromUrl(d).kind).toBe('hot')
  })

  it('默认值来自设置：地址没带 sort / type 时用设置的值', () => {
    go('/xhs')
    expect(fromUrl({ platform: 'xhs', sort: 'latest', type: 'video' })).toMatchObject({ sort: 'latest', type: 'video' })
  })

  it('取默认值的参数省略', () => {
    go('/')
    expect(toUrl(state(), d, null)).toBe('/xhs')
    expect(toUrl(state({ sort: 'latest', type: 'video', time: 'week', kind: 'hot', keyword: '猫 咪' }), d, null)).toBe(
      `/xhs?sort=latest&type=video&kind=hot&time=week&keyword=${encodeURIComponent('猫 咪')}`,
    )
    // 等于设置里的默认排序时省略
    expect(toUrl(state({ sort: 'latest' }), { sort: 'latest', type: 'all' }, null)).toBe('/xhs')
  })

  it('?demo 原样保留在最前', () => {
    go('/xhs?demo&sort=latest')
    expect(toUrl(state({ sort: 'latest' }), d, null)).toBe('/xhs?demo&sort=latest')
  })

  it('往返：toUrl → fromUrl 得到同一份状态', () => {
    const s = state({ platform: 'douyin', sort: 'popular', type: 'image', time: 'year', keyword: '旅行 vlog' })
    go(toUrl(s, d, null))
    expect(fromUrl(d)).toEqual(s)
  })

  describe('聚合模式的 agg', () => {
    it('排在 sort 前面，按选中的顺序', () => {
      go('/')
      expect(toUrl(state({ platform: 'x', sort: 'latest' }), d, ['douyin', 'xhs', 'x'])).toBe('/x?agg=douyin,xhs,x&sort=latest')
    })

    it('读的时候去重、丢掉未知平台；没有参数时为 null', () => {
      go('/x?agg=douyin,nope,xhs,douyin,x')
      expect(aggFromUrl()).toEqual(['douyin', 'xhs', 'x'])
      go('/x')
      expect(aggFromUrl()).toBeNull()
      go('/x?agg=')
      expect(aggFromUrl()).toEqual([])
    })
  })

  describe('M-Team 的字段排序与筛选', () => {
    it('sort=size_asc 这样的字段排序原样保留', () => {
      go('/mteam?sort=size_asc')
      expect(fromUrl(d).sort).toBe('size_asc')
      go('/mteam?sort=seeders')
      expect(fromUrl(d).sort).toBe('seeders')
      go('/mteam?sort=bogus_asc')
      expect(fromUrl(d).sort).toBe('general')
      go('/mteam?sort=general_asc')
      expect(fromUrl(d).sort).toBe('general')
    })

    it('mode / category / free 只在 mteam（或聚合里有 mteam）时写', () => {
      go('/')
      const mt = state({ platform: 'mteam', sort: 'size_asc', mtMode: 'tvshow', mtCategory: '402', mtFree: '1' })
      expect(toUrl(mt, d, null)).toBe('/mteam?sort=size_asc&mode=tvshow&category=402&free=1')
      expect(toUrl({ ...mt, platform: 'xhs', sort: 'general' }, d, null)).toBe('/xhs')
      expect(toUrl({ ...mt, platform: 'xhs', sort: 'general' }, d, ['mteam', 'xhs'])).toBe('/xhs?agg=mteam,xhs&mode=tvshow&category=402&free=1')
    })

    it('非法的 mode / category / free 回退', () => {
      go('/mteam?mode=bogus&category=abc&free=yes')
      expect(fromUrl(d)).toMatchObject({ mtMode: 'normal', mtCategory: '', mtFree: '' })
      go('/mteam?mode=adult&category=402&free=1')
      expect(fromUrl(d)).toMatchObject({ mtMode: 'adult', mtCategory: '402', mtFree: '1' })
    })

    it('/mteam/me 时发现页停在 M-Team', () => {
      go('/mteam/me?tab=completed')
      expect(fromUrl(d).platform).toBe('mteam')
    })
  })

  describe('猫眼的城市', () => {
    it('北京（默认）和不合法的城市当作默认', () => {
      go(`/maoyan?city=${encodeURIComponent('北京')}`)
      expect(fromUrl(d).city).toBe('')
      go(`/maoyan?city=${encodeURIComponent('<script>')}`)
      expect(fromUrl(d).city).toBe('')
      go(`/maoyan?city=${encodeURIComponent('上海')}`)
      expect(fromUrl(d).city).toBe('上海')
    })

    it('只有路径或聚合里有猫眼时写 city，排在 agg 之后', () => {
      go('/')
      expect(toUrl(state({ platform: 'maoyan', city: '上海' }), d, null)).toBe(`/maoyan?city=${encodeURIComponent('上海')}`)
      expect(toUrl(state({ platform: 'xhs', city: '上海' }), d, null)).toBe('/xhs')
      expect(toUrl(state({ platform: 'xhs', city: '上海' }), d, ['maoyan', 'xhs'])).toBe(`/xhs?agg=maoyan,xhs&city=${encodeURIComponent('上海')}`)
    })
  })
})

describe('叠加页的地址（route.ts）', () => {
  afterEach(() => go('/'))

  it('作者页：/<平台>/user?u=…，平台未知或缺 u 时为 null', () => {
    go(`/xhs/user?u=${encodeURIComponent('https://www.xiaohongshu.com/user/profile/1?xsec_token=a&b=1')}`)
    expect(parseAuthorPath()).toEqual({ platform: 'xhs', user: 'https://www.xiaohongshu.com/user/profile/1?xsec_token=a&b=1' })
    expect(isOverlayPath()).toBe(true)
    go('/nope/user?u=1')
    expect(parseAuthorPath()).toBeNull()
    go('/xhs/user')
    expect(parseAuthorPath()).toBeNull()
  })

  it('authorPath 保留 ?demo 并编码作者', () => {
    go('/xhs?demo')
    expect(authorPath({ platform: 'xhs', user: 'a b&c' })).toBe(`/xhs/user?demo&u=${encodeURIComponent('a b&c')}`)
    go('/xhs')
    expect(authorPath({ platform: 'xhs', user: '1' })).toBe('/xhs/user?u=1')
  })

  it('「我的」页：mteam 不算在这里；folder / series 取其一', () => {
    go('/douyin/me?tab=likes')
    expect(parseMinePath()).toEqual({ platform: 'douyin', tab: 'likes', sub: null })
    go('/bilibili/me?tab=folders&folder=42')
    expect(parseMinePath()).toEqual({ platform: 'bilibili', tab: 'folders', sub: '42' })
    go('/mteam/me')
    expect(parseMinePath()).toBeNull()
    expect(isOverlayPath()).toBe(true)
  })

  it('直播页', () => {
    go('/douyin/live?room=%20123%20')
    expect(parseLivePath()).toEqual({ platform: 'douyin', room: '123' })
    go('/douyin/live')
    expect(parseLivePath()).toEqual({ platform: 'douyin', room: null })
    go('/xhs')
    expect(isOverlayPath()).toBe(false)
  })
})
