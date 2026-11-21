<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { number } from '@/composables/format'

/**
 * 跳动的数字：每一位是一条 0–9 的竖条，数值变化时各位滚到新的数字（直播页的在线人数、点赞数）。
 * 位数从右往左对齐，位数变化时已有的位不重建；变大时短暂泛红、变小时泛灰。减少动效时直接换数字。
 */
const props = defineProps<{ value: number }>()

const text = computed(() => number(props.value))
/** 从右往左编号，位数变化时同一位的 key 不变，滚动才连续 */
const chars = computed(() => {
  const s = [...text.value]
  return s.map((c, i) => ({ c, key: s.length - i, digit: /\d/.test(c) ? Number(c) : null }))
})

const trend = ref<'up' | 'down' | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
watch(
  () => props.value,
  (v, old) => {
    if (old == null || v === old) return
    trend.value = v > old ? 'up' : 'down'
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => (trend.value = null), 700)
  },
)
</script>

<template>
  <span class="roll" :class="trend" :aria-label="text" role="text">
    <span v-for="ch in chars" :key="ch.key" class="cell" :class="{ digit: ch.digit != null }" aria-hidden="true">
      <span v-if="ch.digit != null" class="strip" :style="{ '--d': ch.digit }">
        <span v-for="d in 10" :key="d">{{ d - 1 }}</span>
      </span>
      <span v-else class="sep">{{ ch.c }}</span>
    </span>
  </span>
</template>

<style scoped>
.roll {
  display: inline-flex;
  font-variant-numeric: tabular-nums;
  line-height: 1.2em;
  height: 1.2em;
  overflow: hidden;
  transition: color 0.5s var(--ease-out);
}
.roll.up {
  color: var(--red);
}
.roll.down {
  color: var(--ink-3);
}
.cell {
  position: relative;
  display: inline-block;
  height: 1.2em;
  overflow: hidden;
}
/*
 * 竖条里每个数字占两倍格高、上下留空，格子只露出中间那一格：滚动途中露出的是数字之间的空白，
 * 不会同时出现上一个数字的下半截和下一个数字的上半截（看起来像两个数字叠在一起）。
 * 上下两边再渐隐一点；字形本身在中间 22%–78% 里，静止时不受影响
 */
.cell.digit {
  mask-image: linear-gradient(to bottom, transparent, #000 22%, #000 78%, transparent);
}
.strip {
  display: flex;
  flex-direction: column;
  transform: translateY(calc(var(--d) * -2.4em - 0.6em));
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
.strip > span {
  display: block;
  height: 2.4em;
  line-height: 2.4em;
  text-align: center;
}
.sep {
  display: block;
  height: 1.2em;
  text-align: center;
}
@media (prefers-reduced-motion: reduce) {
  .strip {
    transition: none;
  }
}
</style>
