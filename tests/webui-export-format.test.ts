import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Comment } from '../src/core/schemas.js'
import {
  type ExportDoc,
  XLSX_CELL_MAX,
  exportFileName,
  parseExportDoc,
  toText,
  toXlsx,
} from '../src/webui/export-format.js'

/** 读 zip 的中心目录，解出全部条目（只支持 stored / deflate，够测 yazl 的输出）。 */
function unzip(buf: Buffer): Map<string, string> {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('不是 zip')
  const total = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, string>()
  for (let i = 0; i < total; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28)
    const elen = buf.readUInt16LE(p + 30)
    const clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8')
    const lnlen = buf.readUInt16LE(local + 26)
    const lelen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lnlen + lelen
    const data = buf.subarray(start, start + csize)
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    p += 46 + nlen + elen + clen
  }
  return out
}

const user = (id: string, name: string) => ({ id, name, url: `https://example.com/u/${id}`, avatar: null })

function comment(id: string, text: string, extra: Partial<Comment> = {}): Comment {
  return {
    id,
    item_id: '9001',
    parent_id: null,
    author: user(`u${id}`, `用户${id}`),
    text,
    media: [],
    created_at: '2026-11-10T08:30:00+08:00',
    stats: { likes: 3, replies: 0 },
    ...extra,
  }
}

function sampleDoc(): ExportDoc {
  return {
    schema: 1,
    platform: 'xhs',
    exported_at: '2026-11-12T10:00:00+08:00',
    item: {
      id: '9001',
      kind: 'image',
      url: 'https://example.com/item/9001',
      title: '周末去看海',
      text: '第一行\r\n第二行',
      author: user('a1', '小猫'),
      created_at: '2026-11-09T20:15:30+08:00',
      cover: 'https://example.com/c.jpg',
      media: [
        { id: null, type: 'image', url: 'https://example.com/1.jpg', width: 1, height: 1, duration: null },
        { id: null, type: 'image', url: 'https://example.com/2.jpg', width: 1, height: 1, duration: null },
      ],
      stats: { views: null, likes: 120, comments: 45, collects: 8, shares: null },
      price: null,
      status: null,
    },
    comments: [
      {
        ...comment('c1', '好看！', {
          stats: { likes: 10, replies: 5 },
          media: [{ id: null, type: 'image', url: 'https://example.com/m.jpg', width: null, height: null, duration: null }],
        }),
        replies: [comment('r1', '同感\n真的', { parent_id: 'c1', stats: { likes: null, replies: null } })],
      },
      { ...comment('c2', '=1+1'), replies: [] },
    ],
    comments_truncated: true,
  }
}

describe('parseExportDoc', () => {
  it('合法文档原样返回，保留扩展字段', () => {
    const doc = { ...sampleDoc(), item: { ...sampleDoc().item, kind: 'torrent', size: 123 } }
    const parsed = parseExportDoc(JSON.stringify(doc))
    expect((parsed.item as unknown as { size: number }).size).toBe(123)
  })
  it('schema 不是 1 时报错', () => {
    expect(() => parseExportDoc(JSON.stringify({ ...sampleDoc(), schema: 2 }))).toThrow(/不支持的导出文件版本/)
  })
  it('缺字段时报错并指出路径', () => {
    const { comments_truncated: _, ...rest } = sampleDoc()
    expect(() => parseExportDoc(JSON.stringify(rest))).toThrow(/导出文件结构不正确：comments_truncated/)
    const bad = sampleDoc() as unknown as { comments: { replies?: unknown }[] }
    delete bad.comments[0].replies
    expect(() => parseExportDoc(JSON.stringify(bad))).toThrow(/comments\.0\.replies/)
  })
  it('不是 JSON 时报错', () => {
    expect(() => parseExportDoc('{')).toThrow(/不是合法的 JSON/)
  })
})

describe('exportFileName', () => {
  it('按格式取扩展名', () => {
    expect(exportFileName(sampleDoc(), 'json')).toBe('info.json')
    expect(exportFileName(sampleDoc(), 'txt')).toBe('info.txt')
    expect(exportFileName(sampleDoc(), 'xlsx')).toBe('info.xlsx')
  })
})

describe('toText', () => {
  it('逐行输出帖子与评论', () => {
    expect(toText(sampleDoc()).split('\n')).toEqual([
      '标题：周末去看海',
      '作者：小猫（https://example.com/u/a1）',
      '发布时间：2026-11-09 20:15',
      '原链接：https://example.com/item/9001',
      '互动：点赞 120 · 评论 45 · 收藏 8',
      '',
      '正文：',
      '第一行',
      '第二行',
      '',
      '评论（共 45 条，已导出 2 条评论、1 条回复，因平台风控提前停止，未取全）',
      '',
      '用户c1 · 2026-11-10 08:30 · 赞 10',
      '好看！',
      '[图片] https://example.com/m.jpg',
      '  用户r1 · 2026-11-10 08:30',
      '  同感',
      '  真的',
      '  （还有 4 条回复未导出）',
      '',
      '用户c2 · 2026-11-10 08:30 · 赞 3',
      '=1+1',
      '',
    ])
  })
  it('没有标题、评论时', () => {
    const doc = sampleDoc()
    doc.item.title = null
    doc.item.stats.comments = null
    doc.comments = []
    doc.comments_truncated = false
    const text = toText(doc)
    expect(text).toContain('标题：（无标题）')
    expect(text).toContain('评论（已导出 0 条）\n（无）\n')
    expect(text).not.toContain('\r')
    doc.item.text = 'a\u0007b\u0000c\td'
    expect(toText(doc)).toContain('正文：\nabc\td\n')
  })
})

describe('toXlsx', () => {
  it('包含 OOXML 必需部件和两张表', async () => {
    const files = unzip(await toXlsx([sampleDoc()]))
    expect([...files.keys()].sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ].sort(),
    )
    const wb = files.get('xl/workbook.xml')!
    expect(wb).toContain('<sheet name="作品" sheetId="1" r:id="rId1"/>')
    expect(wb).toContain('<sheet name="评论" sheetId="2" r:id="rId2"/>')
    const s1 = files.get('xl/worksheets/sheet1.xml')!
    expect(s1).toContain('state="frozen"')
    expect(s1).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">平台</t></is></c>')
    expect(s1).toContain('<t xml:space="preserve">评论是否截断</t>')
    // 计数为数值，null 留空
    expect(s1).toContain('<c r="K2"><v>120</v></c>')
    expect(s1).not.toContain('r="J2"')
    expect(s1).toContain('<c r="S2"><v>3</v></c>')
    // 多个媒体用换行分隔
    expect(s1).toContain('https://example.com/1.jpg\nhttps://example.com/2.jpg')
    const s2 = files.get('xl/worksheets/sheet2.xml')!
    expect(s2).toContain('<t xml:space="preserve">父评论 ID</t>')
    expect((s2.match(/<row /g) ?? []).length).toBe(4) // 表头 + 2 评论 + 1 回复
    expect(s2).toContain('<t xml:space="preserve">回复</t>')
  })

  it('公式注入、XML 特殊字符、控制字符、超长文本、大数 ID', async () => {
    const doc = sampleDoc()
    doc.item.id = '7300000000000000001'
    doc.item.title = '@SUM(A1:A2)'
    doc.item.text = `a<b>&"c"\u0000\u0007\u000b￾\uD800d\te`
    doc.comments[0].text = 'x'.repeat(XLSX_CELL_MAX + 100)
    const files = unzip(await toXlsx([doc]))
    const s1 = files.get('xl/worksheets/sheet1.xml')!
    expect(s1).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">7300000000000000001</t></is></c>')
    expect(s1).toContain('<t xml:space="preserve">@SUM(A1:A2)</t>')
    expect(s1).toContain('<t xml:space="preserve">a&lt;b&gt;&amp;&quot;c&quot;d\te</t>')
    expect(s1).not.toMatch(/<f>/)
    const s2 = files.get('xl/worksheets/sheet2.xml')!
    expect(s2).toContain('<t xml:space="preserve">=1+1</t>')
    const long = /<t xml:space="preserve">(x+)<\/t>/.exec(s2)!
    expect(long[1].length).toBe(XLSX_CELL_MAX)
  })

  it('截断时不切开代理对', async () => {
    const doc = sampleDoc()
    doc.item.text = 'a'.repeat(XLSX_CELL_MAX - 1) + '😀'
    const s1 = unzip(await toXlsx([doc])).get('xl/worksheets/sheet1.xml')!
    const m = /<c r="E2"[^>]*><is><t xml:space="preserve">([^<]*)<\/t>/.exec(s1)!
    expect(m[1]).toBe('a'.repeat(XLSX_CELL_MAX - 1))
  })

  it('多条帖子汇总，空列表也能生成', async () => {
    const a = sampleDoc()
    const b = sampleDoc()
    b.item.id = '9002'
    b.comments = []
    const s1 = unzip(await toXlsx([a, b])).get('xl/worksheets/sheet1.xml')!
    expect(s1).toContain('<dimension ref="A1:T3"/>')
    const empty = unzip(await toXlsx([]))
    expect(empty.get('xl/worksheets/sheet2.xml')).toContain('<dimension ref="A1:L1"/>')
  })
})
