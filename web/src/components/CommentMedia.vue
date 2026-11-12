<script setup lang="ts">
import { computed } from 'vue'
import type { Media } from '@/api/types'
import { openLightbox } from '@/stores/lightbox'
import { imgSrc } from '@/api/client'

/** 评论里附带的图片 / 表情包：缩略图，点击看大图 */
const props = defineProps<{ media: Media[] | undefined; small?: boolean }>()
const urls = computed(() => (props.media ?? []).filter((m) => m.type === 'image' && m.url).map((m) => m.url!))
</script>

<template>
  <div v-if="urls.length" class="c-media" :class="{ small, single: urls.length === 1 }">
    <button v-for="(u, i) in urls" :key="u + i" type="button" class="thumb" :aria-label="`查看第 ${i + 1} 张图`" @click="openLightbox(urls, i)">
      <img :src="imgSrc(u)" alt="" loading="lazy" referrerpolicy="no-referrer" />
    </button>
  </div>
</template>

<style scoped>
.c-media {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 2px;
}
.thumb {
  width: 88px;
  height: 88px;
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  background: var(--hair);
  cursor: zoom-in;
  transition: transform 0.2s var(--ease-out);
}
.thumb:hover {
  transform: scale(1.03);
}
.single .thumb {
  width: auto;
  max-width: 180px;
  height: 140px;
}
.small .thumb {
  width: 72px;
  height: 72px;
}
.small.single .thumb {
  width: auto;
  max-width: 150px;
  height: 112px;
}
img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.single img {
  width: auto;
  max-width: 100%;
}

/* 手机：缩略图小一些，单张不超过一半宽 */
@media (max-width: 640px) {
  .thumb {
    width: 76px;
    height: 76px;
  }
  .single .thumb {
    max-width: min(160px, 50vw);
    height: 120px;
  }
  .small .thumb {
    width: 64px;
    height: 64px;
  }
  .small.single .thumb {
    max-width: min(130px, 45vw);
    height: 96px;
  }
}
@media (hover: none) and (pointer: coarse) {
  .thumb:hover {
    transform: none;
  }
}
</style>
