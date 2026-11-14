import { t } from '@/i18n'

const logos = import.meta.glob<string>('../../../scripts/assets/logos/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
})

function logo(id: string): string {
  return logos[`../../../scripts/assets/logos/${id}.jpg`] ?? ''
}

export interface PlatformMeta {
  id: string
  /** 平台名，按当前界面语言（platforms.<id>.name）；是 getter，在模板 / computed 里读才会随语言切换 */
  readonly name: string
  /** 平台对 item 的叫法（platforms.<id>.item），同上 */
  readonly item: string
  logo: string
  /** WebUI 默认用 item search；没有搜索的平台用 feed list */
  mode: 'search' | 'feed'
}

// 顺序与 README 的平台图一致；平台 id 用规范 id（AGENTS.md 4.2）；名字在 locales/<语言>/platforms.json
export const PLATFORMS: PlatformMeta[] = (
  [
    ['xhs'],
    ['douyin'],
    ['bilibili'],
    ['tiktok'],
    ['kuaishou'],
    ['weibo'],
    ['x'],
    ['youtube'],
    ['xianyu'],
    ['taobao'],
    ['jd'],
    ['maoyan', 'feed'],
    ['mteam'],
  ] as const
).map(([id, mode]) => ({
  id,
  get name() {
    return t(`platforms.${id}.name`)
  },
  get item() {
    return t(`platforms.${id}.item`)
  },
  logo: logo(id),
  mode: (mode as PlatformMeta['mode'] | undefined) ?? 'search',
}))

export const platformById = (id: string) => PLATFORMS.find((p) => p.id === id)

/**
 * 12306（AGENTS.md 7.9「12306 查询页」）：放在渠道列表最后、单独一页的车票查询，不是内容平台，
 * 所以不在 PLATFORMS 里（不进发现页、聚合、筛选和渠道缓存）。名字同样按语言取（platforms.12306.name）。
 */
export const RAIL: PlatformMeta = {
  id: '12306',
  get name() {
    return t('platforms.12306.name')
  },
  get item() {
    return t('platforms.12306.item')
  },
  logo: logo('12306'),
  mode: 'search',
}
