<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ExternalLink } from 'lucide-vue-next'
import type { Ticket } from '@/api/types'
import SeatCells from './SeatCells.vue'
import RouteTimeline from './RouteTimeline.vue'
import { crossDays, durationText, fromMark, kindLabel, minutes, toMark, type Mark } from '@/composables/rail'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useRailStore } from '@/stores/rail'

/**
 * 一趟车（AGENTS.md 7.9「12306 查询页」「结果」，设计稿 V1 / V3）：车次、出发、历时、到达、席别，
 * 行尾「在 12306 打开」和展开按钮；展开后行内显示经停。手机上是卡片，外链只在展开后的底部。
 */
const props = defineProps<{ ticket: Ticket }>()
const { t } = useI18n()
const rail = useRailStore()
const bp = useBreakpoint()

const x = computed(() => props.ticket)
const open = computed(() => rail.expanded.has(rail.rowKey(x.value)))
const days = computed(() => crossDays(x.value.depart, x.value.duration))
const markText = (m: Mark) => t(`rail.mark.${m}`)
const markTip = (m: Mark) => t(`rail.mark.${m}Tip`)
const bodyId = computed(() => `rail-route-${x.value.id}-${x.value.from.code}`)

function toggle(e: MouseEvent) {
  // 行里的链接自己处理
  if ((e.target as HTMLElement).closest('a')) return
  rail.toggleRow(x.value)
}
</script>

<template>
  <article class="row glass" :class="{ open }">
    <div class="main" @click="toggle">
      <div class="train">
        <span class="no mono">{{ x.id }}</span>
        <span class="kind">{{ kindLabel(x.type) }}</span>
      </div>
      <div class="end from">
        <span class="clock mono">{{ x.depart }}</span>
        <span class="st">
          <i class="mark" :class="fromMark(x)" v-tip="markTip(fromMark(x))">{{ markText(fromMark(x)) }}</i>{{ x.from.name }}
        </span>
      </div>
      <div class="dur">
        <span>{{ durationText(minutes(x.duration)) }}</span>
        <i class="arrow" aria-hidden="true" />
      </div>
      <div class="end to">
        <span class="clock mono">
          {{ x.arrive }}<sup v-if="days" class="plus" v-tip="t('rail.time.nextDay', { n: days }, days)">+{{ days }}</sup>
        </span>
        <span class="st">
          <i class="mark" :class="toMark(x)" v-tip="markTip(toMark(x))">{{ markText(toMark(x)) }}</i>{{ x.to.name }}
        </span>
      </div>
      <SeatCells class="seats" :remaining="x.remaining" :prices="x.prices" :bookable="x.bookable" />
      <a v-if="!bp.phone" class="ext" :href="x.url" target="_blank" rel="noopener noreferrer" @click.stop>
        {{ t('rail.open') }}<ExternalLink :size="13" />
      </a>
      <button
        type="button"
        class="toggle"
        :aria-expanded="open"
        :aria-controls="bodyId"
        :aria-label="t(open ? 'rail.route.collapse' : 'rail.route.expand', { train: x.id })"
        @click.stop="rail.toggleRow(x)"
      >
        <ChevronDown :size="17" />
      </button>
    </div>
    <div v-if="open" :id="bodyId" class="body">
      <RouteTimeline :state="rail.routeOf(x)" :vertical="bp.phone" @retry="rail.loadRoute(x, true)" />
      <a v-if="bp.phone" class="ext wide" :href="x.url" target="_blank" rel="noopener noreferrer">
        {{ t('rail.open') }}<ExternalLink :size="14" />
      </a>
    </div>
  </article>
</template>

<style scoped>
.row {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  border: 1px solid transparent;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.row:hover {
  box-shadow: var(--shadow-card), 0 6px 20px #1b1f2e0d;
}
.row.open {
  border-color: color-mix(in srgb, var(--red) 35%, transparent);
}
.main {
  display: grid;
  grid-template-columns: 76px 112px 120px 112px minmax(0, 1fr) auto 36px;
  align-items: center;
  gap: 16px;
  padding: 14px 18px 14px 20px;
  cursor: pointer;
}
.train {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.no {
  font-size: 18px;
  font-weight: 700;
}
.kind {
  font-size: 11px;
  color: var(--ink-3);
}
.end {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.clock {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.3px;
  white-space: nowrap;
}
.plus {
  margin-left: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--red);
  vertical-align: super;
}
.st {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark {
  flex: none;
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
}
.mark.start,
.mark.end {
  background: var(--red-soft);
  color: var(--red);
}
.mark.pass {
  background: var(--hair);
  color: var(--ink-3);
}
.dur {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
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
.toggle {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--hair);
  color: var(--ink-2);
}
.toggle svg {
  transition: transform 0.25s var(--ease-out);
}
.open .toggle {
  background: var(--red-soft);
  color: var(--red);
}
.open .toggle svg {
  transform: rotate(180deg);
}
.body {
  margin: 0 20px;
  padding: 14px 0 16px;
  border-top: 1px solid var(--hair);
}

@media (max-width: 1180px) and (min-width: 641px) {
  .main {
    grid-template-columns: 64px 96px 96px 104px minmax(0, 1fr) 36px;
  }
  .ext {
    display: none;
  }
  .body .ext {
    display: inline-flex;
  }
}

/* ---------- 手机：卡片 ---------- */
@media (max-width: 640px) {
  .main {
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'train train toggle'
      'from dur to'
      'seats seats seats';
    gap: 10px 8px;
    padding: 14px 16px;
  }
  .train {
    grid-area: train;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
  }
  .no {
    font-size: 16px;
  }
  .from {
    grid-area: from;
  }
  .to {
    grid-area: to;
    align-items: flex-end;
  }
  .to .st {
    flex-direction: row;
  }
  .dur {
    grid-area: dur;
    padding: 0 6px;
  }
  .clock {
    font-size: 22px;
  }
  .seats {
    grid-area: seats;
    padding-top: 10px;
    border-top: 1px solid var(--hair);
  }
  .toggle {
    grid-area: toggle;
    width: 32px;
    height: 32px;
  }
  .body {
    margin: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .ext.wide {
    justify-content: center;
    height: 46px;
    border-radius: 23px;
    border: 1px solid var(--ink-3);
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
  }
}
</style>
