import { mockUser, mockUserItems } from './mock'
import type { Envelope, Item, User, UserRef } from './types'
import { isDemo } from '@/stores/source'

/**
 * 作者页（AGENTS.md 7.9「作者页」）：`user get` 取作者、`user items` 取作品（分页）。
 * `<user>` 是作者的 url（有就用，小红书的链接带 xsec_token）或 id，bridge 放在 `--` 之后。
 */
async function call<T>(argv: string[]): Promise<Envelope<T>> {
  const res = await fetch('/api/catbus', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
  })
  return (await res.json()) as Envelope<T>
}

/** `hint`：点进来时卡片上的作者，只在演示模式下用（演示数据沿用它的昵称和头像） */
export async function getUser(platform: string, user: string, account?: string | null, hint?: UserRef | null): Promise<Envelope<User>> {
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 500))
    return mockUser(platform, user, hint)
  }
  const argv = [platform, 'user', 'get', user]
  if (account) argv.push('-a', account)
  return call<User>(argv)
}

export async function listUserItems(
  platform: string,
  user: string,
  opts: { cursor?: string | null; limit?: number; account?: string | null; hint?: UserRef | null } = {},
): Promise<Envelope<Item[]>> {
  const limit = opts.limit ?? 20
  if (isDemo()) {
    await new Promise((r) => setTimeout(r, 650))
    return mockUserItems(platform, user, Number(opts.cursor ?? 0), limit, opts.hint)
  }
  const argv = [platform, 'user', 'items', user]
  if (opts.account) argv.push('-a', opts.account)
  argv.push('--limit', String(limit))
  if (opts.cursor) argv.push('--cursor', opts.cursor)
  return call<Item[]>(argv)
}
