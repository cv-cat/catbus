<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppSelect from './AppSelect.vue'

/**
 * 时间筛选（`item search --time`）：下拉 chip「时间 · 不限」（设计稿 R / R2 / R3），用公共的 AppSelect（chip 样式）。
 * 菜单传送到 body：筛选栏是横向滚动容器，放在里面会被裁掉；手机上是底部弹层。
 * options[].disabled / disabled 为不能选的原因：置灰并用 tooltip 说明（整个不支持时 chip 整体置灰）。
 */
defineProps<{
  options: readonly { value: string; label: string; disabled?: string | null }[]
  disabled?: string | null
}>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()

const DEFAULT = 'all'
</script>

<template>
  <AppSelect
    v-model="model"
    variant="chip"
    :options="options"
    :active="model !== DEFAULT"
    :disabled="disabled"
    :label="t('discover.filter.time')"
    :title="t('discover.filter.time')"
  >
    <template #value="{ option }">{{ t('discover.filter.timeChip', { label: (option ?? options[0])?.label ?? '' }) }}</template>
  </AppSelect>
</template>
