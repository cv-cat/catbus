<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight, CheckCheck, ChevronDown, Download, FileOutput, SlidersHorizontal, X } from 'lucide-vue-next'
import type { Item } from '@/api/types'
import DownloadMenu from '@/components/DownloadMenu.vue'
import ExportMenu from '@/components/tools/ExportMenu.vue'
import { exportList, type ExportFormat } from '@/composables/export-list'
import { useSelectionStore } from '@/stores/selection'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 有卡片被选中时，从搜索框左侧依次向左弹出：全选、全不选、反选、下载。
 * `bar`：手机上改成固定在底部的操作条（带文字），从底部滑入。
 * 下载是一个分体按钮：左半边按上次的选择直接下载，右半边的箭头打开下载面板选内容和格式。
 * platforms：选中条目所属的平台（下载面板据此判断能不能带评论）。
 */
/** platformOf：条目属于哪个平台（导出时用；不给时取 platforms 的第一个） */
const props = defineProps<{ items: Item[]; compact?: boolean; bar?: boolean; platforms?: string[]; platformOf?: (item: Item) => string }>()
const emit = defineEmits<{ download: [] }>()
const sel = useSelectionStore()
const { t } = useI18n()

const ACTIONS = [
  { key: 'all', labelKey: 'discover.selection.all', icon: CheckCheck, run: () => sel.all(props.items) },
  { key: 'none', labelKey: 'discover.selection.none', icon: X, run: () => sel.none() },
  { key: 'invert', labelKey: 'discover.selection.invert', icon: ArrowLeftRight, run: () => sel.invert(props.items) },
  { key: 'export', labelKey: 'export.title', shortKey: 'export.short', icon: FileOutput, run: (e: MouseEvent) => openExport(e) },
  { key: 'download', labelKey: 'discover.selection.download', shortKey: 'common.action.download', icon: Download, run: () => emit('download') },
  { key: 'options', labelKey: 'download.panel.open', shortKey: 'download.panel.short', icon: SlidersHorizontal, run: (e: MouseEvent) => openMenu(e) },
] as const
/** 桌面、平板上前三个是圆按钮，下载和下载选项合成一个分体按钮 */
const ROUND = ACTIONS.slice(0, 4)
const N = ROUND.length + 1
const split = ref<HTMLElement | null>(null)

const menuOpen = ref(false)
const anchor = ref<HTMLElement | null>(null)
const exportOpen = ref(false)
const exportAnchor = ref<HTMLElement | null>(null)
function openExport(e: MouseEvent) {
  exportAnchor.value = e.currentTarget as HTMLElement
  exportOpen.value = !exportOpen.value
}
/** 导出选中的（不改变选中） */
function doExport(f: ExportFormat) {
  const fallback = props.platforms?.[0] ?? ''
  exportList(
    sel.pick(props.items).map((item) => ({ platform: props.platformOf?.(item) ?? fallback, item })),
    f,
  )
}
function openMenu(e: MouseEvent) {
  anchor.value = (props.bar ? null : split.value) ?? (e.currentTarget as HTMLElement)
  menuOpen.value = !menuOpen.value
}
</script>

<template>
  <Transition v-if="bar" name="bar">
    <div v-if="sel.active" class="bar glass" role="toolbar" :aria-label="t('discover.selection.label')">
      <i18n-t keypath="discover.selection.picked" tag="span" class="picked" :plural="sel.count">
        <template #n><b class="mono">{{ sel.count }}</b></template>
      </i18n-t>
      <GlassButton
        v-for="a in ACTIONS"
        :key="a.key"
        :tone="a.key === 'download' ? 'primary' : 'quiet'"
        class="bar-act"
        :aria-label="a.key === 'download' ? t('discover.selection.downloadCount', { n: sel.count }, sel.count) : t(a.labelKey)"
        :aria-expanded="a.key === 'options' ? menuOpen : a.key === 'export' ? exportOpen : undefined"
        @click="a.run($event)"
      >
        <component :is="a.icon" :size="18" aria-hidden="true" />
        <span>{{ t('shortKey' in a ? a.shortKey : a.labelKey) }}</span>
      </GlassButton>
    </div>
  </Transition>
  <div v-else class="actions" :class="{ compact }">
    <Transition v-for="(a, i) in ROUND" :key="a.key" name="slide">
      <GlassButton
        v-if="sel.active"
        icon
        class="act"
        :style="{ '--from': `${(N - i) * (compact ? 44 : 56)}px`, '--in': `${(N - 1 - i) * 45}ms`, '--out': `${i * 30}ms` }"
        :aria-label="t(a.labelKey)"
        :title="t(a.labelKey)"
        @click="a.run($event)"
      >
        <component :is="a.icon" :size="compact ? 15 : 18" />
      </GlassButton>
    </Transition>
    <Transition name="slide">
      <div
        v-if="sel.active"
        ref="split"
        class="split lg-split"
        role="group"
        :aria-label="t('common.action.download')"
        :style="{ '--from': `${compact ? 44 : 56}px`, '--in': '0ms', '--out': `${(N - 1) * 30}ms` }"
      >
        <button
          type="button"
          class="lg-btn lg-primary split-main"
          :aria-label="t('discover.selection.downloadCount', { n: sel.count }, sel.count)"
          :title="t('discover.selection.download')"
          @click="emit('download')"
        >
          <Download :size="compact ? 15 : 17" aria-hidden="true" />
          <span v-if="!compact" class="split-label">{{ t('common.action.download') }}</span>
          <span class="split-count mono">{{ sel.count }}</span>
        </button>
        <button
          type="button"
          class="lg-btn lg-primary split-more"
          :aria-label="t('download.panel.open')"
          :title="t('download.panel.open')"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          @click="openMenu($event)"
        >
          <ChevronDown :size="compact ? 14 : 16" class="chev" :class="{ open: menuOpen }" aria-hidden="true" />
        </button>
      </div>
    </Transition>
  </div>
  <ExportMenu :open="exportOpen && sel.active" :anchor="exportAnchor" :count="sel.count" @close="exportOpen = false" @pick="doExport" />
  <DownloadMenu
    :open="menuOpen && sel.active"
    :anchor="anchor"
    :platforms="platforms ?? []"
    :count="sel.count"
    @close="menuOpen = false"
    @download="emit('download')"
  />
</template>

<style scoped>
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}
/* 圆按钮外观来自 GlassButton（styles/glass-button.css） */
.act {
  --lg-h: 48px;
}
.compact .act {
  --lg-h: 36px;
}
/* 分体按钮：外形来自 lg-split + lg-primary（styles/glass-button.css），这里只定尺寸 */
.split {
  --lg-h: 48px;
  transition: transform 0.25s var(--ease-out);
}
.split > .lg-btn {
  --lg-h: inherit;
}
.compact .split {
  --lg-h: 36px;
}
.split-main {
  gap: 7px;
  padding: 0 12px 0 16px;
  font-size: 14px;
  font-weight: 600;
}
.compact .split-main {
  gap: 5px;
  padding: 0 8px 0 11px;
}
.split-more {
  width: 38px;
  min-width: 38px;
  padding: 0;
}
.compact .split-more {
  width: 28px;
  min-width: 28px;
}
.split-more[aria-expanded='true'] {
  filter: brightness(0.92);
}
.split-count {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--red);
  background: #fff;
}
.compact .split-count {
  min-width: 17px;
  height: 17px;
  font-size: 10px;
}
.chev {
  transition: transform 0.2s;
}
.chev.open {
  transform: rotate(180deg);
}

/* 从搜索框底下（右侧）滑出，越靠左的走得越远、越晚出现 */
.slide-enter-active {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) var(--in), opacity 0.25s ease-out var(--in);
}
.slide-leave-active {
  transition: transform 0.25s ease-in var(--out), opacity 0.2s ease-in var(--out);
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateX(var(--from)) scale(0.6);
}

/* 手机：底部操作条 */
.bar {
  position: fixed;
  left: calc(10px + var(--safe-left));
  right: calc(10px + var(--safe-right));
  bottom: calc(10px + var(--safe-bottom));
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: 22px;
  background: var(--glass-strong);
  box-shadow: 0 14px 40px #1b1f2e2e, 0 2px 8px #1b1f2e14;
}
.bar.glass {
  border: 0;
  box-shadow: var(--lg-edge), 0 14px 40px #1b1f2e2e, 0 2px 8px #1b1f2e14;
}
.picked {
  flex: none;
  padding: 0 8px 0 10px;
  font-size: 12px;
  color: var(--ink-2);
  white-space: nowrap;
}
.picked b {
  color: var(--red);
  font-size: 15px;
}
/* 外观来自 GlassButton：竖排的图标 + 文字小方块，下载是实心红玻璃 */
.bar-act.lg-btn {
  --lg-h: 58px;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 0;
  border-radius: 16px;
  font-size: 11px;
}
.bar-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.3, 0.64, 1), opacity 0.2s ease-out;
}
.bar-leave-active {
  transition: transform 0.22s ease-in, opacity 0.2s ease-in;
}
.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translateY(calc(100% + 24px));
}

@media (prefers-reduced-motion: reduce) {
  .slide-enter-active,
  .slide-leave-active,
  .bar-enter-active,
  .bar-leave-active {
    transition: opacity 0.2s;
  }
  .slide-enter-from,
  .slide-leave-to,
  .bar-enter-from,
  .bar-leave-to {
    transform: none;
  }
}
</style>
