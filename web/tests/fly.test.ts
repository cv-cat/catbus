import { afterEach, describe, expect, it, vi } from 'vitest'

// motion.ts 在导入时读 matchMedia，jsdom 没有
vi.hoisted(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
import { arc, findTarget } from '@/composables/flyToDownloads'

// 下载投递动画（AGENTS.md 7.9「下载投递动画与角标」）：抛物线和目标按钮的选择
describe('下载投递动画', () => {
  it('抛物线从起点到终点，中途高过两端', () => {
    const from = { x: 400, y: 600 }
    const to = { x: 1200, y: 40 }
    const pts = arc(from, to)
    expect(pts[0]).toEqual(from)
    expect(pts.at(-1)!.x).toBeCloseTo(to.x)
    expect(pts.at(-1)!.y).toBeCloseTo(to.y)
    expect(Math.min(...pts.map((p) => p.y))).toBeLessThan(to.y)
  })

  afterEach(() => (document.body.innerHTML = ''))

  function button(rect: Partial<DOMRect>, inert = false) {
    const wrap = document.createElement('div')
    if (inert) wrap.setAttribute('inert', '')
    const el = document.createElement('div')
    el.setAttribute('data-dl-target', '')
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 48, bottom: 48, width: 48, height: 48, x: 0, y: 0, ...rect }) as DOMRect
    wrap.appendChild(el)
    document.body.appendChild(wrap)
    return el
  }

  it('跳过被盖住的和视口外的按钮', () => {
    button({}, true)
    button({ top: -100, bottom: -52 })
    const visible = button({ left: 900, right: 948 })
    expect(findTarget()).toBe(visible)
  })

  it('没有看得见的按钮时为 null', () => {
    button({ top: -100, bottom: -52 })
    expect(findTarget()).toBeNull()
  })
})
