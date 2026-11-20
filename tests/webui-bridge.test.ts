import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBridge, validateArgv } from '../src/webui/bridge.js'
import { resetDownloadsForTest } from '../src/webui/download.js'
import { MAX_LIGHT, MAX_RUNNING, runnerStats } from '../src/webui/runner.js'

/**
 * bridge 的并发上限与取消（AGENTS.md 7.9「bridge 的边界」）。
 * 通过 Node 启动假的 catbus：启动时在目录里留 start-<pid>，在 POSIX 收到 SIGTERM 时留 term-<pid> 后退出；
 * `version` 立即输出，其余命令等到目录里出现 release 才输出信封。不联网、不跑真的平台命令。
 */
const FAKE = `const fs = require('node:fs'), path = require('node:path')
const dir = process.env.FAKE_CATBUS_DIR
const env = JSON.stringify({ ok: true, data: { argv: process.argv.slice(2) }, page: null, error: null })
if (process.argv.includes('version')) { process.stdout.write(env); process.exit(0) }
fs.writeFileSync(path.join(dir, 'start-' + process.pid), '')
process.on('SIGTERM', () => { fs.writeFileSync(path.join(dir, 'term-' + process.pid), ''); process.exit(143) })
const t = setInterval(() => {
  if (fs.existsSync(path.join(dir, 'release'))) { clearInterval(t); process.stdout.write(env) }
}, 15)
`

const fakeCli = vi.hoisted(() => ({ script: '' }))
vi.mock('../src/webui/cli.js', () => ({
  resolveCli: () => ({ file: process.execPath, prefix: [fakeCli.script] }),
}))

let home = ''
let dir = ''
let server: Server
let base = ''
const saved: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const k of ['CATBUS_HOME', 'FAKE_CATBUS_DIR']) saved[k] = process.env[k]
  home = mkdtempSync(join(tmpdir(), 'catbus-bridge-'))
  process.env.CATBUS_HOME = home
  fakeCli.script = join(home, 'fake-catbus.cjs')
  writeFileSync(fakeCli.script, FAKE)
  const handle = createBridge()
  server = createServer((req, res) => {
    if (!handle(req, res)) res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((r) => server.close(r))
  resetDownloadsForTest()
  fakeCli.script = ''
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v)
  rmSync(home, { recursive: true, force: true })
})

beforeEach(() => {
  dir = mkdtempSync(join(home, 'run-'))
  process.env.FAKE_CATBUS_DIR = dir
})

afterEach(async () => {
  // 放行所有还在等的假进程，等名额全部释放，下一个用例从空闲开始
  writeFileSync(join(dir, 'release'), '')
  await until(() => runnerStats().running === 0 && runnerStats().queued === 0)
})

function post(argv: string[], signal?: AbortSignal) {
  return fetch(`${base}/api/catbus`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ argv }),
    signal,
  })
}

const files = (prefix: string) => readdirSync(dir).filter((f) => f.startsWith(prefix))
const pidOf = (f: string) => Number(f.split('-')[1])
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('等待超时')
    await new Promise((r) => setTimeout(r, 20))
  }
}

const search = (kw: string) => ['xhs', 'item', 'search', kw]

describe('bridge 的并发上限与取消（AGENTS 7.9）', () => {
  it(`同时最多运行 ${MAX_RUNNING} 个子进程，其余排队，前面的完成后再启动`, async () => {
    const reqs = Array.from({ length: MAX_RUNNING + 1 }, (_, i) => post(search(`kw${i}`)))
    await until(() => files('start-').length === MAX_RUNNING)
    // 再等一会儿：第 N+1 个仍然没有启动
    await new Promise((r) => setTimeout(r, 300))
    expect(files('start-')).toHaveLength(MAX_RUNNING)
    expect(runnerStats()).toMatchObject({ running: MAX_RUNNING, queued: 1 })

    writeFileSync(join(dir, 'release'), '')
    const envs = await Promise.all(reqs.map(async (r) => (await r).json()))
    expect(envs.every((e) => e.ok)).toBe(true)
    expect(envs.map((e) => e.data.argv.at(-1)).sort()).toEqual(['kw0', 'kw1', 'kw2', 'kw3', 'kw4'])
    expect(files('start-')).toHaveLength(MAX_RUNNING + 1)
  })

  it('轻量命令（version）走单独的通道，不被长请求挡住', async () => {
    const blockers = Array.from({ length: MAX_RUNNING + 2 }, (_, i) => post(search(`b${i}`)).catch(() => null))
    await until(() => files('start-').length === MAX_RUNNING)
    const env = await (await post(['version'])).json()
    expect(env.ok).toBe(true)
    expect(MAX_LIGHT).toBeGreaterThan(0)
    writeFileSync(join(dir, 'release'), '')
    await Promise.all(blockers)
  })

  it('排队中的请求客户端断开时直接出队，不启动子进程', async () => {
    const blockers = Array.from({ length: MAX_RUNNING }, (_, i) => post(search(`b${i}`)))
    await until(() => files('start-').length === MAX_RUNNING)
    const ac = new AbortController()
    const queued = post(search('queued'), ac.signal).catch((e: Error) => e)
    await until(() => runnerStats().queued === 1)
    ac.abort()
    expect(((await queued) as Error).name).toBe('AbortError')
    await until(() => runnerStats().queued === 0)

    writeFileSync(join(dir, 'release'), '')
    await Promise.all(blockers.map(async (r) => (await r).json()))
    await until(() => runnerStats().running === 0)
    // 被取消的那条从没启动过
    expect(files('start-')).toHaveLength(MAX_RUNNING)
  })

  it('运行中的请求客户端断开时结束子进程，名额随即让给排队的', async () => {
    const ac = new AbortController()
    const running = post(search('running'), ac.signal).catch((e: Error) => e)
    await until(() => files('start-').length === 1)
    const pid = pidOf(files('start-')[0]!)
    expect(alive(pid)).toBe(true)

    ac.abort()
    expect(((await running) as Error).name).toBe('AbortError')
    // Windows 会直接终止子进程，不调用它的 SIGTERM 处理器。
    if (process.platform !== 'win32') {
      await until(() => files('term-').length === 1)
      expect(pidOf(files('term-')[0]!)).toBe(pid)
    }
    await until(() => !alive(pid))
    await until(() => runnerStats().running === 0)
  })

  it('正常完成的请求不受取消逻辑影响', async () => {
    writeFileSync(join(dir, 'release'), '')
    const env = await (await post(search('ok'))).json()
    expect(env).toMatchObject({ ok: true, data: { argv: ['-o', 'json', '-q', 'xhs', 'item', 'search', '--', 'ok'] } })
    expect(files('term-')).toHaveLength(0)
    expect(existsSync(join(dir, 'release'))).toBe(true)
  })
})

describe('直播页的发现直播间与直播间标签（AGENTS 7.9「直播弹幕」）', () => {
  it('live list / search / categories：分页选项与分类，关键词放在 -- 之后', () => {
    expect(validateArgv(['xhs', 'live', 'list', '-a', 'work', '--limit', '20', '--category', 'outdoor_1'])).toEqual([
      'xhs', 'live', 'list', '-a', 'work', '--limit', '20', '--category', 'outdoor_1',
    ])
    expect(validateArgv(['tiktok', 'live', 'list', '--cursor', 'abc'])).toEqual(['tiktok', 'live', 'list', '--cursor', 'abc'])
    expect(validateArgv(['douyin', 'live', 'search', '-露营', '--limit', '20'])).toEqual(['douyin', 'live', 'search', '--limit', '20', '--', '-露营'])
    expect(validateArgv(['bilibili', 'live', 'categories'])).toEqual(['bilibili', 'live', 'categories'])
    expect(() => validateArgv(['douyin', 'live', 'search'])).toThrow('缺少搜索关键词')
    // 直播分类不限于数字，但不能有空格、斜杠等
    expect(() => validateArgv(['xhs', 'live', 'list', '--category', 'a b'])).toThrow('选项取值不合法')
    expect(() => validateArgv(['xhs', 'live', 'list', '--category', '../x'])).toThrow('选项取值不合法')
    expect(() => validateArgv(['bilibili', 'live', 'categories', '--limit', '3'])).toThrow('不允许的选项')
    expect(() => validateArgv(['bilibili', 'live', 'search', 'kw', '--sort', 'latest'])).toThrow('不允许的选项')
  })

  it('live gifts / rank / history / products / replays：只带 <room> 或 <user>，回放可翻页', () => {
    for (const action of ['gifts', 'rank', 'history', 'products']) {
      expect(validateArgv(['douyin', 'live', action, 'https://live.douyin.com/1', '-a', 'work'])).toEqual([
        'douyin', 'live', action, '-a', 'work', '--', 'https://live.douyin.com/1',
      ])
      expect(() => validateArgv(['douyin', 'live', action, '1', '--limit', '3'])).toThrow('不允许的选项')
    }
    expect(validateArgv(['kuaishou', 'live', 'replays', 'u123', '--limit', '20', '--cursor', 'c1'])).toEqual([
      'kuaishou', 'live', 'replays', '--limit', '20', '--cursor', 'c1', '--', 'u123',
    ])
    expect(() => validateArgv(['douyin', 'live', 'rank', '1', '--ranking', 'thousand'])).toThrow('不允许的选项')
    expect(() => validateArgv(['douyin', 'live', 'gifts', 'javascript:alert(1)'])).toThrow()
    expect(() => validateArgv(['douyin', 'live', 'gifts'])).toThrow()
  })

  it('直播的写操作不放行', () => {
    expect(() => validateArgv(['bilibili', 'live', 'send', '1', 'hi'])).toThrow('暂不开放')
    expect(() => validateArgv(['douyin', 'live', 'like', '1'])).toThrow('暂不开放')
    expect(() => validateArgv(['bilibili', 'live', 'start'])).toThrow('暂不开放')
    expect(() => validateArgv(['bilibili', 'live', 'stop'])).toThrow('暂不开放')
  })

  it('/api/filters 按注册表给出直播的发现与标签能力', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    // 小红书：推荐列表接受 --category，分类 chip 才出现
    expect(all.xhs).toMatchObject({ liveList: true, liveSearch: false, liveCategories: true, liveGifts: true, liveProducts: true, liveRank: false, liveHistory: false })
    expect(all.douyin).toMatchObject({ liveList: true, liveSearch: true, liveCategories: true, liveRank: true, liveProducts: true, liveHistory: true })
    expect(all.bilibili).toMatchObject({ liveList: true, liveSearch: true, liveCategories: true, liveGifts: true, liveHistory: true })
    expect(all.kuaishou).toMatchObject({ liveList: true, liveReplays: true, liveGifts: true })
    expect(all.weibo).toMatchObject({ liveList: false, liveSearch: false, liveGifts: false, liveReplays: false })
  })
})

describe('收件箱：通知与私信只读放行（AGENTS 7.9「通知与私信」）', () => {
  it('notice list / count、msg list 可带 -a 和分页选项', () => {
    expect(validateArgv(['xhs', 'notice', 'list', '-a', 'work', '--limit', '20', '--cursor', 'abc'])).toEqual(['xhs', 'notice', 'list', '-a', 'work', '--limit', '20', '--cursor', 'abc'])
    expect(validateArgv(['tiktok', 'notice', 'count', '-a', 'work'])).toEqual(['tiktok', 'notice', 'count', '-a', 'work'])
    expect(validateArgv(['jd', 'msg', 'list', '--limit', '20'])).toEqual(['jd', 'msg', 'list', '--limit', '20'])
    // notice count 不带分页
    expect(() => validateArgv(['xhs', 'notice', 'count', '--limit', '5'])).toThrow('不允许的选项')
    // 平台私有的筛选不放行（如抖音的 --group、mteam 的 --box）
    expect(() => validateArgv(['douyin', 'notice', 'list', '--group', 'fans'])).toThrow('不允许的选项')
    expect(() => validateArgv(['mteam', 'msg', 'list', '--box', 'sent'])).toThrow('不允许的选项')
  })

  it('msg history：会话放在 -- 之后，接受带冒号的 ID 和 http(s) 链接', () => {
    expect(validateArgv(['xhs', 'msg', 'history', 'group:123', '-a', 'work', '--limit', '20'])).toEqual(['xhs', 'msg', 'history', '-a', 'work', '--limit', '20', '--', 'group:123'])
    expect(validateArgv(['tiktok', 'msg', 'history', '0:1:111:222', '--cursor', '9'])).toEqual(['tiktok', 'msg', 'history', '--cursor', '9', '--', '0:1:111:222'])
    expect(validateArgv(['x', 'msg', 'history', 'https://x.com/messages/1-2'])).toEqual(['x', 'msg', 'history', '--', 'https://x.com/messages/1-2'])
    expect(() => validateArgv(['xhs', 'msg', 'history'])).toThrow('缺少会话')
    expect(() => validateArgv(['xhs', 'msg', 'history', '--limit'])).toThrow()
    expect(() => validateArgv(['xhs', 'msg', 'history', 'a b'])).toThrow()
    expect(() => validateArgv(['xhs', 'msg', 'history', 'javascript:alert(1)'])).toThrow()
  })

  it('私信的写操作一律不放行', () => {
    for (const action of ['read', 'send', 'revoke', 'delete', 'listen']) {
      expect(() => validateArgv(['xhs', 'msg', action, 'abc'])).toThrow('暂不开放')
    }
  })

  it('经 /api/catbus 运行时原样交给 catbus', async () => {
    writeFileSync(join(dir, 'release'), '')
    const env = await (await post(['xhs', 'msg', 'history', 'group:42', '--limit', '20'])).json()
    expect(env).toMatchObject({ ok: true, data: { argv: ['-o', 'json', '-q', 'xhs', 'msg', 'history', '--limit', '20', '--', 'group:42'] } })
    const bad = await post(['xhs', 'msg', 'send', 'hi', '--to', 'u'])
    expect(bad.status).toBe(400)
  })

  it('/api/filters 的 inbox 按注册表给出', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.xhs!.inbox).toEqual({ notices: true, count: true, messages: true })
    expect(all.douyin!.inbox).toEqual({ notices: true, count: false, messages: false })
    expect(all.jd!.inbox).toEqual({ notices: false, count: false, messages: true })
    expect(all.youtube!.inbox).toMatchObject({ notices: true, count: true, messages: false })
    // 只有 msg history、没有 msg list 的平台找不到会话：不显示私信
    expect(all.xianyu!.inbox.messages).toBe(false)
    expect(all.taobao!.inbox.messages).toBe(false)
    expect(all.kuaishou!.inbox).toEqual({ notices: false, count: true, messages: false })
  })
})
