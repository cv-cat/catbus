<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers, Star } from 'lucide-vue-next'
import AppSelect, { type SelectOption } from '@/components/AppSelect.vue'
import { MTEAM_MODES, type MteamMode } from '@/api/mteam'
import type { Item } from '@/api/types'
import { useMteamStore, MTEAM_ID } from '@/stores/mteam'
import { useDetailStore } from '@/stores/detail'
import { useSettingsStore } from '@/stores/settings'
import { torrentInfo } from '@/composables/torrent'
import { errorTitle } from '@/i18n/errors'

/** 收藏（设计稿 Y1 / Y10）：按分区，种子海报小卡横排；只读 */
const { t } = useI18n()
const m = useMteamStore()
const detail = useDetailStore()
const { settings } = useSettingsStore()

const options = computed<SelectOption<MteamMode>[]>(() =>
  MTEAM_MODES.filter((x) => x !== 'adult' || settings.mteamAdult).map((x) => ({ value: x, label: t(`filters.mteam.mode.${x}`) })),
)
const mode = computed({ get: () => m.collectsMode, set: (v: MteamMode) => m.setCollectsMode(v) })

const els = new Map<string, HTMLElement>()
function open(it: Item) {
  detail.open({
    item: it,
    platform: MTEAM_ID,
    account: m.account?.account ?? null,
    source: els.get(it.id) ?? null,
    nav: { items: () => m.fav.items, sourceOf: (id) => els.get(id) ?? null },
  })
}
</script>

<template>
  <section class="fav glass" :aria-label="t('mteam.collects.title')">
    <header class="head">
      <h2>{{ t('mteam.collects.title') }}</h2>
      <span class="spacer" />
      <AppSelect v-model="mode" :options="options" :title="t('mteam.collects.mode')" :label="t('mteam.collects.mode')" />
    </header>
    <div v-if="!m.fav.loading && m.fav.error" class="state err">
      <span>{{ errorTitle(m.fav.error) }}</span>
      <button type="button" class="retry" @click="m.loadFav()">{{ t('common.action.retry') }}</button>
    </div>
    <div v-else-if="m.fav.loading && !m.fav.items.length" class="strip" aria-hidden="true">
      <i v-for="i in 4" :key="i" class="sk" />
    </div>
    <div v-else-if="!m.fav.items.length" class="state empty">
      <span class="star"><Star :size="20" aria-hidden="true" /></span>
      <b>{{ t('mteam.collects.empty') }}</b>
      <span>{{ t('mteam.collects.emptyDesc') }}</span>
    </div>
    <div v-else class="strip" :class="{ stale: m.fav.loading }">
      <button
        v-for="it in m.fav.items"
        :key="it.id"
        :ref="(el) => (el ? els.set(it.id, el as HTMLElement) : els.delete(it.id))"
        type="button"
        class="card"
        :title="it.title ?? ''"
        @click="open(it)"
      >
        <span class="cover">
          <img v-if="it.cover" :src="it.cover" alt="" loading="lazy" referrerpolicy="no-referrer" />
          <Layers v-else :size="20" aria-hidden="true" />
          <span v-if="torrentInfo(it)?.discount" class="disc" :class="{ free: torrentInfo(it)!.free }">{{ torrentInfo(it)!.discount }}</span>
        </span>
        <span class="name">{{ torrentInfo(it)?.title }}</span>
        <span class="size mono">{{ torrentInfo(it)?.size ?? '' }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.fav {
  padding: 18px 20px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.strip {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.strip.stale {
  opacity: 0.5;
}
.card {
  flex: none;
  width: 104px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.cover {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  overflow: hidden;
  background: var(--hair);
  color: var(--ink-3);
  transition: box-shadow 0.2s;
}
.card:hover .cover,
.card:focus-visible .cover {
  box-shadow: 0 0 0 2px var(--red);
}
.card:focus-visible {
  outline: none;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.disc {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--ink);
  color: var(--bg, #fff);
  font-size: 10px;
  font-weight: 700;
}
.disc.free {
  background: var(--red);
  color: #fff;
}
.name {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.35;
}
.size {
  font-size: 11px;
  color: var(--ink-3);
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 24px 0;
  font-size: 12.5px;
  color: var(--ink-3);
  text-align: center;
}
.state b {
  font-size: 14px;
  color: var(--ink);
}
.state.err {
  flex-direction: row;
  justify-content: center;
  color: var(--red);
}
.star {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--hair);
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
.sk {
  flex: none;
  width: 104px;
  aspect-ratio: 2 / 3;
  border-radius: 10px;
  background: var(--hair);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
@media (max-width: 640px) {
  .fav {
    padding: 14px 12px;
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
