<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ExternalLink, Gift as GiftIcon, ImageOff } from 'lucide-vue-next'
import type { Gift, Item, Rank } from '@/api/types'
import StateView from '@/components/StateView.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { compact, dateTime, duration, number, tintOf } from '@/composables/format'
import { imgSrc } from '@/api/client'
import { useLiveTabsStore, type LiveTab } from '@/stores/liveTabs'
import { useLiveStore } from '@/stores/live'
import { useDetailStore } from '@/stores/detail'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { errorTitle } from '@/i18n/errors'

/** 直播间标签（AGENTS.md 7.9「直播弹幕」）：礼物、榜单、带货商品、回放 */
const props = defineProps<{ tab: Exclude<LiveTab, 'chat'> }>()
const tabs = useLiveTabsStore()
const lv = useLiveStore()
const detail = useDetailStore()
const { t } = useI18n()

const st = computed(() => tabs.state(props.tab))
const gifts = computed(() => (props.tab === 'gifts' ? ((st.value?.data ?? []) as Gift[]) : []))
const ranks = computed(() => (props.tab === 'rank' ? ((st.value?.data ?? []) as Rank[]) : []))
const items = computed(() => (props.tab === 'products' || props.tab === 'replays' ? ((st.value?.data ?? []) as Item[]) : []))
const loadingFirst = computed(() => Boolean(st.value?.loading && !st.value.data.length) || !st.value)
const empty = computed(() => Boolean(st.value?.loaded && !st.value.loading && !st.value.error && !st.value.data.length))

/** 价格：人民币写 ¥，虚拟货币写平台的货币代码 */
function price(p: { amount: number; currency: string } | null | undefined): string {
  if (!p) return ''
  return p.currency === 'CNY' ? `¥${number(p.amount)}` : `${number(p.amount)} ${p.currency}`
}
function itemMeta(it: Item): string {
  if (props.tab === 'products') return price(it.price)
  const d = duration(it.media.find((m) => m.duration != null)?.duration)
  const at = it.created_at ? dateTime(it.created_at, { month: 'short', day: 'numeric' }) : ''
  return [d, at].filter(Boolean).join(' · ')
}

function openItem(it: Item, e: MouseEvent) {
  detail.open({ item: it, platform: lv.platform, account: lv.account(), source: (e.currentTarget as HTMLElement).querySelector('.thumb') as HTMLElement | null })
}

const login = () => openLogin(lv.platform, lv.account() ?? undefined)
const verify = (url: string) =>
  openVerify({ platform: lv.platform, url, message: st.value?.error ? errorTitle(st.value.error) : undefined, retry: () => tabs.refresh(props.tab) })
</script>

<template>
  <div class="tab-panel" role="tabpanel" :aria-busy="st?.loading">
    <div v-if="st?.error && !st.data.length" class="center">
      <StateView kind="error" :error="st.error" @retry="tabs.refresh(props.tab)" @login="login" @verify="verify" />
    </div>
    <p v-else-if="empty" class="empty">{{ t(`live.tabs.empty.${props.tab}`) }}</p>

    <div v-else-if="loadingFirst" class="sk-list" aria-hidden="true">
      <span v-for="i in 6" :key="i" class="sk" />
    </div>

    <ul v-else-if="props.tab === 'gifts'" class="gifts">
      <li v-for="g in gifts" :key="g.id" class="gift">
        <span class="g-ico"><GiftIcon :size="16" /></span>
        <span class="g-name">{{ g.name || g.id }}</span>
        <span v-if="g.price" class="g-price mono">{{ price(g.price) }}</span>
      </li>
    </ul>

    <ol v-else-if="props.tab === 'rank'" class="ranks">
      <li v-for="(r, i) in ranks" :key="`${r.user?.id ?? ''}:${i}`" class="rank">
        <span class="r-no mono" :class="{ top: (r.rank ?? i + 1) <= 3 }">{{ r.rank ?? i + 1 }}</span>
        <UserAvatar class="r-ava" :user="r.user" :style="{ background: tintOf(r.user?.id) }" />
        <span class="r-name">{{ r.user?.name ?? t('live.someone') }}</span>
        <span v-if="r.score != null" class="r-score mono">{{ compact(r.score) }}</span>
      </li>
    </ol>

    <ul v-else class="items">
      <li v-for="it in items" :key="it.id" class="item">
        <button type="button" class="i-main" @click="openItem(it, $event)">
          <span class="thumb" :class="{ wide: props.tab === 'replays' }">
            <img v-if="it.cover" :src="imgSrc(it.cover)" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <ImageOff v-else :size="16" />
          </span>
          <span class="i-text">
            <span class="i-title">{{ it.title || it.text || it.id }}</span>
            <span v-if="itemMeta(it)" class="i-meta" :class="{ price: props.tab === 'products' }">{{ itemMeta(it) }}</span>
          </span>
        </button>
        <a
          v-if="it.url"
          class="i-link"
          :href="it.url"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('live.tabs.open')"
          v-tip="t('live.tabs.open')"
        >
          <ExternalLink :size="14" />
        </a>
      </li>
    </ul>

    <p v-if="props.tab === 'replays' && st?.hasMore" class="more">
      <CatbusLoader v-if="st.loading" :size="14" />
      <button v-else type="button" class="more-btn" @click="tabs.load('replays', true)">{{ t('live.tabs.more') }}</button>
    </p>
  </div>
</template>

<style scoped>
.tab-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 12px;
  scrollbar-width: thin;
  border-top: 1px solid var(--hair);
}
.center {
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 8px;
}
.empty {
  margin: 32px 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-3);
}
.sk-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px;
}
.sk {
  display: block;
  height: 40px;
  border-radius: 10px;
  background: var(--skeleton);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
ul,
ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.gifts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.gift {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  border-radius: 12px;
  background: var(--glass);
  border: 1px solid var(--hair);
  text-align: center;
}
.g-ico {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: color-mix(in srgb, #c98a00 16%, transparent);
  color: #c98a00;
}
.g-name {
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.g-price {
  font-size: 11px;
  color: var(--ink-3);
}
.rank {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-bottom: 1px solid var(--hair);
  font-size: 13px;
}
.rank:last-child {
  border-bottom: 0;
}
.r-no {
  width: 22px;
  flex: none;
  text-align: center;
  font-weight: 700;
  color: var(--ink-3);
}
.r-no.top {
  color: var(--red);
}
.r-ava {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex: none;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.r-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-score {
  flex: none;
  font-size: 12px;
  color: var(--ink-2);
}
.item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 12px;
  transition: background 0.2s;
}
.item:hover {
  background: var(--lg-fill-hover);
}
.i-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.i-main:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
  border-radius: 12px;
}
.thumb {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--skeleton);
  color: var(--ink-3);
}
.thumb.wide {
  width: 88px;
  height: 50px;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.i-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.i-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
}
.i-main:hover .i-title {
  color: var(--red);
}
.i-meta {
  font-size: 12px;
  color: var(--ink-3);
}
.i-meta.price {
  color: var(--red);
  font-weight: 700;
}
.i-link {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--ink-3);
}
.i-link:hover {
  color: var(--red);
  background: var(--lg-fill-hover);
}
.more {
  display: flex;
  justify-content: center;
  margin: 8px 0 0;
}
.more-btn {
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--glass);
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.more-btn:hover {
  color: var(--red);
}
@media (max-width: 640px) {
  .i-link {
    width: 44px;
    height: 44px;
  }
  .more-btn {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
