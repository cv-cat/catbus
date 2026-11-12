<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ExternalLink, Menu } from 'lucide-vue-next'
import AuthorHeader from '@/components/AuthorHeader.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import SearchBar from '@/components/SearchBar.vue'
import SelectionActions from '@/components/SelectionActions.vue'
import DownloadCenter from '@/components/DownloadCenter.vue'
import MasonryGrid from '@/components/MasonryGrid.vue'
import StateView from '@/components/StateView.vue'
import LoadingBar from '@/components/LoadingBar.vue'
import { useAuthorStore } from '@/stores/author'
import { useDiscoverStore } from '@/stores/discover'
import { useSelectionStore } from '@/stores/selection'
import { useDownloadsStore } from '@/stores/downloads'
import { useNavStore } from '@/stores/nav'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { platformById } from '@/data/platforms'
import { waveWhileLoading } from '@/composables/motion'
import type { Item } from '@/api/types'
import type { Cell } from '@/stores/lanes'
import { errorTitle } from '@/i18n/errors'

/**
 * 作者页（AGENTS.md 7.9「作者页」，设计稿 P / P2 / P4）：返回按钮 + 作者头部 + 「全部作品」+ 瀑布流。
 * 复用发现页的瀑布流、卡片、详情卡片、批量选择与下载；不显示排序、类型等筛选。
 */
const a = useAuthorStore()
const d = useDiscoverStore()
const sel = useSelectionStore()
const downloads = useDownloadsStore()
const nav = useNavStore()
const bp = useBreakpoint()
const { t } = useI18n()

const platform = computed(() => platformById(a.route?.platform ?? '')!)
const cells = computed<Cell[]>(() => a.items.map((item) => ({ key: item.id, platform: platform.value.id, item })))
/** 详情卡片的平台、账号和翻页按作者页来 */
const feed = {
  targetOf: () => ({ platform: platform.value.id, account: a.account() }),
  loadMore: () => a.loadMore(),
  hasMore: () => a.hasMore,
}

/** 搜索框：带着发现页的关键词；提交后回到发现页搜索 */
const keyword = ref(d.state.keyword)
watch(
  () => a.route,
  () => (keyword.value = d.state.keyword),
)
const placeholder = computed(() => t('discover.search.placeholder', { platform: d.platform.name, item: d.platform.item }))

async function downloadSelected() {
  const picked: Item[] = sel.pick(a.items)
  if (!picked.length) return
  try {
    await downloads.start(platform.value.id, a.account(), picked)
    sel.none()
    downloads.open = true
  } catch (e) {
    alert((e as Error).message)
  }
}

function retry() {
  a.load(true)
}
function login() {
  const hinted = /\s-a\s+(\S+)/.exec(a.error?.hint ?? '')?.[1]
  openLogin(platform.value.id, hinted ?? a.account() ?? undefined)
}
function verify(url: string) {
  openVerify({ platform: platform.value.id, url, message: a.error ? errorTitle(a.error) : undefined, retry })
}

/** 右侧结果：「已加载 24 / 128 · 0.84s」，总数缺失时「已加载 24 条」 */
const total = computed(() => a.user?.stats.items ?? null)
const loaded = computed(() => {
  const n = a.items.length
  const time = a.elapsed != null ? ` · ${a.elapsed.toFixed(2)}s` : ''
  return (total.value != null ? t('author.loaded.withTotal', { n, total: total.value }, n) : t('author.loaded.count', { n }, n)) + time
})

// ---------- 滚动：换作者回到顶部；滚到底自动翻页 ----------
const root = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined
watch(
  () => a.route,
  (r, old) => {
    if (r && (r.platform !== old?.platform || r.user !== old?.user)) root.value?.scrollTo({ top: 0 })
  },
)
/** 加载结束后重新观察一次哨兵：第一页太短、哨兵仍在视野里时接着翻（同发现页） */
watch(
  () => a.loading || a.loadingMore,
  (busy) => {
    waveWhileLoading(a.loading)
    if (busy || !io || !sentinel.value) return
    void nextTick(() => {
      io!.unobserve(sentinel.value!)
      io!.observe(sentinel.value!)
    })
  },
)
onMounted(() => {
  io = new IntersectionObserver(([e]) => e?.isIntersecting && a.loadMore(), { root: root.value, rootMargin: '600px' })
  io.observe(sentinel.value!)
})
onBeforeUnmount(() => {
  io?.disconnect()
  waveWhileLoading(false)
})
</script>

<template>
  <main ref="root" class="author-page" :class="{ 'has-bar': bp.phone && sel.active }">
    <header class="top" :class="{ phone: bp.phone }">
      <button
        v-if="bp.phone"
        type="button"
        class="round glass"
        :aria-label="t('layout.nav.open')"
        aria-controls="catbus-nav"
        :aria-expanded="nav.navOpen"
        @click="nav.openNav()"
      >
        <Menu :size="20" />
      </button>
      <button type="button" class="round glass back" :aria-label="t('common.action.back')" :title="t('common.action.back')" @click="a.back()">
        <ArrowLeft :size="18" />
      </button>
      <div class="title">
        <div v-if="!bp.phone" class="eyebrow">{{ t('author.eyebrow', { platform: platform.name }) }}</div>
        <h1>{{ t('author.title') }}</h1>
      </div>
      <div class="spacer" />
      <template v-if="bp.phone">
        <a
          v-if="a.user?.url"
          class="round plain"
          :href="a.user.url"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="t('author.origin')"
          :title="t('author.origin')"
        >
          <ExternalLink :size="20" />
        </a>
      </template>
      <template v-else>
        <SelectionActions :items="a.items" @download="downloadSelected" />
        <SearchBar v-model="keyword" class="search" :loading="d.loading" :placeholder="placeholder" @submit="a.search(keyword)" />
        <DownloadCenter class="tool" />
      </template>
    </header>

    <AuthorHeader :user="a.user" :platform="platform" />

    <div class="works">
      <h2>{{ t('author.works') }}</h2>
      <span v-if="total != null" class="pill mono">{{ total }}</span>
      <div class="spacer" />
      <span v-if="a.loading && !bp.phone" class="count mono"><CatbusLoader :size="13" />{{ t('common.state.loading') }}</span>
      <span v-else-if="a.elapsed != null && !a.error && !bp.phone" class="count mono">{{ loaded }}</span>
      <LoadingBar class="works-progress" :active="a.loading" />
    </div>

    <StateView v-if="a.error && !a.items.length" kind="error" :error="a.error" @retry="retry" @login="login" @verify="verify" />
    <p v-else-if="!a.loading && !a.items.length && a.elapsed != null" class="empty">{{ t('author.empty', { item: platform.item }) }}</p>
    <MasonryGrid v-else :cells="cells" :loading="a.loading" :feed="feed" />

    <div ref="sentinel" class="sentinel" aria-hidden="true" />
    <p v-if="a.loadingMore" class="more mono"><CatbusLoader :size="15" />{{ t('common.state.loading') }}</p>
    <p v-else-if="a.items.length && !a.hasMore" class="more mono">{{ t('discover.end') }}</p>

    <SelectionActions v-if="bp.phone" bar :items="a.items" @download="downloadSelected" />
  </main>
</template>

<style scoped>
/* 与发现页同一个位置和内边距（.discover），纵向间距 18 */
.author-page {
  position: absolute;
  inset: 0 0 0 var(--content-left);
  overflow-y: auto;
  padding: 16px calc(16px + var(--safe-right)) calc(40px + var(--safe-bottom)) 12px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
  transition: left 0.5s var(--ease-out), padding-bottom 0.3s;
  scrollbar-width: thin;
  scrollbar-color: var(--hair) transparent;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.round {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--tap);
  height: var(--tap);
  border-radius: 50%;
  color: var(--ink);
  backdrop-filter: blur(30px) saturate(1.6);
  transition: color 0.2s, box-shadow 0.25s;
}
.round.plain {
  background: none;
  border: 0;
  backdrop-filter: none;
}
.back:hover,
.back:focus-visible {
  color: var(--red);
  box-shadow: 0 0 0 4px var(--red-soft);
}
.title {
  flex: none;
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
}
.spacer {
  flex: 1;
}
.search {
  position: relative;
  z-index: 2;
  width: min(520px, 46vw);
}
.tool {
  flex: none;
}
.works {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.works h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}
.pill {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--hair);
  font-size: 12px;
  color: var(--ink-2);
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.works-progress {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: -9px;
}
.empty {
  margin: 48px 0;
  text-align: center;
  font-size: 14px;
  color: var(--ink-3);
}
.sentinel {
  height: 1px;
  flex: none;
}
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
/* 顶栏放不下一行时：搜索框单独一行 */
@media (max-width: 820px) {
  .top {
    flex-wrap: wrap;
  }
  .search {
    order: 5;
    width: 100%;
  }
}
/* 手机（P4）：顶栏是玻璃条，菜单、返回、标题、原主页；正文间距 14 */
@media (max-width: 640px) {
  .author-page {
    padding: 0 calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
    gap: 14px;
  }
  .author-page.has-bar {
    padding-bottom: calc(108px + var(--safe-bottom));
  }
  .top.phone {
    position: sticky;
    top: 0;
    z-index: 3;
    gap: 8px;
    margin: 0 calc(-12px - var(--safe-right)) 0 calc(-12px - var(--safe-left));
    padding: calc(12px + var(--safe-top)) calc(12px + var(--safe-right)) 12px calc(12px + var(--safe-left));
    background: var(--glass);
    backdrop-filter: blur(30px) saturate(1.6);
  }
  .top.phone .round:not(.plain) {
    background: none;
    border: 0;
    backdrop-filter: none;
  }
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0;
  }
}
</style>
