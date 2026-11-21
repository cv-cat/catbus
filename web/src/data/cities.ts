import { t } from '@/i18n'

/**
 * 猫眼演出的城市（AGENTS.md 7.9「猫眼演出的城市」）。城市名是平台数据，不翻译；
 * 只有默认城市（北京）在非中文界面显示译名（maoyan.city.default）。
 * 热门城市前端写死；最近选择存在 localStorage（照 catbus.lastPlatform 的方式单独一个键，不是设置项）。
 */

/** 不带 --city 时 CLI 用的城市；地址栏里等于它时省略 */
export const DEFAULT_CITY = '北京' // i18n-ignore

// i18n-ignore：城市名是平台数据
export const HOT_CITIES = ['北京', '上海', '广州', '深圳', '成都', '杭州', '南京', '武汉', '西安', '重庆', '天津', '苏州'] as const // i18n-ignore

/** 城市名、演出城市 ID：与 bridge 的校验一致（1–32 个字母、数字、汉字和空格、`·`、`-`） */
export const CITY = /^[\p{L}\p{N}][\p{L}\p{N} ·-]{0,31}$/u

/** 显示用的城市名：默认城市换成当前语言的译名，其余原样 */
export const cityLabel = (name: string) => (name === DEFAULT_CITY ? t('maoyan.city.default') : name)
/** cityLabel 的反向：显示名 → 城市名（请求、比较用） */
export const cityRaw = (label: string) => (label === cityLabel(DEFAULT_CITY) ? DEFAULT_CITY : label)

/** 页面上显示的城市：空串表示默认（北京），默认城市显示译名 */
export const cityName = (city: string) => cityLabel(city || DEFAULT_CITY)

const RECENT_KEY = 'catbus.maoyanCities'
const RECENT_MAX = 3

export function readRecentCities(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && CITY.test(s)).slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

/** 记进最近选择（最近的在前，去重，最多 3 个）；返回新的列表 */
export function rememberCity(name: string): string[] {
  const next = [name, ...readRecentCities().filter((c) => c !== name)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式不可写：只是下次不记得，忽略 */
  }
  return next
}
