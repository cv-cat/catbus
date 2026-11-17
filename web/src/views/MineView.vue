<script setup lang="ts">
import { flyItems } from '@/composables/flyToDownloads'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ChevronRight, ExternalLink, Folder as FolderIcon, LogIn, Menu, RefreshCw } from 'lucide-vue-next'
import AuthorHeader from '@/components/AuthorHeader.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import SelectionActions from '@/components/SelectionActions.vue'
import DownloadCenter from '@/components/DownloadCenter.vue'
import MasonryGrid from '@/components/MasonryGrid.vue'
import StateView from '@/components/StateView.vue'
import LoadingBar from '@/components/LoadingBar.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useMineStore } from '@/stores/mine'
import { useDiscoverStore } from '@/stores/discover'
import { useSelectionStore } from '@/stores/selection'
import { useDownloadsStore } from '@/stores/downloads'
import { useNavStore } from '@/stores/nav'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { openLogin } from '@/stores/login'
import { openVerify } from '@/stores/verify'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { platformById } from '@/data/platforms'
import { waveWhileLoading } from '@/composables/motion'
import { isNested, mineArgv, type MineTab } from '@/api/mine'
import CopyCommand from '@/components/tools/CopyCommand.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { toCommand } from '@/composables/command'
import { useSettingsStore } from '@/stores/settings'
import type { Item, User } from '@/api/types'
import type { Cell } from '@/stores/lanes'
import { errorTitle } from '@/i18n/errors'
import { mineTabLabel } from '@/composables/mine'
import { usePageSections } from '@/composables/sections'

/**
 * 各平台的「我的」页（AGENTS.md 7.9「各平台的「我的」页」，设计稿 mine-desgin Z1–Z4、Z9）：
 * 头部（user get me）+ 标签 + 瀑布流；收藏夹、合集是左侧列表 + 右侧内容。复用发现页的瀑布流、详情卡片、批量选择与下载。
 */
const m = useMineStore()
const d = useDiscoverStore()
const sel = useSelectionStore()
const downloads = useDownloadsStore()
const nav = useNavStore()
const bp = useBreakpoint()
const { t } = useI18n()

const platform = computed(() => platformById(m.platform)!)
const label = (tab: MineTab) => mineTabLabel(platform.value.id, tab)
const tabOptions = computed(() => m.tabs.map((v) => ({ value: v, label: label(v) })))
const tabModel = computed({ get: () => m.tab ?? m.tabs[0]!, set: (v: MineTab) => m.setTab(v) })
const curLabel = computed(() => (m.tab ? label(m.tab) : ''))

/** 头部：user get me；取不到时用账号卡里的头像和昵称 */
const headerUser = computed<User | null>(() => {
  if (m.header?.data) return m.header.data
  const a = d.accountFor(m.platform)?.user
  if (!a) return null
  return { id: a.id, name: a.name, handle: null, avatar: a.avatar ?? null, url: a.url, bio: null, stats: { followers: null, following: null, items: null, likes: null } }
})

const items = computed<Item[]>(() => m.page?.items ?? [])
const cells = computed<Cell[]>(() => items.value.map((item) => ({ key: item.id, platform: m.platform, item })))
const feed = {
  targetOf: () => ({ platform: m.platform, account: m.account() }),
  loadMore: () => m.loadMore(),
  hasMore: () => Boolean(m.page?.hasMore),
}

// ---------- 收藏夹 / 合集 ----------
const nested = computed(() => Boolean(m.tab && isNested(m.tab)))
const folders = computed(() => m.folderList?.data ?? [])
const curFolder = computed(() => folders.value.find((f) => f.id === m.sub) ?? null)
// 桌面上默认选中第一个（替换地址，不多出一条历史）；手机上先显示列表
watch(
  () => [nested.value, folders.value, m.sub, bp.phone] as const,
  ([n, list, sub, phone]) => {
    if (n && !phone && !sub && list.length) m.setSub(list[0]!.id, true)
  },
  { immediate: true },
)

// ---------- 状态 ----------
const loaded = computed(() => {
  const p = m.page
  if (!p?.loaded) return ''
  const time = p.elapsed != null ? ` · ${p.elapsed.toFixed(2)}s` : ''
  return t('author.loaded.count', { n: p.items.length }, p.items.length) + time
})
const error = computed(() => (nested.value && !m.sub ? (m.folderList?.error ?? null) : (m.page?.error ?? m.folderList?.error ?? null)))
const loading = computed(() => Boolean(m.page?.loading || (nested.value && m.folderList?.loading)))

async function downloadSelected() {
  const picked: Item[] = sel.pick(items.value)
  if (!picked.length) return
  const from = document.activeElement
  try {
    await downloads.start(m.platform, m.account(), picked, commentsSupported(m.platform))
    void flyItems(picked, from)
    sel.none()
  } catch (e) {
    alert((e as Error).message)
  }
}
const settings = useSettingsStore()
/** 复制等价命令（AGENTS.md 7.9）：当前标签（收藏夹、合集里选中了一个时是它的内容） */
const command = () => {
  const argv = mineArgv(m.platform, m.tab ?? m.tabs[0]!, m.sub, m.account(), settings.settings.pageSize)
  return toCommand(argv, isNested(m.tab ?? m.tabs[0]!) && m.sub ? 1 : 0)
}
const login = () => openLogin(m.platform, m.account() ?? undefined)
const verify = (url: string) => openVerify({ platform: m.platform, url, message: error.value ? errorTitle(error.value) : undefined, retry: () => m.refresh() })

/** 手机：标题下面「发现 / 我的」分段 */
const { options: sections, model: section } = usePageSections(() => m.platform, () => 'me')

// ---------- 滚动：切标签回到顶部；滚到底自动翻页 ----------
const root = ref<HTMLElement>()
const sentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined
watch(
  () => [m.tab, m.sub],
  () => root.value?.scrollTo({ top: 0 }),
)
watch(loading, (busy) => {
  waveWhileLoading(busy)
  if (busy || !io || !sentinel.value) return
  void nextTick(() => {
    io!.unobserve(sentinel.value!)
    io!.observe(sentinel.value!)
  })
})
onMounted(() => {
  io = new IntersectionObserver(([e]) => e?.isIntersecting && m.loadMore(), { root: root.value, rootMargin: '600px' })
  if (sentinel.value) io.observe(sentinel.value)
  m.ensure()
})
// 哨兵只在有列表时渲染（未登录、失效时没有），出现 / 消失时各自挂上 / 摘掉
watch(
  sentinel,
  (el, old) => {
    if (old) io?.unobserve(old)
    if (el) io?.observe(el)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => {
  io?.disconnect()
  waveWhileLoading(false)
})
</script>

<template>
  <main ref="root" class="mine-page" :class="{ 'has-bar': bp.phone && sel.active }">
    <header class="top" :class="{ phone: bp.phone }">
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
        <h1>{{ bp.phone ? `${platform.name} · ${t('mteam.nav.me')}` : t('mine.title') }}</h1>
      </div>
      <div class="spacer" />
      <template v-if="!bp.phone && m.hasAccount">
        <SelectionActions :items="items" :platforms="[platform.id]" @download="downloadSelected" />
        <DownloadCenter class="tool" />
      </template>
    </header>

    <div v-if="bp.phone" class="phone-seg">
      <SegmentedControl v-model="section" :options="sections" :label="platform.name" />
    </div>

    <!-- 没有这个平台的账号 / 登录已失效（Z9） -->
    <div v-if="!m.hasAccount || m.expired" class="login glass">
      <span class="login-ico"><LogIn :size="22" /></span>
      <h2>{{ m.expired ? t('mine.expired') : t('mine.login', { platform: platform.name, tabs: m.tabs.map(label).join(t('mine.joiner')) }) }}</h2>
      <p>{{ m.expired ? t('mine.expiredDesc') : t('mine.loginDesc') }}</p>
      <GlassButton tone="primary" size="lg" class="cta" @click="login">{{ m.expired ? t('common.action.relogin') : t('common.action.login') }}</GlassButton>
    </div>

    <template v-else>
      <AuthorHeader :user="headerUser" :platform="platform" />

      <div class="tabs">
        <SegmentedControl v-if="tabOptions.length > 1" v-model="tabModel" class="seg" :options="tabOptions" :label="t('mine.title')" />
        <h2 v-else class="one">{{ curLabel }}</h2>
        <div class="spacer" />
        <span v-if="loading && !bp.phone" class="count mono"><CatbusLoader :size="13" />{{ t('common.state.loading') }}</span>
        <span v-else-if="loaded && !bp.phone" class="count mono">{{ loaded }}</span>
        <CopyCommand class="refresh" :size="15" :command="command" />
        <GlassButton icon size="sm" class="refresh" :aria-label="t('mine.refresh')" v-tip="t('mine.refresh')" :disabled="loading" @click="m.refresh()">
          <RefreshCw :size="15" :class="{ spin: loading }" />
        </GlassButton>
        <LoadingBar class="tabs-progress" :active="loading" />
      </div>

      <!-- 收藏夹 / 合集：左侧列表，右侧内容（Z4）；手机上先列表，点进去看内容 -->
      <div v-if="nested" class="folders" :class="{ phone: bp.phone }">
        <aside v-if="!bp.phone || !m.sub" class="f-list glass">
          <template v-if="m.folderList?.loading && !folders.length">
            <div v-for="i in 4" :key="i" class="f-row skel" />
          </template>
          <StateView v-else-if="m.folderList?.error" kind="error" :error="m.folderList.error" @retry="m.loadFolders(m.tab as 'folders' | 'series', true)" @login="login" @verify="verify" />
          <p v-else-if="m.folderList?.data && !folders.length" class="empty">{{ t('mine.empty', { tab: curLabel }) }}</p>
          <button
            v-for="f in folders"
            :key="f.id"
            type="button"
            class="f-row"
            :class="{ on: f.id === m.sub }"
            :aria-current="f.id === m.sub ? 'true' : undefined"
            @click="m.setSub(f.id)"
          >
            <FolderIcon :size="16" />
            <span class="f-name">{{ f.name || f.id }}</span>
            <span v-if="f.count != null" class="f-n mono">{{ f.count }}</span>
            <ChevronRight v-if="bp.phone" :size="16" class="f-go" />
          </button>
        </aside>
        <section v-if="m.sub" class="f-body">
          <div class="f-head">
            <GlassButton v-if="bp.phone" icon tone="quiet" :aria-label="t('common.action.back')" @click="m.setSub(null)"><ArrowLeft :size="18" /></GlassButton>
            <h3>{{ curFolder?.name ?? m.sub }}</h3>
            <span v-if="curFolder?.count != null" class="pill mono">{{ curFolder.count }}</span>
            <div class="spacer" />
            <a v-if="curFolder?.url" class="lg-btn lg-sm open" :href="curFolder.url" target="_blank" rel="noopener noreferrer">
              <ExternalLink :size="13" />{{ t('mine.openOn', { platform: platform.name }) }}
            </a>
          </div>
          <StateView v-if="m.page?.error && !items.length" kind="error" :error="m.page.error" @retry="m.refresh()" @login="login" @verify="verify" />
          <p v-else-if="m.page?.loaded && !items.length" class="empty">{{ t('mine.folderEmpty') }}</p>
          <MasonryGrid v-else :cells="cells" :loading="!m.page?.loaded" :feed="feed" />
        </section>
      </div>

      <template v-else>
        <StateView v-if="error && !items.length" kind="error" :error="error" @retry="m.refresh()" @login="login" @verify="verify" />
        <p v-else-if="m.page?.loaded && !items.length" class="empty">{{ t('mine.empty', { tab: curLabel }) }}</p>
        <MasonryGrid v-else :cells="cells" :loading="!m.page?.loaded" :feed="feed" />
      </template>

      <div ref="sentinel" class="sentinel" aria-hidden="true" />
      <p v-if="m.page?.loadingMore" class="more mono"><CatbusLoader :size="15" />{{ t('common.state.loading') }}</p>
      <p v-else-if="items.length && !m.page?.hasMore" class="more mono">{{ t('discover.end') }}</p>
    </template>

    <SelectionActions v-if="bp.phone" bar :items="items" :platforms="[platform.id]" @download="downloadSelected" />
  </main>
</template>

<style scoped>
.mine-page {
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
.title {
  flex: none;
  white-space: nowrap;
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
.spacer {
  flex: 1;
}
.tool {
  flex: none;
}
.tabs {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 4px;
}
.seg {
  flex: none;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.one {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.refresh {
  flex: none;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.tabs-progress {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: -9px;
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
.cta {
  font-weight: 600;
}
.folders {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.folders.phone {
  grid-template-columns: minmax(0, 1fr);
}
.f-list {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border-radius: 20px;
  background: var(--lg-fill);
  box-shadow: var(--lg-edge), var(--lg-shadow);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
}
/* 收藏夹列表是玻璃轨道，选中项是红玻璃胶囊 */
.f-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: none;
  transition: background 0.2s, color 0.2s, box-shadow 0.2s;
  color: var(--ink-2);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.f-row:hover {
  background: var(--lg-fill-hover);
  color: var(--ink);
}
.f-row:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
.f-row.on {
  background: var(--lg-accent-fill);
  box-shadow: var(--lg-edge);
  color: var(--red);
  font-weight: 600;
}
.f-row.skel {
  background: var(--hair);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}
.f-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.f-n {
  font-size: 12px;
  color: var(--ink-3);
}
.f-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.f-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.f-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.pill {
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--hair);
  font-size: 12px;
  color: var(--ink-2);
}
.open {
  gap: 5px;
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
.phone-seg {
  display: flex;
  justify-content: center;
}
/* 手机（Z3）：顶栏是玻璃条；可点元素不低于 44px */
@media (max-width: 640px) {
  .mine-page {
    padding: 0 calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
    gap: 14px;
  }
  .mine-page.has-bar {
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
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .refresh {
    --lg-h: 44px;
  }
  .f-row {
    min-height: 52px;
    font-size: 16px;
  }
}
</style>
