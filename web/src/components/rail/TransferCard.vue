<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock3, ExternalLink } from 'lucide-vue-next'
import type { Transfer, TransferLeg } from '@/api/types'
import SeatCells from './SeatCells.vue'
import { cnMinutes, durationText, minutes, transferDays } from '@/composables/rail'

/**
 * 中转方案卡（AGENTS.md 7.9「12306 查询页」「中转」，设计稿 V4 / V5）：种类标签、中转站、全程时间，
 * 下面是各段（序号、车次、时间与站、席别、「在 12306 打开」），段与段之间一行等候说明。各段不标始 / 终 / 过。
 */
const props = defineProps<{ plan: Transfer }>()
const { t } = useI18n()

const x = computed(() => props.plan)
const clock = (s: string) => s.slice(11, 16)
const days = computed(() => transferDays(x.value))
const legDays = (l: TransferLeg) => Math.round((Date.parse(l.arrive.slice(0, 10)) - Date.parse(l.depart.slice(0, 10))) / 86_400_000) || 0
const legTime = (s: string) => (s.length > 5 ? clock(s) : s)

function waitText(i: number) {
  const a = x.value.legs[i]
  const b = x.value.legs[i + 1]
  const m = cnMinutes(x.value.wait)
  const wait = m != null ? durationText(m) : x.value.wait
  if (x.value.same_train) return t('rail.transfer.waitSameTrain', { station: a?.to ?? x.value.via, wait })
  if (x.value.same_station || !b || a?.to === b.from) return t('rail.transfer.waitSameStation', { station: a?.to ?? x.value.via, wait })
  return t('rail.transfer.waitChange', { from: a?.to ?? '', to: b.from, wait })
}
</script>

<template>
  <article class="plan glass">
    <header class="head">
      <span class="tag" :class="{ same: x.same_train }">{{ t(x.same_train ? 'rail.transfer.sameTrain' : 'rail.transfer.change') }}</span>
      <span v-if="!x.same_station" class="tag warn">{{ t('rail.transfer.changeStation') }}</span>
      <h3 class="via">{{ t('rail.transfer.via', { station: x.via }) }}</h3>
      <span class="spacer" />
      <span class="span mono">
        {{ clock(x.depart) }} <i aria-hidden="true">→</i> {{ clock(x.arrive) }}<sup v-if="days" class="plus">+{{ days }}</sup>
      </span>
      <span class="total">{{ t('rail.transfer.total', { time: durationText(x.duration_minutes) }) }}</span>
    </header>
    <ol class="legs">
      <template v-for="(l, i) in x.legs" :key="l.id + i">
        <li class="leg">
          <span class="idx mono">{{ i + 1 }}</span>
          <span class="no mono">{{ l.id }}</span>
          <span class="end">
            <b class="mono">{{ legTime(l.depart) }}</b>
            <span class="st">{{ l.from }}</span>
          </span>
          <span class="dur">
            <span>{{ durationText(minutes(l.duration)) }}</span>
            <i class="arrow" aria-hidden="true" />
          </span>
          <span class="end">
            <b class="mono">{{ legTime(l.arrive) }}<sup v-if="legDays(l)" class="plus">+{{ legDays(l) }}</sup></b>
            <span class="st">{{ l.to }}</span>
          </span>
          <SeatCells class="seats" inline :remaining="l.remaining" :prices="l.prices" />
          <a v-if="l.url" class="ext" :href="l.url" target="_blank" rel="noopener noreferrer">
            {{ t('rail.open') }}<ExternalLink :size="13" />
          </a>
          <span v-else />
        </li>
        <li v-if="i < x.legs.length - 1" class="wait">
          <Clock3 :size="13" aria-hidden="true" />{{ waitText(i) }}
        </li>
      </template>
    </ol>
  </article>
</template>

<style scoped>
.plan {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  padding: 4px 20px 8px;
}
.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 0 12px;
  border-bottom: 1px solid var(--hair);
}
.tag {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  background: var(--hair);
  color: var(--ink-2);
}
.tag.same {
  background: var(--red-soft);
  color: var(--red);
}
.tag.warn {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ink-3);
}
.via {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.span {
  font-size: 16px;
  font-weight: 700;
}
.span i {
  font-style: normal;
  color: var(--ink-3);
  margin: 0 4px;
}
.total {
  margin-left: 24px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.plus {
  margin-left: 2px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--red);
}
.legs {
  list-style: none;
  margin: 0;
  padding: 0;
}
.leg {
  display: grid;
  grid-template-columns: 22px 54px 76px 96px 96px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}
.idx {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--hair);
  font-size: 11px;
  color: var(--ink-2);
}
.no {
  font-size: 15px;
  font-weight: 700;
}
.end {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.end b {
  font-size: 16px;
  font-weight: 700;
}
.st {
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dur {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
}
.arrow {
  position: relative;
  width: 100%;
  height: 1px;
  background: var(--ink-3);
  opacity: 0.6;
}
.arrow::after {
  content: '';
  position: absolute;
  right: 0;
  top: -3px;
  width: 6px;
  height: 6px;
  border-top: 1px solid var(--ink-3);
  border-right: 1px solid var(--ink-3);
  transform: rotate(45deg);
}
.ext {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--ink-2);
  white-space: nowrap;
  text-decoration: none;
}
.ext:hover {
  color: var(--red);
}
.wait {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 10px;
  padding: 2px 0 2px 26px;
  border-left: 1.5px solid var(--hair);
  font-size: 12px;
  color: var(--ink-2);
}
@media (max-width: 1180px) {
  .leg {
    grid-template-columns: 22px 54px 76px 90px 1fr auto;
    grid-template-areas:
      'idx no from dur to ext'
      '. seats seats seats seats seats';
  }
  .idx { grid-area: idx; }
  .no { grid-area: no; }
  .leg > .end:nth-of-type(3) { grid-area: from; }
  .dur { grid-area: dur; }
  .leg > .end:nth-of-type(5) { grid-area: to; }
  .seats { grid-area: seats; }
  .ext { grid-area: ext; }
}
@media (max-width: 640px) {
  .plan {
    padding: 2px 16px 6px;
  }
  .span {
    font-size: 14.5px;
  }
  .total {
    margin-left: 0;
    flex-basis: 100%;
  }
  .spacer {
    display: none;
  }
  .leg {
    grid-template-columns: 22px auto 1fr auto 1fr;
    grid-template-areas:
      'idx no no ext ext'
      'idx from dur to to'
      '. seats seats seats seats';
    gap: 8px 10px;
  }
  .ext {
    justify-self: end;
  }
}
</style>
