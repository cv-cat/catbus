<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ArrowRight, Search } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import SearchSuggest from '@/components/SearchSuggest.vue'
import { gsap, prefersReducedMotion } from '@/composables/motion'

const props = withDefaults(
  defineProps<{ placeholder?: string; loading?: boolean; compact?: boolean; hotkey?: boolean; inputId?: string }>(),
  { hotkey: true, inputId: 'catbus-search' },
)
const emit = defineEmits<{ submit: [origin: { x: number; y: number }] }>()
const model = defineModel<string>({ required: true })

const input = ref<HTMLInputElement>()
const go = ref<HTMLButtonElement>()
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

// 搜索联想与热搜（AGENTS.md 7.9）：面板在 SearchSuggest 里，这里只转交焦点、输入法状态和按键
const form = ref<HTMLFormElement>()
const sug = ref<InstanceType<typeof SearchSuggest>>()
const focused = ref(false)
const composing = ref(false)

function onInputKey(e: KeyboardEvent) {
  // 输入法组合输入中：Enter 是上屏，不提交
  if (e.key === 'Enter' && (e.isComposing || composing.value || e.keyCode === 229)) {
    e.preventDefault()
    return
  }
  sug.value?.onKey(e)
}

/** 点选或 Enter 选中联想 / 热搜：填进输入框并照常提交 */
async function pickSuggestion(text: string) {
  model.value = text
  await nextTick()
  submit()
}

function submit() {
  sug.value?.close()
  if (props.loading) return
  const r = go.value!.getBoundingClientRect()
  if (!prefersReducedMotion()) {
    gsap.fromTo(go.value!, { scale: 0.86 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' })
  }
  emit('submit', { x: r.left + r.width / 2, y: r.top + r.height / 2 })
}

function onKey(e: KeyboardEvent) {
  if (!props.hotkey) return
  // 按物理键位判断：中文输入法或其他键盘布局下 e.key 不一定是 'k'
  if ((isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    input.value?.focus()
    input.value?.select()
  }
}
// 捕获阶段监听：不被页面里其他按键处理吞掉
onMounted(() => addEventListener('keydown', onKey, true))
onBeforeUnmount(() => removeEventListener('keydown', onKey, true))
</script>

<template>
  <form ref="form" class="search glass" :class="{ compact }" role="search" @submit.prevent="submit">
    <Search class="lead" :size="compact ? 16 : 18" aria-hidden="true" />
    <label class="sr-only" :for="inputId">搜索</label>
    <input
      :id="inputId"
      ref="input"
      v-model="model"
      type="search"
      autocomplete="off"
      :placeholder="placeholder ?? '搜索'"
      enterkeyhint="search"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="!!sug?.visible"
      :aria-controls="sug?.visible ? sug.listboxId : undefined"
      :aria-activedescendant="sug?.activeId"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onInputKey"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <kbd v-if="!compact" class="mono">{{ isMac ? '⌘' : 'Ctrl' }} K</kbd>
    <button ref="go" class="go" type="submit" :aria-label="loading ? '搜索中' : '搜索'" :disabled="loading">
      <CatbusLoader v-if="loading" :size="16" label="搜索中" />
      <ArrowRight v-else :size="16" />
    </button>
    <SearchSuggest
      ref="sug"
      :anchor="form"
      :query="model"
      :open="focused"
      :composing="composing"
      :input-id="inputId"
      @pick="pickSuggestion"
    />
  </form>
</template>

<style scoped>
.search {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 7px 0 16px;
  border-radius: 24px;
  box-shadow: 0 8px 30px #1b1f2e12;
  transition: box-shadow 0.3s, border-color 0.3s;
}
.search:focus-within {
  border-color: #e8414f66;
  box-shadow: 0 8px 30px #1b1f2e12, 0 0 0 4px var(--red-soft);
}
.lead {
  color: var(--ink-2);
  flex: none;
}
input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  outline: none;
  font-size: 15px;
}
input::placeholder {
  color: var(--ink-3);
}
input::-webkit-search-cancel-button {
  display: none;
}
kbd {
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--hair);
  font-size: 11px;
  color: var(--ink-2);
}
.go {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--primary-btn);
  color: #fff;
  flex: none;
  transition: background 0.4s;
}
.go:disabled {
  cursor: progress;
}
[data-theme='dark'] .go {
  --catbus-loader-accent: var(--navy);
}
.search.compact {
  height: 38px;
  padding: 0 4px 0 12px;
  gap: 8px;
  border-radius: 19px;
  box-shadow: 0 4px 16px #1b1f2e0f;
}
.search.compact input {
  font-size: 14px;
}
.search.compact .go {
  width: 30px;
  height: 30px;
}
/* 触屏没有快捷键提示；手机上稍矮一点 */
@media (hover: none) and (pointer: coarse) {
  kbd {
    display: none;
  }
}
@media (max-width: 640px) {
  .search:not(.compact) {
    height: 46px;
    padding: 0 6px 0 14px;
    gap: 8px;
  }
  .search:not(.compact) .go {
    width: 36px;
    height: 36px;
  }
}
</style>
