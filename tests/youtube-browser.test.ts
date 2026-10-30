import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatbusError } from '../src/core/errors.js'
import type { Logger } from '../src/core/log.js'
import { runBotGuard } from '../src/platforms/youtube/web/botguard.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { fetchInterpreter } from '../src/platforms/youtube/web/publish.js'
import { YtClient } from '../src/platforms/youtube/web/client.js'
import type { HandlerContext } from '../src/core/registry.js'
import { browser, chromeProxyArg, findChrome } from '../src/platforms/youtube/web/browser.js'

const openBrowser = (o: Parameters<typeof browser.open>[0]) => browser.open(o)

// 浏览器相关的两组测试：BotGuard 脚本能否在独立的全局环境里运行；openBrowser 的失败路径是否都会清理临时目录。
// 只在非 Windows 上跑假的可执行脚本（需要 /bin/sh）。

const quietLog: Logger = { debug: () => {}, info: () => {}, warn: () => {} }

describe('runBotGuard 能在独立的全局环境里运行', () => {
  it('node:vm 的沙箱里执行 runBotGuard.toString()：参数原样传给 vm.a，snapshot 收到 binding，返回 webResponse', async () => {
    // 假的 BotGuard 全局对象：vm.a 收到 program 与 setup 回调，返回一个 snapshot 函数；snapshot 收到 binding 后回调 webResponse
    const calls: { program?: string; binding?: unknown; interaction?: unknown; argc?: number } = {}
    const fake = {
      a(program: string, setup: (snap: (cb: (web: string) => void, args: unknown[]) => void) => void, _sync: boolean, interaction: unknown, _t: unknown, _x: unknown, _u: unknown, _f: unknown, loggers: unknown[]) {
        calls.program = program
        calls.interaction = interaction
        calls.argc = loggers.length
        setup((cb, args) => {
          calls.binding = args[0]
          cb(`WEB:${program}`)
        })
      },
    }
    const context = createContext({ trayride: fake, setTimeout, clearTimeout })
    // 把函数体放进沙箱执行，函数本身不依赖沙箱外的任何变量
    const source = `(${runBotGuard.toString()})`
    const fn = runInContext(source, context) as typeof runBotGuard
    const binding = { atr_challenge: 'CH1' }
    const web = await fn({ program: 'PROG' }, binding, 1000, 'trayride')
    expect(web).toBe('WEB:PROG')
    expect(calls.program).toBe('PROG')
    expect(calls.binding).toEqual(binding)
    expect(calls.interaction).toBeUndefined() // 沙箱里没有 document，交互元素传 undefined
    expect(calls.argc).toBe(5)
  })

  it('全局对象的名字：bg.globalName 优先，否则用 fallbackGlobal；没有时报错', async () => {
    const context = createContext({ other: { a: (_p: string, setup: any) => setup(() => {}) }, setTimeout })
    const fn = runInContext(`(${runBotGuard.toString()})`, context) as typeof runBotGuard
    await expect(fn({ program: 'P', globalName: 'missing' }, {}, 100, 'other')).rejects.toThrow(/global missing not defined/)
    await expect(fn({ program: 'P' }, {}, 100, 'other')).rejects.toThrow(/global other not defined|timeout|is not a function/)
  })

  it('页面里有 document 时，交互元素取 document.body', async () => {
    let seen: unknown
    const body = { tag: 'BODY' }
    const context = createContext({
      document: { body },
      trayride: { a: (_p: string, setup: any, _s: boolean, interaction: unknown) => (seen = interaction, setup(() => {})) },
      setTimeout,
    })
    const fn = runInContext(`(${runBotGuard.toString()})`, context) as typeof runBotGuard
    // setup 不回调 snapshot，所以会超时；只关心 interaction 是否取到 body
    await expect(fn({ program: 'P' }, {}, 50, 'trayride')).rejects.toThrow(/timeout/)
    expect(seen).toBe(body)
  })
})

describe('openBrowser 的失败路径：临时目录都会被清理', () => {
  let root: string
  let savedPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'catbus-openbrowser-test-'))
    savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  })
  afterEach(() => {
    if (savedPlatform) Object.defineProperty(process, 'platform', savedPlatform)
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  /** 在 root 下写一个假的可执行脚本，返回路径。 */
  function fakeChrome(name: string, body: string, mode = 0o755): string {
    const p = join(root, name)
    writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode })
    return p
  }

  const profileDirs = () => readdirSync(root).filter((d) => d.startsWith('catbus-chromium-'))

  const base = (executable: string, extra: Partial<Parameters<typeof openBrowser>[0]> = {}) => ({
    executable,
    url: 'https://studio.youtube.com/',
    proxy: null,
    ua: 'UA',
    cookies: [],
    log: quietLog,
    tmpRoot: root,
    launchTimeoutMs: 1500,
    ...extra,
  })

  it.skipIf(process.platform === 'win32')('不可执行的文件：报 ERROR，临时目录被删除', async () => {
    const notExec = fakeChrome('not-exec', 'exit 0', 0o644)
    const err = await openBrowser(base(notExec)).catch((e) => e)
    expect(err).toBeInstanceOf(CatbusError)
    expect(err).toMatchObject({ code: 'ERROR' })
    expect(err.message).toMatch(/无法执行浏览器/)
    expect(profileDirs()).toHaveLength(0)
  })

  it.skipIf(process.platform === 'win32')('启动后立刻退出：报 ERROR，带退出码，临时目录被删除', async () => {
    const dies = fakeChrome('dies', 'echo "boom" 1>&2\nexit 3')
    // launchTimeoutMs 设成 10 秒：如果等的是超时，耗时会接近 10 秒；退出后立即失败时远小于它
    const started = Date.now()
    const err = await openBrowser(base(dies, { launchTimeoutMs: 10_000 })).catch((e) => e)
    expect(Date.now() - started).toBeLessThan(8_000)
    expect(err).toMatchObject({ code: 'ERROR' })
    expect(err.message).toMatch(/浏览器退出了（退出码 3）/)
    expect(err.hint).toContain('boom')
    expect(profileDirs()).toHaveLength(0)
  })

  it.skipIf(process.platform === 'win32')('启动后不响应（超时）：报 ERROR，子进程被结束，临时目录被删除', async () => {
    // 进程一直活着，但从不回复 CDP 消息：Browser.getVersion 会超时
    const hangs = fakeChrome('hangs', 'sleep 30')
    const started = Date.now()
    const err = await openBrowser(base(hangs, { launchTimeoutMs: 300 })).catch((e) => e)
    expect(err).toMatchObject({ code: 'ERROR' })
    expect(err.message).toMatch(/没有在 .* 秒内完成启动/)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(profileDirs()).toHaveLength(0)
  })

  it('--proxy-server：没有代理时 direct://；带账号密码的代理报 USAGE', () => {
    expect(chromeProxyArg(null)).toBe('direct://')
    expect(chromeProxyArg('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(chromeProxyArg('socks5h://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
    expect(() => chromeProxyArg('http://user:pass@127.0.0.1:7890')).toThrow(expect.objectContaining({ code: 'USAGE' }))
  })

})

describe('interpreter 下载：白名单与重定向', () => {
  const restores: (() => void)[] = []
  afterEach(() => {
    while (restores.length) restores.pop()!()
  })

  /** 用一个假的 YtClient：只需要 bare 客户端与 check、ua。 */
  function clientWith(respond: (url: string) => ReturnType<typeof fakeResponse>) {
    const seen: string[] = []
    restores.push(
      mockSender((p) => {
        seen.push(p.url)
        return respond(p.url) as never
      }),
    )
    // YtClient 只用到 credential（cookie 罐）、config、log
    const ctx = {
      credential: { scopes: {}, device: {} },
      config: { proxy: null, timeout: 5 },
      log: quietLog,
    } as unknown as HandlerContext
    const c = new YtClient(ctx)
    return { c, seen }
  }

  it('允许 https://www.google.com 的 interpreter，返回脚本正文', async () => {
    const { c, seen } = clientWith(() => fakeResponse('/* js */', { status: 200, url: 'https://www.google.com/js/th/x.js' }))
    await expect(fetchInterpreter(c, 'https://www.google.com/js/th/x.js')).resolves.toBe('/* js */')
    expect(seen).toEqual(['https://www.google.com/js/th/x.js'])
  })

  it('非 https 协议、非白名单主机一律拒绝，不发出请求', async () => {
    const { c, seen } = clientWith(() => fakeResponse('x', { status: 200 }))
    await expect(fetchInterpreter(c, 'http://www.google.com/js/th/x.js')).rejects.toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('白名单') })
    await expect(fetchInterpreter(c, 'https://evil.example.com/x.js')).rejects.toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('白名单') })
    await expect(fetchInterpreter(c, 'https://www.google.com.evil.example/x.js')).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(seen).toHaveLength(0)
  })

  it('地址不合法时报 UPSTREAM', async () => {
    const { c } = clientWith(() => fakeResponse('x', { status: 200 }))
    await expect(fetchInterpreter(c, 'not a url')).rejects.toMatchObject({ code: 'UPSTREAM' })
  })

  it('返回跳转时不跟随，报 UPSTREAM 并给出 Location', async () => {
    const { c, seen } = clientWith(() => fakeResponse('', { status: 302, headers: [['location', 'https://evil.example.com/x.js']] }))
    const err = await fetchInterpreter(c, 'https://www.google.com/js/th/x.js').catch((e) => e)
    expect(err).toMatchObject({ code: 'UPSTREAM' })
    expect(err.message).toContain('https://evil.example.com/x.js')
    expect(seen).toHaveLength(1)
  })

  it('最终地址不在白名单时拒绝', async () => {
    const { c } = clientWith(() => fakeResponse('x', { status: 200, url: 'https://evil.example.com/x.js' }))
    await expect(fetchInterpreter(c, 'https://www.google.com/js/th/x.js')).rejects.toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('最终地址') })
  })
})

describe('findChrome：路径校验', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'catbus-findchrome-test-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'win32')('配置的路径必须是绝对路径', () => {
    const exe = join(root, 'chrome')
    writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    expect(() => findChrome({ configured: 'relative/chrome', platform: 'linux', home: root, env: {} })).toThrow(/必须是绝对路径/)
    expect(() => findChrome({ platform: 'linux', home: root, env: { CATBUS_YOUTUBE_BROWSER: 'chrome' } })).toThrow(/必须是绝对路径/)
  })

  it.skipIf(process.platform === 'win32')('存在但没有执行权限的文件：报 ERROR（X_OK 检查）', () => {
    const exe = join(root, 'not-exec')
    writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    expect(() => findChrome({ configured: exe, platform: 'linux', home: root, env: {} })).toThrow(/不存在或不能执行/)
  })

  it.skipIf(process.platform === 'win32')('环境变量给的路径同样校验绝对路径与执行权限', () => {
    const exe = join(root, 'env-not-exec')
    writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o644 })
    expect(() => findChrome({ platform: 'linux', home: root, env: { CATBUS_YOUTUBE_BROWSER: exe } })).toThrow(/CATBUS_YOUTUBE_BROWSER 指向的文件不存在或不能执行/)
  })
})
