<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Gauge, HardDrive, Link2, ShieldCheck, ShieldOff, Sparkles } from 'lucide-vue-next'
import { useMteamStore } from '@/stores/mteam'
import { currentLocale } from '@/i18n'
import { errorTitle } from '@/i18n/errors'

/** 「我的」页的四块数字（设计稿 Y1）：做种中、时魔、A 值、两步验证 */
const { t } = useI18n()
const m = useMteamStore()

const fmt = (n: number | null | undefined, digits: number) =>
  n == null ? '—' : n.toLocaleString(currentLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
const twoFactorOff = computed(() => m.rate.data?.two_factor === false)
</script>

<template>
  <div class="stats">
    <!-- 做种中 -->
    <section class="card glass" :aria-busy="m.stats.loading">
      <div class="head"><span class="ico"><ArrowUp :size="15" /></span>{{ t('mteam.stats.seeding') }}</div>
      <template v-if="m.stats.loading && !m.stats.data">
        <i class="sk big" /><i class="sk small" />
      </template>
      <div v-else-if="m.stats.error" class="err">
        <span>{{ errorTitle(m.stats.error) }}</span>
        <button type="button" class="retry" @click="m.retryBlock('stats')">{{ t('common.action.retry') }}</button>
      </div>
      <template v-else>
        <div class="value mono">{{ m.stats.data?.seeding ?? '—' }}</div>
        <div class="sub"><ArrowDown :size="12" />{{ t('mteam.stats.leeching', { n: m.stats.data?.leeching ?? '—' }) }}</div>
      </template>
    </section>

    <!-- 时魔 -->
    <section class="card glass" :aria-busy="m.rate.loading">
      <div class="head"><span class="ico"><Sparkles :size="15" /></span>{{ t('mteam.stats.bonus') }}</div>
      <template v-if="m.rate.loading && !m.rate.data">
        <i class="sk big" /><i class="sk small" />
      </template>
      <div v-else-if="m.rate.error" class="err">
        <span>{{ errorTitle(m.rate.error) }}</span>
        <button type="button" class="retry" @click="m.retryBlock('rate')">{{ t('common.action.retry') }}</button>
      </div>
      <template v-else>
        <div class="value mono">{{ fmt(m.rate.data?.per_hour, 2) }}<small>{{ t('mteam.stats.perHour') }}</small></div>
        <div class="sub">
          <HardDrive :size="12" />{{ t('mteam.stats.counted', { n: m.rate.data?.seeding_count ?? '—', size: m.rate.data?.seeding_size_gb != null ? `${fmt(m.rate.data.seeding_size_gb, 1)} GB` : '—' }) }}
        </div>
      </template>
    </section>

    <!-- A 值 -->
    <section class="card glass" :aria-busy="m.rate.loading">
      <div class="head"><span class="ico"><Gauge :size="15" /></span>{{ t('mteam.stats.a') }}</div>
      <template v-if="m.rate.loading && !m.rate.data">
        <i class="sk big" /><i class="sk small" />
      </template>
      <div v-else-if="m.rate.error" class="err"><span>{{ errorTitle(m.rate.error) }}</span></div>
      <template v-else>
        <div class="value mono">{{ fmt(m.rate.data?.a, 2) }}</div>
        <div class="sub">{{ t('mteam.stats.aDesc') }}</div>
      </template>
    </section>

    <!-- 两步验证 -->
    <section class="card glass" :class="{ warn: twoFactorOff }" :aria-busy="m.rate.loading">
      <div class="head">
        <span class="ico"><ShieldOff v-if="twoFactorOff" :size="15" /><ShieldCheck v-else :size="15" /></span>{{ t('mteam.stats.twoFactor') }}
      </div>
      <template v-if="m.rate.loading && !m.rate.data">
        <i class="sk big" /><i class="sk small" />
      </template>
      <div v-else-if="m.rate.error" class="err"><span>{{ errorTitle(m.rate.error) }}</span></div>
      <template v-else>
        <div class="value" :class="{ red: twoFactorOff }">
          {{ m.rate.data?.two_factor == null ? '—' : m.rate.data.two_factor ? t('mteam.stats.on') : t('mteam.stats.off') }}
        </div>
        <a v-if="twoFactorOff" class="sub link" href="https://kp.m-team.cc/usercp?tab=security" target="_blank" rel="noopener noreferrer">
          <Link2 :size="12" />{{ t('mteam.stats.setOnSite') }}
        </a>
        <div v-else class="sub">{{ t('mteam.stats.twoFactorOk') }}</div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}
.card {
  min-height: 116px;
  padding: 16px 18px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card.warn {
  border-color: color-mix(in srgb, var(--red) 35%, transparent);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-2);
}
.ico {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--hair);
  color: var(--ink);
}
.warn .ico {
  background: var(--red-soft);
  color: var(--red);
}
.value {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: var(--ink);
}
.value small {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
}
.value.red {
  color: var(--red);
}
.sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.sub.link {
  color: var(--ink-2);
  text-decoration: none;
  min-height: 24px;
}
.sub.link:hover {
  color: var(--red);
}
.err {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--red);
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
.sk.big {
  width: 60%;
  height: 28px;
}
.sk.small {
  width: 40%;
  height: 12px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
@media (max-width: 1024px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .stats {
    gap: 10px;
  }
  .card {
    min-height: 100px;
    padding: 12px 14px;
  }
  .value {
    font-size: 21px;
  }
  .retry,
  .sub.link {
    min-height: var(--tap);
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
