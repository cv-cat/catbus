import { isDemo } from '@/stores/source'
import type { CatbusError, Item } from './types'
import { BridgeError } from './client'
import { t } from '@/i18n'
import type { CommentLimit, ExportFormat, ReplyLimit } from '@/stores/settings'
import { demoExport, demoText } from './mock'

// 与 server/download.ts 的结构一致
export type ItemStatus = 'queued' | 'running' | 'done' | 'failed'

export interface DownloadItem {
  id: string
  url: string
  title: string | null
  cover: string | null
  kind: string | null
  dir: string
  status: ItemStatus
  files: string[]
  error: string | null
  code?: string | null
  verify_url?: string | null
  /** 临时文件已被清理（过期或被删），要重新下载 */
  expired?: boolean
  /** CLI 写的帖子信息文件；没有导出信息时为 null */
  data?: string | null
  /** 这一条取到了什么（下载完成后才有） */
  got?: ItemGot | null
}

export interface ItemGot {
  media: number
  meta: boolean
  /** 一级评论条数；没取评论时为 null */
  comments: number | null
  replies: number
  /** 遇到风控提前停止 */
  truncated: boolean
}

/** 一批下载的内容与格式（AGENTS.md 7.9「批量选择与下载」），与 bridge 的 DownloadOptions 一致 */
export interface DownloadOptions {
  media: boolean
  meta: boolean
  comments: 0 | CommentLimit
  replies: 0 | ReplyLimit
  format: ExportFormat
}

export interface Batch {
  v?: 2
  id: string
  platform: string
  account: string | null
  dir: string
  created_at: string
  finished_at?: string | null
  /** 旧版 bridge 的记录没有：只下了媒体 */
  opts?: DownloadOptions
  items: DownloadItem[]
}

/** 交付的结果：expired 表示服务端的临时文件已被清理（410） */
/** demo-xlsx：演示模式下 Excel 退化成了 JSON，提示一下 */
export type DeliverResult = 'ok' | 'expired' | 'demo-xlsx'

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: CatbusError }
  if (!res.ok) throw body.error ? new BridgeError(body.error) : new Error(t('download.error.requestFailed', { status: res.status }))
  return body
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ---------- 演示数据：在页面里模拟下载进度 ----------

let demo: Batch[] = []
/** 演示：重试过的不再失败，模拟「验证后重试成功」 */
const retried = new Set<string>()

function demoTick() {
  for (const b of [...demo].reverse()) {
    const running = b.items.find((it) => it.status === 'running')
    if (running) {
      const fail = !retried.has(running.id) && running.id.charCodeAt(running.id.length - 1) % 7 === 0
      Object.assign(running, fail
        ? { status: 'failed', error: '小红书要求人机验证（HTTP 461）（演示）', code: 'RISK_CONTROL', verify_url: 'https://www.xiaohongshu.com/website-login/captcha?verifyBiz=461' } // i18n-ignore 演示数据：模拟 CLI 的中文报错
        : { status: 'done', ...demoDone(b, running) })
      return
    }
    const next = b.items.find((it) => it.status === 'queued')
    if (next) return void (next.status = 'running')
  }
}
/** 演示：按这一批的选项给出文件和「取到了什么」；评论条数在 1000 / 全部时模拟遇到风控提前停止 */
function demoDone(b: Batch, it: DownloadItem): Pick<DownloadItem, 'files' | 'data' | 'got'> {
  const o = b.opts
  const files = o?.media === false ? [] : [`${it.dir}/${b.platform}_${it.id}_1.jpg`]
  if (!o?.meta) return { files, data: null, got: { media: files.length, meta: false, comments: null, replies: 0, truncated: false } }
  const data = `${it.dir}/${b.platform}_${it.id}.json`
  const doc = demoExport(b.platform, it, o)
  const replies = doc.comments.reduce((n, c) => n + c.replies.length, 0)
  return { files: [...files, data], data, got: { media: files.length, meta: true, comments: o.comments ? doc.comments.length : null, replies, truncated: doc.comments_truncated } }
}

/** 演示的进度定时器：第一次在演示模式下开始下载时才启动（这时 pinia 早已激活），不在模块加载时就跑 */
let ticker: ReturnType<typeof setInterval> | undefined
function startDemoTicker() {
  ticker ??= setInterval(() => isDemo() && demoTick(), 700)
}

/** 取文件的地址：只带批次和条目 ID，不带任何路径 */
export function fileUrl(batch: string, item?: string, only?: string[]): string {
  const base = `/api/download/${encodeURIComponent(batch)}`
  if (item != null) return `${base}/${encodeURIComponent(item)}/file`
  const q = new URLSearchParams()
  for (const id of only ?? []) q.append('item', id)
  const qs = q.toString()
  return `${base}/file${qs ? `?${qs}` : ''}`
}

/** 隐藏的 <a href download>：浏览器按响应头的文件名保存，不打开新窗口 */
function trigger(href: string, name = '') {
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const clone = (b: Batch[]) => JSON.parse(JSON.stringify(b)) as Batch[]

export const downloadApi = {
  async start(platform: string, account: string | null, items: Item[], opts: DownloadOptions): Promise<Batch> {
    const payload = items.map((it) => ({ id: it.id, url: it.url, title: it.title || it.text, cover: it.cover, kind: it.kind }))
    if (isDemo()) {
      const batch: Batch = {
        id: `demo-${Date.now()}`,
        platform,
        account,
        opts,
        dir: `demo/${platform}`,
        created_at: new Date().toISOString(),
               items: payload.map((it) => ({
          ...it,
   title: it.title ?? null,
   cover: it.cover ?? null,
          dir: `demo/${platform}/${(it.title || it.id).slice(0, 60)}`,
          status: 'queued',
   files: [],
   error: null,
        })),
      }
      demo.unshift(batch)
      startDemoTicker()
      return batch
    }
    return (await json<{ batch: Batch }>(await post('/api/download/start', { platform, account, items: payload, ...opts }))).batch
  },

  /** 失败的、文件已过期的重新排队（不给 item 时整批都重试） */
  async retry(batch: string, item?: string): Promise<Batch[]> {
    if (isDemo()) {
      for (const it of demo.find((x) => x.id === batch)?.items ?? []) {
        if (!(it.status === 'failed' || (it.status === 'done' && it.expired)) || (item != null && it.id !== item)) continue
        retried.add(it.id)
        Object.assign(it, { status: 'queued', files: [], error: null, code: null, verify_url: null, expired: false })
      }
      return clone(demo)
    }
    return (await json<{ batches: Batch[] }>(await post('/api/download/retry', { batch, item }))).batches
  },

  /** 删一条记录（不给 item 时删整批），连同服务端的临时文件 */
  async remove(batch: string, item?: string): Promise<Batch[]> {
    if (isDemo()) {
      const b = demo.find((x) => x.id === batch)
      if (b) {
        const gone = (it: DownloadItem) => item == null || it.id === item
 if (b.items.some((it) => gone(it) && it.status === 'running')) throw new Error(t('download.error.busy'))
        b.items = b.items.filter((it) => !gone(it))
        if (!b.items.length) demo = demo.filter((x) => x !== b)
      }
      return clone(demo)
    }
    return (await json<{ batches: Batch[] }>(await post('/api/download/remove', { batch, item }))).batches
  },

  /**
   * 把文件交给浏览器保存（AGENTS.md 7.9）：不给 item 时整批，给 only 时只要这几条。
   * 先 HEAD 确认文件还在（anchor 下载失败时页面无从得知），再用隐藏的 <a download> 触发，
   * 同源请求自动带访问令牌的 cookie。演示模式下在页面里生成一个说明文件。
   */
  async deliver(b: Batch, item?: string, only?: string[]): Promise<DeliverResult> {
    if (isDemo()) {
      const picked = b.items.filter((it) => it.status === 'done' && (item != null ? it.id === item : !only?.length || only.includes(it.id)))
      // 下了信息：按格式在页面里生成导出文件（xlsx 不进前端包，退化成 json）
      if (b.opts?.meta) {
        const docs = picked.map((it) => demoExport(b.platform, it, b.opts!))
        const asText = b.opts.format === 'txt'
        const body = asText ? docs.map(demoText).join('\n\n') : JSON.stringify(docs.length === 1 ? docs[0] : docs, null, 2)
        const url = URL.createObjectURL(new Blob([body], { type: asText ? 'text/plain;charset=utf-8' : 'application/json' }))
        trigger(url, `catbus-demo-${b.platform}-${stamp()}.${asText ? 'txt' : 'json'}`)
        setTimeout(() => URL.revokeObjectURL(url), 30_000)
        return b.opts.format === 'xlsx' ? 'demo-xlsx' : 'ok'
      }
      const text = [
        t('download.demoFile.title'),
        '',
        t('download.demoFile.platform', { platform: b.platform }),
        t('download.demoFile.items', { n: picked.length }, picked.length),
        ...picked.map((it) => `  · ${it.title || it.id}`),
        '',
        t('download.demoFile.about'),
        t('download.demoFile.real'),
        '',
      ].join('\n')
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
      trigger(url, `catbus-demo-${b.platform}-${stamp()}.txt`)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      return 'ok'
    }
    const url = fileUrl(b.id, item, only)
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (head.status === 410) return 'expired'
    if (!head.ok) throw new Error(head.status === 404 ? t('download.error.nothing') : t('download.error.saveFailed', { status: head.status }))
    trigger(url)
    return 'ok'
  },

  async list(): Promise<Batch[]> {
    if (isDemo()) return clone(demo)
    return (await json<{ batches: Batch[] }>(await fetch('/api/download/list'))).batches
  },

  async clear(): Promise<Batch[]> {
    if (isDemo()) {
      demo = demo.filter((b) => b.items.some((it) => it.status === 'queued' || it.status === 'running'))
      return clone(demo)
    }
    return (await json<{ batches: Batch[] }>(await post('/api/download/clear', null))).batches
  },
}
