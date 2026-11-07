import { Box, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'
import type { CatbusError } from '../core/errors.js'
import { toCatbusError } from '../core/errors.js'
import type { Command, Platform } from '../core/registry.js'
import { copyText } from './clipboard.js'
import { cliFromInvocation } from './model.js'
import { ListenKeys, ListenView, type ListenState } from './ListenView.js'
import { type ListenHandle, type Line, EVENT_TYPES, pushLine, startListen, toLine } from './listen.js'
import { type LogBuffer, bufferLogger } from './logs.js'
import { T, useGlyphs, useLook } from './ui.js'

// 监听屏（AGENTS 4.13）：自己管连接的生命周期，退出（Esc）就停止，和 CLI 的 Ctrl-C 同一条路径。

const INITIAL = (endsAt: number | null): ListenState => ({
  lines: [],
  hidden: new Set(),
  paused: false,
  pausedAt: 0,
  total: 0,
  stamps: [],
  endsAt,
  startedAt: Date.now(),
  error: null,
  ended: false,
  scroll: 0,
})

export function ListenScreen({
  platform,
  command,
  words,
  given,
  logs,
  cols,
  rows,
  onExit,
  onError,
}: {
  platform: Platform
  command: Command
  words: string[]
  given: Record<string, unknown>
  logs: LogBuffer
  cols: number
  rows: number
  onExit: () => void
  /** 启动前的错误（未登录、参数不对）：交给上层显示，和普通命令的错误页一样。 */
  onError: (e: CatbusError) => void
}) {
  const g = useGlyphs()
  const look = useLook()
  const [state, setState] = useState<ListenState>(() => INITIAL(null))
  const [now, setNow] = useState(Date.now())
  const [spin, setSpin] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const handle = useRef<ListenHandle | null>(null)
  const seq = useRef(0)
  // 事件进来得很快，攒一批再更新界面，避免每条都重绘整屏（Windows 控制台上尤其明显）
  const pending = useRef<Line[]>([])
  const paused = useRef(false)
  const [run, setRun] = useState(0)

  useEffect(() => {
    paused.current = state.paused
  }, [state.paused])

  useEffect(() => {
    let alive = true
    seq.current = 0
    pending.current = []
    setState(INITIAL(null))
    ;(async () => {
      try {
        const h = await startListen({ platform, command, words, given, log: bufferLogger(logs) }, (value) => {
          pending.current.push(toLine(value, ++seq.current, new Date()))
        })
        if (!alive) {
          h.stop()
          return
        }
        handle.current = h
        setState((s) => ({ ...s, endsAt: h.endsAt, startedAt: Date.now() }))
        const { error } = await h.done
        if (alive) setState((s) => ({ ...s, ended: true, error }))
      } catch (err) {
        if (alive) onError(toCatbusError(err))
      }
    })()
    return () => {
      alive = false
      handle.current?.stop()
      handle.current = null
    }
    // 只在“重新监听”时重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  // 刷新批次：每 150ms 把攒下的事件并进去（暂停时照常收，只是不滚动）
  useEffect(() => {
    const t = setInterval(() => {
      const batch = pending.current
      if (batch.length === 0) return
      pending.current = []
      const stamp = Date.now()
      setState((s) => {
        let lines = s.lines
        for (const l of batch) lines = pushLine(lines, l)
        return { ...s, lines, total: s.total + batch.length, stamps: [...s.stamps.filter((x) => stamp - x < 6 * 60_000), ...batch.map(() => stamp)] }
      })
    }, 150)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now())
      setSpin((n) => n + 1)
    }, look.animate ? 250 : 1000)
    return () => clearInterval(t)
  }, [look.animate])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 3000)
    return () => clearTimeout(t)
  }, [note])

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      handle.current?.stop()
      onExit()
      return
    }
    if (state.ended && input === 'r') {
      setRun((n) => n + 1)
      return
    }
    if (input === ' ') {
      setState((s) => ({ ...s, paused: !s.paused, pausedAt: s.lines.at(-1)?.seq ?? 0, scroll: 0 }))
      return
    }
    if (input === 'c') {
      void copyText(cliFromInvocation(platform, command, words, given)).then((m) => setNote(m ? '已复制命令' : '没能写入剪贴板'))
      return
    }
    const idx = '12345'.indexOf(input)
    if (idx >= 0 && input !== '') {
      const type = EVENT_TYPES[idx]!
      setState((s) => {
        const hidden = new Set(s.hidden)
        hidden.has(type) ? hidden.delete(type) : hidden.add(type)
        return { ...s, hidden }
      })
      return
    }
    if (key.upArrow || input === 'k') {
      setState((s) => ({ ...s, paused: true, pausedAt: s.paused ? s.pausedAt : (s.lines.at(-1)?.seq ?? 0), scroll: Math.min(Math.max(0, s.lines.length - 1), s.scroll + 1) }))
    } else if (key.downArrow || input === 'j') {
      setState((s) => ({ ...s, scroll: Math.max(0, s.scroll - 1) }))
    } else if (key.pageUp) {
      setState((s) => ({ ...s, paused: true, pausedAt: s.paused ? s.pausedAt : (s.lines.at(-1)?.seq ?? 0), scroll: Math.min(Math.max(0, s.lines.length - 1), s.scroll + 10) }))
    } else if (key.pageDown) {
      setState((s) => ({ ...s, scroll: Math.max(0, s.scroll - 10) }))
    }
  })

  const view: ListenState = state.paused ? state : { ...state, scroll: 0 }
  const title = `${platform.name} ${g.sep} ${command.resource} ${g.sep} ${command.action}`
  return (
    <Box flexDirection="column" width={cols}>
      <ListenView platform={platform} title={title} state={view} now={now} cols={cols} rows={rows - 2} spin={g.spin[spin % g.spin.length]!} />
      <Box width={cols} height={1} paddingLeft={1} overflow="hidden">
        <T c="dim">{'等价命令  '}</T>
        <T c="accent">{cliFromInvocation(platform, command, words, given)}</T>
      </Box>
      <Box width={cols} height={1} paddingLeft={1} overflow="hidden">
        {note ? <T c="green">{note}</T> : <ListenKeys cols={cols - 2} ended={state.ended} />}
      </Box>
    </Box>
  )
}
