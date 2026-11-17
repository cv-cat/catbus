<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'
import { gsap, prefersReducedMotion, wave } from '@/composables/motion'
import GlassButton from '@/components/ui/GlassButton.vue'

const { theme, preference, toggle } = useTheme()
const { t } = useI18n()
/** 跟随系统时在提示里说明：点一下会改成固定的亮色 / 暗色 */
const title = computed(() => {
  const target = theme.value === 'light' ? 'dark' : 'light'
  return preference.value === 'system' ? t(`layout.theme.${target}System`) : t(`layout.theme.${target}`)
})
const icon = ref<HTMLElement>()

function onClick(e: MouseEvent) {
  wave()
  toggle({ x: e.clientX, y: e.clientY })
}

watch(theme, () => {
  if (prefersReducedMotion() || !icon.value) return
  gsap.fromTo(icon.value, { rotate: -90, scale: 0.4, opacity: 0 }, { rotate: 0, scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(2.2)' })
})
</script>

<template>
  <GlassButton
    icon
    class="toggle"
    :aria-label="theme === 'light' ? t('layout.theme.toDark') : t('layout.theme.toLight')"
    :title="title"
    @click="onClick"
  >
    <span ref="icon" class="icon">
      <Moon v-if="theme === 'light'" :size="18" />
      <Sun v-else :size="18" />
    </span>
  </GlassButton>
</template>

<style scoped>
/* 外观来自 GlassButton（styles/glass-button.css）；顶栏的圆按钮比默认的 32px 大 */
.toggle {
  --lg-h: 48px;
}
.icon {
  display: grid;
}
@media (max-width: 640px) {
  .toggle {
    --lg-h: var(--tap);
  }
}
</style>
