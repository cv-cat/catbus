<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from 'lucide-vue-next'
import SettingRow from './SettingRow.vue'
import AppSelect, { type SelectOption } from '@/components/AppSelect.vue'
import { COMMENT_LIMITS, COMMENT_RISK_OVER, REPLY_LIMITS, useSettingsStore, type CommentLimit, type ReplyLimit } from '@/stores/settings'

/** 下载：评论和楼中楼各取多少条（AGENTS.md 7.9「设置」） */
const { settings: s } = useSettingsStore()
const { t } = useI18n()

const label = (v: number | 'all') => (v === 'all' ? t('settings.download.all') : t('settings.download.count', { n: v }, v))
const commentOptions = computed<SelectOption<CommentLimit>[]>(() => COMMENT_LIMITS.map((v) => ({ value: v, label: label(v) })))
const replyOptions = computed<SelectOption<ReplyLimit>[]>(() => REPLY_LIMITS.map((v) => ({ value: v, label: label(v) })))
/** 超过 100 条（1000、全部）时提示风控风险 */
const risky = computed(() => s.commentLimit === 'all' || s.commentLimit > COMMENT_RISK_OVER)
</script>

<template>
  <!-- 风险提示属于「评论下载条数」这一项：分割线放在提示下面，不压在提示上 -->
  <div class="group">
    <SettingRow v-slot="{ labelId, descId }" :title="t('settings.download.comments.title')" :desc="t('settings.download.comments.desc')">
      <AppSelect
        v-model="s.commentLimit"
        :options="commentOptions"
        :title="t('settings.download.comments.title')"
        :desc="t('settings.download.comments.desc')"
        :labelledby="labelId"
        :describedby="descId"
      />
    </SettingRow>
    <Transition name="risk">
      <p v-if="risky" class="risk" role="alert">
        <TriangleAlert :size="15" aria-hidden="true" />
        {{ t('settings.download.comments.risk') }}
      </p>
    </Transition>
  </div>
  <SettingRow v-slot="{ labelId, descId }" :title="t('settings.download.replies.title')" :desc="t('settings.download.replies.desc')">
    <AppSelect
      v-model="s.replyLimit"
      :options="replyOptions"
      :title="t('settings.download.replies.title')"
      :desc="t('settings.download.replies.desc')"
      :labelledby="labelId"
      :describedby="descId"
    />
  </SettingRow>
</template>

<style scoped>
.group {
  border-bottom: 1px solid var(--hair);
}
.group > :deep([data-setting-row]) {
  border-bottom: none;
}
.risk {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 14px;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--red);
  background: var(--red-soft);
  border: 1px solid color-mix(in srgb, var(--red) 30%, transparent);
}
.risk svg {
  flex: none;
  margin-top: 2px;
}
.risk-enter-active,
.risk-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.risk-enter-from,
.risk-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
