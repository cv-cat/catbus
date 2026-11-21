<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toast'
import GlassButton from '@/components/ui/GlassButton.vue'

const t = useToastStore()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="t.show" :key="t.key" class="toast" role="status" aria-live="polite">
        <Check :size="15" />{{ t.text }}
        <GlassButton v-for="(a, i) in t.actions" :key="i" tone="primary" size="sm" class="act" @click="t.act(a)">{{ a.label }}</GlassButton>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 桌面、平板：放在内容区底部居中。顶部是搜索框和选择工具栏（全选 / 反选 / 导出 / 下载），放在顶上会盖住它们 */
.toast {
  position: fixed;
  bottom: calc(28px + var(--safe-bottom));
  left: calc(var(--content-left) + (100vw - var(--content-left)) / 2);
  max-width: calc(100vw - var(--content-left) - 32px);
  transform: translateX(-50%);
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: 999px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(30px) saturate(1.6);
  color: var(--ink);
  font-size: 13px;
  pointer-events: none;
}
.toast:has(.act) {
  pointer-events: auto;
  padding-right: 6px;
}
/* 外观来自 GlassButton（styles/glass-button.css） */
.act {
  margin-left: 6px;
  font-weight: 600;
}
.toast svg {
  flex: none;
  color: var(--online);
}
/* 手机：放在顶部（底部有选择操作条），让开刘海，宽度收在屏内，长文字换行 */
@media (max-width: 640px) {
  .toast {
    top: calc(var(--safe-top) + 10px);
    bottom: auto;
    left: 50%;
    max-width: calc(100vw - 24px - var(--safe-left) - var(--safe-right));
    width: max-content;
    padding: 10px 16px;
    border-radius: 18px;
    font-size: 14px;
    line-height: 1.4;
    text-align: left;
  }
  .act {
    --lg-h: var(--tap);
  }
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.25s var(--ease-out),
    transform 0.25s var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
@media (max-width: 640px) {
  .toast-enter-from,
  .toast-leave-to {
    transform: translate(-50%, -12px);
  }
}
</style>
