<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Download, FileText, Image, MessageSquareText, Settings } from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { flashTip } from '@/directives/tip'
import { useSettingsStore, type ExportFormat } from '@/stores/settings'

/**
 * 下载面板的内容（AGENTS.md 7.9「批量选择与下载」）：要下载什么（媒体、信息、评论，多选）和格式（单选）。
 * 选择直接记进设置（catbus.settings），下次直接点下载按钮就按它下载。
 * commentsDisabled：这些平台都没有评论时的原因，评论置灰。
 */
const props = defineProps<{ commentsDisabled?: string | null; count?: number }>()
const emit = defineEmits<{ download: []; settings: [] }>()
const store = useSettingsStore()
const s = store.settings
const { t } = useI18n()

const commentsOn = computed(() => s.dlComments && !props.commentsDisabled)
const metaOn = computed(() => s.dlMeta || commentsOn.value)
/** 勾上的项数：最后一项不能取消 */
const picked = computed(() => [s.dlMedia, metaOn.value, commentsOn.value].filter(Boolean).length)

const limit = (v: number | 'all') => (v === 'all' ? t('settings.download.all') : t('settings.download.count', { n: v }, v))
const commentsHint = computed(() =>
  t('download.panel.commentsHint', { comments: limit(s.commentLimit), replies: limit(s.replyLimit) }),
)

function toggle(key: 'media' | 'meta' | 'comments', e: MouseEvent) {
  const target = e.currentTarget
  if (key === 'comments') {
    if (props.commentsDisabled) return flashTip(target)
    if (commentsOn.value && picked.value === 1) return flashTip(target)
    s.dlComments = !commentsOn.value
    return
  }
  if (key === 'meta') {
    // 评论包含信息：勾着评论时信息不能单独取消
    if (commentsOn.value) return flashTip(target)
    if (s.dlMeta && picked.value === 1) return flashTip(target)
    s.dlMeta = !s.dlMeta
    return
  }
  if (s.dlMedia && picked.value === 1) return flashTip(target)
  s.dlMedia = !s.dlMedia
}

const lastTip = computed(() => t('download.panel.atLeastOne'))
const rows = computed(() => [
  {
    key: 'media' as const, icon: Image, label: t('download.panel.media'), desc: t('download.panel.mediaDesc'), on: s.dlMedia,
    tip: s.dlMedia && picked.value === 1 ? lastTip.value : null, locked: false,
  },
  {
    key: 'meta' as const, icon: FileText, label: t('download.panel.meta'), desc: t('download.panel.metaDesc'), on: metaOn.value,
    tip: commentsOn.value ? t('download.panel.metaLocked') : metaOn.value && picked.value === 1 ? lastTip.value : null, locked: commentsOn.value,
  },
  {
    key: 'comments' as const, icon: MessageSquareText, label: t('download.panel.comments'), desc: commentsHint.value, on: commentsOn.value,
    tip: props.commentsDisabled ?? (commentsOn.value && picked.value === 1 ? lastTip.value : null), locked: !!props.commentsDisabled,
  },
])

const FORMATS = computed<{ value: ExportFormat; label: string }[]>(() => [
  { value: 'json', label: 'JSON' },
  { value: 'txt', label: t('download.panel.formatTxt') },
  { value: 'xlsx', label: 'Excel' },
])
</script>

<template>
  <div class="dl-opts">
    <div class="sec-title">{{ t('download.panel.content') }}</div>
    <div class="rows" role="group" :aria-label="t('download.panel.content')">
      <button
        v-for="r in rows"
        :key="r.key"
        v-tip="r.tip"
        type="button"
        role="checkbox"
        class="row"
        :class="{ on: r.on, locked: r.locked, off: r.key === 'comments' && !!commentsDisabled }"
        :aria-checked="r.on"
        :aria-disabled="r.locked ? 'true' : undefined"
        @click="toggle(r.key, $event)"
      >
        <span class="box" aria-hidden="true"><Check v-if="r.on" :size="13" :stroke-width="3" /></span>
        <component :is="r.icon" :size="16" class="ico" aria-hidden="true" />
        <span class="txt">
          <span class="label">{{ r.label }}</span>
          <span class="desc">{{ r.desc }}</span>
        </span>
      </button>
    </div>
    <button type="button" class="to-settings" @click="emit('settings')">
      <Settings :size="13" aria-hidden="true" />
      {{ t('download.panel.toSettings') }}
    </button>

    <div class="sec-title">{{ t('download.panel.format') }}</div>
    <div class="format" :class="{ dim: !metaOn }">
      <SegmentedControl v-model="s.dlFormat" :options="FORMATS" :label="t('download.panel.format')" />
    </div>
    <p class="note">{{ metaOn ? t(`download.panel.formatNote.${s.dlFormat}`) : t('download.panel.formatNoMeta') }}</p>

    <button type="button" class="go" @click="emit('download')">
      <Download :size="16" aria-hidden="true" />
      {{ count ? t('download.panel.downloadCount', { n: count }, count) : t('common.action.download') }}
    </button>
  </div>
</template>

<style scoped>
.dl-opts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sec-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-3);
  letter-spacing: 0.02em;
}
.sec-title:not(:first-child) {
  margin-top: 6px;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 6px 10px;
  border-radius: 12px;
  text-align: left;
  color: var(--ink);
  transition: background 0.2s;
}
.row:hover {
  background: var(--hair);
}
.box {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--ink-3);
  color: #fff;
  transition: background 0.2s, border-color 0.2s;
}
.row.on .box {
  background: var(--red);
  border-color: var(--red);
}
.row.locked.on .box {
  opacity: 0.55;
}
.row.off {
  opacity: 0.45;
  cursor: not-allowed;
}
.ico {
  flex: none;
  color: var(--ink-2);
}
.txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.label {
  font-size: 14px;
  font-weight: 600;
}
.desc {
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.4;
}
.to-settings {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 38px;
  padding: 2px 0;
  font-size: 12px;
  color: var(--red);
}
.to-settings:hover {
  text-decoration: underline;
}
.format {
  display: flex;
  transition: opacity 0.2s;
}
.format.dim {
  opacity: 0.5;
}
.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-2);
}
.go {
  margin-top: 6px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: var(--red);
  box-shadow: 0 6px 16px #e8414f33;
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s;
}
.go:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px #e8414f40;
}
@media (max-width: 640px) {
  .row {
    min-height: 52px;
  }
  .go {
    height: 48px;
    font-size: 16px;
  }
}
</style>
