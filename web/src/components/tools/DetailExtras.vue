<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Copy, Captions, MessagesSquare } from 'lucide-vue-next'
import type { CatbusError, Danmaku, Item, Subtitle } from '@/api/types'
import { listDanmaku, listSubtitles } from '@/api/extras'
import { copyText } from '@/stores/toast'
import { errorTitle } from '@/i18n/errors'
import GlassButton from '@/components/ui/GlassButton.vue'

/**
 * 详情卡片的字幕、弹幕（AGENTS.md 7.9「详情卡片的字幕、弹幕与媒体链接」）：折叠按钮，点了才请求；
 * 结果按「平台 + 条目」在本页会话里缓存。
 */
const props = defineProps<{ platform: string; item: Item; account: string | null; subtitles: boolean; danmaku: boolean }>()
const { t } = useI18n()

type Kind = 'subtitles' | 'danmaku'
interface Slot<T> {
  loading: boolean
  error: CatbusError | null
  data: T[] | null
}
const cache = new Map<string, Slot<Subtitle> | Slot<Danmaku>>()
const key = (k: Kind) => JSON.stringify([k, props.platform, props.item.id])

const open = ref<Kind | null>(null)
const subs = ref<Slot<Subtitle>>({ loading: false, error: null, data: null })
const dms = ref<Slot<Danmaku>>({ loading: false, error: null, data: null })
const lang = ref(0)

watch(
  () => [props.platform, props.item.id],
  () => {
    open.value = null
    lang.value = 0
    subs.value = (cache.get(key('subtitles')) as Slot<Subtitle>) ?? { loading: false, error: null, data: null }
    dms.value = (cache.get(key('danmaku')) as Slot<Danmaku>) ?? { loading: false, error: null, data: null }
  },
  { immediate: true },
)

async function load(k: Kind) {
  const id = props.item.id
  const slot = k === 'subtitles' ? subs : dms
  slot.value = { loading: true, error: null, data: null }
  const env = k === 'subtitles' ? await listSubtitles(props.platform, props.item, props.account) : await listDanmaku(props.platform, props.item, props.account)
  if (props.item.id !== id) return
  const next = env.ok
    ? { loading: false, error: null, data: (k === 'danmaku' ? [...(env.data as Danmaku[])].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0)) : env.data) as never }
    : { loading: false, error: env.error, data: null }
  slot.value = next
  if (env.ok) cache.set(key(k), next)
}

function toggle(k: Kind) {
  open.value = open.value === k ? null : k
  const slot = k === 'subtitles' ? subs.value : dms.value
  if (open.value && !slot.data && !slot.loading) void load(k)
}

const clock = (sec: number | null) => {
  if (sec == null || !Number.isFinite(sec)) return '--:--'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
const curSub = computed(() => subs.value.data?.[lang.value] ?? null)
const copySubs = () => curSub.value && copyText(curSub.value.lines.map((l) => l.text).join('\n'))
</script>

<template>
  <div v-if="subtitles || danmaku" class="extras">
    <div class="tabs">
      <GlassButton v-if="subtitles" class="tab" :class="{ 'is-on': open === 'subtitles' }" :aria-expanded="open === 'subtitles'" @click="toggle('subtitles')">
        <Captions :size="14" aria-hidden="true" />{{ t('detail.extras.subtitles') }}
        <ChevronDown :size="13" class="chev" :class="{ up: open === 'subtitles' }" aria-hidden="true" />
      </GlassButton>
      <GlassButton v-if="danmaku" class="tab" :class="{ 'is-on': open === 'danmaku' }" :aria-expanded="open === 'danmaku'" @click="toggle('danmaku')">
        <MessagesSquare :size="14" aria-hidden="true" />{{ dms.data ? t('detail.extras.danmakuCount', { n: dms.data.length }, dms.data.length) : t('detail.extras.danmaku') }}
        <ChevronDown :size="13" class="chev" :class="{ up: open === 'danmaku' }" aria-hidden="true" />
      </GlassButton>
    </div>
    <div v-if="open" class="panel">
      <template v-if="open === 'subtitles'">
        <p v-if="subs.loading" class="note">{{ t('common.state.loading') }}</p>
        <p v-else-if="subs.error" class="note err">{{ errorTitle(subs.error) }} <GlassButton tone="accent" size="sm" @click="load('subtitles')">{{ t('common.action.retry') }}</GlassButton></p>
        <p v-else-if="subs.data && !subs.data.length" class="note">{{ t('detail.extras.noSubtitles') }}</p>
        <template v-else-if="curSub">
          <div class="bar">
            <GlassButton
              v-for="(s, i) in subs.data!"
              :key="i"
              size="sm"
              class="chip"
              :class="{ 'is-on': i === lang }"
              @click="lang = i"
            >
              {{ s.name || s.lang || i + 1 }}
            </GlassButton>
            <span class="grow" />
            <GlassButton tone="quiet" size="sm" class="copy" @click="copySubs"><Copy :size="12" aria-hidden="true" />{{ t('detail.extras.copyAll') }}</GlassButton>
          </div>
          <ol class="lines">
            <li v-for="(l, i) in curSub.lines" :key="i"><span class="ts mono">{{ clock(l.from) }}</span>{{ l.text }}</li>
          </ol>
        </template>
      </template>
      <template v-else>
        <p v-if="dms.loading" class="note">{{ t('common.state.loading') }}</p>
        <p v-else-if="dms.error" class="note err">{{ errorTitle(dms.error) }} <GlassButton tone="accent" size="sm" @click="load('danmaku')">{{ t('common.action.retry') }}</GlassButton></p>
        <p v-else-if="dms.data && !dms.data.length" class="note">{{ t('detail.extras.noDanmaku') }}</p>
        <ol v-else-if="dms.data" class="lines">
          <li v-for="d in dms.data" :key="d.id"><span class="ts mono">{{ clock(d.offset) }}</span>{{ d.text }}</li>
        </ol>
      </template>
    </div>
  </div>
</template>

<style scoped>
.extras {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 和上面的等价命令行隔开（相关推荐自己带 margin-top: 20px） */
  margin-top: 14px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.chev {
  transition: transform 0.2s;
}
.chev.up {
  transform: rotate(180deg);
}
.panel {
  border-radius: 12px;
  border: 1px solid var(--hair);
  padding: 8px 10px;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.grow {
  flex: 1;
}
/* 按钮外观来自 lg-btn */
.bar .chip {
  --lg-h: 26px;
}
.bar .copy {
  gap: 4px;
}
.lines {
  margin: 0;
  padding: 0;
  list-style: none;
  max-height: 320px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  scrollbar-width: thin;
}
.lines li {
  display: flex;
  gap: 10px;
}
.ts {
  flex: none;
  min-width: 44px;
  color: var(--ink-3);
  font-size: 12px;
}
.note {
  margin: 4px 0;
  font-size: 13px;
  color: var(--ink-3);
}
.note.err {
  color: var(--red);
}
.note .lg-btn {
  --lg-h: 24px;
  margin-left: 6px;
}
</style>
