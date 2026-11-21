<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Bookmark } from 'lucide-vue-next'
import GlassButton from '@/components/ui/GlassButton.vue'

/** 侧栏右上角的本地收藏入口，与左上角的设置按钮对称（AGENTS.md 7.9「本地收藏与稍后看」） */
defineProps<{ active: boolean }>()
const { t } = useI18n()
</script>

<template>
  <GlassButton
    icon
    tone="quiet"
    class="local"
    :class="{ 'is-on': active }"
    :aria-label="t('local.title')"
    :title="t('local.title')"
    :aria-current="active ? 'page' : undefined"
  >
    <Bookmark :size="18" :fill="active ? 'currentColor' : 'none'" />
  </GlassButton>
</template>

<style scoped>
/* 外观同设置按钮（GlassButton quiet），配色换成淡粉的半透明玻璃，平时也带底 */
.local.lg-btn {
  --lg-h: 36px;
  --lg-bg: linear-gradient(180deg, #ffffff30, #ffffff00), color-mix(in srgb, var(--red) 12%, transparent);
  --lg-fg: color-mix(in srgb, var(--red) 78%, var(--ink));
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
  box-shadow: var(--lg-edge);
}
.local.lg-btn:hover,
.local.lg-btn.is-on {
  --lg-bg: linear-gradient(180deg, #ffffff40, #ffffff00), color-mix(in srgb, var(--red) 22%, transparent);
  --lg-fg: var(--red);
}
</style>
