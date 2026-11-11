<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { gsap, prefersReducedMotion, wave } from '@/composables/motion'

const store = useSettingsStore()
const { open } = storeToRefs(store)
const icon = ref<HTMLElement>()
/** 累计转角：每次悬停在上次停下的位置继续转，不回弹 */
let angle = 0
let tl: gsap.core.Timeline | null = null

/** 悬停：像秒针一样一格一格地跳，每格带一点过冲，不做匀速平滑转动 */
function spin() {
  if (prefersReducedMotion() || !icon.value || tl?.isActive()) return
  tl = gsap.timeline()
  for (let i = 0; i < 3; i++) {
    angle += 20
    tl.to(icon.value, { rotate: angle, duration: 0.14, ease: 'back.out(4)' }, i === 0 ? 0 : '+=0.05')
  }
}

function onClick() {
  wave()
  store.toggle()
}
</script>

<template>
  <button
    class="settings"
    type="button"
    aria-label="设置"
    title="设置"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @mouseenter="spin"
    @focus="spin"
    @click="onClick"
  >
    <span ref="icon" class="icon">
      <Settings :size="18" />
    </span>
  </button>
</template>

<style scoped>
/* 不要圆形边框和底色：平时只有图标，悬停时浮起一圈阴影 */
.settings {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  transition: color 0.2s, box-shadow 0.2s, transform 0.2s var(--ease-out);
}
.settings:hover,
.settings[aria-expanded='true'] {
  color: var(--ink);
}
.settings:hover {
  box-shadow: 0 4px 14px #1b1f2e2e;
  transform: translateY(-1px);
}
.settings:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
}
.icon {
  display: grid;
}
@media (hover: none) {
  .settings:hover {
    box-shadow: none;
    transform: none;
    color: var(--ink-2);
  }
}
@media (hover: none) and (pointer: coarse) {
  .settings {
    width: var(--tap);
    height: var(--tap);
  }
}
</style>
