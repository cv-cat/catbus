import { computed } from 'vue'
import { t } from '@/i18n'
import { useDiscoverStore } from '@/stores/discover'
import { useLiveStore } from '@/stores/live'
import { useMineStore } from '@/stores/mine'
import { useInboxStore } from '@/stores/inbox'

export type PageSection = 'discover' | 'me' | 'live' | 'inbox'

/**
 * 手机上标题下面的「发现 / 我的 / 直播 / 收件箱」分段（AGENTS.md 7.9「各平台的「我的」页」「直播弹幕」「通知与私信」）：
 * 按平台的能力列出，选了就切过去。
 */
export function usePageSections(platform: () => string, current: () => PageSection) {
  const d = useDiscoverStore()
  const mine = useMineStore()
  const live = useLiveStore()
  const inbox = useInboxStore()
  const options = computed(() => {
    const p = platform()
    const list: { value: PageSection; label: string }[] = [{ value: 'discover', label: t('mteam.nav.discover') }]
    if (mine.hasMine(p)) list.push({ value: 'me', label: t('mteam.nav.me') })
    if (live.hasLive(p)) list.push({ value: 'live', label: t('live.nav') })
    if (inbox.hasInbox(p)) list.push({ value: 'inbox', label: t('inbox.nav') })
    return list
  })
  const model = computed({
    get: current,
    set: (v: PageSection) => {
      if (v === current()) return
      const p = platform()
      if (v === 'me') mine.open(p)
      else if (v === 'live') live.open(p)
      else if (v === 'inbox') inbox.open(p)
      else {
        mine.leave()
        live.leave()
        inbox.leave()
        d.search()
      }
    },
  })
  return { options, model, show: computed(() => options.value.length > 1) }
}
