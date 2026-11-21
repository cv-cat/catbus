import { createI18n } from 'vue-i18n'
import { LOCALES, SOURCE_LOCALE, type LocaleCode } from './locales'

/**
 * 界面多语言（AGENTS.md 7.9「多语言」）。
 * 文案在 src/locales/<语言>/<命名空间>.json，文件名就是 key 的第一段：
 * locales/zh-CN/login.json 里的 { "qrcode": { "title": "…" } }，key 是 login.qrcode.title。
 * 源语言 zh-CN 随页面加载并作为回退，其他语言切过去时才加载。
 */

export * from './locales'

// 文案是预编译后的对象（unplugin-vue-i18n），结构不在类型里，key 的存在性由 npm run i18n:check 检查
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Messages = Record<string, any>

/** 文件路径 → 命名空间：../locales/zh-CN/login.json → login */
const nsOf = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.json'.length)
const localeOf = (path: string) => path.split('/').at(-2)!

function assemble(files: Record<string, Messages>): Messages {
  const out: Messages = {}
  for (const [path, mod] of Object.entries(files)) out[nsOf(path)] = mod
  return out
}

const source = import.meta.glob<Messages>('../locales/zh-CN/*.json', { eager: true, import: 'default' })
const lazy = import.meta.glob<Messages>(['../locales/*/*.json', '!../locales/zh-CN/*.json'], { import: 'default' })

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: SOURCE_LOCALE,
  fallbackLocale: SOURCE_LOCALE,
  messages: { [SOURCE_LOCALE]: assemble(source) } as Record<string, Messages>,
  // 缺 key 时回退到中文即可，开发时用 npm run i18n:check 找缺的 key，控制台不刷警告
  missingWarn: false,
  fallbackWarn: false,
})

const loaded = new Set<LocaleCode>([SOURCE_LOCALE])

async function load(code: LocaleCode) {
  if (loaded.has(code)) return
  const files: Record<string, Messages> = {}
  await Promise.all(
    Object.entries(lazy)
      .filter(([path]) => localeOf(path) === code)
      .map(async ([path, imp]) => (files[path] = await imp())),
  )
  i18n.global.setLocaleMessage(code, assemble(files))
  loaded.add(code)
}

/** legacy: false 时 global.locale 是 ref（类型推断成了 string，这里收窄一下） */
const localeRef = () => i18n.global.locale as unknown as { value: LocaleCode }

let pending: LocaleCode | null = null

/** 切换界面语言：先加载文案再切，连续切换时只采用最后一次 */
export async function setLocale(code: LocaleCode): Promise<void> {
  pending = code
  try {
    await load(code)
  } catch {
    // 文案没加载到（网络断了、旧缓存）：留在当前语言
    return
  }
  if (pending !== code) return
  localeRef().value = code
  document.documentElement.lang = code
}

/** 当前生效的语言（响应式：在 computed / 模板里读到时随切换更新） */
export const currentLocale = (): LocaleCode => localeRef().value

/** 组件外用的翻译函数：只在函数里调用，不在模块顶层求值（否则切换语言不会更新） */
export const t: (typeof i18n.global)['t'] = ((...args: unknown[]) =>
  (i18n.global.t as (...a: unknown[]) => string)(...args)) as never

export const localeName = (code: LocaleCode) => LOCALES.find((l) => l.code === code)?.name ?? code
