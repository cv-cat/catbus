import { RAW } from '../core/schemas.js'
import { count, when } from './text.js'

// 把归一化对象（AGENTS 6.2）变成表格的列和详情的行。纯函数，不含 React。
// 按字段形状认类型，不依赖命令名：新增平台返回同样的类型，界面不用改。

export type Tone = 'ok' | 'warn' | 'dim' | 'accent' | undefined

export interface Col {
  head: string
  /** 固定列数；'flex' 的列吃掉剩下的宽度。 */
  width: number | 'flex'
  align?: 'right'
  get(o: any): string
  tone?(o: any): Tone
}

type Obj = Record<string, any>
const isObj = (v: unknown): v is Obj => v != null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string => (v == null ? '' : String(v))
const name = (u: any): string => (isObj(u) ? str(u.name ?? u.id) : '')

export type Kind = 'ticket' | 'stop' | 'transfer' | 'station' | 'item' | 'user' | 'comment' | 'live' | 'keyword' | 'named' | 'generic'

export function kindOf(o: unknown): Kind {
  if (!isObj(o)) return 'generic'
  if ('train_no' in o && 'seats' in o && 'from' in o) return 'ticket'
  if ('station' in o && 'arrive' in o && 'stopover' in o) return 'stop'
  if ('via' in o && 'legs' in o) return 'transfer'
  if ('pinyin' in o && 'code' in o) return 'station'
  if ('kind' in o && 'stats' in o && 'media' in o) return 'item'
  if ('handle' in o || (isObj(o.stats) && 'followers' in o.stats)) return 'user'
  if ('item_id' in o && 'text' in o && !('offset' in o)) return 'comment'
  if ('host' in o && 'status' in o) return 'live'
  if ('heat' in o && 'text' in o) return 'keyword'
  if ('name' in o && 'id' in o) return 'named'
  return 'generic'
}

const SEAT_ORDER = ['商务座', '特等座', '一等座', '二等座', '高级软卧', '软卧', '动卧', '硬卧', '软座', '硬座', '无座']

/** 余票文字：≤20 是精确数字，≥21 封顶为 `21+`（AGENTS 6.2）；没有数字时用 seats 里的“有 / 无 / 候补”。 */
export function seatText(o: Obj, seat: string): string {
  const r = o.remaining?.[seat]
  if (typeof r === 'number') return String(r)
  if (isObj(r) && typeof r.min === 'number') return `${r.min}+`
  const s = o.seats?.[seat]
  return s ? String(s) : '—'
}

export function seatTone(o: Obj, seat: string): Tone {
  const t = seatText(o, seat)
  if (t === '—' || t === '无' || t === '0') return 'dim'
  if (t.endsWith('+') || t === '有') return 'ok'
  const n = Number(t)
  if (Number.isFinite(n)) return n > 10 ? 'ok' : 'warn'
  return 'warn'
}

/** 一列余票的显示宽度：`21+ ¥1,058` 这样最长约 11 列。 */
function seatCols(rows: Obj[], max: number): Col[] {
  const present = SEAT_ORDER.filter((s) => rows.some((o) => o.remaining?.[s] != null || (o.seats?.[s] && o.seats[s] !== '--')))
  // 窗口放不下全部席别时，按常用程度取：二等座、一等座、商务座、无座，再是其余；显示时仍按票面顺序
  const priority = ['二等座', '一等座', '商务座', '无座', ...SEAT_ORDER]
  const chosen = new Set([...new Set(priority)].filter((s) => present.includes(s)).slice(0, max))
  return present.filter((s) => chosen.has(s)).map((seat) => ({
    head: seat,
    width: 11,
    align: 'right' as const,
    get: (o) => {
      const t = seatText(o, seat)
      const p = o.prices?.[seat]?.amount
      return p != null && t !== '—' ? `${t} ¥${p % 1 === 0 ? p : p.toFixed(1)}` : t
    },
    tone: (o) => seatTone(o, seat),
  }))
}

/** 表格列。rows 用来决定动态列（余票的席别）。 */
export function columnsFor(rows: unknown[], room = 100): Col[] {
  const first = rows[0]
  const kind = kindOf(first)
  const objs = rows.filter(isObj)
  switch (kind) {
    case 'ticket':
      return [
        { head: '车次', width: 7, get: (o) => str(o.id) },
        { head: '出发 → 到达', width: 'flex', get: (o) => `${o.depart} ${name(o.from)} → ${o.arrive} ${name(o.to)}` },
        { head: '历时', width: 6, get: (o) => str(o.duration) },
        // 窗口窄就少显示几个席别：先保证“车次 + 时刻 + 历时”至少 45 列（含列间距）
        ...seatCols(objs, Math.max(1, Math.min(4, Math.floor((room - 45) / 12)))),
      ]
    case 'stop':
      return [
        { head: '站名', width: 'flex', get: (o) => str(o.station) },
        { head: '到', width: 6, get: (o) => str(o.arrive) },
        { head: '发', width: 6, get: (o) => str(o.depart) },
        { head: '停留', width: 6, get: (o) => str(o.stopover) },
      ]
    case 'transfer':
      return [
        { head: '方案', width: 'flex', get: (o) => (o.legs ?? []).map((l: Obj) => `${l.train_no} ${l.from}→${l.to}`).join('  ') },
        { head: '换乘', width: 8, get: (o) => str(o.via) },
        { head: '类型', width: 8, get: (o) => str(o.kind) },
        { head: '总历时', width: 7, align: 'right', get: (o) => `${Math.floor(o.duration_minutes / 60)}时${o.duration_minutes % 60}分` },
      ]
    case 'station':
      return [
        { head: '站名', width: 'flex', get: (o) => str(o.name) },
        { head: '电报码', width: 7, get: (o) => str(o.code) },
        { head: '拼音', width: 14, get: (o) => str(o.pinyin) },
        { head: '城市', width: 8, get: (o) => str(o.city) },
      ]
    case 'item':
      return [
        { head: '标题', width: 'flex', get: (o) => str(o.title ?? o.text ?? o.id).replace(/\s+/g, ' ') },
        { head: '作者', width: 12, get: (o) => name(o.author), tone: () => 'dim' },
        { head: '播放', width: 8, align: 'right', get: (o) => count(o.stats?.views) },
        { head: '点赞', width: 8, align: 'right', get: (o) => count(o.stats?.likes) },
      ]
    case 'user':
      return [
        { head: '用户', width: 'flex', get: (o) => str(o.name ?? o.handle ?? o.id) },
        { head: '粉丝', width: 9, align: 'right', get: (o) => count(o.stats?.followers) },
        { head: '作品', width: 8, align: 'right', get: (o) => count(o.stats?.items) },
      ]
    case 'comment':
      return [
        { head: '评论', width: 'flex', get: (o) => str(o.text).replace(/\s+/g, ' ') },
        { head: '作者', width: 12, get: (o) => name(o.author), tone: () => 'dim' },
        { head: '赞', width: 7, align: 'right', get: (o) => count(o.stats?.likes) },
        { head: '回复', width: 6, align: 'right', get: (o) => count(o.stats?.replies) },
      ]
    case 'live':
      return [
        { head: '直播间', width: 'flex', get: (o) => str(o.title ?? o.id) },
        { head: '主播', width: 12, get: (o) => name(o.host), tone: () => 'dim' },
        { head: '在线', width: 8, align: 'right', get: (o) => count(o.stats?.viewers) },
        { head: '状态', width: 6, get: (o) => (o.status === 'live' ? '直播中' : '未开播'), tone: (o) => (o.status === 'live' ? 'ok' : 'dim') },
      ]
    case 'keyword':
      return [
        { head: '关键词', width: 'flex', get: (o) => str(o.text) },
        { head: '热度', width: 9, align: 'right', get: (o) => count(o.heat) },
      ]
    case 'named':
      return [
        { head: '名称', width: 'flex', get: (o) => str(o.name) },
        { head: 'id', width: 16, get: (o) => str(o.id), tone: () => 'dim' },
        ...(first && 'count' in (first as Obj) ? [{ head: '数量', width: 7, align: 'right' as const, get: (o: Obj) => count(o.count) }] : []),
      ]
    default:
      return [
        { head: '内容', width: 'flex', get: (o) => (isObj(o) ? summarizeLine(o) : str(o)) },
      ]
  }
}

/** 通用一行摘要：挑第一个有内容的“主要”字段。 */
export function summarizeLine(o: Obj): string {
  for (const k of ['title', 'name', 'text', 'station', 'id']) {
    if (o[k] != null && o[k] !== '') return str(o[k]).replace(/\s+/g, ' ')
  }
  return JSON.stringify(o).slice(0, 120)
}

// ---- 详情 ----

export interface Line {
  key: string
  value: string
  tone?: Tone
}

const SKIP = new Set(['media', 'cover', 'raw'])

function scalar(v: unknown, key: string): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'boolean') return v ? '是' : '否'
  if (typeof v === 'number') return key.endsWith('_at') ? String(v) : String(v)
  if (typeof v === 'string') return /_at$|^(created|updated|start|end)/.test(key) && /^\d{4}-\d\d-\d\dT/.test(v) ? when(v) : v
  return null
}

const money = (p: number): string => `¥${p.toLocaleString('en-US', { maximumFractionDigits: 1 })}`

/** 余票对象的详情：每个席别一行“余票 · 票价”，替代 seats / remaining / prices 三组重复的键。 */
function ticketLines(o: Obj): Line[] {
  const names = SEAT_ORDER.filter((s) => o.remaining?.[s] != null || (o.seats?.[s] && o.seats[s] !== '--'))
  return names.map((seat) => {
    const price = o.prices?.[seat]?.amount
    return { key: seat, value: `${seatText(o, seat)}${price != null ? `  ${money(price)}` : ''}`, tone: seatTone(o, seat) }
  })
}

/** 把对象摊平成“键 值”行：嵌套用点号，价格写成 ¥金额，用户引用写名字，数组写个数。 */
export function flatten(o: unknown, prefix = '', out: Line[] = [], depth = 0): Line[] {
  if (!isObj(o)) return out
  const ticket = depth === 0 && kindOf(o) === 'ticket'
  for (const [k, v] of Object.entries(o)) {
    if (ticket && (k === 'seats' || k === 'remaining' || k === 'prices' || k === 'seat_types' || k === 'train_no' || k === 'url')) {
      if (k === 'seats') out.push(...ticketLines(o))
      continue
    }
    const key = prefix ? `${prefix}.${k}` : k
    if (v == null || v === '') continue
    if (SKIP.has(k) && Array.isArray(v)) {
      if (v.length) out.push({ key, value: `${v.length} 个` })
      continue
    }
    if (Array.isArray(v)) {
      if (!v.length) continue
      if (v.every((x) => typeof x !== 'object')) out.push({ key, value: v.join('、') })
      else out.push({ key, value: `${v.length} 项` })
      continue
    }
    if (isObj(v)) {
      if ('amount' in v && 'currency' in v) {
        out.push({ key, value: `${v.currency === 'CNY' ? '¥' : v.currency + ' '}${v.amount}` })
        continue
      }
      if ('min' in v && Object.keys(v).length === 1) {
        out.push({ key, value: `${v.min}+` })
        continue
      }
      if ('id' in v && 'name' in v && 'url' in v && Object.keys(v).length === 3) {
        out.push({ key, value: v.name ? `${v.name}（${v.id}）` : str(v.id) })
        continue
      }
      if (depth < 2) flatten(v, key, out, depth + 1)
      continue
    }
    const s = scalar(v, k)
    if (s != null) out.push({ key, value: s })
  }
  return out
}

/** 取一个对象能复制的“链接或 id”。 */
export function linkOf(o: unknown): string | null {
  if (!isObj(o)) return null
  return typeof o.url === 'string' && o.url ? o.url : o.id != null ? String(o.id) : null
}

export function rawOf(o: unknown): unknown {
  return isObj(o) && RAW in o ? (o as Record<symbol, unknown>)[RAW] : o
}

/** 折行：按显示宽度切成多行，中文不拆开。 */
export function wrap(text: string, cols: number, measure: (s: string) => number): string[] {
  if (cols <= 0) return [text]
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    let used = 0
    for (const ch of para) {
      const w = measure(ch)
      if (used + w > cols) {
        lines.push(line)
        line = ''
        used = 0
      }
      line += ch
      used += w
    }
    lines.push(line)
  }
  return lines
}
