import { call } from './client'
import type { BonusRate, BonusRecord, Category, Envelope, Exam, Item, SeedStats } from './types'
import { isDemo } from '@/stores/source'
import { mockBonusHistory, mockBonusRate, mockCategories, mockCollects, mockExams, mockSeedList, mockSeedStats } from './mock'

/**
 * M-Team「我的」页和分类菜单的只读命令（AGENTS.md 7.9「M-Team「我的」页与筛选」），bridge 只对平台 mteam 放行。
 * 都用 M-Team 本页浏览用的第一个账号（-a）；演示模式用 mock.ts 的演示数据。
 */
export type SeedStatus = 'seeding' | 'leeching' | 'completed' | 'incomplete' | 'uploaded'
export const SEED_STATUSES: readonly SeedStatus[] = ['seeding', 'leeching', 'completed', 'incomplete', 'uploaded']
export type MteamMode = 'normal' | 'movie' | 'tvshow' | 'music' | 'anime' | 'adult'
export const MTEAM_MODES: readonly MteamMode[] = ['normal', 'movie', 'tvshow', 'music', 'anime', 'adult']

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
function base(cmd: string[], account: string | null | undefined): string[] {
  const argv = ['mteam', ...cmd]
  if (account) argv.push('-a', account)
  return argv
}
function page(argv: string[], limit: number, cursor: string | null | undefined): string[] {
  argv.push('--limit', String(limit))
  if (cursor) argv.push('--cursor', cursor)
  return argv
}

export async function seedStats(account?: string | null, signal?: AbortSignal): Promise<Envelope<SeedStats>> {
  if (isDemo()) return delay(380).then(mockSeedStats)
  return call<SeedStats>(base(['seed', 'stats'], account), signal)
}

export async function bonusRate(account?: string | null, signal?: AbortSignal): Promise<Envelope<BonusRate>> {
  if (isDemo()) return delay(520).then(mockBonusRate)
  return call<BonusRate>(base(['bonus', 'get'], account), signal)
}

export async function exams(account?: string | null, signal?: AbortSignal): Promise<Envelope<Exam[]>> {
  if (isDemo()) return delay(460).then(mockExams)
  return call<Exam[]>(base(['exam', 'get'], account), signal)
}

export async function seedList(status: SeedStatus, limit: number, cursor?: string | null, account?: string | null, signal?: AbortSignal): Promise<Envelope<Item[]>> {
  if (isDemo()) return delay(600).then(() => mockSeedList(status, Number(cursor ?? 0), limit))
  const argv = base(['seed', 'list'], account)
  if (status !== 'seeding') argv.push('--status', status)
  return call<Item[]>(page(argv, limit, cursor), signal)
}

export async function bonusHistory(limit: number, cursor?: string | null, account?: string | null, signal?: AbortSignal): Promise<Envelope<BonusRecord[]>> {
  if (isDemo()) return delay(560).then(() => mockBonusHistory(Number(cursor ?? 0), limit))
  return call<BonusRecord[]>(page(base(['bonus', 'history'], account), limit, cursor), signal)
}

export async function collects(mode: MteamMode, limit: number, cursor?: string | null, account?: string | null, signal?: AbortSignal): Promise<Envelope<Item[]>> {
  if (isDemo()) return delay(420).then(() => mockCollects(mode))
  const argv = base(['user', 'collects'], account)
  if (mode !== 'normal') argv.push('--mode', mode)
  return call<Item[]>(page(argv, limit, cursor), signal)
}

export async function categories(account?: string | null, signal?: AbortSignal): Promise<Envelope<Category[]>> {
  if (isDemo()) return delay(200).then(mockCategories)
  return call<Category[]>(base(['item', 'categories'], account), signal)
}
