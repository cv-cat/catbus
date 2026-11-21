<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Braces, ChevronsDownUp, ChevronsUpDown, Copy, RotateCw } from 'lucide-vue-next'
import JsonNode from './JsonNode.vue'
import CatbusLoader from './CatbusLoader.vue'
import { copyText } from '@/stores/toast'
import type { CatbusError } from '@/api/types'
import { errorDetail, errorTitle } from '@/i18n/errors'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 详情卡片里的原始 JSON 视图（设置「实验性」→ 显示原始 JSON）：`item get --raw` 的 data。
 * 等宽字体、可折叠，「复制」复制整段格式化后的 JSON。
 */
const props = defineProps<{ value: unknown; loading: boolean; error: CatbusError | null }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

/** 默认展开两层；全部展开 / 全部折叠时改 version 让每个节点重设 */
const expandTo = ref(2)
const version = ref(0)
function expandAll() {
  expandTo.value = Infinity
  version.value++
}
function collapseAll() {
  expandTo.value = 1
  version.value++
}
const text = computed(() => (props.value === undefined ? '' : JSON.stringify(props.value, null, 2)))
const size = computed(() => {
  const n = new Blob([text.value]).size
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`
})
</script>

<template>
  <section class="raw" :aria-label="t('detail.raw.title')">
    <div class="bar">
      <span class="label"><Braces :size="14" aria-hidden="true" />{{ t('detail.raw.title') }}<small v-if="!loading && !error && value !== undefined" class="mono">{{ size }}</small></span>
      <span class="grow" />
      <template v-if="!loading && !error && value !== undefined">
        <GlassButton icon size="sm" :title="t('detail.raw.expandAll')" :aria-label="t('detail.raw.expandAll')" @click="expandAll"><ChevronsUpDown :size="14" /></GlassButton>
        <GlassButton icon size="sm" :title="t('detail.raw.collapseAll')" :aria-label="t('detail.raw.collapseAll')" @click="collapseAll"><ChevronsDownUp :size="14" /></GlassButton>
        <GlassButton size="sm" @click="copyText(text)"><Copy :size="13" aria-hidden="true" />{{ t('common.action.copy') }}</GlassButton>
      </template>
    </div>
    <div v-if="loading" class="state"><CatbusLoader :size="18" :label="t('detail.loadingLabel')" /><span>{{ t('detail.raw.loading') }}</span></div>
    <div v-else-if="error" class="state err">
      <span :title="errorDetail(error) ?? undefined">{{ errorTitle(error) }}</span>
      <GlassButton tone="primary" size="sm" @click="emit('retry')"><RotateCw :size="13" aria-hidden="true" />{{ t('common.action.retry') }}</GlassButton>
    </div>
    <div v-else class="tree">
      <JsonNode :value="value" :depth="0" :expand-to="expandTo" :version="version" last />
    </div>
  </section>
</template>

<style scoped>
.raw {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bar {
  position: sticky;
  top: -20px;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -20px -22px 0;
  padding: 12px 22px 10px;
  background: var(--glass-strong);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--hair);
}
.label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.label svg {
  color: var(--red);
}
.label small {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 400;
  color: var(--ink-3);
}
.grow {
  flex: 1;
}
/* 按钮外观来自 lg-btn（自带 flex: none、不折行） */
.bar .lg-btn,
.state .lg-btn {
  gap: 5px;
}
.tree {
  padding: 12px 14px;
  border-radius: var(--radius-sm, 10px);
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  overflow-x: auto;
}
.state {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 4px;
  font-size: 13px;
  color: var(--ink-2);
}
.state.err {
  color: var(--red);
}
.state.err > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
@media (pointer: coarse) {
  .bar .lg-btn {
    --lg-h: 36px;
  }
}
</style>
