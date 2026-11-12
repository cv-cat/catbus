import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { downloadApi, type Batch } from '@/api/download'
import type { Item } from '@/api/types'
import { toast } from '@/stores/toast'
import { t } from '@/i18n'

const busy = (b: Batch) => b.items.some((it) => it.status === 'queued' || it.status === 'running')
const retryable = (it: Batch['items'][number]) => it.status === 'failed' || (it.status === 'done' && !!it.expired)

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
      if (pendingBatches.has(b.id) && !busy(b)) {
        pendingBatches.delete(b.id)
        if (b.items.some((it) => it.status === 'done')) void deliver(b, undefined, undefined, true)
      }
      const r = pendingRetries.get(b.id)
      if (r && !b.items.some((it) => r.has(it.id) && (it.status === 'queued' || it.status === 'running'))) {
        pendingRetries.delete(b.id)
        const ok = b.items.filter((it) => r.has(it.id) && it.status === 'done').map((it) => it.id)
        if (ok.length === 1) void deliver(b, ok[0], undefined, true)
        else if (ok.length > 1) void deliver(b, undefined, ok, true)
      }
    }
  }

  /** 交给浏览器：自动交付和「重新保存」都走这里；文件已被清理时提示重新下载 */
  async function deliver(b: Batch, item?: string, only?: string[], auto = false) {
    try {
      const r = await downloadApi.deliver(b, item, only)
      if (r === 'expired') {
        toast(t('download.status.expired'), 3200)
        // 服务端已把条目标为已过期，刷新后出现重试按钮
        void refresh()
      } else toast(auto ? t('download.toast.done') : t('download.toast.saved'), 2400)
    } catch (e) {
      toast((e as Error).message, 3200)
    }
  }

  /** 重新保存：不给 item 时整批 */
  function resave(batch: string, item?: string) {
    const b = batches.value.find((x) => x.id === batch)
    if (b) return deliver(b, item)
  }

  async function start(platform: string, account: string | null, items: Item[]) {
    const batch = await downloadApi.start(platform, account, items)
    pendingBatches.add(batch.id)
    batches.value = [batch, ...batches.value.filter((b) => b.id !== batch.id)]
    schedule()
    return batch
  }

  async function retry(batch: string, item?: string) {
    const b = batches.value.find((x) => x.id === batch)
    const targets = (b?.items ?? []).filter((it) => retryable(it) && (item == null || it.id === item)).map((it) => it.id)
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
