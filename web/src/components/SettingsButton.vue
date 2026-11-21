<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { gsap, prefersReducedMotion, wave } from '@/composables/motion'
import GlassButton from '@/components/ui/GlassButton.vue'

const store = useSettingsStore()
const { t } = useI18n()
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
  <GlassButton
    icon
    tone="quiet"
    class="settings"
    :class="{ 'is-on': open }"
    :aria-label="t('layout.settings')"
    :title="t('layout.settings')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @mouseenter="spin"
    @focus="spin"
    @click="onClick"
  >
    <span ref="icon" class="icon">
      <Settings :size="18" />
    </span>
  </GlassButton>
</template>

<style scoped>
/* 外观来自 GlassButton（styles/glass-button.css）：平时只有图标，悬停出玻璃，打开设置时保持开启态 */
.settings {
  --lg-h: 36px;
}
.icon {
  display: grid;
}
</style>
