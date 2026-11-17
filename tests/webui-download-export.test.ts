import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { optionArgs, parseOptions, DownloadError } from '../src/webui/download.js'
import { startServer } from '../src/webui/server.js'
import { useTempHome } from './helpers.js'

/**
 * WebUI 下载帖子信息、评论与导出格式（AGENTS.md 7.9「批量选择与下载」）：
 * bridge 校验新字段、拼 `item download` 的 argv，交付时按格式处理 CLI 写的 `<platform>_<id>.json`。
 * 子进程用假的 catbus（CATBUS_BIN）代替，不联网、不用真实账号。
 */

const home = useTempHome()

/** 一份合法的 ExportDoc（假数据） */
function exportDoc(id: string, opts: { comments?: number; truncated?: boolean } = {}) {
  const user = { id: 'u1', name: '测试用户', url: null, avatar: null }
  const comment = (n: number) => ({
    id: `c${n}`, item_id: id, parent_id: null, author: user, text: `评论 ${n}`, media: [], created_at: '2026-11-10T08:00:00+08:00',
    stats: { likes: n, replies: 1 },
    replies: [{ id: `r${n}`, item_id: id, parent_id: `c${n}`, author: user, text: `回复 ${n}`, media: [], created_at: null, stats: { likes: null, replies: null } }],
  })
  return {
    schema: 1,
    platform: 'xhs',
    exported_at: '2026-11-12T10:00:00+08:00',
    item: {
      id, kind: 'image', url: `https://example.com/${id}`, title: `标题 ${id}`, text: '正文', author: user, created_at: '2026-11-01T08:00:00+08:00',
      cover: null, media: [], stats: { views: null, likes: 10, comments: 2, collects: 3, shares: null }, price: null, status: null,
    },
    comments: Array.from({ length: opts.comments ?? 2 }, (_, i) => comment(i + 1)),
    comments_truncated: opts.truncated ?? false,
  }
}

describe('下载选项：校验与 argv', () => {
  it('缺省时等于原来的行为：只下媒体，不带任何新选项', () => {
    const o = parseOptions({})
    expect(o).toEqual({ media: true, meta: false, comments: 0, replies: 0, format: 'json' })
    expect(optionArgs(o)).toEqual([])
  })

  it('按约定拼 argv：--meta、--comments、--replies、--no-media', () => {
    expect(optionArgs(parseOptions({ meta: true }))).toEqual(['--meta'])
    expect(optionArgs(parseOptions({ meta: true, comments: 10, replies: 3 }))).toEqual(['--meta', '--comments', '10', '--replies', '3'])
    expect(optionArgs(parseOptions({ media: false, comments: 'all', replies: 'all', format: 'xlsx' }))).toEqual(['--comments', 'all', '--replies', 'all', '--no-media'])
    // 不取评论时楼中楼没有意义，不带 --replies
    expect(optionArgs(parseOptions({ meta: true, replies: 10 }))).toEqual(['--meta'])
  })

  it('白名单：不在取值表里的一律拒绝；什么都不下载时报错', () => {
    const bad = [
      { media: 'yes' }, { meta: 1 }, { comments: 7 }, { comments: '10' }, { comments: -1 }, { replies: 5 }, { replies: 'ALL' },
      { format: 'csv' }, { format: '../x' }, { comments: 10, replies: 1000 },
    ]
    for (const b of bad) expect(() => parseOptions(b), JSON.stringify(b)).toThrow(DownloadError)
    expect(() => parseOptions({ media: false, meta: false, comments: 0 })).toThrow('至少选一项')
    expect(() => parseOptions({ media: false })).toThrow('至少选一项')
    expect(parseOptions({ media: false, meta: true }).media).toBe(false)
  })
})

/** 读 zip 中央目录：条目名 → 内容（只存不压缩，直接从本地文件头后面取） */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(off + 24)
    const n = buf.readUInt16LE(off + 28), m = buf.readUInt16LE(off + 30), k = buf.readUInt16LE(off + 32)
    const local = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + n).toString('utf8')
    const ln = buf.readUInt16LE(local + 26), lm = buf.readUInt16LE(local + 28)
    out.set(name, buf.subarray(local + 30 + ln + lm, local + 30 + ln + lm + size))
    off += 46 + n + m + k
  }
  return out
}

describe('bridge：/api/download/start 的新字段与交付格式', () => {
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env.CATBUS_BIN
  })
  afterEach(async () => {
    if (saved === undefined) delete process.env.CATBUS_BIN
    else process.env.CATBUS_BIN = saved
    const { resetDownloadsForTest } = await import('../src/webui/download.js')
    resetDownloadsForTest()
  })

  /**
   * 假的 catbus：把 argv 追加到 argv.log；按 --no-media / --meta / --comments 在 --dir 里写媒体和 ExportDoc，
   * 输出 File[] 信封（信息文件的 type 为 data）。条目 ID 以 risk 开头时评论被风控截断。
   */
  function fakeCli(): string {
    const dir = join(home.dir, 'bin')
    mkdirSync(dir, { recursive: true })
    const log = join(dir, 'argv.log')
    const file = join(dir, 'fake-catbus.mjs')
    const docs = Object.fromEntries(['n1', 'n2', 'risk1'].map((id) => [id, exportDoc(id, id.startsWith('risk') ? { comments: 3, truncated: true } : {})]))
    writeFileSync(file, `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const argv = process.argv.slice(2)
appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n')
const dir = argv[argv.indexOf('--dir') + 1]
const id = argv.at(-1)
const out = []
if (!argv.includes('--no-media')) {
  const p = join(dir, 'xhs_' + id + '_1.jpg')
  writeFileSync(p, 'JPEG-' + id)
  out.push({ path: p, type: 'image', url: null, size: 6 })
}
if (argv.includes('--meta') || argv.includes('--comments') || argv.includes('--no-media')) {
  const docs = ${JSON.stringify(docs)}
  const doc = docs[id]
  if (!argv.includes('--comments')) doc.comments = []
  const p = join(dir, 'xhs_' + id + '.json')
  writeFileSync(p, JSON.stringify(doc, null, 2))
  out.push({ path: p, type: 'data', url: null, size: 1 })
}
process.stdout.write(JSON.stringify({ ok: true, data: out, page: null, error: null }))
`)
    chmodSync(file, 0o755)
    process.env.CATBUS_BIN = file
    return log
  }

  async function withServer(fn: (base: string) => Promise<void>) {
    const { server, port } = await startServer({ host: '127.0.0.1', port: 0, demo: false })
    try {
      await fn(`http://127.0.0.1:${port}/api/download`)
    } finally {
      server.close()
    }
  }

  const post = (base: string, path: string, body: unknown) =>
    fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  /** 等这一批跑完 */
  async function settle(base: string, id: string) {
    for (let i = 0; i < 200; i++) {
      const b = (await (await fetch(`${base}/list`)).json()).batches.find((x: { id: string }) => x.id === id)
      if (b && !b.items.some((it: { status: string }) => it.status === 'queued' || it.status === 'running')) return b
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('下载没有结束')
  }

  async function start(base: string, body: Record<string, unknown>, ids = ['n1', 'n2']) {
    const res = await post(base, 'start', { platform: 'xhs', items: ids.map((id) => ({ id, url: id, title: `标题 ${id}` })), ...body })
    expect(res.status).toBe(200)
    const { batch } = await res.json()
    return settle(base, batch.id)
  }

  const it_ = it.skipIf(process.platform === 'win32') // Windows 上 execFile 不认 shebang 脚本

  it('不合法的字段 400，什么都不下载 400，都不启动子进程', async () => {
    const log = fakeCli()
    await withServer(async (base) => {
      for (const body of [{ format: 'csv' }, { comments: 7 }, { replies: 'x' }, { media: 'no' }, { media: false, meta: false, comments: 0 }]) {
        const res = await post(base, 'start', { platform: 'xhs', items: [{ id: 'n1' }], ...body })
        expect(res.status, JSON.stringify(body)).toBe(400)
      }
    })
    expect(existsSync(log)).toBe(false)
  })

  it_('拼 argv：新选项放在 -- 之前；记录保存这一批的选项，重试时沿用', async () => {
    const log = fakeCli()
    await withServer(async (base) => {
      const b = await start(base, { media: false, meta: true, comments: 'all', replies: 3, format: 'txt' }, ['n1'])
      expect(b.opts).toEqual({ media: false, meta: true, comments: 'all', replies: 3, format: 'txt' })
      const argv = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
      const tail = argv[0]!.slice(argv[0]!.indexOf('download') + 1)
      expect(tail).toEqual(['--dir', b.items[0].dir, '--meta', '--comments', 'all', '--replies', '3', '--no-media', '--', 'n1'])
      // 取到了什么
      expect(b.items[0].got).toEqual({ media: 0, meta: true, comments: 2, replies: 2, truncated: false })
      expect(b.items[0].data).toMatch(/xhs_n1\.json$/)
      // 重试（把它标成过期）沿用同样的选项
      const { listBatches } = await import('../src/webui/download.js')
      listBatches()[0]!.items[0]!.expired = true
      expect((await post(base, 'retry', { batch: b.id })).status).toBe(200)
      await settle(base, b.id)
      const again = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
      expect(again).toHaveLength(2)
      expect(again[1]!.slice(again[1]!.indexOf('--meta'))).toEqual(['--meta', '--comments', 'all', '--replies', '3', '--no-media', '--', 'n1'])
    })
  })

  it_('缺省字段：与原来一样只下媒体，argv 不带新选项', async () => {
    const log = fakeCli()
    await withServer(async (base) => {
      const b = await start(base, {}, ['n1'])
      const argv = JSON.parse(readFileSync(log, 'utf8').trim()) as string[]
      expect(argv.slice(argv.indexOf('download') + 1)).toEqual(['--dir', b.items[0].dir, '--', 'n1'])
      expect(b.items[0].got).toEqual({ media: 1, meta: false, comments: null, replies: 0, truncated: false })
      const res = await fetch(`${base}/${b.id}/file`)
      expect(res.headers.get('content-type')).toBe('image/jpeg')
    })
  })

  it_('评论被风控截断：记录里标出 truncated 与已取到的条数', async () => {
    fakeCli()
    await withServer(async (base) => {
      const b = await start(base, { comments: 100, replies: 3 }, ['risk1'])
      expect(b.items[0].status).toBe('done')
      expect(b.items[0].got).toMatchObject({ media: 1, meta: true, comments: 3, truncated: true })
    })
  })

  it_('json：信息文件原样放进 zip 里这条帖子的目录', async () => {
    fakeCli()
    await withServer(async (base) => {
      const b = await start(base, { meta: true, comments: 10, replies: 3, format: 'json' })
      const res = await fetch(`${base}/${b.id}/file`)
      expect(res.headers.get('content-type')).toBe('application/zip')
      const zip = unzip(Buffer.from(await res.arrayBuffer()))
      expect([...zip.keys()].sort()).toEqual(['xhs/标题 n1/xhs_n1.json', 'xhs/标题 n1/xhs_n1_1.jpg', 'xhs/标题 n2/xhs_n2.json', 'xhs/标题 n2/xhs_n2_1.jpg'])
      expect(JSON.parse(zip.get('xhs/标题 n1/xhs_n1.json')!.toString('utf8')).comments).toHaveLength(2)
    })
  })

  it_('txt：信息换成目录里的 info.txt；只要信息时单条直接下载 txt，不打 zip', async () => {
    fakeCli()
    await withServer(async (base) => {
      const b = await start(base, { meta: true, comments: 10, format: 'txt' })
      const zip = unzip(Buffer.from(await (await fetch(`${base}/${b.id}/file`)).arrayBuffer()))
      expect([...zip.keys()].sort()).toEqual(['xhs/标题 n1/info.txt', 'xhs/标题 n1/xhs_n1_1.jpg', 'xhs/标题 n2/info.txt', 'xhs/标题 n2/xhs_n2_1.jpg'])
      expect(zip.get('xhs/标题 n1/info.txt')!.toString('utf8')).toContain('评论 1')

      const only = await start(base, { media: false, meta: true, format: 'txt' }, ['n1'])
      const res = await fetch(`${base}/${only.id}/file`)
      expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
      expect(res.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('标题 n1.txt')}`)
      const text = await res.text()
      expect(text).toContain('标题 n1')
      expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)))
      const head = await fetch(`${base}/${only.id}/file`, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
    })
  })

  it_('xlsx：整批汇总成一个 xlsx 放在 zip 根目录；只要信息时直接下载这个 xlsx', async () => {
    fakeCli()
    await withServer(async (base) => {
      const b = await start(base, { meta: true, comments: 10, format: 'xlsx' })
      const zip = unzip(Buffer.from(await (await fetch(`${base}/${b.id}/file`)).arrayBuffer()))
      const names = [...zip.keys()].sort()
      expect(names.filter((n) => n.endsWith('.jpg'))).toEqual(['xhs/标题 n1/xhs_n1_1.jpg', 'xhs/标题 n2/xhs_n2_1.jpg'])
      const xlsx = names.filter((n) => n.endsWith('.xlsx'))
      expect(xlsx).toHaveLength(1)
      expect(xlsx[0]).toMatch(/^catbus-xhs-\d{8}-\d{6}\.xlsx$/)
      expect(names.some((n) => n.endsWith('.json'))).toBe(false)
      // xlsx 本身是 zip（PK 开头）
      expect(zip.get(xlsx[0]!)!.subarray(0, 2).toString('latin1')).toBe('PK')

      const only = await start(base, { media: false, meta: true, format: 'xlsx' })
      const res = await fetch(`${base}/${only.id}/file`)
      expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(res.headers.get('content-disposition')).toMatch(/filename="catbus-xhs-\d{8}-\d{6}\.xlsx"/)
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 2).toString('latin1')).toBe('PK')
    })
  })

  it('信息文件读不出来（不是合法的 ExportDoc）时原样交付，不报错', async () => {
    const { batchDir, resetDownloadsForTest } = await import('../src/webui/download.js')
    resetDownloadsForTest()
    const id = 'b0000000-0000-4000-8000-0000000000aa'
    const dir = join(batchDir(id), 'xhs', 't')
    mkdirSync(dir, { recursive: true })
    const data = join(dir, 'xhs_n1.json')
    writeFileSync(data, '{"schema":2}')
    const batch = {
      v: 2, id, platform: 'xhs', account: null, dir: batchDir(id), created_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      opts: { media: false, meta: true, comments: 0, replies: 0, format: 'txt' },
      items: [{ id: 'n1', url: 'n1', title: 't', cover: null, kind: null, dir, status: 'done', files: [data], data, error: null }],
    }
    mkdirSync(join(home.dir, 'cache', 'webui'), { recursive: true })
    writeFileSync(join(home.dir, 'cache', 'webui', 'downloads.json'), JSON.stringify([batch]))
    await withServer(async (base) => {
      const res = await fetch(`${base}/${id}/file`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(await res.text()).toBe('{"schema":2}')
    })
  })
})

describe('/api/filters：comments 能力', () => {
  it('comment list 已实现的平台为 true', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.xhs!.comments).toBe(true)
    expect(all.mteam!.comments).toBe(false)
  })
})
