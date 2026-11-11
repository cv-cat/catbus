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
  name: string
  item: string
  logo: string
  /** WebUI 默认用 item search；没有搜索的平台用 feed list */
  mode: 'search' | 'feed'
}

// 顺序与 README 的平台图一致；平台 id 用规范 id（AGENTS.md 4.2）
export const PLATFORMS: PlatformMeta[] = [
  ['xhs', '小红书', '笔记'],
  ['douyin', '抖音', '作品'],
  ['bilibili', '哔哩哔哩', '稿件'],
  ['tiktok', 'TikTok', '视频'],
  ['kuaishou', '快手', '作品'],
  ['weibo', '微博', '微博'],
  ['x', 'X', '推文'],
  ['youtube', 'YouTube', '视频'],
  ['xianyu', '闲鱼', '闲置'],
  ['taobao', '淘宝', '商品'],
  ['jd', '京东', '商品'],
  ['maoyan', '猫眼演出', '演出', 'feed'],
  ['mteam', 'M-Team', '资源'],
].map(([id, name, item, mode]) => ({
  id: id!,
  name: name!,
  item: item!,
  logo: logo(id!),
  mode: (mode as PlatformMeta['mode']) ?? 'search',
}))

export const platformById = (id: string) => PLATFORMS.find((p) => p.id === id)
