/**
 * 叠在 B 站原生播放器上的弹幕（AGENTS.md 7.9「详情卡片」的「媒体」）：
 * `danmaku list --raw` 的原始字段带类型（mode）、颜色、字号；旧版 CLI 没有原始字段时只有时间和文字，按白色滚动弹幕显示。
 */
import { getRawDanmaku } from '@/api/extras'
import type { Item } from '@/api/types'

export type DanmakuKind = 'scroll' | 'top' | 'bottom'
export interface DanmakuItem {
  /** 视频内的秒数 */
  t: number
  kind: DanmakuKind
  /** #RRGGBB */
  color: string
  /** B 站的字号（默认 25），显示时按画面高度缩放 */
  size: number
  text: string
}

/** mode：1–3 滚动、6 逆向（也按滚动显示）、4 底部、5 顶部；7 高级、8 代码、9 BAS 不显示 */
function kindOf(mode: unknown): DanmakuKind | null {
  const m = typeof mode === 'number' ? mode : 1
  if (m === 4) return 'bottom'
  if (m === 5) return 'top'
  if (m >= 1 && m <= 3) return 'scroll'
  if (m === 6) return 'scroll'
  return null
}

export function toDanmakuItems(raw: readonly Record<string, any>[]): DanmakuItem[] {
  const out: DanmakuItem[] = []
  for (const r of raw) {
    const text = typeof r.content === 'string' ? r.content : typeof r.text === 'string' ? r.text : ''
    const kind = kindOf(r.mode)
    if (!text.trim() || !kind) continue
    // progress 是毫秒；为 0 时 protobuf 不写这个字段（null）。旧版 CLI 只有归一化的 offset（秒）
    const t = typeof r.progress === 'number' ? r.progress / 1000 : typeof r.offset === 'number' ? r.offset : 0
    const color = typeof r.color === 'number' && r.color >= 0 && r.color <= 0xffffff ? `#${r.color.toString(16).padStart(6, '0')}` : '#ffffff'
    const size = typeof r.fontsize === 'number' && r.fontsize > 0 ? r.fontsize : 25
    out.push({ t, kind, color, size, text: text.replace(/\s+/g, ' ') })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** 本页会话里按「平台 + 条目」缓存（只在内存里），切回同一条不再请求 */
const cache = new Map<string, Promise<DanmakuItem[]>>()
export function loadDanmaku(platform: string, item: Item, account?: string | null): Promise<DanmakuItem[]> {
  const key = `${platform}:${item.id}`
  let p = cache.get(key)
  if (!p) {
    p = getRawDanmaku(platform, item, account)
      .then((env) => (env.ok ? toDanmakuItems(env.data ?? []) : []))
      .catch(() => [])
    // 取不到的不缓存，下次打开再试
    p.then((list) => !list.length && cache.delete(key))
    cache.set(key, p)
  }
  return p
}
