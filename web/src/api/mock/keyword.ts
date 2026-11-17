import type { Envelope, Keyword } from '../types'
import { hash } from './shared'

const HOT_WORDS = [
  '秋季露营装备清单', '城市周边小众营地', '天幕搭建教程', '露营灯横评', '车顶帐篷值不值',
  '户外咖啡器具', '带猫露营', '徒步路线推荐', '星空延时摄影', '铸铁锅食谱', '野餐布置灵感', '机能风穿搭',
]
const SUGGEST_TAILS = ['推荐', '教程', '装备清单', '怎么选', '新手入门', '避坑', '测评', '攻略', '平价替代', '2026']

export function mockHot(platform: string): Envelope<Keyword[]> {
  const seed = hash(platform)
  const words = HOT_WORDS.map((w, i) => ({ w, k: hash(`${seed}:${i}`) })).sort((a, b) => a.k - b.k)
  const data = words.slice(0, 10).map(({ w }, i) => ({ text: w, heat: Math.round(3_200_000 / (i + 1.2) + (seed % 9000)) }))
  return { ok: true, data, page: null, error: null }
}

export function mockSuggest(platform: string, prefix: string): Envelope<Keyword[]> {
  const q = prefix.trim()
  const seed = hash(`${platform}:${q}`)
  const n = 5 + (seed % 4)
  const data = Array.from({ length: n }, (_, i) => ({ text: `${q}${SUGGEST_TAILS[(seed + i * 3) % SUGGEST_TAILS.length]}`, heat: null }))
  return { ok: true, data: [...new Map(data.map((k) => [k.text, k])).values()], page: null, error: null }
}

/** 演示模式下读不到 /api/filters（纯静态预览）时，联想 / 热搜的能力表用这一份（与注册表一致） */
export const MOCK_KEYWORD_SUPPORT: Record<string, { suggest: boolean; hot: boolean }> = {
  xhs: { suggest: true, hot: true },
  jd: { suggest: true, hot: true },
  tiktok: { suggest: true, hot: false },
  youtube: { suggest: true, hot: false },
}
