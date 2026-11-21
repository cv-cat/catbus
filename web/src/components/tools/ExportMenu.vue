<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileJson, FileSpreadsheet } from 'lucide-vue-next'
import type { ExportFormat } from '@/composables/export-list'
import GlassButton from '@/components/ui/GlassButton.vue'

/** 导出菜单（AGENTS.md 7.9「导出已加载的列表」）：CSV / JSON，贴着按钮的玻璃菜单 */
const props = defineProps<{ open: boolean; anchor: HTMLElement | null; count: number }>()
const emit = defineEmits<{ close: []; pick: [ExportFormat] }>()
const { t } = useI18n()
const root = ref<HTMLElement>()

const pos = computed(() => {
  const a = props.anchor?.getBoundingClientRect()
  if (!a) return {}
  const w = 220
  const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8)
  return innerHeight - a.bottom > 160 ? { left: `${left}px`, top: `${a.bottom + 8}px` } : { left: `${left}px`, bottom: `${innerHeight - a.top + 8}px` }
})

function pick(f: ExportFormat) {
  emit('pick', f)
  emit('close')
}
watch(
  () => props.open,
  (v) => v && void nextTick(() => root.value?.querySelector<HTMLElement>('button')?.focus()),
)
const onDown = (e: PointerEvent) => {
  if (props.open && !root.value?.contains(e.target as Node) && !props.anchor?.contains(e.target as Node)) emit('close')
}
const onKey = (e: KeyboardEvent) => {
  if (props.open && e.key === 'Escape') {
    e.stopPropagation()
    emit('close')
  }
}
addEventListener('pointerdown', onDown, true)
addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
  removeEventListener('pointerdown', onDown, true)
  removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="em">
      <div v-if="open" ref="root" class="em glass" role="menu" :aria-label="t('export.title')" :style="pos">
        <div class="head">{{ t('export.head', { n: count }, count) }}</div>
        <GlassButton tone="quiet" role="menuitem" class="opt" @click="pick('csv')">
          <FileSpreadsheet :size="16" aria-hidden="true" />
          <span class="col"><b>CSV</b><small>{{ t('export.csv') }}</small></span>
        </GlassButton>
        <GlassButton tone="quiet" role="menuitem" class="opt" @click="pick('json')">
          <FileJson :size="16" aria-hidden="true" />
          <span class="col"><b>JSON</b><small>{{ t('export.json') }}</small></span>
        </GlassButton>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.em {
  position: fixed;
  z-index: 70;
  width: 220px;
  padding: 6px;
  border-radius: 14px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(30px) saturate(1.6);
}
.head {
  padding: 6px 10px 4px;
  font-size: 12px;
  color: var(--ink-3);
}
/* 菜单项外观来自 GlassButton（quiet：悬停 / 聚焦时出玻璃胶囊） */
.opt.lg-btn {
  --lg-h: 44px;
  --lg-fg: var(--ink);
  width: 100%;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 10px;
  border-radius: 12px;
  text-align: left;
}
.opt.lg-btn:hover {
  --lg-fg: var(--ink);
}
.opt.lg-btn:active {
  transform: scale(0.98);
}
.opt.lg-btn:focus-visible {
  --lg-bg: var(--lg-fill-hover);
  outline-offset: -2px;
}
.col {
  display: flex;
  flex-direction: column;
}
.col b {
  font-size: 14px;
}
.col small {
  font-size: 12px;
  color: var(--ink-3);
}
.em-enter-active,
.em-leave-active {
  transition: opacity 0.16s, transform 0.2s var(--ease-out);
}
.em-enter-from,
.em-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
