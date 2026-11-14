<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Heart } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import EmojiText from '@/components/EmojiText.vue'
import CommentMedia from '@/components/CommentMedia.vue'
import { REPLY_PLATFORMS, listReplies } from '@/api/client'
import type { CatbusError, Comment, Item } from '@/api/types'
import { errorTitle } from '@/i18n/errors'
import { compact, since, tintOf } from '@/composables/format'
import { enqueueReply, stopReplyQueue } from '@/composables/replyQueue'
import { openVerify, verifyUrlOf } from '@/stores/verify'

/**
 * 一条评论下的楼中楼（AGENTS.md 7.9）：默认带出第一条回复，其余点「展开」再取，可以收起。
 */
const props = defineProps<{ comment: Comment; item: Item; platform: string; account: string | null }>()
const { t } = useI18n()

const total = computed(() => props.comment.stats.replies ?? 0)
const supported = computed(() => REPLY_PLATFORMS.has(props.platform) && total.value > 0)

const replies = shallowRef<Comment[]>([])
const cursor = ref<string | null>(null)
const more = ref(true)
const loading = ref(false)
const error = ref<CatbusError | null>(null)
/** 展开后显示全部已取到的回复，收起时只留第一条 */
const expanded = ref(false)

const shown = computed(() => (expanded.value ? replies.value : replies.value.slice(0, 1)))
const hidden = computed(() => Math.max(0, total.value - shown.value.length))
/** 被回复的人：楼中楼里回复的是另一条子回复时显示「A ▸ B」 */
const nameById = computed(() => new Map(replies.value.map((r) => [r.id, r.author?.name ?? null])))

function append(list: Comment[], page: { cursor: string | null; has_more: boolean } | null) {
  const seen = new Set(replies.value.map((r) => r.id))
  replies.value = [...replies.value, ...list.filter((r) => !seen.has(r.id))]
  cursor.value = page?.cursor ?? null
  more.value = Boolean(page?.has_more && page.cursor)
}

async function fetchPage(limit?: number, signal?: AbortSignal) {
  const env = await listReplies(props.platform, props.item, props.comment.id, cursor.value, limit, props.account, signal)
  if (env.ok && env.data) {
    error.value = null
    append(env.data, env.page)
  } else {
    error.value = env.error
  }
  return env
}

// ---------- 默认展开第一条：滚进视野时排队预取 ----------
const root = ref<HTMLElement>()
let io: IntersectionObserver | undefined
let requested = false

function preview() {
  if (requested) return
  requested = true
  io?.disconnect()
  loading.value = true
  void enqueueReply(props.platform, (signal) => fetchPage(1, signal))
    .then((env) => {
      // 风控时停掉自动预取，避免越拦越多；手动展开仍可用
      if (env && !env.ok && env.error?.code === 'RISK_CONTROL') stopReplyQueue()
      if (!env) requested = false
    })
    .finally(() => (loading.value = false))
}

onMounted(() => {
  if (!supported.value || !root.value) return
  io = new IntersectionObserver(([e]) => e?.isIntersecting && preview(), {
    // 评论区的滚动容器：浮动卡片是 .body，全屏详情是整个面板（.sheet）
    root: root.value.closest('.compact .sheet') ?? root.value.closest('.body'),
    rootMargin: '120px',
  })
  io.observe(root.value)
})
onBeforeUnmount(() => io?.disconnect())

// ---------- 手动展开 / 收起 ----------
async function expand() {
  if (loading.value) return
  // 已经取到的比显示的多：先把它们露出来
  if (!expanded.value && replies.value.length > 1) {
    expanded.value = true
    if (replies.value.length >= total.value || !more.value) return
  }
  expanded.value = true
  if (!more.value) return
  loading.value = true
  requested = true
  try {
    await fetchPage(10)
  } finally {
    loading.value = false
  }
}

function retry() {
  if (replies.value.length) return void expand()
  requested = false
  preview()
}

function collapse() {
  expanded.value = false
  root.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function verify() {
  openVerify({ platform: props.platform, url: verifyUrlOf(error.value), message: error.value ? errorTitle(error.value) : undefined, retry: expand })
}
</script>

<template>
  <div v-if="total > 0" ref="root" class="thread">
    <span v-if="!supported" class="count">{{ t('comment.replies.count', { n: total }, total) }}</span>
    <template v-else>
      <ul v-if="shown.length" class="replies">
        <li v-for="r in shown" :key="r.id" class="reply">
          <UserAvatar class="ava" :user="r.author" :style="{ background: tintOf(r.author?.id) }" />
          <div class="r-body">
            <span class="r-name">
              {{ r.author?.name ?? t('comment.anonymous') }}
              <template v-if="r.parent_id && r.parent_id !== comment.id && nameById.get(r.parent_id)">
                <span class="arrow">▸</span>{{ nameById.get(r.parent_id) }}
              </template>
            </span>
            <p v-if="r.text" class="r-text"><EmojiText :platform="platform" :text="r.text" /></p>
     <CommentMedia :media="r.media" small />
            <div class="r-meta">
              <span>{{ since(r.created_at) }}</span>
              <span class="grow" />
              <span v-if="r.stats.likes != null" class="r-like"><Heart :size="12" />{{ compact(r.stats.likes) }}</span>
            </div>
          </div>
        </li>
      </ul>

      <div class="actions">
        <span v-if="loading" class="loading"><CatbusLoader :size="14" />{{ t('common.state.loading') }}</span>
        <template v-else-if="error">
          <span class="err">{{ t('comment.replies.failed') }}</span>
          <button v-if="verifyUrlOf(error)" type="button" class="link" @click="verify">{{ t('comment.verify') }}</button>
          <button v-else type="button" class="link" @click="retry">{{ t('common.action.retry') }}</button>
        </template>
        <template v-else>
          <button v-if="hidden > 0 && (more || replies.length > shown.length)" type="button" class="link" @click="expand">
            {{ expanded ? t('comment.replies.expandMore') : t('comment.replies.expand', { n: hidden }, hidden) }}<ChevronDown :size="14" />
          </button>
          <button v-if="expanded && shown.length > 1" type="button" class="link quiet" @click="collapse">
            {{ t('comment.replies.collapse') }}<ChevronUp :size="14" />
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.thread {
  margin-top: 4px;
}
.count {
  font-size: 13px;
  color: var(--ink-3);
}
.replies {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reply {
  display: flex;
  gap: 8px;
  animation: reply-in 0.35s var(--ease-out);
}
@keyframes reply-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.ava {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  box-shadow: inset 0 0 0 1.5px #ffffff33;
}
.r-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.r-name {
  font-size: 12.5px;
  color: var(--ink-3);
}
.arrow {
  margin: 0 4px;
  font-size: 10px;
}
.r-text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.r-meta {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--ink-3);
}
.grow {
  flex: 1;
}
.r-like {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
}
.actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 8px;
  font-size: 13px;
}
.actions:empty {
  display: none;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-weight: 500;
  color: var(--link);
}
.link:hover {
  text-decoration: underline;
}
.link.quiet {
  color: var(--ink-3);
}
.r-name {
  overflow-wrap: anywhere;
}

/* 手机：楼中楼缩进收窄、头像变小 */
@media (max-width: 640px) {
  .replies {
    gap: 10px;
  }
  .reply {
    gap: 6px;
  }
  .ava {
    width: 20px;
    height: 20px;
    font-size: 10px;
  }
  .r-text {
    font-size: 13px;
  }
}
/* 触屏：「展开 N 条回复」「收起」的可点区域至少 --tap 高 */
@media (hover: none) and (pointer: coarse) {
  .actions {
    margin-top: 0;
    gap: 6px;
  }
  .link {
    min-height: var(--tap);
    padding-right: 8px;
  }
  .link:hover {
    text-decoration: none;
  }
}
.loading,
.err {
  color: var(--ink-3);
}
.loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
