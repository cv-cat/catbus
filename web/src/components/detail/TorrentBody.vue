<script setup lang="ts">
import { computed, ref } from 'vue'
import EmojiText from '../EmojiText.vue'
import type { Item } from '@/api/types'
import type { TorrentInfo } from '@/composables/torrent'
import { bbcodeBlocks } from '@/composables/bbcode'
import { imgSrc } from '@/api/client'

/**
 * 种子详情的正文（M-Team，AGENTS.md 7.9「种子详情」，设计稿 L）：中文名 + 种子名，简介按 BBCode 拆块渲染。
 * 没有评论区。默认插槽放在正文之后（等价命令、错误提示）。
 */
const props = defineProps<{
  torrent: TorrentInfo
  /** item get 回来的详情；列表里的 text 只是副标题，不渲染 */
  detail: Item | null
  loading: boolean
}>()

/** 简介是 BBCode：详情回来后拆成图片、引用、代码和普通文字 */
const descr = computed(() => (props.detail ? bbcodeBlocks(props.detail.text) : []))
const badImgs = ref(new Set<string>())

/** 换条目时由 DetailCard 调用 */
function reset() {
  badImgs.value = new Set()
}
defineExpose({ reset })
</script>

<template>
  <h2 class="title t-title rv">{{ torrent.title }}</h2>
  <p v-if="torrent.name" class="t-name mono rv">{{ torrent.name }}</p>
  <div v-if="descr.length" class="bb">
    <template v-for="(b, i) in descr" :key="i">
      <a v-if="b.type === 'img'" v-show="!badImgs.has(b.url)" class="bb-img" :href="b.url" target="_blank" rel="noopener noreferrer">
        <img :src="imgSrc(b.url)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="badImgs = new Set(badImgs).add(b.url)" />
      </a>
      <pre v-else-if="b.type === 'code'" class="bb-code mono">{{ b.text }}</pre>
      <blockquote v-else-if="b.type === 'quote'" class="bb-quote"><EmojiText platform="" :text="b.text" /></blockquote>
      <p v-else class="text"><EmojiText platform="" :text="b.text" /></p>
    </template>
  </div>
  <div v-else-if="loading" class="lines rv" aria-hidden="true">
    <span /><span /><span class="short" />
  </div>
  <slot />
</template>

<style scoped src="./shared.css"></style>
<style scoped>
.t-title {
  margin-bottom: 6px;
}
.t-name {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
</style>
