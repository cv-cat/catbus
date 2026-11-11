<script setup lang="ts">
import { ref, watch } from 'vue'
import type { UserRef } from '@/api/types'
import { initial } from '@/composables/format'

/**
 * 用户头像：有 `avatar`（AGENTS.md 6.2 UserRef）时显示图片，取不到或加载失败时退回占位色 + 首字。
 * 尺寸、占位色由调用方的 class / style 决定。
 */
const props = withDefaults(defineProps<{ user: UserRef | null | undefined; letter?: boolean }>(), { letter: true })

const broken = ref(false)
watch(
  () => props.user?.avatar,
  () => (broken.value = false),
)
</script>

<template>
  <span class="user-avatar" aria-hidden="true">
    <template v-if="letter">{{ initial(user?.name) }}</template>
    <img
      v-if="user?.avatar && !broken"
      :src="user.avatar"
      alt=""
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      @error="broken = true"
    />
  </span>
</template>

<style scoped>
.user-avatar {
  position: relative;
  overflow: hidden;
}
img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
</style>
