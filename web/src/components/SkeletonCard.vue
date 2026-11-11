<script setup lang="ts">
import CatbusLoader from './CatbusLoader.vue'
import type { PlatformMeta } from '@/data/platforms'

/**
 * 骨架占位。聚合模式下新选的渠道在加载时，每个占位左上角带着渠道图标、封面中间是加载图标（`busy`），
 * 数据回来后在原位换成卡片。
 */
defineProps<{ ratio: number; channel?: PlatformMeta; busy?: boolean }>()
</script>

<template>
  <div class="skeleton" aria-hidden="true">
    <div class="cover shimmer" :style="{ aspectRatio: String(ratio) }">
      <img v-if="channel" class="chan" :src="channel.logo" alt="" draggable="false" />
      <CatbusLoader v-if="busy" class="loader" :size="26" />
    </div>
    <div class="body">
      <div class="line shimmer" />
      <div class="line short shimmer" />
    </div>
  </div>
</template>

<style scoped>
.skeleton {
  border-radius: var(--radius-lg);
  background: var(--glass);
  border: 1px solid var(--glass-stroke);
  overflow: hidden;
}
.cover {
  position: relative;
  display: grid;
  place-items: center;
}
/* 和卡片上的渠道图标同一个位置、同一个大小：换成卡片时图标不跳 */
.chan {
  position: absolute;
  top: 10px;
  left: 10px;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  box-shadow: 0 0 0 1.5px #ffffffd9, 0 4px 12px #1b1f2e40;
}
.loader {
  color: var(--ink-3);
}
.body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.line {
  height: 12px;
  border-radius: 6px;
}
.short {
  width: 55%;
}
.shimmer {
  background: linear-gradient(100deg, var(--skeleton) 30%, var(--hair) 50%, var(--skeleton) 70%);
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
@media (max-width: 640px) {
  .skeleton {
    border-radius: var(--radius-md);
  }
  .chan {
    top: 8px;
    left: 8px;
    width: 22px;
    height: 22px;
    border-radius: 7px;
  }
}
</style>
