<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Plus, Trash2 } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import GlassButton from '@/components/ui/GlassButton.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { keyOf, useLocalStore } from '@/stores/local'

/**
 * 加入分组菜单（AGENTS.md 7.9「本地收藏与稍后看」，设计稿 Z7）：全部分组多选、就地新建分组、从本地收藏移除。
 * 桌面和平板是贴着按钮的玻璃菜单，手机是底部弹层。全局只有一个，由 stores/local 的 menu 打开。
 */
const local = useLocalStore()
const bp = useBreakpoint()
const { t } = useI18n()

const target = computed(() => local.menu)
const entry = computed(() => (target.value ? local.entry(target.value.platform, target.value.item.id) : null))
const inGroup = (g: string) => Boolean(entry.value?.groups.includes(g))

const naming = ref(false)
const name = ref('')
const nameError = ref<string | null>(null)
const input = ref<HTMLInputElement>()
const root = ref<HTMLElement>()

watch(target, (v) => {
  naming.value = false
  name.value = ''
  nameError.value = null
  if (v && !bp.phone) void nextTick(() => root.value?.querySelector<HTMLElement>('.opt')?.focus())
})

function toggle(g: string) {
  const v = target.value
  if (v) local.toggleGroup(v.platform, v.item.id, g)
}
async function startNaming() {
  naming.value = true
  await nextTick()
  input.value?.focus()
}
function create() {
  const err = local.checkName(name.value)
  if (err) return void (nameError.value = err)
  const id = local.createGroup(name.value)
  if (id) toggle(id)
  naming.value = false
  name.value = ''
  nameError.value = null
}
function removeItem() {
  const v = target.value
  if (!v) return
  local.remove([keyOf(v.platform, v.item.id)])
  local.closeMenu()
}

/** 桌面：贴着按钮，下方放不下时向上，左右收进视口 */
const pos = computed(() => {
  const a = target.value?.anchor
  if (!a) return {}
  const w = 248
  const left = Math.min(Math.max(8, a.right - w), innerWidth - w - 8)
  const below = innerHeight - a.bottom > 320
  return below ? { left: `${left}px`, top: `${a.bottom + 6}px` } : { left: `${left}px`, bottom: `${innerHeight - a.top + 6}px` }
})

function onDown(e: PointerEvent) {
  if (target.value && !bp.phone && root.value && !root.value.contains(e.target as Node)) local.closeMenu()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && target.value && !bp.phone) {
    e.stopPropagation()
    local.closeMenu()
  }
}
const onScroll = (e: Event) => {
  if (target.value && !bp.phone && !root.value?.contains(e.target as Node)) local.closeMenu()
}
addEventListener('pointerdown', onDown, true)
addEventListener('keydown', onKey, true)
addEventListener('scroll', onScroll, true)
onBeforeUnmount(() => {
  removeEventListener('pointerdown', onDown, true)
  removeEventListener('keydown', onKey, true)
  removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <BottomSheet v-if="bp.phone" :open="!!target" :label="t('local.menu.title')" :z="70" @close="local.closeMenu()">
    <div class="sheet-body">
      <h2 class="sheet-title">{{ t('local.menu.title') }}</h2>
      <template v-for="g in local.allGroups" :key="g.id">
        <button type="button" class="opt" role="menuitemcheckbox" :aria-checked="inGroup(g.id)" @click="toggle(g.id)">
          <span class="box" :class="{ on: inGroup(g.id) }"><Check v-if="inGroup(g.id)" :size="13" :stroke-width="3" /></span>
          <span class="name">{{ g.name }}</span>
          <span class="n mono">{{ local.countOf(g.id) }}</span>
        </button>
      </template>
      <form v-if="naming" class="new" @submit.prevent="create">
        <input ref="input" v-model="name" :placeholder="t('local.group.namePlaceholder')" :maxlength="40" @input="nameError = null" />
        <GlassButton type="submit" tone="primary" class="ok">{{ t('common.action.save') }}</GlassButton>
      </form>
      <p v-if="nameError" class="err">{{ nameError }}</p>
      <button v-if="!naming" type="button" class="opt add" @click="startNaming"><Plus :size="16" />{{ t('local.group.create') }}</button>
      <button type="button" class="opt danger" @click="removeItem"><Trash2 :size="16" />{{ t('local.menu.remove') }}</button>
    </div>
  </BottomSheet>
  <Teleport v-else to="body">
    <Transition name="gm">
      <div v-if="target" ref="root" class="menu glass" role="menu" :aria-label="t('local.menu.title')" :style="pos">
        <div class="head">{{ t('local.menu.title') }}</div>
        <button
          v-for="g in local.allGroups"
          :key="g.id"
          type="button"
          class="opt"
          role="menuitemcheckbox"
          :aria-checked="inGroup(g.id)"
          @click="toggle(g.id)"
        >
          <span class="box" :class="{ on: inGroup(g.id) }"><Check v-if="inGroup(g.id)" :size="12" :stroke-width="3" /></span>
          <span class="name">{{ g.name }}</span>
          <span class="n mono">{{ local.countOf(g.id) }}</span>
        </button>
        <form v-if="naming" class="new" @submit.prevent="create">
          <input ref="input" v-model="name" :placeholder="t('local.group.namePlaceholder')" :maxlength="40" @input="nameError = null" @keydown.esc.stop="naming = false" />
          <GlassButton type="submit" tone="primary" class="ok">{{ t('common.action.save') }}</GlassButton>
        </form>
        <p v-if="nameError" class="err">{{ nameError }}</p>
        <button v-if="!naming" type="button" class="opt add" role="menuitem" @click="startNaming"><Plus :size="14" />{{ t('local.group.create') }}</button>
        <div class="sep" />
        <button type="button" class="opt danger" role="menuitem" @click="removeItem"><Trash2 :size="14" />{{ t('local.menu.remove') }}</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 70;
  width: 248px;
  max-height: min(420px, 80dvh);
  overflow-y: auto;
  padding: 6px;
  border-radius: 14px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(30px) saturate(1.6);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.head {
  padding: 6px 10px 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}
.opt:hover,
.opt:focus-visible {
  background: var(--lg-fill-hover);
  box-shadow: var(--lg-edge);
  outline: none;
}
.box {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  border: 1.5px solid var(--ink-3);
  color: #fff;
}
.box.on {
  background: var(--red);
  border-color: var(--red);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.n {
  font-size: 12px;
  color: var(--ink-3);
}
.add {
  color: var(--ink-2);
}
.danger {
  color: var(--red);
}
.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--hair);
}
.new {
  display: flex;
  gap: 6px;
  padding: 4px 4px 2px;
}
.new input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  border: 1px solid var(--hair);
  background: var(--glass);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}
.new input:focus {
  outline: none;
  border-color: var(--red);
}
.ok {
  font-weight: 600;
}
.err {
  margin: 2px 10px 4px;
  font-size: 12px;
  color: var(--red);
}
.gm-enter-active,
.gm-leave-active {
  transition: opacity 0.16s, transform 0.2s var(--ease-out);
}
.gm-enter-from,
.gm-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
/* 手机：底部弹层，行高 52 */
.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 12px calc(12px + var(--safe-bottom));
}
.sheet-title {
  margin: 4px 8px 10px;
  font-size: 16px;
  font-weight: 600;
}
.sheet-body .opt {
  min-height: 52px;
  font-size: 16px;
}
.sheet-body .new input {
  height: 44px;
  font-size: 16px;
}
.sheet-body .ok {
  --lg-h: 44px;
  font-size: 16px;
}
</style>
