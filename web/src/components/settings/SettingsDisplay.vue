<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useSettingsStore, type ThemePref } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'

const { settings: s } = useSettingsStore()
const th = useTheme()
const { t } = useI18n()

const THEMES = computed(() => [
  { value: 'light', label: t('settings.display.theme.light') },
  { value: 'dark', label: t('settings.display.theme.dark') },
  { value: 'system', label: t('settings.display.followSystem') },
] as const)
const DENSITIES = computed(() => [
  { value: 'compact', label: t('settings.display.density.compact') },
  { value: 'standard', label: t('settings.display.density.standard') },
  { value: 'cozy', label: t('settings.display.density.cozy') },
] as const)
const MOTIONS = computed(() => [
  { value: 'system', label: t('settings.display.followSystem') },
  { value: 'always', label: t('settings.display.motion.always') },
] as const)

/** 主题从刚点的按钮处展开（View Transitions 圆形展开） */
let origin: { x: number; y: number } | undefined
const theme = computed({
  get: () => th.preference.value,
  set: (v: ThemePref) => th.set(v, origin),
})
</script>

<template>
  <SettingRow :title="t('settings.display.theme.title')" :desc="t('settings.display.theme.desc')">
    <div @pointerdown="origin = { x: $event.clientX, y: $event.clientY }">
      <SegmentedControl v-model="theme" :options="THEMES" :label="t('settings.display.theme.title')" />
    </div>
  </SettingRow>
  <SettingRow :title="t('settings.display.density.title')" :desc="t('settings.display.density.desc')">
    <SegmentedControl v-model="s.density" :options="DENSITIES" :label="t('settings.display.density.title')" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.display.stats.title')" :desc="t('settings.display.stats.desc')">
    <SettingSwitch v-model="s.cardStats" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.display.pixel.title')" :desc="t('settings.display.pixel.desc')">
    <SettingSwitch v-model="s.pixelBackground" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow :title="t('settings.display.motion.title')" :desc="t('settings.display.motion.desc')">
    <SegmentedControl v-model="s.reduceMotion" :options="MOTIONS" :label="t('settings.display.motion.title')" />
  </SettingRow>
</template>
