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
/* 透明玻璃轨道（变量在 tokens.css 的 --lg-*）；打开时是实心红玻璃 */
.switch {
  position: relative;
  width: 46px;
  height: 28px;
  flex: none;
  border-radius: 999px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ink) 4%, transparent), color-mix(in srgb, var(--ink) 12%, transparent)), var(--lg-fill);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
  box-shadow: var(--lg-edge);
  -webkit-tap-highlight-color: transparent;
  transition: background 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out);
}
.switch[aria-checked='true'] {
  background: var(--lg-primary-fill);
  box-shadow: inset 0 1px 0 #ffffff66, inset 0 0 0 0.5px #ffffff40, 0 3px 10px #e8414f33;
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
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 3px;
}
.switch:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (prefers-reduced-transparency: reduce) {
  .switch {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
  .switch:not([aria-checked='true']) {
    background: var(--detail-chip);
  }
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
