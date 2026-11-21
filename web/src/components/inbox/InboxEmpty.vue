<script setup lang="ts">
import type { Component } from 'vue'

/** 收件箱的空态与整页状态（设计稿 inbox-desgin X5）：图标块、标题、说明、按钮 */
defineProps<{ icon: Component; title: string; desc?: string | null; tone?: 'default' | 'red' | 'type'; type?: string | null }>()
</script>

<template>
  <div class="ib-empty" role="status">
    <span class="tile" :class="[tone ?? 'default', type ? `t-${type}` : '']"><component :is="icon" :size="26" :stroke-width="1.8" /></span>
    <h2>{{ title }}</h2>
    <p v-if="desc">{{ desc }}</p>
    <div v-if="$slots.default" class="actions"><slot /></div>
  </div>
</template>

<style scoped>
.ib-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 48px 24px;
}
.tile {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin-bottom: 10px;
  border-radius: 18px;
  background: var(--hair);
  color: var(--ink-2);
}
.tile.red {
  background: var(--red-soft);
  color: var(--red);
}
.tile.type {
  background: color-mix(in srgb, var(--tc) 14%, transparent);
  color: var(--tc);
}
.t-comment { --tc: var(--type-comment); }
.t-mention { --tc: var(--type-mention); }
.t-like { --tc: var(--type-like); }
.t-follow { --tc: var(--type-follow); }
.t-system { --tc: var(--type-system); }
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}
p {
  margin: 0;
  max-width: 340px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-3);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>
