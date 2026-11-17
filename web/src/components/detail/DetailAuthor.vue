<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import UserAvatar from '../UserAvatar.vue'
import type { Item } from '@/api/types'
import type { TorrentInfo } from '@/composables/torrent'
import type { ShowInfo } from '@/composables/show'
import { since, tintOf } from '@/composables/format'
import { useAuthorStore } from '@/stores/author'
import { useDetailStore } from '@/stores/detail'

/**
 * 详情卡片头部左侧（AGENTS.md 7.9）：
 * 普通条目是作者（平台支持时点了进入站内的作者页），种子是优惠标签加体积（设计稿 L），演出是演出者（设计稿 N）。
 */
const props = defineProps<{
  item: Item
  platform: string
  platformName: string | undefined
  torrent: TorrentInfo | null
  show: ShowInfo | null
}>()
const { t } = useI18n()

const published = computed(() => {
  const iso = props.item.created_at
  if (!iso) return ''
  const s = since(iso)
  // 一个月以上 since 给的是日期（同 format.ts 的 since）
  return Date.now() - Date.parse(iso) >= 43_200 * 60_000 ? t('detail.published.on', { date: s }) : t('detail.published.ago', { time: s })
})
const authorHandle = computed(() => [props.platformName, published.value].filter(Boolean).join(' · '))

/** 头部的作者：平台支持时点了关闭详情、进入站内的作者页（AGENTS.md 7.9「作者页」）；⌘ / Ctrl / Shift / 中键仍是原主页外链 */
const authors = useAuthorStore()
const { close } = useDetailStore()
const authorLink = computed(() => Boolean(authors.refOf(props.item.author) && authors.canOpen(props.platform)))
function onAuthor(e: MouseEvent | KeyboardEvent) {
  if (!authorLink.value) return
  if (e instanceof MouseEvent && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
  e.preventDefault()
  const platform = props.platform
  const author = props.item.author
  close()
  authors.open(platform, author)
}
</script>

<template>
  <div v-if="torrent" class="author nolink">
    <span v-if="torrent.discount" class="t-badge mono" :class="{ free: torrent.free }">{{ torrent.discount }}</span>
    <span class="who">
      <strong>{{ torrent.size ?? t('detail.torrent.fallback') }}</strong>
      <small>{{ published || platformName }}</small>
    </span>
  </div>
  <div v-else-if="show" class="author nolink">
    <UserAvatar v-if="show.author" class="ava" :user="show.author" :style="{ background: tintOf(show.author.id) }" />
    <span class="who">
      <strong>{{ show.performers ?? show.category ?? t('detail.show.fallback') }}</strong>
      <small>{{ [show.performers ? show.category : null, show.city].filter(Boolean).join(' · ') || platformName }}</small>
    </span>
  </div>
  <a
    v-else
    class="author"
    :href="item.author?.url ?? undefined"
    target="_blank"
    rel="noopener noreferrer"
    :class="{ nolink: !item.author?.url && !authorLink }"
    :role="authorLink && !item.author?.url ? 'link' : undefined"
    :tabindex="authorLink && !item.author?.url ? 0 : undefined"
    @click="onAuthor"
    @keydown.enter="onAuthor"
  >
    <UserAvatar class="ava" :user="item.author" :style="{ background: tintOf(item.author?.id) }" />
    <span class="who">
      <strong>{{ item.author?.name ?? t('detail.author.unknown') }}</strong>
      <small>{{ authorHandle }}</small>
    </span>
  </a>
</template>

<style scoped src="./shared.css"></style>
<style scoped>
.author {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  color: inherit;
  text-decoration: none;
}
.author.nolink {
  pointer-events: none;
}
.author:hover strong {
  color: var(--red);
}
.who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.who strong {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.2s;
}
.who small {
  font-size: 12px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 种子（M-Team，设计稿 L）：优惠标签 */
.t-badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--navy);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}
.t-badge.free {
  background: var(--red);
}
</style>
