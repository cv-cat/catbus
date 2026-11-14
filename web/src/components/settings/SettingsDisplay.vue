<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useSettingsStore, type ThemePref } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import { PLATFORMS } from '@/data/platforms'

const mteamLogo = PLATFORMS.find((p) => p.id === 'mteam')?.logo

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
  <SettingRow :title="t('settings.display.theme.title')">
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
  <!-- M-Team（设计稿 Y7）：成人分区默认不显示 -->
  <div class="sub" data-setting-row>
    <img class="sub-logo" :src="mteamLogo" alt="" />
    <span>{{ t('settings.display.mteam.section') }}</span>
  </div>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.display.mteam.adult.title')" :desc="t('settings.display.mteam.adult.desc')">
    <SettingSwitch v-model="s.mteamAdult" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
</template>

<style scoped>
.sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
  padding-bottom: 4px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-2);
}
.sub-logo {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}
</style>
