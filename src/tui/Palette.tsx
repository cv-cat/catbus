import { Box } from 'ink'
import { type Availability, availability } from './model.js'
import { splitAtCursor, type TextState } from './input.js'
import type { PaletteEntry } from './state.js'
import { Keys, Pane, Row, T, useGlyphs } from './ui.js'
import { clip, width } from './text.js'

// 命令面板（AGENTS 4.13）：按 / 打开，搜遍所有平台的全部命令。灰色的是界面里不运行的命令。

/** 命令右边的小标签：能用的不写（监听写“监听”），要登录但没登录的提示，不在界面里运行的说明去哪运行。 */
function paletteTag(state: Availability, canCall: boolean): string {
  if (state === 'planned') return '规划中'
  if (state === 'cli-only') return '在终端运行'
  if (!canCall) return '需要登录'
  return state === 'listen' ? '监听' : ''
}

export function PaletteView({
  query,
  entries,
  selected,
  cols,
  rows,
  loggedIn,
}: {
  query: TextState
  entries: PaletteEntry[]
  selected: number
  cols: number
  rows: number
  loggedIn: Set<string>
}) {
  const g = useGlyphs()
  const w = Math.min(cols - 4, 78)
  const inner = w - 2
  const list = Math.max(3, Math.min(entries.length, rows - 10))
  const top = Math.max(0, Math.min(selected - Math.floor(list / 2), entries.length - list))
  const shown = entries.slice(top, top + list)
  const [a, c, b] = splitAtCursor(query)
  const picked = entries[selected]
  return (
    <Box flexDirection="column" width={cols} alignItems="center">
      <Pane title="命令面板" cols={w} rows={list + 6} focused>
        <Box paddingLeft={1}>
          <T c="mauve">/ </T>
          <T>{a}</T>
          <T bg="accent">{c === '' ? ' ' : c}</T>
          <T>{b}</T>
        </Box>
        <Box height={1} />
        {shown.length === 0 ? (
          <Box paddingLeft={1}>
            <T c="dim">没有匹配的命令。试试平台名、中文说明或命令名。</T>
          </Box>
        ) : null}
        {shown.map((e, i) => {
          const state = availability(e.command)
          const tag = paletteTag(state, e.command.auth === 'optional' || loggedIn.has(e.platform.id))
          const label = `${e.platform.id} ${e.command.resource} ${e.command.action}`
          return (
            <Row
              key={e.platform.id + e.command.key}
              cols={inner}
              selected={top + i === selected}
              right={tag}
              rightColor={state === 'run' || state === 'listen' ? 'yellow' : 'dim'}
              left={
                <>
                  <T c={state === 'run' || state === 'listen' ? 'fg' : 'dim'} bold={state === 'run' || state === 'listen'}>
                    {label}
                  </T>
                  <T c="sub">{'  ' + clip(e.command.summary, Math.max(4, inner - width(label) - width(tag) - 4), g.more)}</T>
                </>
              }
            />
          )
        })}
        <Box height={1} />
        <Box paddingLeft={1}>
          <T c="dim">{picked ? clip(`catbus ${picked.platform.id} ${picked.command.resource} ${picked.command.action}`, inner - 2, g.more) : ' '}</T>
        </Box>
      </Pane>
      <Keys cols={w} items={[['↑↓', '选择'], ['Enter', '打开'], ['Esc', '关闭']]} />
    </Box>
  )
}
