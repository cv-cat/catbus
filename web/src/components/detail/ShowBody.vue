<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Calendar, MapPin, Tags } from 'lucide-vue-next'
import ShowTickets from '../maoyan/ShowTickets.vue'
import type { Item } from '@/api/types'
import type { ShowInfo } from '@/composables/show'
import { ticketCache, ticketKey } from '@/composables/ticketCache'
import { imgSrc } from '@/api/client'

/**
 * 演出详情的正文（猫眼演出，AGENTS.md 7.9「演出详情」，设计稿 N）：时间、场馆、票价各一行，场次与票档，下面是详情长图。
 * 不显示站点的售卖状态文案；没有评论区。默认插槽放在正文之后（等价命令、错误提示）。
 */
const props = defineProps<{
  show: ShowInfo
  /** 合并后的条目（详情回来前是列表里那一条） */
  item: Item
  platform: string
  /** 列表里那一条：查场次用它 */
  listItem: Item
  account: string | null
  loading: boolean
}>()
const { t } = useI18n()

/** 演出的 media 是详情长图，放在正文里；左侧只放海报 */
const images = computed(() => (props.item.media ?? []).filter((m) => m.type === 'image' && m.url).map((m) => m.url!))
/** 查到了场次（AGENTS.md 7.9「猫眼演出的场次与票档」）：隐藏原来的「票价」一行，票档表里已经有了 */
const ticketsShown = computed(() => (ticketCache.get(ticketKey(props.platform, props.listItem.id))?.sessions.length ?? 0) > 0)
const badImgs = ref(new Set<string>())

/** 换条目时由 DetailCard 调用 */
function reset() {
  badImgs.value = new Set()
}
defineExpose({ reset })
</script>

<template>
  <h2 v-if="item.title" class="title rv">{{ item.title }}</h2>
  <ul v-if="show.time || show.venue || show.city || show.prices.length" class="s-rows">
    <li v-if="show.time">
      <span class="s-ico"><Calendar :size="16" aria-hidden="true" /></span>
      <span class="s-col"><small>{{ t('detail.show.time') }}</small><strong>{{ show.time }}</strong></span>
    </li>
    <li v-if="show.venue || show.city">
      <span class="s-ico"><MapPin :size="16" aria-hidden="true" /></span>
      <span class="s-col">
        <small>{{ t('detail.show.venue') }}</small>
        <strong>{{ show.venue ?? show.city }}</strong>
        <span v-if="show.venue && (show.city || show.address)">{{ [show.city, show.address].filter(Boolean).join(' · ') }}</span>
      </span>
    </li>
    <li v-if="show.prices.length && !ticketsShown">
      <span class="s-ico"><Tags :size="16" aria-hidden="true" /></span>
      <span class="s-col">
        <small>{{ t('detail.show.prices') }}</small>
        <span class="s-chips"><b v-for="p in show.prices" :key="p" class="mono">¥{{ p }}</b></span>
      </span>
    </li>
  </ul>
  <div v-else-if="loading" class="lines rv" aria-hidden="true">
    <span /><span /><span class="short" />
  </div>
  <!-- 场次与票档：点了才查（item get --tickets，需要登录） -->
  <div class="divider" />
  <ShowTickets :platform="platform" :item="listItem" :account="account" />
  <template v-if="images.length">
    <div class="divider" />
    <p class="count">{{ t('detail.show.images') }}</p>
    <div class="bb">
      <a v-for="u in images" v-show="!badImgs.has(u)" :key="u" class="bb-img" :href="u" target="_blank" rel="noopener noreferrer">
        <img :src="imgSrc(u)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="badImgs = new Set(badImgs).add(u)" />
      </a>
    </div>
  </template>
  <slot />
</template>

<style scoped src="./shared.css"></style>
<style scoped>
.s-rows {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.s-rows li {
  display: flex;
  gap: 12px;
}
.s-ico {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: var(--hair);
  color: var(--ink-2);
}
.s-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}
.s-col small {
  font-size: 12px;
  color: var(--ink-3);
}
.s-col strong {
  font-size: 14px;
  font-weight: 500;
}
.s-col > span {
  font-size: 12px;
  color: var(--ink-2);
}
.s-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.s-chips b {
  padding: 5px 10px;
  border: 1px solid var(--hair);
  border-radius: 8px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
}
</style>
