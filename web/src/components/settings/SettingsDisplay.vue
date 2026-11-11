<script setup lang="ts">
import { computed } from 'vue'
import SettingRow from './SettingRow.vue'
import SettingSwitch from './SettingSwitch.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useSettingsStore, type ThemePref } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'

const { settings: s } = useSettingsStore()
const t = useTheme()

const THEMES = [
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
  { value: 'system', label: '跟随系统' },
] as const
const DENSITIES = [
  { value: 'compact', label: '紧凑' },
  { value: 'standard', label: '标准' },
  { value: 'cozy', label: '宽松' },
] as const
const MOTIONS = [
  { value: 'system', label: '跟随系统' },
  { value: 'always', label: '总是减少' },
] as const

/** 主题从刚点的按钮处展开（View Transitions 圆形展开） */
let origin: { x: number; y: number } | undefined
const theme = computed({
  get: () => t.preference.value,
  set: (v: ThemePref) => t.set(v, origin),
})
</script>

<template>
  <SettingRow title="主题" desc="「跟随系统」时随系统的深色模式实时切换。">
    <div @pointerdown="origin = { x: $event.clientX, y: $event.clientY }">
      <SegmentedControl v-model="theme" :options="THEMES" label="主题" />
    </div>
  </SettingRow>
  <SettingRow title="卡片密度" desc="瀑布流的列宽：紧凑一屏放更多卡片，宽松的封面更大。">
    <SegmentedControl v-model="s.density" :options="DENSITIES" label="卡片密度" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" title="显示互动数据" desc="卡片上的点赞、评论、播放数。">
    <SettingSwitch v-model="s.cardStats" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow v-slot="{ labelId, descId }" title="背景和人浪动效" desc="页面背后的方块像素：鼠标附近会亮起，点击和加载时从右上角往左下起一浪。">
    <SettingSwitch v-model="s.pixelBackground" :labelledby="labelId" :describedby="descId" />
  </SettingRow>
  <SettingRow title="减少动效" desc="「总是减少」时不论系统设置都只做简单的淡入淡出。">
    <SegmentedControl v-model="s.reduceMotion" :options="MOTIONS" label="减少动效" />
  </SettingRow>
</template>
