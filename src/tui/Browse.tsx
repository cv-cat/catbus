import { Box } from 'ink'
import type { Command, Platform } from '../core/registry.js'
import { fields, type Field, type FormValue, type PlatformRow, availability, type Group } from './model.js'
import { commandVisible, type Row as NavRow } from './state.js'
import { splitAtCursor, type TextState } from './input.js'
import { Keys, Pane, Row, T, useGlyphs } from './ui.js'
import type { Glyphs } from './theme.js'
import { clip, padEnd, width } from './text.js'

// 首页：平台、命令、参数表单（AGENTS 4.13）。宽终端三栏并排，窄终端合并成平台+命令两栏、表单盖在命令栏上。

export function PlatformPane({ rows, selected, cols, height, focused }: { rows: PlatformRow[]; selected: number; cols: number; height: number; focused: boolean }) {
  const g = useGlyphs()
  const inner = cols - 2
  return (
    <Pane title="平台" cols={cols} rows={height} focused={focused}>
      {rows.map((r, i) => {
        const dot = r.open ? <T c="teal">{g.dotOn}</T> : r.loggedIn ? <T c="green">{g.dotOn}</T> : <T c="dim">{g.dotOff}</T>
        return (
          <Row
            key={r.platform.id}
            cols={inner}
            selected={i === selected}
            right={String(r.implemented)}
            left={
              <>
                {dot} {r.platform.name}
              </>
            }
          />
        )
      })}
      <Box height={1} />
      <Box paddingLeft={1}>
        <T c="dim">{`${g.dotOn} 已登录  ${g.dotOff} 未登录`}</T>
      </Box>
      <Box paddingLeft={1}>
        <T c="teal">{g.dotOn}</T>
        <T c="dim">{' 免登录可用'}</T>
      </Box>
    </Pane>
  )
}

/** 命令状态：● 在界面里运行，~ 持续监听，○ 复制到终端运行，- 规划中。形状都不同，不只靠颜色区分。 */
const MARK: Record<string, [(g: Glyphs) => string, 'green' | 'dim' | 'yellow' | 'mauve']> = {
  run: [(g) => g.dotOn, 'green'],
  listen: [() => '~', 'mauve'],
  'cli-only': [(g) => g.dotOff, 'dim'],
  planned: [() => '-', 'yellow'],
}

export function CommandPane({
  platform,
  rows,
  selected,
  top,
  cols,
  height,
  focused,
}: {
  platform: Platform
  rows: NavRow[]
  selected: number
  top: number
  cols: number
  height: number
  focused: boolean
}) {
  const g = useGlyphs()
  const inner = cols - 2
  const visible = commandVisible(rows.length, height)
  const slice = rows.slice(top, top + visible)
  return (
    <Pane title={`命令 ${g.sep} ${platform.name}`} cols={cols} rows={height} focused={focused}>
      {slice.map((r, i) => {
        const idx = top + i
        if (r.type === 'group') {
          return (
            <Row
              key={'g' + r.resource}
              cols={inner}
              selected={idx === selected}
              right={`${r.ready}/${r.total}`}
              left={<T c="sub">{`${r.open ? g.open : g.closed} ${r.resource}`}</T>}
            />
          )
        }
        const state = availability(r.command)
        const [glyph, color] = MARK[state]!
        return (
          <Row
            key={r.command.key}
            cols={inner}
            selected={idx === selected}
            left={
              <>
                {'  '}
                <T c={color}>{glyph(g)}</T> {r.command.action}
                <T c="sub">{'  ' + clip(r.command.summary, Math.max(4, inner - 8 - width(r.command.action)), g.more)}</T>
              </>
            }
          />
        )
      })}
      {rows.length > visible ? (
        <Box paddingLeft={1}>
          <T c="dim">{`${top + 1}-${Math.min(rows.length, top + visible)} / ${rows.length}`}</T>
        </Box>
      ) : null}
    </Pane>
  )
}

export function FormPane({
  command,
  values,
  active,
  editor,
  cols,
  height,
  focused,
  note,
}: {
  command: Command | null
  values: Record<string, FormValue>
  active: number
  editor: TextState
  cols: number
  height: number
  focused: boolean
  note: string | null
}) {
  const g = useGlyphs()
  if (!command) {
    return (
      <Pane title="参数" cols={cols} rows={height} focused={focused}>
        <Box paddingLeft={1}>
          <T c="dim">选一条命令，右边显示它的参数。</T>
        </Box>
      </Pane>
    )
  }
  const list = fields(command)
  const state = availability(command)
  const labelW = Math.max(8, ...list.map((f) => width(f.label))) + 1
  const valueW = Math.max(6, cols - 2 - 1 - labelW - 1)
  return (
    <Pane title={`${command.resource} ${command.action}`} cols={cols} rows={height} focused={focused}>
      <Box paddingLeft={1}>
        <T bold>{clip(command.summary, cols - 4, g.more)}</T>
      </Box>
      <Box paddingLeft={1}>
        <T c="dim">{clip(`登录 ${command.auth === 'required' ? '需要' : '可选'} · 输出 ${command.output}${command.paged ? '，分页' : ''}`, cols - 4, g.more)}</T>
      </Box>
      {command.note ? (
        <Box paddingLeft={1}>
          <T c="yellow">{clip(command.note, cols - 4, g.more)}</T>
        </Box>
      ) : null}
      <Box height={1} />
      {list.length === 0 ? (
        <Box paddingLeft={1}>
          <T c="dim">没有参数，直接运行。</T>
        </Box>
      ) : null}
      {list.map((f, i) => (
        <FieldRow key={f.label} field={f} value={values[f.label]} on={focused && i === active} editor={editor} labelW={labelW} valueW={valueW} />
      ))}
      <Box height={1} />
      <Box paddingLeft={1}>
        {state === 'run' ? (
          <T bg="green" bold>
            {' Enter 运行 '}
          </T>
        ) : state === 'listen' ? (
          <T bg="green" bold>
            {' Enter 开始监听 '}
          </T>
        ) : state === 'cli-only' ? (
          <T c="yellow">界面里不运行这类命令，复制到终端执行：按 c</T>
        ) : (
          <T c="yellow">这条命令还没实现（规划中）</T>
        )}
      </Box>
      {note ? (
        <Box paddingLeft={1}>
          <T c="dim">{clip(note, cols - 4, g.more)}</T>
        </Box>
      ) : null}
    </Pane>
  )
}

function FieldRow({ field, value, on, editor, labelW, valueW }: { field: Field; value: FormValue; on: boolean; editor: TextState; labelW: number; valueW: number }) {
  const g = useGlyphs()
  let shown: React.ReactNode
  if (field.kind === 'boolean') {
    shown = <T c={value ? 'green' : 'dim'}>{value ? '[x] 开' : '[ ] 关'}</T>
  } else if (field.kind === 'enum' && field.values) {
    shown = (
      <>
        {field.values.map((v) => {
          const picked = (value ?? field.default) === v
          return (
            <T key={v} bg={picked ? 'dim' : undefined} c={picked ? undefined : 'dim'}>
              {picked ? ` ${v} ` : ` ${v}`}
            </T>
          )
        })}
      </>
    )
  } else if (on) {
    const [a, c, b] = splitAtCursor(editor)
    shown = (
      <>
        <T c="accent">{a}</T>
        <T bg="accent">{c === '' ? ' ' : c}</T>
        <T c="accent">{b}</T>
      </>
    )
  } else {
    const s = typeof value === 'string' && value !== '' ? value : field.default != null ? String(field.default) : ''
    shown = s ? <T c={typeof value === 'string' && value !== '' ? 'accent' : 'dim'}>{clip(s, valueW, g.more)}</T> : <T c="dim">{clip(field.hint, valueW, g.more)}</T>
  }
  return (
    <Box paddingLeft={0}>
      <T c="accent">{on ? g.caret : ' '}</T>
      <T c={on ? 'fg' : 'dim'}>{padEnd(field.label + (field.required ? '*' : ''), labelW)}</T>
      <Box width={valueW} overflow="hidden">
        {shown}
      </Box>
    </Box>
  )
}

export function BrowseKeys({ cols, pane, canRun }: { cols: number; pane: string; canRun: boolean }) {
  const items: [string, string][] =
    pane === 'form'
      ? [['Tab', '下一项'], ['←→', '选值'], ...(canRun ? ([['Enter', '运行']] as [string, string][]) : []), ['c', '复制命令'], ['Esc', '返回']]
      : [['↑↓', '移动'], ['→ Enter', pane === 'platforms' ? '进入命令' : '展开/填参数'], ['/', '命令面板'], ['a', '账号'], ['c', '复制命令'], ['?', '帮助'], ['q', '退出']]
  return <Keys items={items} cols={cols} />
}

export type { Group }
