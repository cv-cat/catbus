import { defineStore } from 'pinia'
import { reactive, ref, watch } from 'vue'
import { PLATFORMS } from '@/data/platforms'
import { SORTS, TYPES } from '@/data/filters'

/**
 * WebUI 的设置（AGENTS.md 7.9「设置」）：只存在浏览器的 localStorage（键 `catbus.settings`），
 * 不经过 bridge。服务端设置不在这里：代理是 config.toml 的全局 proxy，经 bridge 的 /api/settings 读写。
 */

export type ThemePref = 'light' | 'dark' | 'system'
export type Density = 'compact' | 'standard' | 'cozy'
export type PageSize = 20 | 40 | 60
export type SettingsTab = 'general' | 'display' | 'experimental'

export interface Settings {
  // 通用
  /** 打开时进入的平台：'last' = 上次浏览的，否则是平台规范 id */
  startPlatform: string
  defaultSort: (typeof SORTS)[number]['value']
  defaultType: (typeof TYPES)[number]['value']
  pageSize: PageSize
  // 显示
  theme: ThemePref
  density: Density
  cardStats: boolean
  /** 像素背景和人浪动效（一个开关） */
  pixelBackground: boolean
  reduceMotion: 'system' | 'always'
  // 实验性
  rawJson: boolean
  hoverPreview: boolean
}

const KEY = 'catbus.settings'
const LEGACY_THEME_KEY = 'catbus.theme'
const VERSION = 2

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  startPlatform: 'last',
  defaultSort: 'general',
  defaultType: 'all',
  pageSize: 20,
  theme: 'light',
  density: 'standard',
  cardStats: true,
  pixelBackground: false,
  reduceMotion: 'system',
  rawJson: false,
  hoverPreview: false,
})

/** 每一项的合法性校验：读到的值不合法时回退默认值 */
const oneOf =
  <T>(list: readonly T[]) =>
  (v: unknown): v is T =>
    list.includes(v as T)
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
type Validators = { [K in keyof Settings]: (v: unknown) => v is Settings[K] }
/** 懒构建：只在读设置时才用到 SORTS / TYPES，避免模块循环引用时读到未初始化的值 */
let validators: Validators | null = null
const valid = (): Validators => (validators ??= {
  startPlatform: oneOf(['last', ...PLATFORMS.map((p) => p.id)]),
  defaultSort: oneOf(SORTS.map((o) => o.value)),
  defaultType: oneOf(TYPES.map((o) => o.value)),
  pageSize: oneOf([20, 40, 60] as const),
  theme: oneOf(['light', 'dark', 'system'] as const),
  density: oneOf(['compact', 'standard', 'cozy'] as const),
  cardStats: bool,
  pixelBackground: bool,
  reduceMotion: oneOf(['system', 'always'] as const),
  rawJson: bool,
  hoverPreview: bool,
})

function storage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** 读出设置：与默认值合并，非法值回退默认值；迁移旧键 catbus.theme */
function load(): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS }
  const ls = storage()
  let saved: Record<string, unknown> = {}
  try {
    const raw = ls?.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    if (v && typeof v === 'object' && !Array.isArray(v)) saved = v as Record<string, unknown>
  } catch {
    /* 损坏的 JSON：整份回到默认值 */
  }
  // 版本迁移：2 起像素背景、人浪默认关闭，版本 1 存下的是旧默认值，丢掉让它回到新默认
  if (saved.version === 1) {
    delete saved.pixelBackground
    delete saved.waveAnimation
  }
  for (const k of Object.keys(valid()) as (keyof Settings)[]) {
    if (valid()[k](saved[k])) (out as unknown as Record<string, unknown>)[k] = saved[k]
  }
  try {
    const legacy = ls?.getItem(LEGACY_THEME_KEY)
    if (legacy != null) {
      if (!('theme' in saved) && (legacy === 'light' || legacy === 'dark')) out.theme = legacy
      ls?.removeItem(LEGACY_THEME_KEY)
    }
  } catch {
    /* 隐私模式下不可写，忽略 */
  }
  return out
}

function save(s: Settings) {
  try {
    storage()?.setItem(KEY, JSON.stringify({ version: VERSION, ...s }))
  } catch {
    /* 隐私模式或配额已满：写失败忽略，本次会话内仍然生效 */
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = reactive<Settings>(load())
  /** 设置弹窗是否打开、当前分栏：不持久化 */
  const open = ref(false)
  const tab = ref<SettingsTab>('general')

  watch(settings, (s) => save(s), { deep: true })
  // 首次（含迁移旧主题键）也落盘一次
  save(settings)

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (valid()[key](value)) settings[key] = value
  }

  /** 恢复默认：只动 localStorage 里的这些项，不影响服务端设置 */
  function reset() {
    Object.assign(settings, DEFAULT_SETTINGS)
  }

  return {
    settings,
    open,
    tab,
    set,
    reset,
    toggle: () => (open.value = !open.value),
    show: (t?: SettingsTab) => {
      if (t) tab.value = t
      open.value = true
    },
    close: () => (open.value = false),
  }
})
