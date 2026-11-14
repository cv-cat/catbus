<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info } from 'lucide-vue-next'
import type { Stop } from '@/api/types'
import CatbusLoader from '@/components/CatbusLoader.vue'
import { cnMinutes } from '@/composables/rail'
import type { RouteState } from '@/stores/rail'

/**
 * 经停时间线（AGENTS.md 7.9「12306 查询页」「展开经停」，设计稿 V1 / V3 / V5）：
 * 桌面横向、手机竖向（vertical）；乘车区间（in_range）的点和连线是红色，区间外置灰。
 */
const props = defineProps<{ state: RouteState | null; vertical?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

const stops = computed(() => props.state?.stops ?? [])
const real = (s: string) => (/^\d{1,2}:\d{2}$/.test(s) ? s : null)
/** 始发站写出发时刻，其余写到达时刻 */
const time = (s: Stop, i: number) => (i === 0 ? real(s.depart) : (real(s.arrive) ?? real(s.depart))) ?? '—'
function note(s: Stop, i: number) {
  if (i === 0) return t('rail.route.origin')
  if (i === stops.value.length - 1) return t('rail.route.terminal')
  const m = cnMinutes(s.stopover)
  return m != null ? t('rail.route.stop', { m }) : ''
}
/** 区间的两端画成空心大圆点 */
const edge = (i: number) => {
  const s = stops.value
  if (!s[i]?.in_range) return false
  return !s[i - 1]?.in_range || !s[i + 1]?.in_range
}
/** 连线：这一站到下一站都在区间里才是红色 */
const segOn = (i: number) => Boolean(stops.value[i]?.in_range && stops.value[i + 1]?.in_range)
</script>

<template>
  <div class="route" :class="{ vertical }">
    <div class="head">
      <span class="title">
        {{ t('rail.route.title') }}<template v-if="stops.length"> · {{ t('rail.route.count', { n: stops.length }, stops.length) }}</template>
      </span>
      <span class="legend">{{ t('rail.route.legend') }}</span>
    </div>

    <div v-if="state?.loading" class="msg"><CatbusLoader :size="14" />{{ t('rail.route.loading') }}</div>
    <div v-else-if="state?.error" class="msg err">
      {{ t('rail.route.error') }}
      <button type="button" class="retry" @click.stop="emit('retry')">{{ t('common.action.retry') }}</button>
    </div>
    <div v-else-if="!stops.length" class="msg">{{ t('rail.route.empty') }}</div>

    <div v-else class="track-wrap">
      <ol class="track">
        <li v-for="(s, i) in stops" :key="s.id + i" class="stop" :class="{ on: s.in_range, edge: edge(i) }">
          <span class="name">{{ s.station }}</span>
          <span class="dot-line" aria-hidden="true">
            <i class="seg" :class="{ hide: i === stops.length - 1, on: segOn(i) }" />
            <i class="dot" />
          </span>
          <span class="time mono">{{ time(s, i) }}</span>
          <span class="note">{{ note(s, i) }}</span>
        </li>
      </ol>
    </div>
    <p class="disclaim"><Info :size="12" aria-hidden="true" />{{ t('rail.route.disclaim') }}</p>
  </div>
</template>

<style scoped>
.route {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}
.title {
  font-weight: 700;
  color: var(--ink);
}
.legend {
  color: var(--ink-3);
  font-size: 11px;
}
.msg {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  font-size: 12.5px;
  color: var(--ink-3);
}
.msg.err {
  color: var(--red);
}
.retry {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--hair);
  color: var(--ink);
  font-size: 12px;
}
.track-wrap {
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
  padding-bottom: 4px;
}
.track {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  min-width: 100%;
}
.stop {
  flex: 1 0 92px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  color: var(--ink-3);
}
.stop.on {
  color: var(--ink);
}
.name {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}
.dot-line {
  position: relative;
  width: 100%;
  height: 18px;
  display: grid;
  place-items: center;
}
.seg {
  position: absolute;
  left: 50%;
  width: 100%;
  top: 50%;
  height: 2px;
  margin-top: -1px;
  background: var(--hair);
}
.seg.on {
  background: var(--red);
}
.seg.hide {
  display: none;
}
.dot {
  position: relative;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--detail-bg, #fff);
  border: 2px solid var(--ink-3);
  opacity: 0.6;
}
.on .dot {
  border-color: var(--red);
  opacity: 1;
}
.edge .dot {
  width: 14px;
  height: 14px;
  border-width: 3px;
}
.time {
  font-size: 11.5px;
}
.note {
  font-size: 10.5px;
  color: var(--ink-3);
  min-height: 1em;
}
.disclaim {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: 11px;
  color: var(--ink-3);
}

/* ---------- 手机：竖向 ---------- */
.vertical .track {
  flex-direction: column;
}
.vertical .stop {
  flex: none;
  display: grid;
  grid-template-columns: 46px 22px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 40px;
  text-align: left;
}
.vertical .time {
  order: -2;
  font-size: 12.5px;
}
.vertical .dot-line {
  order: -1;
  height: 100%;
  width: 22px;
}
.vertical .name {
  font-size: 14px;
}
.vertical .seg {
  left: 50%;
  top: 50%;
  width: 2px;
  height: 100%;
  margin: 0 0 0 -1px;
}
.vertical .note {
  font-size: 11.5px;
  text-align: right;
}
.vertical .track-wrap {
  overflow: visible;
}
</style>
