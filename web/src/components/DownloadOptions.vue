<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Download, FileDown, FileText, Folder, Image, MessageSquareText, Send, Settings } from 'lucide-vue-next'
import SegmentedControl from '@/components/SegmentedControl.vue'
import SettingSwitch from '@/components/settings/SettingSwitch.vue'
import { flashTip } from '@/directives/tip'
import { useSettingsStore, type ExportFormat } from '@/stores/settings'
import { qbitCategoryError, qbitSavepathError } from '@/stores/downloads'

/**
 * 下载面板的内容（AGENTS.md 7.9「批量选择与下载」）：要下载什么（媒体、信息、评论，多选）和格式（单选）。
 * 选择直接记进设置（catbus.settings），下次直接点下载按钮就按它下载。
 * commentsDisabled：这些平台都没有评论时的原因，评论置灰。
 */
const props = defineProps<{ commentsDisabled?: string | null; count?: number; qbit?: boolean }>()
const emit = defineEmits<{ download: []; settings: [] }>()
const store = useSettingsStore()
const s = store.settings
const { t } = useI18n()

const commentsOn = computed(() => s.dlComments && !props.commentsDisabled)
const metaOn = computed(() => s.dlMeta || commentsOn.value)
/** 推送到 qBittorrent：这次有 M-Team 的条目、并且打开了推送 */
const pushOn = computed(() => !!props.qbit && s.qbit)
/** 勾上的项数：最后一项不能取消（打开推送时可以一项都不勾，只推送） */
const picked = computed(() => [s.dlMedia, metaOn.value, commentsOn.value, pushOn.value].filter(Boolean).length)

function togglePush(on: boolean) {
  s.qbit = on
  // 关掉推送时下载内容至少留一项
  if (!on && !s.dlMedia && !metaOn.value) s.dlMedia = true
}
const categoryErr = computed(() => qbitCategoryError(s.qbitCategory))
const savepathErr = computed(() => qbitSavepathError(s.qbitSavepath))
const invalid = computed(() => pushOn.value && !!(categoryErr.value || savepathErr.value))
const goLabel = computed(() => {
  const n = props.count
  if (pushOn.value) {
    const key = s.dlMedia || metaOn.value ? 'download.qbit.go.both' : 'download.qbit.go.push'
    return n ? t(`${key}Count`, { n }, n) : t(key)
  }
  return n ? t('download.panel.downloadCount', { n }, n) : t('common.action.download')
})
function go() {
  if (invalid.value) return
  emit('download')
}

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
    key: 'media' as const,
    icon: props.qbit ? FileDown : Image,
    // M-Team 的「媒体」就是种子文件
    label: props.qbit ? t('download.qbit.torrent') : t('download.panel.media'),
    desc: props.qbit ? (pushOn.value ? t('download.qbit.torrentOptional') : t('download.qbit.torrentDesc')) : t('download.panel.mediaDesc'),
    on: s.dlMedia,
    tip: s.dlMedia && picked.value === 1 ? lastTip.value : null, locked: false,
  },
  {
    key: 'meta' as const, icon: FileText, label: t('download.panel.meta'), desc: props.qbit ? t('download.qbit.metaDesc') : t('download.panel.metaDesc'), on: metaOn.value,
    tip: commentsOn.value ? t('download.panel.metaLocked') : metaOn.value && picked.value === 1 ? lastTip.value : null, locked: commentsOn.value,
  },
  {
    key: 'comments' as const, icon: MessageSquareText, label: t('download.panel.comments'), desc: props.commentsDisabled ?? commentsHint.value, on: commentsOn.value,
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
    <button v-if="!commentsDisabled" type="button" class="to-settings" @click="emit('settings')">
      <Settings :size="13" aria-hidden="true" />
      {{ t('download.panel.toSettings') }}
    </button>

    <!-- 推送到 qBittorrent（M-Team，设计稿 Y8 / Y9）：关掉时下面的选项收起 -->
    <section v-if="qbit" class="qbit" :aria-label="t('download.qbit.title')">
      <!-- 整行是 label：点标题也能切换，手机上整行就是 44px 的点击区 -->
      <label class="qb-head">
        <span class="qb-ico" aria-hidden="true"><Send :size="14" /></span>
        <span id="dl-qbit-title" class="qb-title">{{ t('download.qbit.title') }}</span>
        <SettingSwitch :model-value="s.qbit" labelledby="dl-qbit-title" describedby="dl-qbit-desc" @update:model-value="togglePush" />
      </label>
      <p id="dl-qbit-desc" class="qb-desc">{{ t('download.qbit.desc') }}</p>
      <div v-if="s.qbit" class="qb-fields">
        <label class="field">
          <span class="f-label">{{ t('download.qbit.category') }}</span>
          <input
            v-model="s.qbitCategory"
            class="input mono"
            :class="{ bad: categoryErr }"
            type="text"
            maxlength="64"
            spellcheck="false"
            autocomplete="off"
            :placeholder="'mteam'"
            :aria-invalid="!!categoryErr || undefined"
          />
          <span v-if="categoryErr" class="f-err">{{ t(categoryErr) }}</span>
        </label>
        <label class="field">
          <span class="f-label">{{ t('download.qbit.savepath') }}</span>
          <span class="with-ico">
            <Folder :size="14" aria-hidden="true" />
            <input
              v-model="s.qbitSavepath"
              class="input mono"
              :class="{ bad: savepathErr }"
              type="text"
              maxlength="512"
              spellcheck="false"
              autocomplete="off"
              :placeholder="t('download.qbit.savepathPlaceholder')"
              :aria-invalid="!!savepathErr || undefined"
            />
          </span>
          <span v-if="savepathErr" class="f-err">{{ t(savepathErr) }}</span>
        </label>
        <label class="qb-row">
          <span id="dl-qbit-paused">{{ t('download.qbit.paused') }}</span>
          <SettingSwitch v-model="s.qbitPaused" labelledby="dl-qbit-paused" />
        </label>
        <p class="qb-note">{{ t('download.qbit.where') }}</p>
      </div>
    </section>

    <div class="sec-title">{{ t('download.panel.format') }}</div>
    <div class="format" :class="{ dim: !metaOn }">
      <SegmentedControl v-model="s.dlFormat" :options="FORMATS" :label="t('download.panel.format')" />
    </div>
    <p class="note">{{ metaOn ? t(`download.panel.formatNote.${s.dlFormat}`) : t(props.qbit ? 'download.qbit.formatNoMeta' : 'download.panel.formatNoMeta') }}</p>

    <button type="button" class="go" :aria-disabled="invalid || undefined" :class="{ dis: invalid }" @click="go">
      <component :is="pushOn ? Send : Download" :size="16" aria-hidden="true" />
      {{ goLabel }}
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
.go.dis {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
.qbit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--hair);
}
.qb-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.qb-ico {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--red);
  color: #fff;
}
.qb-title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.qb-desc,
.qb-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-2);
}
.qb-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.f-label,
.qb-row {
  font-size: 12.5px;
  color: var(--ink-2);
}
.input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border-radius: 10px;
  border: 1px solid var(--glass-stroke);
  background: var(--hair);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  outline: none;
}
.input:focus-visible {
  border-color: var(--red);
  box-shadow: 0 0 0 3px var(--red-soft);
}
.input.bad {
  border-color: var(--red);
}
.with-ico {
  position: relative;
  display: block;
}
.with-ico > svg {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-3);
  pointer-events: none;
}
.with-ico .input {
  padding-left: 30px;
}
.f-err {
  font-size: 11.5px;
  color: var(--red);
}
.qb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
@media (max-width: 640px) {
  .row {
    min-height: 52px;
  }
  .input {
    height: 44px;
    font-size: 16px;
  }
  .qb-head,
  .qb-row {
    min-height: var(--tap);
  }
  .go {
    height: 48px;
    font-size: 16px;
  }
}
</style>
