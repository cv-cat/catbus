<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SquareTerminal } from 'lucide-vue-next'
import { copyCommand } from '@/composables/command'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 复制等价命令的小按钮（AGENTS.md 7.9「复制等价命令」）：点了才生成命令。
 * 外观是透明玻璃圆按钮（GlassButton icon sm）；放在行内密集处的调用方可以加 class="lg-quiet"。
 */
const props = defineProps<{ command: () => string; size?: number }>()
const { t } = useI18n()
</script>

<template>
  <GlassButton icon size="sm" class="copy-cmd" :aria-label="t('common.command.copy')" v-tip="t('common.command.copy')" @click="copyCommand(props.command())">
    <SquareTerminal :size="size ?? 13" aria-hidden="true" />
  </GlassButton>
</template>
