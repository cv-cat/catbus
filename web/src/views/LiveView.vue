<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, Compass, Download, Gift, Heart, LogIn, Menu, MessageSquare, Pause, Play, Radio, RefreshCw, Square, UserPlus, Users, DoorOpen, Sparkles } from 'lucide-vue-next'
import AppSelect from '@/components/AppSelect.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StateView from '@/components/StateView.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import RollingNumber from '@/components/RollingNumber.vue'
import EmojiText from '@/components/EmojiText.vue'
import LiveDiscover from '@/components/live/LiveDiscover.vue'
import LiveTabPanel from '@/components/live/LiveTabPanel.vue'
import { useLiveTabsStore } from '@/stores/liveTabs'
import { useLiveDiscoverStore } from '@/stores/liveDiscover'
import { LIVE_DURATIONS, LIVE_TYPES, useLiveStore, type LiveDuration, type LiveType } from '@/stores/live'
import { useNavStore } from '@/stores/nav'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { usePageSections } from '@/composables/sections'
import { dateTime } from '@/composables/format'
import { platformById } from '@/data/platforms'
import { errorTitle } from '@/i18n/errors'

// 直播画面单独成块（mpegts.js 另外按需加载）；进直播页时先取好，开始监听时不用等
const loadPlayer = () => import('@/components/LivePlayer.vue')
const LivePlayer = defineAsyncComponent(loadPlayer)
void loadPlayer().catch(() => {})

/** 直播弹幕（AGENTS.md 7.9「直播弹幕」）：直播间输入、头部、事件流（暂停、按类型过滤、导出 jsonl） */
const lv = useLiveStore()
const tabs = useLiveTabsStore()
const disc = useLiveDiscoverStore()
const nav = useNavStore()
const bp = useBreakpoint()
const { t } = useI18n()

const platform = computed(() => platformById(lv.platform)!)
const { options: sections, model: section } = usePageSections(() => lv.platform, () => 'live')
const running = computed(() => lv.status === 'connecting' || lv.status === 'live')
/** 直播画面（左）与弹幕（右）：播放器只在监听进行中、平台能取直播流时出现 */
const showPlayer = computed(
  () => running.value && Boolean(lv.route?.room) && lv.hasLiveMedia(lv.platform) && lv.header?.status !== 'offline',
)
const playerOpen = ref(true)
/** 在线人数：长连推来的实时值优先，没有时用 `live get` 的 */
const viewers = computed(() => lv.viewers ?? lv.header?.stats.viewers ?? null)
/** 一条事件都没收到就结束并出错 */
const failedEmpty = computed(() => lv.status === 'ended' && Boolean(lv.error) && !lv.events.length)

const durationOptions = computed(() =>
  LIVE_DURATIONS.map((v) => ({ value: v, label: t(`live.duration.${v || 'none'}`) })),
)
const durationModel = computed({ get: () => lv.duration, set: (v: LiveDuration) => (lv.duration = v) })

const ICONS: Record<LiveType, unknown> = { chat: MessageSquare, gift: Gift, like: Heart, enter: DoorOpen, follow: UserPlus, other: Sparkles }

const fmtTime = (iso: string | null) => (iso ? dateTime(iso, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '')

const login = () => openLogin(lv.platform, lv.account() ?? undefined)
const verify = (url: string) =>
  openVerify({ platform: lv.platform, url, message: lv.error ? errorTitle(lv.error) : undefined, retry: () => lv.start() })
/** 登录类错误：引导登录 */
const authError = computed(() => lv.error?.code === 'AUTH_REQUIRED' || lv.error?.code === 'AUTH_EXPIRED')

// ---------- 自动滚到底；往上翻时停住，右下角提示新消息 ----------
const stream = ref<HTMLElement>()
const follow = ref(true)
const unseen = ref(0)
function onScroll() {
  const el = stream.value
  if (!el) return
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  if (follow.value) unseen.value = 0
}
function toBottom() {
  const el = stream.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  follow.value = true
  unseen.value = 0
}
watch(
  () => lv.shown.length,
  (n, old) => {
    if (follow.value) nextTick(toBottom)
    else if (n > old) unseen.value += n - old
  },
)
watch(
  () => lv.status,
  (s) => s === 'connecting' && ((follow.value = true), (unseen.value = 0)),
)
// 回到弹幕标签：补上切走期间收到的弹幕
watch(
  () => tabs.tab,
  (v) => v === 'chat' && follow.value && nextTick(toBottom),
)
// 预填的最近弹幕到了：滚到底
watch(
  () => lv.recent.length,
  () => follow.value && nextTick(toBottom),
)

/** 弹幕以外的标签 */
const dataTab = computed(() => (tabs.tab === 'chat' ? null : tabs.tab))
function refreshTab() {
  if (dataTab.value) tabs.refresh(dataTab.value)
}

function submit() {
  if (running.value) return
  void lv.start()
}
</script>

<template>
  <main class="live-page">
    <header class="top">
      <GlassButton
        v-if="bp.phone"
        icon
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </GlassButton>
      <div class="title">
        <div v-if="!bp.phone" class="eyebrow"><img class="logo" :src="platform.logo" alt="" />{{ platform.name }}</div>
        <h1>{{ bp.phone ? `${platform.name} · ${t('live.nav')}` : t('live.title') }}</h1>
      </div>
    </header>

    <div v-if="bp.phone && sections.length > 1" class="phone-seg">
      <SegmentedControl v-model="section" :options="sections" :label="platform.name" />
    </div>

    <div v-if="!lv.hasAccount || lv.expired" class="login glass">
      <span class="login-ico"><LogIn :size="22" /></span>
      <h2>{{ lv.expired ? t('mine.expired') : t('live.login', { platform: platform.name }) }}</h2>
      <p>{{ lv.expired ? t('mine.expiredDesc') : t('live.loginDesc') }}</p>
      <GlassButton tone="primary" size="lg" class="btn" @click="login">{{ lv.expired ? t('common.action.relogin') : t('common.action.login') }}</GlassButton>
    </div>

    <template v-else>
      <form class="bar glass" @submit.prevent="submit">
        <input
          v-model="lv.room"
          class="room"
          type="text"
          inputmode="url"
          autocomplete="off"
          :placeholder="t('live.roomPlaceholder')"
          :aria-label="t('live.room')"
          :disabled="running"
        />
        <AppSelect v-model="durationModel" class="dur" :options="durationOptions" :label="t('live.durationLabel')" :title="t('live.durationLabel')" :disabled="running" />
        <GlassButton v-if="!running" type="submit" tone="primary" size="lg" class="btn" :disabled="!lv.room.trim()">
          <Play :size="15" />{{ t('live.start') }}
        </GlassButton>
        <GlassButton v-else tone="danger" size="lg" class="btn" @click="lv.stop()">
          <Square :size="14" />{{ t('live.stop') }}
        </GlassButton>
      </form>

      <section v-if="lv.header" class="head glass">
        <img v-if="lv.header.cover" class="cover" :src="lv.header.cover" alt="" referrerpolicy="no-referrer" />
        <div class="h-main">
          <div class="h-title">{{ lv.header.title || lv.header.id }}</div>
          <div class="h-meta">
            <UserAvatar v-if="lv.header.host" class="h-ava" :user="lv.header.host" />
            <span v-if="lv.header.host">{{ lv.header.host.name }}</span>
            <span v-if="viewers != null" class="h-viewers" v-tip="t('live.viewers')"><Users :size="13" /><RollingNumber :value="viewers" /></span>
          </div>
        </div>
        <span v-if="lv.likes != null" class="h-likes" v-tip="t('live.likes')"><Heart :size="13" /><RollingNumber :value="lv.likes" /></span>
        <span class="h-status" :class="{ on: lv.header.status === 'live' }">
          <Radio :size="13" />{{ lv.header.status === 'offline' ? t('live.offline') : t('live.onAir') }}
        </span>
      </section>

      <template v-if="lv.status === 'idle'">
        <LiveDiscover v-if="disc.available" />
        <p v-else class="hint">{{ t('live.idle') }}</p>
      </template>

      <div v-else class="split" :class="{ two: showPlayer && playerOpen }">
        <LivePlayer
          v-if="showPlayer"
          :key="`${lv.platform}:${lv.route!.room}`"
          v-model:open="playerOpen"
          class="screen"
          fill
          :platform="lv.platform"
          :room="lv.route!.room!"
          :account="lv.account()"
        />
        <section class="side glass">
          <header class="p-head">
            <div v-if="tabs.tabs.length > 1" class="tabs" role="tablist" :aria-label="t('live.tabs.label')">
              <button
                v-for="k in tabs.tabs"
                :key="k"
                type="button"
                role="tab"
                class="tab"
                :aria-selected="tabs.tab === k"
                @click="tabs.select(k)"
              >
                {{ t(`live.tabs.${k}`) }}<span v-if="k === 'chat'" class="p-n mono">{{ lv.total }}</span>
              </button>
            </div>
            <template v-else>
              <h2>{{ t('live.panel') }}</h2>
              <span class="p-n mono">{{ lv.total }}</span>
            </template>
            <span v-if="lv.status === 'connecting'" class="state mono"><CatbusLoader :size="13" />{{ t('live.connecting') }}</span>
            <div class="spacer" />
            <GlassButton
              v-if="tabs.tab !== 'chat'"
              icon
              size="sm"
              tone="quiet"
              :aria-label="t('live.discover.refresh')"
              v-tip="t('live.discover.refresh')"
              @click="refreshTab"
            >
              <RefreshCw :size="15" />
            </GlassButton>
            <template v-if="tabs.tab === 'chat'">
            <GlassButton
              icon
              size="sm"
              tone="quiet"
              :class="{ 'is-on': lv.paused }"
              :disabled="!running"
              :aria-label="lv.paused ? t('live.resume', { n: lv.pendingCount }, lv.pendingCount) : t('live.pause')"
              v-tip="lv.paused ? t('live.resume', { n: lv.pendingCount }, lv.pendingCount) : t('live.pause')"
              @click="lv.setPaused(!lv.paused)"
            >
              <component :is="lv.paused ? Play : Pause" :size="15" />
            </GlassButton>
            <GlassButton icon size="sm" tone="quiet" :disabled="!lv.events.length" :aria-label="t('live.export')" v-tip="t('live.export')" @click="lv.exportJsonl()">
              <Download :size="15" />
            </GlassButton>
            </template>
          </header>
          <LiveTabPanel v-if="dataTab" :key="dataTab" :tab="dataTab" />
          <div v-show="tabs.tab === 'chat'" class="chat-pane">
          <p v-if="lv.paused && lv.pendingCount" class="paused">{{ t('live.resume', { n: lv.pendingCount }, lv.pendingCount) }}</p>

          <!-- 一条都没收到就出错：错误占满面板，不留空的事件流 -->
          <div v-if="failedEmpty" class="p-state">
            <div v-if="authError" class="login small">
              <span class="login-ico"><LogIn :size="20" /></span>
              <h2>{{ lv.error?.code === 'AUTH_EXPIRED' ? t('mine.expired') : t('live.login', { platform: platform.name }) }}</h2>
              <GlassButton tone="primary" size="lg" class="btn" @click="login">{{ lv.error?.code === 'AUTH_EXPIRED' ? t('common.action.relogin') : t('common.action.login') }}</GlassButton>
            </div>
            <StateView v-else kind="error" :error="lv.error!" @retry="lv.start()" @login="login" @verify="verify" />
          </div>

          <template v-else>
            <div class="types" role="group" :aria-label="t('live.filter')">
              <button v-for="k in LIVE_TYPES" :key="k" type="button" class="type" :aria-pressed="lv.filter.has(k)" @click="lv.toggleType(k)">
                <component :is="ICONS[k]" :size="12" />{{ t(`live.type.${k}`) }}<span class="n mono">{{ lv.counts[k] }}</span>
              </button>
            </div>
            <p v-if="lv.dropped" class="dropped">{{ t('live.dropped', { n: lv.dropped }, lv.dropped) }}</p>
            <ol ref="stream" class="stream" aria-live="off" @scroll.passive="onScroll">
              <li v-for="e in lv.shownRecent" :key="e.seq" class="ev recent" :class="e.type">
                <span class="time mono">{{ fmtTime(e.time) }}</span>
                <component :is="ICONS[(LIVE_TYPES as readonly string[]).includes(e.type) ? (e.type as LiveType) : 'other']" class="ico" :size="13" aria-hidden="true" />
                <span class="body">
                  <span class="who">{{ e.user?.name ?? t('live.someone') }}</span>
                  <span v-if="e.type === 'gift' && e.gift" class="txt">{{ t('live.gave', { gift: e.gift.name ?? '', n: e.gift.count ?? 1 }) }}</span>
                  <span v-else-if="e.text" class="txt"><EmojiText :platform="lv.platform" :text="e.text" /></span>
                </span>
              </li>
              <li v-if="lv.recent.length" class="recent-line">{{ t('live.recent') }}</li>
              <li v-for="e in lv.shown" :key="e.seq" class="ev" :class="e.type">
                <span class="time mono">{{ fmtTime(e.time) }}</span>
                <component :is="ICONS[(LIVE_TYPES as readonly string[]).includes(e.type) ? (e.type as LiveType) : 'other']" class="ico" :size="13" aria-hidden="true" />
                <span class="body">
                  <span class="who">{{ e.user?.name ?? t('live.someone') }}</span>
                  <span v-if="e.type === 'gift' && e.gift" class="txt">{{ t('live.gave', { gift: e.gift.name ?? '', n: e.gift.count ?? 1 }) }}</span>
                  <span v-else-if="e.text" class="txt"><EmojiText :platform="lv.platform" :text="e.text" /></span>
                  <span v-else class="txt">{{ t(`live.type.${(LIVE_TYPES as readonly string[]).includes(e.type) ? e.type : 'other'}`) }}</span>
                </span>
              </li>
              <li v-if="!lv.shown.length && running" class="empty">{{ t('live.waiting') }}</li>
              <li v-if="lv.status === 'ended'" class="end" :class="lv.endReason">
                {{ t(`live.end.${lv.endReason ?? 'disconnected'}`) }}
                <button v-if="lv.error" type="button" class="end-retry" @click="authError ? login() : lv.start()">
                  {{ authError ? t('common.action.login') : t('live.player.retry') }}
                </button>
                <button v-if="disc.available" type="button" class="end-retry" @click="lv.backToDiscover()">
                  <Compass :size="12" />{{ t('live.discover.back') }}
                </button>
              </li>
            </ol>
            <GlassButton v-if="!follow && unseen" tone="primary" size="sm" class="newer" @click="toBottom">
              <ArrowDown :size="14" />{{ t('live.newer', { n: unseen }, unseen) }}
            </GlassButton>
          </template>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.live-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(16px + var(--safe-right)) calc(24px + var(--safe-bottom)) 12px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: left 0.5s var(--ease-out);
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
}
.logo {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}
h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 16px;
}
.room {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--hair);
  border-radius: 12px;
  background: var(--glass);
  color: var(--ink);
  font: inherit;
}
.room:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 1px;
}
.dur {
  flex: none;
}
.btn {
  font-weight: 600;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: 16px;
}
.cover {
  width: 96px;
  height: 54px;
  border-radius: 10px;
  object-fit: cover;
  flex: none;
}
.h-main {
  flex: 1;
  min-width: 0;
}
.h-title {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.h-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.h-ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}
.h-viewers {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.h-likes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
}
.h-likes svg {
  color: var(--red);
}
.h-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  background: var(--glass);
  color: var(--ink-3);
}
.h-status.on {
  background: var(--red-soft);
  color: var(--red);
}
.hint {
  margin: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--ink-3);
}
.split {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}
/* 弹幕面板：标题行、类型过滤、事件流 */
.side {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 360px;
  border-radius: 16px;
  overflow: hidden;
}
/* 桌面：左侧直播画面，右侧弹幕，一起撑满剩下的高度 */
@media (min-width: 1025px) {
  .split.two {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(320px, 30%, 420px);
    min-height: 520px;
  }
  .split.two .side {
    min-height: 0;
  }
}
.p-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 6px 14px;
}
.chat-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tabs {
  display: flex;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.tab:hover {
  background: var(--lg-fill-hover);
}
.tab[aria-selected='true'] {
  background: var(--red-soft);
  color: var(--red);
  font-weight: 600;
}
.tab:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.ev.recent {
  opacity: 0.6;
}
.recent-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  font-size: 11px;
  color: var(--ink-3);
}
.recent-line::before,
.recent-line::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--hair);
}
.p-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.p-n {
  font-size: 11px;
  color: var(--ink-3);
}
.p-head .is-on {
  color: var(--red);
}
.spacer {
  flex: 1;
}
.state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
}
.paused {
  margin: 0 14px 6px;
  font-size: 12px;
  color: var(--red);
}
.types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--hair);
}
.type {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.type:hover {
  background: var(--lg-fill-hover);
}
.type[aria-pressed='true'] {
  background: var(--red-soft);
  color: var(--red);
}
.type:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.type .n {
  font-size: 10px;
  color: var(--ink-3);
}
.p-state {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 16px;
  border-top: 1px solid var(--hair);
}
.dropped {
  margin: 0;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--ink-3);
  border-bottom: 1px solid var(--hair);
}
.stream {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 14px;
  list-style: none;
  overflow-y: auto;
  scrollbar-width: thin;
}
.ev {
  --lh: 19.5px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: start;
  column-gap: 8px;
  padding: 3px 0;
  font-size: 13px;
  line-height: var(--lh);
}
/* 时间和图标对齐第一行，多行的内容在自己那一栏里折行 */
.time {
  font-size: 11px;
  color: var(--ink-3);
}
.ico {
  margin-top: calc((var(--lh) - 13px) / 2);
  color: var(--ink-3);
}
.body {
  min-width: 0;
  overflow-wrap: anywhere;
}
.who {
  display: inline-block;
  vertical-align: top;
  max-width: 10em;
  margin-right: 8px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ev.gift .txt,
.ev.gift .ico {
  color: #c98a00;
}
.ev.enter,
.ev.follow,
.ev.like {
  --lh: 18px;
  font-size: 12px;
  color: var(--ink-3);
}
.ev.enter .who,
.ev.follow .who,
.ev.like .who {
  font-weight: 400;
}
.empty,
.end {
  padding: 12px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
.end.error {
  color: var(--red);
}
.end-retry {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--red);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.newer {
  position: absolute;
  right: 14px;
  bottom: 14px;
  gap: 4px;
}
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 48px auto;
  padding: 32px 28px;
  max-width: 420px;
  border-radius: 20px;
  text-align: center;
}
.login.small {
  margin: 0 auto;
  padding: 20px;
}
.login-ico {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--red-soft);
  color: var(--red);
}
.login h2 {
  margin: 4px 0 0;
  font-size: 16px;
}
.login p {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--ink-3);
}
@media (max-width: 640px) {
  .bar {
    flex-wrap: wrap;
  }
  .room {
    flex-basis: 100%;
    font-size: 16px;
    height: 44px;
  }
  .btn {
    flex: 1;
    --lg-h: 44px;
  }
  .types {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .type {
    height: 36px;
  }
  .tab {
    height: 40px;
  }
  .side {
    min-height: 60dvh;
  }
}
</style>
