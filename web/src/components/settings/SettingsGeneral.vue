<script setup lang="ts">
import { computed } from 'vue'
import SettingRow from './SettingRow.vue'
import SettingSelect from './SettingSelect.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { PLATFORMS } from '@/data/platforms'
import { SORTS, TYPES } from '@/data/filters'
import { useSettingsStore, type PageSize } from '@/stores/settings'

const { settings: s } = useSettingsStore()

const startOptions = [{ value: 'last', label: '上次浏览的' }, ...PLATFORMS.map((p) => ({ value: p.id, label: p.name }))]
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
  <SettingRow v-slot="{ labelId, descId }" title="启动时打开" desc="打开 WebUI 时进入的平台：接着上次浏览的，或者固定某个平台。">
    <SettingSelect v-model="s.startPlatform" :options="startOptions" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow title="默认排序" desc="进入平台时的排序；平台不支持时退回「综合」。">
    <SegmentedControl v-model="s.defaultSort" :options="SORTS" label="默认排序" />
  </SettingRow>
  <SettingRow title="默认类型" desc="进入平台时只看视频、图文，或者全部。">
    <SegmentedControl v-model="s.defaultType" :options="TYPES" label="默认类型" />
  </SettingRow>
  <SettingRow title="每页条数" desc="每次请求取多少条。条数越多越慢，也更容易触发平台风控。">
    <SegmentedControl v-model="pageSize" :options="PAGE_SIZES" label="每页条数" />
  </SettingRow>
</template>
