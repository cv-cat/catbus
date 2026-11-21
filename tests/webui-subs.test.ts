import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  INTERVAL_MS,
  MAX_SUBS,
  addSub,
  checkArgv,
  checkNow,
  listSubs,
  markRead,
  removeSub,
  resetSubsForTest,
  resume,
  setSubsDeps,
  tick,
} from '../src/webui/subscriptions.js'

const CAPS = {
  xhs: { search: true, sort: ['general', 'latest'], author: true },
  weibo: { search: true, sort: ['general'], author: false },
}
const ok = (ids: string[]) => JSON.stringify({ ok: true, data: ids.map((id) => ({ id, title: id, raw: { secret: 1 } })), page: null, error: null })
const fail = (code: string, detail: unknown = null) => JSON.stringify({ ok: false, data: null, page: null, error: { code, message: code, hint: null, detail } })

describe('订阅（AGENTS 7.9「订阅」）', () => {
  let home: string
  let clock: number
  let calls: string[][]
  let reply: () => string
  const prev = process.env.CATBUS_HOME

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'catbus-subs-'))
    process.env.CATBUS_HOME = home
    clock = 1_800_000_000_000
    calls = []
    reply = () => ok([])
    resetSubsForTest()
    setSubsDeps({
      now: () => clock,
      random: () => 0,
      caps: async () => CAPS,
      runner: async (argv) => (calls.push(argv), reply()),
    })
  })
  afterEach(() => {
    setSubsDeps({ now: null, random: null, caps: null, runner: null })
    resetSubsForTest()
    rmSync(home, { recursive: true, force: true })
    if (prev === undefined) delete process.env.CATBUS_HOME
    else process.env.CATBUS_HOME = prev
  })

  it('校验：平台、类型、关键词、作者、账号，以及平台能力', async () => {
    await expect(addSub({ platform: 'XHS', kind: 'keyword', query: '猫' })).rejects.toThrow('未知平台')
    await expect(addSub({ platform: 'xhs', kind: 'tag', query: '猫' })).rejects.toThrow('订阅类型')
    await expect(addSub({ platform: 'xhs', kind: 'keyword', query: 'a\nb' })).rejects.toThrow('关键词')
    await expect(addSub({ platform: 'xhs', kind: 'keyword', query: 'x'.repeat(101) })).rejects.toThrow('关键词')
    await expect(addSub({ platform: 'xhs', kind: 'author', query: '--all' })).rejects.toThrow('作者')
    await expect(addSub({ platform: 'xhs', kind: 'keyword', query: '猫', account: 'guest' })).rejects.toThrow('账号')
    await expect(addSub({ platform: 'weibo', kind: 'author', query: '123' })).rejects.toThrow('不支持')
    await expect(addSub({ platform: 'douyin', kind: 'keyword', query: '猫' })).rejects.toThrow('不支持')
  })

  it('拼 argv：支持 latest 时带 --sort latest，查询放在 -- 之后', async () => {
    const a = await addSub({ platform: 'xhs', kind: 'keyword', query: '-猫', account: 'work' })
    expect(await checkArgv(a)).toEqual(['xhs', 'item', 'search', '-a', 'work', '--sort', 'latest', '--limit', '20', '--', '-猫'])
    const b = await addSub({ platform: 'weibo', kind: 'keyword', query: '猫' })
    expect(await checkArgv(b)).toEqual(['weibo', 'item', 'search', '--limit', '20', '--', '猫'])
    const c = await addSub({ platform: 'xhs', kind: 'author', query: 'https://www.xiaohongshu.com/user/profile/1', label: '阿野' })
    expect(c.label).toBe('阿野')
    expect(await checkArgv(c)).toEqual(['xhs', 'user', 'items', '--limit', '20', '--', 'https://www.xiaohongshu.com/user/profile/1'])
  })

  it('同一个订阅不重复；最多 MAX_SUBS 条', async () => {
    const a = await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })
    expect((await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })).id).toBe(a.id)
    for (let i = 1; i < MAX_SUBS; i++) await addSub({ platform: 'xhs', kind: 'keyword', query: `k${i}` })
    await expect(addSub({ platform: 'xhs', kind: 'keyword', query: 'one more' })).rejects.toThrow(`最多 ${MAX_SUBS}`)
  })

  it('第一次检查只记基线，之后的新条目进 unread（去掉 raw，新的在前），30 分钟后再查', async () => {
    const sub = await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })
    reply = () => ok(['a', 'b'])
    await tick()
    expect(calls).toHaveLength(1)
    expect(listSubs().subs[0]).toMatchObject({ seen: ['a', 'b'], unread: [], error: null })
    expect(listSubs().subs[0]!.next_check).toBe(clock + INTERVAL_MS)

    // 还没到期：不检查
    await tick()
    expect(calls).toHaveLength(1)

    clock += INTERVAL_MS
    reply = () => ok(['c', 'a', 'd'])
    await tick()
    const s = listSubs().subs[0]!
    expect(s.unread.map((x) => x.id)).toEqual(['c', 'd'])
    expect(s.unread[0]).not.toHaveProperty('raw')

    clock += INTERVAL_MS
    reply = () => ok(['e', 'c'])
    await checkNow(sub.id)
    expect(listSubs().subs[0]!.unread.map((x) => x.id)).toEqual(['e', 'c', 'd'])

    markRead(sub.id)
    expect(listSubs().subs[0]!.unread).toEqual([])
  })

  it('第一次检查失败时不算基线：下次成功的那次才是', async () => {
    await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })
    reply = () => fail('NETWORK')
    await tick()
    expect(listSubs().subs[0]).toMatchObject({ last_check: null, error: { code: 'NETWORK' } })
    clock += INTERVAL_MS
    reply = () => ok(['a'])
    await tick()
    expect(listSubs().subs[0]).toMatchObject({ seen: ['a'], unread: [], error: null })
  })

  it('RISK_CONTROL：整个平台暂停，恢复后才继续', async () => {
    const a = await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })
    await addSub({ platform: 'xhs', kind: 'keyword', query: '狗' })
    reply = () => fail('RISK_CONTROL', { kind: 'captcha', verify_url: 'https://www.xiaohongshu.com/verify' })
    await tick()
    expect(calls).toHaveLength(1)
    expect(listSubs().paused.xhs).toMatchObject({ verify_url: 'https://www.xiaohongshu.com/verify' })
    await expect(checkNow(a.id)).rejects.toThrow('暂停')

    clock += INTERVAL_MS
    await tick()
    expect(calls).toHaveLength(1)

    reply = () => ok(['a'])
    expect(resume('xhs')).toBe(true)
    await tick()
    expect(listSubs().paused).toEqual({})
    expect(calls).toHaveLength(3)
  })

  it('落盘：0600，取消订阅后删掉', async () => {
    const a = await addSub({ platform: 'xhs', kind: 'keyword', query: '猫' })
    const file = join(home, 'webui', 'subscriptions.json')
    expect(JSON.parse(readFileSync(file, 'utf8')).subs).toHaveLength(1)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(removeSub(a.id)).toBe(true)
    expect(removeSub(a.id)).toBe(false)
    resetSubsForTest()
    expect(listSubs().subs).toEqual([])
  })
})
