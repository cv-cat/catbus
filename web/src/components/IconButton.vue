<script setup lang="ts">
import GlassButton from '@/components/ui/GlassButton.vue'

defineProps<{ label: string }>()
</script>

<template>
  <GlassButton icon class="icon-btn" :aria-label="label" :title="label">
    <slot />
  </GlassButton>
</template>

<style scoped>
/* 外观来自 GlassButton（styles/glass-button.css）；顶栏的圆按钮比默认的 32px 大 */
.icon-btn {
  --lg-h: 48px;
}
@media (max-width: 640px) {
  .icon-btn {
    --lg-h: var(--tap);
  }
}
</style>
