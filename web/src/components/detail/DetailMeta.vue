<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import CopyCommand from '../tools/CopyCommand.vue'
import type { CatbusError } from '@/api/types'
import { errorDetail, errorTitle } from '@/i18n/errors'

/** 正文之后的一行等价命令（AGENTS.md 7.9「复制等价命令」）和取详情失败的提示，三种正文共用 */
defineProps<{ command: string; error: CatbusError | null }>()
const { t } = useI18n()
</script>

<template>
  <div class="cmd-line rv">
    <code class="mono" :title="command">$ {{ command }}</code>
    <CopyCommand class="lg-quiet" :command="() => command" />
  </div>
  <p v-if="error" class="inline-error rv" :title="errorDetail(error) ?? undefined">{{ t('detail.itemError', { error: errorTitle(error) }) }}</p>
</template>

<style scoped>
.cmd-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 0;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--detail-chip);
  color: var(--ink-3);
  font-size: 12px;
}
.cmd-line code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cmd-line .copy-cmd {
  --lg-h: 24px;
}
.inline-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
</style>
