<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { ChevronLeft, ChevronRight, Play } from 'lucide-vue-next'
import UserAvatar from './UserAvatar.vue'
import type { Item } from '@/api/types'
import { compact, tintOf } from '@/composables/format'
import { prefersReducedMotion } from '@/composables/motion'
import { cachedRelated, fetchRelated, relatedSupported, rememberRelated } from '@/composables/useRelated'
import { imgSrc } from '@/api/client'

/**
 * 详情卡片里的「相关推荐」（AGENTS.md 7.9，设计稿 S / S2 / S3）：一行横向滚动的小卡片。
 * - 平台没有实现 `item related`、返回空或请求失败时整段不渲染；
 * - `ready` 之后才请求（详情补全、评论第一页回来之后），不阻塞正文和评论；
 * - 换条目、卡片关闭（open 为 false）时丢弃还没回来的结果。
 */
const props = defineProps<{
  platform: string
  /** 条目 id：缓存和丢弃按它判断 */
  id: string
  /** 请求用的条目（详情回来后用详情，url 优先） */
  item: Item
  account: string | null
  ready: boolean
  open: boolean
}>()
const emit = defineEmits<{ pick: [item: Item] }>()

const supported = computed(() => relatedSupported(props.platform))
const list = shallowRef<Item[] | null>(null)
const failed = ref(false)
const key = computed(() => `${props.platform}\u0000${props.id}`)
/** 每次换条目 / 关闭都加一：回来的结果对不上就丢掉 */
let token = 0
let started = ''

const rail = ref<HTMLElement>()
const atStart = ref(true)
const atEnd = ref(true)

function measure() {
  const el = rail.value
  if (!el) return
  atStart.value = el.scrollLeft <= 1
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
}

watch(
  [key, () => props.open],
  ([, open]) => {
    token++
    started = ''
    failed.value = false
    list.value = open ? (cachedRelated(props.platform, props.id) ?? null) : list.value
    if (rail.value) rail.value.scrollLeft = 0
    void nextTick(measure)
  },
  { immediate: true },
)

watch(
  [key, () => props.ready, () => props.open, supported],
  () => {
    if (!props.open || !props.ready || !supported.value || list.value || failed.value || started === key.value) return
    started = key.value
    const my = ++token
    const { platform, id } = props
    void fetchRelated(platform, id, props.item, props.account).then((r) => {
      if (my !== token) return
      if (!r) {
        failed.value = true
        return
      }
      rememberRelated(platform, id, r)
      list.value = r
      void nextTick(measure)
    })
  },
  { immediate: true },
)

/** 没支持、失败、返回空时整段不渲染；还没回来时显示骨架 */
const visible = computed(() => supported.value && !failed.value && (list.value === null || list.value.length > 0))

/** 翻页：每次滚两张卡的宽度（卡宽 112 + 间距 10） */
function page(dir: 1 | -1) {
  rail.value?.scrollBy({ left: dir * 2 * 122, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

const label = (it: Item) => it.title?.trim() || it.text?.trim().split('\n')[0] || '无标题'
const views = (it: Item) => (it.kind === 'video' && it.stats.views != null ? compact(it.stats.views) : null)

let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(measure)
  watch(rail, (el, old) => {
    if (old) ro?.unobserve(old)
    if (el) ro?.observe(el)
  }, { immediate: true })
})
onBeforeUnmount(() => {
  token++
  ro?.disconnect()
})
</script>

<template>
  <section v-if="visible" class="related" aria-label="相关推荐">
    <div class="r-head">
      <h3>相关推荐</h3>
      <span class="grow" />
      <template v-if="list">
        <button class="pg" type="button" aria-label="向左翻" :disabled="atStart" @click="page(-1)"><ChevronLeft :size="14" /></button>
        <button class="pg" type="button" aria-label="向右翻" :disabled="atEnd" @click="page(1)"><ChevronRight :size="14" /></button>
      </template>
    </div>
    <div ref="rail" class="rail" :class="{ fade: !atEnd }" @scroll.passive="measure">
      <div class="track">
        <template v-if="list">
          <button v-for="it in list" :key="it.id" class="mini" type="button" :title="label(it)" @click="emit('pick', it)">
            <span class="cover">
              <img v-if="it.cover" :src="imgSrc(it.cover)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
              <span v-if="views(it)" class="badge mono"><Play :size="9" fill="currentColor" aria-hidden="true" />{{ views(it) }}</span>
            </span>
            <span class="m-title">{{ label(it) }}</span>
            <span class="m-meta">
              <UserAvatar class="m-ava" :user="it.author" :letter="false" :style="{ background: tintOf(it.author?.id) }" />
              <span class="m-name">{{ it.author?.name ?? '未知作者' }}</span>
            </span>
          </button>
        </template>
        <template v-else>
          <span v-for="i in 4" :key="i" class="mini sk" aria-hidden="true">
            <span class="cover" />
            <span class="sk-line" />
            <span class="sk-line short" />
          </span>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.related {
  margin-top: 20px;
}
.r-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin-bottom: 10px;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.grow {
  flex: 1;
}
/* 翻页按钮只在能悬停的设备上显示，触屏直接横滑 */
.pg {
  display: none;
  width: 28px;
  height: 28px;
  padding: 0;
  place-items: center;
  border: 1px solid var(--hair);
  border-radius: 50%;
  background: transparent;
  color: var(--ink-2);
  cursor: pointer;
  transition: opacity 0.2s, background 0.2s, color 0.2s;
}
@media (hover: hover) {
  .pg {
    display: grid;
  }
  .pg:not(:disabled):hover {
    background: var(--hair);
    color: var(--ink);
  }
}
.pg:disabled {
  opacity: 0.4;
  cursor: default;
}
.rail {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
}
.rail::-webkit-scrollbar {
  display: none;
}
/* 右缘 36px 渐隐，提示还能继续滑；滚到底时去掉 */
.rail.fade {
  mask-image: linear-gradient(to right, #000 calc(100% - 36px), transparent);
}
.track {
  display: flex;
  gap: 10px;
  width: max-content;
  /* 悬停描边是 2px 的 outline：留出位置不被裁掉 */
  padding: 2px;
  margin: -2px;
}
.mini {
  flex: none;
  width: 112px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  scroll-snap-align: start;
}
.cover {
  position: relative;
  display: block;
  width: 112px;
  height: 140px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--hair);
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.2s;
}
.cover img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 8px;
  background: #0b0e1a80;
  color: #fff;
  font-size: 10px;
  line-height: 14px;
}
.m-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--ink);
  transition: color 0.2s;
}
.m-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.m-ava {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.m-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--ink-3);
}
/* 悬停只在能悬停的设备上：触屏点按后不留红边 */
@media (hover: hover) {
  .mini:not(.sk):hover .cover {
    outline-color: #e8414f99;
  }
  .mini:not(.sk):hover .m-title {
    color: var(--red);
  }
}
.mini:focus-visible .cover {
  outline-color: #e8414f99;
}
.mini:focus-visible .m-title {
  color: var(--red);
}
.mini:focus-visible {
  outline: none;
}
/* 骨架：与小卡片同尺寸 */
.sk {
  cursor: default;
}
.sk .cover,
.sk-line {
  background: var(--hair);
}
.sk-line {
  display: block;
  width: 96px;
  height: 10px;
  margin: 3px 0;
  border-radius: 5px;
}
.sk-line.short {
  width: 64px;
}
</style>
