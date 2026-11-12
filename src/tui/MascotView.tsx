import { Box, Text, useAnimation } from 'ink'
import { useMemo } from 'react'
import { FRAMES, SPRITE_WIDTH, TEXT_MASCOT, toCells, toRuns } from './mascot.js'
import { useLook } from './ui.js'

// 像素吉祥物（AGENTS 4.13）。动画只在 `animate` 时跑，且尊重 NO_COLOR 和 ASCII 模式（改显示文字版）。

const CELLS = FRAMES.map((f) => toRuns(toCells(f)))
export const MASCOT_ROWS = CELLS[0]!.length
export const MASCOT_COLS = SPRITE_WIDTH

export function Mascot({ animate = true }: { animate?: boolean }) {
  const look = useLook()
  const { frame } = useAnimation({ interval: 180, isActive: animate && look.animate && !look.mono && !look.ascii })
  const lines = useMemo(() => CELLS[frame % CELLS.length]!, [frame])
  if (look.mono || look.ascii) {
    return (
      <Box flexDirection="column">
        {TEXT_MASCOT.map((l) => (
          <Text key={l}>{l}</Text>
        ))}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" width={MASCOT_COLS}>
      {lines.map((runs, y) => (
        <Box key={y}>
          {runs.map((r, i) => (
            <Text key={i} color={r.fg ?? undefined} backgroundColor={r.bg ?? undefined}>
              {r.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}
