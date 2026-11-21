<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, Search, X, Tv } from 'lucide-vue-next'
import type { Live } from '@/api/types'
import GlassButton from '@/components/ui/GlassButton.vue'
import StateView from '@/components/StateView.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import LiveCard from './LiveCard.vue'
import { useLiveDiscoverStore } from '@/stores/liveDiscover'
import { useLiveStore } from '@/stores/live'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { errorTitle } from '@/i18n/errors'

/** 发现直播间（AGENTS.md 7.9「直播弹幕」）：搜索、分类 chip、推荐列表，点卡片开始监听 */
const d = useLiveDiscoverStore()
const lv = useLiveStore()
const { t } = useI18n()

const list = computed(() => d.current)
const skeletons = computed(() => Boolean(list.value?.loading && !list.value.items.length))
const empty = computed(() => Boolean(list.value?.loaded && !list.value.loading && !list.value.error && !list.value.items.length))

function pick(live: Live) {
  lv.room = live.url || live.id
  void lv.start()
}

const login = () => openLogin(lv.platform, lv.account() ?? undefined)
const verify = (url: string) =>
  openVerify({ platform: lv.platform, url, message: list.value?.error ? errorTitle(list.value.error) : undefined, retry: () => d.refresh() })

// 滚到底翻页：哨兵进入视口时取下一页
const sentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined
let near = false
const more = () => near && list.value?.hasMore && !list.value.loading && !list.value.error && void d.load(true)
onMounted(() => {
  d.ensure()
  io = new IntersectionObserver((es) => {
    near = es.some((e) => e.isIntersecting)
    more()
  }, { rootMargin: '400px 0px' })
  if (sentinel.value) io.observe(sentinel.value)
})
onBeforeUnmount(() => io?.disconnect())
// 一页不够撑满时：加载完仍看得到哨兵就接着翻
watch(() => list.value?.loading, (v) => v === false && setTimeout(more, 0))
watch(() => lv.platform, () => d.ensure())
</script>

<template>
  <section v-if="d.available" class="discover" :aria-label="t('live.discover.title')">
    <header class="d-head">
      <h2>{{ t('live.discover.title') }}</h2>
      <span v-if="d.query" class="d-sub">{{ t('live.discover.results', { kw: d.query }) }}</span>
      <div class="spacer" />
      <GlassButton
        v-if="!d.needQuery"
        icon
        size="sm"
        tone="quiet"
        :disabled="list?.loading"
        :aria-label="t('live.discover.refresh')"
        v-tip="t('live.discover.refresh')"
        @click="d.refresh()"
      >
        <RefreshCw :size="15" />
      </GlassButton>
    </header>

    <form v-if="d.canSearch" class="search glass" role="search" @submit.prevent="d.submit()">
      <Search :size="16" class="s-ico" aria-hidden="true" />
      <input
        v-model="d.input"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        :placeholder="t('live.discover.searchPlaceholder')"
        :aria-label="t('live.discover.search')"
      />
      <button v-if="d.input || d.query" type="button" class="s-clear" :aria-label="t('live.discover.clear')" @click="d.clearQuery()">
        <X :size="15" />
      </button>
      <GlassButton type="submit" tone="primary" class="s-btn" :disabled="!d.input.trim()">{{ t('live.discover.search') }}</GlassButton>
    </form>

    <div v-if="d.canCategories && d.categories.length && !d.query" class="chips" role="group" :aria-label="t('live.discover.categories')">
      <button type="button" class="chip" :aria-pressed="d.category == null" @click="d.pick(null)">{{ t('live.discover.recommend') }}</button>
      <button v-for="c in d.categories" :key="c.id" type="button" class="chip" :aria-pressed="d.category === c.id" @click="d.pick(c.id)">
        {{ c.name }}
      </button>
    </div>

    <p v-if="d.needQuery" class="hint"><Tv :size="16" />{{ t('live.discover.needQuery') }}</p>

    <template v-else>
      <div v-if="list?.error && !list.items.length" class="state">
        <StateView kind="error" :error="list.error" @retry="d.refresh()" @login="login" @verify="verify" />
      </div>
      <p v-else-if="empty" class="hint">
        {{ d.query ? t('live.discover.emptySearch', { kw: d.query }) : t('live.discover.empty') }}
      </p>
      <div v-else class="grid" :aria-busy="list?.loading">
        <template v-if="skeletons">
          <div v-for="i in 8" :key="`sk${i}`" class="sk-card" aria-hidden="true">
            <span class="sk cover" />
            <span class="sk line" />
            <span class="sk line short" />
          </div>
        </template>
        <LiveCard v-for="l in list?.items ?? []" :key="l.id" :live="l" @pick="pick" />
      </div>
      <p v-if="list?.loading && list.items.length" class="more"><CatbusLoader :size="14" />{{ t('live.discover.loading') }}</p>
      <p v-else-if="list?.error && list.items.length" class="more err">
        {{ errorTitle(list.error) }}
        <button type="button" class="retry" @click="d.load(true)">{{ t('live.player.retry') }}</button>
      </p>
    </template>
    <div ref="sentinel" class="sentinel" aria-hidden="true" />
  </section>
</template>

<style scoped>
.discover {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.d-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.d-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.d-sub {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  border-radius: 14px;
}
.s-ico {
  flex: none;
  color: var(--ink-3);
}
.search input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  outline: none;
}
.search input::-webkit-search-cancel-button {
  display: none;
}
.search:focus-within {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 1px;
}
.s-clear {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}
.s-clear:hover {
  background: var(--lg-fill-hover);
}
.s-btn {
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--hair);
  border-radius: 999px;
  background: var(--glass);
  color: var(--ink-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.chip:hover {
  background: var(--lg-fill-hover);
}
.chip[aria-pressed='true'] {
  border-color: transparent;
  background: var(--red-soft);
  color: var(--red);
  font-weight: 600;
}
.chip:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 1px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px 14px;
}
.sk-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sk {
  display: block;
  border-radius: 6px;
  background: var(--skeleton);
  animation: pulse 1.2s ease-in-out infinite;
}
.sk.cover {
  aspect-ratio: 16 / 9;
  border-radius: 12px;
}
.sk.line {
  height: 14px;
}
.sk.short {
  width: 55%;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 24px 0;
  font-size: 13px;
  color: var(--ink-3);
  text-align: center;
}
.state {
  display: grid;
  place-items: center;
  padding: 24px 0;
}
.more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 4px 0;
  font-size: 12px;
  color: var(--ink-3);
}
.more.err {
  color: var(--red);
}
.retry {
  padding: 0;
  border: 0;
  background: none;
  color: var(--red);
  font: inherit;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.sentinel {
  height: 1px;
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 10px;
  }
  .search input {
    font-size: 16px;
    height: 40px;
  }
  .s-clear {
    width: 44px;
    height: 44px;
  }
  .chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 -4px;
    padding: 0 4px;
  }
  .chip {
    flex: none;
    height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sk {
    animation: none;
  }
}
</style>
