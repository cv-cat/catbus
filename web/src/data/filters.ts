/** 发现页的排序、类型取值（AGENTS.md 4.9 的标准取值里 WebUI 用到的那几个） */
export const SORTS = [
  { value: 'general', label: '综合' },
  { value: 'latest', label: '最新' },
  { value: 'popular', label: '最热' },
  { value: 'comments', label: '评论最多' },
] as const

/**
 * 平台私有的字段排序（`--order-by`，目前只有 M-Team）：声明了它的平台用这一组代替 SORTS。
 * 页面状态和地址里仍放在 sort 里：字段名表示降序，加 `_asc` 后缀表示升序；`general` 是站点默认。
 */
export const ORDERS = [
  { value: 'general', label: '默认' },
  { value: 'date', label: '发布时间' },
  { value: 'size', label: '体积' },
  { value: 'seeders', label: '做种' },
  { value: 'leechers', label: '下载' },
  { value: 'name', label: '名称' },
] as const

/** sort 取值是字段排序时拆成 {field, asc}，否则（标准排序、general）返回 null */
export function parseOrder(sort: string | null | undefined): { field: string; asc: boolean } | null {
  if (!sort) return null
  const asc = sort.endsWith('_asc')
  const field = asc ? sort.slice(0, -4) : sort
  return field !== 'general' && ORDERS.some((o) => o.value === field) ? { field, asc } : null
}

export const TYPES = [
  { value: 'all', label: '全部' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图文' },
] as const

/** 推荐流的种类（`feed list --kind`），只在没有关键词时出现；recommend 是默认，不带选项 */
export const KINDS = [
  { value: 'recommend', label: '推荐' },
  { value: 'hot', label: '热门' },
  { value: 'following', label: '关注' },
] as const

/** 搜索的时间范围（`item search --time`），只在有关键词时出现；all 是默认，不带选项 */
export const TIMES = [
  { value: 'all', label: '不限' },
  { value: 'day', label: '一天内' },
  { value: 'week', label: '一周内' },
  { value: 'month', label: '一月内' },
  { value: 'half_year', label: '半年内' },
  { value: 'year', label: '一年内' },
] as const

export type SortValue = (typeof SORTS)[number]['value']
export type TypeValue = (typeof TYPES)[number]['value']
