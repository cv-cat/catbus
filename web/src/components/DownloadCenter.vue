<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, ChevronDown, CircleCheck, Clock, Download, FolderDown, ImageOff, RotateCw, ShieldCheck, TimerOff, Trash2, X } from 'lucide-vue-next'
import CatbusLoader from '@/components/CatbusLoader.vue'
import { pushFailedWithFiles, type Batch, type DownloadItem } from '@/api/download'
import { useDownloadsStore } from '@/stores/downloads'
import { platformById } from '@/data/platforms'
import { since } from '@/composables/format'
import { openVerify } from '@/stores/verify'
import { prefersReducedMotion, wave } from '@/composables/motion'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { imgSrc } from '@/api/client'
import { errorTitle } from '@/i18n/errors'

const dl = useDownloadsStore()
const { t } = useI18n()
const bp = useBreakpoint()
const root = ref<HTMLElement>()
/** 弹层本身：手机上传送到 body 变成底部弹层，不在 root 里 */
const panel = ref<HTMLElement>()
const expanded = ref(new Set<string>())

function toggle() {
  wave()
  dl.open = !dl.open
}
function toggleBatch(id: string) {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

const counts = (b: Batch) => ({
  done: b.items.filter((it) => it.status === 'done').length,
  failed: b.items.filter((it) => it.status === 'failed').length,
  /** 完成了、但服务端的临时文件已被清理 */
  expired: b.items.filter((it) => it.status === 'done' && it.expired).length,
  busy: b.items.some((it) => it.status === 'queued' || it.status === 'running'),
})
/** 可以重新保存：结束了、有没过期的已完成条目（推送失败但种子已保存的也算） */
const savable = (b: Batch) => {
  const c = counts(b)
  return !c.busy && (c.done > c.expired || b.items.some(pushFailedWithFiles))
}
/** 可以重试：失败的、文件已过期的 */
const retryCount = (b: Batch) => counts(b).failed + counts(b).expired
const retryable = (it: DownloadItem) => it.status === 'failed' || (it.status === 'done' && !!it.expired)
function batchStatus(b: Batch): string {
  const c = counts(b)
  if (c.busy) return t('download.batch.progress', { done: c.done + c.failed, total: b.items.length })
  const parts: string[] = []
  if (b.opts?.qbit) {
    // 推送的一批：按推送结果汇总（只推送时页面没交给浏览器，不写「已交给浏览器」）
    const q = (s: string) => b.items.filter((it) => it.qbit?.status === s).length
    if (q('added')) parts.push(t('download.qbit.batch.added', { n: q('added') }, q('added')))
    if (q('exists')) parts.push(t('download.qbit.batch.exists', { n: q('exists') }, q('exists')))
    if (c.failed) parts.push(t('download.batch.failed', { n: c.failed }, c.failed))
    if (c.expired) parts.push(t('download.batch.expired', { n: c.expired }, c.expired))
    return parts.join(' · ') || t('download.batch.finished')
  }
  if (c.done > c.expired) parts.push(t('download.batch.delivered'))
  if (c.failed) parts.push(t('download.batch.failed', { n: c.failed }, c.failed))
  if (c.expired) parts.push(t('download.batch.expired', { n: c.expired }, c.expired))
  return parts.join(' · ') || t('download.batch.finished')
}
function itemStatus(it: DownloadItem, b: Batch): string {
  if (it.status === 'queued') return t('download.status.queued')
  if (it.status === 'running') return t('download.status.running')
  if (it.qbit && !it.expired) return qbitText(it)
  // 失败原因是 CLI 的中文报错：按 code 取译文
  if (it.status === 'failed') return it.error ? errorTitle({ code: it.code ?? 'ERROR', message: it.error }) : t('download.status.failed')
  if (it.expired) return t('download.status.expired')
  const got = gotText(it, b)
  if (got) return got
  const n = it.files.length
  // 整批结束后才交给浏览器
  return counts(b).busy ? t('download.status.downloaded', { n }, n) : t('download.status.delivered', { n }, n)
}
/** 下了信息时显示取到了什么：「媒体 ✓ · 信息 ✓ · 评论 87/100（遇到风控，已停止）」 */
function gotText(it: DownloadItem, b: Batch): string | null {
  const g = it.got
  if (!g?.meta) return null
  const parts: string[] = []
  if (b.opts?.media !== false) parts.push(g.media ? t('download.got.media') : t('download.got.noMedia'))
  parts.push(t('download.got.meta'))
  const limit = b.opts?.comments ?? 0
  if (limit !== 0 && g.comments != null) {
    const n = g.comments
    let c = limit === 'all' ? t('download.got.commentsAll', { n }, n) : t('download.got.comments', { n, limit })
    if (g.truncated) c += t('download.got.truncated')
    parts.push(c)
  }
  return parts.join(' · ')
}
/** 推送到 qBittorrent 的结果：「种子 ✓ · 已推送」「种子 ✓ · 已在任务列表」「种子 ✓ · 推送失败（种子已保存）：原因」 */
function qbitText(it: DownloadItem): string {
  const q = it.qbit!
  const head = t('download.qbit.got.torrent')
  if (q.status === 'added') return `${head} · ${t('download.qbit.got.added')}`
  if (q.status === 'exists') return `${head} · ${t('download.qbit.got.exists')}`
  const reason = it.error ? errorTitle({ code: q.code ?? it.code ?? 'ERROR', message: it.error }) : null
  return `${head} · ${t('download.qbit.got.failed')}${reason ? t('download.qbit.got.reason', { reason }) : ''}`
}
const pushFailed = (it: DownloadItem) => it.qbit?.status === 'failed'
const retryLabel = (it: DownloadItem) =>
  it.expired ? t('download.action.redownload') : pushFailed(it) ? t('download.qbit.retry') : t('common.action.retry')
const partial = (it: DownloadItem) => it.status === 'done' && !it.expired && !!it.got?.truncated
const name = (p: string) => platformById(p)?.name ?? p
const logo = (p: string) => platformById(p)?.logo ?? ''


async function retry(batch: string, item?: string) {
  try {
    await dl.retry(batch, item)
  } catch (e) {
    alert((e as Error).message)
  }
}
/** 人机验证：去浏览器验证，回来重试这一条（不给 item 时重试整批失败的） */
function verifyThen(b: Batch, it: DownloadItem, whole = false) {
  openVerify({ platform: b.platform, url: it.verify_url ?? null, message: it.error ? errorTitle({ code: it.code ?? 'ERROR', message: it.error }) : undefined, retry: () => retry(b.id, whole ? undefined : it.id) })
}
const firstVerify = (b: Batch) => b.items.find((it) => it.status === 'failed' && it.verify_url)

async function remove(batch: string, item?: string) {
  try {
    await dl.remove(batch, item)
  } catch (e) {
    alert((e as Error).message)
  }
}
const removeLabel = (status?: string) => (status === 'queued' ? t('download.action.cancelRemove') : t('download.action.remove'))

function onDoc(e: PointerEvent) {
  const target = e.target as Node
  if (!root.value?.contains(target) && !panel.value?.contains(target)) dl.open = false
}

// ---------- 底部弹层：按住把手（或标题行）下滑关闭 ----------
const dragY = ref(0)
const dragging = ref(false)
let drag: { y: number; t: number; id: number } | null = null
function onGripDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  drag = { y: e.clientY, t: performance.now(), id: e.pointerId }
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onGripMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const dy = e.clientY - drag.y
  // 往上拉只给一点阻尼，往下跟手
  dragY.value = dy > 0 ? dy : dy / 6
}
function onGripUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return
  const v = dragY.value / Math.max(1, performance.now() - drag.t)
  drag = null
  dragging.value = false
  if (dragY.value > 90 || (dragY.value > 24 && v > 0.5)) dl.open = false
  else dragY.value = 0
}
const sheetStyle = computed(() =>
  bp.phone && (dragging.value || dragY.value)
    ? { transform: `translateY(${Math.max(dragY.value, -12)}px)`, transition: dragging.value ? 'none' : undefined }
    : undefined,
)
const reduced = prefersReducedMotion()
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') dl.open = false
}
watch(() => dl.open, (v) => {
  if (v) {
    dragY.value = 0
    void dl.refresh()
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onDoc)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => (dl.open = false))
</script>

<template>
  <div ref="root" class="center">
    <button
      type="button"
      class="trigger glass"
      :class="{ on: dl.open }"
      :aria-label="t('download.title')"
      v-tip="t('download.title')"
      :aria-expanded="dl.open"
      @click="toggle"
    >
      <FolderDown :size="18" />
      <span v-if="dl.active" class="pulse" aria-hidden="true" />
    </button>

    <Teleport to="body" :disabled="!bp.phone">
    <Transition name="scrim">
      <div v-if="dl.open && bp.phone" class="scrim" aria-hidden="true" />
    </Transition>
    <Transition :name="bp.phone ? (reduced ? 'scrim' : 'sheet') : 'drop'" @after-leave="dragY = 0">
      <div
        v-if="dl.open"
        ref="panel"
        class="panel glass"
        :class="{ sheet: bp.phone }"
        :style="sheetStyle"
        role="dialog"
        :aria-label="t('download.title')"
        :aria-modal="bp.phone || undefined"
      >
        <div
          v-if="bp.phone"
          class="grip"
          @pointerdown="onGripDown"
          @pointermove="onGripMove"
          @pointerup="onGripUp"
          @pointercancel="onGripUp"
        >
          <span aria-hidden="true" />
          <button type="button" class="sr-only" @click="dl.open = false">{{ t('download.close') }}</button>
        </div>
        <header
          class="head"
          @pointerdown="bp.phone && onGripDown($event)"
          @pointermove="onGripMove"
          @pointerup="onGripUp"
          @pointercancel="onGripUp"
        >
   <span class="title">{{ t('download.title') }}</span>
          <span class="mono n">{{ dl.batches.length }}</span>
          <button
            v-if="dl.batches.some((b) => !counts(b).busy)"
     type="button"
     class="clear"
            v-tip="t('download.clear')"
     :aria-label="t('download.clear')"
     @click="dl.clear()"
   >
     <Trash2 :size="14" />
          </button>
        </header>

        <p v-if="!dl.batches.length" class="empty">{{ t('download.empty') }}</p>

        <TransitionGroup v-else tag="div" name="rec" class="list">
   <section v-for="b in dl.batches" :key="b.id" class="batch" :class="{ expanded: expanded.has(b.id) }">
     <!-- 一批只有一条：直接显示那一条 -->
     <div v-if="b.items.length === 1" class="row single">
       <span class="thumb">
  <img v-if="b.items[0]!.cover" :src="imgSrc(b.items[0]!.cover)" alt="" loading="lazy" referrerpolicy="no-referrer" />
         <ImageOff v-else :size="14" />
         <img class="plat" :src="logo(b.platform)" alt="" />
       </span>
       <span class="text">
  <span v-tip.overflow="b.items[0]!.title || b.items[0]!.id" class="t">{{ b.items[0]!.title || b.items[0]!.id }}</span>
  <span v-tip.overflow="`${name(b.platform)} · ${since(b.created_at)} · ${itemStatus(b.items[0]!, b)}`" class="s" :class="[b.items[0]!.status, { warn: partial(b.items[0]!) }]">
    {{ name(b.platform) }} · {{ since(b.created_at) }} ·
    <span v-if="b.items[0]!.status === 'running'" class="running-text"><CatbusLoader :size="12" :label="t('download.status.runningLabel')" />{{ t('download.status.running') }}</span>
    <template v-else>{{ itemStatus(b.items[0]!, b) }}</template>
  </span>
</span>
       <template v-if="retryable(b.items[0]!)">
  <button v-if="b.items[0]!.verify_url" type="button" class="open warn" v-tip="t('download.action.verify')" :aria-label="t('download.action.verify')" @click="verifyThen(b, b.items[0]!)">
    <ShieldCheck :size="15" />
  </button>
  <button type="button" class="open" :class="{ hot: b.items[0]!.expired || pushFailed(b.items[0]!) }" v-tip="retryLabel(b.items[0]!)" :aria-label="retryLabel(b.items[0]!)" @click="retry(b.id)">
    <RotateCw :size="14" />
  </button>
       </template>
       <button v-if="savable(b)" type="button" class="open" v-tip="t('download.action.resave')" :aria-label="t('download.action.resave')" @click="dl.resave(b.id)">
  <Download :size="15" />
       </button>
       <button
         v-if="b.items[0]!.status !== 'running'"
  type="button"
  class="open del"
  v-tip="removeLabel(b.items[0]!.status)"
  :aria-label="removeLabel(b.items[0]!.status)"
  @click="remove(b.id)"
       >
         <X :size="15" />
       </button>
       <span v-tip="itemStatus(b.items[0]!, b)" class="ico-wrap" tabindex="0">
  <span v-if="b.items[0]!.status === 'running'" class="ico run-dot lg" aria-hidden="true" />
  <Clock v-else-if="b.items[0]!.status === 'queued'" class="ico" :size="16" />
  <AlertCircle v-else-if="b.items[0]!.status === 'failed'" class="ico bad" :size="16" />
  <TimerOff v-else-if="b.items[0]!.expired" class="ico" :size="16" />
  <CircleCheck v-else class="ico ok" :size="16" />
       </span>
     </div>

     <template v-else>
       <div
  class="row head-row"
  role="button"
  tabindex="0"
  :aria-expanded="expanded.has(b.id)"
  @click="toggleBatch(b.id)"
  @keydown.enter.self.prevent="toggleBatch(b.id)"
  @keydown.space.self.prevent="toggleBatch(b.id)"
       >
  <span class="stack">
    <span v-for="(it, i) in b.items.slice(0, 3)" :key="it.id" class="thumb" :style="{ '--i': i }">
      <img v-if="it.cover" :src="imgSrc(it.cover)" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <ImageOff v-else :size="14" />
    </span>
  </span>
         <span class="text">
    <span class="t">{{ t('download.batch.title', { platform: name(b.platform), n: b.items.length }, b.items.length) }}</span>
           <span v-tip.overflow="`${since(b.created_at)} · ${batchStatus(b)}`" class="s" :class="{ failed: counts(b).failed && !counts(b).busy }">{{ since(b.created_at) }} · {{ batchStatus(b) }}</span>
  </span>
         <span v-if="counts(b).busy" class="bar" aria-hidden="true">
           <span :style="{ width: `${((counts(b).done + counts(b).failed) / b.items.length) * 100}%` }" />
  </span>
                <template v-if="retryCount(b) && !counts(b).busy">
    <button v-if="firstVerify(b)" type="button" class="open warn" v-tip="t('download.action.verifyRetryFailed')" :aria-label="t('download.action.verifyRetryFailed')" @click.stop="verifyThen(b, firstVerify(b)!, true)">
      <ShieldCheck :size="15" />
    </button>
           <button type="button" class="open" v-tip="counts(b).failed ? t('download.action.retryFailed') : t('download.action.redownloadExpired')" :aria-label="counts(b).failed ? t('download.action.retryFailed') : t('download.action.redownloadExpired')" @click.stop="retry(b.id)">
      <RotateCw :size="14" />
    </button>
  </template>
  <button v-if="savable(b)" type="button" class="open" v-tip="t('download.action.resaveBatch')" :aria-label="t('download.action.resaveBatch')" @click.stop="dl.resave(b.id)">
    <Download :size="15" />
  </button>
  <button
    v-if="!b.items.some((it) => it.status === 'running')"
    type="button"
    class="open del"
           v-tip="t('download.action.removeBatch')"
    :aria-label="t('download.action.removeBatch')"
    @click.stop="remove(b.id)"
  >
    <X :size="15" />
         </button>
  <ChevronDown class="chev" :size="16" />
       </div>
       <div class="body">
  <div class="inner">
    <div v-for="it in b.items" :key="it.id" class="row sub">
      <span class="thumb sm">
 <img v-if="it.cover" :src="imgSrc(it.cover)" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <ImageOff v-else :size="12" />
      </span>
      <span class="text">
 <span v-tip.overflow="it.title || it.id" class="t">{{ it.title || it.id }}</span>
        <span v-tip.overflow="itemStatus(it, b)" class="s" :class="[it.status, { warn: partial(it) }]"><CatbusLoader v-if="it.status === 'running'" :size="12" :label="t('download.status.runningLabel')" />{{ itemStatus(it, b) }}</span>
      </span>
      <template v-if="retryable(it)">
 <button v-if="it.verify_url" type="button" class="open warn" v-tip="t('download.action.verify')" :aria-label="t('download.action.verify')" @click="verifyThen(b, it)">
   <ShieldCheck :size="14" />
        </button>
 <button type="button" class="open" :class="{ hot: it.expired || pushFailed(it) }" v-tip="retryLabel(it)" :aria-label="retryLabel(it)" @click="retry(b.id, it.id)">
   <RotateCw :size="13" />
        </button>
      </template>
      <button v-if="((it.status === 'done' && !it.expired) || pushFailedWithFiles(it)) && !counts(b).busy" type="button" class="open" v-tip="t('download.action.resave')" :aria-label="t('download.action.resave')" @click="dl.resave(b.id, it.id)">
 <Download :size="14" />
      </button>
      <button v-if="it.status !== 'running'" type="button" class="open del" v-tip="removeLabel(it.status)" :aria-label="removeLabel(it.status)" @click="remove(b.id, it.id)">
        <X :size="14" />
      </button>
      <span v-tip="itemStatus(it, b)" class="ico-wrap" tabindex="0">
 <span v-if="it.status === 'running'" class="ico run-dot" aria-hidden="true" />
 <Clock v-else-if="it.status === 'queued'" class="ico" :size="14" />
 <AlertCircle v-else-if="it.status === 'failed'" class="ico bad" :size="14" />
        <TimerOff v-else-if="it.expired" class="ico" :size="14" />
        <CircleCheck v-else class="ico ok" :size="14" />
      </span>
    </div>
         </div>
       </div>
     </template>
          </section>
        </TransitionGroup>
        <p class="note"><Download :size="12" aria-hidden="true" />{{ t('download.note') }}</p>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.center {
  position: relative;
  z-index: 10;
  flex: none;
}
.trigger {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  transition: color 0.2s, transform 0.2s var(--ease-out), box-shadow 0.2s;
}
.trigger:hover,
.trigger.on {
  color: var(--ink);
  transform: translateY(-1px);
}
.trigger.on {
  box-shadow: 0 0 0 3px var(--red-soft);
}
.pulse {
  position: absolute;
  top: 9px;
  right: 9px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--red);
  box-shadow: 0 0 0 0 #e8414f88;
  animation: pulse 1.4s ease-out infinite;
}
@keyframes pulse {
  to { box-shadow: 0 0 0 8px #e8414f00; }
}

.panel {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 30;
  width: 380px;
  max-width: calc(100vw - 24px - var(--safe-left) - var(--safe-right));
  max-height: min(70vh, 620px);
  display: flex;
  flex-direction: column;
  padding: 8px;
  border-radius: 22px;
  background: var(--glass-strong);
  box-shadow: 0 18px 50px #1b1f2e24;
  transform-origin: 90% 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 10px;
}
.title {
  font-size: 14px;
  font-weight: 700;
}
.n {
  flex: 1;
  font-size: 11px;
  color: var(--ink-3);
}
.clear {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  transition: color 0.2s, background 0.2s;
}
.clear:hover {
  color: var(--red);
  background: var(--red-soft);
}
.empty {
  margin: 0;
  padding: 18px 12px 22px;
  font-size: 12.5px;
  color: var(--ink-3);
  text-align: center;
}
.list {
  position: relative;
  overflow-y: auto;
  /* 删除的记录向右滑出时会横向溢出：不裁掉的话会闪一下横向滚动条 */
  overflow-x: hidden;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 2px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--ink) 22%, transparent) transparent;
}
.list::-webkit-scrollbar {
  width: 4px;
}
.list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.batch {
  border-radius: 16px;
  background: color-mix(in srgb, var(--ink) 3%, transparent);
  border: 1px solid var(--hair);
}
.row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  text-align: left;
}
.head-row {
  border-radius: 16px;
  transition: background 0.2s;
}
.head-row:hover {
  background: color-mix(in srgb, var(--glass-strong) 70%, transparent);
}
.thumb {
  position: relative;
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 10px;
  overflow: hidden;
  display: grid;
  place-items: center;
  color: var(--ink-3);
  background: var(--hair);
}
.single .thumb {
  overflow: visible;
}
/* 封面钉满缩略图框并裁成同样的圆角；不依赖百分比高度（grid 里不生效，竖图会撑出框） */
.thumb > img:not(.plat) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.thumb .plat {
  position: absolute;
  z-index: 1;
  right: -4px;
  bottom: -4px;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  box-shadow: 0 0 0 2px var(--glass-strong);
}
.thumb.sm {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}
.stack {
  position: relative;
  width: 56px;
  height: 40px;
  flex: none;
}
.stack .thumb {
  position: absolute;
  top: 0;
  left: calc(var(--i) * 8px);
  z-index: calc(3 - var(--i));
  box-shadow: 0 0 0 2px var(--glass-strong);
  transform: scale(calc(1 - var(--i) * 0.08));
}
.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.t {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub .t {
  font-size: 12.5px;
  font-weight: 500;
}
.s {
  font-size: 11px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.s.failed {
  color: var(--red);
}
/* 部分完成：评论遇到风控提前停止 */
.s.warn {
  color: #b7791f;
}
[data-theme='dark'] .s.warn {
  color: #f6c453;
}
.s.running,
.running-text {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ico {
  flex: none;
  color: var(--ink-3);
}
.ico.ok {
  color: var(--online);
}
.ico.bad {
  color: var(--red);
}
.run-dot {
  width: 7px;
  height: 7px;
  /* 外边距把占位补成与状态图标同样的方框（行内 14px、批次 16px），圆点与对勾、时钟中心对齐 */
  margin: 3.5px;
  border-radius: 50%;
  background: var(--red);
  box-shadow: 0 0 0 3px var(--red-soft);
}
.run-dot.lg {
  margin: 4.5px;
}
.ico-wrap {
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  outline: none;
}
.ico-wrap:focus-visible {
  box-shadow: 0 0 0 2px var(--red-soft);
}
.bar {
  width: 44px;
  height: 4px;
  border-radius: 2px;
  flex: none;
  overflow: hidden;
  background: var(--hair);
}
.bar > span {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--red);
  transition: width 0.4s var(--ease-out);
}
.chev {
  flex: none;
  color: var(--ink-3);
  transition: transform 0.3s var(--ease-out);
}
.batch.expanded .chev {
  transform: rotate(180deg);
}
/* 展开：grid 0fr → 1fr，带一点回弹 */
.body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.45s cubic-bezier(0.34, 1.3, 0.64, 1);
}
.batch.expanded .body {
  grid-template-rows: 1fr;
}
.inner {
  min-height: 0;
  overflow: hidden;
  padding: 0 6px;
}
.batch.expanded .inner {
  padding-bottom: 6px;
}
.row.sub {
  padding: 6px 8px;
  border-radius: 12px;
}
.note {
  flex: none;
  margin: 6px 4px 2px;
  padding: 7px 10px 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--hair);
  font-size: 11px;
  color: var(--ink-3);
}
.note svg {
  flex: none;
  color: var(--red);
}
/* 行内按钮：悬停该行时出现 */
.open {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-2);
  opacity: 0;
  transform: translateX(4px);
  transition: opacity 0.2s, transform 0.2s var(--ease-out), color 0.2s, background 0.2s;
}
.row:hover .open,
.open:focus-visible {
  opacity: 1;
  transform: none;
}
.open:hover {
  color: var(--ink);
  background: var(--hair);
}
/* 文件已过期：重新下载按钮常驻显示 */
.open.hot {
  opacity: 1;
  transform: none;
  color: var(--ink);
  background: var(--hair);
}
/* 去验证：失败且有验证链接时常驻显示，提醒用户 */
.open.warn {
  opacity: 1;
  transform: none;
  color: var(--red);
  background: var(--red-soft);
}
.open.del:hover {
  color: var(--red);
  background: var(--red-soft);
}
.head-row {
  cursor: pointer;
  outline: none;
}
.head-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--red-soft);
}
/* 删除记录：收起淡出，其余的平滑补位 */
.rec-move {
  transition: transform 0.35s var(--ease-out);
}
.rec-leave-active {
  position: absolute;
  left: 2px;
  right: 2px;
  transition: opacity 0.2s ease-in, transform 0.2s ease-in;
}
.rec-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.97);
}
@media (hover: none) {
  .open {
    opacity: 1;
    transform: none;
  }
  .trigger:hover:not(.on) {
    transform: none;
    color: var(--ink-2);
  }
}
@media (pointer: coarse) {
  .open,
  .clear {
    width: 40px;
    height: 40px;
  }
  .row {
    gap: 6px;
  }
}

/* 手机：底部弹层 */
.trigger {
  flex: none;
}
@media (max-width: 640px) {
  .trigger {
    width: var(--tap);
    height: var(--tap);
  }
  .pulse {
    top: 8px;
    right: 8px;
  }
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 44;
  background: #1b1f2e52;
  backdrop-filter: blur(2px);
}
.panel.sheet {
  position: fixed;
  top: auto;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 45;
  width: auto;
  max-width: none;
  max-height: 85dvh;
  padding: 0 calc(8px + var(--safe-right)) calc(10px + var(--safe-bottom)) calc(8px + var(--safe-left));
  border-radius: 24px 24px 0 0;
  border-bottom: 0;
  box-shadow: 0 -12px 40px #1b1f2e2e;
  transform-origin: 50% 100%;
  transition: transform 0.3s var(--ease-out);
}
.sheet .grip {
  flex: none;
  display: grid;
  place-items: center;
  height: 22px;
  touch-action: none;
  cursor: grab;
}
.sheet .grip > span {
  width: 38px;
  height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
}
.sheet .head {
  padding: 2px 10px 10px;
  touch-action: none;
}
.sheet .title {
  font-size: 15px;
}
.sheet .empty {
  padding: 24px 12px 32px;
}
.sheet .list {
  padding-bottom: 4px;
}
.scrim-enter-active,
.scrim-leave-active {
  transition: opacity 0.25s;
}
.scrim-enter-from,
.scrim-leave-to {
  opacity: 0;
}
.sheet-enter-active {
  transition: transform 0.42s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-leave-active {
  transition: transform 0.26s cubic-bezier(0.4, 0, 1, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%) !important;
}

.drop-enter-active {
  transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.22s ease-out;
}
.drop-leave-active {
  transition: transform 0.16s ease-in, opacity 0.16s ease-in;
}
.drop-enter-from,
.drop-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.95);
}
@media (prefers-reduced-motion: reduce) {
  .drop-enter-active,
  .drop-leave-active,
  .body {
    transition: opacity 0.2s;
  }
  .drop-enter-from,
  .drop-leave-to {
    transform: none;
  }
}
</style>
