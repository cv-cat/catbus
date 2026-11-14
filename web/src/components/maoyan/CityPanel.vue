<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MapPin, Search, X } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import { citySearchCache, searchCities } from '@/api/maoyan'
import { isAbort } from '@/api/client'
import type { Poi } from '@/api/types'
import { CITY, HOT_CITIES, readRecentCities } from '@/data/cities'

/**
 * 城市面板的内容（AGENTS.md 7.9「猫眼演出的城市」，设计稿 W1–W4）：搜索框，没输入时是最近选择和热门城市，
 * 有输入时是 `poi search` 的结果。桌面面板和手机底部弹层共用。
 */
const props = defineProps<{ current: string; sheet?: boolean }>()
const emit = defineEmits<{ pick: [name: string]; close: [] }>()
const { t } = useI18n()

const cache = citySearchCache
const DEBOUNCE_MS = 200

const input = ref<HTMLInputElement>()
const query = ref('')
const kw = computed(() => query.value.trim())
const results = shallowRef<Poi[]>([])
const loading = ref(false)
const failed = ref(false)
const active = ref(-1)
const composing = ref(false)
const recent = ref(readRecentCities())
const listId = `catbus-city-list-${Math.random().toString(36).slice(2, 8)}`

let timer = 0
let ctl: AbortController | null = null
let seq = 0

async function lookup(word: string) {
  const my = ++seq
  ctl?.abort()
  const hit = cache.get(word)
  if (hit) {
    results.value = hit
    loading.value = failed.value = false
    active.value = hit.length ? 0 : -1
    return
  }
  ctl = new AbortController()
  loading.value = true
  failed.value = false
  try {
    const env = await searchCities(word, null, ctl.signal)
    if (my !== seq) return
    if (!env.ok) return void (failed.value = true)
    const list = (env.data ?? []).filter((c) => CITY.test(c.name))
    cache.set(word, list)
    results.value = list
    active.value = list.length ? 0 : -1
  } catch (e) {
    if (my === seq && !isAbort(e)) failed.value = true
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(kw, (word) => {
  clearTimeout(timer)
  if (!word) {
    seq++
    ctl?.abort()
    results.value = []
    loading.value = failed.value = false
    active.value = -1
    return
  }
  // 输入法组合输入期间不请求（compositionend 时再触发）
  if (composing.value || !CITY.test(word)) return
  timer = window.setTimeout(() => void lookup(word), DEBOUNCE_MS)
})
function onCompositionEnd() {
  composing.value = false
  const word = kw.value
  clearTimeout(timer)
  if (word && CITY.test(word)) timer = window.setTimeout(() => void lookup(word), DEBOUNCE_MS)
}

function pick(name: string) {
  emit('pick', name)
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing || composing.value) return
  const n = results.value.length
  if (e.key === 'Escape') {
    if (props.sheet) return
    e.preventDefault()
    return emit('close')
  }
  if (!kw.value || !n) return
  if (e.key === 'ArrowDown') active.value = (active.value + 1) % n
  else if (e.key === 'ArrowUp') active.value = (active.value - 1 + n) % n
  else if (e.key === 'Enter') return pick(results.value[Math.max(0, active.value)]!.name)
  else return
  e.preventDefault()
  document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: 'nearest' })
}

onMounted(() => input.value?.focus({ preventScroll: true }))
onBeforeUnmount(() => {
  clearTimeout(timer)
  ctl?.abort()
})

/** 搜索结果里与输入相同的部分加粗 */
function split(name: string): [string, string, string] {
  const i = name.indexOf(kw.value)
  return i < 0 ? ['', '', name] : [name.slice(0, i), kw.value, name.slice(i + kw.value.length)]
}
</script>

<template>
  <div class="city-panel" :class="{ sheet }">
    <label class="c-search">
      <Search :size="16" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="text"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="search"
        maxlength="32"
        :placeholder="t('maoyan.city.search')"
        :aria-label="t('maoyan.city.search')"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="!!kw && results.length > 0"
        :aria-controls="listId"
        :aria-activedescendant="kw && active >= 0 ? `${listId}-${active}` : undefined"
        @keydown="onKey"
        @compositionstart="composing = true"
        @compositionend="onCompositionEnd"
      />
      <CatbusLoader v-if="loading" :size="14" />
      <button v-else-if="query" type="button" class="c-clear" :aria-label="t('maoyan.city.clear')" @click="query = ''; input?.focus()">
        <X :size="14" />
      </button>
    </label>

    <template v-if="!kw">
      <section v-if="recent.length" class="c-group">
        <h4>{{ t('maoyan.city.recent') }}</h4>
        <div class="c-grid">
          <button v-for="c in recent" :key="c" type="button" class="c-chip" :class="{ on: c === current }" :aria-pressed="c === current" @click="pick(c)">
            {{ c }}
          </button>
        </div>
      </section>
      <section class="c-group">
        <h4>{{ t('maoyan.city.hot') }}</h4>
        <div class="c-grid">
          <button v-for="c in HOT_CITIES" :key="c" type="button" class="c-chip" :class="{ on: c === current }" :aria-pressed="c === current" @click="pick(c)">
            {{ c }}
          </button>
        </div>
      </section>
    </template>
    <template v-else>
      <ul v-if="results.length" :id="listId" class="c-list" role="listbox" :aria-label="t('maoyan.city.results')">
        <li
          v-for="(c, i) in results"
          :id="`${listId}-${i}`"
          :key="c.id"
          role="option"
          class="c-opt"
          :class="{ hl: i === active, on: c.name === current }"
          :aria-selected="i === active"
          @mouseenter="active = i"
          @click="pick(c.name)"
        >
          <MapPin :size="14" aria-hidden="true" />
          <span><template v-for="(part, k) in split(c.name)" :key="k"><b v-if="k === 1">{{ part }}</b><template v-else>{{ part }}</template></template></span>
        </li>
      </ul>
      <div v-else-if="!loading" class="c-none">
        <span class="c-none-ico"><MapPin :size="16" aria-hidden="true" /></span>
        <strong>{{ failed ? t('maoyan.city.failed') : t('maoyan.city.noMatch', { kw }) }}</strong>
        <small v-if="!failed">{{ t('maoyan.city.noMatchHint') }}</small>
      </div>
    </template>
  </div>
</template>

<style scoped>
.city-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.c-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 12px;
  background: var(--hair);
  border: 1px solid transparent;
  color: var(--ink-3);
  transition: border-color 0.2s;
}
.c-search:focus-within {
  border-color: #e8414f80;
}
.c-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--ink);
}
.c-clear {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: var(--ink-3);
}
.c-clear:hover {
  background: var(--hair);
  color: var(--ink);
}
.c-group h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-3);
}
.c-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.c-chip {
  height: 34px;
  padding: 0 6px;
  border-radius: 17px;
  font-size: 13px;
  color: var(--ink);
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: transform 0.2s var(--ease-out), border-color 0.2s;
}
.c-chip:hover {
  transform: translateY(-1px);
  border-color: var(--ink-3);
}
.c-chip.on {
  color: var(--red);
  font-weight: 600;
  background: var(--red-soft);
  border-color: #e8414f66;
}
.c-list {
  list-style: none;
  margin: -4px 0 0;
  padding: 0;
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.c-opt {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
}
.c-opt svg {
  color: var(--ink-3);
}
.c-opt b {
  color: var(--red);
  font-weight: 700;
}
.c-opt.hl {
  background: var(--hair);
}
.c-opt.on {
  font-weight: 600;
}
.c-none {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 8px 10px;
  text-align: center;
}
.c-none-ico {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: 6px;
  border-radius: 50%;
  background: var(--hair);
  color: var(--ink-3);
}
.c-none strong {
  font-size: 14px;
  font-weight: 600;
}
.c-none small {
  font-size: 12px;
  color: var(--ink-3);
}

/* 手机底部弹层：搜索框高 44、字号 16（iOS 聚焦不放大），城市 chip 和结果行高 44 / 48（设计稿 W3） */
.sheet .c-search {
  height: 44px;
}
.sheet .c-search input {
  font-size: 16px;
}
.sheet .c-clear {
  width: 44px;
  height: 44px;
  margin-right: -12px;
}
.sheet .c-chip {
  height: 44px;
  border-radius: 22px;
  font-size: 14px;
}
.sheet .c-list {
  max-height: none;
}
.sheet .c-opt {
  height: 48px;
  font-size: 15px;
}
</style>
