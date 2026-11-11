<script setup lang="ts">
/** 开关：role="switch"，空格 / 回车切换（原生 button 自带） */
defineProps<{ labelledby?: string; describedby?: string; disabled?: boolean }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    type="button"
    class="switch"
    role="switch"
    :aria-checked="model"
    :aria-labelledby="labelledby"
    :aria-describedby="describedby"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="thumb" aria-hidden="true" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  width: 46px;
  height: 28px;
  flex: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink) 16%, transparent);
  box-shadow: inset 0 0 0 1px var(--hair);
  transition: background-color 0.25s var(--ease-out);
}
.switch[aria-checked='true'] {
  background: var(--red);
}
.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 6px #0b0d1a40;
  transition: transform 0.35s var(--ease-out), width 0.2s var(--ease-out);
}
.switch[aria-checked='true'] .thumb {
  transform: translateX(18px);
}
/* 按下时拉长一点，像 iOS 的开关 */
.switch:not(:disabled):active .thumb {
  width: 26px;
}
.switch[aria-checked='true']:not(:disabled):active .thumb {
  transform: translateX(14px);
}
.switch:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 3px;
}
.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .switch,
  .thumb {
    transition: none;
  }
}
@media (pointer: coarse) {
  /* 触屏：可点区域至少 44px，视觉大小不变 */
  .switch::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
}
</style>
