import { describe, expect, it } from 'vitest'
import { newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { findPlatform } from '../src/platforms/index.js'
import { accountsOf, currentAccount, logoutAccount, useAccount } from '../src/tui/login.js'
import { bufferLogger, LogBuffer } from '../src/tui/logs.js'
import { useTempHome } from './helpers.js'

// 账号页的执行部分，对着临时数据目录（不碰真实的 ~/.catbus），离线。

describe('tui 账号管理', () => {
  useTempHome()
  const bili = findPlatform('bilibili')!
  const log = bufferLogger(new LogBuffer())

  async function seed(account: string, user: { id: string; name: string } | null = { id: 'u-' + account, name: '用户' + account }) {
    const c = newCredential({ platform: 'bilibili', endpoint: 'web', account, method: 'cookie' })
    c.user = user ? { ...user, url: null } : null
    await writeCredential(c)
  }

  it('列出账号、标出当前账号；切换后当前账号变化', async () => {
    await seed('work')
    await seed('home')
    await setCurrent('bilibili', 'web', 'work')
    let rows = await accountsOf(bili)
    expect(rows.map((r) => [r.account, r.active])).toEqual([['home', false], ['work', true]])
    await useAccount(bili, 'home', log)
    expect(await currentAccount(bili)).toBe('home')
    rows = await accountsOf(bili)
    expect(rows.find((r) => r.account === 'home')!.active).toBe(true)
  })

  it('切换到不存在的账号报 AUTH_REQUIRED，当前账号不变', async () => {
    await seed('work')
    await setCurrent('bilibili', 'web', 'work')
    await expect(useAccount(bili, 'nobody', log)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(await currentAccount(bili)).toBe('work')
  })

  it('登出：删除本地凭证并清掉 _current（B 站的服务端登出失败时只删本地）', async () => {
    await seed('work')
    await setCurrent('bilibili', 'web', 'work')
    await logoutAccount(bili, 'work', log)
    expect(await readCredential('bilibili', 'web', 'work')).toBeNull()
    expect(await currentAccount(bili)).toBeNull()
    expect(await accountsOf(bili)).toEqual([])
  })

  it('12306 没有登录命令，账号列表为空', async () => {
    expect(await accountsOf(findPlatform('12306')!)).toEqual([])
  })
})
