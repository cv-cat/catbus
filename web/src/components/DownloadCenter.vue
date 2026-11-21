<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderDown } from 'lucide-vue-next'
import GlassButton from '@/components/ui/GlassButton.vue'
import { useDownloadsStore } from '@/stores/downloads'
import { prefersReducedMotion, wave } from '@/composables/motion'
import { LazyDownloadPanel } from '@/components/lazy'

const dl = useDownloadsStore()
const { t } = useI18n()
const root = ref<HTMLElement>()
/** 面板（DownloadPanel）第一次打开时才加载，之后一直挂着；首屏之后空闲时预取 */
const Panel = LazyDownloadPanel.comp

/*
 * 页面上可能同时有几个下载列表按钮（顶栏的、吸顶筛选栏里的、被盖住的发现页的）：
 * 面板只在点开它的那个按钮下面打开（dl.owner）
 */
const props = defineProps<{ compact?: boolean }>()
const uid = dl.nextOwner()
const isOpen = computed(() => dl.open && dl.owner === uid)

/** 角标：第一个投递落进按钮之前先不显示 */
const badge = computed(() => (dl.hold ? 0 : dl.pending))
/** 投递落进按钮时回弹一下（连同角标） */
watch(() => dl.landTick, () => {
  const el = root.value
  if (!el || prefersReducedMotion() || !el.getClientRects().length) return
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(0.86)', offset: 0.3 }, { transform: 'scale(1.12)', offset: 0.65 }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'ease-out' },
  )
})
function toggle() {
  wave()
  if (isOpen.value) dl.open = false
  else {
    dl.owner = uid
    dl.open = true
    void LazyDownloadPanel.load().catch(() => (dl.open = false))
  }
}
onBeforeUnmount(() => {
  if (isOpen.value) dl.open = false
})
</script>

<template>
  <div ref="root" class="center" :class="{ compact: props.compact }" data-dl-target>
    <GlassButton
      icon class="trigger"
      :class="{ 'is-on': isOpen }"
      :aria-label="badge ? t('download.badge', { n: badge }, badge) : t('download.title')"
      v-tip="t('download.title')"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <FolderDown :size="props.compact ? 16 : 18" />
    </GlassButton>
    <!-- 角标：还没结束的条目数；投递动画落进按钮时才出现（AGENTS.md 7.9「下载投递动画与角标」） -->
    <Transition name="badge">
      <span v-if="badge" class="badge mono" aria-hidden="true">{{ badge > 99 ? '99+' : badge }}</span>
    </Transition>

    <component :is="Panel" v-if="Panel" :open="isOpen" :anchor="root" />
  </div>
</template>

<style scoped>
.center {
  position: relative;
  z-index: 10;
  flex: none;
}
/* 按钮外观来自 GlassButton（styles/glass-button.css）；顶栏的圆按钮是 48px，打开时是红玻璃 */
.trigger {
  --lg-h: 48px;
}
/* 角标：右上角的红色胶囊，有条目在下载时外圈慢慢扩散 */
.badge {
  position: absolute;
  top: -3px;
  right: -3px;
  z-index: 1;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
  background: var(--red);
  border: 2px solid var(--bg, #fff);
  box-shadow: 0 0 0 0 #e8414f88;
  animation: pulse 1.6s ease-out infinite;
  pointer-events: none;
}
.badge-enter-active {
  transition: transform 0.38s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out;
}
.badge-leave-active {
  transition: transform 0.26s ease-in, opacity 0.26s ease-in;
}
.badge-enter-from,
.badge-leave-to {
  transform: scale(0.2);
  opacity: 0;
}
/* 吸顶筛选栏里的按钮：与筛选栏的 chip 同高 */
.compact .trigger {
  --lg-h: 36px;
}
.compact .badge {
  top: -5px;
  right: -5px;
}
@keyframes pulse {
  to { box-shadow: 0 0 0 7px #e8414f00; }
}
/* 手机：底部弹层 */
@media (max-width: 640px) {
  .trigger,
  .compact .trigger {
    --lg-h: var(--tap);
  }
}
</style>
