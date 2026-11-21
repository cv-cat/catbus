import type { Comment, Item, UserRef } from '../types'
import { hash } from './shared'

// ---------- 演示下载：帖子信息、评论（与 CLI 写的 ExportDoc 同结构） ----------

/** 演示用的 ExportDoc 选项：与 DownloadOptions 的 comments / replies 一致（0 表示不取） */
interface DemoExportOpts {
  comments: number | 'all'
  replies: number | 'all'
}

export interface DemoExportDoc {
  schema: 1
  platform: string
  exported_at: string
  item: Item
  comments: (Comment & { replies: Comment[] })[]
  comments_truncated: boolean
}

/** 演示：按条目生成帖子信息和评论；取 1000 条或全部时模拟遇到风控、在第 87 条停下 */
export function demoExport(platform: string, it: { id: string; url: string; title: string | null; cover: string | null; kind: string | null }, o: DemoExportOpts): DemoExportDoc {
  const user = (n: number): UserRef => ({ id: `demo-u${n}`, name: `演示用户 ${n}`, url: null, avatar: null })
  const total = 40 + (hash(`export:${it.id}`) % 200)
  const big = o.comments === 'all' || o.comments === 1000
  const want = o.comments === 0 ? 0 : o.comments === 'all' ? total : Math.min(o.comments, total)
  const got = big ? Math.min(want, 87) : want
  const perReply = o.replies === 0 ? 0 : o.replies === 'all' ? 4 : Math.min(o.replies, 4)
  const comment = (id: string, parent: string | null, n: number): Comment => ({
    id, item_id: it.id, parent_id: parent, author: user(n), text: parent ? `演示回复 ${n}` : `演示评论 ${n}：这是演示数据。`,
    media: [], created_at: new Date(Date.now() - n * 3600_000).toISOString(), stats: { likes: hash(id) % 300, replies: parent ? null : perReply },
  })
  return {
    schema: 1,
    platform,
    exported_at: new Date().toISOString(),
    item: {
      id: it.id, kind: (it.kind as Item['kind']) ?? 'image', url: it.url, title: it.title, text: it.title ? `${it.title}\n\n这是演示数据。` : '这是演示数据。',
      author: user(0), created_at: new Date(Date.now() - 86400_000).toISOString(), cover: it.cover, media: [],
      stats: { views: null, likes: hash(`likes:${it.id}`) % 9999, comments: total, collects: hash(`col:${it.id}`) % 999, shares: null },
      price: null, status: null,
    } as Item,
    comments: Array.from({ length: got }, (_, i) => ({
      ...comment(`${it.id}-c${i + 1}`, null, i + 1),
      replies: Array.from({ length: perReply }, (_, k) => comment(`${it.id}-c${i + 1}-r${k + 1}`, `${it.id}-c${i + 1}`, k + 1)),
    })),
    comments_truncated: big && want > got,
  }
}

/** 演示：一条帖子的纯文本（真实下载时由 bridge 生成） */
export function demoText(doc: DemoExportDoc): string {
  const { item } = doc
  const lines = [`标题：${item.title || '（无标题）'}`, `作者：${item.author?.name ?? ''}`, `链接：${item.url ?? ''}`, '', item.text ?? '', '']
  if (doc.comments.length) {
    lines.push(`评论（${doc.comments.length} 条${doc.comments_truncated ? '，遇到风控已停止' : ''}）`)
    for (const c of doc.comments) {
      lines.push(`${c.author?.name ?? ''}：${c.text}`)
      for (const r of c.replies) lines.push(`  ↳ ${r.author?.name ?? ''}：${r.text}`)
    }
  }
  return lines.join('\n')
}

// 12306 演示数据：取自 catbus 12306 的真实输出（2026-11-16 北京南 → 上海虹桥，已裁剪），日期在使用时换成查询的日期
/** 车站：[站名, 电报码, 拼音, 简拼, 城市] */
