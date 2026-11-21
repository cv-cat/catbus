import type { Category } from '@/api/types'
import type { MteamMode } from '@/api/mteam'

/**
 * M-Team 的分区与分类（AGENTS.md 7.9「M-Team「我的」页与筛选」）。
 * 分类表（`item categories`）不标分区，按大类 ID 归到分区；2026-11-14 实测：大类 ID 本身（如 100）返回空列表，
 * 只能按子类筛选；`--mode movie --category 419` 只在对应分区里有结果。
 */
export const MODE_PARENTS: Record<MteamMode, readonly string[]> = {
  normal: ['100', '105', '110', '444', '447', '449', '450'],
  movie: ['100'],
  tvshow: ['105'],
  music: ['110'],
  anime: ['449'],
  adult: ['115', '120', '445', '446'],
}

/** 分区的文案 key（filters.mteam.mode.<值>） */
export const modeKey = (m: MteamMode) => `filters.mteam.mode.${m}`

/** 某个分区能选的分类：按大类分组（大类在前、子类跟在后面），只列有子类的大类 */
export function groupedCategories(all: readonly Category[], mode: MteamMode): { parent: Category; children: Category[] }[] {
  const out: { parent: Category; children: Category[] }[] = []
  for (const pid of MODE_PARENTS[mode]) {
    const parent = all.find((c) => c.id === pid && c.parent_id == null)
    const children = all.filter((c) => c.parent_id === pid).sort((a, b) => Number(a.id) - Number(b.id))
    if (parent && children.length) out.push({ parent, children })
  }
  return out
}

/** 分类是不是这个分区的子类（地址里带了别的分区的分类时丢掉） */
export function categoryIn(all: readonly Category[], mode: MteamMode, id: string): boolean {
  const c = all.find((x) => x.id === id)
  return !!c?.parent_id && MODE_PARENTS[mode].includes(c.parent_id)
}

/** 考核的字节量：GiB / TiB（站点的写法） */
export function formatGiB(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let v = Math.abs(bytes)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${bytes < 0 ? '-' : ''}${i ? v.toFixed(2) : Math.round(v)} ${units[i]}`
}

/** `seed list` 的 text：「上传：…\n下载：…\n分享率：…\n<中文名 | …>」，解析不出来时 mine 为 null */
export interface SeedText {
  mine: { up: string; down: string; ratio: string } | null
  /** 中文名：分享率之后的第一行、`|` 之前；没有时为 null */
  name: string | null
}
export function parseSeedText(text: string | null | undefined): SeedText {
  const lines = (text ?? '').split('\n')
  const grab = (k: string) => lines.find((l) => l.startsWith(`${k}：`))?.slice(k.length + 1).trim() ?? null
  const up = grab('上传') // i18n-ignore CLI 输出的字段名
  const down = grab('下载') // i18n-ignore
  const ratio = grab('分享率') // i18n-ignore
  const mine = up != null && down != null && ratio != null ? { up, down, ratio } : null
  const rest = mine ? lines.slice(lines.findIndex((l) => l.startsWith('分享率：')) + 1) : lines // i18n-ignore
  const first = rest.find((l) => l.trim())
  const name = first ? first.split('|')[0]!.split('/')[0]!.trim() || null : null
  return { mine, name }
}

/** 分享率小于 1（PT 站的习惯：标红） */
export function ratioLow(ratio: string): boolean {
  const n = Number(ratio)
  return Number.isFinite(n) && n < 1
}
