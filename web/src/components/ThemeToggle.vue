<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Moon, Sun } from 'lucide-vue-next'
import { useTheme } from '@/composables/useTheme'
import { gsap, prefersReducedMotion, wave } from '@/composables/motion'

const { theme, preference, toggle } = useTheme()
/** 跟随系统时在提示里说明：点一下会改成固定的亮色 / 暗色 */
const suffix = computed(() => (preference.value === 'system' ? '（当前跟随系统）' : ''))
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
  <button
    class="toggle glass"
    type="button"
    :aria-label="theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'"
    :title="(theme === 'light' ? '暗色' : '亮色') + suffix"
    @click="onClick"
  >
    <span ref="icon" class="icon">
      <Moon v-if="theme === 'light'" :size="18" />
      <Sun v-else :size="18" />
    </span>
  </button>
</template>

<style scoped>
.toggle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  transition: color 0.2s, transform 0.2s var(--ease-out);
}
.toggle:hover {
  color: var(--ink);
  transform: translateY(-1px);
}
.icon {
  display: grid;
}
@media (hover: none) {
  .toggle:hover {
    transform: none;
    color: var(--ink-2);
  }
}
@media (max-width: 640px) {
  .toggle {
    width: var(--tap);
    height: var(--tap);
  }
}
</style>
