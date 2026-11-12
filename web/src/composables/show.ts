import type { Item, UserRef } from '@/api/types'

/**
 * 演出（猫眼演出，AGENTS.md 7.9「演出卡片」「演出详情」，设计稿 M / N）：没有点赞、评论、发布时间。
 * 分类、开售、场次时间、场馆、票价档都按「键：值」逐行写在 text 里（AGENTS.md 4.8），这里拆出来。
 */
export interface ShowInfo {
  category: string | null
  /** 演出者的名字（多位用顿号连着）；没有时为 null */
  performers: string | null
  author: UserRef | null
  /** 站点的开售文案：「已开售」「明天开售」「即将开售」 */
  saleText: string | null
  /** 开售时间（毫秒时间戳）；CLI 没给时为 null */
  saleAt: number | null
  /** 还没开售时角标上的文字；已开售为 null */
  upcoming: string | null
  time: string | null
  city: string | null
  venue: string | null
  address: string | null
  /** 票价档（元），不带货币符号 */
  prices: string[]
  /** 起价，如「¥380」 */
  price: string | null
}

function fields(text: string | null | undefined, into: Map<string, string>) {
  for (const line of (text ?? '').split('\n')) {
    const i = line.indexOf('：')
    if (i > 0) into.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
}

export const yuan = (amount: number) => `¥${Number.isInteger(amount) ? amount : amount.toFixed(2)}`

/** `list` 是列表里的那一条：详情接口不给分类、演出者和开售文案，要从它取 */
export function showInfo(item: Item | null | undefined, list: Item | null | undefined, platform: string | null | undefined): ShowInfo | null {
  if (!item || platform !== 'maoyan') return null
  const f = new Map<string, string>()
  if (list && list !== item) fields(list.text, f)
  fields(item.text, f)
  const get = (k: string) => f.get(k) || null

  const author = item.author ?? list?.author ?? null
  const at = get('开售时间') ? Date.parse(get('开售时间')!) : NaN
  const saleAt = Number.isNaN(at) ? null : at
  const saleText = get('开售')
  const onSale = saleAt != null ? saleAt <= Date.now() : !saleText || saleText === '已开售'

  // 场馆：「国家体育馆（天辰东路9号）」，最后一对括号里是地址
  const place = get('场馆')
  const m = place ? /^(.+)（([^（）]+)）$/.exec(place) : null
  const price = item.price ?? list?.price ?? null

  return {
    category: get('分类'),
    performers: get('演出者') ?? author?.name ?? null,
    author,
    saleText,
    saleAt,
    upcoming: onSale ? null : saleText && saleText !== '已开售' ? saleText : '未开售',
    time: get('时间'),
    city: get('城市'),
    venue: m ? m[1]! : place,
    address: m ? m[2]! : null,
    prices: (get('票价') ?? '').split('、').map((s) => s.trim()).filter(Boolean),
    price: price ? yuan(price.amount) : null,
  }
}
