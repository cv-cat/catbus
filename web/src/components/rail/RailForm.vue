<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight, CalendarDays, ChevronDown, Search } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import StationField from './StationField.vue'
import DatePicker from './DatePicker.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { DATE_STRIP, addDays, dayLabel, monthDay, shortDate, todayIso, weekday } from '@/composables/rail'
import { wave } from '@/composables/motion'
import { useRailStore } from '@/stores/rail'

/**
 * 查询表单（AGENTS.md 7.9「12306 查询页」「表单」，设计稿 V1 / V3）：出发站、交换、到达站、日期、「查询」，
 * 下面是从今天起 9 天的日期条和「更多日期」。
 */
const { t } = useI18n()
const rail = useRailStore()
const bp = useBreakpoint()

const strip = computed(() => Array.from({ length: DATE_STRIP }, (_, i) => addDays(todayIso(), i)))

const shakeFrom = ref(0)
const shakeTo = ref(0)
function submit() {
  wave()
  const missing = rail.submit()
  if (missing === 'from') shakeFrom.value++
  else if (missing === 'to') shakeTo.value++
}

/** 交换按钮：转半圈 */
const swapBtn = ref<HTMLElement>()
function swap() {
  rail.swap()
  swapBtn.value?.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(180deg)' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
}

// ---------- 日期选择器：桌面是浮层，手机是底部弹层 ----------
const picker = ref(false)
const pop = ref<HTMLElement>()
function pick(iso: string) {
  picker.value = false
  rail.setDate(iso)
}
function onDocDown(e: PointerEvent) {
  const el = e.target as HTMLElement
  if (pop.value?.contains(el) || el.closest('[data-date-trigger]')) return
  picker.value = false
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') picker.value = false
}
watch(picker, (on) => {
  if (bp.phone) return
  if (on) {
    document.addEventListener('pointerdown', onDocDown, true)
    document.addEventListener('keydown', onDocKey)
  } else {
    document.removeEventListener('pointerdown', onDocDown, true)
    document.removeEventListener('keydown', onDocKey)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocDown, true)
  document.removeEventListener('keydown', onDocKey)
})
</script>

<template>
  <form class="form glass" @submit.prevent="submit">
    <div class="fields">
      <div class="stations">
        <StationField
          v-model="rail.form.from"
          :label="t('rail.form.from')"
          :sheet-title="t('rail.form.pickFrom')"
          :shake="shakeFrom"
          @enter="submit"
        />
        <button ref="swapBtn" type="button" class="swap" :aria-label="t('rail.form.swap')" v-tip="t('rail.form.swap')" @click="swap">
          <ArrowLeftRight :size="17" />
        </button>
        <StationField
          v-model="rail.form.to"
          :label="t('rail.form.to')"
          :sheet-title="t('rail.form.pickTo')"
          :shake="shakeTo"
          @enter="submit"
        />
      </div>
      <button type="button" class="date-field" data-date-trigger :aria-expanded="picker" @click="picker = !picker">
        <span v-if="!bp.phone" class="label">{{ t('rail.form.date') }}</span>
        <span class="date-value">
          <b>{{ monthDay(rail.form.date) }}</b><span class="wd">{{ weekday(rail.form.date) }}</span>
        </span>
        <CalendarDays :size="19" class="cal" aria-hidden="true" />
      </button>
      <button v-if="!bp.phone" type="submit" class="go">
        <Search :size="18" />{{ t('rail.form.submit') }}
      </button>
    </div>

    <div class="strip-row">
      <div class="strip" role="group" :aria-label="t('rail.form.date')">
        <button
          v-for="d in strip"
          :key="d"
          type="button"
          class="day"
          :class="{ on: d === rail.form.date }"
          :aria-pressed="d === rail.form.date"
          @click="rail.setDate(d)"
        >
          <span class="day-label">{{ dayLabel(d) }}</span>
          <span class="day-date mono">{{ shortDate(d) }}</span>
        </button>
      </div>
      <button v-if="!bp.phone" type="button" class="more" data-date-trigger :aria-expanded="picker" @click="picker = !picker">
        <CalendarDays :size="15" />{{ t('rail.date.more') }}<ChevronDown :size="14" class="chev" />
      </button>
    </div>

    <button v-if="bp.phone" type="submit" class="go wide">
      <Search :size="18" />{{ t('rail.form.submit') }}
    </button>

    <Transition name="pop">
      <div v-if="picker && !bp.phone" ref="pop" class="date-pop">
        <DatePicker :model-value="rail.form.date" @pick="pick" />
      </div>
    </Transition>
    <BottomSheet v-if="bp.phone" :open="picker" :label="t('rail.form.date')" @close="picker = false">
      <h2 class="sheet-title">{{ t('rail.form.date') }}</h2>
      <DatePicker :model-value="rail.form.date" @pick="pick" />
    </BottomSheet>
  </form>
</template>

<style scoped>
.form {
  position: relative;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: var(--radius-xl, 24px);
  box-shadow: var(--shadow-card);
}
.fields {
  display: flex;
  align-items: stretch;
  gap: 12px;
}
.stations {
  flex: 2.4;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.swap {
  flex: none;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--glass-strong);
  box-shadow: var(--shadow-card);
  color: var(--ink-2);
}
.swap:hover {
  color: var(--red);
}
.date-field {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 4px;
  padding: 10px 16px;
  border-radius: var(--radius-md);
  background: var(--glass-strong);
  text-align: left;
  color: var(--ink);
}
.date-field .label {
  grid-column: 1;
  font-size: 11px;
  color: var(--ink-3);
}
.date-value {
  grid-column: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
  white-space: nowrap;
}
.date-value b {
  font-size: 20px;
  font-weight: 700;
}
.wd {
  font-size: 12.5px;
  color: var(--ink-2);
}
.cal {
  grid-column: 2;
  grid-row: 1 / 3;
  color: var(--ink-2);
}
.go {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 136px;
  padding: 0 24px;
  border-radius: var(--radius-md);
  background: var(--primary-btn, #232838);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  box-shadow: 0 10px 24px #23283840;
  transition: transform 0.15s, box-shadow 0.2s;
}
.go:hover {
  transform: translateY(-1px);
}
.go:active {
  transform: translateY(1px);
}
.strip-row {
  display: flex;
  align-items: stretch;
  gap: 12px;
}
.strip {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px;
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  color: var(--ink);
}
.day:hover {
  background: var(--hair);
}
.day-label {
  font-size: 11px;
  color: var(--ink-3);
}
.day-date {
  font-size: 14.5px;
  font-weight: 600;
}
.day.on {
  background: var(--red-soft);
  border-color: color-mix(in srgb, var(--red) 45%, transparent);
  color: var(--red);
}
.day.on .day-label {
  color: var(--red);
}
.more {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--hair);
  font-size: 13px;
  color: var(--ink-2);
}
.more:hover {
  background: var(--hair);
}
.chev {
  color: var(--ink-3);
}
.date-pop {
  position: absolute;
  top: 98px;
  right: 20px;
  z-index: 30;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--detail-bg) 94%, transparent);
  box-shadow: var(--shadow-panel), 0 18px 44px #1b1f2e1f;
  backdrop-filter: blur(30px) saturate(1.6);
}
.sheet-title {
  margin: 6px 16px 4px;
  font-size: 17px;
  font-weight: 700;
}
.pop-enter-active {
  transition: opacity 0.18s ease-out, transform 0.22s var(--ease-out);
}
.pop-leave-active {
  transition: opacity 0.12s ease-in;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1024px) {
  .fields {
    flex-wrap: wrap;
  }
  .stations {
    flex: 1 1 100%;
  }
  .go {
    flex: 1;
  }
}
@media (max-width: 640px) {
  .form {
    gap: 12px;
    padding: 16px;
  }
  .fields {
    flex-direction: column;
    gap: 10px;
  }
  .stations {
    flex: none;
  }
  .date-field {
    min-height: 50px;
  }
  .date-value b {
    font-size: 18px;
  }
  .strip {
    display: flex;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -16px;
    padding: 0 16px;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .day {
    flex: none;
    min-width: 60px;
    min-height: 50px;
  }
  .go.wide {
    width: 100%;
    height: 50px;
    border-radius: 25px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
