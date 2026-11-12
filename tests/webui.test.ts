import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { validateArgv } from '../src/webui/bridge.js'
import { buildUrl, demoRedirect, guard, isLoopback, probe, readState, serveStatic, startServer, writeState } from '../src/webui/server.js'
import { cli, useTempHome } from './helpers.js'

const tempHome = useTempHome()

/** 最小的 req / res 替身：记录状态码、响应头和正文 */
function fake(url: string, headers: Record<string, string> = {}, method = 'GET') {
  const req = { url, method, headers } as unknown as IncomingMessage
  const out = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const res = {
    set statusCode(v: number) { out.status = v },
    get statusCode() { return out.status },
    setHeader(k: string, v: unknown) { out.headers[k.toLowerCase()] = v },
    end(b?: string) { out.body = b ?? '' },
    destroy() {},
  } as unknown as ServerResponse
  return { req, res, out }
}

describe('catbus web（AGENTS 4.10）', () => {
  it('status：没有在运行', async () => {
    const r = await cli('web', 'status')
    expect(r.code).toBe(0)
    expect(r.env).toMatchObject({ ok: true, resource: 'web', action: 'status', data: { running: false, url: null, pid: null } })
  })

  it('--web 是别名：--web status、--web --help', async () => {
    expect((await cli('--web', 'status')).env.data.running).toBe(false)
    const h = await cli('--web', '--help')
    expect(h.code).toBe(0)
    expect(h.stdout).toContain('catbus web stop')
  })

  it('stop：没有在运行时不报错', async () => {
    const r = await cli('web', 'stop')
    expect(r.code).toBe(0)
    expect(r.env.data.running).toBe(false)
  })

  it('记录里的服务已经不在时，status 清掉记录', async () => {
    await writeState({ pid: 999999, host: '127.0.0.1', port: 1, url: 'http://127.0.0.1:1/', demo: false, detached: true, token: null, started_at: '', log: null })
    expect((await cli('web', 'status')).env.data.running).toBe(false)
    expect(await readState()).toBeNull()
  })

  it('用法错误', async () => {
    expect((await cli('web', 'nope')).code).toBe(2)
    expect((await cli('web', 'stop', '--port', '1')).code).toBe(2)
    expect((await cli('web', '--port', '70000')).code).toBe(2)
    expect((await cli('web', '--host', 'a b')).code).toBe(2)
    expect((await cli('web', '--limit', '3')).code).toBe(2)
    expect((await cli('version', '--demo')).code).toBe(2)
  })

  it('没有构建前端时报 ERROR，提示 npm run build:web', async () => {
    const r = await cli('web', '--headless', '--port', '0')
    expect(r.code).toBe(1)
    expect(r.env.error).toMatchObject({ code: 'ERROR', hint: '在仓库根目录执行 npm run build:web' })
  })
})

describe('WebUI 服务', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catbus-webui-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html>')
  writeFileSync(join(dir, 'assets', 'a-123.js'), 'x')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('静态文件：路径不能逃出目录，未知路由回退 index.html，资源找不到是 404', () => {
    // 成功的用 HEAD：替身 res 不支持 pipe
    const get = (u: string, method = 'GET') => {
      const f = fake(u, {}, method)
      serveStatic(f.req, f.res, dir)
      return f.out
    }
    expect(get('/../package.json').status).toBe(403)
    expect(get('/%2e%2e/%2e%2e/package.json').status).toBe(403)
    expect(get('/%E0%A4%A').status).toBe(400)
    expect(get('/some/route', 'HEAD').headers['content-type']).toBe('text/html; charset=utf-8')
    expect(get('/assets/nope.js').status).toBe(404)
    const js = get('/assets/a-123.js', 'HEAD')
    expect(js.status).toBe(200)
    expect(js.headers['cache-control']).toContain('immutable')
  })

  it('回环地址：Host 必须是回环名（防 DNS rebinding）', () => {
    const ok = fake('/', { host: '127.0.0.1:5174' })
    expect(guard(ok.req, ok.res, { token: null, port: 5174 })).toBe(false)
    const bad = fake('/', { host: 'evil.example:5174' })
    expect(guard(bad.req, bad.res, { token: null, port: 5174 })).toBe(true)
    expect(bad.out.status).toBe(421)
  })

  it('访问令牌：?token= 换成 cookie 并去掉令牌重定向，之后只认 cookie', () => {
    const access = { token: 'secret', port: 9 }
    const none = fake('/', { host: '192.168.1.2:9' })
    expect(guard(none.req, none.res, access)).toBe(true)
    expect(none.out.status).toBe(401)
    const wrong = fake('/?token=nope', { host: '192.168.1.2:9' })
    guard(wrong.req, wrong.res, access)
    expect(wrong.out.status).toBe(401)
    const login = fake('/?demo&token=secret', { host: '192.168.1.2:9' })
    expect(guard(login.req, login.res, access)).toBe(true)
    expect(login.out.status).toBe(302)
    expect(login.out.headers.location).toBe('/?demo')
    expect(login.out.headers['set-cookie']).toBe('catbus_webui_9=secret; Path=/; HttpOnly; SameSite=Strict')
    const after = fake('/api/catbus', { host: '192.168.1.2:9', cookie: 'a=1; catbus_webui_9=secret' })
    expect(guard(after.req, after.res, access)).toBe(false)
  })

  it('演示模式：页面一律重定向到 ?demo，静态资源和已带 ?demo 的不动', () => {
    const page = fake('/some/route?x=1')
    expect(demoRedirect(page.req, page.res)).toBe(true)
    expect(page.out.status).toBe(302)
    expect(page.out.headers.location).toBe('/some/route?demo&x=1')
    const root = fake('/')
    demoRedirect(root.req, root.res)
    expect(root.out.headers.location).toBe('/?demo')
    expect(demoRedirect(fake('/?demo').req, fake('/').res)).toBe(false)
    expect(demoRedirect(fake('/assets/a.js').req, fake('/').res)).toBe(false)
  })

  it('演示模式不要令牌，也不校验 Host', async () => {
    const f = fake('/', { host: '192.168.1.2:9' })
    expect(guard(f.req, f.res, { token: null, port: 9, demo: true })).toBe(false)
    const { server, token } = await startServer({ host: '0.0.0.0', port: 0, demo: true })
    server.close()
    expect(token).toBeNull()
  })

  it('地址', () => {
    expect(buildUrl('127.0.0.1', 5174, { demo: false, token: null })).toBe('http://127.0.0.1:5174/')
    expect(buildUrl('0.0.0.0', 1, { demo: true, token: 't' })).toBe('http://127.0.0.1:1/?demo&token=t')
    expect(buildUrl('::', 1, { demo: false, token: null })).toBe('http://[::1]:1/')
    expect(isLoopback('localhost')).toBe(true)
    expect(isLoopback('127.0.0.2')).toBe(true)
    expect(isLoopback('0.0.0.0')).toBe(false)
  })

  it('演示模式拒绝全部 /api/*；健康检查报告自己的 pid', async () => {
    const { server, port, token } = await startServer({ host: '127.0.0.1', port: 0, demo: true })
    try {
      expect(token).toBeNull()
      expect(await probe({ host: '127.0.0.1', port })).toBe(process.pid)
      const res = await fetch(`http://127.0.0.1:${port}/api/catbus`, { method: 'POST', body: '{"argv":["version"]}' })
      expect(res.status).toBe(503)
      expect((await res.json()).error.code).toBe('BRIDGE')
    } finally {
      server.close()
    }
  })

  it('bridge 白名单不放行写操作', () => {
    expect(validateArgv(['version'])).toEqual(['version'])
    expect(() => validateArgv(['xhs', 'auth', 'logout'])).toThrow('暂不开放')
    expect(validateArgv(['xhs', 'item', 'search', '-x', '--limit', '5'])).toEqual(['xhs', 'item', 'search', '--limit', '5', '--', '-x'])
  })
})

describe('视频代理白名单', () => {
  it('快手的 ndcimgs.com 也放行；白名单外的域名被拒并在 stderr 留下域名', async () => {
    const { checkMediaUrl } = await import('../src/webui/media.js')
    expect(checkMediaUrl('kuaishou', 'https://k0abc.djvod.ndcimgs.com/a.mp4').hostname).toBe('k0abc.djvod.ndcimgs.com')
    expect(checkMediaUrl('kuaishou', 'https://v23-3.kwaicdn.com/a.mp4').hostname).toBe('v23-3.kwaicdn.com')
    const writes: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((c: string) => (writes.push(String(c)), true)) as typeof process.stderr.write
    try {
      expect(() => checkMediaUrl('kuaishou', 'https://evil.example.com/a.mp4')).toThrow('白名单')
    } finally {
      process.stderr.write = orig
    }
    expect(writes.join('')).toContain('evil.example.com')
  })
})

describe('原始 JSON：item get 放行 --raw', () => {
  it('只有 item get 能带 --raw，-a 仍在最前', () => {
    expect(validateArgv(['xhs', 'item', 'get', 'abc', '-a', 'work', '--raw'])).toEqual(['xhs', 'item', 'get', '-a', 'work', '--raw', '--', 'abc'])
    expect(validateArgv(['xhs', 'item', 'get', 'abc', '--raw', '--raw'])).toEqual(['xhs', 'item', 'get', '--raw', '--', 'abc'])
    expect(() => validateArgv(['xhs', 'item', 'search', 'kw', '--raw'])).toThrow('不允许的选项')
    expect(() => validateArgv(['xhs', 'comment', 'list', 'abc', '--raw'])).toThrow('不允许的选项')
  })
})

describe('相关推荐：item related', () => {
  it('放行 item related，<item> 只接受链接或 ID，只能带 --limit 和 -a', () => {
    expect(validateArgv(['bilibili', 'item', 'related', 'BV1xx411c7mD', '-a', 'work', '--limit', '12'])).toEqual(
      ['bilibili', 'item', 'related', '-a', 'work', '--limit', '12', '--', 'BV1xx411c7mD'],
    )
    expect(validateArgv(['tiktok', 'item', 'related', 'https://www.tiktok.com/@a/video/1'])).toEqual(
      ['tiktok', 'item', 'related', '--', 'https://www.tiktok.com/@a/video/1'],
    )
    expect(() => validateArgv(['bilibili', 'item', 'related'])).toThrow('缺少条目')
    expect(() => validateArgv(['bilibili', 'item', 'related', '--limit'])).toThrow()
    expect(() => validateArgv(['bilibili', 'item', 'related', 'file:///etc/passwd'])).toThrow('http(s)')
    expect(() => validateArgv(['bilibili', 'item', 'related', 'BV1', '--cursor', 'x'])).toThrow('不允许的选项')
    expect(() => validateArgv(['bilibili', 'item', 'related', 'BV1', '--raw'])).toThrow('不允许的选项')
    expect(() => validateArgv(['bilibili', 'item', 'related', 'BV1', '-a', 'guest'])).toThrow('账号名不合法')
  })

  it('/api/filters 按注册表给出 item related 是否已实现', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    for (const p of ['tiktok', 'bilibili', 'kuaishou', 'jd', 'youtube']) expect(all[p]!.related).toBe(true)
    for (const p of ['xhs', 'douyin', 'mteam', 'maoyan']) expect(all[p]!.related).toBe(false)
  })
})

describe('服务端设置 /api/settings', () => {
  const home = tempHome
  const req = (port: number, method: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${port}/api/settings`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  async function withServer(fn: (port: number) => Promise<void>, opts: { host?: string; demo?: boolean } = {}) {
    const { server, port } = await startServer({ host: opts.host ?? '127.0.0.1', port: 0, demo: opts.demo ?? false })
    try {
      await fn(port)
    } finally {
      server.close()
    }
  }

  it('读：没有代理；平台代理只读返回；不再有下载目录', async () => {
    writeFileSync(join(home.dir, 'config.toml'), '[xhs]\nproxy = "socks5://127.0.0.1:1080"\n')
    // 以前的 webui.json 读到也忽略
    writeFileSync(join(home.dir, 'webui.json'), JSON.stringify({ version: 1, downloadDir: home.dir }))
    await withServer(async (port) => {
      const env = await (await req(port, 'GET')).json()
      expect(env.ok).toBe(true)
      expect(env.data).toEqual({ proxy: { value: null, platforms: { xhs: 'socks5://127.0.0.1:1080' } } })
    })
  })

  it('写：代理写进 config.toml，清空时删掉', async () => {
    await withServer(async (port) => {
      const env = await (await req(port, 'PUT', { proxy: 'http://127.0.0.1:7890' })).json()
      expect(env.ok).toBe(true)
      expect(env.data.proxy.value).toBe('http://127.0.0.1:7890')
    })
    expect(readFileSync(join(home.dir, 'config.toml'), 'utf8')).toContain('proxy = "http://127.0.0.1:7890"')
    await withServer(async (port) => {
      const env = await (await req(port, 'PUT', { proxy: '' })).json()
      expect(env.data.proxy.value).toBeNull()
    })
    expect(readFileSync(join(home.dir, 'config.toml'), 'utf8')).not.toContain('proxy')
    expect(existsSync(join(home.dir, 'webui.json'))).toBe(false)
  })

  it('只认 proxy：downloadDir 按未知键拒绝；非法代理被拒且什么都不改', async () => {
    await withServer(async (port) => {
      const bad = async (body: unknown, status = 400) => {
        const r = await req(port, 'PUT', body)
        expect(r.status).toBe(status)
        expect((await r.json()).error.code).toBe('BRIDGE')
      }
      await bad({ timeout: 5 })
      await bad({ proxy: 'http://127.0.0.1:1', 'xhs.proxy': 'http://127.0.0.1:2' })
      await bad({})
      await bad([])
      await bad('{oops')
      await bad({ downloadDir: home.dir })
      await bad({ downloadDir: null })
      await bad({ proxy: 'ftp://127.0.0.1:21' })
      await bad({ proxy: 'not a url' })
      // 一项不合法时另一项也不写
      await bad({ downloadDir: home.dir, proxy: 'http://127.0.0.1:7890' })
      // 必须是 JSON 请求体；其他方法不收
      expect((await req(port, 'PUT', undefined, { 'content-type': 'text/plain' })).status).toBe(415)
      expect((await req(port, 'POST', { proxy: '' })).status).toBe(405)
      // 跨站请求
      expect((await req(port, 'PUT', { proxy: '' }, { origin: 'http://evil.example' })).status).toBe(403)
    })
    expect(existsSync(join(home.dir, 'webui.json'))).toBe(false)
    expect(existsSync(join(home.dir, 'config.toml'))).toBe(false)
  })

  it('演示模式拒绝读写', async () => {
    await withServer(
      async (port) => {
        expect((await req(port, 'GET')).status).toBe(503)
        expect((await req(port, 'PUT', { proxy: 'http://127.0.0.1:7890' })).status).toBe(503)
      },
      { demo: true },
    )
    expect(existsSync(join(home.dir, 'config.toml'))).toBe(false)
  })

  it('非回环地址：没有访问令牌的请求一律 401', async () => {
    const { server, port, token } = await startServer({ host: '0.0.0.0', port: 0, demo: false })
    try {
      expect(token).toBeTruthy()
      expect((await req(port, 'PUT', { proxy: 'http://127.0.0.1:7890' })).status).toBe(401)
      const ok = await req(port, 'GET', undefined, { cookie: `catbus_webui_${port}=${token}` })
      expect(ok.status).toBe(200)
    } finally {
      server.close()
    }
    expect(existsSync(join(home.dir, 'config.toml'))).toBe(false)
  })
})

describe('下载交给浏览器 /api/download/<batch>/.../file', () => {
  const home = tempHome
  type Fx = { id: string; title?: string | null; status?: string; files?: Record<string, string>; expired?: boolean }

  /** 在临时 CATBUS_HOME 里造一批下载记录和临时文件（不跑 CLI） */
  async function fixture(items: Fx[], opts: { id?: string; platform?: string; finished_at?: string } = {}) {
    const { batchDir, resetDownloadsForTest } = await import('../src/webui/download.js')
    resetDownloadsForTest()
    const id = opts.id ?? 'b0000000-0000-4000-8000-000000000001'
    const platform = opts.platform ?? 'xhs'
    const dir = batchDir(id)
    const batch = {
      v: 2,
      id,
      platform,
      account: null,
      dir,
      created_at: '2026-11-10T08:09:10.000Z',
      finished_at: opts.finished_at ?? new Date().toISOString(),
      items: items.map((it) => {
        const itemDir = join(dir, platform, it.title ?? it.id)
        const files = Object.entries(it.files ?? {}).map(([name, body]) => {
          const f = join(itemDir, name)
          mkdirSync(itemDir, { recursive: true })
          writeFileSync(f, body)
          return f
        })
        return { id: it.id, url: it.id, title: it.title ?? null, cover: null, kind: 'image', dir: itemDir, status: it.status ?? 'done', files, error: null, expired: it.expired }
      }),
    }
    return { batch, dir, write: (list: unknown[]) => {
      mkdirSync(join(home.dir, 'cache', 'webui'), { recursive: true })
      writeFileSync(join(home.dir, 'cache', 'webui', 'downloads.json'), JSON.stringify(list))
    } }
  }

  async function withServer(fn: (base: string) => Promise<void>) {
    const { server, port } = await startServer({ host: '127.0.0.1', port: 0, demo: false })
    try {
      await fn(`http://127.0.0.1:${port}/api/download`)
    } finally {
      server.close()
      const { resetDownloadsForTest } = await import('../src/webui/download.js')
      resetDownloadsForTest()
    }
  }

  /** 读 zip 的中央目录：返回每个条目的名字和压缩方式 */
  function zipEntries(buf: Buffer): { name: string; method: number; size: number }[] {
    let eocd = buf.length - 22
    while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
    expect(eocd).toBeGreaterThanOrEqual(0)
    const count = buf.readUInt16LE(eocd + 10)
    let off = buf.readUInt32LE(eocd + 16)
    const out = []
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(off)).toBe(0x02014b50)
      const method = buf.readUInt16LE(off + 10)
      const size = buf.readUInt32LE(off + 24)
      const n = buf.readUInt16LE(off + 28), m = buf.readUInt16LE(off + 30), k = buf.readUInt16LE(off + 32)
      out.push({ name: buf.subarray(off + 46, off + 46 + n).toString('utf8'), method, size })
      off += 46 + n + m + k
    }
    return out
  }

  it('单个文件：直接下载，Content-Disposition 带中文文件名的 filename*，HEAD 只给头', async () => {
    const fx = await fixture([{ id: 'n1', title: '小猫', files: { '小猫的照片.jpg': 'JPEGDATA' } }])
    fx.write([fx.batch])
    await withServer(async (base) => {
      const res = await fetch(`${base}/${fx.batch.id}/n1/file`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/jpeg')
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('content-length')).toBe('8')
      const cd = res.headers.get('content-disposition')!
      expect(cd).toBe(`attachment; filename="_____.jpg"; filename*=UTF-8''${encodeURIComponent('小猫的照片.jpg')}`)
      expect(await res.text()).toBe('JPEGDATA')
      // 整批只有一个文件时同样直接给文件
      const whole = await fetch(`${base}/${fx.batch.id}/file`)
      expect(whole.headers.get('content-type')).toBe('image/jpeg')
      const head = await fetch(`${base}/${fx.batch.id}/n1/file`, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(await head.text()).toBe('')
      expect((await fetch(`${base}/${fx.batch.id}/n1/file`, { method: 'POST' })).status).toBe(405)
      expect((await fetch(`${base}/${fx.batch.id}/n1/file`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    })
  })

  it('多个文件：流式打成 zip（只存不压缩），条目为 <p>/<标题>/<文件名>', async () => {
    const fx = await fixture([
      { id: 'n1', title: '第一条', files: { 'xhs_n1_1.jpg': 'a'.repeat(100), 'xhs_n1_2.mp4': 'b'.repeat(50) } },
      { id: 'n2', title: '第二条', files: { 'xhs_n2_1.jpg': 'c' } },
      { id: 'n3', title: '失败的', status: 'failed' },
    ])
    fx.write([fx.batch])
    await withServer(async (base) => {
      const res = await fetch(`${base}/${fx.batch.id}/file`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="catbus-xhs-\d{8}-\d{6}\.zip"; filename\*=UTF-8''catbus-xhs-\d{8}-\d{6}\.zip$/)
      const entries = zipEntries(Buffer.from(await res.arrayBuffer()))
      expect(entries.map((e) => e.name).sort()).toEqual(['xhs/第一条/xhs_n1_1.jpg', 'xhs/第一条/xhs_n1_2.mp4', 'xhs/第二条/xhs_n2_1.jpg'])
      expect(entries.every((e) => e.method === 0)).toBe(true)
      expect(entries.find((e) => e.name.endsWith('n1_1.jpg'))!.size).toBe(100)
      // 一条多文件：zip 名用标题
      const one = await fetch(`${base}/${fx.batch.id}/n1/file`)
      expect(one.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('第一条.zip')}`)
      expect(zipEntries(Buffer.from(await one.arrayBuffer()))).toHaveLength(2)
      // 重试后单独交付的几条
      const sub = await fetch(`${base}/${fx.batch.id}/file?item=n2`)
      expect(sub.headers.get('content-type')).toBe('image/jpeg')
    })
  })

  it('未知批次、未知条目、没有文件的条目 404；不接受路径', async () => {
    const fx = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }, { id: 'n2', status: 'failed' }])
    fx.write([fx.batch])
    await withServer(async (base) => {
      expect((await fetch(`${base}/nope/file`)).status).toBe(404)
      expect((await fetch(`${base}/${fx.batch.id}/nope/file`)).status).toBe(404)
      expect((await fetch(`${base}/${fx.batch.id}/n2/file`)).status).toBe(404)
      expect((await fetch(`${base}/${fx.batch.id}/file?item=nope`)).status).toBe(404)
      expect((await fetch(`${base}/${fx.batch.id}/..%2F..%2Fdownloads.json/file`)).status).toBe(404)
      expect((await fetch(`${base}/${fx.batch.id}/n1/x/file`)).status).toBe(404)
    })
  })

  it('文件已被清理时 410，条目标为已过期', async () => {
    const fx = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }, { id: 'n2', title: 'u', files: { 'b.jpg': 'y' } }])
    fx.write([fx.batch])
    await withServer(async (base) => {
      rmSync(join(fx.dir, 'xhs', 't'), { recursive: true })
      const res = await fetch(`${base}/${fx.batch.id}/n1/file`)
      expect(res.status).toBe(410)
      expect((await res.json()).error.message).toBe('文件已过期，请重新下载')
      expect((await fetch(`${base}/${fx.batch.id}/n2/file`)).status).toBe(200)
      const list = (await (await fetch(`${base}/list`)).json()).batches
      expect(list[0].items.map((it: { expired?: boolean }) => !!it.expired)).toEqual([true, false])
      // 整个临时目录没了
      rmSync(fx.dir, { recursive: true })
      expect((await fetch(`${base}/${fx.batch.id}/n2/file`)).status).toBe(410)
    })
  })

  it('路径穿越和软链接逃逸被拒（403）', async () => {
    const outside = join(home.dir, 'secret.txt')
    writeFileSync(outside, 'secret')
    const fx = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }, { id: 'n2', title: 'u', files: {} }])
    const link = join(fx.dir, 'xhs', 'u', 'b.jpg')
    mkdirSync(join(fx.dir, 'xhs', 'u'), { recursive: true })
    symlinkSync(outside, link)
    fx.batch.items[1]!.files = [link]
    const evil = { ...fx.batch, id: 'b0000000-0000-4000-8000-000000000002', items: [{ ...fx.batch.items[0]!, id: 'n3', files: [join(batchDirOf('b0000000-0000-4000-8000-000000000002'), '..', '..', '..', 'secret.txt')] }] }
    mkdirSync(batchDirOf(evil.id), { recursive: true })
    fx.write([fx.batch, evil])
    await withServer(async (base) => {
      expect((await fetch(`${base}/${fx.batch.id}/n1/file`)).status).toBe(200)
      expect((await fetch(`${base}/${fx.batch.id}/n2/file`)).status).toBe(403)
      // 整批里有一条逃逸时整批都拒绝
      expect((await fetch(`${base}/${fx.batch.id}/file`)).status).toBe(403)
      expect((await fetch(`${base}/${evil.id}/n3/file`)).status).toBe(403)
    })
  })

  it('过期清理：完成超过 1 小时的删掉临时目录并标为已过期，残留目录删掉，服务启动时也清理', async () => {
    const old = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }], { finished_at: new Date(Date.now() - 2 * 3600_000).toISOString() })
    const fresh = await fixture([{ id: 'n2', title: 'u', files: { 'b.jpg': 'y' } }], { id: 'b0000000-0000-4000-8000-000000000003' })
    const orphan = batchDirOf('orphan-dir')
    mkdirSync(orphan, { recursive: true })
    old.write([fresh.batch, old.batch])
    await withServer(async (base) => {
      expect(existsSync(old.dir)).toBe(false)
      expect(existsSync(orphan)).toBe(false)
      expect(existsSync(fresh.dir)).toBe(true)
      expect((await fetch(`${base}/${old.batch.id}/n1/file`)).status).toBe(410)
      expect((await fetch(`${base}/${fresh.batch.id}/n2/file`)).status).toBe(200)
      // 运行中定期清理：时间过了 1 小时后 fresh 也被清掉
      const { cleanupDownloads, listBatches } = await import('../src/webui/download.js')
      cleanupDownloads(Date.now() + 2 * 3600_000)
      expect(existsSync(fresh.dir)).toBe(false)
      expect(listBatches().find((b) => b.id === fresh.batch.id)!.items[0]!.expired).toBe(true)
    })
  })

  it('删除记录时连同临时文件一起删', async () => {
    const fx = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }, { id: 'n2', title: 'u', files: { 'b.jpg': 'y' } }])
    fx.write([fx.batch])
    await withServer(async (base) => {
      const post = (path: string, body: unknown) => fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect((await post('remove', { batch: fx.batch.id, item: 'n1' })).status).toBe(200)
      expect(existsSync(join(fx.dir, 'xhs', 't'))).toBe(false)
      expect(existsSync(join(fx.dir, 'xhs', 'u', 'b.jpg'))).toBe(true)
      expect((await post('remove', { batch: fx.batch.id })).status).toBe(200)
      expect(existsSync(fx.dir)).toBe(false)
    })
  })

  it('reveal（在文件管理器中打开）接口已经不存在', async () => {
    const fx = await fixture([{ id: 'n1', title: 't', files: { 'a.jpg': 'x' } }])
    fx.write([fx.batch])
    await withServer(async (base) => {
      const res = await fetch(`${base}/reveal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batch: fx.batch.id }) })
      expect(res.status).toBe(404)
    })
    const mod = await import('../src/webui/download.js')
    expect('reveal' in mod).toBe(false)
  })

  it('旧版本的记录（文件在服务端下载目录里）迁到临时目录，完成的标为已过期', async () => {
    const legacy = { id: 'b0000000-0000-4000-8000-000000000009', platform: 'xhs', account: null, dir: join(home.dir, 'Downloads', 'catbus', 'xhs'), root: join(home.dir, 'Downloads', 'catbus'), created_at: new Date().toISOString(), items: [{ id: 'n1', url: 'n1', title: 't', cover: null, kind: null, dir: join(home.dir, 'Downloads', 'catbus', 'xhs', 't'), status: 'done', files: [join(home.dir, 'Downloads', 'catbus', 'xhs', 't', 'a.jpg')], error: null }] }
    const fx = await fixture([])
    fx.write([legacy])
    await withServer(async (base) => {
      expect((await fetch(`${base}/${legacy.id}/n1/file`)).status).toBe(410)
      const b = (await (await fetch(`${base}/list`)).json()).batches[0]
      expect(b.v).toBe(2)
      expect(b.dir).toBe(batchDirOf(legacy.id))
      expect(b.items[0]).toMatchObject({ expired: true, files: [], dir: join(batchDirOf(legacy.id), 'xhs', 't') })
    })
  })

  function batchDirOf(id: string) {
    return join(home.dir, 'cache', 'webui', 'downloads', id)
  }
})

describe('字段排序：item search / feed list 放行 --order-by 与 --asc', () => {
  it('搜索和浏览都能带，--asc 是不带值的开关', () => {
    expect(validateArgv(['mteam', 'item', 'search', 'kw', '--limit', '20', '--order-by', 'size', '--asc'])).toEqual(
      ['mteam', 'item', 'search', '--limit', '20', '--order-by', 'size', '--asc', '--', 'kw'],
    )
    expect(validateArgv(['mteam', 'feed', 'list', '-a', 'work', '--order-by', 'seeders'])).toEqual(
      ['mteam', 'feed', 'list', '-a', 'work', '--order-by', 'seeders'],
    )
    expect(() => validateArgv(['mteam', 'item', 'get', '123', '--asc'])).toThrow('不允许的选项')
    expect(() => validateArgv(['mteam', 'comment', 'list', '123', '--order-by', 'size'])).toThrow('不允许的选项')
  })

  it('/api/filters 只给声明了 --order-by 的平台列出取值', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.mteam!.order).toEqual(['date', 'size', 'seeders', 'leechers', 'name'])
    expect(all.xhs!.order).toBeNull()
  })

  it('/api/filters 给出 item search 的 --time 和已实现的 feed list 的 --kind 取值', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.xhs!.time).toEqual(['all', 'day', 'week', 'half_year'])
    expect(all.douyin!.kind).toEqual(['recommend', 'hot', 'following'])
    // 只声明了 recommend 的平台（猫眼）给出单个取值，页面据此不显示分段
    expect(all.maoyan!.kind).toEqual(['recommend'])
    expect(all.mteam!.kind).toBeNull()
    expect(all.mteam!.time).toBeNull()
    // feed list 没有实现（只占位）的平台不给
    expect(all.weibo!.kind).toBeNull()
  })

  it('bridge 放行 feed list --kind 与 item search --time', () => {
    expect(validateArgv(['douyin', 'feed', 'list', '--kind', 'hot'])).toEqual(['douyin', 'feed', 'list', '--kind', 'hot'])
    expect(validateArgv(['xhs', 'item', 'search', '露营', '--time', 'week'])).toEqual(['xhs', 'item', 'search', '--time', 'week', '--', '露营'])
    expect(() => validateArgv(['douyin', 'feed', 'list', '--time', 'day'])).toThrow('不允许的选项')
    expect(() => validateArgv(['douyin', 'item', 'search', 'x', '--kind', 'hot'])).toThrow('不允许的选项')
  })
})

describe('作者页：user get / user items', () => {
  it('放行 user get、user items，<user> 放在 -- 之后，只接受 http(s) 链接或 ID', () => {
    expect(validateArgv(['xhs', 'user', 'get', 'https://www.xiaohongshu.com/user/profile/5f?xsec_token=a', '-a', 'work'])).toEqual([
      'xhs', 'user', 'get', '-a', 'work', '--', 'https://www.xiaohongshu.com/user/profile/5f?xsec_token=a',
    ])
    expect(validateArgv(['douyin', 'user', 'items', 'MS4wLjABAAAA', '--limit', '20', '--cursor', 'c1'])).toEqual([
      'douyin', 'user', 'items', '--limit', '20', '--cursor', 'c1', '--', 'MS4wLjABAAAA',
    ])
    expect(() => validateArgv(['xhs', 'user', 'get', '-x'])).toThrow()
    expect(() => validateArgv(['xhs', 'user', 'items', 'javascript:alert(1)'])).toThrow()
    expect(() => validateArgv(['xhs', 'user', 'items'])).toThrow()
    expect(() => validateArgv(['xhs', 'user', 'get', 'abc', '--limit', '5'])).toThrow('不允许的选项')
    expect(() => validateArgv(['xhs', 'user', 'items', 'abc', '--raw'])).toThrow('不允许的选项')
    expect(() => validateArgv(['xhs', 'user', 'follow', 'abc'])).toThrow('暂不开放')
    expect(() => validateArgv(['xhs', 'user', 'update', '--name', 'x'])).toThrow('暂不开放')
  })

  it('/api/filters 的 author：user get 和 user items 都已实现才为 true', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.xhs!.author).toBe(true)
    expect(all.douyin!.author).toBe(true)
    // 闲鱼、淘宝没有 user items，京东只有 user get（只支持 me）
    expect(all.xianyu!.author).toBe(false)
    expect(all.taobao!.author).toBe(false)
    expect(all.jd!.author).toBe(false)
  })
})

describe('搜索联想与热搜：放行 keyword suggest / keyword hot', () => {
  it('前缀放在 -- 之后，可带 -a，不接受其他选项', () => {
    expect(validateArgv(['xhs', 'keyword', 'suggest', '-猫', '-a', 'work'])).toEqual(['xhs', 'keyword', 'suggest', '-a', 'work', '--', '-猫'])
    expect(validateArgv(['jd', 'keyword', 'hot'])).toEqual(['jd', 'keyword', 'hot'])
    expect(validateArgv(['jd', 'keyword', 'hot', '-a', 'work'])).toEqual(['jd', 'keyword', 'hot', '-a', 'work'])
    expect(() => validateArgv(['xhs', 'keyword', 'suggest', '猫', '--limit', '5'])).toThrow('不允许的选项')
    expect(() => validateArgv(['xhs', 'keyword', 'hot', '--raw'])).toThrow('不允许的选项')
    expect(() => validateArgv(['xhs', 'keyword', 'hot', '-a', 'guest'])).toThrow('账号名不合法')
  })

  it('前缀不能为空，也不能超过 100 个字符', () => {
    expect(() => validateArgv(['xhs', 'keyword', 'suggest'])).toThrow('缺少联想前缀')
    expect(() => validateArgv(['xhs', 'keyword', 'suggest', '   '])).toThrow('缺少联想前缀')
    expect(validateArgv(['xhs', 'keyword', 'suggest', '猫'.repeat(100)])).toEqual(['xhs', 'keyword', 'suggest', '--', '猫'.repeat(100)])
    expect(() => validateArgv(['xhs', 'keyword', 'suggest', '猫'.repeat(101)])).toThrow('不能超过 100')
  })

  it('keyword 下别的动作不放行', () => {
    expect(() => validateArgv(['xhs', 'keyword', 'list'])).toThrow('暂不开放')
  })

  it('/api/filters 按注册表给出 suggest / hot', async () => {
    const { platformFilters } = await import('../src/webui/filters.js')
    const all = await platformFilters()
    expect(all.xhs).toMatchObject({ suggest: true, hot: true })
    expect(all.jd).toMatchObject({ suggest: true, hot: true })
    expect(all.tiktok).toMatchObject({ suggest: true, hot: false })
    expect(all.youtube).toMatchObject({ suggest: true, hot: false })
    expect(all.douyin).toMatchObject({ suggest: false, hot: false })
  })
})
