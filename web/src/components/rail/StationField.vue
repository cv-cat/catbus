<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CornerDownLeft, MapPin, Search } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import CatbusLoader from '@/components/CatbusLoader.vue'
import type { Station } from '@/api/types'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useRailStore, type StationField } from '@/stores/rail'

/**
 * 车站框（AGENTS.md 7.9「12306 查询页」「表单」，设计稿 V5 的车站联想）：
 * 桌面是输入框加下方的联想面板（listbox），手机点框打开底部弹层输入。
 * 输入停 200ms 用 station search 联想，只采用最后一次的结果；输入法组合输入期间不请求。
 */
const props = defineProps<{ label: string; sheetTitle: string; shake?: number }>()
const model = defineModel<StationField>({ required: true })
const emit = defineEmits<{ picked: []; enter: [] }>()

const { t } = useI18n()
const rail = useRailStore()
const bp = useBreakpoint()
const id = useId()

const text = ref(model.value.name)
watch(
  () => model.value.name,
  (v) => {
    if (v !== text.value) text.value = v
  },
)

const open = ref(false)
const list = ref<Station[]>([])
const loading = ref(false)
const cursor = ref(-1)
let timer: ReturnType<typeof setTimeout> | undefined
let composing = false

async function lookup(kw: string) {
  if (!kw.trim()) {
    list.value = []
    loading.value = false
    return
  }
  loading.value = true
  const got = await rail.suggest(kw)
  // 被更新的请求取代，或输入已经变了：不采用
  if (got === null || kw !== text.value) return
  list.value = got
  loading.value = false
  cursor.value = got.length ? 0 : -1
}

function onInput() {
  // 改了字：电报码不再对应
  model.value = { name: text.value, code: null }
  open.value = true
  if (composing) return
  clearTimeout(timer)
  timer = setTimeout(() => void lookup(text.value), 200)
}

function onCompositionEnd() {
  composing = false
  onInput()
}

function pick(s: Station) {
  text.value = s.name
  model.value = { name: s.name, code: s.code }
  close()
  emit('picked')
}

function close() {
  open.value = false
  sheetOpen.value = false
  cursor.value = -1
}

function onKey(e: KeyboardEvent) {
  if (composing || e.isComposing) return
  const n = list.value.length
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open.value) open.value = true
    if (!n) return
    e.preventDefault()
    cursor.value = (cursor.value + (e.key === 'ArrowDown' ? 1 : n - 1) + (cursor.value < 0 && e.key === 'ArrowUp' ? 1 : 0)) % n
  } else if (e.key === 'Enter') {
    if (open.value && cursor.value >= 0 && list.value[cursor.value]) {
      e.preventDefault()
      pick(list.value[cursor.value]!)
    } else {
      close()
      emit('enter')
    }
  } else if (e.key === 'Escape' && open.value) {
    e.preventDefault()
    e.stopPropagation()
    close()
  }
}

/** 拼音、站名里与输入相同的前缀加粗 */
function split(value: string, kw: string): [string, string] {
  const q = kw.trim().toLowerCase()
  return q && value.toLowerCase().startsWith(q) ? [value.slice(0, q.length), value.slice(q.length)] : ['', value]
}

const showPanel = computed(() => open.value && !bp.phone && text.value.trim().length > 0)
const optionId = (i: number) => `${id}-opt-${i}`

// ---------- 手机：底部弹层 ----------
const sheetOpen = ref(false)
const sheetInput = ref<HTMLInputElement>()
function openSheet() {
  sheetOpen.value = true
  open.value = true
  if (text.value.trim()) void lookup(text.value)
  void nextTick(() => sheetInput.value?.select())
}

// 失去焦点（点了面板外）：等点击先落到选项上再收起
function onBlur() {
  setTimeout(() => {
    if (!bp.phone) open.value = false
  }, 120)
}

// 「查询」时空着：抖一下并聚焦
const box = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
watch(
  () => props.shake,
  () => {
    box.value?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], {
      duration: 360,
      easing: 'ease-out',
    })
    if (bp.phone) openSheet()
    else input.value?.focus()
  },
)

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div ref="box" class="field" :class="{ focus: open && !bp.phone }">
    <label v-if="!bp.phone" class="label" :for="id">{{ label }}</label>
    <span v-else class="label">{{ label }}</span>
    <div class="row">
      <input
        v-if="!bp.phone"
        :id="id"
        ref="input"
        v-model="text"
        class="input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('rail.form.placeholder')"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showPanel"
        :aria-controls="`${id}-list`"
        :aria-activedescendant="showPanel && cursor >= 0 ? optionId(cursor) : undefined"
        @input="onInput"
        @focus="text.trim() && (open = true) && lookup(text)"
        @blur="onBlur"
        @keydown="onKey"
        @compositionstart="composing = true"
        @compositionend="onCompositionEnd"
      />
      <button v-else type="button" class="input as-btn" :class="{ empty: !text }" :aria-label="`${label} ${text}`" @click="openSheet">
        {{ text || t('rail.form.placeholder') }}
      </button>
      <span v-if="model.code && !bp.phone" class="code mono">{{ model.code }}</span>
    </div>

    <Transition name="pop">
      <div v-if="showPanel" class="panel glass" @mousedown.prevent>
        <div class="head">
          <span class="head-title"><MapPin :size="13" />{{ t('rail.form.stations') }}</span>
          <span v-if="loading" class="head-n"><CatbusLoader :size="12" /></span>
          <span v-else class="head-n">{{ t('rail.form.results', { n: list.length }, list.length) }}</span>
        </div>
        <ul :id="`${id}-list`" class="options" role="listbox" :aria-label="label">
          <li
            v-for="(s, i) in list"
            :id="optionId(i)"
            :key="s.code"
            role="option"
            :aria-selected="i === cursor"
            class="opt"
            :class="{ on: i === cursor }"
            @mouseenter="cursor = i"
            @click="pick(s)"
          >
            <span class="opt-name"><b>{{ split(s.name, text)[0] }}</b>{{ split(s.name, text)[1] }}</span>
            <span class="opt-py mono"><b>{{ split(s.pinyin, text)[0] }}</b>{{ split(s.pinyin, text)[1] }}</span>
            <span class="opt-city">{{ s.city }}</span>
            <span class="opt-code mono">{{ s.code }}</span>
            <CornerDownLeft v-if="i === cursor" :size="13" class="opt-enter" aria-hidden="true" />
          </li>
        </ul>
        <p v-if="!loading && !list.length" class="none">{{ t('rail.form.noMatch') }}</p>
        <div class="keys mono" aria-hidden="true">{{ t('rail.form.keys') }}</div>
      </div>
    </Transition>

    <BottomSheet v-if="bp.phone" :open="sheetOpen" :label="sheetTitle" @close="close">
      <div class="sheet">
        <h2 class="sheet-title">{{ sheetTitle }}</h2>
        <label class="sheet-search">
          <Search :size="17" aria-hidden="true" />
          <input
            ref="sheetInput"
            v-model="text"
            type="text"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="search"
            :placeholder="t('rail.form.placeholder')"
            :aria-label="sheetTitle"
            role="combobox"
            aria-autocomplete="list"
            :aria-controls="`${id}-sheet`"
            :aria-expanded="list.length > 0"
            @input="onInput"
            @keydown="onKey"
            @compositionstart="composing = true"
            @compositionend="onCompositionEnd"
          />
          <CatbusLoader v-if="loading" :size="14" />
        </label>
        <ul :id="`${id}-sheet`" class="sheet-list" role="listbox" :aria-label="sheetTitle">
          <li
            v-for="(s, i) in list"
            :key="s.code"
            role="option"
            :aria-selected="i === cursor"
            class="sheet-opt"
            :class="{ on: i === cursor }"
            @click="pick(s)"
          >
            <span class="opt-name">{{ s.name }}</span>
            <span class="opt-city">{{ s.city }}</span>
            <span class="opt-code mono">{{ s.code }}</span>
          </li>
        </ul>
        <p v-if="text.trim() && !loading && !list.length" class="none">{{ t('rail.form.noMatch') }}</p>
        <button v-if="text.trim()" type="button" class="sheet-use" @click="close(); emit('picked')">
          {{ t('rail.form.useText', { name: text.trim() }) }}
        </button>
      </div>
    </BottomSheet>
  </div>
</template>

<style scoped>
.field {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 16px 10px;
  border-radius: var(--radius-md);
  background: var(--glass-strong);
  border: 1.5px solid transparent;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.field.focus,
.field:focus-within {
  border-color: var(--red);
  box-shadow: 0 0 0 4px var(--red-soft);
}
.label {
  font-size: 11px;
  color: var(--ink-3);
}
.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.2px;
  text-align: left;
}
.input::placeholder,
.as-btn.empty {
  color: var(--ink-3);
  font-size: 15px;
  font-weight: 500;
}
.as-btn {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.code {
  flex: none;
  font-size: 11px;
  color: var(--ink-3);
}

/* ---------- 联想面板 ---------- */
.panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: max(100%, 340px);
  z-index: 20;
  padding: 8px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--detail-bg) 92%, transparent);
  box-shadow: var(--shadow-panel), 0 18px 44px #1b1f2e1f;
  backdrop-filter: blur(30px) saturate(1.6);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.head-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-2);
  font-weight: 600;
}
.head-title svg {
  color: var(--red);
}
.options,
.sheet-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.opt {
  display: grid;
  grid-template-columns: auto 1fr auto 40px 16px;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 8px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13.5px;
}
.opt.on {
  background: var(--hair);
}
.opt-name {
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}
.opt-name b,
.opt-py b {
  color: var(--red);
  font-weight: 700;
}
.opt-py {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--ink-3);
}
.opt-city {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
}
.opt-code {
  font-size: 11px;
  color: var(--ink-3);
  text-align: right;
}
.opt-enter {
  color: var(--ink-3);
}
.none {
  margin: 6px 8px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.keys {
  margin-top: 6px;
  padding: 8px 8px 2px;
  border-top: 1px solid var(--hair);
  font-size: 10.5px;
  color: var(--ink-3);
}
.pop-enter-active {
  transition: opacity 0.18s ease-out, transform 0.22s var(--ease-out);
}
.pop-leave-active {
  transition: opacity 0.12s ease-in;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ---------- 手机：底部弹层 ---------- */
.sheet {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 6px 16px calc(16px + var(--safe-bottom));
}
.sheet-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.sheet-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 14px;
  border-radius: 23px;
  border: 1.5px solid var(--red);
  box-shadow: 0 0 0 4px var(--red-soft);
  color: var(--ink-2);
}
.sheet-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 16px;
}
.sheet-opt {
  display: grid;
  grid-template-columns: 1fr auto 44px;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0 10px;
  border-radius: 12px;
  font-size: 15px;
}
.sheet-opt.on,
.sheet-opt:active {
  background: var(--hair);
}
.sheet-use {
  height: 44px;
  border-radius: 22px;
  background: var(--hair);
  color: var(--ink);
  font-size: 14px;
}
@media (max-width: 640px) {
  .field {
    padding: 10px 14px;
  }
  .input {
    font-size: 19px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: none;
  }
}
</style>
