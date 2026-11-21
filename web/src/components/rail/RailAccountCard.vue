<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RAIL } from '@/data/platforms'

/** 12306 查询页的账号卡（AGENTS.md 7.9「12306 查询页」）：免登录，不能点；平板窄栏只留图标 */
defineProps<{ rail?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <div v-tip="rail ? `${t('rail.account.title')} · ${t('rail.account.sub')}` : null" class="card" :class="{ rail }" role="note">
    <img class="logo" :src="RAIL.logo" alt="" draggable="false" />
    <span v-if="!rail" class="text">
      <span class="title">{{ t('rail.account.title') }}</span>
      <span class="sub">{{ t('rail.account.sub') }}</span>
    </span>
  </div>
</template>

<style scoped>
/* 与账号卡（AccountSwitcher 的 .chip）同一个外观，只是不能点 */
.card {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-md);
  background: var(--glass-strong);
}
.logo {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.title {
  font-size: 13px;
  font-weight: 600;
}
.sub {
  font-size: 10.5px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card.rail {
  justify-content: center;
  padding: 0;
  width: var(--tap);
  height: var(--tap);
  margin: 0 auto;
  border-radius: 50%;
  background: transparent;
}
.card.rail .logo {
  width: 32px;
  height: 32px;
}
</style>
