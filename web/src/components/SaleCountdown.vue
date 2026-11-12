<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 开售倒计时（演出详情底部，AGENTS.md 7.9「演出详情」，设计稿 N）。
 * 不到一天显示时分秒，超过一天显示天时分；已开售只写「已开售」；没有开售时间时显示站点的文案。
 */
const props = defineProps<{ at: number | null; text?: string | null }>()

const now = ref(Date.now())
let timer = 0
onMounted(() => (timer = window.setInterval(() => (now.value = Date.now()), 1000)))
onBeforeUnmount(() => clearInterval(timer))

const p2 = (n: number) => String(n).padStart(2, '0')
const left = computed(() => (props.at == null ? null : Math.max(0, Math.floor((props.at - now.value) / 1000))))
const cells = computed(() => {
  const s = left.value
  if (!s) return []
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0
    ? [[String(d), '天'], [p2(h), '时'], [p2(m), '分']]
    : [[p2(h), '时'], [p2(m), '分'], [p2(s % 60), '秒']]
})
const when = computed(() => {
  if (props.at == null) return ''
  const d = new Date(props.at)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}`
})
</script>

<template>
  <span v-if="cells.length" class="countdown" role="timer" :aria-label="`距开售 ${cells.map((c) => c.join('')).join('')}`">
    <small>距开售 · {{ when }}</small>
    <span class="digits" aria-hidden="true">
      <template v-for="[v, u] in cells" :key="u">
        <b class="mono">{{ v }}</b><i>{{ u }}</i>
      </template>
    </span>
  </span>
  <span v-else-if="left === 0 || text" class="plain">{{ left === 0 ? '已开售' : text }}</span>
</template>

<style scoped>
.countdown {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
small {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}
.digits {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
b {
  min-width: 26px;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--hair);
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
i {
  font-style: normal;
  font-size: 11px;
  color: var(--ink-3);
}
.plain {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
  white-space: nowrap;
}
</style>
