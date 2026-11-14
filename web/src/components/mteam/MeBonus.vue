<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Coins } from 'lucide-vue-next'
import SettingSwitch from '@/components/settings/SettingSwitch.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import type { BonusRecord, Item } from '@/api/types'
import { useMteamStore, MTEAM_ID } from '@/stores/mteam'
import { useDetailStore } from '@/stores/detail'
import { useSentinel } from '@/composables/sentinel'
import { dateTime } from '@/composables/format'
import { currentLocale } from '@/i18n'
import { errorTitle } from '@/i18n/errors'

/** 魔力流水（设计稿 Y1）：按天分组；只看魔力变动只在页面里过滤；有 url 的行点开相关种子 */
const { t } = useI18n()
const m = useMteamStore()
const detail = useDetailStore()

const dayKey = (iso: string | null) => (iso ? new Date(iso).toDateString() : '')
function dayLabel(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return t('mteam.bonus.today')
  if (d.toDateString() === yest.toDateString()) return t('mteam.bonus.yesterday')
  return dateTime(d, { month: 'short', day: 'numeric', weekday: 'short' })
}
const groups = computed(() => {
  const out: { key: string; label: string; rows: BonusRecord[] }[] = []
  for (const r of m.bonusShown) {
    const k = dayKey(r.time)
    let g = out[out.length - 1]
    if (!g || g.key !== k) out.push((g = { key: k, label: dayLabel(r.time), rows: [] }))
    g.rows.push(r)
  }
  return out
})
const time = (iso: string | null) => dateTime(iso, { hour: '2-digit', minute: '2-digit', hour12: false })
const change = (n: number | null) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString(currentLocale(), { maximumFractionDigits: 2 })}`

/** 相关种子的详情：只知道 id 和链接，详情卡片随后 item get 补全 */
function openTorrent(r: BonusRecord, el: HTMLElement) {
  if (!r.url) return
  const id = /\/detail\/(\d+)/.exec(r.url)?.[1] ?? r.url
  const item: Item = {
    id,
    kind: 'torrent',
    url: r.url,
    title: null,
    text: null,
    author: null,
    created_at: null,
    cover: null,
    media: [],
    stats: { views: null, likes: null, comments: null, collects: null, shares: null },
    price: null,
    status: null,
  }
  detail.open({ item, platform: MTEAM_ID, account: m.account?.account ?? null, source: el })
}

const box = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
const recheck = useSentinel(sentinel, () => void m.loadBonus(true), box)
// 过滤后不够一屏时自动再翻
watch(() => [m.bonus.items.length, m.onlyChange], () => recheck())
</script>

<template>
  <section class="bonus glass" :aria-label="t('mteam.bonus.title')">
    <header class="head">
      <h2>{{ t('mteam.bonus.title') }}</h2>
      <span class="spacer" />
      <label class="toggle">
        <SettingSwitch v-model="m.onlyChange" :aria-label="t('mteam.bonus.onlyChange')" />
        <span>{{ t('mteam.bonus.onlyChange') }}</span>
      </label>
    </header>

    <div v-if="!m.bonus.loading && m.bonus.error" class="state err">
      <span>{{ errorTitle(m.bonus.error) }}</span>
      <button type="button" class="retry" @click="m.loadBonus()">{{ t('common.action.retry') }}</button>
    </div>
    <div v-else-if="m.bonus.loading && !m.bonus.items.length" class="box" aria-hidden="true">
      <i v-for="i in 6" :key="i" class="sk" />
    </div>
    <div v-else ref="box" class="box" :class="{ stale: m.bonus.loading }">
      <div v-if="m.bonus.loaded && !m.bonusShown.length && !m.bonus.hasMore" class="state empty">
        <Coins :size="18" aria-hidden="true" />{{ m.onlyChange ? t('mteam.bonus.emptyChange') : t('mteam.bonus.empty') }}
      </div>
      <div v-for="g in groups" :key="g.key" class="group">
        <div class="day">{{ g.label }}</div>
        <component
          :is="r.url ? 'button' : 'div'"
          v-for="r in g.rows"
          :key="r.id"
          :type="r.url ? 'button' : undefined"
          class="rec"
          :class="{ link: !!r.url }"
          @click="r.url && openTorrent(r, $event.currentTarget as HTMLElement)"
        >
          <span class="time mono">{{ time(r.time) }}</span>
          <span class="note">{{ r.note || r.type || '—' }}</span>
          <span class="chg mono" :class="{ zero: !r.change, neg: (r.change ?? 0) < 0, pos: (r.change ?? 0) > 0 }">{{ change(r.change) }}</span>
        </component>
      </div>
      <div ref="sentinel" class="sentinel" aria-hidden="true" />
      <div v-if="m.bonus.loadingMore" class="more"><CatbusLoader :size="16" :label="t('common.state.loading')" /></div>
    </div>
    <p class="foot">{{ t('mteam.bonus.foot') }}</p>
  </section>
</template>

<style scoped>
.bonus {
  display: flex;
  flex-direction: column;
  padding: 18px 20px 12px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
}
.box {
  max-height: 460px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.box.stale {
  opacity: 0.5;
}
.day {
  position: sticky;
  top: 0;
  padding: 8px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
  background: var(--glass-strong);
  backdrop-filter: blur(12px);
  z-index: 1;
}
.rec {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  width: 100%;
  padding: 9px 4px;
  border: none;
  border-bottom: 1px solid var(--hair);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
}
.rec.link {
  cursor: pointer;
  border-radius: 8px;
}
.rec.link:hover {
  background: var(--hair);
}
.rec.link:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: -2px;
}
.time {
  font-size: 12px;
  color: var(--ink-3);
  padding-top: 1px;
}
.note {
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.chg {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.chg.zero {
  color: var(--ink-3);
}
.chg.pos {
  font-weight: 700;
}
.chg.neg {
  color: var(--red);
  font-weight: 700;
}
.foot {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
}
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 0;
  font-size: 13px;
  color: var(--ink-3);
}
.state.err {
  color: var(--red);
}
.retry {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--ink);
  cursor: pointer;
}
.sentinel {
  height: 1px;
}
.more {
  display: grid;
  place-items: center;
  padding: 10px;
}
.sk {
  display: block;
  height: 36px;
  margin: 8px 0;
  border-radius: 8px;
  background: var(--hair);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
@media (max-width: 640px) {
  .bonus {
    padding: 14px 12px 10px;
  }
  .toggle,
  .retry {
    min-height: var(--tap);
  }
  .rec {
    min-height: var(--tap);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
