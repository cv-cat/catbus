import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { LATER, MAX_ITEMS, cleanItem, parseSaved, useLocalStore } from '@/stores/local'
import { SEEN_MAX, addSeen } from '@/stores/seen'
import { HISTORY_MAX, useHistoryStore } from '@/stores/history'
import { item } from './fixtures'

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('本地收藏的校验（7.9「本地收藏与稍后看」）', () => {
  it('cleanItem 只留 6.2 的字段，不合法时为 null', () => {
    expect(cleanItem(null)).toBeNull()
    expect(cleanItem({ id: '', url: 'u' })).toBeNull()
    expect(cleanItem({ id: '1' })).toBeNull()
    const c = cleanItem({ ...item({ id: '1', kind: 'image' }), raw: { x: 1 }, kind: 'bogus', media: [{ type: 'image', url: 'u' }, { type: 'pdf' }, null] })!
    expect(c).not.toHaveProperty('raw')
    expect(c.kind).toBe('text')
    expect(c.media).toEqual([{ id: null, type: 'image', url: 'u', width: null, height: null, duration: null }])
    expect(cleanItem({ id: '1', url: 'u', author: { name: 'x' } })!.author).toBeNull()
    // 种子字段保留
    expect(cleanItem(item({ kind: 'torrent', size: 10, discount: 'FREE' }))).toMatchObject({ size: 10, discount: 'FREE' })
  })

  it('parseSaved：不合法的分组、条目跳过，重复的条目只留一条，分组引用只留存在的', () => {
    const { saved, skipped } = parseSaved({
      groups: [
        { id: 'g1', name: ' 旅行 ' },
        { id: 'g1', name: '重复 id' },
        { id: LATER, name: '占用内置 id' },
        { id: 'g2', name: '' },
        { id: 'g3', name: 'x'.repeat(21) },
      ],
      items: [
        { platform: 'xhs', item: item({ id: 'a' }), groups: ['g1', 'g1', 'nope', LATER] },
        { platform: 'xhs', item: item({ id: 'a' }) },
        { platform: 'nope', item: item({ id: 'b' }) },
        { platform: 'xhs', item: { id: 'c' } },
        'junk',
      ],
    })
    expect(saved.groups.map((g) => [g.id, g.name])).toEqual([['g1', '旅行']])
    expect(saved.items).toHaveLength(1)
    expect(saved.items[0]!.groups).toEqual(['g1', LATER])
    expect(skipped).toBe(4)
  })
})

describe('本地收藏的导入合并', () => {
  it('不是 JSON、缺 items 时返回 null', () => {
    const s = useLocalStore()
    expect(s.importText('not json')).toBeNull()
    expect(s.importText('{"groups":[]}')).toBeNull()
  })

  it('分组按名字合并，条目按「平台 + id」去重、分组取并集', () => {
    const s = useLocalStore()
    const mine = s.createGroup('旅行')!
    s.add('xhs', item({ id: 'a' }), [mine])
    const res = s.importText(
      JSON.stringify({
        schema: 1,
        groups: [
          { id: 'other', name: '旅行' },
          { id: 'food', name: '美食' },
        ],
        items: [
          { platform: 'xhs', item: item({ id: 'a' }), groups: [LATER, 'food'], added_at: '2026-01-01T00:00:00Z' },
          { platform: 'douyin', item: item({ id: 'a' }), groups: ['other'], added_at: '2026-01-02T00:00:00Z' },
          { platform: 'bogus', item: item({ id: 'z' }) },
        ],
      }),
    )
    expect(res).toEqual({ added: 1, merged: 1, skipped: 1 })
    expect(s.groups.map((g) => g.name)).toEqual(['旅行', '美食'])
    const food = s.groups.find((g) => g.name === '美食')!.id
    expect(s.entry('xhs', 'a')!.groups.sort()).toEqual([mine, LATER, food].sort())
    // 同名分组合并到本地已有的那个 id
    expect(s.entry('douyin', 'a')!.groups).toEqual([mine])
    expect(s.entries).toHaveLength(2)
  })

  it('导入的分组 id 与本地不同名的分组撞了时换一个 id', () => {
    const s = useLocalStore()
    const id = s.createGroup('甲')!
    s.importText(JSON.stringify({ groups: [{ id, name: '乙' }], items: [{ platform: 'xhs', item: item({ id: 'b' }), groups: [id] }] }))
    const yi = s.groups.find((g) => g.name === '乙')!
    expect(yi.id).not.toBe(id)
    expect(s.entry('xhs', 'b')!.groups).toEqual([yi.id])
  })

  it('满了的部分算跳过', () => {
    const s = useLocalStore()
    const items = Array.from({ length: MAX_ITEMS + 3 }, (_, i) => ({ platform: 'xhs', item: item({ id: String(i) }) }))
    expect(s.importText(JSON.stringify({ items }))).toEqual({ added: MAX_ITEMS, merged: 0, skipped: 3 })
    expect(s.add('xhs', item({ id: 'more' }))).toBe(false)
  })

  it('写进 localStorage，下次读回来', async () => {
    const s = useLocalStore()
    s.add('xhs', item({ id: 'a', title: '标题' }))
    await Promise.resolve()
    const saved = JSON.parse(localStorage.getItem('catbus.local')!)
    expect(saved.version).toBe(1)
    expect(saved.items[0]).toMatchObject({ platform: 'xhs', groups: [LATER], item: { id: 'a', title: '标题' } })
    setActivePinia(createPinia())
    expect(useLocalStore().has('xhs', 'a')).toBe(true)
  })

  it('分组名：不能为空、不能超过 20 个字符、不能重名；稍后看不能改名、不能删', () => {
    const s = useLocalStore()
    expect(s.createGroup('  ')).toBeNull()
    expect(s.createGroup('x'.repeat(21))).toBeNull()
    expect(s.createGroup('x'.repeat(20))).not.toBeNull()
    expect(s.createGroup('x'.repeat(20))).toBeNull()
    expect(s.renameGroup(LATER, '别的')).toBe(false)
    s.deleteGroup(LATER)
    expect(s.allGroups[0]!.id).toBe(LATER)
  })

  it('删分组不删条目', () => {
    const s = useLocalStore()
    const g = s.createGroup('甲')!
    s.add('xhs', item({ id: 'a' }), [g, LATER])
    s.deleteGroup(g)
    expect(s.entry('xhs', 'a')!.groups).toEqual([LATER])
  })
})

describe('看过的标记（7.9「看过的标记」）', () => {
  it('去重，最近的在后', () => {
    let s = addSeen({}, 'xhs', 'a')
    s = addSeen(s, 'xhs', 'b')
    s = addSeen(s, 'xhs', 'a')
    expect(s).toEqual({ xhs: ['b', 'a'] })
  })

  it('总数不超过上限，满了丢最早的', () => {
    let s = {}
    for (let i = 0; i < 7; i++) s = addSeen(s, 'xhs', String(i), 5)
    expect(s).toEqual({ xhs: ['2', '3', '4', '5', '6'] })
  })

  it('几个平台时从条数最多的平台丢最早的', () => {
    let s = addSeen({ xhs: ['1', '2', '3'], douyin: ['a'] }, 'douyin', 'b', 4)
    expect(s).toEqual({ xhs: ['2', '3'], douyin: ['a', 'b'] })
    s = addSeen(s, 'douyin', 'c', 4)
    // 条数相同时丢的是先列出的那个平台（近似全局最早）
    expect(Object.values(s).flat()).toHaveLength(4)
  })

  it('默认上限 5000', () => {
    expect(SEEN_MAX).toBe(5000)
    const big = { xhs: Array.from({ length: SEEN_MAX }, (_, i) => String(i)) }
    const next = addSeen(big, 'xhs', 'new')
    expect(next.xhs).toHaveLength(SEEN_MAX)
    expect(next.xhs!.at(-1)).toBe('new')
    expect(next.xhs![0]).toBe('1')
  })
})

describe('搜索历史（7.9「搜索历史」）', () => {
  it('最近的在前、去重、每个平台最多 20 条', () => {
    const h = useHistoryStore()
    for (let i = 0; i < 25; i++) h.add('xhs', `k${i}`)
    h.add('xhs', ' k20 ')
    h.add('xhs', '  ')
    expect(h.list('xhs')).toHaveLength(HISTORY_MAX)
    expect(h.list('xhs')[0]).toBe('k20')
    expect(h.list('xhs').filter((k) => k === 'k20')).toHaveLength(1)
    expect(h.list('douyin')).toEqual([])
  })

  it('空输入给最近 6 条，有输入时不区分大小写匹配最多 3 条', () => {
    const h = useHistoryStore()
    for (const k of ['Cat', 'dog', 'cats', 'CATalog', 'bird', 'cat food', 'x', 'y']) h.add('xhs', k)
    expect(h.matching('xhs', '')).toEqual(['y', 'x', 'cat food', 'bird', 'CATalog', 'cats'])
    expect(h.matching('xhs', 'CAT')).toEqual(['cat food', 'CATalog', 'cats'])
  })

  it('删掉最后一条时去掉这个平台，写进 localStorage', () => {
    const h = useHistoryStore()
    h.add('xhs', 'a')
    expect(JSON.parse(localStorage.getItem('catbus.history')!)).toEqual({ xhs: ['a'] })
    h.remove('xhs', 'a')
    expect(h.all).toEqual({})
    expect(localStorage.getItem('catbus.history')).toBeNull()
  })
})
