<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ArrowLeftRight, CheckCheck, Download, X } from 'lucide-vue-next'
import type { Item } from '@/api/types'
import { useSelectionStore } from '@/stores/selection'

/**
 * 有卡片被选中时，从搜索框左侧依次向左弹出：全选、全不选、反选、下载。
 * `bar`：手机上改成固定在底部的操作条（带文字），从底部滑入。
 */
const props = defineProps<{ items: Item[]; compact?: boolean; bar?: boolean }>()
const emit = defineEmits<{ download: [] }>()
const sel = useSelectionStore()
const { t } = useI18n()

const ACTIONS = [
  { key: 'all', labelKey: 'discover.selection.all', icon: CheckCheck, run: () => sel.all(props.items) },
  { key: 'none', labelKey: 'discover.selection.none', icon: X, run: () => sel.none() },
  { key: 'invert', labelKey: 'discover.selection.invert', icon: ArrowLeftRight, run: () => sel.invert(props.items) },
  { key: 'download', labelKey: 'discover.selection.download', shortKey: 'common.action.download', icon: Download, run: () => emit('download') },
] as const
const N = ACTIONS.length
</script>

<template>
  <Transition v-if="bar" name="bar">
    <div v-if="sel.active" class="bar glass" role="toolbar" :aria-label="t('discover.selection.label')">
      <i18n-t keypath="discover.selection.picked" tag="span" class="picked" :plural="sel.count">
        <template #n><b class="mono">{{ sel.count }}</b></template>
      </i18n-t>
      <button
        v-for="a in ACTIONS"
        :key="a.key"
        type="button"
        class="bar-act"
        :class="{ primary: a.key === 'download' }"
        :aria-label="a.key === 'download' ? t('discover.selection.downloadCount', { n: sel.count }, sel.count) : t(a.labelKey)"
        @click="a.run()"
      >
        <component :is="a.icon" :size="18" aria-hidden="true" />
        <span>{{ t('shortKey' in a ? a.shortKey : a.labelKey) }}</span>
      </button>
    </div>
  </Transition>
  <div v-else class="actions" :class="{ compact }">
    <Transition v-for="(a, i) in ACTIONS" :key="a.key" name="slide">
      <button
        v-if="sel.active"
        type="button"
 class="act glass"
        :class="{ primary: a.key === 'download' }"
 :style="{ '--from': `${(N - i) * (compact ? 44 : 56)}px`, '--in': `${(N - 1 - i) * 45}ms`, '--out': `${i * 30}ms` }"
        :aria-label="t(a.labelKey)"
 :title="t(a.labelKey)"
 @click="a.run()"
      >
        <component :is="a.icon" :size="compact ? 15 : 18" />
        <span v-if="a.key === 'download'" class="count mono">{{ sel.count }}</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}
.act {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  box-shadow: 0 6px 18px #1b1f2e14;
  transition: color 0.2s, transform 0.25s var(--ease-out), box-shadow 0.25s;
}
.compact .act {
  width: 36px;
  height: 36px;
}
.act:hover {
  color: var(--ink);
  transform: translateY(-2px);
  box-shadow: 0 10px 24px #1b1f2e1f;
}
.act.primary {
  color: #fff;
  background: var(--red);
  border-color: var(--red);
}
.act.primary:hover {
  color: #fff;
}
.count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  color: var(--red);
  background: var(--glass-strong);
  box-shadow: 0 2px 6px #1b1f2e26;
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
@media (hover: none) {
  .act:hover {
    transform: none;
  }
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
.bar-act {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  height: 58px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  color: var(--ink-2);
  transition: background 0.15s, color 0.15s;
}
.bar-act:active {
  background: var(--hair);
  color: var(--ink);
}
.bar-act.primary {
  color: #fff;
  background: var(--red);
}
.bar-act.primary:active {
  background: color-mix(in srgb, var(--red) 85%, #000);
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
