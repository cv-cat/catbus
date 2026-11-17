<script setup lang="ts">
import { computed } from 'vue'
import { History } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import AppSelect, { type SelectOption } from '@/components/AppSelect.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { PLATFORMS } from '@/data/platforms'
import { SORTS, TYPES } from '@/data/filters'
import { LOCALES, detectLocale, localeName, type LocalePref } from '@/i18n'
import { useSettingsStore, type PageSize } from '@/stores/settings'

const { settings: s } = useSettingsStore()
const { t } = useI18n()

/** 语言：自动（括号里是自动匹配到的语言）+ 各语言自己的写法 */
const localeOptions = computed<SelectOption<LocalePref>[]>(() => [
  { value: 'system', label: t('settings.general.language.auto', { name: localeName(detectLocale()) }) },
  ...LOCALES.map((l) => ({ value: l.code, label: l.name })),
])
/** 启动平台：「上次浏览的」与各平台之间画分隔线，平台带 logo */
const startOptions = computed<SelectOption<string>[]>(() => [
  { value: 'last', label: t('settings.general.start.last'), icon: History, divider: true },
  ...PLATFORMS.map((p) => ({ value: p.id, label: p.name, logo: p.logo })),
])
/** 瀑布流的键盘操作（MasonryGrid.vue） */
const KEYS = [
  { id: 'next', keys: ['j', '→'] },
  { id: 'prev', keys: ['k', '←'] },
  { id: 'open', keys: ['Enter', 'o'] },
  { id: 'select', keys: ['x'] },
  { id: 'later', keys: ['b'] },
  { id: 'search', keys: ['/'] },
  { id: 'cancel', keys: ['Esc'] },
] as const
const PAGE_SIZES = [
  { value: '20', label: '20' },
  { value: '40', label: '40' },
  { value: '60', label: '60' },
] as const
/** 分段控件只收字符串，这里转一下 */
const pageSize = computed({
  get: () => String(s.pageSize) as (typeof PAGE_SIZES)[number]['value'],
  set: (v) => (s.pageSize = Number(v) as PageSize),
})
</script>

<template>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.general.language.title')" :desc="t('settings.general.language.desc')">
    <AppSelect
      v-model="s.locale"
      :options="localeOptions"
      :title="t('settings.general.language.title')"
      :desc="t('settings.general.language.desc')"
      :labelledby="labelId"
      :describedby="descId"
    />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.general.start.title')" :desc="t('settings.general.start.desc')">
    <AppSelect
      v-model="s.startPlatform"
      :options="startOptions"
      :title="t('settings.general.start.title')"
      :desc="t('settings.general.start.desc')"
      :labelledby="labelId"
      :describedby="descId"
    />
  </SettingRow>
  <SettingRow :title="t('settings.general.sort.title')" :desc="t('settings.general.sort.desc')">
    <SegmentedControl v-model="s.defaultSort" :options="SORTS" :label="t('settings.general.sort.title')" />
  </SettingRow>
  <SettingRow :title="t('settings.general.type.title')" :desc="t('settings.general.type.desc')">
    <SegmentedControl v-model="s.defaultType" :options="TYPES" :label="t('settings.general.type.title')" />
  </SettingRow>
  <SettingRow :title="t('settings.general.pageSize.title')" :desc="t('settings.general.pageSize.desc')">
    <SegmentedControl v-model="pageSize" :options="PAGE_SIZES" :label="t('settings.general.pageSize.title')" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.general.history.title')" :desc="t('settings.general.history.desc')">
    <SettingSwitch v-model="s.searchHistory" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <!-- 瀑布流的键盘操作（AGENTS.md 7.9）：只读列出 -->
  <section class="keys" :aria-label="t('settings.general.keys.title')">
    <h3>{{ t('settings.general.keys.title') }}</h3>
    <dl>
      <template v-for="k in KEYS" :key="k.id">
        <dt><kbd v-for="c in k.keys" :key="c">{{ c }}</kbd></dt>
        <dd>{{ t(`settings.general.keys.${k.id}`) }}</dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.keys {
  padding: 14px 0 4px;
}
.keys h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
.keys dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 16px;
  margin: 0;
  font-size: 13px;
}
.keys dt {
  display: flex;
  gap: 4px;
}
.keys dd {
  margin: 0;
  color: var(--ink-2);
}
kbd {
  min-width: 22px;
  padding: 1px 6px;
  border: 1px solid var(--hair);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--glass);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  text-align: center;
}
</style>
