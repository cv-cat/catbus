import { mockMineFolders, mockMineItems } from './mock/mine'
import type { Envelope, Folder, Item } from './types'
import { isDemo } from '@/stores/source'
import { call } from './client'

/**
 * 各平台的「我的」页（AGENTS.md 7.9「各平台的「我的」页」）。
 * 标签 → 命令：列表命令不带位置参数（即当前账号）；收藏夹、合集先取列表，再按 id 取内容。
 */
export type MineTab = 'works' | 'likes' | 'collects' | 'reposts' | 'folders' | 'series' | 'history'
export const MINE_TABS: readonly MineTab[] = ['works', 'likes', 'collects', 'reposts', 'folders', 'series', 'history']

const LIST_ARGV: Record<Exclude<MineTab, 'folders' | 'series'>, [string, string]> = {
  works: ['item', 'list'],
  likes: ['user', 'likes'],
  collects: ['user', 'collects'],
  reposts: ['user', 'reposts'],
  history: ['history', 'list'],
}
/** 收藏夹、合集：列表和内容两条命令 */
const NESTED: Record<'folders' | 'series', string> = { folders: 'folder', series: 'series' }
export const isNested = (tab: MineTab): tab is 'folders' | 'series' => tab === 'folders' || tab === 'series'

interface PageOpts {
  cursor?: string | null
  limit: number
  account?: string | null
  signal?: AbortSignal
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 平铺的标签（作品、赞过、收藏、转发、浏览记录）的一页 */
export async function listMine(platform: string, tab: Exclude<MineTab, 'folders' | 'series'>, o: PageOpts): Promise<Envelope<Item[]>> {
  if (isDemo()) {
    await wait(550)
    return mockMineItems(platform, tab, null, Number(o.cursor ?? 0), o.limit)
  }
  const argv = [platform, ...LIST_ARGV[tab]]
  if (o.account) argv.push('-a', o.account)
  argv.push('--limit', String(o.limit))
  if (o.cursor) argv.push('--cursor', o.cursor)
  return call<Item[]>(argv, o.signal)
}

/** 收藏夹 / 合集列表 */
export async function listFolders(platform: string, tab: 'folders' | 'series', account?: string | null, signal?: AbortSignal): Promise<Envelope<Folder[]>> {
  if (isDemo()) {
    await wait(450)
    return mockMineFolders(platform, tab)
  }
  const argv = [platform, NESTED[tab], 'list']
  if (account) argv.push('-a', account)
  return call<Folder[]>(argv, signal)
}

/** 一个收藏夹 / 合集里的内容（分页）；`<id>` 放在 `--` 之后 */
export async function listFolderItems(platform: string, tab: 'folders' | 'series', folder: string, o: PageOpts): Promise<Envelope<Item[]>> {
  if (isDemo()) {
    await wait(500)
    return mockMineItems(platform, tab, folder, Number(o.cursor ?? 0), o.limit)
  }
  const argv = [platform, NESTED[tab], 'items', folder]
  if (o.account) argv.push('-a', o.account)
  argv.push('--limit', String(o.limit))
  if (o.cursor) argv.push('--cursor', o.cursor)
  return call<Item[]>(argv, o.signal)
}

/** 当前标签的命令（复制等价命令，AGENTS.md 7.9）：收藏夹、合集没选中时是列表命令 */
export function mineArgv(platform: string, tab: MineTab, sub: string | null, account: string | null, limit: number): string[] {
  const argv = isNested(tab) ? (sub ? [platform, NESTED[tab], 'items', sub] : [platform, NESTED[tab], 'list']) : [platform, ...LIST_ARGV[tab]]
  if (account) argv.push('-a', account)
  if (!isNested(tab) || sub) argv.push('--limit', String(limit))
  return argv
}
