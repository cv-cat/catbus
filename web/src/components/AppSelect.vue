<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import BottomSheet from '@/components/BottomSheet.vue'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { flashTip } from '@/directives/tip'

/**
 * 公共下拉列表（设计稿 U / U2 / U3），WebUI 里不用原生 <select>。
 * - 桌面 / 平板：玻璃胶囊触发器 + 传送到 body 的玻璃菜单（fixed 定位，与触发器左对齐、宽度不小于触发器，
 *   下方放不下时向上弹出）；超过 8 项时内部滚动，底部渐隐提示还有内容。
 * - 手机（≤ 640px）：点触发器打开底部弹层（BottomSheet），标题取 title，选项高 52。
 * - 键盘（APG 的 select-only combobox）：焦点一直在触发器上，↓ / ↑ / Enter / 空格打开，
 *   菜单里 ↑ ↓ 循环（跳过置灰项）、Home / End、Enter / 空格选中、Esc 收起、Tab 收起并移走焦点，打字跳到首字母匹配的项。
 * - options[].disabled 为不能选的原因：置灰，悬停用 tooltip 说明（触屏点按时闪现）。
 * - options[].logo（图片地址）/ icon（lucide 组件）是前缀；divider 在这一项后面画分隔线。
 */
export interface SelectOption<V> {
  value: V
  label: string
  logo?: string
  icon?: Component
  disabled?: string | null
  divider?: boolean
  /** 分组标题：不能选、键盘跳过，只用来给后面的选项分组（如 M-Team 分类按大类分组） */
  header?: boolean
}

const props = defineProps<{
  options: readonly SelectOption<T>[]
  /** 手机底部弹层的标题、说明（一般就是设置项的标题和说明） */
  title?: string
  desc?: string
  placeholder?: string
  labelledby?: string
  describedby?: string
  /** 没有 labelledby 时的无障碍名称 */
  label?: string
  disabled?: boolean
}>()
const model = defineModel<T>({ required: true })
const { t } = useI18n()
const bp = useBreakpoint()

const MENU_MIN = 188
const MENU_MAX_H = 340
const GAP = 8
const EDGE = 8

const uid = useId()
const listId = `${uid}-list`
const optId = (i: number) => `${uid}-opt-${i}`

const trigger = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
const sheetOpen = ref(false)
const active = ref(-1)
const up = ref(false)
const pos = ref({ top: 0, left: 0, width: MENU_MIN })
const more = ref(false)
/** 上面还有内容（已经往下滚过） */
const less = ref(false)

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value))
const current = computed(() => props.options[selectedIndex.value])
const expanded = computed(() => open.value || sheetOpen.value)

// ---------- 定位 ----------
function place() {
  const r = trigger.value?.getBoundingClientRect()
  if (!r) return
  const width = Math.max(MENU_MIN, Math.round(r.width))
  const left = Math.max(EDGE, Math.min(r.left, innerWidth - width - EDGE))
  const h = menu.value?.offsetHeight ?? Math.min(MENU_MAX_H, props.options.length * 38 + 12)
  const below = innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  up.value = h > below && above > below
  pos.value = { top: up.value ? Math.max(EDGE, r.top - GAP - h) : r.bottom + GAP, left, width }
}

function enabledIndex(from: number, step: 1 | -1): number {
  const n = props.options.length
  for (let i = 1; i <= n; i++) {
    const k = (((from + step * i) % n) + n) % n
    if (!props.options[k]!.disabled && !props.options[k]!.header) return k
  }
  return from
}

/** center：刚打开时让选中项落在中间；之后键盘移动用 nearest */
function scrollActive(block: ScrollLogicalPosition = 'nearest') {
  if (active.value < 0) return
  document.getElementById(optId(active.value))?.scrollIntoView({ block })
}
function onMenuScroll() {
  const m = menu.value
  more.value = !!m && m.scrollTop + m.clientHeight < m.scrollHeight - 2
  less.value = !!m && m.scrollTop > 2
}

async function show() {
  if (props.disabled || expanded.value) return
  active.value = selectedIndex.value >= 0 && !current.value?.disabled ? selectedIndex.value : enabledIndex(-1, 1)
  if (bp.phone) {
    sheetOpen.value = true
    return
  }
  place()
  open.value = true
  await nextTick()
  // 菜单渲染后按真实高度再定一次位（决定是否向上弹出）
  place()
  scrollActive('center')
  onMenuScroll()
}

function close(returnFocus = false) {
  if (!expanded.value) return
  open.value = false
  sheetOpen.value = false
  active.value = -1
  if (returnFocus) trigger.value?.focus({ preventScroll: true })
}

function toggle() {
  if (props.disabled) return
  expanded.value ? close() : void show()
}

function choose(i: number, e?: Event) {
  const o = props.options[i]
  if (!o || o.header) return
  if (o.disabled) return flashTip(e?.currentTarget ?? null)
  model.value = o.value
  close(true)
}

// ---------- 打字跳转 ----------
let typed = ''
let typedTimer: ReturnType<typeof setTimeout> | undefined
function typeahead(ch: string) {
  clearTimeout(typedTimer)
  typed += ch.toLocaleLowerCase()
  typedTimer = setTimeout(() => (typed = ''), 500)
  const n = props.options.length
  // 同一个字符连按：在以它开头的项之间轮换
  const same = typed.length > 1 && [...typed].every((c) => c === typed[0])
  const q = same ? typed[0]! : typed
  const start = same || typed.length === 1 ? active.value + 1 : Math.max(0, active.value)
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    const o = props.options[i]!
    if (!o.disabled && !o.header && o.label.toLocaleLowerCase().startsWith(q)) {
      active.value = i
      return true
    }
  }
  return false
}

function onKey(e: KeyboardEvent) {
  if (props.disabled || e.isComposing) return
  if (bp.phone) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      void show()
    }
    return
  }
  const n = props.options.length
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      void show()
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // 收起时打字：直接选中匹配的项（与原生 select 一致）
      active.value = selectedIndex.value
      if (typeahead(e.key)) model.value = props.options[active.value]!.value
      active.value = -1
    }
    return
  }
  if (e.key === 'ArrowDown') active.value = enabledIndex(active.value, 1)
  else if (e.key === 'ArrowUp') active.value = enabledIndex(active.value < 0 ? n : active.value, -1)
  else if (e.key === 'Home') active.value = enabledIndex(-1, 1)
  else if (e.key === 'End') active.value = enabledIndex(n, -1)
  else if (e.key === 'Enter' || (e.key === ' ' && !typed)) choose(active.value)
  else if (e.key === 'Tab') return close()
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) typeahead(e.key)
  else return
  e.preventDefault()
}
watch(active, () => open.value && void nextTick(() => scrollActive()))

// ---------- 点外面、滚动、缩放时收起 ----------
function onOutside(e: PointerEvent) {
  const el = e.target as Node
  if (trigger.value?.contains(el) || menu.value?.contains(el)) return
  close()
}
function onScroll(e: Event) {
  if (menu.value?.contains(e.target as Node)) return
  close()
}
const onResize = () => close()
/**
 * Esc 在 window 的捕获阶段处理（Safari 点按钮不给焦点，keydown 不一定落在触发器上）。
 * 外层 BottomSheet 看到 [data-esc-layer] 时不关自己，所以这次 Esc 只收菜单。
 */
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.stopPropagation()
  e.preventDefault()
  close(true)
}
function bind(on: boolean) {
  const fn = on ? addEventListener : removeEventListener
  fn('pointerdown', onOutside as EventListener, true)
  fn('scroll', onScroll, true)
  fn('resize', onResize)
  fn('keydown', onEsc as EventListener, true)
}
watch(open, bind)
onBeforeUnmount(() => {
  bind(false)
  clearTimeout(typedTimer)
})

// 出现 0.18s expo.out（y ∓4、scale 0.98 → 1），消失 0.12s power2.in；减少动效时只淡入淡出
function enter(el: Element, done: () => void) {
  if (prefersReducedMotion()) return void gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, onComplete: done })
  gsap.fromTo(
    el,
    { opacity: 0, y: up.value ? 4 : -4, scale: 0.98, transformOrigin: up.value ? 'bottom left' : 'top left' },
    { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'expo.out', onComplete: done },
  )
}
function leave(el: Element, done: () => void) {
  gsap.to(el, { opacity: 0, duration: prefersReducedMotion() ? 0.08 : 0.12, ease: 'power2.in', onComplete: done })
}
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="sel glass"
    :class="{ open: expanded, disabled }"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="expanded"
    :aria-controls="open ? listId : undefined"
    :aria-activedescendant="open && active >= 0 ? optId(active) : undefined"
    :aria-labelledby="labelledby"
    :aria-describedby="describedby"
    :aria-label="labelledby ? undefined : label ?? title"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="toggle"
    @keydown="onKey"
  >
    <img v-if="current?.logo" class="logo" :src="current.logo" alt="" />
    <component :is="current.icon" v-else-if="current?.icon" class="ico" :size="16" aria-hidden="true" />
    <span class="val" :class="{ ph: !current }">{{ current?.label ?? placeholder ?? t('common.select.placeholder') }}</span>
    <ChevronDown class="chev" :size="15" aria-hidden="true" />
  </button>

  <!-- 桌面 / 平板：浮层菜单 -->
  <Teleport to="body">
    <Transition :css="false" @enter="enter" @leave="leave">
      <div
        v-if="open"
        :id="listId"
        ref="menu"
        class="sel-menu"
        data-esc-layer
        :class="{ more, less }"
        role="listbox"
        :aria-labelledby="labelledby"
        :aria-label="labelledby ? undefined : label ?? title"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }"
        @scroll.passive="onMenuScroll"
        @pointerdown.prevent
      >
        <template v-for="(o, i) in options" :key="String(o.value)">
          <div v-if="o.header" class="group" role="presentation">{{ o.label }}</div>
          <div
            v-else
            :id="optId(i)"
            v-tip.right="o.disabled"
            class="opt"
            :class="{ checked: o.value === model, hl: i === active, disabled: !!o.disabled }"
            role="option"
            :aria-selected="o.value === model"
            :aria-disabled="o.disabled ? 'true' : undefined"
            @mouseenter="!o.disabled && (active = i)"
            @click="choose(i, $event)"
          >
            <img v-if="o.logo" class="logo" :src="o.logo" alt="" />
            <component :is="o.icon" v-else-if="o.icon" class="ico" :size="16" aria-hidden="true" />
            <span class="label">{{ o.label }}</span>
            <Check v-if="o.value === model" class="check" :size="14" aria-hidden="true" />
          </div>
          <div v-if="o.divider" class="divider" role="separator" />
        </template>
      </div>
    </Transition>
  </Teleport>

  <!-- 手机：底部弹层 -->
  <BottomSheet
    v-if="bp.phone"
    :open="sheetOpen"
    :label="title ?? label ?? ''"
    :z="70"
    @close="close(true)"
  >
    <div class="sheet">
      <header v-if="title || desc" class="sheet-head">
        <div v-if="title" class="sheet-title">{{ title }}</div>
        <p v-if="desc" class="sheet-desc">{{ desc }}</p>
      </header>
      <div class="sheet-list" role="listbox" :aria-label="title ?? label">
        <template v-for="(o, i) in options" :key="String(o.value)">
          <div v-if="o.header" class="group big" role="presentation">{{ o.label }}</div>
          <button
            v-else
            type="button"
            class="opt big"
            :class="{ checked: o.value === model, disabled: !!o.disabled }"
            role="option"
            :aria-selected="o.value === model"
            :aria-disabled="o.disabled ? 'true' : undefined"
            @click="choose(i, $event)"
          >
            <img v-if="o.logo" class="logo" :src="o.logo" alt="" />
            <component :is="o.icon" v-else-if="o.icon" class="ico" :size="18" aria-hidden="true" />
            <span class="label">{{ o.label }}</span>
            <Check v-if="o.value === model" class="check" :size="18" aria-hidden="true" />
          </button>
          <div v-if="o.divider" class="divider" role="separator" />
        </template>
      </div>
    </div>
  </BottomSheet>
</template>

<style scoped>
/* ---------- 触发器 ---------- */
.sel {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  max-width: 240px;
  height: 36px;
  padding: 0 10px 0 14px;
  border-radius: var(--radius-md);
  border: 1px solid var(--glass-stroke);
  font: inherit;
  font-size: 13px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s, background 0.2s;
}
.sel:hover:not(.disabled) {
  box-shadow: 0 4px 14px #1b1f2e1c;
}
.sel:focus-visible {
  outline: 2px solid var(--red);
  outline-offset: 2px;
}
.sel.open {
  background: var(--glass-strong);
  border-color: #e8414f66;
}
.val {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.val.ph {
  color: var(--ink-3);
}
.chev {
  flex: none;
  color: var(--ink-2);
  transition: transform 0.2s var(--ease-out), color 0.2s;
}
.sel.open .chev {
  transform: rotate(180deg);
  color: var(--red);
}
.sel.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.logo {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  object-fit: cover;
}
.ico {
  flex: none;
  color: var(--ink-2);
}

/* ---------- 浮层菜单（与时间筛选 R 同一套样式） ---------- */
.sel-menu {
  position: fixed;
  z-index: 80;
  max-height: 340px;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* 高亮项滚到可见时让开上下的渐隐区 */
  scroll-padding: 28px 0 40px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: 16px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 16px 40px #1b1f2e1a;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 20%, transparent) transparent;
}
/* 上 / 下还有内容：对应的边渐隐 */
.sel-menu.more {
  mask-image: linear-gradient(to bottom, #000 calc(100% - 40px), transparent);
}
.sel-menu.less {
  mask-image: linear-gradient(to top, #000 calc(100% - 28px), transparent);
}
.sel-menu.more.less {
  mask-image: linear-gradient(to bottom, transparent, #000 28px, #000 calc(100% - 40px), transparent);
}
[data-theme='dark'] .sel-menu {
  box-shadow: 0 16px 40px #0b0e1a66;
}
.opt {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
  user-select: none;
}
.opt .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.opt.hl {
  background: var(--hair);
}
.opt.checked {
  background: var(--red-soft);
  color: var(--red);
  font-weight: 600;
}
.opt.checked .ico,
.check {
  flex: none;
  color: var(--red);
}
.opt.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.group {
  padding: 8px 12px 4px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  cursor: default;
}
.group.big {
  padding: 14px 12px 6px;
  font-size: 13px;
}
.divider {
  flex: none;
  height: 1px;
  margin: 3px 8px;
  background: var(--hair);
}

/* ---------- 手机：底部弹层 ---------- */
.sheet {
  padding: 0 8px 12px;
}
.sheet-head {
  padding: 4px 12px 10px;
}
.sheet-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}
.sheet-desc {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-3);
}
.sheet-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.opt.big {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: none;
  border-radius: 14px;
  background: transparent;
  font: inherit;
  font-size: 16px;
  text-align: left;
}
.opt.big.checked {
  background: var(--red-soft);
}
.opt.big .logo {
  width: 22px;
  height: 22px;
  border-radius: 6px;
}
@media (hover: hover) {
  .opt.big:hover:not(.checked):not(.disabled) {
    background: var(--hair);
  }
}

@media (max-width: 640px) {
  /* 手机：触发器高 44、字号 16（iOS 聚焦不放大页面） */
  .sel {
    height: var(--tap);
    font-size: 16px;
    max-width: none;
  }
}
</style>
