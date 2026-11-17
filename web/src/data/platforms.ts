import { t } from '@/i18n'

// 只取用得到的图标（scripts/assets/logos/ 里还有 README 用的其他平台）。不内联成 base64：
// 单独的图片文件带内容哈希、长缓存，不占首屏 JS
const logos = import.meta.glob<string>('../../../scripts/assets/logos/{xhs,douyin,bilibili,tiktok,kuaishou,weibo,x,youtube,xianyu,taobao,jd,maoyan,mteam,12306}.jpg', {
  eager: true,
  query: '?url&no-inline',
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

/**
 * 本地收藏（AGENTS.md 7.9「本地收藏与稍后看」）：侧栏 12306 下面一行，不是平台。图标是红底白色书签。
 */
const LOCAL_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#E8414F"/><path d="M11 8.5h10a1 1 0 0 1 1 1V24l-6-3.6-6 3.6V9.5a1 1 0 0 1 1-1z" fill="#fff"/></svg>',
  )
export const LOCAL: PlatformMeta = {
  id: 'local',
  get name() {
    return t('local.title')
  },
  get item() {
    return t('local.title')
  },
  logo: LOCAL_LOGO,
  mode: 'search',
}

/** 订阅（AGENTS.md 7.9「订阅」）：侧栏 12306 下面一行，铃铛图标；不是平台，只是一页 */
const SUBS_LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#232838"/><path d="M16 7.5a5.5 5.5 0 0 0-5.5 5.5v3.6L9 19.5v1h14v-1l-1.5-2.9V13A5.5 5.5 0 0 0 16 7.5z" fill="#fff"/><path d="M13.6 22.5a2.5 2.5 0 0 0 4.8 0z" fill="#E8414F"/></svg>',
  )
export const SUBS: PlatformMeta = {
  id: 'subs',
  get name() {
    return t('subs.title')
  },
  get item() {
    return t('subs.title')
  },
  logo: SUBS_LOGO,
  mode: 'search',
}
