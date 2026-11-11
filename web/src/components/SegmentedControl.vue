<script setup lang="ts" generic="T extends string">
import { nextTick, onMounted, ref, watch } from 'vue'
import { animate, gsap } from '@/composables/motion'

/** iOS 风格分段控件：选中块用 GSAP 在选项之间滑动 */
/** disabled 为不能选的原因：按钮置灰、不可点击，鼠标移入 / 聚焦时用 tooltip 显示原因 */
const props = defineProps<{ options: readonly { value: T; label: string; disabled?: string | null }[]; label: string }>()
const model = defineModel<T>({ required: true })

const root = ref<HTMLElement>()
const thumb = ref<HTMLElement>()

function place(instant = false) {
  const btn = root.value?.querySelector<HTMLElement>(`[data-value="${CSS.escape(model.value)}"]`)
  if (!btn || !thumb.value) return
  const vars = { x: btn.offsetLeft, width: btn.offsetWidth, duration: 0.45, ease: 'power3.out' }
  instant ? gsap.set(thumb.value, vars) : animate(thumb.value, vars)
}

onMounted(() => nextTick(() => place(true)))
watch(model, () => place())
watch(() => props.options, () => nextTick(() => place(true)))
</script>

<template>
  <div ref="root" class="seg glass" role="radiogroup" :aria-label="label">
    <span ref="thumb" class="thumb" aria-hidden="true" />
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :data-value="o.value"
      v-tip="o.disabled"
      :class="{ active: model === o.value, disabled: !!o.disabled }"
      :aria-disabled="o.disabled ? 'true' : undefined"
      @click="!o.disabled && (model = o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  position: relative;
  display: inline-flex;
  padding: 4px;
  gap: 2px;
  border-radius: var(--radius-md);
}
.thumb {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  border-radius: var(--radius-sm);
  background: var(--glass-strong);
  box-shadow: 0 1px 6px #1b1f2e18;
}
button {
  position: relative;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--ink-2);
  transition: color 0.2s;
}
/* 置灰用 aria-disabled 而不是 disabled：原生 disabled 的按钮收不到鼠标事件，tooltip 出不来 */
button.disabled {
  color: var(--ink-3);
  opacity: 0.45;
  cursor: not-allowed;
}
button.active {
  color: var(--ink);
  font-weight: 600;
}
/* 放在横向滚动的筛选栏里：不换行、不被压缩 */
.seg {
  flex: none;
}
button {
  white-space: nowrap;
}
@media (pointer: coarse) {
  button {
    min-height: 34px;
  }
}
@media (max-width: 640px) {
  button {
    padding: 6px 12px;
    font-size: 12.5px;
  }
}
</style>
