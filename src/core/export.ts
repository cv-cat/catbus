import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CatbusError } from './errors.js'
import { isoNow, writeFileAtomic } from './fsutil.js'
import * as rand from './rand.js'
import type { AvailableEndpoint, HandlerContext, Page } from './registry.js'
import type { Comment, File, Item } from './schemas.js'

/**
 * `item download` 的帖子信息与评论导出（AGENTS 4.9「下载」）：`--meta`、`--comments`、`--replies`、`--no-media`。
 *
 * 在 core 里通用实现，不逐个平台改：下载结束后在进程内调用同一平台、同一端自己的 `item get`、`comment list`、
 * `comment replies` handler（同一份凭证、同一个网络配置），拼成 ExportDoc 写进 item 的下载目录。
 */

export interface ExportComment extends Comment {
  /** 这条一级评论的回复（楼中楼）；没取时为 []。 */
  replies: Comment[]
}

export interface ExportDoc {
  schema: 1
  platform: string
  exported_at: string
  item: Item
  comments: ExportComment[]
  /** 取评论中途遇到风控（RISK_CONTROL）而停下时为 true，已经取到的照样写出。 */
  comments_truncated: boolean
}

export interface ExportSettings {
  /** 是否下载媒体（`--no-media` 时为 false）。 */
  media: boolean
  /** 是否写 ExportDoc。`--comments`、`--no-media` 隐含它。 */
  meta: boolean
  /** 一级评论条数：0 不取，Infinity 为 all。 */
  comments: number
  /** 每条一级评论的回复条数：0 不取，Infinity 为 all。 */
  replies: number
}

const count = (v: unknown): number => (v == null ? 0 : v === 'all' ? Infinity : Number(v))

/** 从 `item download` 的选项读出导出设置。 */
export function exportSettings(options: Record<string, unknown>, log?: HandlerContext['log']): ExportSettings {
  if (options.replies != null && options.comments == null) log?.warn('--replies 要和 --comments 一起用，本次不取回复')
  const media = !options.noMedia
  const comments = count(options.comments)
  const replies = comments > 0 ? count(options.replies) : 0
  return { media, meta: Boolean(options.meta) || comments > 0 || !media, comments, replies }
}

/** ExportDoc 的文件名：`<platform>_<id>.json`，与媒体文件 `<platform>_<id>_<序号>.<ext>` 放在同一个目录。 */
export function exportFileName(platform: string, itemId: string): string {
  return `${platform}_${itemId}.json`
}

type Paged = { data: unknown[]; page: Page }

/** 在进程内调用同一平台、同一端的另一条命令。没有这条命令或还没实现时返回 null。 */
async function sibling(ctx: HandlerContext, key: string) {
  const ep = ctx.platform.endpoints[ctx.endpoint] as AvailableEndpoint
  const command = ep.commands.get(key)
  if (!command || command.status !== 'implemented' || !command.handler) return null
  const handler = await command.handler()
  // 选项只用这条命令自己的默认值（例如评论排序），不带 item download 的选项
  const parsed = z.object(command.options).safeParse({})
  const options = parsed.success ? (parsed.data as Record<string, unknown>) : {}
  return (args: Record<string, string | undefined>, cursor: string | null = null) =>
    handler({ ...ctx, resource: command.resource, action: command.action, args, options, cursor, raw: false }) as Promise<unknown>
}

/**
 * 自动翻页取满 `target` 条（Infinity 为全部），翻页间隔用平台默认值。
 * 遇到风控（RISK_CONTROL）时停下，返回已经取到的，`risk` 为风控的说明。
 */
async function collect(ctx: HandlerContext, call: (cursor: string | null) => Promise<unknown>, target: number): Promise<{ data: Comment[]; risk: string | null }> {
  const out: Comment[] = []
  let cursor: string | null = null
  for (;;) {
    let result: Paged
    try {
      result = (await call(cursor)) as Paged
    } catch (err) {
      if (err instanceof CatbusError && err.code === 'RISK_CONTROL') return { data: out.slice(0, target), risk: err.message }
      throw err
    }
    out.push(...(result.data as Comment[]))
    const page = result.page
    if (out.length >= target || !page?.has_more || page.cursor == null || page.cursor === cursor) break
    cursor = page.cursor
    await rand.sleep(ctx.platform.pageInterval, ctx.signal)
  }
  return { data: out.slice(0, target), risk: null }
}

/** 去掉 handler 挂上的原始对象（不可枚举，序列化时本来就丢弃），得到纯数据。 */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * 取帖子信息和评论，拼成 ExportDoc 写进 `dir`，返回对应的 File（`type: data`）。
 * `item` 用命令本身的 `<item>` 参数（xhs 的 URL 带 xsec_token，原样传给 item get 和 comment list）；
 * `itemId` 只用于文件名。已有文件默认跳过（不发请求），`--overwrite` 时重新导出。
 */
export async function exportItem(ctx: HandlerContext, itemId: string, dir: string, settings: ExportSettings = exportSettings(ctx.options)): Promise<File> {
  const path = join(dir, exportFileName(ctx.platform.id, itemId))
  const existing = await stat(path).catch(() => null)
  if (existing && !ctx.options.overwrite) {
    ctx.log.info(`已存在，跳过：${path}`)
    return { path, type: 'data', url: null, size: existing.size }
  }

  const item = ctx.args.item ?? itemId
  const get = await sibling(ctx, 'item get')
  if (!get) throw new CatbusError('UNSUPPORTED', `${ctx.platform.id} 没有 item get，不能导出帖子信息`)
  ctx.log.info('导出帖子信息')
  const doc: ExportDoc = { schema: 1, platform: ctx.platform.id, exported_at: isoNow(new Date(rand.now())), item: plain((await get({ item })) as Item), comments: [], comments_truncated: false }

  if (settings.comments > 0) {
    const list = await sibling(ctx, 'comment list')
    if (!list) ctx.log.warn(`${ctx.platform.id} 没有 comment list，不导出评论`)
    else {
      const replies = settings.replies > 0 ? await sibling(ctx, 'comment replies') : null
      if (settings.replies > 0 && !replies) ctx.log.warn(`${ctx.platform.id} 没有 comment replies，不导出评论的回复`)
      let risk: string | null
      const top = await collect(ctx, (cursor) => list({ item }, cursor), settings.comments)
      doc.comments = top.data.map((c) => ({ ...plain(c), replies: [] }))
      risk = top.risk
      ctx.log.info(`已取 ${doc.comments.length} 条评论`)
      if (replies && risk == null) {
        for (const c of doc.comments) {
          // 平台给了回复数且为 0 时不发请求
          if (c.stats?.replies === 0) continue
          await rand.sleep(ctx.platform.pageInterval, ctx.signal)
          const sub = await collect(ctx, (cursor) => replies({ item, comment: c.id }, cursor), settings.replies)
          c.replies = plain(sub.data)
          if ((risk = sub.risk) != null) break
        }
      }
      if (risk != null) {
        doc.comments_truncated = true
        ctx.log.warn(`取评论时遇到风控，已停止：${risk}。已经取到的照样写出`)
      }
    }
  }

  const text = JSON.stringify(doc, null, 2) + '\n'
  await writeFileAtomic(path, text)
  return { path, type: 'data', url: null, size: Buffer.byteLength(text) }
}
