<script setup lang="ts">
import { computed } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import { emojiSegments, type EmojiSeg } from '@/composables/emoji'
import { linkLabel, linkSegments } from '@/composables/linkify'
import { imgSrc } from '@/api/client'

/**
 * 文本里的平台表情码（如小红书的 `[点赞R]`、抖音的 `[捂脸]`）渲染成图片，
 * http(s) 链接渲染成在新标签页打开的链接，其余原样输出
 */
const props = defineProps<{ platform: string; text: string | null | undefined }>()

type Seg = EmojiSeg & { href?: string }
const segs = computed<Seg[]>(() =>
  linkSegments(props.text ?? '').flatMap((l) => (l.href ? [{ t: l.t, href: l.href }] : emojiSegments(props.platform, l.t))),
)
</script>

<template>
  <template v-for="(s, i) in segs" :key="i">
    <a
      v-if="s.href"
      class="link"
      :href="s.href"
      :title="s.href"
      target="_blank"
      rel="noopener noreferrer"
      @click.stop
    ><span class="link-text">{{ linkLabel(s.href) }}</span><ExternalLink class="link-icon" :size="11" aria-hidden="true" /></a>
    <img v-else-if="s.img" class="emoji" :src="imgSrc(s.img)" :alt="s.t" :title="s.t" loading="lazy" referrerpolicy="no-referrer" />
    <template v-else>{{ s.t }}</template>
  </template>
</template>

<style scoped>
.emoji {
  display: inline-block;
  width: 1.35em;
  height: 1.35em;
  margin: 0 1px;
  vertical-align: -0.3em;
  object-fit: contain;
}
.link {
  display: inline;
  padding: 1px 6px 1px 5px;
  margin: 0 1px;
  border-radius: 6px;
  color: var(--link);
  background: color-mix(in srgb, var(--link) 10%, transparent);
  text-decoration: none;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-all;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition:
    background 0.18s var(--ease-out),
    color 0.18s var(--ease-out);
}
.link:hover {
  background: color-mix(in srgb, var(--link) 18%, transparent);
}
.link:hover .link-text {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}
.link:focus-visible {
  outline: 2px solid var(--link);
  outline-offset: 1px;
}
.link-icon {
  display: inline-block;
  margin-left: 3px;
  vertical-align: -1px;
  opacity: 0.7;
}
</style>
