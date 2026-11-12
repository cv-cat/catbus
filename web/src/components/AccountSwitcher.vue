<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronsUpDown, LogIn, Plus, RotateCw, Star, Trash2 } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import type { Account } from '@/api/types'
import type { PlatformMeta } from '@/data/platforms'
import { gsap, prefersReducedMotion } from '@/composables/motion'
import { since } from '@/composables/format'
import { useBreakpoint } from '@/composables/useBreakpoint'
import BottomSheet from './BottomSheet.vue'
import { imgSrc } from '@/api/client'

/** 收起时显示几个账号；展开后超过这么多个就改成滚动 */
const COLLAPSED = 3
const MAX_VISIBLE = 10

const props = defineProps<{
  platform: PlatformMeta
  accounts: Account[]
  /** 本页正在浏览的账号 */
  current: Account | null
  isExpired: (a: Account) => boolean
  source: 'live' | 'demo'
  /** 平板的图标窄栏：只显示头像（带状态点），账号列表从侧栏右侧弹出 */
  rail?: boolean
}>()
const emit = defineEmits<{
  select: [account: string]
  setDefault: [account: string]
  login: [account?: string]
  remove: [account: string, done: (ok: boolean) => void]
}>()

const open = ref(false)
const expanded = ref(false)
const root = ref<HTMLElement>()
const rows = ref<HTMLElement>()
const pending = ref<string | null>(null)
const panelEl = ref<HTMLElement>()

const bp = useBreakpoint()
/** 手机：侧栏是抽屉，账号列表改成底部弹层（BottomSheet） */
const sheet = computed(() => bp.phone)
/** 窄栏：列表浮在侧栏右侧，挂到 body 上，按账号卡的位置定位 */
const floating = computed(() => Boolean(props.rail) && !sheet.value)
const floatStyle = ref<Record<string, string>>({})
function placeFloat() {
  const r = root.value?.getBoundingClientRect()
  if (!r || !floating.value) return
  const left = Math.round(r.right + 10)
  floatStyle.value = {
    left: `${left}px`,
    bottom: `${Math.max(8, Math.round(innerHeight - r.bottom))}px`,
    width: `${Math.max(240, Math.min(340, innerWidth - left - 12))}px`,
    maxHeight: `${Math.max(200, Math.round(r.bottom - 12))}px`,
  }
}

/** 当前浏览账号的状态点（窄栏用） */
const status = computed(() => (!props.current ? null : props.isExpired(props.current) ? 'expired' : 'online'))

const canExpand = computed(() => !sheet.value && props.accounts.length > COLLAPSED)
const scrollable = computed(() => expanded.value && props.accounts.length > MAX_VISIBLE)
const atBottom = ref(false)

const PALETTE = ['#E8414F', '#3B6FE0', '#2E9E6A', '#8E5BD9', '#E07A2E', '#C9A227', '#1F8FA8', '#B4486B']
function color(a: Account) {
  if (a.current) return 'var(--navy)'
  let h = 0
  for (const c of a.user?.id ?? a.account) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
const nick = (a: Account | null) => a?.user?.name || a?.account || ''

/** 加载失败的头像地址，回退到首字母 */
const broken = ref(new Set<string>())
const avatarOf = (a: Account | null) => {
  const url = a?.user?.avatar
  return url && !broken.value.has(url) ? url : null
}
function onAvatarError(url: string) {
  broken.value = new Set(broken.value).add(url)
}

function toggle() {
  if (!props.accounts.length) return emit('login')
  open.value = !open.value
}
function close() {
  open.value = false
}

/** 前 n 行的总高度（rows 是 position: relative，offsetTop 不受滚动影响） */
function heightFor(n: number): number {
  const el = rows.value
  const last = el?.children[Math.min(n, el.children.length) - 1] as HTMLElement | undefined
  return last ? last.offsetTop + last.offsetHeight : 0
}

function resize(animated: boolean) {
  const el = rows.value
  if (!el) return
  // 底部弹层自己会滚动，全部显示
  if (sheet.value) return void gsap.set(el, { height: 'auto' })
  const target = heightFor(expanded.value ? MAX_VISIBLE : COLLAPSED)
  if (!animated || prefersReducedMotion()) return void gsap.set(el, { height: target })
  // 展开用回弹（弹窗底边固定，列表向上撑开）；收起干脆利落
  gsap.to(el, expanded.value
    ? { height: target, duration: 0.6, ease: 'back.out(1.5)' }
    : { height: target, duration: 0.35, ease: 'power3.inOut' })
}

function toggleExpand() {
  expanded.value = !expanded.value
  if (!expanded.value) rows.value?.scrollTo({ top: 0, behavior: 'smooth' })
  resize(true)
}

function onScroll() {
  const el = rows.value
  if (el) atBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 2
}

/** 防连点：账号列表刷新回来（或 3 秒后）才解除 */
function setDefault(a: Account) {
  pending.value = a.account
  emit('setDefault', a.account)
  setTimeout(() => (pending.value = null), 3000)
}

/** 删除账号：先在行内二次确认 */
const confirming = ref<string | null>(null)
const removing = ref<string | null>(null)
/** 有服务端登出的平台（AGENTS.md 5.3） */
const SERVER_LOGOUT = new Set(['bilibili', 'kuaishou'])
function askRemove(a: Account) {
  confirming.value = a.account
}
function cancelRemove() {
  confirming.value = null
}
function confirmRemove(a: Account) {
  removing.value = a.account
  emit('remove', a.account, () => {
    removing.value = null
    confirming.value = null
  })
}

// 确认行换成两行、比普通行高：进入 / 退出确认后按新的行高重算列表高度，避免被裁掉
watch(confirming, async () => {
  if (!open.value) return
  await nextTick()
  resize(true)
})

// ---------- 排序与切换动效（设计稿 J）----------
/** 点选后、动画结束前本地先当作正在浏览的账号，列表据此重排 */
const chosen = ref<string | null>(null)
/** 切换动画进行中：对勾先不显示，落定后弹出 */
const moving = ref(false)
const viewing = computed(() => chosen.value ?? props.current?.account ?? null)
/** 正在浏览 → 默认 → 其余按最近登录 */
const sorted = computed(() => {
  const rank = (a: Account) => (a.account === viewing.value ? 0 : a.current ? 1 : 2)
  return [...props.accounts].sort((x, y) => rank(x) - rank(y) || Date.parse(y.updated_at) - Date.parse(x.updated_at))
})

const rowEls = () =>
  [...(rows.value?.children ?? [])].filter((el): el is HTMLElement => el instanceof HTMLElement && !!el.dataset.account)
/**
 * FLIP：先记下每行的位置，把 account 设为正在浏览（列表重排），再让每行从旧位置补间回新位置。
 * 选中行浮起（放大 + 投影）越过其他行移到顶部；原来在它上方的行各下移一格，离它近的先动。
 */
async function flipTo(account: string) {
  const before = new Map(rowEls().map((el) => [el.dataset.account!, el.offsetTop]))
  chosen.value = account
  await nextTick()
  const tl = gsap.timeline({ paused: true })
  let lift: HTMLElement | null = null
  const movers: { el: HTMLElement; dy: number }[] = []
  for (const el of rowEls()) {
    const from = before.get(el.dataset.account!)
    if (from == null) continue
    const dy = from - el.offsetTop
    if (el.dataset.account === account) lift = el
    else if (dy) movers.push({ el, dy })
  }
  if (lift) {
    gsap.set(lift, { y: before.get(account)! - lift.offsetTop, zIndex: 2 })
    tl.to(lift, { scale: 1.035, boxShadow: '0 10px 28px #1b1f2e33', duration: 0.14, ease: 'power2.out' }, 0)
      .to(lift, { y: 0, duration: 0.42, ease: 'power3.inOut' }, 0.14)
      .to(lift, { scale: 1, boxShadow: '0 0 0 #1b1f2e00', duration: 0.2, ease: 'power2.out', clearProps: 'transform,boxShadow,zIndex' }, 0.56)
  }
  // 下移量小的离选中行近，先动；依次错开 30ms
  movers.sort((x, y) => x.dy - y.dy)
  movers.forEach(({ el, dy }, i) => {
    gsap.set(el, { y: dy })
    tl.to(el, { y: 0, duration: 0.38, ease: 'power3.out', clearProps: 'transform' }, 0.14 + i * 0.03)
  })
  rows.value?.classList.add('flipping')
  await new Promise<void>((r) => tl.eventCallback('onComplete', () => r()).play())
  rows.value?.classList.remove('flipping')
}

async function pick(a: Account) {
  if (confirming.value === a.account || moving.value) return
  if (props.isExpired(a)) return relogin(a)
  // 已在第一行、只有一个账号、减少动态效果：不播动画，直接切换
  if (a.account === sorted.value[0]?.account || props.accounts.length < 2 || prefersReducedMotion()) {
    emit('select', a.account)
    return close()
  }
  moving.value = true
  await flipTo(a.account)
  moving.value = false
  // 落定后对勾弹出，再切换、收起
  await nextTick()
  const check = rows.value?.querySelector('.check')
  if (check) {
    await new Promise<void>((r) =>
      gsap.fromTo(check, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, ease: 'back.out(2)', onComplete: r }),
    )
  }
  emit('select', a.account)
  close()
}
function relogin(a: Account) {
  close()
  emit('login', a.account)
}
function add() {
  close()
  emit('login')
}

function onDoc(e: PointerEvent) {
  const t = e.target as Node
  if (!root.value?.contains(t) && !panelEl.value?.contains(t)) close()
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (confirming.value && !removing.value) return cancelRemove()
  close()
}
watch(open, async (v) => {
  confirming.value = null
  if (!v) {
    chosen.value = null
    moving.value = false
  }
  if (v) {
    expanded.value = false
    atBottom.value = false
    placeFloat()
    await nextTick()
    resize(false)
    // 底部弹层由遮罩、下滑关闭；其余形态点外面关闭
    if (!sheet.value) document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    addEventListener('resize', placeFloat)
  } else {
    document.removeEventListener('pointerdown', onDoc)
    document.removeEventListener('keydown', onKey)
    removeEventListener('resize', placeFloat)
  }
})
// 形态变了（转屏、窗口缩放跨断点、窄栏展开）就收起，避免停在错误的位置
watch([sheet, floating], close)
watch(() => props.platform.id, close)
// 账号增减（设为默认、登录后刷新）时重新量一次高度
watch(() => props.accounts, () => {
  pending.value = null
  if (open.value) nextTick(() => resize(false))
})
onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="switcher" :class="{ rail: rail && !sheet }">
    <BottomSheet :open="open" desktop="inline" :label="`${platform.name}账号`" :z="55" :close-on-esc="false" @close="close">
    <Teleport to="body" :disabled="!floating">
    <Transition :name="floating ? 'pop-side' : 'pop'">
      <div
        v-if="open || sheet"
        ref="panelEl"
        class="panel"
        :class="{ glass: !sheet, 'in-sheet': sheet, floating }"
        :style="floating ? floatStyle : undefined"
        :role="sheet ? undefined : 'dialog'"
        :aria-label="sheet ? undefined : `${platform.name}账号`"
      >
        <header class="head">
          <div class="title-row">
            <img class="logo" :src="platform.logo" alt="" />
            <span class="title">{{ platform.name }}账号</span>
            <span class="count mono">{{ accounts.length }}</span>
          </div>
          <p class="hint">点选切换本次浏览的登录态</p>
        </header>

        <div class="list">
          <div ref="rows" class="rows" :class="{ scrollable, faded: scrollable && !atBottom }" @scroll.passive="onScroll">
            <div
              v-for="a in sorted"
              :key="a.account"
              :data-account="a.account"
              class="row"
              :class="{ active: a.account === viewing, expired: isExpired(a), confirming: confirming === a.account }"
              role="button"
              tabindex="0"
              @click="pick(a)"
              @keydown.enter.prevent="pick(a)"
            >
              <template v-if="confirming === a.account">
         <span class="warn-ico" aria-hidden="true"><Trash2 :size="15" /></span>
  <div class="text">
           <div class="name-row"><span class="nick">删除「{{ nick(a) }}」？</span></div>
    <div class="sub">{{ SERVER_LOGOUT.has(platform.id) ? `删除本机登录态，并退出${platform.name}服务端登录` : '只删除本机保存的登录态' }}</div>
  </div>
         <div class="confirm-acts">
           <button type="button" class="act cancel" :disabled="removing === a.account" @click.stop="cancelRemove">取消</button>
           <button type="button" class="act danger" :disabled="removing === a.account" @click.stop="confirmRemove(a)">
      <CatbusLoader v-if="removing === a.account" :size="12" label="删除中" />
      {{ removing === a.account ? '删除中…' : '删除' }}
           </button>
         </div>
       </template>
       <template v-else>
              <span class="ava" :style="{ background: color(a) }" aria-hidden="true">
                <img v-if="avatarOf(a)" :src="imgSrc(avatarOf(a)!)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(avatarOf(a)!)" />
                <template v-else>{{ nick(a).slice(0, 1) }}</template>
              </span>
              <div class="text">
                <div class="name-row">
                  <span class="nick">{{ nick(a) }}</span>
                  <span v-if="a.current" class="badge">默认</span>
                </div>
                <div class="sub">
                  {{ isExpired(a) ? '登录已失效' : a.account === viewing ? '正在浏览' : `${since(a.updated_at)}登录` }}
                </div>
              </div>
              <button v-if="isExpired(a)" type="button" class="act relogin" @click.stop="relogin(a)">
                <RotateCw :size="12" />重新登录
              </button>
              <button
                v-else-if="!a.current"
                type="button"
                class="act set-default"
                :disabled="pending === a.account"
                @click.stop="setDefault(a)"
              >
                <Star :size="12" />设为默认
              </button>
              <button v-tip="'删除账号'" type="button" class="act icon del" aria-label="删除账号" @click.stop="askRemove(a)">
  <Trash2 :size="13" />
       </button>
              <Check v-if="a.account === viewing && !moving && !isExpired(a)" class="check" :size="16" />
       </template>
            </div>
          </div>
          <div v-if="canExpand" class="expand-wrap">
            <button
              type="button"
              class="expand"
              :class="{ up: expanded }"
              :aria-label="expanded ? '收起' : '展开全部账号'"
              :aria-expanded="expanded"
              @click="toggleExpand"
            >
              <ChevronDown :size="16" />
            </button>
          </div>
        </div>

        <button type="button" class="add" @click="add">
          <span class="plus" aria-hidden="true"><Plus :size="16" /></span>
          <span class="text">
            <span class="nick">添加{{ platform.name }}账号</span>
            <span class="sub">扫码 · 短信 · Cookie 导入</span>
          </span>
        </button>
      </div>
    </Transition>
    </Teleport>
    </BottomSheet>

    <button
      type="button"
      class="chip"
      :class="{ open }"
      :title="accounts.length ? '切换账号' : '登录'"
      :aria-label="rail ? (current ? `${nick(current)}，切换账号` : '未登录，点击登录') : undefined"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="ava-wrap">
        <span class="ava" aria-hidden="true">
          <img v-if="avatarOf(current)" :src="imgSrc(avatarOf(current)!)" alt="" referrerpolicy="no-referrer" @error="onAvatarError(avatarOf(current)!)" />
          <template v-else>{{ current ? nick(current).slice(0, 1) : '?' }}</template>
        </span>
        <span v-if="rail && status" class="dot" :class="status" aria-hidden="true" />
      </span>
      <span class="chip-text">
        <span class="chip-name">{{ current ? nick(current) : '未登录 · 点击登录' }}</span>
        <span class="chip-sub">
          {{ platform.name }} · web<template v-if="source === 'demo'"> · <em>演示数据</em></template>
        </span>
      </span>
      <LogIn v-if="!accounts.length" :size="16" class="chev" aria-hidden="true" />
      <ChevronsUpDown v-else :size="16" class="chev" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  flex: none;
}

/* ---------- 侧栏底部的账号卡 ---------- */
.chip {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  text-align: left;
  border-radius: var(--radius-md);
  background: var(--glass-strong);
  border: 1px solid transparent;
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s, border-color 0.2s;
}
.chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px #1b1f2e14;
}
.chip.open {
  border-color: #e8414f55;
  box-shadow: 0 0 0 3px var(--red-soft);
  transform: none;
}
.chip .ava {
  width: 30px;
  height: 30px;
  font-size: 13px;
  background: var(--navy);
}
.chip-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.chip-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-sub {
  font-size: 10.5px;
  color: var(--ink-3);
}
.chip-sub em {
  font-style: normal;
  color: var(--red);
}
.chev {
  color: var(--ink-2);
  flex: none;
}

/* ---------- 弹窗 ---------- */
.panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  width: 340px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 22px;
  background: var(--glass-strong);
  box-shadow: 0 18px 50px #1b1f2e24;
  transform-origin: 20% 100%;
}
.head {
  padding: 10px 10px 4px;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}
.title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
}
.count {
  font-size: 11px;
  color: var(--ink-3);
}
.hint {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--ink-3);
}

.list {
  padding: 6px;
  border-radius: 18px;
  border: 1px solid var(--hair);
  background: color-mix(in srgb, var(--ink) 3%, transparent);
}
.rows {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}
.rows.scrollable {
  overflow-y: auto;
  overscroll-behavior: contain;
  margin-right: -2px;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 22%, transparent) transparent;
}
.rows.faded {
  mask-image: linear-gradient(to bottom, #000 calc(100% - 36px), transparent);
}
.rows::-webkit-scrollbar {
  width: 4px;
}
.rows::-webkit-scrollbar-track {
  margin: 6px 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}
.rows::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.rows:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--ink) 38%, transparent);
}

.row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 14px;
  cursor: pointer;
  outline: none;
  transition: background 0.2s, box-shadow 0.2s;
}
/* 切换动效进行中：选中行放大后的投影不被列表裁掉（底边仍裁，收起时下面的行不会露出来） */
.rows.flipping:not(.scrollable) {
  overflow: visible;
  clip-path: inset(-24px -10px 0 -10px);
}
.row {
  position: relative;
}
.row:active:not(.confirming) {
  transform: scale(0.98);
  transition: transform 0.1s;
}
.row:hover,
.row:focus-visible {
  background: color-mix(in srgb, var(--glass-strong) 70%, transparent);
}
.row.active {
  background: #fff;
  box-shadow: 0 2px 10px #1b1f2e10;
}
[data-theme='dark'] .row.active {
  background: #ffffff14;
}
.ava {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.nick {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--red);
  background: var(--red-soft);
}
.sub {
  font-size: 11px;
  color: var(--ink-3);
}
.ava {
  overflow: hidden;
}
.ava img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.row.expired .ava {
  opacity: 0.45;
}
.row.expired .nick {
  color: var(--ink-3);
}
.row.expired .sub {
  color: var(--red);
}
.check {
  color: var(--red);
  flex: none;
}
.act {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  transition: opacity 0.2s, transform 0.2s var(--ease-out);
}
.set-default {
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  opacity: 0;
  transform: translateX(4px);
}
.row:hover .set-default,
.row:focus-within .set-default {
  opacity: 1;
  transform: none;
}
.set-default:hover {
  color: var(--red);
}
.set-default:disabled {
  cursor: progress;
}
.relogin {
  color: var(--red);
  background: var(--red-soft);
}
/* 删除：悬停时出现的垃圾桶 */
.act.icon {
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
  border-radius: 50%;
  color: var(--ink-3);
  opacity: 0;
  transform: translateX(4px);
}
.row:hover .act.icon,
.row:focus-within .act.icon {
  opacity: 1;
  transform: none;
}
.act.icon:hover {
  color: var(--red);
  background: var(--red-soft);
}
/* 行内二次确认 */
.row.confirming {
  cursor: default;
  background: var(--red-soft);
  box-shadow: inset 0 0 0 1px #e8414f40;
  animation: shake 0.35s var(--ease-out);
}
.row.confirming .nick {
  color: var(--red);
}
.warn-ico {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--red);
}
/* 确认行：图标 + 提示在第一行，按钮换到第二行右对齐，窄面板下也不会撑出容器 */
.row.confirming {
  flex-wrap: wrap;
  row-gap: 8px;
}
.row.confirming .sub {
  white-space: normal;
  overflow-wrap: anywhere;
}
.confirm-acts {
  flex: 1 0 100%;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.act.cancel {
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
}
.act.danger {
  color: #fff;
  background: var(--red);
  gap: 6px;
  --catbus-loader-accent: var(--navy);
}
.act.cancel:disabled,
.act.danger:disabled {
  opacity: 0.6;
  cursor: progress;
}
@keyframes shake {
  20% { transform: translateX(-3px); }
  45% { transform: translateX(3px); }
  70% { transform: translateX(-1.5px); }
}
@media (prefers-reduced-motion: reduce) {
  .row.confirming {
    animation: none;
  }
}

.expand-wrap {
  display: flex;
  justify-content: center;
  padding-top: 6px;
}
.expand {
  display: grid;
  place-items: center;
  padding: 3px 14px;
  border-radius: 11px;
  color: var(--ink-2);
  background: var(--glass-strong);
  border: 1px solid var(--hair);
  box-shadow: 0 2px 6px #1b1f2e0d;
  transition: color 0.2s, transform 0.2s var(--ease-out);
}
.expand:hover {
  color: var(--ink);
  transform: translateY(-1px);
}
.expand svg {
  transition: transform 0.3s var(--ease-out);
}
.expand.up svg {
  transform: rotate(180deg);
}

.add {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 14px;
  text-align: left;
  transition: background 0.2s;
}
.add:hover {
  background: var(--hair);
}
.plus {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex: none;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  border: 1.2px solid var(--ink-3);
}

/* ---------- 窄栏（平板）：只显示头像 ---------- */
.ava-wrap {
  position: relative;
  flex: none;
  display: grid;
}
.dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--glass-strong);
  box-sizing: border-box;
}
.dot.online {
  background: var(--online);
}
.dot.expired {
  background: var(--red);
}
.rail .chip {
  justify-content: center;
  padding: 0;
  width: var(--tap);
  height: var(--tap);
  margin: 0 auto;
  border-radius: 50%;
  background: transparent;
}
.rail .chip .ava {
  width: 36px;
  height: 36px;
  font-size: 14px;
}
.rail .chip-text,
.rail .chev {
  display: none;
}
.rail .chip.open {
  box-shadow: 0 0 0 3px var(--red-soft);
}
/* 窄栏的列表挂在 body 上，从账号卡右侧弹出 */
.panel.floating {
  position: fixed;
  z-index: 45;
  overflow-y: auto;
  overscroll-behavior: contain;
  transform-origin: 0% 100%;
}
.pop-side-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease-out;
}
.pop-side-leave-active {
  transition: transform 0.18s ease-in, opacity 0.18s ease-in;
}
.pop-side-enter-from,
.pop-side-leave-to {
  opacity: 0;
  transform: translateX(-10px) scale(0.94);
}

/* ---------- 手机：底部弹层（外壳由 BottomSheet 提供） ---------- */
.panel.in-sheet {
  position: static;
  width: auto;
  padding: 2px 12px 14px;
  border-radius: 0;
  background: none;
  box-shadow: none;
  border: none;
  backdrop-filter: none;
}
.in-sheet .head {
  padding: 6px 8px 6px;
}
.in-sheet .title {
  font-size: 16px;
}

/* ---------- 触屏：没有悬停，操作按钮一直显示，可点区域至少 --tap ---------- */
@media (hover: none) and (pointer: coarse) {
  .row {
    min-height: var(--tap);
  }
  .set-default,
  .act.icon {
    opacity: 1;
    transform: none;
  }
  .act {
    position: relative;
    min-height: 34px;
    padding: 0 11px;
    font-size: 12px;
  }
  .act.icon {
    width: 34px;
    height: 34px;
  }
  /* 视觉尺寸不变，点击区域外扩到 44px */
  .act::before {
    content: '';
    position: absolute;
    inset: -5px;
  }
  .expand {
    min-height: 32px;
    padding: 6px 22px;
  }
  .add {
    min-height: var(--tap);
  }
  .chip:hover {
    transform: none;
    box-shadow: none;
  }
}

/* 弹窗：从账号卡往上弹出 */
.pop-enter-active {
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease-out;
}
.pop-leave-active {
  transition: transform 0.18s ease-in, opacity 0.18s ease-in;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .pop-enter-active,
  .pop-leave-active {
    transition: opacity 0.2s;
  }
  .pop-enter-from,
  .pop-leave-to {
    transform: none;
  }
}
</style>
