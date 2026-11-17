<script setup lang="ts">
import { computed } from 'vue'
import EmojiText from '@/components/EmojiText.vue'

/** 评论区筛选的高亮（AGENTS.md 7.9「评论区筛选」）：匹配的部分用 <mark>，其余照常渲染表情码 */
const props = defineProps<{ platform: string; text: string; query: string }>()
const parts = computed(() => {
  const q = props.query.trim().toLowerCase()
  if (!q) return [{ t: props.text, hit: false }]
  const out: { t: string; hit: boolean }[] = []
  const low = props.text.toLowerCase()
  let i = 0
  for (let j = low.indexOf(q); j >= 0; j = low.indexOf(q, i)) {
    if (j > i) out.push({ t: props.text.slice(i, j), hit: false })
    out.push({ t: props.text.slice(j, j + q.length), hit: true })
    i = j + q.length
  }
  if (i < props.text.length) out.push({ t: props.text.slice(i), hit: false })
  return out
})
</script>

<template>
  <template v-for="(p, i) in parts" :key="i">
    <mark v-if="p.hit" class="hl">{{ p.t }}</mark>
    <EmojiText v-else :platform="platform" :text="p.t" />
  </template>
</template>

<style scoped>
.hl {
  padding: 0 1px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--red) 22%, transparent);
  color: inherit;
}
</style>
