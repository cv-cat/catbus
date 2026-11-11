/** 发现页的排序、类型取值（AGENTS.md 4.9 的标准取值里 WebUI 用到的那几个） */
export const SORTS = [
  { value: 'general', label: '综合' },
  { value: 'latest', label: '最新' },
  { value: 'popular', label: '最热' },
  { value: 'comments', label: '评论最多' },
] as const

export const TYPES = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图文' },
] as const

export type SortValue = (typeof SORTS)[number]['value']
export type TypeValue = (typeof TYPES)[number]['value']
