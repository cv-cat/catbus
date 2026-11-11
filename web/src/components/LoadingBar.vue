<script setup lang="ts">
/**
 * 不确定进度的细进度条：品牌红的一段在轨道上循环滑动。
 * 只负责外观，位置由使用方决定（绝对定位到容器的某条边上）。
 */
defineProps<{ active: boolean }>()
</script>

<template>
  <Transition name="loading-bar">
    <div v-if="active" class="loading-bar" role="progressbar" aria-label="加载中" aria-busy="true">
      <i class="run" />
    </div>
  </Transition>
</template>

<style scoped>
.loading-bar {
  height: 2px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--red-soft);
  pointer-events: none;
}
.run {
  display: block;
  width: 36%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--red) 30%, var(--red) 70%, transparent);
  animation: run 1.15s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes run {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(280%);
  }
}
.loading-bar-enter-active {
  transition: opacity 0.2s ease-out;
}
.loading-bar-leave-active {
  transition: opacity 0.35s ease-in;
}
.loading-bar-enter-from,
.loading-bar-leave-to {
  opacity: 0;
}
/* 减少动态效果：整条静止显示，只做轻微的明暗变化 */
@media (prefers-reduced-motion: reduce) {
  .run {
    width: 100%;
    background: var(--red);
    animation: breathe 1.6s ease-in-out infinite alternate;
  }
  @keyframes breathe {
    from {
      opacity: 0.45;
    }
    to {
      opacity: 0.85;
    }
  }
  .loading-bar-enter-active,
  .loading-bar-leave-active {
    transition: none;
  }
}
</style>
