import { ZipFile } from 'yazl'
import { z } from 'zod'
import type { Comment, Item } from '../core/schemas.js'

/**
 * 导出格式转换（WebUI 下载时把 `item download --meta` 写出的 JSON 转成纯文本 / Excel）。
 * 纯函数：不联网、不读写文件。
 */

export interface ExportComment extends Comment {
  replies: Comment[]
}

export interface ExportDoc {
  schema: 1
  platform: string
  exported_at: string
  item: Item
  comments: ExportComment[]
  comments_truncated: boolean
}

export type ExportFormat = 'json' | 'txt' | 'xlsx'

// ---------------------------------------------------------------- 校验

const count = z.number().nullable()
const UserRefSchema = z.looseObject({
  id: z.string(),
  name: z.string().nullable(),
  url: z.string().nullable(),
  avatar: z.string().nullable(),
})
const MediaSchema = z.looseObject({
  id: z.string().nullable(),
  type: z.enum(['image', 'video', 'audio']),
  url: z.string().nullable(),
  width: count,
  height: count,
  duration: count,
})
const ItemSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(['video', 'image', 'text', 'article', 'goods', 'torrent']),
  url: z.string().nullable(),
  title: z.string().nullable(),
  text: z.string().nullable(),
  author: UserRefSchema.nullable(),
  created_at: z.string().nullable(),
  cover: z.string().nullable(),
  media: z.array(MediaSchema),
  stats: z.looseObject({ views: count, likes: count, comments: count, collects: count, shares: count }),
  price: z.looseObject({ amount: z.number(), currency: z.string() }).nullable(),
  status: z.string().nullable(),
})
const CommentSchema = z.looseObject({
  id: z.string(),
  item_id: z.string(),
  parent_id: z.string().nullable(),
  author: UserRefSchema.nullable(),
  text: z.string(),
  media: z.array(MediaSchema),
  created_at: z.string().nullable(),
  stats: z.looseObject({ likes: count, replies: count }),
})
const ExportDocSchema = z.looseObject({
  schema: z.literal(1),
  platform: z.string().min(1),
  exported_at: z.string(),
  item: ItemSchema,
  comments: z.array(CommentSchema.extend({ replies: z.array(CommentSchema) })),
  comments_truncated: z.boolean(),
})

/** 解析并校验导出的 JSON；不合法时抛出中文错误。返回原对象（保留 Torrent 等扩展字段）。 */
export function parseExportDoc(text: string): ExportDoc {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    throw new Error(`导出文件不是合法的 JSON：${(e as Error).message}`)
  }
  if (value && typeof value === 'object' && 'schema' in value && (value as { schema: unknown }).schema !== 1) {
    throw new Error(`不支持的导出文件版本：schema=${JSON.stringify((value as { schema: unknown }).schema)}，只支持 1`)
  }
  const r = ExportDocSchema.safeParse(value)
  if (!r.success) {
    const first = r.error.issues[0]
    const path = first?.path.length ? first.path.join('.') : '（根）'
    throw new Error(`导出文件结构不正确：${path}：${first?.message ?? '未知错误'}`)
  }
  return value as ExportDoc
}

/** 单条帖子的导出文件名。 */
export function exportFileName(_doc: ExportDoc, format: ExportFormat): string {
  return `info.${format}`
}

// ---------------------------------------------------------------- 纯文本

/** ISO 时间转成便于阅读的 `YYYY-MM-DD HH:mm`（保留原时区的钟面时间）；不是 ISO 时原样返回。 */
function readableTime(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d)/.exec(iso)
  return m ? `${m[1]} ${m[2]}` : iso
}

function commentHead(c: Comment): string {
  const parts = [c.author?.name ?? c.author?.id ?? '匿名']
  const t = readableTime(c.created_at)
  if (t) parts.push(t)
  if (c.stats.likes != null) parts.push(`赞 ${c.stats.likes}`)
  return parts.join(' · ')
}

function commentLines(c: Comment, indent: string): string[] {
  const out = [indent + commentHead(c)]
  const body = c.text.replace(/\r\n?/g, '\n')
  if (body) for (const line of body.split('\n')) out.push(indent + line)
  for (const m of c.media) if (m.url) out.push(`${indent}[${m.type === 'video' ? '视频' : '图片'}] ${m.url}`)
  return out
}

/** 一条帖子的纯文本（给人读）。换行统一为 \n。 */
export function toText(doc: ExportDoc): string {
  const { item } = doc
  const lines: string[] = []
  lines.push(`标题：${item.title?.trim() || '（无标题）'}`)
  if (item.author) {
    const name = item.author.name ?? item.author.id
    lines.push(`作者：${name}${item.author.url ? `（${item.author.url}）` : ''}`)
  }
  const t = readableTime(item.created_at)
  if (t) lines.push(`发布时间：${t}`)
  if (item.url) lines.push(`原链接：${item.url}`)
  const s = item.stats
  const stats = (
    [
      ['播放', s.views],
      ['点赞', s.likes],
      ['评论', s.comments],
      ['收藏', s.collects],
      ['分享', s.shares],
    ] as const
  )
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k} ${v}`)
  if (stats.length) lines.push(`互动：${stats.join(' · ')}`)
  if (item.price) lines.push(`价格：${item.price.amount} ${item.price.currency}`)

  const text = (item.text ?? '').replace(/\r\n?/g, '\n').trim()
  if (text) lines.push('', '正文：', text)

  const replies = doc.comments.reduce((n, c) => n + c.replies.length, 0)
  const exported = replies ? `已导出 ${doc.comments.length} 条评论、${replies} 条回复` : `已导出 ${doc.comments.length} 条`
  const head = [s.comments != null ? `共 ${s.comments} 条` : null, exported]
  if (doc.comments_truncated) head.push('因平台风控提前停止，未取全')
  lines.push('', `评论（${head.filter(Boolean).join('，')}）`)
  if (!doc.comments.length) lines.push('（无）')
  for (const c of doc.comments) {
    lines.push('', ...commentLines(c, ''))
    for (const r of c.replies) lines.push(...commentLines(r, '  '))
    const rest = (c.stats.replies ?? 0) - c.replies.length
    if (c.replies.length && rest > 0) lines.push(`  （还有 ${rest} 条回复未导出）`)
  }
  // 去掉除 \t \n 以外的控制字符，免得终端、编辑器里出现乱码
  return `${lines.join('\n')}\n`.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

// ---------------------------------------------------------------- Excel

/** Excel 单元格的字符上限。 */
export const XLSX_CELL_MAX = 32767

type Cell = string | number | null | undefined
interface Column {
  header: string
  width: number
  wrap?: boolean
}
interface Sheet {
  name: string
  columns: Column[]
  rows: Cell[][]
}

// XML 1.0 允许的字符之外的一律去掉（包括孤立的代理项、U+FFFE / U+FFFF）。
const INVALID_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu

function cleanText(s: string): string {
  let v = s.replace(INVALID_XML, '')
  if (v.length > XLSX_CELL_MAX) {
    v = v.slice(0, XLSX_CELL_MAX)
    // 不把代理对切成两半
    if (/[\uD800-\uDBFF]$/.test(v)) v = v.slice(0, -1)
  }
  return v
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function colName(i: number): string {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// styles.xml 的 cellXfs：0 默认，1 表头加粗，2 自动换行
const STYLE_HEADER = 1
const STYLE_WRAP = 2

function cellXml(ref: string, v: Cell, style: number): string {
  const s = style ? ` s="${style}"` : ''
  if (v == null) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    return `<c r="${ref}"${s}><v>${v}</v></c>`
  }
  const text = cleanText(v)
  if (!text) return ''
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('')
  const rows: string[] = []
  const header = sheet.columns.map((c, i) => cellXml(`${colName(i)}1`, c.header, STYLE_HEADER)).join('')
  rows.push(`<row r="1">${header}</row>`)
  sheet.rows.forEach((row, ri) => {
    const r = ri + 2
    const cells = row.map((v, ci) => cellXml(`${colName(ci)}${r}`, v, sheet.columns[ci]?.wrap ? STYLE_WRAP : 0)).join('')
    rows.push(`<row r="${r}">${cells}</row>`)
  })
  const last = `${colName(sheet.columns.length - 1)}${sheet.rows.length + 1}`
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join('')}</sheetData>` +
    '</worksheet>'
  )
}

const CONTENT_TYPES = (n: number) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  Array.from(
    { length: n },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('') +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>'

const workbookXml = (names: string[]) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<bookViews><workbookView/></bookViews><sheets>' +
  names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
  '</sheets></workbook>'

const workbookRels = (n: number) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  Array.from(
    { length: n },
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join('') +
  `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  '</Relationships>'

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

const ITEM_COLUMNS: Column[] = [
  { header: '平台', width: 10 },
  { header: 'ID', width: 22 },
  { header: '类型', width: 8 },
  { header: '标题', width: 30, wrap: true },
  { header: '正文', width: 50, wrap: true },
  { header: '作者', width: 16 },
  { header: '作者 ID', width: 22 },
  { header: '作者主页', width: 36 },
  { header: '发布时间', width: 26 },
  { header: '播放', width: 10 },
  { header: '点赞', width: 10 },
  { header: '评论', width: 10 },
  { header: '收藏', width: 10 },
  { header: '分享', width: 10 },
  { header: '价格', width: 12 },
  { header: '链接', width: 40 },
  { header: '封面', width: 40 },
  { header: '媒体链接', width: 50, wrap: true },
  { header: '导出评论数', width: 12 },
  { header: '评论是否截断', width: 14 },
]

const COMMENT_COLUMNS: Column[] = [
  { header: '平台', width: 10 },
  { header: '作品 ID', width: 22 },
  { header: '评论 ID', width: 22 },
  { header: '父评论 ID', width: 22 },
  { header: '层级', width: 8 },
  { header: '作者', width: 16 },
  { header: '作者 ID', width: 22 },
  { header: '内容', width: 60, wrap: true },
  { header: '点赞', width: 10 },
  { header: '回复数', width: 10 },
  { header: '时间', width: 26 },
  { header: '图片链接', width: 50, wrap: true },
]

function itemRow(doc: ExportDoc): Cell[] {
  const { item } = doc
  const s = item.stats
  const exported = doc.comments.reduce((n, c) => n + 1 + c.replies.length, 0)
  return [
    doc.platform,
    item.id,
    item.kind,
    item.title,
    item.text,
    item.author?.name,
    item.author?.id,
    item.author?.url,
    item.created_at,
    s.views,
    s.likes,
    s.comments,
    s.collects,
    s.shares,
    item.price ? `${item.price.amount} ${item.price.currency}` : null,
    item.url,
    item.cover,
    item.media
      .map((m) => m.url)
      .filter((u): u is string => !!u)
      .join('\n'),
    exported,
    doc.comments_truncated ? '是' : '否',
  ]
}

function commentRow(doc: ExportDoc, c: Comment, level: '评论' | '回复'): Cell[] {
  return [
    doc.platform,
    c.item_id || doc.item.id,
    c.id,
    c.parent_id,
    level,
    c.author?.name,
    c.author?.id,
    c.text,
    c.stats.likes,
    c.stats.replies,
    c.created_at,
    c.media
      .map((m) => m.url)
      .filter((u): u is string => !!u)
      .join('\n'),
  ]
}

/** 一批帖子汇总成一个 xlsx：「作品」「评论」两张表。 */
export function toXlsx(docs: ExportDoc[]): Promise<Buffer> {
  const sheets: Sheet[] = [
    { name: '作品', columns: ITEM_COLUMNS, rows: docs.map(itemRow) },
    {
      name: '评论',
      columns: COMMENT_COLUMNS,
      rows: docs.flatMap((d) =>
        d.comments.flatMap((c) => [commentRow(d, c, '评论'), ...c.replies.map((r) => commentRow(d, r, '回复'))]),
      ),
    },
  ]
  const zip = new ZipFile()
  // 固定时间戳，同样的输入得到同样的字节
  const mtime = new Date(Date.UTC(2000, 0, 1))
  const add = (path: string, xml: string) => zip.addBuffer(Buffer.from(xml, 'utf8'), path, { mtime })
  add('[Content_Types].xml', CONTENT_TYPES(sheets.length))
  add('_rels/.rels', ROOT_RELS)
  add(
    'xl/workbook.xml',
    workbookXml(sheets.map((s) => s.name)),
  )
  add('xl/_rels/workbook.xml.rels', workbookRels(sheets.length))
  add('xl/styles.xml', STYLES)
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)))
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.outputStream.on('error', reject)
    zip.end()
  })
}
