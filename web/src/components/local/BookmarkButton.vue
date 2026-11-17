<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark } from 'lucide-vue-next'
import type { Item } from '@/api/types'
import { useLocalStore } from '@/stores/local'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 稍后看 / 本地收藏的书签按钮（AGENTS.md 7.9「本地收藏与稍后看」，设计稿 Z7）。
 * 没收藏过：点了加入「稍后看」并提示；已收藏（实心）：点了打开分组菜单。
 * `card`：瀑布流卡片右上角（选择框左边），悬停时出现；`detail`：详情卡片头部的圆按钮。外观都是透明玻璃。
 */
const props = defineProps<{ platform: string; item: Item; variant: 'card' | 'detail' }>()
const local = useLocalStore()
const { t } = useI18n()
const saved = computed(() => local.has(props.platform, props.item.id))
const label = computed(() => (saved.value ? t('local.button.saved') : t('local.button.add')))

function onClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  local.bookmark(props.platform, props.item, e.currentTarget as Element)
}
</script>

<template>
  <GlassButton
    icon
    :size="variant === 'card' ? 'sm' : 'md'"
    :tone="variant === 'card' ? 'media' : 'default'"
    class="bm"
    :class="`is-${variant}`"
    :aria-label="label"
    :pressed="saved"
    v-tip="label"
    @pointerdown.stop
    @click="onClick"
  >
    <Bookmark :size="14" :fill="saved ? 'currentColor' : 'none'" aria-hidden="true" />
  </GlassButton>
</template>

<style scoped>
/*
 * 外观来自 GlassButton（styles/glass-button.css）。
 * 类名用 is-card / is-detail：根元素会带上父组件的 scope id，
 * 直接叫 card / detail 会命中 MediaCard 的 .card、DetailCard 的 .detail（position: fixed 的遮罩层）。
 */
.bm.is-card {
  position: absolute;
  top: 10px;
  right: 40px;
  z-index: 2;
}
@media (hover: none) {
  .bm.is-card {
    --lg-h: 32px;
    top: 6px;
    right: 48px;
  }
}
</style>
