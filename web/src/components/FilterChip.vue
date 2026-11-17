<script setup lang="ts">
import { flashTip } from '@/directives/tip'
import GlassButton from '@/components/ui/GlassButton.vue'
/** disabled 为不能选的原因：置灰、不触发 click，鼠标移入 / 聚焦时用 tooltip 显示原因 */
const props = defineProps<{ active?: boolean; disabled?: string | null }>()
const emit = defineEmits<{ click: [e: MouseEvent] }>()
</script>

<template>
  <GlassButton
    v-tip="disabled"
    class="chip"
    :class="{ disabled: !!disabled }"
    :pressed="active"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="props.disabled ? flashTip($event.currentTarget) : emit('click', $event)"
  >
    <slot />
  </GlassButton>
</template>

<style scoped>
/*
 * 外观来自 GlassButton（styles/glass-button.css）：选中是红字红玻璃（aria-pressed）。
 * 置灰用 aria-disabled 而不是 disabled：原生 disabled 的按钮收不到鼠标事件，tooltip 出不来。
 */
.chip[aria-pressed='true'] {
  font-weight: 600;
}
/* 手机：高 44（设计稿 R3） */
@media (max-width: 640px) {
  .chip {
    --lg-h: 44px;
    padding: 0 16px;
    font-size: 14px;
  }
}
</style>
