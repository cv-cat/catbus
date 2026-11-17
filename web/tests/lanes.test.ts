import { describe, expect, it } from 'vitest'
import { cursorsFor, dedupeOwned, fill, interleave, itemCell, joinCursors, roundRobin, skeletonCells, type Cell } from '@/stores/lanes'
import type { Item } from '@/api/types'
import { item } from './fixtures'

const ids = (cells: readonly Cell[]) => cells.map((c) => (c.item ? `${c.platform}:${c.item.id}` : `${c.platform}:_`))
const cells = (platform: string, ...list: string[]) => list.map((id) => itemCell(platform, item({ id })))

describe('聚合模式的排列（7.9「聚合模式」）', () => {
  it('按选中的顺序轮流排，各渠道内部顺序不变，用完的渠道让其余接着排', () => {
    const all = [...cells('douyin', 'd1', 'd2', 'd3'), ...cells('xhs', 'x1'), ...cells('x', 't1', 't2')]
    expect(ids(interleave(['douyin', 'xhs', 'x'], all))).toEqual(['douyin:d1', 'xhs:x1', 'x:t1', 'douyin:d2', 'x:t2', 'douyin:d3'])
  })

  it('不在选中渠道里的格子丢掉', () => {
    expect(ids(interleave(['xhs'], [...cells('douyin', 'd1'), ...cells('xhs', 'x1')]))).toEqual(['xhs:x1'])
  })

  it('新选的渠道：每张原有卡片后插入它的骨架', () => {
    const before = interleave(['douyin'], cells('douyin', 'd1', 'd2'))
    const after = interleave(['douyin', 'xhs'], [...before, ...skeletonCells('xhs', 3)])
    expect(ids(after)).toEqual(['douyin:d1', 'xhs:_', 'douyin:d2', 'xhs:_', 'xhs:_'])
  })

  it('fill：骨架在原位换成卡片（格子 key 不变），多的删掉，不够的接在最后', () => {
    const grid = interleave(['douyin', 'xhs'], [...cells('douyin', 'd1', 'd2'), ...skeletonCells('xhs', 2)])
    const keys = grid.map((c) => c.key)
    const one = fill(grid, 'xhs', [item({ id: 'x1' })])
    expect(ids(one)).toEqual(['douyin:d1', 'xhs:x1', 'douyin:d2'])
    expect(one[1]!.key).toBe(keys[1])
    const many = fill(grid, 'xhs', [item({ id: 'x1' }), item({ id: 'x2' }), item({ id: 'x3' })])
    expect(ids(many)).toEqual(['douyin:d1', 'xhs:x1', 'douyin:d2', 'xhs:x2', 'xhs:x3'])
    expect(many.slice(0, 4).map((c) => c.key)).toEqual(keys)
  })

  it('格子的 key 唯一', () => {
    const list = [...skeletonCells('a', 50), ...cells('a', ...Array.from({ length: 50 }, (_, i) => String(i)))]
    expect(new Set(list.map((c) => c.key)).size).toBe(100)
  })
})

describe('多账号合并（7.9「多账号合并」）', () => {
  it('各账号的结果轮流排', () => {
    expect(roundRobin([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3'])
    expect(roundRobin([])).toEqual([])
    expect(roundRobin([[], ['b1']])).toEqual(['b1'])
  })

  /** 与 discover.ts 一样：取到条目时记下账号，合并后按勾选顺序去重 */
  function page(lists: [string, string[]][], seen: Map<string, Item>, order: string[], owner: WeakMap<Item, string>) {
    const got = lists.map(([account, list]) =>
      list.map((id) => {
        const it = item({ id, title: account })
        owner.set(it, account)
        return it
      }),
    )
    return dedupeOwned(roundRobin(got), seen, order, owner)
  }
  const show = (list: Item[], owner: WeakMap<Item, string>) => list.map((it) => `${it.id}@${owner.get(it)}`)

  it('重复条目留在轮流排时第一次出现的位置，归属取勾选顺序最靠前的账号', () => {
    // 账号1=[X,A]、账号2=[A,Y]：轮流排是 X、A(2)、A(1)、Y，去重后 X、A、Y，A 记在账号1 名下
    const owner = new WeakMap<Item, string>()
    const seen = new Map<string, Item>()
    const out = page([['a1', ['X', 'A']], ['a2', ['A', 'Y']]], seen, ['a1', 'a2'], owner)
    expect(show(out, owner)).toEqual(['X@a1', 'A@a1', 'Y@a2'])
  })

  it('更靠后的账号的重复不改归属', () => {
    const owner = new WeakMap<Item, string>()
    const out = page([['a1', ['A']], ['a2', ['A']], ['a3', ['A']]], new Map(), ['a1', 'a2', 'a3'], owner)
    expect(show(out, owner)).toEqual(['A@a1'])
  })

  it('翻页时后到的页里有已有条目、且来自更靠前的账号：只改归属，不挪位置', () => {
    const owner = new WeakMap<Item, string>()
    const seen = new Map<string, Item>()
    const order = ['a1', 'a2', 'a3']
    const first = page([['a2', ['A', 'B']], ['a3', ['C']]], seen, order, owner)
    expect(show(first, owner)).toEqual(['A@a2', 'C@a3', 'B@a2'])
    // 第二页：账号1 才翻到 A、C；账号3 又给了一次 B
    const second = page([['a1', ['C', 'D', 'A']], ['a3', ['B']]], seen, order, owner)
    expect(show(second, owner)).toEqual(['D@a1'])
    // 已有的条目原地改归属：A、C 改到账号1，B 仍是账号2
    expect(show(first, owner)).toEqual(['A@a1', 'C@a1', 'B@a2'])
  })

  it('不知道账号（没有账号、不带 -a）时不改归属', () => {
    const owner = new WeakMap<Item, string>()
    const seen = new Map<string, Item>()
    expect(show(page([['', ['A']], ['', ['A', 'B']]], seen, [], owner), owner)).toEqual(['A@', 'B@'])
  })

  it('第一页每个账号都从头请求', () => {
    expect(cursorsFor(['a', 'b'], 'whatever', false)).toEqual([
      ['a', null],
      ['b', null],
    ])
  })

  it('只有一个账号时 cursor 就是平台自己的，不包一层', () => {
    expect(joinCursors(['a'], new Map([['a', 'c1']]))).toBe('c1')
    expect(cursorsFor(['a'], 'c1', true)).toEqual([['a', 'c1']])
    expect(cursorsFor(['a'], null, true)).toEqual([])
  })

  it('多个账号：只列还有下一页的，翻页时只请求它们', () => {
    const cur = joinCursors(['a', 'b', 'c'], new Map([['a', 'ca'], ['c', 'cc']]))
    expect(cur).toMatch(/^multi:/)
    expect(cursorsFor(['a', 'b', 'c'], cur, true)).toEqual([
      ['a', 'ca'],
      ['c', 'cc'],
    ])
    expect(joinCursors(['a', 'b'], new Map())).toBeNull()
  })

  it('坏掉的多账号 cursor 当作翻完', () => {
    expect(cursorsFor(['a', 'b'], 'multi:{bad', true)).toEqual([])
    expect(cursorsFor(['a', 'b'], 'plain', true)).toEqual([])
    expect(cursorsFor(['a', 'b'], 'multi:{"a":1}', true)).toEqual([])
  })
})
