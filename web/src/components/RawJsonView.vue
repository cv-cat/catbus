<script setup lang="ts">
import { computed, ref } from 'vue'
import { Braces, ChevronsDownUp, ChevronsUpDown, Copy, RotateCw } from 'lucide-vue-next'
import JsonNode from './JsonNode.vue'
import CatbusLoader from './CatbusLoader.vue'
import { copyText } from '@/stores/toast'
import type { CatbusError } from '@/api/types'

/**
 * 详情卡片里的原始 JSON 视图（设置「实验性」→ 显示原始 JSON）：`item get --raw` 的 data。
 * 等宽字体、可折叠，「复制」复制整段格式化后的 JSON。
 */
const props = defineProps<{ value: unknown; loading: boolean; error: CatbusError | null }>()
const emit = defineEmits<{ retry: [] }>()

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
  <section class="raw" aria-label="原始 JSON">
    <div class="bar">
      <span class="label"><Braces :size="14" aria-hidden="true" />原始 JSON<small v-if="!loading && !error && value !== undefined" class="mono">{{ size }}</small></span>
      <span class="grow" />
      <template v-if="!loading && !error && value !== undefined">
        <button type="button" title="全部展开" aria-label="全部展开" @click="expandAll"><ChevronsUpDown :size="14" /></button>
        <button type="button" title="全部折叠" aria-label="全部折叠" @click="collapseAll"><ChevronsDownUp :size="14" /></button>
        <button type="button" class="copy" @click="copyText(text)"><Copy :size="13" aria-hidden="true" />复制</button>
      </template>
    </div>
    <div v-if="loading" class="state"><CatbusLoader :size="18" label="加载中" /><span>正在取平台的原始对象…</span></div>
    <div v-else-if="error" class="state err">
      <span>{{ error.message }}</span>
      <button type="button" class="copy" @click="emit('retry')"><RotateCw :size="13" aria-hidden="true" />重试</button>
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
.bar button,
.state button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  border-radius: 14px;
  font-size: 12px;
  color: var(--ink-2);
  background: var(--detail-chip);
  border: 1px solid var(--hair);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
  /* 旁边的错误信息很长时按钮不被挤窄、文字不折行 */
  flex: none;
  white-space: nowrap;
}
.bar button.copy,
.state button.copy {
  padding: 0 11px;
}
.bar button:hover,
.state button:hover {
  color: var(--red);
  border-color: var(--red);
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
  .bar button {
    height: 36px;
    min-width: 36px;
  }
}
</style>
