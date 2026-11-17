<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { KINDS } from '@/data/filters'

/**
 * 推荐流分类「推荐 / 热门 / 关注」（`feed list --kind`），只在没有关键词时出现在筛选栏最左边（设计稿 R）。
 * 样式与排序分段相同；`unsupported` 给出不能选的原因（置灰 + tooltip）。
 */
const props = defineProps<{ unsupported: (value: string) => string | null }>()
const model = defineModel<string>({ required: true })
const { t } = useI18n()
const options = computed(() => KINDS.map((o) => ({ value: o.value as string, label: o.label as string, disabled: props.unsupported(o.value) })))
</script>

<template>
  <SegmentedControl v-model="model" :options="options" :label="t('discover.filter.kind')" />
</template>
