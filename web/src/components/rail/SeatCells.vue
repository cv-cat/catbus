<script setup lang="ts">
import { computed } from 'vue'
import type { Remaining } from '@/api/types'
import { seatCells, yuan } from '@/composables/rail'

/**
 * 席别格（AGENTS.md 7.9「12306 查询页」「结果」）：按这一趟车自己的席别从左排，
 * 席别名、余票（≤ 9 张标红，无票置灰）、票价。inline 时余票和票价排在一行（中转方案）。
 */
// 布尔 prop 不传时 Vue 会给 false：中转段没有 bookable，默认按可订
const props = withDefaults(
  defineProps<{
    remaining: Record<string, Remaining>
    prices: Record<string, { amount: number; currency: string }>
    bookable?: boolean
    inline?: boolean
  }>(),
  { bookable: true, inline: false },
)
const cells = computed(() => seatCells({ remaining: props.remaining, prices: props.prices, bookable: props.bookable }))
</script>

<template>
  <ul class="seats" :class="{ inline }">
    <li v-for="c in cells" :key="c.name" class="seat" :class="{ none: c.none, low: c.low }">
      <span class="name">{{ c.name }}</span>
      <span class="val">
        <b class="left">{{ c.text }}</b>
        <span v-if="c.price != null" class="price mono">{{ yuan(c.price) }}</span>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.seats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 6px 12px;
}
.seat {
  flex: 1 1 0;
  max-width: 96px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.inline .seat {
  max-width: 120px;
}
.name {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.val {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.inline .val {
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
}
.left {
  font-size: 15px;
  font-weight: 700;
  color: var(--ink);
  white-space: nowrap;
}
.inline .left {
  font-size: 13.5px;
}
.price {
  font-size: 11.5px;
  color: var(--ink-3);
}
.low .left {
  color: var(--red);
}
.none .left,
.none .price,
.none .name {
  color: var(--ink-3);
  opacity: 0.6;
}
.none .left {
  font-weight: 500;
}
@media (max-width: 640px) {
  .seats {
    flex-wrap: wrap;
  }
  .seat {
    flex: 0 0 calc((100% - 36px) / 4);
  }
  .left {
    font-size: 14px;
  }
}
</style>
