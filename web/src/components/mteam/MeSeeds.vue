<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Layers } from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import { SEED_STATUSES, type SeedStatus } from '@/api/mteam'
import type { Item } from '@/api/types'
import { useMteamStore, MTEAM_ID } from '@/stores/mteam'
import { useDetailStore } from '@/stores/detail'
import { parseSeedText, ratioLow } from '@/data/mteam'
import { torrentInfo } from '@/composables/torrent'
import { useSentinel } from '@/composables/sentinel'
import { errorTitle } from '@/i18n/errors'

/** 我的种子（设计稿 Y1）：五个分段，滚到底按 --cursor 翻页；点一行打开种子详情 */
const { t } = useI18n()
const m = useMteamStore()
const detail = useDetailStore()

const tabs = computed(() =>
  SEED_STATUSES.map((s) => {
    const n = m.seedTotal(s)
    return { value: s, label: n == null ? t(`mteam.seeds.tab.${s}`) : `${t(`mteam.seeds.tab.${s}`)} ${n}` }
  }),
)
const tab = computed({ get: () => m.tab, set: (v: SeedStatus) => m.setTab(v) })
const page = computed(() => m.seedPage)
const total = computed(() => m.seedTotal(m.tab))

/** 列表里显示的一行：中文名（`text` 里分享率之后那一行 `|` 之前），本账号的上传 / 下载 / 分享率 */
function rowOf(it: Item) {
  const parsed = parseSeedText(it.text)
  const info = torrentInfo({ ...it, text: null })
  return { item: it, parsed, info, title: parsed.name || it.title || t('detail.torrent.untitled') }
}
const rows = computed(() => page.value.items.map(rowOf))

const rowEls = new Map<string, HTMLElement>()
/** 详情卡片的中文名取列表里那一条的 text：换成解析出来的中文名那一行 */
function asListItem(it: Item): Item {
  const lines = (it.text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith('分享率：')) // i18n-ignore CLI 输出的字段名
  const zh = (i >= 0 ? lines.slice(i + 1) : lines).find((l) => l.trim()) ?? null
  return { ...it, text: zh }
}
function open(it: Item) {
  const list = () => page.value.items.map(asListItem)
  detail.open({
    item: asListItem(it),
    platform: MTEAM_ID,
    account: m.account?.account ?? null,
    source: rowEls.get(it.id) ?? null,
    nav: {
      items: list,
      sourceOf: (id) => rowEls.get(id) ?? null,
      loadMore: () => void m.loadSeeds(m.tab, true),
      hasMore: () => page.value.hasMore,
    },
  })
}

const sentinel = ref<HTMLElement>()
const recheck = useSentinel(sentinel, () => void m.loadSeeds(m.tab, true))
watch(() => page.value.items.length, () => recheck())
</script>

<template>
  <section class="seeds glass" :aria-label="t('mteam.seeds.title')">
    <header class="head">
      <h2>{{ t('mteam.seeds.title') }}</h2>
      <span class="spacer" />
      <span v-if="page.loaded" class="count mono">
        {{ total == null ? t('mteam.seeds.loaded', { n: page.items.length }) : t('mteam.seeds.loadedOf', { n: page.items.length, total }) }}
      </span>
    </header>
    <div class="tabs">
      <SegmentedControl v-model="tab" :options="tabs" :label="t('mteam.seeds.title')" />
    </div>

    <div v-if="!page.loading && page.error" class="state err">
      <span>{{ errorTitle(page.error) }}</span>
      <button type="button" class="retry" @click="m.loadSeeds(m.tab)">{{ t('common.action.retry') }}</button>
    </div>
    <div v-else-if="page.loading && !page.items.length" class="list" aria-hidden="true">
      <div v-for="i in 5" :key="i" class="row sk-row"><i class="sk poster" /><i class="sk line" /></div>
    </div>
    <div v-else-if="page.loaded && !page.items.length" class="state empty">
      <Layers :size="18" aria-hidden="true" />{{ t(`mteam.seeds.empty.${m.tab}`) }}
    </div>
    <div v-else class="list" :class="{ stale: page.loading }">
      <div class="row cols" aria-hidden="true">
        <span>{{ t('mteam.seeds.col.torrent') }}</span>
        <span>{{ t('mteam.seeds.col.size') }}</span>
        <span>{{ t('mteam.seeds.col.up') }}</span>
        <span>{{ t('mteam.seeds.col.down') }}</span>
        <span class="r">{{ t('mteam.seeds.col.ratio') }}</span>
      </div>
      <button
        v-for="r in rows"
        :key="r.item.id"
        :ref="(el) => (el ? rowEls.set(r.item.id, el as HTMLElement) : rowEls.delete(r.item.id))"
        type="button"
        class="row item"
        @click="open(r.item)"
      >
        <span class="main">
          <span class="cover">
            <img v-if="r.item.cover" :src="r.item.cover" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <Layers v-else :size="18" aria-hidden="true" />
          </span>
          <span class="names">
            <span class="zh">
              <span class="zh-text">{{ r.title }}</span>
              <span v-if="r.info?.discount" class="disc" :class="{ free: r.info.free }">{{ r.info.discount }}</span>
            </span>
            <span class="en mono">{{ r.item.title }}</span>
            <span v-if="!r.parsed.mine && r.item.text" class="raw">{{ r.item.text }}</span>
          </span>
        </span>
        <span class="size">
          <span class="mono">{{ r.info?.size ?? '—' }}</span>
          <span class="peers mono">
            <span :class="{ red: r.item.seeders === 0 }"><ArrowUp :size="11" />{{ r.item.seeders ?? '—' }}</span>
            <span><ArrowDown :size="11" />{{ r.item.leechers ?? '—' }}</span>
          </span>
        </span>
        <template v-if="r.parsed.mine">
          <span class="mono up"><i class="ph">{{ t('mteam.seeds.col.up') }}</i>{{ r.parsed.mine.up }}</span>
          <span class="mono down"><i class="ph">{{ t('mteam.seeds.col.down') }}</i>{{ r.parsed.mine.down }}</span>
          <span class="mono ratio r" :class="{ red: ratioLow(r.parsed.mine.ratio) }"><i class="ph">{{ t('mteam.seeds.col.ratio') }}</i>{{ r.parsed.mine.ratio }}</span>
        </template>
        <template v-else><span /><span /><span class="r">—</span></template>
      </button>
      <div ref="sentinel" class="sentinel" aria-hidden="true" />
      <div v-if="page.loadingMore" class="more"><CatbusLoader :size="16" :label="t('common.state.loading')" /></div>
    </div>
  </section>
</template>

<style scoped>
.seeds {
  padding: 18px 20px 8px;
  border-radius: var(--radius-lg, 20px);
  border: 1px solid var(--glass-stroke);
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.spacer {
  flex: 1;
}
.count {
  font-size: 12px;
  color: var(--ink-3);
}
.tabs {
  margin: 12px 0 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.list.stale {
  opacity: 0.5;
  pointer-events: none;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px 96px 96px 72px;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 0;
  border: none;
  border-bottom: 1px solid var(--hair);
  background: transparent;
  font: inherit;
  color: var(--ink);
  text-align: left;
}
.row.cols {
  padding: 6px 0;
  font-size: 11.5px;
  color: var(--ink-3);
}
.row.item {
  cursor: pointer;
  border-radius: 10px;
  transition: background 0.2s;
}
.row.item:hover {
  background: var(--hair);
}
.row.item:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: -2px;
}
.r {
  text-align: right;
}
.main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.cover {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--hair);
  color: var(--ink-3);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.names {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.zh {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}
.zh-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.disc {
  flex: none;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--ink);
  color: var(--bg, #fff);
  font-size: 10.5px;
  font-weight: 700;
}
.disc.free {
  background: var(--red);
  color: #fff;
}
.en {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11.5px;
  color: var(--ink-3);
}
.raw {
  font-size: 11.5px;
  white-space: pre-line;
  color: var(--ink-2);
}
.size {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 13px;
}
.peers {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--ink-3);
}
.peers span {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.mono {
  font-variant-numeric: tabular-nums;
}
.up,
.down,
.ratio {
  font-size: 13px;
}
.ratio {
  font-weight: 700;
}
.red {
  color: var(--red);
}
.ph {
  display: none;
  font-style: normal;
}
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 36px 0;
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
  padding: 12px;
}
.sk-row {
  display: flex;
  gap: 12px;
}
.sk {
  display: block;
  border-radius: 6px;
  background: var(--hair);
  animation: pulse 1.2s ease-in-out infinite;
}
.sk.poster {
  width: 40px;
  height: 60px;
}
.sk.line {
  flex: 1;
  height: 18px;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
/* 手机（设计稿 Y3）：每行三行——中文名 + 优惠、种子名、体积 · 做种下载 · 分享率 */
@media (max-width: 640px) {
  .seeds {
    padding: 14px 12px 6px;
  }
  .row.cols {
    display: none;
  }
  .row.item {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'main main'
      'size ratio';
    row-gap: 6px;
    column-gap: 10px;
    padding: 10px 6px;
    min-height: var(--tap);
  }
  .main {
    grid-area: main;
  }
  .size {
    grid-area: size;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  /* 手机上只留分享率（设计稿 Y3），本账号的上传 / 下载在详情里看 */
  .up,
  .down {
    display: none;
  }
  .ratio {
    grid-area: ratio;
  }
  .up,
  .down,
  .ratio {
    font-size: 12px;
  }
  .ph {
    display: inline;
    margin-right: 3px;
    color: var(--ink-3);
    font-weight: 400;
  }
  .row.item > .main {
    padding-left: 0;
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
