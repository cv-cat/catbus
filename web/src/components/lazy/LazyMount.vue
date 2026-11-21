<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CatbusLoader from '@/components/CatbusLoader.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import type { LazyComponent } from '@/composables/lazy'

/**
 * 挂上一个按需加载的组件：代码到了才渲染，属性和事件原样传下去。
 * page 为 true 时（盖在发现页上面的页），加载中在内容区显示加载图标，加载失败显示重试；
 * 弹窗、浮层不显示占位（它们在用到之前就已经空闲预取了）。
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{ lazy: LazyComponent; page?: boolean }>()
const { t } = useI18n()
const failed = ref(false)

function load() {
  failed.value = false
  props.lazy.load().catch(() => (failed.value = true))
}
onMounted(load)
</script>

<template>
  <component :is="lazy.comp.value" v-if="lazy.comp.value" v-bind="$attrs" />
  <main v-else-if="page" class="lazy-page" :aria-busy="!failed || undefined">
    <div v-if="failed" class="lazy-fail" role="alert">
      <span>{{ t('layout.loadFailed') }}</span>
      <GlassButton @click="load">{{ t('common.action.retry') }}</GlassButton>
    </div>
    <CatbusLoader v-else class="lazy-loader" :size="28" />
  </main>
</template>

<style scoped>
/* 与各页的根元素同一个位置，盖住后面的发现页 */
.lazy-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  z-index: 2;
  display: grid;
  place-items: center;
  color: var(--ink-3, var(--ink));
  transition: left 0.5s var(--ease-out);
}
/* 代码通常很快就到：先不显示，过一会儿还没到才淡入，避免一闪 */
.lazy-loader {
  opacity: 0;
  animation: lazy-in 0.2s ease-out 0.15s forwards;
}
@keyframes lazy-in {
  to {
    opacity: 0.7;
  }
}
.lazy-fail {
  display: grid;
  justify-items: center;
  gap: 12px;
  font-size: 14px;
}
@media (prefers-reduced-motion: reduce) {
  .lazy-loader {
    animation: none;
    opacity: 0.7;
  }
}
</style>
