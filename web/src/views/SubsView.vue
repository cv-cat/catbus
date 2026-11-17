<script setup lang="ts">
import { flyItems } from '@/composables/flyToDownloads'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Bell, CheckCheck, Menu, RefreshCw, Search, ShieldAlert, ShieldCheck, Trash2, UserRound } from 'lucide-vue-next'
import SelectionActions from '@/components/SelectionActions.vue'
import DownloadCenter from '@/components/DownloadCenter.vue'
import MasonryGrid from '@/components/MasonryGrid.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { useSubsStore } from '@/stores/subs'
import { useDiscoverStore } from '@/stores/discover'
import { useSelectionStore } from '@/stores/selection'
import { useDownloadsStore } from '@/stores/downloads'
import { useNavStore } from '@/stores/nav'
import { openVerify } from '@/stores/verify'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { since } from '@/composables/format'
import { errorTitle } from '@/i18n/errors'
import { platformById } from '@/data/platforms'
import type { Item } from '@/api/types'
import type { Sub } from '@/api/subs'
import type { Cell } from '@/stores/lanes'

/**
 * 订阅页（AGENTS.md 7.9「订阅」）：左侧订阅列表，右侧选中那一条的新内容（未读）。
 * 平台被风控暂停时列表上方一条琥珀色提示；打开时每 60 秒重新读一次（stores/subs）。
 */
const subs = useSubsStore()
const d = useDiscoverStore()
const sel = useSelectionStore()
const downloads = useDownloadsStore()
const nav = useNavStore()
const bp = useBreakpoint()
const { t } = useI18n()

/** 当前那一条：地址里选中的；桌面上没选时默认第一条（不写地址），手机上先看列表 */
const current = computed<Sub | null>(() => {
  const list = subs.subs
  const picked = subs.selected ? list.find((s) => s.id === subs.selected) : null
  return picked ?? (bp.phone ? null : list[0] ?? null)
})
/** 手机上点进了一条：只显示它的内容 */
const phoneDetail = computed(() => bp.phone && !!current.value)

const platformName = (id: string) => platformById(id)?.name ?? id
const pausedList = computed(() => Object.entries(subs.paused).map(([platform, p]) => ({ platform, ...p })))
const isPaused = (s: Sub | null) => !!s && !!subs.paused[s.platform]

const items = computed<Item[]>(() => current.value?.unread ?? [])
const cells = computed<Cell[]>(() => (current.value ? current.value.unread.map((it) => ({ key: `${current.value!.id}\n${it.id}`, platform: current.value!.platform, item: it })) : []))
const platformOf = () => current.value?.platform ?? ''
const feed = {
  targetOf: () => {
    const p = platformOf()
    return { platform: p, account: current.value?.account ?? d.accountFor(p)?.account ?? null }
  },
  loadMore: () => {},
  hasMore: () => false,
}
watch(() => current.value?.id, () => {
  sel.none()
  confirmRemove.value = false
})

function lastCheck(s: Sub): string {
  return s.last_check ? t('subs.list.checked', { time: since(s.last_check) }) : t('subs.list.never')
}
const kindLabel = (s: Sub) => (s.kind === 'keyword' ? t('subs.kind.keyword') : t('subs.kind.author'))

// ---------- 操作 ----------
const confirmRemove = ref(false)
async function removeCurrent() {
  const s = current.value
  if (!s) return
  if (!confirmRemove.value) return void (confirmRemove.value = true)
  confirmRemove.value = false
  await subs.remove(s.id)
}
function verify(platform: string, url: string | null) {
  openVerify({ platform, url, retry: () => subs.resume(platform) })
}
async function downloadSelected() {
  const s = current.value
  if (!s) return
  const from = document.activeElement
  const picked = sel.pick(items.value)
  try {
    await downloads.start(s.platform, s.account ?? d.accountFor(s.platform)?.account ?? null, picked, commentsSupported(s.platform))
    void flyItems(picked, from)
    sel.none()
  } catch (e) {
    alert((e as Error).message)
  }
}
</script>

<template>
  <main class="subs-page" :class="{ 'has-bar': bp.phone && sel.active }">
    <header class="top" :class="{ phone: bp.phone }">
      <GlassButton
        v-if="bp.phone && !phoneDetail"
        icon
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </GlassButton>
      <GlassButton v-else-if="phoneDetail" icon :aria-label="t('common.action.back')" @click="subs.setSelected(null)">
        <ArrowLeft :size="18" />
      </GlassButton>
      <div class="title">
        <div v-if="!bp.phone" class="eyebrow">{{ t('subs.eyebrow') }}</div>
        <h1>{{ phoneDetail ? current!.label : t('subs.title') }}</h1>
      </div>
      <div class="spacer" />
      <template v-if="!bp.phone">
        <SelectionActions :items="items" :platforms="current ? [current.platform] : []" :platform-of="platformOf" @download="downloadSelected" />
        <DownloadCenter class="tool" />
      </template>
    </header>

    <!-- 风控暂停：整个平台的订阅停下，直到用户点「恢复」 -->
    <div v-for="p in pausedList" v-show="!phoneDetail || current?.platform === p.platform" :key="p.platform" class="paused" role="alert">
      <ShieldAlert :size="18" class="p-ico" aria-hidden="true" />
      <div class="p-text">
        <strong>{{ t('subs.paused.title', { platform: platformName(p.platform) }) }}</strong>
        <span>{{ t('subs.paused.desc') }}</span>
      </div>
      <GlassButton v-if="p.verify_url" size="sm" @click="verify(p.platform, p.verify_url)"><ShieldCheck :size="14" />{{ t('layout.state.verify') }}</GlassButton>
      <GlassButton size="sm" tone="primary" :aria-busy="subs.resuming.has(p.platform) || undefined" @click="subs.resume(p.platform)">
        <CatbusLoader v-if="subs.resuming.has(p.platform)" :size="13" />{{ t('subs.paused.resume') }}
      </GlassButton>
    </div>

    <!-- 读不到订阅（服务不可用） -->
    <div v-if="subs.error && !subs.loaded" class="empty glass">
      <span class="e-ico"><Bell :size="22" /></span>
      <h3>{{ t('subs.error.title') }}</h3>
      <p>{{ subs.error }}</p>
      <GlassButton tone="primary" @click="subs.refresh()">{{ t('common.action.retry') }}</GlassButton>
    </div>
    <p v-else-if="!subs.loaded" class="none mono"><CatbusLoader :size="15" />{{ t('common.state.loading') }}</p>
    <div v-else-if="!subs.subs.length" class="empty glass">
      <span class="e-ico"><Bell :size="22" /></span>
      <h3>{{ t('subs.empty.title') }}</h3>
      <p>{{ t('subs.empty.desc') }}</p>
    </div>

    <div v-else class="layout" :class="{ phone: bp.phone }">
      <!-- 订阅列表 -->
      <nav v-if="!phoneDetail" class="list glass" :aria-label="t('subs.list.label')">
        <button
          v-for="s in subs.subs"
          :key="s.id"
          type="button"
          class="row"
          :class="{ on: current?.id === s.id, 'is-paused': isPaused(s) }"
          :aria-current="current?.id === s.id ? 'true' : undefined"
          @click="subs.setSelected(s.id)"
        >
          <span class="logo-wrap">
            <img class="logo" :src="platformById(s.platform)?.logo" :alt="platformName(s.platform)" />
            <span class="kind" :title="kindLabel(s)">
              <Search v-if="s.kind === 'keyword'" :size="9" aria-hidden="true" />
              <UserRound v-else :size="9" aria-hidden="true" />
            </span>
          </span>
          <span class="r-main">
            <span class="r-name">{{ s.label }}</span>
            <span v-if="s.error" class="r-sub err">{{ errorTitle(s.error) }}</span>
            <span v-else class="r-sub">{{ platformName(s.platform) }} · {{ lastCheck(s) }}</span>
          </span>
          <span v-if="s.unread.length" class="r-n mono" :aria-label="t('subs.nav.unread', { n: s.unread.length }, s.unread.length)">{{ s.unread.length > 99 ? '99+' : s.unread.length }}</span>
        </button>
      </nav>

      <!-- 选中那一条的新内容 -->
      <section v-if="current && (!bp.phone || phoneDetail)" class="content">
        <div class="bar">
          <div class="b-title">
            <h2>{{ current.label }}</h2>
            <span class="b-sub">
              <img :src="platformById(current.platform)?.logo" alt="" />{{ platformName(current.platform) }} · {{ kindLabel(current) }} · {{ lastCheck(current) }}
            </span>
          </div>
          <span class="pill mono">{{ t('subs.content.count', { n: current.unread.length }, current.unread.length) }}</span>
          <div class="spacer" />
          <div class="acts">
            <GlassButton size="sm" :disabled="!current.unread.length" @click="subs.markRead(current.id)">
              <CheckCheck :size="14" />{{ t('subs.content.markRead') }}
            </GlassButton>
            <GlassButton
              v-tip="isPaused(current) ? t('subs.content.pausedTip') : null"
              size="sm"
              :disabled="isPaused(current) || subs.checking.has(current.id)"
              @click="subs.checkNow(current.id)"
            >
              <CatbusLoader v-if="subs.checking.has(current.id)" :size="13" />
              <RefreshCw v-else :size="14" />{{ t('subs.content.check') }}
            </GlassButton>
            <GlassButton size="sm" tone="danger" :class="{ 'is-on': confirmRemove }" @click="removeCurrent" @blur="confirmRemove = false">
              <Trash2 :size="14" />{{ confirmRemove ? t('subs.content.removeConfirm') : t('subs.content.remove') }}
            </GlassButton>
          </div>
        </div>
        <p v-if="current.error" class="sub-err" role="status">{{ t('subs.content.error', { reason: errorTitle(current.error) }) }}</p>

        <div v-if="!current.unread.length" class="empty glass">
          <span class="e-ico"><CheckCheck :size="22" /></span>
          <h3>{{ current.last_check ? t('subs.content.emptyTitle') : t('subs.content.pendingTitle') }}</h3>
          <p>{{ current.last_check ? t('subs.content.emptyDesc') : t('subs.content.pendingDesc') }}</p>
        </div>
        <MasonryGrid v-else :cells="cells" :feed="feed" />
      </section>
    </div>

    <SelectionActions v-if="bp.phone && phoneDetail" bar :items="items" :platforms="current ? [current.platform] : []" :platform-of="platformOf" @download="downloadSelected" />
  </main>
</template>

<style scoped>
.subs-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(16px + var(--safe-right)) calc(40px + var(--safe-bottom)) 12px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.title {
  flex: none;
  min-width: 0;
  white-space: nowrap;
}
.eyebrow {
  font-size: 12px;
  color: var(--ink-3);
}
h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
/* 风控暂停：琥珀色 */
.paused {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, #f5a524 14%, var(--glass));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #f5a524 40%, transparent);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
  font-size: 13px;
}
.p-ico {
  flex: none;
  color: #c27803;
}
.p-text {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.p-text span {
  color: var(--ink-2);
  font-size: 12px;
}
.layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.layout.phone {
  grid-template-columns: minmax(0, 1fr);
}
.list {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: calc(100dvh - 120px);
  overflow-y: auto;
  padding: 8px;
  border-radius: 20px;
  background: var(--lg-fill);
  box-shadow: var(--lg-edge), var(--lg-shadow);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
  scrollbar-width: thin;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 6px 10px;
  border: 0;
  border-radius: 14px;
  background: none;
  color: var(--ink-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.row:hover {
  background: var(--lg-fill-hover);
  color: var(--ink);
}
.row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.row.on {
  background: var(--lg-accent-fill);
  box-shadow: var(--lg-edge);
  color: var(--ink);
}
.row.on .r-name {
  color: var(--red);
}
.logo-wrap {
  position: relative;
  flex: none;
  width: 30px;
  height: 30px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}
.row.is-paused .logo {
  opacity: 0.55;
}
.kind {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--glass-strong);
  box-shadow: 0 0 0 1.5px var(--bg, #fff);
  color: var(--ink-2);
}
.r-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.r-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}
.r-sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ink-3);
}
.r-sub.err,
.sub-err {
  color: var(--red);
}
.r-n {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--red);
}
.content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 0 4px;
}
.b-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bar h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.b-sub {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-3);
}
.b-sub img {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}
.pill {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--hair);
  font-size: 12px;
  color: var(--ink-2);
}
.acts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.acts :deep(svg) {
  flex: none;
}
.sub-err {
  margin: -6px 4px 0;
  font-size: 12px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 40px auto;
  padding: 32px 28px;
  max-width: 420px;
  border-radius: 20px;
  text-align: center;
}
.e-ico {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--red-soft);
  color: var(--red);
}
.empty h3 {
  margin: 4px 0 0;
  font-size: 16px;
}
.empty p {
  margin: 0;
  font-size: 13px;
  color: var(--ink-3);
}
.none {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 48px 0;
  font-size: 13px;
  color: var(--ink-3);
}
/* 手机：订阅列表在上面，点一条进入它的新内容；可点元素不低于 44px */
@media (max-width: 640px) {
  .subs-page {
    padding: 0 calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
    gap: 14px;
  }
  .subs-page.has-bar {
    padding-bottom: calc(108px + var(--safe-bottom));
  }
  .top.phone {
    position: sticky;
    top: 0;
    z-index: 4;
    gap: 8px;
    margin: 0 calc(-12px - var(--safe-right)) 0 calc(-12px - var(--safe-left));
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) 12px calc(12px + var(--safe-left));
    background: var(--glass);
    backdrop-filter: blur(30px) saturate(1.6);
  }
  .top.phone .title {
    flex: 1;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .list {
    position: static;
    max-height: none;
  }
  /* 名字已经在顶栏 */
  .bar h2 {
    display: none;
  }
  .row {
    min-height: 56px;
  }
  .acts {
    width: 100%;
  }
  .acts > * {
    --lg-h: 44px;
    flex: 1;
  }
}
</style>
