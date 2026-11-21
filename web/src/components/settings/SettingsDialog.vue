<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Download, FlaskConical, Palette, RotateCcw, SlidersHorizontal, X } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SettingsGeneral from './SettingsGeneral.vue'
import SettingsDisplay from './SettingsDisplay.vue'
import SettingsExperimental from './SettingsExperimental.vue'
import SettingsDownload from './SettingsDownload.vue'
import { useSettingsStore, type SettingsTab } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { gsap, prefersReducedMotion } from '@/composables/motion'

/**
 * 设置弹窗（AGENTS.md 7.9「设置」）：左侧分栏菜单，右侧该分栏的设置项。
 * 外壳用 BottomSheet：桌面居中弹窗，手机底部弹层；Esc、遮罩、焦点陷阱都由它处理。
 */
const store = useSettingsStore()
const { open, tab } = storeToRefs(store)
// 主题跟随系统需要有人一直监听：弹窗常驻在 App 里，在这里初始化一次
useTheme()
const bp = useBreakpoint()
const { t } = useI18n()

const TABS = computed<{ value: SettingsTab; label: string; icon: Component }[]>(() => [
  { value: 'general', label: t('settings.dialog.tab.general'), icon: SlidersHorizontal },
  { value: 'display', label: t('settings.dialog.tab.display'), icon: Palette },
  { value: 'download', label: t('settings.dialog.tab.download'), icon: Download },
  { value: 'experimental', label: t('settings.dialog.tab.experimental'), icon: FlaskConical },
])
const PANELS: Record<SettingsTab, Component> = {
  general: SettingsGeneral,
  display: SettingsDisplay,
  download: SettingsDownload,
  experimental: SettingsExperimental,
}
const current = computed(() => TABS.value.find((x) => x.value === tab.value)!)

const root = ref<HTMLElement>()
const content = ref<HTMLElement>()

/** 打开：菜单项和设置行依次浮入 */
function enter() {
  if (prefersReducedMotion() || !root.value) return
  const nav = root.value.querySelectorAll('[data-nav-item]')
  const rows = root.value.querySelectorAll('[data-setting-row]')
  gsap.fromTo(nav, { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.05, delay: 0.08, clearProps: 'transform,opacity' })
  gsap.fromTo(rows, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.03, delay: 0.12, clearProps: 'transform,opacity' })
}
watch(open, (v) => v && nextTick(enter))

/** 换分栏：回到顶部，新分栏的行淡入 */
watch(tab, () =>
  nextTick(() => {
    content.value?.scrollTo({ top: 0 })
    if (prefersReducedMotion() || !content.value) return
    gsap.fromTo(
      content.value.querySelectorAll('[data-setting-row]'),
      { y: 8, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out', stagger: 0.025, clearProps: 'transform,opacity' },
    )
  }),
)

/** 菜单：↑ / ↓ 在分栏之间移动（tablist 的键盘约定） */
function onNavKey(e: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  const tabs = TABS.value
  const i = tabs.findIndex((x) => x.value === tab.value)
  const n = tabs.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
  tab.value = tabs[next]!.value
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-nav-item="${tabs[next]!.value}"]`)?.focus())
}

// ---------- 恢复默认：点两次才生效 ----------
const confirming = ref(false)
let confirmTimer: ReturnType<typeof setTimeout> | undefined
function onReset() {
  if (!confirming.value) {
    confirming.value = true
    clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirming.value = false), 3000)
    return
  }
  clearTimeout(confirmTimer)
  confirming.value = false
  store.reset()
}
watch(open, (v) => !v && (confirming.value = false))
onBeforeUnmount(() => clearTimeout(confirmTimer))
</script>

<template>
  <BottomSheet :open="open" labelledby="settings-title" width="800px" :z="60" @close="store.close()">
    <div ref="root" class="settings" :class="{ phone: bp.phone }">
      <header class="head">
        <h2 id="settings-title">{{ t('settings.dialog.title') }}</h2>
        <GlassButton icon class="close" :aria-label="t('settings.dialog.close')" @click="store.close()">
          <X :size="18" />
        </GlassButton>
      </header>

      <!-- 手机：菜单变成顶部的分段选择 -->
      <div v-if="bp.phone" class="tabs-top">
        <SegmentedControl v-model="tab" :options="TABS" :label="t('settings.dialog.tabs')" />
      </div>
      <nav v-else class="nav" role="tablist" aria-orientation="vertical" :aria-label="t('settings.dialog.tabs')" @keydown="onNavKey">
        <button
          v-for="x in TABS"
          :id="`settings-tab-${x.value}`"
          :key="x.value"
          type="button"
          role="tab"
          class="nav-item"
          :class="{ active: tab === x.value }"
          :data-nav-item="x.value"
          :aria-selected="tab === x.value"
          aria-controls="settings-panel"
          :tabindex="tab === x.value ? 0 : -1"
          @click="tab = x.value"
        >
          <component :is="x.icon" :size="17" aria-hidden="true" />
          {{ x.label }}
        </button>
      </nav>

      <section
        id="settings-panel"
        ref="content"
        class="content"
        :role="bp.phone ? 'region' : 'tabpanel'"
        :aria-labelledby="bp.phone ? undefined : `settings-tab-${tab}`"
        :aria-label="bp.phone ? current.label : undefined"
      >
        <h3 class="panel-title">{{ current.label }}</h3>
        <component :is="PANELS[tab]" />
      </section>

      <footer class="foot">
        <span class="hint">{{ t('settings.dialog.hint') }}</span>
        <GlassButton class="reset" :tone="confirming ? 'primary' : 'default'" :class="{ confirming }" @click="onReset">
          <RotateCcw :size="15" aria-hidden="true" />
          {{ confirming ? t('settings.dialog.resetConfirm') : t('settings.dialog.reset') }}
        </GlassButton>
      </footer>
    </div>
  </BottomSheet>
</template>

<style scoped>
.settings {
  display: grid;
  grid-template-columns: 196px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'head head'
    'nav content'
    'nav foot';
  height: min(600px, calc(100dvh - 64px));
}
.head {
  grid-area: head;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 18px 10px 24px;
}
h2 {
  margin: 0;
  font-family: var(--font-brand);
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
}

/* ---------- 左侧菜单：玻璃轨道，选中项是红玻璃胶囊 ---------- */
.nav {
  grid-area: nav;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 12px 18px 16px;
  padding: 5px;
  border-radius: 20px;
  background: var(--lg-fill);
  -webkit-backdrop-filter: var(--lg-blur);
  backdrop-filter: var(--lg-blur);
  box-shadow: var(--lg-edge);
}
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 999px;
  font-size: 14px;
  color: var(--ink-2);
  text-align: left;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.2s, background 0.25s var(--ease-out), box-shadow 0.25s var(--ease-out), transform 0.2s var(--ease-out);
}
.nav-item:hover {
  color: var(--ink);
  background: var(--lg-fill-hover);
}
.nav-item:active {
  transform: scale(0.97);
}
.nav-item.active {
  color: var(--red);
  font-weight: 600;
  background: var(--lg-accent-fill);
  box-shadow: var(--lg-edge), var(--lg-shadow);
}
.nav-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: 2px;
}
@media (prefers-reduced-transparency: reduce) {
  .nav {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background: var(--detail-chip);
  }
}

/* ---------- 右侧内容 ---------- */
.content {
  grid-area: content;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 24px 8px;
}
.panel-title {
  margin: 4px 0 2px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--ink-3);
}

.foot {
  grid-area: foot;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 18px 16px 24px;
  border-top: 1px solid var(--hair);
}
.hint {
  font-size: 12px;
  color: var(--ink-3);
}

/* ---------- 手机：底部弹层，菜单在顶部 ---------- */
.settings.phone {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  grid-template-areas: 'head' 'tabs' 'content' 'foot';
  /* 底部弹层最高约 90dvh（BottomSheet），这里减去把手 */
  height: calc(min(90dvh, 100dvh - 12px - var(--safe-top)) - 22px);
}
.phone .head {
  padding: 2px 12px 6px 20px;
}
.tabs-top {
  grid-area: tabs;
  padding: 0 16px 6px;
}
.tabs-top :deep(.seg) {
  display: flex;
  width: 100%;
}
.tabs-top :deep(.seg button) {
  flex: 1;
}
.phone .content {
  padding: 0 20px 8px;
}
.phone .panel-title {
  display: none;
}
.phone .foot {
  padding: 10px 16px 12px 20px;
}
.phone .hint {
  display: none;
}
.phone .reset {
  margin-left: auto;
}
@media (pointer: coarse) {
  .nav-item {
    min-height: var(--tap);
  }
}
</style>
