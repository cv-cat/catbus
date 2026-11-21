import { mockItems } from './content'
import { mockUserItems } from './author'
import type { Item } from '../types'
import type { NewSub, Sub, SubsState } from '../subs'

/**
 * 订阅的演示数据（AGENTS.md 7.9「订阅」「演示模式」）：只存在内存里，刷新后清空。
 * 新建的订阅马上带几条新内容，「立即检查」再随机多出几条。
 * 演示各种状态：关键词里带「风控」时检查会让整个平台暂停，带「出错」时这一条记一个错误。
 */
const subs: Sub[] = []
const paused: SubsState['paused'] = {}
/** 每条订阅已经发到第几批演示条目（换一批 id） */
const batches = new Map<string, number>()
/** 恢复过的订阅不再演示风控 */
const cleared = new Set<string>()

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const clone = <T>(v: T): T => structuredClone(v)
const find = (id: string) => {
  const s = subs.find((x) => x.id === id)
  if (!s) throw new Error('订阅不存在') // i18n-ignore 演示数据，模拟服务端的原文
  return s
}

/** 一批演示的新内容 */
function batch(s: Sub, n: number): Item[] {
  const page = batches.get(s.id) ?? 0
  batches.set(s.id, page + 1)
  const env = s.kind === 'author' ? mockUserItems(s.platform, s.query, page * n, n) : mockItems(s.platform, s.query, page + 1, n)
  return (env.data ?? []).map((it) => ({ ...it, created_at: new Date(Date.now() - Math.floor(Math.random() * 5 * 3600e3)).toISOString() }))
}

const has = (s: Sub, words: string[]) => words.some((w) => s.query.toLowerCase().includes(w))

export const mockSubs = {
  async list(): Promise<SubsState> {
    await wait(200)
    return clone({ subs, paused })
  },
  async add(b: NewSub): Promise<Sub> {
    await wait(300)
    const dup = subs.find((x) => x.platform === b.platform && x.kind === b.kind && x.query === b.query)
    if (dup) return clone(dup)
    if (subs.length >= 50) throw new Error('最多 50 条订阅') // i18n-ignore 演示数据，模拟服务端的原文
    const now = new Date().toISOString()
    const s: Sub = {
      id: `demo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      platform: b.platform,
      kind: b.kind,
      query: b.query,
      label: b.label || b.query,
      account: b.account ?? null,
      created_at: now,
      last_check: now,
      next_check: Date.now() + 30 * 60_000,
      error: null,
      seen: [],
      unread: [],
    }
    s.unread = batch(s, 3 + Math.floor(Math.random() * 4))
    s.seen = s.unread.map((it) => it.id)
    subs.push(s)
    return clone(s)
  },
  async remove(id: string): Promise<{ removed: boolean }> {
    await wait(150)
    const i = subs.findIndex((x) => x.id === id)
    if (i >= 0) subs.splice(i, 1)
    return { removed: i >= 0 }
  },
  async read(id: string): Promise<Sub> {
    await wait(150)
    const s = find(id)
    s.unread = []
    return clone(s)
  },
  async check(id: string): Promise<Sub> {
    await wait(900)
    const s = find(id)
    if (paused[s.platform]) throw new Error('这个平台遇到风控，订阅已暂停') // i18n-ignore 演示数据，模拟服务端的原文
    s.next_check = Date.now() + 30 * 60_000
    if (has(s, ['风控', 'risk']) && !cleared.has(s.id)) { // i18n-ignore 演示数据，模拟服务端的原文
      paused[s.platform] = { at: new Date().toISOString(), verify_url: 'https://example.com/verify' }
      s.error = { code: 'RISK_CONTROL', message: '平台要求人机验证', hint: null, detail: { kind: 'captcha', verify_url: 'https://example.com/verify' } } // i18n-ignore 演示数据，模拟服务端的原文
      return clone(s)
    }
    if (has(s, ['出错', 'error'])) { // i18n-ignore 演示数据，模拟服务端的原文
      s.error = { code: 'NETWORK', message: '网络错误：连接超时', hint: null, detail: null } // i18n-ignore 演示数据，模拟服务端的原文
      return clone(s)
    }
    s.error = null
    s.last_check = new Date().toISOString()
    const fresh = batch(s, 1 + Math.floor(Math.random() * 4))
    s.seen.push(...fresh.map((it) => it.id))
    s.unread = fresh.concat(s.unread).slice(0, 100)
    return clone(s)
  },
  async resume(platform: string): Promise<{ resumed: boolean }> {
    await wait(150)
    const had = !!paused[platform]
    delete paused[platform]
    // 恢复后演示的那几条不再触发风控
    for (const s of subs) if (s.platform === platform && s.error?.code === 'RISK_CONTROL') {
        s.error = null
        cleared.add(s.id)
      }
    return { resumed: had }
  },
}
