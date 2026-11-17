<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { currentLocale } from '@/i18n'
import GlassButton from '@/components/ui/GlassButton.vue'
import { DATE_SPAN, addDays, dateOf, inRange, isoOf, monthDay, todayIso } from '@/composables/rail'

/**
 * 日期选择器（AGENTS.md 7.9「12306 查询页」「表单」，设计稿 V5）：月历，只能选今天起 15 天内，
 * 范围外的日子置灰；周一开头。外层决定它是浮层还是底部弹层。
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ pick: [iso: string] }>()
const { t } = useI18n()

const today = todayIso()
const last = addDays(today, DATE_SPAN - 1)
const monthOf = (iso: string) => iso.slice(0, 7)
const first = monthOf(today)
const final = monthOf(last)

const month = ref(monthOf(inRange(props.modelValue) ? props.modelValue : today))
const shift = (n: number) => {
  const d = dateOf(`${month.value}-01`)
  d.setMonth(d.getMonth() + n)
  month.value = isoOf(d).slice(0, 7)
}

const title = computed(() => new Intl.DateTimeFormat(currentLocale(), { year: 'numeric', month: 'long' }).format(dateOf(`${month.value}-01`)))
/** 周一开头的星期名（2024-01-01 是周一） */
const weekdays = computed(() =>
  Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(currentLocale(), { weekday: 'narrow' }).format(new Date(2024, 0, 1 + i))),
)
const cells = computed(() => {
  const start = dateOf(`${month.value}-01`)
  const lead = (start.getDay() + 6) % 7
  const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
  const out: ({ iso: string; day: number; ok: boolean } | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) {
    const iso = `${month.value}-${String(d).padStart(2, '0')}`
    out.push({ iso, day: d, ok: inRange(iso) })
  }
  return out
})
</script>

<template>
  <div class="picker">
    <div class="head">
      <GlassButton icon tone="quiet" :disabled="month <= first" :aria-label="t('rail.date.prevMonth')" @click="shift(-1)">
        <ChevronLeft :size="16" />
      </GlassButton>
      <span class="title">{{ title }}</span>
      <GlassButton icon tone="quiet" :disabled="month >= final" :aria-label="t('rail.date.nextMonth')" @click="shift(1)">
        <ChevronRight :size="16" />
      </GlassButton>
    </div>
    <div class="grid" role="grid" :aria-label="title">
      <span v-for="(w, i) in weekdays" :key="`w${i}`" class="wd" aria-hidden="true">{{ w }}</span>
      <template v-for="(c, i) in cells" :key="i">
        <span v-if="!c" />
        <GlassButton
          v-else
          tone="quiet"
          class="day mono"
          :class="{ today: c.iso === today }"
          :disabled="!c.ok"
          :pressed="c.iso === modelValue"
          :aria-label="monthDay(c.iso)"
          @click="emit('pick', c.iso)"
        >
          {{ c.day }}
        </GlassButton>
      </template>
    </div>
    <div class="foot">
      <span>{{ t('rail.date.todayIs', { date: monthDay(today) }) }}</span>
      <span>{{ t('rail.date.range', { n: DATE_SPAN }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.picker {
  width: 300px;
  max-width: 100%;
  padding: 12px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.title {
  font-size: 14px;
  font-weight: 700;
}
.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.wd {
  text-align: center;
  font-size: 11px;
  color: var(--ink-3);
  padding: 4px 0;
}
/* 外观来自 GlassButton（quiet，选中的那天是 pressed 的红玻璃） */
.day {
  --lg-h: 36px;
  --lg-fg: var(--ink);
  min-width: 0;
  padding: 0;
  border-radius: 10px;
  font-size: 13px;
}
.day.today {
  font-weight: 700;
  box-shadow: inset 0 0 0 1px var(--hair);
}
.day[aria-pressed='true'] {
  --lg-fg: var(--red);
  font-weight: 700;
  box-shadow: var(--lg-edge), var(--lg-shadow);
}
.day:disabled {
  --lg-fg: var(--ink-3);
  cursor: default;
}
.foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hair);
  font-size: 11.5px;
  color: var(--ink-3);
}
@media (max-width: 640px) {
  .picker {
    width: 100%;
    padding: 4px 16px calc(16px + var(--safe-bottom));
  }
  .day {
    --lg-h: 44px;
    font-size: 15px;
  }
}
</style>
