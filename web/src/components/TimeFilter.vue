<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { flashTip } from '@/directives/tip'

/**
 * 时间筛选（`item search --time`）：下拉 chip「时间 · 不限」+ 玻璃菜单（设计稿 R / R2 / R3）。
 * 菜单传送到 body、按 chip 的位置定位：筛选栏是横向滚动容器，放在里面会被裁掉。
 * options[].disabled / disabled 为不能选的原因：置灰并用 tooltip 说明（整个不支持时 chip 整体置灰）。
 */
const props = defineProps<{
  options: readonly { value: string; label: string; disabled?: string | null }[]
  disabled?: string | null
}>()
const model = defineModel<string>({ required: true })

const DEFAULT = 'all'
const MENU_W = 188
const GAP = 8
const EDGE = 8

const chip = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
/** 悬停和键盘共用的高亮项 */
const active = ref(-1)
const pos = ref({ top: 0, left: 0 })
const menuId = `catbus-time-menu-${Math.random().toString(36).slice(2, 8)}`

const current = computed(() => props.options.find((o) => o.value === model.value) ?? props.options[0]!)
const on = computed(() => model.value !== DEFAULT)

function place() {
  const r = chip.value?.getBoundingClientRect()
  if (!r) return
  // 左边与 chip 对齐；超出右边界时向左收到视口内 8px
  const left = Math.max(EDGE, Math.min(r.left, innerWidth - MENU_W - EDGE))
  pos.value = { top: r.bottom + GAP, left }
}

function enabledIndex(from: number, step: 1 | -1): number {
  const n = props.options.length
  for (let i = 1; i <= n; i++) {
    const k = (((from + step * i) % n) + n) % n
    if (!props.options[k]!.disabled) return k
  }
  return from
}

async function show() {
  if (props.disabled) return
  place()
  active.value = Math.max(0, props.options.findIndex((o) => o.value === model.value))
  open.value = true
  await nextTick()
  // 焦点进菜单：上下键、Enter、Esc 都在菜单上处理（aria-activedescendant 指向高亮项）
  menu.value?.focus({ preventScroll: true })
}

function close(returnFocus = false) {
  if (!open.value) return
  open.value = false
  active.value = -1
  if (returnFocus) chip.value?.focus()
}

function toggle(e: MouseEvent) {
  if (props.disabled) return flashTip(e.currentTarget)
  open.value ? close() : void show()
}

function choose(i: number, e?: MouseEvent) {
  const o = props.options[i]
  if (!o) return
  if (o.disabled) return flashTip(e?.currentTarget ?? null)
  model.value = o.value
  close(true)
}

function onChipKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    void show()
  }
}

function onMenuKey(e: KeyboardEvent) {
  const n = props.options.length
  if (e.key === 'ArrowDown') active.value = enabledIndex(active.value, 1)
  else if (e.key === 'ArrowUp') active.value = enabledIndex(active.value < 0 ? n : active.value, -1)
  else if (e.key === 'Home') active.value = enabledIndex(-1, 1)
  else if (e.key === 'End') active.value = enabledIndex(n, -1)
  else if (e.key === 'Enter' || e.key === ' ') choose(active.value)
  else if (e.key === 'Escape') close(true)
  else if (e.key === 'Tab') return close()
  else return
  e.preventDefault()
}

/** 点外面、页面滚动、窗口缩放时收起（菜单是 fixed 定位，跟不上滚动） */
function onOutside(e: PointerEvent) {
  const t = e.target as Node
  if (chip.value?.contains(t) || menu.value?.contains(t)) return
  close()
}
function onScroll(e: Event) {
  if (menu.value?.contains(e.target as Node)) return
  close()
}
const onResize = () => close()
watch(open, (v) => {
  const fn = v ? addEventListener : removeEventListener
  fn('pointerdown', onOutside as EventListener, true)
  fn('scroll', onScroll, true)
  fn('resize', onResize)
})
onBeforeUnmount(() => {
  removeEventListener('pointerdown', onOutside as EventListener, true)
  removeEventListener('scroll', onScroll, true)
  removeEventListener('resize', onResize)
})

// 出现 0.18s expo.out（y −4、scale 0.98 → 正常），消失 0.12s power2.in；减少动效时只淡入淡出
function enter(el: Element, done: () => void) {
  if (prefersReducedMotion()) return void gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.1, onComplete: done })
  gsap.fromTo(
    el,
    { opacity: 0, y: -4, scale: 0.98, transformOrigin: 'top left' },
    { opacity: 1, y: 0, scale: 1, duration: 0.18, ease: 'expo.out', onComplete: done },
  )
}
function leave(el: Element, done: () => void) {
  gsap.to(el, { opacity: 0, duration: prefersReducedMotion() ? 0.08 : 0.12, ease: 'power2.in', onComplete: done })
}
</script>

<template>
  <button
    ref="chip"
    v-tip="disabled"
    type="button"
    class="time-chip"
    :class="[on ? 'on' : 'glass', { open, disabled: !!disabled }]"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="toggle"
    @keydown="onChipKey"
  >
    时间 · {{ current.label }}
    <component :is="open ? ChevronUp : ChevronDown" :size="14" class="chev" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <Transition :css="false" @enter="enter" @leave="leave">
      <div
        v-if="open"
        :id="menuId"
        ref="menu"
        class="time-menu"
        role="menu"
        aria-label="时间"
        tabindex="-1"
        :aria-activedescendant="active >= 0 ? `${menuId}-${active}` : undefined"
        :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
        @keydown="onMenuKey"
      >
        <div
          v-for="(o, i) in options"
          :id="`${menuId}-${i}`"
          :key="o.value"
          v-tip.right="o.disabled"
          class="opt"
          :class="{ checked: o.value === model, hl: i === active, disabled: !!o.disabled }"
          role="menuitemradio"
          :aria-checked="o.value === model"
          :aria-disabled="o.disabled ? 'true' : undefined"
          @mouseenter="!o.disabled && (active = i)"
          @click="choose(i, $event)"
        >
          <span>{{ o.label }}</span>
          <Check v-if="o.value === model" :size="14" aria-hidden="true" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.time-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 7px 10px 7px 14px;
  border-radius: 16px;
  font-size: 13px;
  white-space: nowrap;
  color: var(--ink-2);
  border: 1px solid transparent;
  transition: background 0.25s, color 0.25s, border-color 0.25s, transform 0.2s var(--ease-out);
}
.time-chip.glass {
  border-color: var(--glass-stroke);
}
.time-chip .chev {
  color: var(--ink-3);
}
.time-chip:hover {
  transform: translateY(-1px);
  color: var(--ink);
}
/* 激活态与类型 chip 的选中一致 */
.time-chip.on {
  background: linear-gradient(var(--red-soft), var(--red-soft)), var(--glass-strong);
  backdrop-filter: blur(20px) saturate(1.4);
  box-shadow: 0 2px 10px #e8414f1f;
  border-color: #e8414f40;
  color: var(--red);
  font-weight: 600;
}
.time-chip.on .chev {
  color: var(--red);
}
/* 展开：描边加深 */
.time-chip.open {
  border-color: #e8414f66;
}
.time-chip.on.open {
  border-color: #e8414f99;
}
.time-chip.disabled,
.time-chip.disabled:hover {
  transform: none;
  color: var(--ink-3);
  opacity: 0.45;
  cursor: not-allowed;
}

.time-menu {
  position: fixed;
  z-index: 60;
  width: 188px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: 16px;
  background: var(--glass-strong);
  border: 1px solid var(--glass-stroke);
  backdrop-filter: blur(30px) saturate(1.6);
  box-shadow: 0 16px 40px #1b1f2e1a;
  outline: none;
}
[data-theme='dark'] .time-menu {
  box-shadow: 0 16px 40px #0b0e1a66;
}
.opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
  user-select: none;
}
.opt.hl {
  background: var(--hair);
}
.opt.checked {
  background: var(--red-soft);
  color: var(--red);
  font-weight: 600;
}
.opt.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (hover: none) {
  .time-chip:hover {
    transform: none;
  }
}
@media (pointer: coarse) {
  .time-chip {
    min-height: 40px;
  }
}
/* 手机：chip 高 44、圆角 22，菜单项高 44（设计稿 R3） */
@media (max-width: 640px) {
  .time-chip {
    height: 44px;
    padding: 0 12px 0 16px;
    border-radius: 22px;
    font-size: 14px;
  }
  .opt {
    height: 44px;
  }
}
</style>
