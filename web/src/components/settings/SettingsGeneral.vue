<script setup lang="ts">
import { computed } from 'vue'
import { History } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
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
</template>
