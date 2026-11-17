import type { Item } from '@/api/types'
import { cleanItem } from '@/stores/local'
import { t } from '@/i18n'

/**
 * 导出已加载的列表（AGENTS.md 7.9「导出已加载的列表」）：只用页面上已有的数据，不经服务端、不再请求平台。
 * CSV 带 UTF-8 BOM（Excel 直接打开不乱码），表头按当前界面语言写（export.columns.*），
 * JSON 为 `{schema: 1, exported_at, items: [{platform, item}]}`。
 */
export type ExportFormat = 'csv' | 'json'
export interface ExportRow {
  platform: string
  item: Item
}

const COLUMNS = ['platform', 'id', 'kind', 'title', 'text', 'author', 'author_url', 'created_at', 'views', 'likes', 'comments', 'collects', 'shares', 'price', 'url'] as const
const TORRENT = ['size', 'seeders', 'leechers'] as const

/** RFC 4180：含逗号、引号、换行的值用双引号包起来，引号写两个 */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: ExportRow[]): string {
  const torrent = rows.some((r) => r.item.kind === 'torrent')
  const head = [...COLUMNS, ...(torrent ? TORRENT : [])].map((k) => t(`export.columns.${k}`))
  const lines = [head.map(csvCell).join(',')]
  for (const { platform, item: i } of rows) {
    const cells: unknown[] = [
      platform,
      i.id,
      i.kind,
      i.title,
      i.text,
      i.author?.name,
      i.author?.url,
      i.created_at,
      i.stats.views,
      i.stats.likes,
      i.stats.comments,
      i.stats.collects,
      i.stats.shares,
      i.price ? `${i.price.amount} ${i.price.currency}` : null,
      i.url,
    ]
    if (torrent) cells.push(i.size, i.seeders, i.leechers)
    lines.push(cells.map(csvCell).join(','))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

export function toJson(rows: ExportRow[], now = new Date()): string {
  const items = rows.map(({ platform, item }) => ({ platform, item: cleanItem(item) ?? item }))
  return JSON.stringify({ schema: 1, exported_at: now.toISOString(), items }, null, 2)
}

const pad = (n: number) => String(n).padStart(2, '0')
export function exportName(rows: ExportRow[], format: ExportFormat, now = new Date()): string {
  const ps = new Set(rows.map((r) => r.platform))
  const who = ps.size === 1 ? [...ps][0] : 'mixed'
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `catbus-${who}-${ts}.${format}`
}

/** 生成文件交给浏览器保存 */
export function exportList(rows: ExportRow[], format: ExportFormat) {
  if (!rows.length) return
  const body = format === 'csv' ? toCsv(rows) : toJson(rows)
  const blob = new Blob([body], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = exportName(rows, format)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
