import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import './styles/base.css'
import App from './App.vue'
import { tip } from './directives/tip'
import { i18n, resolveLocale, setLocale } from './i18n'
import { useSettingsStore } from './stores/settings'

const app = createApp(App).use(createPinia()).use(i18n).directive('tip', tip)

// 界面语言跟着设置走：system 时按浏览器语言、时区匹配，浏览器语言变化时实时跟随（AGENTS.md 7.9「多语言」）
const settings = useSettingsStore().settings
const apply = () => setLocale(resolveLocale(settings.locale))
watch(() => settings.locale, apply)
addEventListener('languagechange', () => settings.locale === 'system' && apply())

// 先加载好当前语言的文案再挂载，避免先闪一下中文
apply().finally(() => app.mount('#app'))
