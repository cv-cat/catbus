import type { Item } from '@/api/types'
import { bytes, since } from './format'
import { t } from '@/i18n'

/**
 * 种子（M-Team，AGENTS.md 7.9「种子卡片」「种子详情」，设计稿 K / L）：没有作者、点赞、评论，
 * 列表卡片和详情卡片都换成优惠、体积、做种 / 下载人数。
 */
const DISCOUNTS: Record<string, string> = {
  FREE: 'FREE',
  PERCENT_50: '50%',
  PERCENT_70: '30%',
  _2X_FREE: '2X FREE',
  _2X: '2X',
  _2X_PERCENT_50: '2X 50%',
}

export interface TorrentInfo {
  /** 中文名（副标题的第一段）；没有时是种子名 */
  title: string
  /** 种子名；已经当了标题时为空 */
  name: string
  discount: string | null
  free: boolean
  size: string | null
  files: number | null
  seeders: number | null
  leechers: number | null
  time: string
}

/** 副标题只有一行（`中文名 | 年份 | …`）；详情里的 text 是整段简介，不能拿来当标题 */
const oneLine = (t: string | null | undefined) => (t && !t.includes('\n') && t.length <= 300 ? t : null)

/** `list` 是搜索结果里的那一条：`item get` 之后 text 变成简介，中文名要从它取 */
export function torrentInfo(item: Item | null | undefined, list?: Item | null): TorrentInfo | null {
  if (!item || item.kind !== 'torrent') return null
  const name = item.title || ''
  const zh = (oneLine(list?.text) ?? oneLine(item.text))?.split('|')[0]?.trim() || ''
  const code = item.discount && item.discount !== 'NORMAL' ? item.discount : null
  return {
    title: zh || name || t('detail.torrent.untitled'),
    name: zh && name ? name : '',
    discount: code ? (DISCOUNTS[code] ?? code) : null,
    free: code === 'FREE' || code === '_2X_FREE',
    size: bytes(item.size),
    files: item.file_count ?? null,
    seeders: item.seeders ?? null,
    leechers: item.leechers ?? null,
    time: since(item.created_at),
  }
}
