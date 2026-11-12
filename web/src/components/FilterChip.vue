<script setup lang="ts">
import { flashTip } from '@/directives/tip'
/** disabled 为不能选的原因：置灰、不触发 click，鼠标移入 / 聚焦时用 tooltip 显示原因 */
const props = defineProps<{ active?: boolean; disabled?: string | null }>()
const emit = defineEmits<{ click: [e: MouseEvent] }>()
</script>

<template>
  <button
    v-tip="disabled"
    type="button"
    class="chip"
    :class="[active ? 'active' : 'glass', { disabled: !!disabled }]"
    :aria-pressed="active"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="props.disabled ? flashTip($event.currentTarget) : emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.chip {
  padding: 7px 14px;
  border-radius: 16px;
  font-size: 13px;
  color: var(--ink-2);
  border: 1px solid transparent;
  transition: background 0.25s, color 0.25s, border-color 0.25s, transform 0.2s var(--ease-out);
}
.chip:hover {
  transform: translateY(-1px);
  color: var(--ink);
}
/* 置灰用 aria-disabled 而不是 disabled：原生 disabled 的按钮收不到鼠标事件，tooltip 出不来 */
.chip.disabled,
.chip.disabled:hover {
  transform: none;
  color: var(--ink-3);
  opacity: 0.45;
  cursor: not-allowed;
}
/* 选中：淡红叠在不透明的玻璃底上并模糊背景，压在红色点阵上也看得清 */
.chip.active {
  background: linear-gradient(var(--red-soft), var(--red-soft)), var(--glass-strong);
  backdrop-filter: blur(20px) saturate(1.4);
  box-shadow: 0 2px 10px #e8414f1f;
  border-color: #e8414f40;
  color: var(--red);
  font-weight: 600;
}
/* 放在横向滚动的筛选栏里：不换行、不被压缩 */
.chip {
  flex: none;
  white-space: nowrap;
}
@media (hover: none) {
  .chip:hover {
    transform: none;
  }
}
@media (pointer: coarse) {
  .chip {
    min-height: 40px;
  }
}
/* 手机：高 44、圆角 22（设计稿 R3） */
@media (max-width: 640px) {
  .chip {
    height: 44px;
    padding: 0 16px;
    border-radius: 22px;
    font-size: 14px;
  }
}
</style>
