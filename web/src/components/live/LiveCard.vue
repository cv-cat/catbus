<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Radio, Users } from 'lucide-vue-next'
import type { Live } from '@/api/types'
import UserAvatar from '@/components/UserAvatar.vue'
import { compact, tintOf } from '@/composables/format'
import { imgSrc } from '@/api/client'

/** 发现直播间里的一张直播间卡片：16:9 封面（直播状态、在线人数）、标题、主播 */
const props = defineProps<{ live: Live }>()
defineEmits<{ pick: [live: Live] }>()
const { t } = useI18n()
const broken = ref(false)
</script>

<template>
  <button type="button" class="card" :aria-label="props.live.title || props.live.id" @click="$emit('pick', props.live)">
    <div class="cover">
      <img
        v-if="props.live.cover && !broken"
        :src="imgSrc(props.live.cover)"
        alt=""
        loading="lazy"
        referrerpolicy="no-referrer"
        @error="broken = true"
      />
      <span class="status" :class="{ on: props.live.status !== 'offline' }">
        <Radio :size="11" />{{ props.live.status === 'offline' ? t('live.discover.offline') : t('live.onAir') }}
      </span>
      <span v-if="props.live.stats.viewers != null" class="viewers" :aria-label="t('live.viewers')">
        <Users :size="11" />{{ compact(props.live.stats.viewers) }}
      </span>
    </div>
    <div class="title">{{ props.live.title || props.live.id }}</div>
    <div v-if="props.live.host" class="host">
      <UserAvatar class="ava" :user="props.live.host" :style="{ background: tintOf(props.live.host.id) }" />
      <span class="name">{{ props.live.host.name }}</span>
    </div>
  </button>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0 0 4px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cover {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: var(--skeleton);
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.2s;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.4s var(--ease-out);
}
.card:hover .cover {
  outline-color: var(--red);
}
.card:hover .cover img {
  transform: scale(1.03);
}
.card:hover .title {
  color: var(--red);
}
.card:focus-visible {
  outline: none;
}
.card:focus-visible .cover {
  outline-color: var(--red);
}
.status,
.viewers {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgb(20 22 32 / 62%);
  backdrop-filter: blur(6px);
}
.status {
  top: 8px;
  left: 8px;
}
.status.on {
  background: var(--red);
}
.viewers {
  left: 8px;
  bottom: 8px;
}
.title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  transition: color 0.2s;
}
.host {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--ink-3);
}
.ava {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  flex: none;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .cover img {
    transition: none;
  }
  .card:hover .cover img {
    transform: none;
  }
}
</style>
