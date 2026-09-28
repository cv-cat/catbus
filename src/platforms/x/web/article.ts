import { CatbusError } from '../../../core/errors.js'
import * as rand from '../../../core/rand.js'
import { ARTICLE_MEDIA_CATEGORY } from './api.js'

/**
 * X 文章（Article）正文装配：Markdown → Draft.js content_state，移植自上游 utils/article_util.py。
 *
 * 结构与浏览器一致：键名是 snake_case（entity_ranges / inline_style_ranges / entity_map），entity_map 是
 * `[{key, value}]` 数组，样式名是 Bold / Italic / Strikethrough。offset / length 按 Unicode 码点计
 * （Python 的 len()），不是 JS 字符串的 UTF-16 下标，所以这里一律用 `[...s].length`。
 *
 * 正则照抄上游，只把 Python 与 JS 语义不同的地方换掉：`\s` 换成 Python 的空白全集，`.` 换成 `[^\n]`
 * （JS 的 `.` 还不匹配 \r 和 U+2028 / U+2029），`\d` 换成 `\p{Nd}`。
 */

/** Python `re` / `str.strip()` 的空白（str.isspace 的全集）。 */
const WS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
/** 按上游的正则写，`\s` 换成 Python 的空白全集。 */
const re = (source: string) => new RegExp(source.replaceAll('\\s', `[${WS}]`), 'u')

const HEADING_RE = re('^(#{1,6})\\s+([^\\n]*)$')
const UL_RE = re('^[-*+]\\s+([^\\n]*)$')
const OL_RE = re('^\\p{Nd}+[.)]\\s+([^\\n]*)$')
const QUOTE_RE = re('^>\\s?([^\\n]*)$')
const DIVIDER_RE = re('^(?:-{3,}|\\*{3,}|_{3,})$')
const IMAGE_RE = new RegExp(`^!\\[([^\\]]*)\\]\\(([^)${WS}]+)(?:[${WS}]+"[^"]*")?\\)$`, 'u')
const FENCE_RE = re('^(`{3,}|~{3,})([^\\n]*)$')
const TITLE_RE = re('^#\\s+([^\\n]*)$')

// 行内记号：顺序即优先级，** 必须排在 * 前面。粗体内部允许完整的 *斜体* 和转义字符，这样 `**粗 *斜***` 能正确闭合。
const ESC = '\\\\[\\\\`*_~\\[\\]()!#>\\-]'
const ITALIC_BODY = `[^*${WS}](?:(?:${ESC}|[^*\\\\])*?[^*${WS}\\\\])?`
const INLINE_RE = new RegExp(
  '\\\\(?<esc>[\\\\`*_~\\[\\]()!#>\\-])' +
    `|\\*\\*(?<bold>(?:${ESC}|\\*${ITALIC_BODY}\\*|[^*\\\\])+?)\\*\\*` +
    '|~~(?<strike>[^\\n]+?)~~' +
    `|\\*(?<italic>${ITALIC_BODY})\\*` +
    `|\\[(?<ltext>[^\\]]+)\\]\\((?<lurl>[^)${WS}]+)\\)`,
  'gu',
)
const STYLE_BY_GROUP = { bold: 'Bold', italic: 'Italic', strike: 'Strikethrough' } as const

const BLOCK_KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Python 的 `str.strip()` / `str.rstrip()`。 */
const strip = (s: string) => s.replace(new RegExp(`^[${WS}]+|[${WS}]+$`, 'gu'), '')
const rstrip = (s: string) => s.replace(new RegExp(`[${WS}]+$`, 'u'), '')
/** 码点数，对应 Python 的 `len()`。 */
const len = (s: string) => [...s].length

interface StyleRange {
  length: number
  offset: number
  style: string
}
type Link = [offset: number, length: number, url: string]

/** Draft.js genKey：5 位 base36 随机串。上游 gen_block_key（random.choices）。 */
export function genBlockKey(): string {
  return rand.string(5, BLOCK_KEY_ALPHABET)
}

/** 逐块拼 content_state。上游 ContentStateBuilder。 */
class ContentStateBuilder {
  readonly blocks: unknown[] = []
  readonly entityMap: unknown[] = []
  private mediaSeq = 0

  addEntity(type: string, data: unknown, mutability = 'Immutable'): number {
    const key = this.entityMap.length
    this.entityMap.push({ key: String(key), value: { data, type, mutability } })
    return key
  }

  addText(text: string, blockType = 'unstyled', styles: StyleRange[] = [], entityRanges: unknown[] = []): void {
    this.blocks.push({ data: {}, text, key: genBlockKey(), type: blockType, entity_ranges: entityRanges, inline_style_ranges: styles })
  }

  /** 带行内 Markdown 记号的一段文字。 */
  addMarkdownText(source: string, blockType = 'unstyled'): void {
    const [text, styles, links] = parseInline(source)
    const entityRanges = links.map(([offset, length, url]) => ({ key: this.addEntity('LINK', { url }, 'Mutable'), offset, length }))
    this.addText(text, blockType, styles, entityRanges)
  }

  /** atomic 块的文本固定是一个空格，实体挂在这个空格上。 */
  private addAtomic(entityKey: number): void {
    this.addText(' ', 'atomic', [], [{ key: entityKey, offset: 0, length: 1 }])
  }

  addDivider(): void {
    this.addAtomic(this.addEntity('DIVIDER', {}))
  }

  /** 插图：一个 MEDIA 块最多 4 张图（编辑器限制）。 */
  addMedia(mediaIds: string[]): void {
    const items = mediaIds.map((id) => ({ local_media_id: ++this.mediaSeq, media_category: ARTICLE_MEDIA_CATEGORY, media_id: String(id) }))
    // 与上游求值顺序一致：先生成 uuid（实体），再生成块的 key
    this.addAtomic(this.addEntity('MEDIA', { entity_key: rand.uuid4(), media_items: items }))
  }

  /** 代码块：编辑器「插入 → 代码」存成 MARKDOWN 实体，内容是整段围栏。 */
  addCode(code: string, language = ''): void {
    this.addAtomic(this.addEntity('MARKDOWN', { markdown: '```' + language + '\n' + code + '\n```' }, 'Mutable'))
  }

  build() {
    return { blocks: this.blocks, entity_map: this.entityMap }
  }
}

/** 同一样式首尾相接的区间合并成一段（编辑器也是这样保存的）。上游 _merge_adjacent。 */
function mergeAdjacent(styles: StyleRange[]): StyleRange[] {
  const cmp = (a: [string | number, string | number], b: [string | number, string | number]) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  const merged: StyleRange[] = []
  for (const item of [...styles].sort((a, b) => cmp([a.style, a.offset], [b.style, b.offset]))) {
    const last = merged.at(-1)
    if (last && last.style === item.style && last.offset + last.length >= item.offset) {
      const end = Math.max(last.offset + last.length, item.offset + item.length)
      last.length = end - last.offset
    } else merged.push({ ...item })
  }
  return merged.sort((a, b) => cmp([a.offset, a.style], [b.offset, b.style]))
}

/**
 * 解析行内记号，返回 [纯文本, inline_style_ranges, [offset, length, url][]]。支持嵌套，offset 按码点计。
 * 上游 parse_inline。
 */
export function parseInline(source: string, baseStyles: string[] = []): [string, StyleRange[], Link[]] {
  const out: string[] = []
  const styles: StyleRange[] = []
  const links: Link[] = []
  let size = 0
  let cursor = 0

  const emit = (text: string, active: string[]) => {
    if (!text) return
    const offset = size
    const length = len(text)
    out.push(text)
    size += length
    for (const style of active) styles.push({ length, offset, style })
  }
  const merge = (text: string, innerStyles: StyleRange[], innerLinks: Link[]) => {
    const base = size
    out.push(text)
    size += len(text)
    for (const s of innerStyles) styles.push({ ...s, offset: s.offset + base })
    for (const [o, n, u] of innerLinks) links.push([o + base, n, u])
  }

  for (const m of source.matchAll(INLINE_RE)) {
    emit(source.slice(cursor, m.index), baseStyles)
    cursor = m.index + m[0].length
    const g = m.groups!
    if (g.esc !== undefined) emit(g.esc, baseStyles)
    else if (g.ltext !== undefined) {
      const [text, innerStyles, innerLinks] = parseInline(g.ltext, baseStyles)
      const offset = size
      merge(text, innerStyles, innerLinks)
      links.push([offset, len(text), g.lurl!])
    } else {
      const group = (['bold', 'strike', 'italic'] as const).find((k) => g[k] !== undefined)!
      const [text, innerStyles, innerLinks] = parseInline(g[group]!, [...baseStyles, STYLE_BY_GROUP[group]])
      merge(text, innerStyles, innerLinks)
    }
  }
  emit(source.slice(cursor), baseStyles)
  return [out.join(''), mergeAdjacent(styles), links]
}

/**
 * Markdown → content_state。每个非空行是一个块，空行只做分隔。遇到独占一行的 `![](path)` 时调用
 * uploadImage 取 media_id；没给 uploadImage 时报错，避免静默丢图。上游 markdown_to_content_state。
 */
export async function markdownToContentState(markdown: string, uploadImage?: (path: string) => Promise<string>) {
  const builder = new ContentStateBuilder()
  const lines = (markdown ?? '').replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length) {
    const line = rstrip(lines[index]!)
    index++
    const stripped = strip(line)
    if (!stripped) continue

    const fence = FENCE_RE.exec(stripped)
    if (fence) {
      const [, marker, language] = fence as unknown as [string, string, string]
      const code: string[] = []
      while (index < lines.length && !strip(lines[index]!).startsWith(marker)) code.push(lines[index++]!)
      index++ // 跳过收尾围栏
      builder.addCode(code.join('\n'), strip(language))
      continue
    }

    if (DIVIDER_RE.test(stripped)) {
      builder.addDivider()
      continue
    }

    const image = IMAGE_RE.exec(stripped)
    if (image) {
      if (!uploadImage) throw new CatbusError('USAGE', `正文里有图片 ${image[2]}，但没有提供上传方式`)
      builder.addMedia([await uploadImage(image[2]!)])
      continue
    }

    const heading = HEADING_RE.exec(stripped)
    if (heading) {
      builder.addMarkdownText(strip(heading[2]!), heading[1]!.length === 1 ? 'header-one' : 'header-two')
      continue
    }

    const block = (
      [
        [UL_RE, 'unordered-list-item'],
        [OL_RE, 'ordered-list-item'],
        [QUOTE_RE, 'blockquote'],
      ] as const
    ).find(([r]) => r.test(stripped))
    if (block) builder.addMarkdownText(strip(block[0].exec(stripped)![1]!), block[1])
    else builder.addMarkdownText(stripped)
  }
  return builder.build()
}

/**
 * 正文第一行是 `# 标题` 时拆出来当文章标题，返回 [标题, 剩余正文]；否则 [null, 原文]。
 * 文章标题在编辑器里是单独字段，正文里再放一个一级标题会重复显示。上游 split_title。
 */
export function splitTitle(markdown: string): [string | null, string] {
  const lines = (markdown ?? '').replace(/^\n+/, '').split('\n')
  const m = TITLE_RE.exec(strip(lines[0]!))
  if (m) return [strip(m[1]!), lines.slice(1).join('\n')]
  return [null, markdown]
}
