<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, BellRing } from 'lucide-vue-next'
import GlassButton from '@/components/ui/GlassButton.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import { useSubsStore } from '@/stores/subs'
import type { SubKind } from '@/api/subs'

/**
 * 订阅 / 已订阅（AGENTS.md 7.9「订阅」）：发现页订阅当前渠道的关键词，作者页订阅这位作者。
 * 已订阅时再点一次取消订阅。平台不支持这种订阅时不显示。
 */
const props = defineProps<{ platform: string; kind: SubKind; query: string | null; label?: string | null; size?: 'sm' | 'md' | 'lg' }>()
const subs = useSubsStore()
const { t } = useI18n()

const q = computed(() => props.query?.trim() || null)
const show = computed(() => !!q.value && subs.can(props.platform, props.kind))
const on = computed(() => !!q.value && !!subs.find(props.platform, props.kind, q.value))
const busy = computed(() => !!q.value && subs.pending.has(`${props.platform}\n${props.kind}\n${q.value}`))
const tip = computed(() => (on.value ? t('subs.button.unsubscribe') : props.kind === 'keyword' ? t('subs.button.tipKeyword') : t('subs.button.tipAuthor')))

function click() {
  if (q.value) void subs.toggle(props.platform, props.kind, q.value, props.label ?? q.value)
}
</script>

<template>
  <GlassButton
    v-if="show"
    v-tip="tip"
    class="sub-btn"
    :class="{ on }"
    :size="size ?? 'sm'"
    :pressed="on"
    :aria-busy="busy || undefined"
    @click="click"
  >
    <CatbusLoader v-if="busy" :size="13" />
    <BellRing v-else-if="on" :size="14" aria-hidden="true" />
    <Bell v-else :size="14" aria-hidden="true" />
    {{ on ? t('subs.button.subscribed') : t('subs.button.subscribe') }}
  </GlassButton>
</template>

<style scoped>
.sub-btn {
  flex: none;
  gap: 6px;
  white-space: nowrap;
}
.sub-btn.on {
  --lg-fg: var(--red);
}
</style>
