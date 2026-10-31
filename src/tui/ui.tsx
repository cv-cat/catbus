import { Box, Text } from 'ink'
import { createContext, type ReactNode, useContext } from 'react'
import { type Glyphs, type Look, PLAIN, UNICODE } from './theme.js'
import { clip, padEnd, padStart, width } from './text.js'

// 布局原语（AGENTS 4.13）。所有颜色经 Look 取，NO_COLOR 时一律不上色；所有宽度经 string-width 算。

export const LookContext = createContext<Look>({ palette: undefined as never, mono: false, ascii: false, animate: true, plainSpinner: false })
export const useLook = () => useContext(LookContext)

export function useGlyphs(): Glyphs {
  const look = useLook()
  const base = look.ascii ? PLAIN : UNICODE
  return look.plainSpinner && !look.ascii ? { ...base, spin: PLAIN.spin } : base
}

export type ColorName = 'fg' | 'dim' | 'sub' | 'accent' | 'green' | 'yellow' | 'red' | 'teal' | 'mauve' | 'pink' | 'sky' | 'blue'

/** 取颜色值；NO_COLOR 时返回 undefined，Ink 就不输出颜色序列。 */
export function useColor(): (name: ColorName | undefined) => string | undefined {
  const look = useLook()
  return (name) => (look.mono || !name ? undefined : look.palette[name === 'fg' ? 'fg' : name])
}

interface TProps {
  c?: ColorName
  bg?: 'sel' | 'bar' | 'accent' | 'green' | 'yellow' | 'red' | 'dim'
  bold?: boolean
  inverse?: boolean
  children?: ReactNode
}

/** 带主题色的文字。NO_COLOR 时背景色改用反色，保持"被选中"这类信息还在。 */
export function T({ c, bg, bold, inverse, children }: TProps) {
  const look = useLook()
  const color = useColor()
  const p = look.palette
  if (look.mono) return <Text bold={bold || bg === 'sel' || bg === 'accent'} inverse={inverse || bg === 'accent' || bg === 'green'}>{children}</Text>
  const bgValue = bg ? p[bg] : undefined
  const onFill = bg && bg !== 'sel' && bg !== 'bar'
  return (
    <Text color={onFill ? p.bg : color(c)} backgroundColor={bgValue} bold={bold} inverse={inverse}>
      {children}
    </Text>
  )
}

/** 一块单行文字，补到固定列数（超出以省略号截断）。 */
export function Cell({ children, cols, align }: { children: string; cols: number; align?: 'right' }) {
  const g = useGlyphs()
  const ell = g.more
  return <Text>{align === 'right' ? padStart(children, cols, ell) : padEnd(children, cols, ell)}</Text>
}

interface PaneProps {
  title: string
  cols: number
  rows: number
  focused?: boolean
  children?: ReactNode
}

/**
 * 带标题的框：Ink 的边框不支持标题，所以顶边自己画，其余三边交给 Ink。
 * 标题按显示宽度截断，免得中文把右上角顶出去。
 */
export function Pane({ title, cols, rows, focused, children }: PaneProps) {
  const look = useLook()
  const g = useGlyphs()
  const p = look.palette
  const line = look.mono ? undefined : focused ? p.accent : p.line
  const [tl, h, tr] = g.box === 'round' ? ['╭', '─', '╮'] : ['+', '-', '+']
  const room = Math.max(0, cols - 6)
  const t = clip(title, room, g.more)
  const fill = h.repeat(Math.max(0, cols - 5 - width(t)))
  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Text color={line} bold={look.mono && focused}>
        {tl}
        {h}{' '}
        <Text color={look.mono ? undefined : focused ? p.accent : p.dim} bold={focused}>
          {t}
        </Text>{' '}
        {fill}
        {tr}
      </Text>
      <Box
        width={cols}
        height={rows - 1}
        flexDirection="column"
        overflow="hidden"
        borderStyle={g.box === 'round' ? 'round' : { topLeft: '+', top: '-', topRight: '+', left: '|', right: '|', bottomLeft: '+', bottom: '-', bottomRight: '+' }}
        borderTop={false}
        borderColor={line}
      >
        {children}
      </Box>
    </Box>
  )
}

/** 一行：左边内容吃掉剩余宽度，右边是固定的小字。选中行整行用选中色，左边有一条竖线。 */
export function Row({
  cols,
  left,
  right,
  selected,
  rightColor,
}: {
  /** Pane 内部可用的列数（Pane 宽度减去两侧边框）。 */
  cols: number
  left: ReactNode
  right?: string
  selected?: boolean
  rightColor?: ColorName
}) {
  const g = useGlyphs()
  const look = useLook()
  const rw = right ? width(right) + 1 : 0
  return (
    <Box width={cols} overflow="hidden" backgroundColor={selected && !look.mono ? look.palette.sel : undefined}>
      <T c="accent" bold={selected}>
        {selected ? g.caret : ' '}
      </T>
      <Box flexGrow={1} flexShrink={1} overflow="hidden" height={1} width={cols - 1 - rw}>
        <T bold={selected && look.mono}>{left}</T>
      </Box>
      {right ? <T c={rightColor ?? 'sub'}>{' ' + right}</T> : null}
    </Box>
  )
}

/** 底部按键提示：<kbd>键</kbd> 说明。 */
export function Keys({ items, cols }: { items: [string, string][]; cols: number }) {
  const look = useLook()
  let used = 0
  const shown: [string, string][] = []
  for (const [k, v] of items) {
    const w = width(k) + 2 + width(v) + 2
    if (used + w > cols) break
    shown.push([k, v])
    used += w
  }
  return (
    <Box width={cols} overflow="hidden" height={1}>
      {shown.map(([k, v]) => (
        <Box key={k + v} marginRight={2}>
          <T bg="sel" c="fg" inverse={look.mono}>{` ${k} `}</T>
          <T c="dim">{` ${v}`}</T>
        </Box>
      ))}
    </Box>
  )
}
