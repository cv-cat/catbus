<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FlaskConical } from 'lucide-vue-next'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import SettingsServer from './SettingsServer.vue'
import { useSettingsStore } from '@/stores/settings'

const { settings: s } = useSettingsStore()
const { t } = useI18n()
</script>

<template>
  <p class="note" data-setting-row>
    <FlaskConical :size="15" aria-hidden="true" />
    {{ t('settings.experimental.note') }}
  </p>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.experimental.rawJson.title')" :desc="t('settings.experimental.rawJson.desc')">
    <SettingSwitch v-model="s.rawJson" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.experimental.hoverPreview.title')" :desc="t('settings.experimental.hoverPreview.desc')">
    <SettingSwitch v-model="s.hoverPreview" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingsServer />
</template>

<style scoped>
.note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 6px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--ink-2);
  background: color-mix(in srgb, var(--warn) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
}
.note svg {
  flex: none;
  color: var(--warn);
}
</style>
