import type { MineTab } from '@/api/mine'
import { t } from '@/i18n'

/**
 * 「我的」页标签的叫法按平台（AGENTS.md 7.9「各平台的「我的」页」，设计稿 Z9）：
 * 小红书的作品叫笔记、B 站叫投稿；抖音、快手、YouTube 的赞过叫喜欢；YouTube 的合集叫播放列表。
 */
const OVERRIDE: Record<string, Partial<Record<MineTab, string>>> = {
  xhs: { works: 'mine.tab.notes' },
  bilibili: { works: 'mine.tab.posts' },
  douyin: { likes: 'mine.tab.loved' },
  kuaishou: { likes: 'mine.tab.loved' },
  youtube: { likes: 'mine.tab.loved', series: 'mine.tab.playlists' },
}
export function mineTabLabel(platform: string, tab: MineTab): string {
  return t(OVERRIDE[platform]?.[tab] ?? `mine.tab.${tab}`)
}
