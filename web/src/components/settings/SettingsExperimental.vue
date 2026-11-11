<script setup lang="ts">
import { FlaskConical } from 'lucide-vue-next'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import SettingsServer from './SettingsServer.vue'
import { useSettingsStore } from '@/stores/settings'

const { settings: s } = useSettingsStore()
</script>

<template>
  <p class="note" data-setting-row>
    <FlaskConical :size="15" aria-hidden="true" />
    这些功能还在试验，行为和位置以后可能变化。
  </p>
  <SettingRow v-slot="{ labelId, descId }" title="显示原始 JSON" desc="详情卡片标题栏多一个 {} 按钮，切换到平台返回的原始对象（--raw），用来排查字段。">
    <SettingSwitch v-model="s.rawJson" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" title="悬停预览视频" desc="鼠标停在视频卡片上，卡片浮起长成视频的比例并静音播放；列表里没有视频地址时会请求一次详情。">
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
