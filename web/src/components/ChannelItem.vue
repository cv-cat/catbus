<script setup lang="ts">
import { computed } from 'vue'
import type { PlatformMeta } from '@/data/platforms'
import type { Health } from '@/stores/discover'

/** health 为 null 表示没有账号（不显示圆点） */
/** compact：平板窄栏里只显示图标（名字放进提示），健康圆点挂在图标右上角 */
/**
 * multi：聚合模式，渠道是多选的——active 表示选中，各自带一块底色（单一模式的底色是侧栏里滑动的那一块）；
 * order 是它在选中渠道里的次序（卡片按这个次序轮流排），busy 表示它的第一页还在加载。
 */
const props = defineProps<{
  platform: PlatformMeta
  active: boolean
  health: Health | null
  compact?: boolean
  multi?: boolean
  order?: number
  busy?: boolean
}>()
const label = computed(() => {
  const h = props.health
  if (!h) return ''
  if (h.level === 'ok') return h.total > 1 ? `${h.total} 个账号状态正常` : '账号状态正常'
  if (h.level === 'warn') return `${h.bad} / ${h.total} 个账号登录失效`
  return h.total > 1 ? `全部 ${h.total} 个账号登录失效` : '账号登录失效'
})
</script>

<template>
  <button
    v-tip="compact ? (label ? `${platform.name} · ${label}` : platform.name) : null"
    type="button"
    class="channel"
    :class="{ active, compact, picked: multi && active, busy }"
    :aria-current="!multi && active ? 'page' : undefined"
    :aria-pressed="multi ? active : undefined"
    :aria-label="compact ? platform.name : undefined"
    :data-id="platform.id"
  >
    <img class="logo" :src="platform.logo" alt="" draggable="false" />
    <span v-if="!compact" class="name">{{ platform.name }}</span>
    <Transition name="ord">
      <span v-if="multi && active && order" class="ord mono" aria-hidden="true">{{ order }}</span>
    </Transition>
    <span v-if="health" v-tip="compact ? null : label" class="dot" :class="health.level" role="img" :aria-label="label" />
  </button>
</template>

<style scoped>
.channel {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border-radius: 12px;
  color: var(--ink-2);
  font-size: 13.5px;
  text-align: left;
  transition: color 0.2s, background 0.2s;
}
/* 渠道列表是滚动容器（overflow 会裁掉外扩的描边），焦点环收进按钮内侧 */
.channel:focus-visible {
  outline-offset: -2px;
}
.channel:hover:not(.active) {
  background: var(--hair);
  color: var(--ink);
}
/* 聚合模式选中的底色：每个渠道自己一块，选上时弹出来 */
.channel {
  isolation: isolate;
}
.channel::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--glass-strong);
  box-shadow: 0 2px 10px #1b1f2e12;
  opacity: 0;
  transform: scale(0.9);
  transition: opacity 0.25s ease-out, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
}
.channel.picked::before {
  opacity: 1;
  transform: none;
}
/* 次序：卡片按它轮流排 */
.ord {
  flex: none;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: var(--red);
  background: var(--red-soft);
}
.ord-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out;
}
.ord-leave-active {
  transition: transform 0.18s ease-in, opacity 0.18s ease-in;
}
.ord-enter-from,
.ord-leave-to {
  opacity: 0;
  transform: scale(0.3);
}
.channel.busy .logo {
  animation: busy 0.9s ease-in-out infinite alternate;
}
@keyframes busy {
  to {
    opacity: 0.45;
    transform: scale(0.9);
  }
}
.channel.active {
  color: var(--ink);
  font-weight: 600;
}
.logo {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  flex: none;
  transition: transform 0.3s var(--ease-out);
}
.channel:hover .logo {
  transform: scale(1.1) rotate(-4deg);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--online);
  transition: background 0.3s, box-shadow 0.3s;
}
.dot.warn {
  background: var(--warn);
}
.dot.bad {
  background: var(--red);
}
/* 圆点只有 6px，扩大提示的悬停范围 */
.dot::after {
  content: '';
  position: absolute;
  inset: -6px;
}
.dot {
  position: relative;
}
/* 平板窄栏：44px 见方，只有图标 */
.channel.compact {
  justify-content: center;
  height: var(--tap);
  padding: 0;
}
.channel.compact .logo {
  width: 26px;
  height: 26px;
  border-radius: 8px;
}
.channel.compact .ord {
  position: absolute;
  right: 4px;
  bottom: 4px;
  box-shadow: 0 0 0 2px var(--glass-strong);
  background: color-mix(in srgb, var(--red) 18%, var(--glass-strong));
}
.channel.compact .dot {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 8px;
  height: 8px;
  box-shadow: 0 0 0 2px var(--glass-strong);
}
/* 触屏：可点区域至少 --tap；没有悬停，去掉悬停态 */
@media (hover: none) and (pointer: coarse) {
  .channel {
    height: var(--tap);
    font-size: 15px;
  }
  .channel:hover:not(.active) {
    background: none;
    color: var(--ink-2);
  }
  .channel:hover .logo {
    transform: none;
  }
  .channel:active:not(.active) {
    background: var(--hair);
  }
}
</style>
