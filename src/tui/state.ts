import type { Command, Platform } from '../core/registry.js'
import type { RunResult } from './run.js'

// 界面状态与按键的纯函数部分（AGENTS 4.13）：不含 React 和 IO，测试直接调。

export type Pane = 'platforms' | 'commands' | 'form'

export interface Nav {
  pane: Pane
  platform: number
  /** 命令栏里的行下标（分组标题和命令混排）。 */
  row: number
  /** 展开的 resource。 */
  open: Set<string>
  /** 表单里当前字段的下标。 */
  field: number
}

export type Row = { type: 'group'; resource: string; total: number; ready: number; open: boolean } | { type: 'command'; command: Command }

export function rowsOf(groups: { resource: string; commands: Command[] }[], open: ReadonlySet<string>, ready: (c: Command) => boolean): Row[] {
  const out: Row[] = []
  for (const g of groups) {
    out.push({ type: 'group', resource: g.resource, total: g.commands.length, ready: g.commands.filter(ready).length, open: open.has(g.resource) })
    if (open.has(g.resource)) for (const command of g.commands) out.push({ type: 'command', command })
  }
  return out
}

/** 命令栏能显示几行：多于一屏时留一行给“x-y / z”。 */
export function commandVisible(total: number, height: number): number {
  const room = Math.max(1, height - 2)
  return total > room ? Math.max(1, room - 1) : room
}

export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

/** 让选中行始终在可见窗口里：返回新的窗口起点。 */
export function scrollTo(selected: number, top: number, height: number, total: number): number {
  if (total <= height) return 0
  if (selected < top) return selected
  if (selected >= top + height) return selected - height + 1
  return clamp(top, 0, total - height)
}

// ---- 结果 ----

export interface Results {
  platform: Platform
  command: Command
  line: string
  words: string[]
  given: Record<string, unknown>
  items: unknown[]
  single: boolean
  page: RunResult['page']
  account: string | null
}

export type Phase =
  | { type: 'browse' }
  | { type: 'running'; label: string }
  | { type: 'results'; results: Results; selected: number; top: number; loadingMore: boolean }
  | { type: 'error'; code: string; message: string; hint: string | null; exit: number }

/** 把一次运行的结果摊成列表：列表命令是数组，其余是单个对象（`single`）。 */
export function toItems(data: unknown): { items: unknown[]; single: boolean } {
  if (Array.isArray(data)) return { items: data, single: false }
  return { items: data == null ? [] : [data], single: true }
}

// ---- 窄终端 ----

export const MIN_COLS = 80
export const MIN_ROWS = 24
export const WIDE_COLS = 110

export type Layout = 'wide' | 'narrow' | 'tiny'

/** ≥110 列三栏；80–109 列两栏（平台与命令合并）；再窄给出提示。 */
export function layoutFor(cols: number, rows: number): Layout {
  if (cols < MIN_COLS || rows < MIN_ROWS) return 'tiny'
  return cols >= WIDE_COLS ? 'wide' : 'narrow'
}

// ---- 命令面板 ----

export interface PaletteEntry {
  platform: Platform
  command: Command
  text: string
}

/** 模糊匹配：把查询按空格拆成词，每个词都要在“平台 id、平台名、别名、resource、action、说明”里出现。 */
export function filterPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return entries
  return entries.filter((e) => words.every((w) => e.text.includes(w)))
}

export function paletteText(platform: Platform, command: Command): string {
  return [platform.id, platform.name, ...platform.aliases, command.resource, command.action, command.summary].join(' ').toLowerCase()
}
