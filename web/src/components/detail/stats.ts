import { ArrowDown, ArrowUp, Files, Heart, MessageCircle, Share2, Star } from 'lucide-vue-next'
import type { Item } from '@/api/types'
import type { TorrentInfo } from '@/composables/torrent'
import { t } from '@/i18n'

/** 详情卡片底部（以及纯文字底板）的计数：种子是做种 / 下载 / 文件数，其余是点赞 / 收藏 / 评论 / 分享 */
export function detailStats(item: Item | null | undefined, torrent: TorrentInfo | null) {
  if (torrent) {
    return [
      { key: 'seeders', label: t('detail.stat.seeders'), icon: ArrowUp, v: torrent.seeders },
      { key: 'leechers', label: t('detail.stat.leechers'), icon: ArrowDown, v: torrent.leechers },
      { key: 'files', label: t('detail.stat.files'), icon: Files, v: torrent.files },
    ]
  }
  const s = item?.stats
  return [
    { key: 'likes', label: t('detail.stat.likes'), icon: Heart, v: s?.likes },
    { key: 'collects', label: t('detail.stat.collects'), icon: Star, v: s?.collects },
    { key: 'comments', label: t('detail.stat.comments'), icon: MessageCircle, v: s?.comments },
    { key: 'shares', label: t('detail.stat.shares'), icon: Share2, v: s?.shares },
  ]
}
