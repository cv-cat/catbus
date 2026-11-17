<script setup lang="ts">
import { flyItems } from '@/composables/flyToDownloads'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark, Check, Clock, Download, FolderInput, Layers, Menu, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-vue-next'
import SelectionActions from '@/components/SelectionActions.vue'
import DownloadCenter from '@/components/DownloadCenter.vue'
import MasonryGrid from '@/components/MasonryGrid.vue'
import AppSelect from '@/components/AppSelect.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { LATER, keyOf, useLocalStore, type LocalEntry } from '@/stores/local'
import { useDiscoverStore } from '@/stores/discover'
import { useSelectionStore } from '@/stores/selection'
import { useDownloadsStore } from '@/stores/downloads'
import { useNavStore } from '@/stores/nav'
import { toast } from '@/stores/toast'
import { commentsSupported } from '@/composables/useCommentsSupport'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { platformById } from '@/data/platforms'
import type { Item } from '@/api/types'
import type { Cell } from '@/stores/lanes'

/**
 * 本地收藏（AGENTS.md 7.9「本地收藏与稍后看」，设计稿 mine-desgin Z5 / Z6）：
 * 左侧分组面板（全部、稍后看、自定义分组，导出 / 导入），右侧本地搜索、排序、平台筛选和瀑布流。只读浏览器里的数据，不发请求。
 */
const local = useLocalStore()
const d = useDiscoverStore()
const sel = useSelectionStore()
const downloads = useDownloadsStore()
const nav = useNavStore()
const bp = useBreakpoint()
const { t } = useI18n()

// ---------- 筛选 ----------
const query = ref('')
type Sort = 'added_desc' | 'added_asc' | 'published'
const sort = ref<Sort>('added_desc')
const sortOptions = computed(() => [
  { value: 'added_desc' as const, label: t('local.sort.addedDesc') },
  { value: 'added_asc' as const, label: t('local.sort.addedAsc') },
  { value: 'published' as const, label: t('local.sort.published') },
])
const platformsOn = ref<string[]>([])

const inGroup = computed(() => (local.group ? local.entries.filter((e) => e.groups.includes(local.group!)) : local.entries))
/** 只列出有条目的平台 */
const platforms = computed(() => [...new Set(inGroup.value.map((e) => e.platform))].map((id) => platformById(id)!).filter(Boolean))
watch(platforms, (list) => (platformsOn.value = platformsOn.value.filter((p) => list.some((x) => x.id === p))))
const togglePlatform = (id: string) =>
  (platformsOn.value = platformsOn.value.includes(id) ? platformsOn.value.filter((p) => p !== id) : [...platformsOn.value, id])

const shown = computed<LocalEntry[]>(() => {
  const q = query.value.trim().toLowerCase()
  let list = inGroup.value
  if (platformsOn.value.length) list = list.filter((e) => platformsOn.value.includes(e.platform))
  if (q) list = list.filter((e) => [e.item.title, e.item.text, e.item.author?.name].some((s) => s?.toLowerCase().includes(q)))
  const time = (s: string | null) => (s ? Date.parse(s) || 0 : 0)
  const sorted = [...list]
  if (sort.value === 'added_asc') sorted.sort((a, b) => a.added_at.localeCompare(b.added_at))
  else if (sort.value === 'published') sorted.sort((a, b) => time(b.item.created_at) - time(a.item.created_at))
  else sorted.sort((a, b) => b.added_at.localeCompare(a.added_at))
  return sorted
})
const items = computed<Item[]>(() => shown.value.map((e) => e.item))
const cells = computed<Cell[]>(() => shown.value.map((e) => ({ key: keyOf(e.platform, e.item.id), platform: e.platform, item: e.item })))
/** 条目 → 平台（选择、详情、下载用） */
const platformOf = (item: Item) => shown.value.find((e) => e.item === item || e.item.id === item.id)?.platform ?? ''
const feed = {
  targetOf: (item: Item) => {
    const p = platformOf(item)
    return { platform: p, account: d.accountFor(p)?.account ?? null }
  },
  loadMore: () => {},
  hasMore: () => false,
}
watch(() => [local.group, query.value, sort.value, platformsOn.value.join()], () => sel.none())

// ---------- 分组 ----------
const groupTitle = computed(() => (local.group ? local.groupName(local.group) : t('local.group.all')))
const creating = ref(false)
const editing = ref<string | null>(null)
const draft = ref('')
const draftError = ref<string | null>(null)
const confirmDelete = ref<string | null>(null)
const nameInput = ref<HTMLInputElement[] | HTMLInputElement>()
async function focusInput() {
  await nextTick()
  const el = Array.isArray(nameInput.value) ? nameInput.value[0] : nameInput.value
  el?.focus()
}
function startCreate() {
  editing.value = null
  creating.value = true
  draft.value = ''
  draftError.value = null
  void focusInput()
}
function startRename(id: string, name: string) {
  creating.value = false
  editing.value = id
  draft.value = name
  draftError.value = null
  void focusInput()
}
function cancelName() {
  creating.value = false
  editing.value = null
  draftError.value = null
}
function saveName() {
  const err = local.checkName(draft.value, editing.value ?? undefined)
  if (err) return void (draftError.value = err)
  if (editing.value) local.renameGroup(editing.value, draft.value)
  else {
    const id = local.createGroup(draft.value)
    if (id) local.setGroup(id)
  }
  cancelName()
}
function removeGroup(id: string) {
  if (confirmDelete.value !== id) return void (confirmDelete.value = id)
  confirmDelete.value = null
  local.deleteGroup(id)
}

// ---------- 导出 / 导入 ----------
const file = ref<HTMLInputElement>()
async function onImport(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  const r = local.importText(await f.text())
  toast(r ? t('local.import.done', { added: r.added, merged: r.merged, skipped: r.skipped }) : t('local.import.invalid'), 3200)
}

// ---------- 批量操作 ----------
const moveOpen = ref(false)
const removeConfirm = ref(false)
const picked = () => sel.pick(items.value)
const pickedKeys = () => picked().map((it) => keyOf(platformOf(it), it.id))
function moveTo(g: string) {
  local.addToGroup(pickedKeys(), g)
  toast(t('local.bulk.moved', { n: sel.count, group: local.groupName(g) }, sel.count))
  moveOpen.value = false
  sel.none()
}
function removePicked() {
  if (!removeConfirm.value) return void (removeConfirm.value = true)
  removeConfirm.value = false
  const n = sel.count
  local.remove(pickedKeys())
  sel.none()
  toast(t('local.bulk.removed', { n }, n))
}
watch(() => sel.count, () => (removeConfirm.value = false))
/** 下载：按平台各建一批 */
async function downloadSelected() {
  const from = document.activeElement
  const list0 = picked()
  const byPlatform = new Map<string, Item[]>()
  for (const it of list0) {
    const p = platformOf(it)
    byPlatform.set(p, [...(byPlatform.get(p) ?? []), it])
  }
  try {
    for (const [p, list] of byPlatform) await downloads.start(p, d.accountFor(p)?.account ?? null, list, commentsSupported(p))
    void flyItems(list0, from)
    sel.none()
  } catch (e) {
    alert((e as Error).message)
  }
}

const groupIcon = (id: string | null) => (id === null ? Layers : id === LATER ? Clock : Bookmark)
</script>

<template>
  <main class="local-page" :class="{ 'has-bar': bp.phone && sel.active }">
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
        <div v-if="!bp.phone" class="eyebrow">{{ t('local.eyebrow') }}</div>
        <h1>{{ t('local.title') }}</h1>
      </div>
      <div class="spacer" />
      <template v-if="!bp.phone">
        <SelectionActions :items="items" :platforms="platforms.map((p) => p.id)" :platform-of="platformOf" @download="downloadSelected" />
        <DownloadCenter class="tool" />
      </template>
    </header>

    <div class="layout" :class="{ phone: bp.phone }">
      <!-- 分组面板（桌面）/ 分组 chip（手机） -->
      <aside class="groups" :class="bp.phone ? 'chips' : 'glass'" :aria-label="t('local.group.label')">
        <button type="button" class="g" :class="{ on: !local.group }" @click="local.setGroup(null)">
          <component :is="groupIcon(null)" :size="15" />
          <span class="g-name">{{ t('local.group.all') }}</span>
          <span class="g-n mono">{{ local.countOf(null) }}</span>
        </button>
        <div v-for="g in local.allGroups" :key="g.id" class="g-wrap">
          <form v-if="editing === g.id" class="name-form" @submit.prevent="saveName">
            <input ref="nameInput" v-model="draft" :maxlength="40" @input="draftError = null" @keydown.esc.stop="cancelName" />
            <GlassButton type="submit" icon size="sm" tone="primary" :aria-label="t('common.action.save')"><Check :size="14" /></GlassButton>
            <GlassButton icon size="sm" tone="quiet" :aria-label="t('common.action.cancel')" @click="cancelName"><X :size="14" /></GlassButton>
          </form>
          <button v-else type="button" class="g" :class="{ on: local.group === g.id }" @click="local.setGroup(g.id)">
            <component :is="groupIcon(g.id)" :size="15" />
            <span class="g-name">{{ g.name }}</span>
            <span class="g-n mono">{{ local.countOf(g.id) }}</span>
          </button>
          <span v-if="g.id !== LATER && editing !== g.id && !bp.phone" class="g-acts">
            <GlassButton icon size="sm" tone="quiet" :aria-label="t('local.group.rename')" v-tip="t('local.group.rename')" @click="startRename(g.id, g.name)"><Pencil :size="13" /></GlassButton>
            <GlassButton
              icon
              size="sm"
              :tone="confirmDelete === g.id ? 'danger' : 'quiet'"
              :class="{ 'is-on': confirmDelete === g.id }"
              :aria-label="confirmDelete === g.id ? t('local.group.deleteConfirm') : t('local.group.delete')"
              v-tip="confirmDelete === g.id ? t('local.group.deleteConfirm') : t('local.group.delete')"
              @click="removeGroup(g.id)"
              @blur="confirmDelete = null"
            >
              <Trash2 :size="13" />
            </GlassButton>
          </span>
        </div>
        <form v-if="creating" class="name-form" @submit.prevent="saveName">
          <input ref="nameInput" v-model="draft" :maxlength="40" :placeholder="t('local.group.namePlaceholder')" @input="draftError = null" @keydown.esc.stop="cancelName" />
          <GlassButton type="submit" icon size="sm" tone="primary" :aria-label="t('common.action.save')"><Check :size="14" /></GlassButton>
          <GlassButton icon size="sm" tone="quiet" :aria-label="t('common.action.cancel')" @click="cancelName"><X :size="14" /></GlassButton>
        </form>
        <p v-if="draftError" class="err">{{ draftError }}</p>
        <button v-if="!creating" type="button" class="g add" @click="startCreate"><Plus :size="15" /><span class="g-name">{{ t('local.group.create') }}</span></button>
        <div v-if="!bp.phone" class="io">
          <GlassButton class="io-btn" :disabled="!local.entries.length" @click="local.exportFile()"><Download :size="14" />{{ t('local.export') }}</GlassButton>
          <GlassButton class="io-btn" @click="file?.click()"><Upload :size="14" />{{ t('local.import.label') }}</GlassButton>
        </div>
      </aside>

      <section class="content">
        <div class="bar">
          <h2>{{ groupTitle }}</h2>
          <span class="pill mono">{{ shown.length }}</span>
          <div class="spacer" />
          <label class="search glass">
            <Search :size="15" />
            <input v-model="query" type="search" :placeholder="t('local.search')" />
          </label>
          <AppSelect v-model="sort" class="sort" :options="sortOptions" :label="t('local.sort.label')" :title="t('local.sort.label')" />
        </div>
        <div v-if="platforms.length > 1" class="chips-row">
          <GlassButton
            v-for="p in platforms"
            :key="p.id"
            class="chip"
            :pressed="platformsOn.includes(p.id)"
            @click="togglePlatform(p.id)"
          >
            <img :src="p.logo" alt="" />{{ p.name }}
          </GlassButton>
        </div>
        <div v-if="bp.phone" class="io phone-io">
          <GlassButton class="io-btn" :disabled="!local.entries.length" @click="local.exportFile()"><Download :size="14" />{{ t('local.export') }}</GlassButton>
          <GlassButton class="io-btn" @click="file?.click()"><Upload :size="14" />{{ t('local.import.label') }}</GlassButton>
        </div>

        <!-- 批量：移到分组、移除 -->
        <div v-if="sel.active" class="bulk glass">
          <span class="mono">{{ t('local.bulk.count', { n: sel.count }, sel.count) }}</span>
          <div class="spacer" />
          <div class="move">
            <GlassButton class="io-btn" :class="{ 'is-on': moveOpen }" :aria-expanded="moveOpen" @click="moveOpen = !moveOpen"><FolderInput :size="14" />{{ t('local.bulk.move') }}</GlassButton>
            <div v-if="moveOpen" class="move-menu glass" role="menu">
              <button v-for="g in local.allGroups" :key="g.id" type="button" role="menuitem" class="g" @click="moveTo(g.id)">{{ g.name }}</button>
            </div>
          </div>
          <GlassButton class="io-btn" tone="danger" :class="{ 'is-on': removeConfirm }" @click="removePicked">
            <Trash2 :size="14" />{{ removeConfirm ? t('local.bulk.removeConfirm') : t('local.bulk.remove') }}
          </GlassButton>
        </div>

        <div v-if="!local.entries.length" class="empty glass">
          <span class="e-ico"><Bookmark :size="22" /></span>
          <h3>{{ t('local.empty.title') }}</h3>
          <p>{{ t('local.empty.desc') }}</p>
        </div>
        <p v-else-if="!shown.length" class="none">{{ t('local.empty.filtered') }}</p>
        <MasonryGrid v-else :cells="cells" aggregate :feed="feed" />
      </section>
    </div>

    <input ref="file" type="file" accept="application/json,.json" hidden @change="onImport" />
    <SelectionActions v-if="bp.phone" bar :items="items" :platforms="platforms.map((p) => p.id)" :platform-of="platformOf" @download="downloadSelected" />
  </main>
</template>

<style scoped>
.local-page {
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
.layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.layout.phone {
  grid-template-columns: minmax(0, 1fr);
}
.groups.glass {
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
.g-wrap {
  position: relative;
}
.g {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 38px;
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
.g:hover {
  background: var(--lg-fill-hover);
  color: var(--ink);
}
.g:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
}
/* 分组面板是玻璃轨道，选中项是红玻璃胶囊 */
.g.on {
  background: var(--lg-accent-fill);
  box-shadow: var(--lg-edge);
  color: var(--red);
  font-weight: 600;
}
.g.add {
  color: var(--ink-3);
}
.g-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.g-n {
  font-size: 12px;
  color: var(--ink-3);
}
.g-acts {
  position: absolute;
  top: 50%;
  right: 6px;
  display: none;
  gap: 2px;
  transform: translateY(-50%);
}
.g-wrap:hover .g-acts,
.g-wrap:focus-within .g-acts {
  display: flex;
}
.g-wrap:hover .g-n,
.g-wrap:focus-within .g-n {
  visibility: hidden;
}
.name-form {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
}
.name-form input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--red);
  background: var(--glass);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.err {
  margin: 2px 10px;
  font-size: 12px;
  color: var(--red);
}
.io {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--hair);
}
.io-btn {
  flex: 1;
  gap: 5px;
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
.bar h2 {
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
.search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(280px, 100%);
  height: 36px;
  padding: 0 12px;
  border-radius: 18px;
  color: var(--ink-3);
}
.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.sort {
  flex: none;
}
.chips-row,
.groups.chips {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 0 4px;
}
.chip img {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}
.chip[aria-pressed='true'] {
  font-weight: 600;
}
.bulk {
  position: sticky;
  top: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 14px;
  font-size: 13px;
}
.bulk .io-btn {
  flex: none;
}
.move {
  position: relative;
}
.move-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 5;
  min-width: 180px;
  padding: 6px;
  border-radius: 12px;
  background: var(--glass-strong);
  box-shadow: var(--shadow-card);
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
  margin: 48px 0;
  text-align: center;
  font-size: 14px;
  color: var(--ink-3);
}
/* 手机（Z6）：分组是顶部横向 chip；可点元素不低于 44px */
@media (max-width: 640px) {
  .local-page {
    padding: 0 calc(12px + var(--safe-right)) calc(32px + var(--safe-bottom)) calc(12px + var(--safe-left));
    gap: 14px;
  }
  .local-page.has-bar {
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
  h1 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: 0;
  }
  .groups.chips .g,
  .groups.chips .g-wrap {
    flex: none;
    width: auto;
  }
  .groups.chips .g {
    min-height: 44px;
    background: var(--lg-fill);
    box-shadow: var(--lg-edge), var(--lg-shadow);
    -webkit-backdrop-filter: var(--lg-blur);
    backdrop-filter: var(--lg-blur);
  }
  .groups.chips .g.on {
    background: var(--lg-accent-fill);
  }
  .search {
    width: 100%;
    height: 44px;
  }
  .search input {
    font-size: 16px;
  }
  .chip,
  .io-btn {
    --lg-h: 44px;
  }
  .phone-io {
    margin: 0;
    padding: 0;
    border: 0;
  }
}
</style>
