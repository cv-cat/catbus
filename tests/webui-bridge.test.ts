import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBridge } from '../src/webui/bridge.js'
import { resetDownloadsForTest } from '../src/webui/download.js'
import { MAX_LIGHT, MAX_RUNNING, runnerStats } from '../src/webui/runner.js'

/**
 * bridge 的并发上限与取消（AGENTS.md 7.9「bridge 的边界」）。
 * CATBUS_BIN 指向一个假的 catbus：启动时在目录里留 start-<pid>，收到 SIGTERM 时留 term-<pid> 后退出；
 * `version` 立即输出，其余命令等到目录里出现 release 才输出信封。不联网、不跑真的平台命令。
 */
const FAKE = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path')
const dir = process.env.FAKE_CATBUS_DIR
const env = JSON.stringify({ ok: true, data: { argv: process.argv.slice(2) }, page: null, error: null })
if (process.argv.includes('version')) { process.stdout.write(env); process.exit(0) }
fs.writeFileSync(path.join(dir, 'start-' + process.pid), '')
process.on('SIGTERM', () => { fs.writeFileSync(path.join(dir, 'term-' + process.pid), ''); process.exit(143) })
const t = setInterval(() => {
  if (fs.existsSync(path.join(dir, 'release'))) { clearInterval(t); process.stdout.write(env) }
}, 15)
`

let home = ''
let bin = ''
let dir = ''
let server: Server
let base = ''
const saved: Record<string, string | undefined> = {}

beforeAll(async () => {
  for (const k of ['CATBUS_HOME', 'CATBUS_BIN', 'FAKE_CATBUS_DIR']) saved[k] = process.env[k]
  home = mkdtempSync(join(tmpdir(), 'catbus-bridge-'))
  process.env.CATBUS_HOME = home
  bin = join(home, 'fake-catbus.cjs')
  writeFileSync(bin, FAKE)
  chmodSync(bin, 0o755)
  process.env.CATBUS_BIN = bin
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
    await until(() => files('term-').length === 1)
    await until(() => !alive(pid))
    expect(pidOf(files('term-')[0]!)).toBe(pid)
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
