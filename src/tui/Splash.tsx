import { Box, Text, useAnimation } from 'ink'
import { useEffect } from 'react'
import { FRAMES, SPRITE_HEIGHT, SPRITE_WIDTH, toCells, toRuns } from './mascot.js'
import { T } from './ui.js'

// 启动动画（AGENTS 4.13）：猫巴士从左边开进来，停在中央，打出 catbus。共 SPLASH_MS 毫秒，任意键跳过。

export const SPLASH_MS = 900
const TICK = 60
const CELLS = FRAMES.map((f) => toRuns(toCells(f)))
const TITLE = 'catbus'
const SUBTITLE = '上车，开往任何平台'

/** 车的横向位置：开始在屏幕外，ease-out 滑到中央。t 是 0..1 的进度。 */
export function carX(t: number, cols: number): number {
  const target = Math.max(0, Math.floor((cols - SPRITE_WIDTH) / 2))
  const eased = 1 - (1 - Math.min(1, t)) ** 3
  return Math.round(-SPRITE_WIDTH + (target + SPRITE_WIDTH) * eased)
}

/** 已经打出的标题字数：车到位之后（t ≥ 0.6）逐字出现。 */
export function typed(t: number): number {
  if (t < 0.6) return 0
  return Math.min(TITLE.length, Math.ceil(((t - 0.6) / 0.3) * TITLE.length))
}

export function Splash({ cols, rows, onDone }: { cols: number; rows: number; onDone: () => void }) {
  const { time, frame } = useAnimation({ interval: TICK })
  const t = Math.min(1, time / SPLASH_MS)
  useEffect(() => {
    if (time >= SPLASH_MS) onDone()
  }, [time, onDone])
  const x = carX(t, cols)
  const lines = CELLS[frame % CELLS.length]!
  const top = Math.max(0, Math.floor((rows - SPRITE_HEIGHT / 2 - 4) / 2))
  const n = typed(t)
  return (
    <Box flexDirection="column" width={cols} height={rows} paddingTop={top}>
      <Box flexDirection="column" marginLeft={Math.max(0, x)} width={Math.min(SPRITE_WIDTH, cols - Math.max(0, x))} overflow="hidden">
        {lines.map((runs, y) => (
          <Box key={y} marginLeft={x < 0 ? x : 0}>
            {runs.map((r, i) => (
              <Text key={i} color={r.fg ?? undefined} backgroundColor={r.bg ?? undefined}>
                {r.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Box width={cols} justifyContent="center" paddingTop={1}>
        <T c="accent" bold>
          {TITLE.slice(0, n)}
        </T>
        <T c="accent">{n < TITLE.length && n > 0 ? '▌' : ' '}</T>
      </Box>
      <Box width={cols} justifyContent="center">
        <T c="dim">{n >= TITLE.length ? SUBTITLE : ' '}</T>
      </Box>
    </Box>
  )
}
