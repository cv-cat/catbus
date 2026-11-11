<script setup lang="ts" generic="T extends string | number">
import { ChevronDown } from 'lucide-vue-next'

/** 下拉选择：原生 <select>（手机上弹系统选择器），外观换成玻璃胶囊 */
defineProps<{ options: readonly { value: T; label: string }[]; labelledby?: string; describedby?: string; disabled?: boolean }>()
const model = defineModel<T>({ required: true })

function onChange(e: Event, options: readonly { value: T; label: string }[]) {
  const i = (e.target as HTMLSelectElement).selectedIndex
  const o = options[i]
  if (o) model.value = o.value
}
</script>

<template>
  <span class="select glass" :class="{ disabled }">
    <select
      :aria-labelledby="labelledby"
      :aria-describedby="describedby"
      :disabled="disabled"
      @change="onChange($event, options)"
    >
      <option v-for="o in options" :key="String(o.value)" :value="String(o.value)" :selected="o.value === model">
        {{ o.label }}
      </option>
    </select>
    <ChevronDown class="chev" :size="15" aria-hidden="true" />
  </span>
</template>

<style scoped>
.select {
  position: relative;
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: box-shadow 0.2s;
}
.select:hover:not(.disabled) {
  box-shadow: 0 4px 14px #1b1f2e1c;
}
select {
  appearance: none;
  -webkit-appearance: none;
  min-width: 150px;
  max-width: 220px;
  padding: 9px 36px 9px 14px;
  border: none;
  border-radius: inherit;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
select:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
}
option {
  color: initial;
}
.chev {
  position: absolute;
  right: 12px;
  pointer-events: none;
  color: var(--ink-2);
}
.select.disabled {
  opacity: 0.5;
}
.select.disabled select {
  cursor: not-allowed;
}
@media (max-width: 640px) {
  /* iOS 聚焦时不放大页面：字号不小于 16px */
  select {
    font-size: 16px;
    min-height: var(--tap);
  }
}
</style>
