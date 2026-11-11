import { Box } from 'ink'
import type { CatbusError } from '../core/errors.js'
import type { Platform } from '../core/registry.js'
import { EVENT_TYPES, type Line, perMinute, visible } from './listen.js'
import { Keys, Pane, T, useGlyphs } from './ui.js'
import { clip, padEnd, padStart } from './text.js'

// 监听页（AGENTS 4.13）：滚动的事件流 + 右栏的统计。事件按类型着色，可暂停、过滤。

const KIND_COLOR: Record<string, 'sub' | 'pink' | 'teal' | 'dim' | 'yellow' | 'sky'> = {
  chat: 'sub',
  gift: 'pink',
  follow: 'teal',
  enter: 'dim',
  like: 'yellow',
  message: 'sky',
  other: 'dim',
}

const FILTER_LABEL: Record<string, string> = { chat: '弹幕', gift: '礼物', follow: '关注', enter: '进场', like: '点赞' }

export interface ListenState {
  lines: Line[]
  hidden: ReadonlySet<string>
  paused: boolean
  /** 暂停时看到的最新一条序号，之后来的算“未读”。 */
  pausedAt: number
  total: number
  /** 每条事件到达的时间戳，用来画柱状。 */
  stamps: number[]
  endsAt: number | null
  startedAt: number
  error: CatbusError | null
  ended: boolean
  /** 暂停后向上翻的偏移（行）。 */
  scroll: number
}

const fmtLeft = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function ListenView({ platform, title, state, now, cols, rows, spin }: { platform: Platform; title: string; state: ListenState; now: number; cols: number; rows: number; spin: string }) {
  const g = useGlyphs()
  const side = cols >= 96
  const sideCols = side ? 30 : 0
  const mainCols = cols - sideCols
  const inner = mainCols - 2
  const shown = visible(state.lines, state.hidden)
  const room = rows - 3
  const end = Math.max(0, shown.length - state.scroll)
  const slice = shown.slice(Math.max(0, end - room), end)
  const hiddenCount = state.lines.length - shown.length
  const unread = state.paused ? state.lines.filter((l) => l.seq > state.pausedAt && !state.hidden.has(l.type)).length : 0

  const timeW = 8
  const kindW = 4
  const whoW = Math.min(14, Math.max(6, Math.floor(inner * 0.2)))
  const textW = Math.max(8, inner - timeW - kindW - whoW - 5)

  const status = state.error ? (
    <T c="red">{`${g.dotOn} 已断开`}</T>
  ) : state.ended ? (
    <T c="dim">{`${g.dotOff} 已结束`}</T>
  ) : state.paused ? (
    <T c="yellow">{`${g.dotOn} 已暂停`}</T>
  ) : (
    <T c="green">{`${spin} 监听中`}</T>
  )

  return (
    <Box width={cols}>
      <Pane title={`${title} · ${shown.length}${hiddenCount ? `（隐藏 ${hiddenCount}）` : ''}`} cols={mainCols} rows={rows} focused>
        {slice.length === 0 ? (
          <Box paddingLeft={1}>
            <T c="dim">{state.ended ? '没有收到事件。' : `${spin} 等待事件…`}</T>
          </Box>
        ) : null}
        {slice.map((l) => (
          <Box key={l.seq} width={inner} height={1} overflow="hidden" paddingLeft={1}>
            <T c="dim">{padEnd(l.time, timeW + 1)}</T>
            <T c={KIND_COLOR[l.type] ?? 'dim'} bold={l.type === 'gift'}>{padEnd(l.kind, kindW + 1)}</T>
            <T c="sub">{padEnd(l.who, whoW + 1, g.more)}</T>
            <T c={l.type === 'gift' ? 'pink' : undefined}>{clip(l.text, textW, g.more)}</T>
          </Box>
        ))}
        {state.paused && unread > 0 ? (
          <Box paddingLeft={1}>
            <T c="yellow">{`${g.open} 暂停期间有 ${unread} 条新事件，按 Space 回到最新`}</T>
          </Box>
        ) : null}
      </Pane>
      {side ? <StatsPane platform={platform} state={state} now={now} cols={sideCols} rows={rows} status={status} /> : null}
    </Box>
  )
}

/** 柱状图的一根：按比例取整，但只要有事件就至少画一点，免得 1 条被四舍五入成空。 */
function bar(n: number, max: number, width: number, unicode: boolean): string {
  const full = unicode ? '█' : '#'
  const hair = unicode ? '▏' : '|'
  const len = Math.round((n / max) * width)
  if (len > 0) return full.repeat(len)
  return n > 0 ? hair : ''
}

function StatsPane({ platform, state, now, cols, rows, status }: { platform: Platform; state: ListenState; now: number; cols: number; rows: number; status: React.ReactNode }) {
  const g = useGlyphs()
  const bars = perMinute(state.stamps, now, 6)
  const max = Math.max(1, ...bars)
  const barW = Math.max(4, cols - 14)
  const left = state.endsAt != null ? fmtLeft(state.endsAt - now) : null
  const counts = EVENT_TYPES.map((t) => [t, state.lines.filter((l) => l.type === t).length] as const)
  return (
    <Pane title="统计" cols={cols} rows={rows}>
      <Box paddingLeft={1}>{status}</Box>
      <Box paddingLeft={1}>
        <T c="dim">{'平台    '}</T>
        <T>{platform.name}</T>
      </Box>
      <Box paddingLeft={1}>
        <T c="dim">{'已收到  '}</T>
        <T>{`${state.total} 条`}</T>
      </Box>
      <Box paddingLeft={1}>
        <T c="dim">{'已运行  '}</T>
        <T>{fmtLeft(now - state.startedAt)}</T>
      </Box>
      {left ? (
        <Box paddingLeft={1}>
          <T c="dim">{'剩余    '}</T>
          <T c="yellow">{left}</T>
        </Box>
      ) : null}
      <Box height={1} />
      <Box paddingLeft={1}>
        <T c="dim">每分钟事件数</T>
      </Box>
      {bars.map((n, i) => (
        <Box key={i} paddingLeft={1}>
          <T c={i === bars.length - 1 ? 'accent' : 'green'}>{bar(n, max, barW, g.box === 'round')}</T>
          <T c="dim">{' ' + String(n)}</T>
        </Box>
      ))}
      <Box height={1} />
      <Box paddingLeft={1}>
        <T c="dim">按 1-5 显示 / 隐藏</T>
      </Box>
      {counts.map(([t, n], i) => (
        <Box key={t} paddingLeft={1}>
          <T c={state.hidden.has(t) ? 'dim' : 'fg'}>{`${i + 1} ${state.hidden.has(t) ? '[ ]' : '[x]'} ${padEnd(FILTER_LABEL[t]!, 5)}`}</T>
          <T c="dim">{padStart(String(n), 5)}</T>
        </Box>
      ))}
      {state.error ? (
        <Box paddingLeft={1} paddingTop={1} flexDirection="column">
          <T c="red">{clip(state.error.message, cols - 4, g.more)}</T>
          <T c="dim">{clip(state.error.hint ?? '', cols - 4, g.more)}</T>
        </Box>
      ) : null}
    </Pane>
  )
}

export function ListenKeys({ cols, ended }: { cols: number; ended: boolean }) {
  return (
    <Keys
      cols={cols}
      items={ended ? [['r', '重新监听'], ['Esc', '返回']] : [['Space', '暂停 / 继续'], ['1-5', '过滤类型'], ['↑↓', '回看'], ['c', '复制命令'], ['Esc', '停止']]}
    />
  )
}

