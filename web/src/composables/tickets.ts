import { dateTime } from './format'

/**
 * 猫眼演出的场次与票档（AGENTS.md 7.9「猫眼演出的场次与票档」）：从 `item get --tickets` 的 text 里拆出来。
 * 行的格式见 AGENTS.md 4.8：
 *   场次：2026-11-14 周六 19:30
 *   场次时间：2026-11-14T19:30:00+08:00
 *   票档：A，票面价 1080，实售价 648，余票 3，限购 6[，售罄]
 * 取不到的项 CLI 会省略，这里逐项容错；不认识的行忽略。
 */
export interface Tier {
  /** 站点给的票档名（一般是 A、B、C 这样的字母） */
  name: string
  /** 票面价（元） */
  face: number | null
  /** 实售价（元），打折时低于票面价 */
  sell: number | null
  /** 余票；实测封顶在每单限购数，不是精确库存 */
  stock: number | null
  /** 每单限购张数 */
  limit: number | null
  soldOut: boolean
}

export interface Session {
  /** 站点的场次名（如「2026-11-14 周六 19:30」） */
  name: string
  /** 开始时间（毫秒时间戳）；没有「场次时间」行时为 null */
  at: number | null
  tiers: Tier[]
  /** 有票档、且全部售罄 */
  soldOut: boolean
}

// i18n-ignore：下面是 CLI 输出里的字段名（AGENTS.md 4.8），不是界面文案
const SESSION = '场次' // i18n-ignore
const SESSION_AT = '场次时间' // i18n-ignore
const TIER = '票档' // i18n-ignore
const SOLD_OUT = '售罄' // i18n-ignore
const KEYS: Record<string, keyof Pick<Tier, 'face' | 'sell' | 'stock' | 'limit'>> = {
  票面价: 'face', // i18n-ignore
  实售价: 'sell', // i18n-ignore
  余票: 'stock', // i18n-ignore
  限购: 'limit', // i18n-ignore
}

function parseTier(value: string): Tier | null {
  const parts = value.split(/[，,]/).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const tier: Tier = { name: '', face: null, sell: null, stock: null, limit: null, soldOut: false }
  for (const [i, part] of parts.entries()) {
    if (part === SOLD_OUT) {
      tier.soldOut = true
      continue
    }
    const m = /^(\S+?)\s*(-?\d+(?:\.\d+)?)$/.exec(part)
    const key = m ? KEYS[m[1]!] : undefined
    if (key) tier[key] = Number(m![2])
    else if (i === 0) tier.name = part
  }
  if (tier.stock === 0) tier.soldOut = true
  return tier
}

/** 场次列表；text 里没有场次行时为空数组 */
export function parseSessions(text: string | null | undefined): Session[] {
  const out: Session[] = []
  let cur: Session | null = null
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim()
    const i = line.indexOf('：')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (key === SESSION) {
      cur = { name: value, at: null, tiers: [], soldOut: false }
      out.push(cur)
    } else if (key === SESSION_AT && cur) {
      const at = Date.parse(value)
      cur.at = Number.isNaN(at) ? null : at
    } else if (key === TIER && cur) {
      const tier = parseTier(value)
      if (tier) cur.tiers.push(tier)
    }
  }
  for (const s of out) s.soldOut = s.tiers.length > 0 && s.tiers.every((x) => x.soldOut)
  return out
}

/**
 * 余票怎么显示：售罄；有票（达到每单限购，或不知道余票数）；余 N 张（少于限购时标红，没有限购数时不标红）。
 * 余票封顶在限购数，所以达到限购时只能说「有票」。
 */
export type Stock = { kind: 'soldOut' } | { kind: 'plenty' } | { kind: 'few'; n: number; warn: boolean }
export function stockOf(tier: Tier): Stock {
  if (tier.soldOut) return { kind: 'soldOut' }
  if (tier.stock == null) return { kind: 'plenty' }
  if (tier.limit != null) return tier.stock >= tier.limit ? { kind: 'plenty' } : { kind: 'few', n: tier.stock, warn: true }
  return { kind: 'few', n: tier.stock, warn: false }
}

/** 票面价是否要划线：与实售价不同（打折）时 */
export const discounted = (tier: Tier) => tier.face != null && tier.sell != null && tier.face !== tier.sell

/** 默认选中的场次：第一个没有售罄的，都售罄时第一个 */
export function firstOpen(list: readonly Session[]): number {
  const i = list.findIndex((s) => !s.soldOut)
  return i < 0 ? 0 : i
}

/** 演出在中国，场次时间按北京时间显示，不随浏览器时区变 */
const TZ = 'Asia/Shanghai'

const day = (at: number) => dateTime(at, { month: 'short', day: 'numeric', timeZone: TZ })
const week = (at: number) => dateTime(at, { weekday: 'short', timeZone: TZ })
const clock = (at: number) => dateTime(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ })

/** 场次卡的两行：「11月14日」「周六 19:30」；没有开始时间时用场次名原文 */
export function sessionLines(s: Session): [string, string] {
  if (s.at == null) {
    const m = /^(\S+)\s+(.+)$/.exec(s.name)
    return m ? [m[1]!, m[2]!] : [s.name, '']
  }
  return [day(s.at), `${week(s.at)} ${clock(s.at)}`]
}

/** 选中场次的标题：「11月14日 周六 19:30」 */
export function sessionTitle(s: Session): string {
  return s.at == null ? s.name : `${day(s.at)} ${week(s.at)} ${clock(s.at)}`
}

export const money = (n: number | null) => (n == null ? '' : `¥${Number.isInteger(n) ? n : n.toFixed(2)}`)
