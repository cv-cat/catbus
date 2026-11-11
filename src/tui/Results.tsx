import { Box } from 'ink'
import { type Col, columnsFor, flatten, kindOf, linkOf, wrap } from './summary.js'
import { type Results as ResultsData } from './state.js'
import { Keys, Pane, T, useGlyphs, useLook } from './ui.js'
import { clip, padEnd, padStart, width } from './text.js'

// 结果页：左边列表，右边选中项的字段（AGENTS 4.13）。宽度不够时只显示列表，Enter 进入详情。

function colWidths(cols: Col[], total: number): number[] {
  const fixed = cols.reduce((n, c) => n + (c.width === 'flex' ? 0 : c.width + 1), 0)
  const flex = Math.max(8, total - fixed)
  return cols.map((c) => (c.width === 'flex' ? flex : c.width))
}

/** 列表里能显示几行数据：高度减去标题线、底边框和表头。 */
export const listVisible = (height: number): number => Math.max(1, height - 3)

const fmtHead = (c: Col, w: number) => (c.align === 'right' ? padStart(c.head, w) : padEnd(c.head, w))

export function ResultsView({
  data,
  selected,
  top,
  cols,
  rows,
  detail,
  loadingMore,
}: {
  data: ResultsData
  selected: number
  top: number
  cols: number
  rows: number
  /** 窄终端下进入详情后，整屏显示详情。 */
  detail: boolean
  loadingMore: boolean
}) {
  const g = useGlyphs()
  const look = useLook()
  const split = cols >= 100
  const listCols = split ? Math.floor(cols * 0.6) : cols
  const detailCols = cols - listCols
  const bodyRows = rows
  const inner = listCols - 2
  const columns = columnsFor(data.items, inner - 1)
  const widths = colWidths(columns, inner - 1)
  const visible = listVisible(rows)
  const slice = data.items.slice(top, top + visible)
  const sel = data.items[selected]

  const list = (
    <Pane title={`${data.single ? '结果' : `${data.command.resource} ${data.command.action}`} · ${data.items.length}${data.page?.has_more ? '+' : ''}`} cols={listCols} rows={bodyRows} focused={!detail}>
      <Box width={inner} height={1}>
        <T c="dim">{' '}</T>
        {columns.map((c, i) => (
          <Box key={c.head} marginRight={1} width={widths[i]} height={1} overflow="hidden" flexShrink={0}>
            <T c="dim">{fmtHead(c, widths[i]!)}</T>
          </Box>
        ))}
      </Box>
      {slice.map((item, i) => {
        const idx = top + i
        const on = idx === selected
        return (
          <Box key={idx} width={inner} height={1} overflow="hidden" backgroundColor={on && !look.mono ? look.palette.sel : undefined}>
            <T c="accent">{on ? g.caret : ' '}</T>
            {columns.map((c, j) => {
              const text = c.get(item)
              const tone = c.tone?.(item)
              const color = tone === 'ok' ? 'green' : tone === 'warn' ? 'yellow' : tone === 'dim' ? 'dim' : j === 0 && on ? 'accent' : undefined
              return (
                <Box key={c.head} marginRight={1} width={widths[j]} height={1} overflow="hidden" flexShrink={0}>
                  <T c={color} bold={on && (j === 0 || look.mono)}>
                    {c.align === 'right' ? padStart(text, widths[j]!, g.more) : padEnd(text, widths[j]!, g.more)}
                  </T>
                </Box>
              )
            })}
          </Box>
        )
      })}
      {loadingMore ? (
        <Box width={inner}>
          <T c="accent">{' ' + g.spin[0]}</T>
          <T c="dim">{' 正在载入下一页…'}</T>
        </Box>
      ) : null}
    </Pane>
  )

  const lines = sel == null ? [] : flatten(sel)
  const keyW = Math.min(16, Math.max(4, ...lines.map((l) => width(l.key))))
  const valW = Math.max(8, detailCols - 2 - keyW - 3)
  const body = lines.flatMap((l) => wrap(l.value, valW, width).map((part, i) => ({ key: i === 0 ? l.key : '', part, tone: l.tone })))
  const detailPane = (w: number) => (
    <Pane title={detailTitle(sel)} cols={w} rows={bodyRows} focused={detail}>
      {body.slice(0, bodyRows - 2).map((l, i) => (
        <Box key={i} paddingLeft={1}>
          <T c="dim">{padEnd(clip(l.key, keyW, g.more), keyW + 2)}</T>
          <T c={l.tone === 'ok' ? 'green' : l.tone === 'warn' ? 'yellow' : undefined}>{l.part}</T>
        </Box>
      ))}
      {body.length > bodyRows - 2 ? (
        <Box paddingLeft={1}>
          <T c="dim">{`${g.more} 还有 ${body.length - (bodyRows - 2)} 行，按 J 看原始 JSON`}</T>
        </Box>
      ) : null}
    </Pane>
  )

  return (
    <Box flexDirection="column" width={cols}>
      <Box width={cols}>
        {!detail || split ? list : null}
        {split || detail ? detailPane(split ? detailCols : cols) : null}
      </Box>
    </Box>
  )
}

function detailTitle(sel: unknown): string {
  const kind = kindOf(sel)
  const link = linkOf(sel)
  const label: Record<string, string> = { ticket: '车次', item: '详情', user: '用户', comment: '评论', station: '车站', stop: '经停', transfer: '中转', live: '直播间' }
  return `${label[kind] ?? '详情'}${link && link.length < 24 ? ' · ' + link : ''}`
}

export function ResultKeys({ cols, canMore, split }: { cols: number; canMore: boolean; split: boolean }) {
  const items: [string, string][] = [['j k', '移动'], ['Enter', split ? '全屏详情' : '详情']]
  if (canMore) items.push(['n', '下一页'])
  items.push(['o', '浏览器打开'], ['y', '复制链接'], ['c', '复制命令'], ['J', '原始 JSON'], ['Esc', '返回'])
  return <Keys items={items} cols={cols} />
}
