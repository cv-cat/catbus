import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { downloadApi, pushFailedWithFiles, QBIT_PLATFORMS, type Batch, type DownloadOptions } from '@/api/download'
import { useSettingsStore } from '@/stores/settings'
import type { Item } from '@/api/types'
import { toast } from '@/stores/toast'
import { t } from '@/i18n'

/**
 * 下载面板上次的选择 → 这一批的下载选项：勾了评论就隐含信息，条数取设置里的值。
 * `comments` 为 false 时（这些平台都没有评论）不取评论。
 */
export function downloadOptions(comments = true, platform?: string): DownloadOptions {
  const s = useSettingsStore().settings
  const withComments = s.dlComments && comments
  const push = s.qbit && platform != null && QBIT_PLATFORMS.includes(platform)
  // 推送要先有种子文件：推送时总是下载媒体（只推送时页面不交给浏览器）
  const media = s.dlMedia || push || (!s.dlMeta && !withComments)
  return {
    media,
    meta: s.dlMeta || withComments,
    comments: withComments ? s.commentLimit : 0,
    replies: withComments ? s.replyLimit : 0,
    format: s.dlFormat,
    qbit: push ? { category: s.qbitCategory.trim() || QBIT_DEFAULT_CATEGORY, savepath: s.qbitSavepath.trim() || null, paused: s.qbitPaused } : null,
  }
}

export const QBIT_DEFAULT_CATEGORY = 'mteam'
// 与 bridge 的校验一致（src/webui/download.ts）：控制字符一律拒绝；分类另外拒绝路径和通配符字符
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f]/
/** 分类不合法时的原因 key；合法时 null */
export function qbitCategoryError(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (s.length > 64 || CTRL.test(s) || /[\\/:*?"<>|]/.test(s)) return 'download.qbit.categoryInvalid'
  return null
}
/** 保存目录：可空；不空时必须是绝对路径（/ 开头或 Windows 盘符），不含控制字符和 `..` 段 */
export function qbitSavepathError(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (s.length > 512 || CTRL.test(s) || !/^(\/|[A-Za-z]:[\\/])/.test(s) || s.split(/[\\/]/).includes('..')) return 'download.qbit.savepathInvalid'
  return null
}

const busy = (b: Batch) => b.items.some((it) => it.status === 'queued' || it.status === 'running')
const retryable = (it: Batch['items'][number]) => it.status === 'failed' || (it.status === 'done' && !!it.expired)
/** 交给浏览器的条目：成功的，以及推送失败但种子已保存的 */
const deliverable = (it: Batch['items'][number]) => it.status === 'done' || pushFailedWithFiles(it)

/**
 * 下载记录（AGENTS.md 7.9「批量选择与下载」）：顶栏的下载列表和详情卡片共用。
 *
 * 服务端把文件下到临时目录，这里负责交给浏览器：本页发起的一批全部结束后自动交付一次，
 * 本页重试的条目结束后单独交付一次。这些待交付的记号只在内存里，刷新页面后不再自动触发，
 * 靠下载记录里的「重新保存」。
 */
export const useDownloadsStore = defineStore('downloads', () => {
  const batches = shallowRef<Batch[]>([])
  const open = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 本页发起、还没交付的批次 */
  const pendingBatches = new Set<string>()
  /** 本页重试、还没交付的条目：批次 → 条目 ID */
  const pendingRetries = new Map<string, Set<string>>()
  /** 本页发起的只推送批次（没勾种子文件）：不交给浏览器 */
  const pushOnly = new Set<string>()
  /** 重试时已经有种子文件的条目（推送失败的）：重试后不再重复交付 */
  const retriedHadFiles = new Map<string, Set<string>>()

  const active = computed(() => batches.value.some(busy))

  function set(next: Batch[]) {
    batches.value = next
    deliverFinished()
  }

  async function refresh() {
    try {
      set(await downloadApi.list())
    } catch {
      // bridge 不可用时保持原样
    }
    schedule()
  }

  /** 有批次在跑时每 1.2 秒刷新一次，跑完就停 */
  function schedule() {
    clearTimeout(timer)
    if (active.value) timer = setTimeout(refresh, 1200)
  }

  /** 结束了的待交付批次 / 条目：把成功的交给浏览器 */
  function deliverFinished() {
    const ids = new Set(batches.value.map((b) => b.id))
    for (const id of pendingBatches) if (!ids.has(id)) pendingBatches.delete(id)
    for (const id of pendingRetries.keys()) if (!ids.has(id)) pendingRetries.delete(id)
    for (const b of batches.value) {
      const push = !!b.opts?.qbit
      if (pendingBatches.has(b.id) && !busy(b)) {
        pendingBatches.delete(b.id)
        // 只推送（没勾种子文件）的一批不交给浏览器
        if (!pushOnly.has(b.id) && b.items.some(deliverable)) void deliver(b, undefined, undefined, true, push)
        if (push) pushSummary(b, b.items)
      }
      const r = pendingRetries.get(b.id)
      if (r && !b.items.some((it) => r.has(it.id) && (it.status === 'queued' || it.status === 'running'))) {
        pendingRetries.delete(b.id)
        const had = retriedHadFiles.get(b.id)
        retriedHadFiles.delete(b.id)
        // 重试推送时种子文件早已交付过（或本来只推送）：不再重复交付
        const ok = b.items.filter((it) => r.has(it.id) && deliverable(it) && !had?.has(it.id) && !pushOnly.has(b.id)).map((it) => it.id)
        if (ok.length === 1) void deliver(b, ok[0], undefined, true, push)
        else if (ok.length > 1) void deliver(b, undefined, ok, true, push)
        if (push) pushSummary(b, b.items.filter((it) => r.has(it.id)))
      }
    }
  }

  /** 一批（或重试的几条）推送结束后的汇总提示：全部推送成功、部分已在任务列表、有推送失败（带「重试推送」） */
  function pushSummary(b: Batch, items: Batch['items']) {
    const pushed = items.filter((it) => it.qbit)
    if (!pushed.length) return
    const n = (s: string) => pushed.filter((it) => it.qbit!.status === s).length
    const failed = n('failed')
    const exists = n('exists')
    if (failed) {
      toast(t('download.qbit.toast.failed', { n: failed }, failed), 8000, { label: t('download.qbit.retry'), run: () => void retry(b.id) })
    } else if (exists) {
      toast(t('download.qbit.toast.exists', { added: n('added'), exists }), 4200)
    } else toast(t('download.qbit.toast.added', { n: pushed.length }, pushed.length), 3200)
  }

  /** 交给浏览器：自动交付和「重新保存」都走这里；文件已被清理时提示重新下载。quiet：推送的一批由汇总提示代替「已交给浏览器」 */
  async function deliver(b: Batch, item?: string, only?: string[], auto = false, quiet = false) {
    try {
      const r = await downloadApi.deliver(b, item, only)
      if (r === 'demo-xlsx') toast(t('download.toast.demoXlsx'), 3600)
      else if (r === 'expired') {
        toast(t('download.status.expired'), 3200)
        // 服务端已把条目标为已过期，刷新后出现重试按钮
        void refresh()
      } else if (!quiet) toast(auto ? t('download.toast.done') : t('download.toast.saved'), 2400)
    } catch (e) {
      toast((e as Error).message, 3200)
    }
  }

  /** 重新保存：不给 item 时整批 */
  function resave(batch: string, item?: string) {
    const b = batches.value.find((x) => x.id === batch)
    if (b) return deliver(b, item)
  }

  /** 按下载面板上次的选择下载；comments 为 false 表示这个平台没有评论 */
  async function start(platform: string, account: string | null, items: Item[], comments = true) {
    const opts = downloadOptions(comments, platform)
    const s = useSettingsStore().settings
    const batch = await downloadApi.start(platform, account, items, opts)
    pendingBatches.add(batch.id)
    if (opts.qbit && !s.dlMedia) pushOnly.add(batch.id)
    batches.value = [batch, ...batches.value.filter((b) => b.id !== batch.id)]
    schedule()
    return batch
  }

  async function retry(batch: string, item?: string) {
    const b = batches.value.find((x) => x.id === batch)
    const picked = (b?.items ?? []).filter((it) => retryable(it) && (item == null || it.id === item))
    const targets = picked.map((it) => it.id)
    const had = picked.filter(pushFailedWithFiles).map((it) => it.id)
    if (had.length) retriedHadFiles.set(batch, new Set([...(retriedHadFiles.get(batch) ?? []), ...had]))
    set(await downloadApi.retry(batch, item))
    // 整批还没交付时，重试的条目跟着整批一起交付，不单独交付
    if (!pendingBatches.has(batch) && targets.length) {
      const r = pendingRetries.get(batch) ?? new Set<string>()
      for (const id of targets) r.add(id)
      pendingRetries.set(batch, r)
    }
    schedule()
  }

  async function remove(batch: string, item?: string) {
    set(await downloadApi.remove(batch, item))
    schedule()
  }

  async function clear() {
    set(await downloadApi.clear())
  }

  return { batches, open, active, refresh, start, retry, resave, remove, clear }
})
