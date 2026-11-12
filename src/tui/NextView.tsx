import type { Next } from './follow.js'
import { cliFromInvocation } from './model.js'
import { Keys, Pane, Row, T, useGlyphs } from './ui.js'
import { clip, width } from './text.js'
import { Box } from 'ink'

// “接着做什么”（AGENTS 4.13）：选中一项后，列出可以拿它当参数的命令，参数已填好。

export function NextView({ steps, selected, title, cols, rows }: { steps: Next[]; selected: number; title: string; cols: number; rows: number }) {
  const g = useGlyphs()
  const w = Math.min(cols, 86)
  const inner = w - 2
  const picked = steps[selected]
  return (
    <Box width={cols} justifyContent="center">
      <Pane title={`接着做 ${g.sep} ${clip(title, w - 16, g.more)}`} cols={w} rows={Math.min(rows, steps.length + 7)} focused>
        {steps.length === 0 ? (
          <Box paddingLeft={2} paddingTop={1}>
            <T c="dim">这一项没有可以接着做的命令。</T>
          </Box>
        ) : null}
        {steps.map((n, i) => (
          <Row
            key={n.command.key}
            cols={inner}
            selected={i === selected}
            right={`${n.command.resource} ${n.command.action}`}
            left={
              <>
                <T c={n.command.stream ? 'mauve' : 'green'}>{n.command.stream ? '~' : g.dotOn}</T> {n.label}
              </>
            }
          />
        ))}
        <Box height={1} />
        <Box paddingLeft={1}>
          <T c="dim">{'等价命令  '}</T>
          <T c="accent">{picked ? clip(cliFromInvocation(picked.platform, picked.command, picked.words, picked.given), inner - width('等价命令  ') - 2, g.more) : ' '}</T>
        </Box>
      </Pane>
    </Box>
  )
}

export function NextKeys({ cols }: { cols: number }) {
  return <Keys cols={cols} items={[['↑↓', '选择'], ['Enter', '运行'], ['c', '复制命令'], ['Esc', '返回']]} />
}
