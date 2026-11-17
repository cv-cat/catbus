import { afterEach, describe, expect, it, vi } from 'vitest'
import { shellQuote, toCommand } from '@/composables/command'
import { csvCell, exportName, toCsv, toJson } from '@/composables/export-list'
import { setLocale } from '@/i18n'
import { filterComments } from '@/composables/comment-filter'
import { bytes, compact, dateTime, duration, initial, since, tintOf } from '@/composables/format'
import { comment, item } from './fixtures'

describe('复制等价命令（7.9「复制等价命令」）', () => {
  it('shell 转义：安全的原样，其余单引号包起来，单引号写成 \'\\\'\'', () => {
    expect(shellQuote('abc-1.2/x')).toBe('abc-1.2/x')
    expect(shellQuote('https://a.com/x?y=1&z=2')).toBe(`'https://a.com/x?y=1&z=2'`)
    expect(shellQuote('猫 咪')).toBe(`'猫 咪'`)
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
    expect(shellQuote('')).toBe(`''`)
    expect(shellQuote('$HOME')).toBe(`'$HOME'`)
  })

  it('bridge 规范化的 argv：去掉 --cursor，保留 -a 和 --limit，位置参数在前', () => {
    expect(toCommand(['xhs', 'item', 'search', '-a', 'work', '--limit', '20', '--cursor', 'abc', '--', '猫 咪'])).toBe(
      `catbus xhs item search '猫 咪' -a work --limit 20`,
    )
  })

  it('页面拼的 argv 用 positional 给出位置参数个数', () => {
    expect(toCommand(['douyin', 'item', 'get', 'https://v.douyin.com/x/', '-a', 'b'], 1)).toBe('catbus douyin item get https://v.douyin.com/x/ -a b')
  })

  it('以 - 开头的位置参数放到 -- 之后', () => {
    expect(toCommand(['x', 'item', 'search', '--limit', '20', '--', '-foo'])).toBe('catbus x item search --limit 20 -- -foo')
  })

  it('没有位置参数', () => {
    expect(toCommand(['mteam', 'feed', 'list', '--cursor', 'c', '--limit', '40'])).toBe('catbus mteam feed list --limit 40')
  })
})

describe('导出已加载的列表（7.9「导出已加载的列表」）', () => {
  afterEach(() => vi.useRealTimers())

  it('csvCell：逗号、引号、换行、首尾空白要加引号', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(12)).toBe('12')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('说"好"')).toBe('"说""好"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell(' a')).toBe('" a"')
  })

  it('CSV：列顺序、换行保留在引号里，CRLF 分行', () => {
    const csv = toCsv([
      {
        platform: 'xhs',
        item: item({ id: 'n1', kind: 'image', title: '标题', text: '第一行\n第二行', author: { id: 'u', name: '作者', url: 'https://a/u' }, stats: { views: 1, likes: 2, comments: 3, collects: 4, shares: 5 }, url: 'https://a/n1' }),
      },
    ])
    const [head, row, end] = csv.split('\r\n')
    expect(head).toBe('\uFEFF平台,ID,类型,标题,正文,作者,作者链接,发布时间,播放,点赞,评论,收藏,分享,价格,链接')
    expect(row).toBe('xhs,n1,image,标题,"第一行\n第二行",作者,https://a/u,,1,2,3,4,5,,https://a/n1')
    expect(end).toBe('')
  })

  it('有种子时另加体积、做种、下载三列；价格写成「金额 货币」', () => {
    const csv = toCsv([
      { platform: 'mteam', item: item({ kind: 'torrent', size: 100, seeders: 2, leechers: 1 }) },
      { platform: 'jd', item: item({ kind: 'goods', price: { amount: 9.9, currency: 'CNY' } }) },
    ])
    const lines = csv.split('\r\n')
    expect(lines[0]!.endsWith(',链接,体积,做种,下载')).toBe(true)
    expect(lines[1]!.endsWith(',100,2,1')).toBe(true)
    expect(lines[2]).toContain(',9.9 CNY,')
  })

  it('CSV 表头随界面语言', async () => {
    await setLocale('en')
    try {
      const head = toCsv([{ platform: 'mteam', item: item({ kind: 'torrent' }) }]).split('\r\n')[0]
      expect(head).toBe('\uFEFFPlatform,ID,Type,Title,Text,Author,Author URL,Published,Views,Likes,Comments,Collects,Shares,Price,URL,Size,Seeders,Leechers')
    } finally {
      await setLocale('zh-CN')
    }
  })

  it('CSV 以 UTF-8 BOM 开头，只有一个', () => {
    const csv = toCsv([{ platform: 'xhs', item: item() }])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.indexOf('\uFEFF', 1)).toBe(-1)
  })

  it('JSON：{schema: 1, exported_at, items: [{platform, item}]}，去掉原始对象', () => {
    const raw = { ...item({ id: 'a' }), raw: { secret: 1 } }
    const doc = JSON.parse(toJson([{ platform: 'xhs', item: raw }], new Date('2026-11-16T00:00:00Z')))
    expect(doc.schema).toBe(1)
    expect(doc.exported_at).toBe('2026-11-16T00:00:00.000Z')
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0].platform).toBe('xhs')
    expect(doc.items[0].item.id).toBe('a')
    expect(doc.items[0].item.raw).toBeUndefined()
  })

  it('文件名：一个平台写平台名，几个平台写 mixed', () => {
    const now = new Date(2026, 10, 16, 9, 5, 7)
    expect(exportName([{ platform: 'xhs', item: item() }], 'csv', now)).toBe('catbus-xhs-20261116-090507.csv')
    expect(exportName([{ platform: 'xhs', item: item() }, { platform: 'jd', item: item() }], 'json', now)).toBe('catbus-mixed-20261116-090507.json')
  })
})

describe('评论区筛选（7.9「评论区筛选」）', () => {
  const list = [
    comment({ id: 'a', text: 'Hello 世界', likes: 5, created_at: '2026-11-10T00:00:00Z', author: { id: '1', name: '张三', url: null } }),
    comment({ id: 'b', text: '没有赞', likes: null, created_at: null, author: { id: '2', name: 'Lisi', url: null } }),
    comment({ id: 'c', text: 'hello again', likes: 10, created_at: '2026-11-12T00:00:00Z' }),
  ]
  const ids = (l: { id: string }[]) => l.map((c) => c.id)

  it('正文和昵称里做子串匹配，不区分大小写', () => {
    expect(ids(filterComments(list, 'HELLO', 'default'))).toEqual(['a', 'c'])
    expect(ids(filterComments(list, 'lisi', 'default'))).toEqual(['b'])
    expect(ids(filterComments(list, '  ', 'default'))).toEqual(['a', 'b', 'c'])
  })

  it('最热按点赞降序、最新按时间降序，取不到的排最后', () => {
    expect(ids(filterComments(list, '', 'hot'))).toEqual(['c', 'a', 'b'])
    expect(ids(filterComments(list, '', 'new'))).toEqual(['c', 'a', 'b'])
    expect(ids(list)).toEqual(['a', 'b', 'c'])
  })
})

describe('format', () => {
  afterEach(() => vi.useRealTimers())

  it('计数简写（中文）', () => {
    expect(compact(null)).toBe('—')
    expect(compact(9999)).toBe('9,999')
    expect(compact(12000)).toBe('1.2w')
    expect(compact(10000)).toBe('1w')
    expect(compact(120_000_000)).toBe('1.2亿')
  })

  it('字节：1024 进制、三位有效数字', () => {
    expect(bytes(null)).toBeNull()
    expect(bytes(-1)).toBeNull()
    expect(bytes(512)).toBe('512 B')
    expect(bytes(1536)).toBe('1.50 KB')
    expect(bytes(22_333_829_939)).toBe('20.8 GB')
    expect(bytes(150 * 1024 ** 2)).toBe('150 MB')
  })

  it('时长', () => {
    expect(duration(null)).toBeNull()
    expect(duration(0)).toBeNull()
    expect(duration(65.4)).toBe('01:05')
  })

  it('相对时间', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-16T12:00:00Z') })
    expect(since(null)).toBe('')
    expect(since('乱写')).toBe('')
    expect(since('2026-11-16T11:59:40Z')).toBe('刚刚')
    expect(since('2026-11-16T11:57:00Z')).toBe('3分钟前')
    expect(since('2026-11-16T10:00:00Z')).toBe('2小时前')
    expect(since('2026-11-14T12:00:00Z')).toBe('2天前')
    // 一个月以上给日期
    expect(since('2026-09-01T12:00:00Z')).toBe(new Date('2026-09-01T12:00:00Z').toLocaleDateString('zh-CN'))
  })

  it('dateTime、头像占位', () => {
    expect(dateTime(null)).toBe('')
    expect(dateTime('乱写')).toBe('')
    expect(dateTime('2026-11-16T00:00:00+08:00', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' })).toBe('11/16')
    expect(tintOf('abc')).toBe(tintOf('abc'))
    expect(tintOf(null)).toMatch(/^#[0-9A-F]{6}$/)
    expect(initial(' 猫 ')).toBe('猫')
    expect(initial('bob')).toBe('B')
    expect(initial(null)).toBe('?')
  })
})
