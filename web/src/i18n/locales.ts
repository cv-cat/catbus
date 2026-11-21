/** WebUI 支持的界面语言（AGENTS.md 7.9「多语言」）。name 用该语言自己的写法，设置里直接显示 */
export const LOCALES = [
  { code: 'zh-CN', name: '简体中文' }, // i18n-ignore
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' }, // i18n-ignore
  { code: 'ko', name: '한국어' },
] as const

export type LocaleCode = (typeof LOCALES)[number]['code']
/** 设置里的取值：system 表示自动匹配 */
export type LocalePref = 'system' | LocaleCode

/** 源语言：文案以它为准，随页面一起加载，也是缺 key 时的回退 */
export const SOURCE_LOCALE: LocaleCode = 'zh-CN'
/** 自动匹配不到时用的语言 */
export const DEFAULT_LOCALE: LocaleCode = 'en'

export const isLocale = (v: unknown): v is LocaleCode => LOCALES.some((l) => l.code === v)

/** 时区 → 语言：浏览器语言匹配不到时才用 */
const TIMEZONES: Record<string, LocaleCode> = {
  'Asia/Shanghai': 'zh-CN',
  'Asia/Chongqing': 'zh-CN',
  'Asia/Chungking': 'zh-CN',
  'Asia/Harbin': 'zh-CN',
  'Asia/Urumqi': 'zh-CN',
  'Asia/Kashgar': 'zh-CN',
  'Asia/Hong_Kong': 'zh-CN',
  'Asia/Macau': 'zh-CN',
  'Asia/Taipei': 'zh-CN',
  PRC: 'zh-CN',
  'Asia/Tokyo': 'ja',
  Japan: 'ja',
  'Asia/Seoul': 'ko',
  'Asia/Pyongyang': 'ko',
  ROK: 'ko',
}

/** 一个 BCP 47 语言标签对应的界面语言：主语言相同即算匹配，zh-* 都归到 zh-CN */
export function matchLanguage(tag: string): LocaleCode | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0]
  if (!primary) return null
  if (primary === 'zh') return 'zh-CN'
  return LOCALES.find((l) => l.code.toLowerCase().split('-')[0] === primary)?.code ?? null
}

/**
 * 自动匹配界面语言：浏览器语言（按偏好顺序逐个取）→ 浏览器时区 → 英语。
 * 参数可注入，便于测试；不传时读当前浏览器。
 */
export function detectLocale(
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language],
  timeZone: string | undefined = currentTimeZone(),
): LocaleCode {
  for (const tag of languages) {
    const hit = tag && matchLanguage(tag)
    if (hit) return hit
  }
  if (timeZone && TIMEZONES[timeZone]) return TIMEZONES[timeZone]
  return DEFAULT_LOCALE
}

function currentTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** 设置值 → 实际生效的语言 */
export const resolveLocale = (pref: LocalePref): LocaleCode => (pref === 'system' ? detectLocale() : pref)
