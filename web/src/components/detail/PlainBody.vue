<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Heart, Search, ShieldAlert } from 'lucide-vue-next'
import CommentThread from '../CommentThread.vue'
import UserAvatar from '../UserAvatar.vue'
import EmojiText from '../EmojiText.vue'
import CommentMedia from '../CommentMedia.vue'
import HighlightText from '../tools/HighlightText.vue'
import DetailExtras from '../tools/DetailExtras.vue'
import RelatedRail from '../RelatedRail.vue'
import AppSelect from '../AppSelect.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { linkSegments } from '@/composables/linkify'
import { COMMENT_FILTER_MIN, filterComments, type CommentSort } from '@/composables/comment-filter'
import { compact, number, since, tintOf } from '@/composables/format'
import { errorDetail, errorTitle } from '@/i18n/errors'
import { verifyUrlOf } from '@/stores/verify'
import type { PlatformFilters } from '@/api/client'
import type { CatbusError, Comment, Item } from '@/api/types'
import type { DetailTarget } from '@/stores/detail'
import { detailStats } from './stats'

/**
 * 普通条目（不是种子、演出）的正文（AGENTS.md 7.9「详情卡片」）：标题、正文（纯文字时放进引号底板，设计稿 I），
 * 字幕 / 弹幕、相关推荐、评论区（含「评论区筛选」）。默认插槽放在正文之后、字幕弹幕之前（等价命令、错误提示）。
 * 评论的数据和翻页由 DetailCard 管（换条目、关闭时随详情一起取消）；这里只渲染和发出 more / verify。
 */
const props = defineProps<{
  target: DetailTarget
  /** 合并后的条目（详情回来前是列表里那一条） */
  item: Item
  detail: Item | null
  title: string | null
  textOnly: boolean
  loading: boolean
  comments: Comment[]
  loadingComments: boolean
  commentMore: boolean
  commentError: CatbusError | null
  caps: PlatformFilters | null
  open: boolean
  /** 评论区的滚动容器：浮动卡片是 .body，全屏是整个面板 */
  scroller: HTMLElement | undefined
}>()
const emit = defineEmits<{
  /** 滚到底：取下一页评论；也用于重试 */
  more: []
  verify: []
  pick: [item: Item]
}>()
const { t } = useI18n()

// ---------- 正文 ----------
/** 正文：去掉小红书的 `[话题]` 标记，话题高亮 */
function segments(text: string | null | undefined) {
  if (!text) return []
  const clean = text.replace(/#([^#\n[]+?)\[话题\]#/g, '#$1 ') // i18n-ignore：解析小红书的话题标记
  // 链接整段交给 EmojiText 渲染，链接里的 `#` 不当成话题
  return linkSegments(clean).flatMap((l) =>
    l.href
      ? [{ t: l.t, tag: false }]
      : l.t.split(/(#[^\s#]+)/).filter(Boolean).map((t) => ({ t, tag: t.startsWith('#') && t.length > 1 })),
  )
}
const textSegs = computed(() => {
  const x = props.item.text
  if (x && props.title && x.trim() === props.title) return []
  return segments(x)
})

// ---------- 纯文字底板（设计稿 I） ----------
/** 与列表里纯文字卡同一种底色：按条目 id 哈希（MediaCard 的 PALETTE） */
const CARD_TINTS = ['#E8414F', '#232838', '#F0B429', '#5A6BD8']
const faceTint = computed(() => {
  let h = 2166136261
  for (const c of props.item.id ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return CARD_TINTS[(h >>> 0) % CARD_TINTS.length]
})
/** 纯文字底板里的时间（本地时间到分）与计数；评论数已在评论区标题里 */
const faceTime = computed(() => {
  const iso = props.item.created_at
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})
const faceStats = computed(() => detailStats(props.item, null).filter((s) => s.key !== 'comments' && s.v != null))

// ---------- 评论区筛选（AGENTS.md 7.9）：只作用于已加载的评论，换条目时复位 ----------
const cQuery = ref('')
const cSort = ref<CommentSort>('default')
const cSearching = ref(false)
const cFiltered = computed(() => Boolean(cQuery.value.trim()) || cSort.value !== 'default')
const shownComments = computed(() => filterComments(props.comments, cQuery.value, cSort.value))
const cSortOptions = computed(() => [
  { value: 'default' as const, label: t('comment.filter.sortDefault') },
  { value: 'hot' as const, label: t('comment.filter.sortHot') },
  { value: 'new' as const, label: t('comment.filter.sortNew') },
])
const cSearchEl = ref<HTMLInputElement>()
watch(cSearching, (v) => v && void nextTick(() => cSearchEl.value?.focus()))
function clearCommentFilter() {
  cQuery.value = ''
  cSort.value = 'default'
  cSearching.value = false
}
/** 评论搜索：图标和输入框是同一颗胶囊，展开 / 收起都走宽度过渡；失焦时没有输入就收回图标 */
const cSearchBtn = ref<HTMLButtonElement>()
function openCommentSearch() {
  if (cSearching.value) cSearchEl.value?.focus()
  else cSearching.value = true
}
function onCommentSearchBlur() {
  if (!cQuery.value.trim()) {
    cQuery.value = ''
    cSearching.value = false
  }
}
function onCommentSearchEsc() {
  if (cQuery.value) return void (cQuery.value = '')
  cSearching.value = false
  cSearchBtn.value?.focus()
}

// ---------- 滚到底取下一页评论 ----------
const sentinel = ref<HTMLElement>()
let io: IntersectionObserver | undefined
watch(
  [sentinel, () => props.scroller],
  ([s, b]) => {
    io?.disconnect()
    if (!s || !b) return
    io = new IntersectionObserver(([e]) => e?.isIntersecting && props.commentMore && !props.commentError && emit('more'), {
      root: b,
      rootMargin: '200px',
    })
    io.observe(s)
  },
)
onBeforeUnmount(() => io?.disconnect())

/** 换条目时由 DetailCard 调用 */
defineExpose({ reset: clearCommentFilter })
</script>

<template>
  <!-- 纯文字：正文放进与列表卡同色的引号底板，时间和计数也在底板里（设计稿 I） -->
  <div v-if="textOnly" class="face rv" :class="{ short: [...(item.text ?? '')].length <= 40 }" :style="{ '--tint': faceTint }">
    <span class="quote" aria-hidden="true">“</span>
    <h2 v-if="title" class="title">{{ title }}</h2>
    <p v-if="textSegs.length" class="text">
      <template v-for="(s, i) in textSegs" :key="i">
        <span v-if="s.tag" class="tag">{{ s.t }}</span>
        <EmojiText v-else :platform="target.platform" :text="s.t" />
      </template>
    </p>
    <div class="face-meta">
      <span class="mono">{{ faceTime }}</span>
      <span class="grow" />
      <span v-for="s in faceStats" :key="s.key" class="f-stat" :aria-label="t('detail.stat.aria', { n: s.v ?? 0, label: s.label })">
        <component :is="s.icon" :size="14" aria-hidden="true" />
        <span class="mono">{{ compact(s.v) }}</span>
      </span>
    </div>
  </div>
  <h2 v-if="!textOnly && title" class="title rv">{{ title }}</h2>
  <p v-if="!textOnly && textSegs.length" class="text rv">
    <template v-for="(s, i) in textSegs" :key="i">
      <span v-if="s.tag" class="tag">{{ s.t }}</span>
      <EmojiText v-else :platform="target.platform" :text="s.t" />
    </template>
  </p>
  <div v-else-if="!textOnly && loading" class="lines rv" aria-hidden="true">
    <span /><span /><span class="short" />
  </div>
  <slot />

  <DetailExtras
    v-if="caps?.subtitles || caps?.danmaku"
    class="rv"
    :platform="target.platform"
    :item="detail ?? target.item"
    :account="target.account"
    :subtitles="!!caps?.subtitles"
    :danmaku="!!caps?.danmaku"
  />
  <RelatedRail
    :platform="target.platform"
    :id="target.item.id"
    :item="detail ?? target.item"
    :account="target.account"
    :ready="!loading && !loadingComments"
    :open="open"
    @pick="emit('pick', $event)"
  />

  <div v-if="!textOnly" class="divider rv" />
  <div class="c-head rv">
    <p class="count">
      {{ item.stats.comments != null ? t('comment.count', { n: number(item.stats.comments) }, item.stats.comments) : t('comment.title') }}
    </p>
    <template v-if="comments.length > COMMENT_FILTER_MIN">
      <span class="grow" />
      <div class="c-find" :class="{ open: cSearching }">
        <button
          ref="cSearchBtn"
          type="button"
          class="c-find-btn"
          :aria-label="t('comment.filter.search')"
          :aria-expanded="cSearching"
          v-tip="cSearching ? undefined : t('comment.filter.search')"
          @mousedown.prevent
          @click="openCommentSearch"
        >
          <Search :size="14" aria-hidden="true" />
        </button>
        <input
          ref="cSearchEl"
          v-model="cQuery"
          class="c-search"
          type="search"
          :tabindex="cSearching ? 0 : -1"
          :aria-hidden="!cSearching"
          :placeholder="t('comment.filter.placeholder')"
          :aria-label="t('comment.filter.placeholder')"
          @blur="onCommentSearchBlur"
          @keydown.esc.stop="onCommentSearchEsc"
        />
      </div>
      <span class="c-sort"><AppSelect v-model="cSort" :options="cSortOptions" :label="t('comment.filter.sort')" :title="t('comment.filter.sort')" /></span>
    </template>
  </div>
  <p v-if="cFiltered" class="c-filtered">
    {{ t('comment.filter.result', { n: comments.length, m: shownComments.length }, shownComments.length) }}
    <GlassButton tone="accent" size="sm" class="c-clear" @click="clearCommentFilter">{{ t('comment.filter.clear') }}</GlassButton>
  </p>

  <ul class="comments">
    <li v-for="c in shownComments" :key="c.id" class="comment">
      <UserAvatar class="ava sm" :user="c.author" :style="{ background: tintOf(c.author?.id) }" />
      <div class="c-body">
        <span class="c-name"><HighlightText platform="" :text="c.author?.name ?? t('comment.anonymous')" :query="cQuery" /></span>
        <p v-if="c.text" class="c-text"><HighlightText :platform="target.platform" :text="c.text" :query="cQuery" /></p>
        <CommentMedia :media="c.media" />
        <div class="c-meta">
          <span>{{ since(c.created_at) }}</span>
          <span class="grow" />
          <span v-if="c.stats.likes != null" class="c-like"><Heart :size="13" />{{ compact(c.stats.likes) }}</span>
        </div>
        <CommentThread :comment="c" :item="item" :platform="target.platform" :account="target.account" />
      </div>
    </li>
  </ul>

  <div v-if="loadingComments || (loading && !comments.length)" class="c-skeleton" :aria-label="t('comment.loading')">
    <div v-for="i in comments.length ? 1 : 3" :key="i" class="sk-row"><span class="sk-ava" /><span class="sk-lines"><span /><span /></span></div>
  </div>
  <div v-else-if="commentError" class="c-error">
    <ShieldAlert :size="16" />
    <span :title="errorDetail(commentError) ?? undefined">{{ errorTitle(commentError) }}</span>
    <GlassButton v-if="verifyUrlOf(commentError)" tone="primary" size="sm" @click="emit('verify')">{{ t('comment.verify') }}</GlassButton>
    <GlassButton v-else tone="primary" size="sm" @click="emit('more')">{{ t('common.action.retry') }}</GlassButton>
  </div>
  <p v-else-if="!comments.length" class="c-empty">{{ t('comment.empty') }}</p>
  <p v-else-if="!commentMore" class="c-end mono">{{ t('comment.end') }}</p>
  <div ref="sentinel" class="sentinel" aria-hidden="true" />
</template>

<style scoped src="./shared.css"></style>
<style scoped>
.c-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.c-head .count {
  flex: none;
  margin: 0;
  white-space: nowrap;
}
.c-head .grow {
  flex: 1;
}
/* 评论搜索：收起时是 28px 的圆形图标，展开成玻璃胶囊；条数不换行、不被挤，胶囊在剩下的空间里收缩 */
.c-find {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
  border-radius: 14px;
  overflow: hidden;
  color: var(--ink-3);
  transition: width 0.34s var(--ease-out), min-width 0.34s var(--ease-out), background 0.2s, box-shadow 0.2s;
}
.c-find:hover,
.c-find.open {
  background: var(--lg-fill);
  backdrop-filter: var(--lg-blur);
  box-shadow: var(--lg-edge);
}
.c-find.open {
  width: 168px;
  min-width: 92px;
}
.c-find.open:focus-within {
  box-shadow: var(--lg-edge), inset 0 0 0 1px color-mix(in srgb, var(--red) 60%, transparent);
}
.c-find-btn {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  transition: color 0.2s;
}
.c-find:hover .c-find-btn,
.c-find.open .c-find-btn {
  color: var(--ink-2);
}
.c-find-btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--red) 70%, transparent);
  outline-offset: -2px;
  border-radius: 50%;
}
.c-search {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 10px 0 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.18s, visibility 0s 0.34s;
}
.c-find.open .c-search {
  opacity: 1;
  visibility: visible;
  transition: opacity 0.22s 0.1s, visibility 0s;
}
.c-search::-webkit-search-cancel-button {
  cursor: pointer;
}
/* 排序只有三个短选项，触发器收窄、和搜索胶囊同高，把空间留给搜索（AppSelect 有两个根节点，class 传不进去，所以包一层） */
.c-head .c-sort {
  flex: none;
  display: flex;
}
.c-sort :deep(.sel.lg-btn) {
  --lg-h: 28px;
  width: 92px;
  min-width: 0;
  padding: 0 8px 0 12px;
  font-size: 12px;
}
.c-filtered {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}
.c-filtered .c-clear {
  --lg-h: 24px;
  margin-left: 6px;
}
@media (max-width: 640px) {
  .c-search {
    font-size: 16px;
  }
}
@media (hover: none) and (pointer: coarse) {
  .c-find,
  .c-find-btn {
    min-width: 36px;
    width: 36px;
    height: 36px;
    border-radius: 18px;
  }
  .c-find.open {
    width: 168px;
  }
}

/* 纯文字卡没有分隔线：评论标题自己和上面（相关推荐、等价命令）隔开 */
.text-only .c-head {
  margin-top: 22px;
}
.comments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.comment {
  display: flex;
  gap: 10px;
}
.c-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.c-name {
  font-size: 13px;
  color: var(--ink-3);
}
.c-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.c-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.c-like {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
}
.c-skeleton {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 18px;
}
.comments:empty + .c-skeleton {
  margin-top: 0;
}
.c-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--ink-2);
  background: var(--red-soft);
}
.c-error svg {
  flex: none;
  color: var(--red);
}
.c-error span {
  flex: 1;
  min-width: 0;
}
.c-empty,
.c-end {
  margin: 20px 0 8px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-3);
}
.sentinel {
  height: 1px;
}

/* ---------- 纯文字（设计稿 I）：引号底板 ---------- */
.face {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
  padding: 22px 30px 20px;
  border-radius: 20px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 15%, transparent), color-mix(in srgb, var(--tint) 3%, transparent));
}
[data-theme='dark'] .face {
  background: linear-gradient(135deg, color-mix(in srgb, var(--tint) 24%, transparent), color-mix(in srgb, var(--tint) 6%, transparent));
}
.face .quote {
  font-family: 'Noto Serif SC', 'Songti SC', serif;
  font-size: 64px;
  font-weight: 700;
  line-height: 0.8;
  height: 34px;
  color: color-mix(in srgb, var(--tint) 70%, transparent);
}
[data-theme='dark'] .face .quote {
  color: color-mix(in srgb, var(--tint) 55%, #c9cee6);
}
.face .title {
  margin: 0;
  font-size: 20px;
}
.face .text {
  font-size: 17px;
  font-weight: 500;
  line-height: 1.7;
}
.face.short .text {
  font-size: 22px;
  line-height: 1.6;
}
.face-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.face-meta .grow {
  flex: 1;
}
.f-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-2);
}
.compact .face {
  padding: 18px 20px 16px;
}
.compact .face.short .text {
  font-size: 19px;
}

/* 手机 */
@media (max-width: 640px) {
  .comment {
    gap: 8px;
  }
  .comments {
    gap: 16px;
  }
  .c-name {
    overflow-wrap: anywhere;
  }
}

/* 触屏：可点区域至少 --tap */
@media (hover: none) and (pointer: coarse) {
  .c-error .lg-btn {
    --lg-h: 36px;
  }
}
</style>
