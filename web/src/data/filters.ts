import { t } from '@/i18n'

/**
 * 一个选项：label 是 getter，按当前界面语言取（locales/<语言>/filters.json），
 * 在模板 / computed 里读才会随语言切换。value 保留字面量类型。
 */
function opt<const V extends string>(value: V, key: string): { readonly value: V; readonly label: string } {
  return {
    value,
    get label() {
      return t(key)
    },
  }
}

/** 发现页的排序、类型取值（AGENTS.md 4.9 的标准取值里 WebUI 用到的那几个） */
export const SORTS = [
  opt('general', 'filters.sort.general'),
  opt('latest', 'filters.sort.latest'),
  opt('popular', 'filters.sort.popular'),
  opt('comments', 'filters.sort.comments'),
] as const

/**
 * 平台私有的字段排序（`--order-by`，目前只有 M-Team）：声明了它的平台用这一组代替 SORTS。
 * 页面状态和地址里仍放在 sort 里：字段名表示降序，加 `_asc` 后缀表示升序；`general` 是站点默认。
 */
export const ORDERS = [
  opt('general', 'filters.order.general'),
  opt('date', 'filters.order.date'),
  opt('size', 'filters.order.size'),
  opt('seeders', 'filters.order.seeders'),
  opt('leechers', 'filters.order.leechers'),
  opt('name', 'filters.order.name'),
] as const

/** sort 取值是字段排序时拆成 {field, asc}，否则（标准排序、general）返回 null */
export function parseOrder(sort: string | null | undefined): { field: string; asc: boolean } | null {
  if (!sort) return null
  const asc = sort.endsWith('_asc')
  const field = asc ? sort.slice(0, -4) : sort
  return field !== 'general' && ORDERS.some((o) => o.value === field) ? { field, asc } : null
}

export const TYPES = [
  opt('all', 'filters.type.all'),
  opt('video', 'filters.type.video'),
  opt('image', 'filters.type.image'),
] as const

/** 推荐流的种类（`feed list --kind`），只在没有关键词时出现；recommend 是默认，不带选项 */
export const KINDS = [
  opt('recommend', 'filters.kind.recommend'),
  opt('hot', 'filters.kind.hot'),
  opt('following', 'filters.kind.following'),
] as const

/** 搜索的时间范围（`item search --time`），只在有关键词时出现；all 是默认，不带选项 */
export const TIMES = [
  opt('all', 'filters.time.all'),
  opt('day', 'filters.time.day'),
  opt('week', 'filters.time.week'),
  opt('month', 'filters.time.month'),
  opt('half_year', 'filters.time.half_year'),
  opt('year', 'filters.time.year'),
] as const

export type SortValue = (typeof SORTS)[number]['value']
export type TypeValue = (typeof TYPES)[number]['value']
