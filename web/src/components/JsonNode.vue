<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from 'lucide-vue-next'

/**
 * 原始 JSON 树的一个节点（RawJsonView 用）：对象 / 数组可折叠，叶子按类型着色。
 * expandTo / version：父组件「全部展开 / 全部折叠」时改 version，节点按 depth < expandTo 重设开合。
 */
defineOptions({ name: 'JsonNode' })
const props = defineProps<{ name?: string | number; value: unknown; depth: number; expandTo: number; version: number; last?: boolean }>()

const { t } = useI18n()
const isArr = computed(() => Array.isArray(props.value))
const isObj = computed(() => props.value !== null && typeof props.value === 'object')
const entries = computed<[string | number, unknown][]>(() =>
  !isObj.value ? [] : isArr.value ? (props.value as unknown[]).map((v, i) => [i, v]) : Object.entries(props.value as object),
)
const open = ref(props.depth < props.expandTo)
watch(
  () => props.version,
  () => (open.value = props.depth < props.expandTo),
)
const brackets = computed(() => (isArr.value ? ['[', ']'] : ['{', '}']))
const summary = computed(() => {
  const n = entries.value.length
  return isArr.value ? t('detail.json.items', { n }, n) : t('detail.json.fields', { n }, n)
})
const leaf = computed(() => {
  const v = props.value
  if (v === null) return { cls: 'null', text: 'null' }
  if (typeof v === 'string') return { cls: 'str', text: JSON.stringify(v) }
  if (typeof v === 'number') return { cls: 'num', text: String(v) }
  if (typeof v === 'boolean') return { cls: 'bool', text: String(v) }
  return { cls: 'null', text: String(v) }
})
const keyText = computed(() => (props.name === undefined ? null : typeof props.name === 'number' ? String(props.name) : JSON.stringify(props.name)))
</script>

<template>
  <div class="node" :style="{ '--d': depth }">
    <div class="line">
      <button v-if="isObj && entries.length" class="tog" type="button" :aria-expanded="open" :aria-label="open ? t('detail.json.collapse') : t('detail.json.expand')" @click="open = !open">
        <ChevronRight :size="12" :class="{ rot: open }" aria-hidden="true" />
      </button>
      <span v-else class="tog-space" aria-hidden="true" />
      <span v-if="keyText !== null" class="key" :class="{ idx: typeof name === 'number' }">{{ keyText }}</span><span v-if="keyText !== null" class="punc">: </span>
      <template v-if="isObj">
        <span class="punc">{{ brackets[0] }}</span>
        <template v-if="!entries.length"><span class="punc">{{ brackets[1] }}</span></template>
        <button v-else-if="!open" class="more" type="button" @click="open = true">{{ summary }}</button>
        <span v-if="!open && entries.length" class="punc">{{ brackets[1] }}</span>
      </template>
      <span v-else :class="['leaf', leaf.cls]">{{ leaf.text }}</span><span v-if="!last && (!isObj || !open || !entries.length)" class="punc">,</span>
    </div>
    <template v-if="isObj && open && entries.length">
      <JsonNode
        v-for="([k, v], i) in entries"
        :key="k"
        :name="k"
        :value="v"
        :depth="depth + 1"
        :expand-to="expandTo"
        :version="version"
        :last="i === entries.length - 1"
      />
      <div class="line close"><span class="tog-space" aria-hidden="true" /><span class="punc">{{ brackets[1] }}</span><span v-if="!last" class="punc">,</span></div>
    </template>
  </div>
</template>

<style scoped>
.node {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
}
.node .node {
  padding-left: 14px;
  border-left: 1px solid var(--hair);
  margin-left: 6px;
}
.line {
  display: flex;
  align-items: baseline;
  min-width: 0;
}
.key,
.punc {
  flex: none;
}
.tog,
.tog-space {
  flex: none;
  width: 16px;
  height: 16px;
  align-self: center;
}
.tog {
  display: grid;
  place-items: center;
  padding: 0;
  margin: 0 2px 0 -2px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}
.tog:hover {
  color: var(--red);
  background: var(--hair);
}
.tog svg {
  transition: transform 0.18s var(--ease-out);
}
.tog svg.rot {
  transform: rotate(90deg);
}
.tog-space {
  margin: 0 2px 0 -2px;
}
.key {
  color: var(--ink);
  font-weight: 600;
}
.key.idx {
  color: var(--ink-3);
  font-weight: 400;
}
.punc {
  color: var(--ink-3);
  white-space: pre;
}
.leaf {
  flex: 0 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.str {
  color: color-mix(in srgb, #1f8a5b 85%, var(--ink));
}
.num {
  color: color-mix(in srgb, #3b6fd8 85%, var(--ink));
}
.bool {
  color: var(--red);
}
.null {
  color: var(--ink-3);
  font-style: italic;
}
:global([data-theme='dark']) .str {
  color: #6fd3a0;
}
:global([data-theme='dark']) .num {
  color: #8fb2ff;
}
.more {
  margin: 0 4px;
  padding: 0 7px;
  border: none;
  border-radius: 999px;
  font: inherit;
  font-size: 11px;
  color: var(--ink-2);
  background: var(--hair);
  cursor: pointer;
}
.more:hover {
  color: var(--red);
}
</style>
