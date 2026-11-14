<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { CalendarDays, CheckCircle2, GraduationCap, Info } from 'lucide-vue-next'
import type { Exam } from '@/api/types'
import { useMteamStore } from '@/stores/mteam'
import { formatGiB } from '@/data/mteam'
import { dateTime } from '@/composables/format'
import { currentLocale } from '@/i18n'
import { errorTitle } from '@/i18n/errors'

/** 考核（设计稿 Y1）：每项考核一张卡，下载量、上传量、魔力值三项进度 */
const { t } = useI18n()
const m = useMteamStore()

const isBytes = (name: string) => name === 'download' || name === 'upload'
const value = (name: string, n: number | null) =>
  n == null ? '—' : isBytes(name) ? formatGiB(n) : n.toLocaleString(currentLocale(), { maximumFractionDigits: 1 })
const pct = (it: Exam['items'][number]) =>
  it.done ? 100 : it.current == null || !it.target ? 0 : Math.max(0, Math.min(100, (it.current / it.target) * 100))
const lack = (it: Exam['items'][number]) =>
  it.current == null || it.target == null ? '—' : value(it.name, Math.max(0, it.target - it.current))

/** 剩余时间：天 + 小时；不到 3 天时标红 */
function left(e: Exam): { text: string; urgent: boolean } | null {
  const end = e.end_at ? Date.parse(e.end_at) : NaN
  if (Number.isNaN(end)) return null
  const ms = Math.max(0, end - Date.now())
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  return { text: t('mteam.exam.left', { d: days, h: hours }), urgent: ms < 3 * 86_400_000 }
}
const day = (iso: string | null) => dateTime(iso, { month: 'short', day: 'numeric' })
const status = (s: string | null) => (s === 'ONGOING' ? t('mteam.exam.ongoing') : (s ?? ''))
</script>

<template>
  <section class="exam-wrap" :aria-busy="m.exam.loading" :aria-label="t('mteam.exam.label')">
    <div v-if="m.exam.loading && !m.exam.data" class="card glass">
      <i class="sk title" />
      <div class="items"><i v-for="i in 3" :key="i" class="sk bar" /></div>
    </div>
    <div v-else-if="m.exam.error" class="card glass err">
      <span>{{ t('mteam.exam.label') }} · {{ errorTitle(m.exam.error) }}</span>
      <button type="button" class="retry" @click="m.retryBlock('exam')">{{ t('common.action.retry') }}</button>
    </div>
    <div v-else-if="!m.exam.data?.length" class="card glass empty">
      <GraduationCap :size="16" aria-hidden="true" />{{ t('mteam.exam.none') }}
    </div>
    <article v-for="e in m.exam.data ?? []" v-else :key="e.id" class="card glass">
      <header class="top">
        <span class="badge-ico"><GraduationCap :size="16" /></span>
        <h2>{{ e.title || t('mteam.exam.label') }}</h2>
        <span v-if="e.status" class="status">{{ status(e.status) }}</span>
        <span class="spacer" />
        <span class="range">
          <CalendarDays :size="14" aria-hidden="true" />{{ day(e.start_at) }} – {{ day(e.end_at) }}
          <template v-if="left(e)">
            · <b :class="{ urgent: left(e)!.urgent }">{{ left(e)!.text }}</b>
          </template>
        </span>
      </header>
      <div class="items">
        <div v-for="it in e.items" :key="it.name" class="item" :class="{ done: it.done }">
          <div class="row">
            <span class="name">{{ t(`mteam.exam.item.${it.name}`, it.name) }}</span>
            <span v-if="it.done" class="ok"><CheckCircle2 :size="14" />{{ t('mteam.exam.done') }}</span>
            <span v-else class="lack">{{ t('mteam.exam.lack', { v: lack(it) }) }}</span>
          </div>
          <div class="nums mono">
            <b>{{ value(it.name, it.current) }}</b><span> / {{ value(it.name, it.target) }}</span>
          </div>
          <div
            class="bar"
            role="progressbar"
            :aria-valuenow="Math.round(pct(it))"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="t(`mteam.exam.item.${it.name}`, it.name)"
          >
            <i :style="{ width: `${pct(it)}%` }" />
          </div>
        </div>
      </div>
      <p v-if="e.note" class="note"><Info :size="13" aria-hidden="true" />{{ e.note }}</p>
    </article>
  </section>
</template>

<style scoped>
.exam-wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  padding: 18px 20px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
}
.card.empty,
.card.err {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-3);
}
.card.err {
  color: var(--red);
}
.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.badge-ico {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--red-soft);
  color: var(--red);
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.status {
  padding: 2px 9px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--bg, #fff);
  font-size: 11.5px;
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.range {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.urgent {
  color: var(--red);
}
.items {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-top: 16px;
}
.row {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--ink-2);
}
.ok {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink);
  font-weight: 600;
}
.lack {
  color: var(--red);
  font-weight: 600;
}
.nums {
  margin: 4px 0 8px;
  font-size: 13px;
  color: var(--ink-3);
}
.nums b {
  font-size: 17px;
  color: var(--ink);
}
.bar {
  height: 6px;
  border-radius: 999px;
  background: var(--hair);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--red);
  transition: width 0.6s var(--ease-out);
}
.done .bar i {
  background: var(--ink);
}
/* 达标用主色：亮色藏青、暗色红（设计稿 Y1 / Y2） */
[data-theme='dark'] .done .bar i {
  background: var(--red);
}
.note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.retry {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--ink);
  cursor: pointer;
}
.sk {
  display: block;
  border-radius: 6px;
  background: var(--hair);
  animation: pulse 1.2s ease-in-out infinite;
}
.sk.title {
  width: 30%;
  height: 22px;
}
.sk.bar {
  height: 44px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
@media (max-width: 640px) {
  .card {
    padding: 14px;
  }
  .items {
    grid-template-columns: 1fr;
    gap: 14px;
  }
  .range {
    width: 100%;
  }
  .spacer {
    display: none;
  }
  .retry {
    min-height: var(--tap);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
