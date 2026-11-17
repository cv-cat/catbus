<script setup lang="ts">
import { useId } from 'vue'

/**
 * 设置项的一行：左边标题 + 一句说明，右边控件。
 * 默认插槽拿到 { labelId, descId }，控件用 aria-labelledby / aria-describedby 关联标题和说明。
 * disabled：整行变淡（例如「即将支持」的占位项），badge：标题旁的小标签。
 */
defineProps<{ title: string; desc?: string; badge?: string; disabled?: boolean }>()
const uid = useId()
const labelId = `${uid}-label`
const descId = `${uid}-desc`
</script>

<template>
  <div class="row" :class="{ disabled }" data-setting-row>
    <div class="text">
      <div :id="labelId" class="title">
        {{ title }}
        <span v-if="badge" class="badge">{{ badge }}</span>
      </div>
      <p v-if="desc" :id="descId" class="desc">{{ desc }}</p>
    </div>
    <div class="control">
      <slot :label-id="labelId" :desc-id="desc ? descId : undefined" />
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 0;
  border-bottom: 1px solid var(--hair);
}
.row:last-child {
  border-bottom: none;
}
.text {
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.desc {
  margin: 3px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-2);
}
.badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-2);
  background: var(--hair);
}
.control {
  flex: none;
  display: flex;
  align-items: center;
}
.row.disabled .text {
  opacity: 0.6;
}
@media (max-width: 640px) {
  /* 手机：分段选择和下拉放不下时换到下一行 */
  .row {
    flex-wrap: wrap;
    gap: 10px 16px;
  }
  .text {
    flex: 1 1 180px;
  }
}
</style>
