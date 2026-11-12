/** 12000 → 1.2w，与平台的显示习惯一致 */
export function compact(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e8) return `${trim(n / 1e8)}亿`
  if (n >= 1e4) return `${trim(n / 1e4)}w`
  return n.toLocaleString('en-US')
}

function trim(v: number): string {
  return v.toFixed(1).replace(/\.0$/, '')
}

/** 字节 → 「20.8 GB」（1024 进制，三位有效数字） */
export function bytes(n: number | null | undefined): string | null {
  if (n == null || n < 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 || v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`
}

export function duration(sec: number | null | undefined): string | null {
  if (!sec) return null
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** ISO 时间 → 「刚刚登录」「3 小时前登录」「2 天前登录」 */
export function since(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return ''
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000))
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  if (m < 1440) return `${Math.floor(m / 60)} 小时前`
  if (m < 43_200) return `${Math.floor(m / 1440)} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

/** 头像占位色：按用户 id 哈希取一种品牌色 */
const PALETTE = ['#E8414F', '#5A6BD8', '#F0B429', '#2BA673', '#8E5CD9']
export function tintOf(id: string | null | undefined): string {
  let h = 2166136261
  for (const c of id ?? '') h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return PALETTE[(h >>> 0) % PALETTE.length]!
}

/** 头像占位里的首字 */
export const initial = (name: string | null | undefined) => (name?.trim() || '?').slice(0, 1).toUpperCase()
