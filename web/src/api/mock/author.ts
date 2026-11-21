import type { Envelope, Item, User, UserRef } from '../types'
import { mockItems } from './content'
import { demoMe } from './accounts'
import { AUTHORS, hash } from './shared'

// ---------- 作者页（AGENTS.md 7.9「作者页」） ----------

const BIOS = [
  '浙江安吉 · 带娃露营第 5 年 ⛺ 分享真实用过的装备和路线，不接硬广。周末大概率在山里，私信回复慢请见谅。',
  '周末出逃计划｜城市边缘的小众营地',
  null,
]

/** 演示用的作者：按作者 id 固定生成；有的缺简介、有的缺部分计数，用来演示头部的各种状态 */
export function mockUser(platform: string, ref: string, hint?: UserRef | null): Envelope<User> {
  // 演示作者页的 url 形如 https://example.com/<p>/user/<id>，取回 id，同一位作者的 url 和 id 得到同样的数据
  // `me`（「我的」页的头部）是这个平台的当前演示账号
  const me = ref === 'me' ? demoMe(platform) : null
  const id = me?.id ?? decodeURIComponent(/\/user\/([^/?#]+)/.exec(ref)?.[1] ?? ref)
  const n = hash(`${platform}:${id}`)
  // 从卡片点进来时沿用卡片上的昵称和头像，演示时前后一致
  const name = hint?.name ?? me?.name ?? AUTHORS[n % AUTHORS.length]!
  const missing = n % 5 === 1
  return {
    ok: true,
    data: {
      id,
      name,
      handle: `demo_${(n % 1e6).toString(36)}`,
      avatar: hint?.avatar ?? `https://picsum.photos/seed/ava-${id}/192/192`,
      url: `https://example.com/${platform}/user/${encodeURIComponent(id)}`,
      bio: BIOS[n % BIOS.length] ?? null,
      stats: {
        followers: 1000 + (n % 900_000),
        following: missing ? null : n % 900,
        items: 128,
        likes: missing ? null : 10_000 + (n % 9_000_000),
      },
    },
    page: null,
    error: null,
  }
}

/** 演示用的作品列表：沿用演示条目，作者都换成这位作者；一共 128 条，按 offset 分页 */
export function mockUserItems(platform: string, ref: string, offset: number, limit = 20, hint?: UserRef | null): Envelope<Item[]> {
  const user = mockUser(platform, ref, hint).data!
  const total = user.stats.items ?? 0
  const page = mockItems(platform, `@${user.id}`, Math.floor(offset / limit), limit)
  const author = { id: user.id, name: user.name, url: user.url, avatar: user.avatar }
  const data = page.data!.slice(0, Math.max(0, total - offset)).map((it) => ({ ...it, id: `${it.id}-u`, title: it.title?.replace(/ · @.*$/, '') ?? null, author }))
  const next = offset + data.length
  return { ok: true, data, page: { cursor: String(next), has_more: next < total }, error: null }
}

// 各平台「我的」页的演示数据（AGENTS.md 7.9「各平台的「我的」页」）：标签与注册表一致
