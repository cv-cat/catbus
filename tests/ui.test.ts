import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeOption, flagName } from '../src/core/options.js'
import { ENDPOINTS } from '../src/core/registry.js'
import { PLATFORMS } from '../src/platforms/index.js'
import { panelMeta } from '../src/ui/meta.js'
import { type Panel, startPanel } from '../src/ui/server.js'
import { displayCommand, toArgv } from '../src/ui/shared/request.js'
import type { JobEvent, JobSummary, RunRequest } from '../src/ui/shared/types.js'
import { checkCreateJob, RequestError } from '../src/ui/validate.js'
import { useTempHome } from './helpers.js'

/** Web 面板（AGENTS 4.13）：请求 → argv、请求校验、注册表元数据、本机服务的安全与任务。 */

useTempHome()

/**
 * 一条请求，未给出的字段取默认值。
 */
function request(partial: Partial<RunRequest>): RunRequest {
  return { platform: 'bilibili', endpoint: 'web', resource: 'item', action: 'search', args: [], options: {}, account: null, raw: false, verbose: false, proxy: null, yes: false, ...partial }
}

describe('请求 → argv', () => {
  it('参数、选项、全局选项按顺序拼出', () => {
    const argv = toArgv(request({ args: ['猫'], options: { sort: 'latest', limit: 20, all: true, tag: ['a', 'b'] }, account: 'work', endpoint: 'app', raw: true, yes: true }))
    expect(argv).toEqual(['bilibili', 'item', 'search', '猫', '--sort', 'latest', '--limit', '20', '--all', '--tag', 'a', '--tag', 'b', '-a', 'work', '-e', 'app', '--raw', '-y'])
  })

  it('false 的开关不出现；以 - 开头的值写成 --flag=value，参数放到 -- 之后', () => {
    expect(toArgv(request({ args: ['-1'], options: { all: false, text: '-hi' } }))).toEqual(['bilibili', 'item', 'search', '--text=-hi', '--', '-1'])
  })

  it('全局命令没有 action 时只有 resource', () => {
    expect(toArgv(request({ platform: null, resource: 'doctor', action: null }))).toEqual(['doctor'])
  })

  it('等价命令按 shell 规则加引号', () => {
    expect(displayCommand(request({ args: ["it's 猫"] }))).toBe(`catbus bilibili item search 'it'\\''s 猫'`)
  })
})

describe('请求校验', () => {
  const body = (r: Partial<RunRequest>, extra: Record<string, unknown> = {}) => ({ request: request(r), stdin: null, ...extra })

  it('合法的平台命令', () => {
    const resolved = checkCreateJob(body({ args: ['猫'], options: { sort: 'latest', limit: 5 } }))
    expect(resolved.command?.key).toBe('item search')
    expect(resolved.track).toBe(true)
  })

  it('不能借选项名塞进全局选项（-y、-o）或未声明的选项', () => {
    expect(() => checkCreateJob(body({ resource: 'comment', action: 'delete', args: ['a', 'b'], options: { yes: true } }))).toThrow(RequestError)
    expect(() => checkCreateJob(body({ options: { output: 'jsonl' } }))).toThrow(RequestError)
  })

  it('选项值的类型必须与注册表一致', () => {
    expect(() => checkCreateJob(body({ options: { limit: '5' } }))).toThrow(/类型/)
    expect(() => checkCreateJob(body({ options: { all: 'yes' } }))).toThrow(/类型/)
  })

  it('Cookie 只能通过 stdin 提交，不能保存在命令参数或任务记录里', () => {
    const login = { resource: 'auth', action: 'login', options: { cookie: 'session=synthetic-secret' } }
    expect(() => checkCreateJob(body(login))).toThrow(/登录信息/)
    const resolved = checkCreateJob(body({ ...login, options: { cookie: '-' } }, { stdin: 'session=synthetic-secret' }))
    expect(resolved.stdin).toBe('session=synthetic-secret')
    expect(JSON.stringify(resolved.request)).not.toContain('synthetic-secret')
  })

  it('未知平台、未知命令、参数过多、账号名不合法', () => {
    expect(() => checkCreateJob(body({ platform: 'nope' }))).toThrow(/未知的平台/)
    expect(() => checkCreateJob(body({ platform: 'bili' }))).toThrow(/未知的平台/)
    expect(() => checkCreateJob(body({ action: 'nope' }))).toThrow(/没有命令/)
    expect(() => checkCreateJob(body({ args: ['a', 'b'] }))).toThrow(/参数/)
    expect(() => checkCreateJob(body({ account: '../x' }))).toThrow(RequestError)
  })

  it('全局命令只允许面板用到的几个，ui 自己不行', () => {
    expect(checkCreateJob(body({ platform: null, resource: 'auth', action: 'list' })).command).toBeNull()
    expect(() => checkCreateJob(body({ platform: null, resource: 'ui', action: null }))).toThrow(/不支持/)
    expect(() => checkCreateJob(body({ platform: null, resource: 'config', action: 'set', args: ['a', 'b', 'c'] }))).toThrow(/参数过多/)
  })

  it('planned 的端交给 CLI 报 NOT_IMPLEMENTED，但不接受选项', () => {
    expect(checkCreateJob(body({ endpoint: 'app' })).command).toBeNull()
    expect(() => checkCreateJob(body({ endpoint: 'app', options: { sort: 'latest' } }))).toThrow(/不接受选项/)
  })
})

describe('注册表元数据', () => {
  const meta = panelMeta('/tmp')

  it('平台、端、命令与注册表一一对应，选项名用 kebab-case', () => {
    expect(meta.platforms.map((p) => p.id)).toEqual(PLATFORMS.map((p) => p.id))
    for (const platform of PLATFORMS) {
      const m = meta.platforms.find((p) => p.id === platform.id)!
      expect(m.defaultEndpoint).toBe(platform.defaultEndpoint)
      for (const endpoint of ENDPOINTS) {
        const ep = platform.endpoints[endpoint]
        const mep = m.endpoints[endpoint]
        if (ep === 'planned') {
          expect(mep.status).toBe('planned')
          continue
        }
        expect(mep.status).toBe('available')
        if (mep.status !== 'available') continue
        expect(mep.commands.map((c) => `${c.resource} ${c.action}`).sort()).toEqual([...ep.commands.keys()].sort())
        for (const c of mep.commands) {
          const command = ep.commands.get(`${c.resource} ${c.action}`)!
          expect(c.options.map((o) => o.flag).sort()).toEqual(Object.keys(command.options).map(flagName).sort())
          for (const o of c.options) {
            const key = Object.keys(command.options).find((k) => flagName(k) === o.flag)!
            expect(o.kind).toBe(describeOption(command.options[key]!).kind)
          }
        }
      }
    }
  })

  it('Discord 默认端为 macOS 桌面端', () => {
    expect(meta.platforms.find((p) => p.id === 'discord')).toMatchObject({
      defaultEndpoint: 'pc',
      endpoints: { web: { status: 'planned' }, pc: { status: 'available', label: 'macOS 桌面端' } },
    })
  })

  it('危险操作的确认方式来自注册表', () => {
    const bili = meta.platforms.find((p) => p.id === 'bilibili')!.endpoints.web
    if (bili.status !== 'available') throw new Error('bilibili web 应可用')
    const kind = (key: string) => bili.commands.find((c) => `${c.resource} ${c.action}` === key)!.confirm
    expect(kind('comment delete')).toBe('always')
    expect(kind('live send')).toBe('conditional')
    expect(kind('item search')).toBe('never')
  })
})

describe('面板服务', () => {
  let dir: string
  let panel: Panel
  let origin: string
  let csrf: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'catbus-ui-test-'))
    // 假的 CLI：把收到的 argv 和 stdin 放进信封；带 live listen 时按长连接输出
    const cli = join(dir, 'fake-cli.mjs')
    writeFileSync(
      cli,
      `const argv = process.argv.slice(2)
let stdin = ''
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', () => {
  const env = (data) => JSON.stringify({ ok: true, platform: null, endpoint: null, resource: null, action: null, account: null, data, page: null, error: null })
  const silent = argv.includes('silent')
  if (!silent) process.stderr.write('[catbus] 进度\\n')
  if (argv.includes('listen')) {
    if (!silent) process.stdout.write(JSON.stringify({ type: 'chat', text: 'hi' }) + '\\n')
    process.on('SIGINT', () => { process.stderr.write(env(null) + '\\n'); process.exit(0) })
    setInterval(() => {}, 1000)
    return
  }
  process.stdout.write(env({ argv, stdin }) + '\\n')
})
`,
    )
    panel = await startPanel({ root: join(import.meta.dirname, '..', 'src', 'ui'), cliEntry: cli, cwd: dir })
    origin = new URL(panel.url).origin
    const html = await (await fetch(panel.url)).text()
    csrf = /name="catbus-csrf" content="([a-f0-9]+)"/.exec(html)![1]!
  })

  afterAll(async () => {
    await panel.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(panel.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Catbus-CSRF': csrf, ...headers } })

  /**
   * 读完任务的事件流。
   */
  async function events(id: string): Promise<JobEvent[]> {
    const text = await (await fetch(`${panel.url}api/jobs/${id}/events`)).text()
    return text.trim().split('\n').map((l) => JSON.parse(l) as JobEvent)
  }

  it('只监听 127.0.0.1，地址带随机路径；不在随机路径下的一律 404', async () => {
    expect(new URL(panel.url).hostname).toBe('127.0.0.1')
    expect(new URL(panel.url).pathname.length).toBeGreaterThan(40)
    expect((await fetch(`${origin}/api/meta`)).status).toBe(404)
    expect((await fetch(`${panel.url}api/meta`)).status).toBe(200)
  })

  it('页面带安全响应头；静态文件不能跳出目录', async () => {
    const res = await fetch(panel.url)
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect((await fetch(`${panel.url}app/style.css`)).status).toBe(200)
    expect((await fetch(`${panel.url}app/%2e%2e/server.ts`)).status).toBe(404)
    expect((await fetch(`${panel.url}server.ts`)).status).toBe(404)
  })

  it('写请求要同源并带令牌', async () => {
    const body = { request: request({ args: ['猫'] }), stdin: null }
    expect((await post('api/jobs', body, { 'X-Catbus-CSRF': 'x' })).status).toBe(403)
    expect((await post('api/jobs', body, { Origin: 'http://evil.example' })).status).toBe(403)
    expect((await post('api/jobs', { request: request({ options: { yes: true } }), stdin: null })).status).toBe(400)
  })

  it('任务：子进程收到等价的 argv 和 stdin，stdin 不进任务记录和等价命令', async () => {
    const res = await post('api/jobs', { request: request({ args: ['猫'], options: { limit: 3 } }), stdin: 'secret-cookie' })
    expect(res.status).toBe(201)
    const job = (await res.json()) as JobSummary
    expect(job.command).toBe("catbus bilibili item search '猫' --limit 3")
    expect(JSON.stringify(job)).not.toContain('secret-cookie')
    const list = await events(job.id)
    expect(list.some((e) => e.type === 'log' && e.text === '[catbus] 进度')).toBe(true)
    const end = list.at(-1)!
    expect(end.type).toBe('end')
    if (end.type !== 'end') return
    expect(end.state).toBe('succeeded')
    const data = JSON.parse(end.envelope!).data as { argv: string[]; stdin: string }
    expect(data.argv).toEqual(['bilibili', 'item', 'search', '猫', '--limit', '3', '-o', 'json'])
    expect(data.stdin).toBe('secret-cookie')
    expect(((await (await fetch(`${panel.url}api/jobs`)).json()) as JobSummary[]).map((j) => j.id)).toContain(job.id)
  })

  it('Discord 面板命令只在请求 pc 默认端时省略 -e', async () => {
    for (const [endpoint, flags] of [['pc', []], ['web', ['-e', 'web']]] as const) {
      const body = { request: request({ platform: 'discord', endpoint, resource: 'user', action: 'get' }), stdin: null }
      const res = await post('api/jobs', body)
      expect(res.status).toBe(201)
      const job = (await res.json()) as JobSummary
      const words = ['discord', 'user', 'get', ...flags]
      expect(job.command).toBe(['catbus', ...words].join(' '))
      const end = (await events(job.id)).at(-1)
      expect(end?.type).toBe('end')
      if (end?.type === 'end') expect(JSON.parse(end.envelope!).data.argv).toEqual([...words, '-o', 'json'])
    }
  })

  it('普通命令开始后不能停止；长连接可以停止，条目逐行推送', async () => {
    const plain = (await (await post('api/jobs', { request: request({ args: ['猫'] }), stdin: null })).json()) as JobSummary
    expect(plain.stoppable).toBe(false)
    expect((await post(`api/jobs/${plain.id}/stop`, {})).status).toBe(409)

    const live = (await (await post('api/jobs', { request: request({ resource: 'live', action: 'listen', args: ['1'] }), stdin: null })).json()) as JobSummary
    expect(live.stoppable).toBe(true)
    const response = await fetch(`${panel.url}api/jobs/${live.id}/events`, { signal: AbortSignal.timeout(5000) })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const list: JobEvent[] = []
    let rest = ''
    const read = async () => {
      const { value, done } = await reader.read()
      if (done) return false
      const lines = (rest + decoder.decode(value, { stream: true })).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line) list.push(JSON.parse(line) as JobEvent)
      return true
    }
    try {
      while (!list.some((e) => e.type === 'item') || !list.some((e) => e.type === 'log' && e.text === '[catbus] 进度')) expect(await read()).toBe(true)
      // 在停止之前就必须收到日志和实时内容，而不是读完整个响应后才检查。
      expect(list).toContainEqual({ type: 'log', text: '实时接收任务已启动，正在建立连接。' })
      expect(list).toContainEqual({ type: 'log', text: '[catbus] 进度' })
      expect(list.some((e) => e.type === 'end')).toBe(false)
      expect((await (await fetch(`${panel.url}api/jobs/${live.id}`)).json()).state).toBe('running')
      expect((await post(`api/jobs/${live.id}/stop`, {})).status).toBe(200)
      while (await read()) {}
      expect(list.find((e) => e.type === 'item')).toEqual({ type: 'item', text: '{"type":"chat","text":"hi"}' })
      expect(list.at(-2)).toEqual({ type: 'log', text: '任务已停止。' })
      expect(list.at(-1)).toMatchObject({ type: 'end', state: 'stopped' })
    } finally {
      await post(`api/jobs/${live.id}/stop`, {})
      await reader.cancel()
    }
  })

  it('没有任何输出时也立即建立事件订阅，不等到任务结束才返回响应头', async () => {
    const live = (await (await post('api/jobs', { request: request({ resource: 'live', action: 'listen', args: ['silent'] }), stdin: null, track: false })).json()) as JobSummary
    try {
      const response = await fetch(`${panel.url}api/jobs/${live.id}/events`, { signal: AbortSignal.timeout(2000) })
      expect(response.status).toBe(200)
      expect((await (await fetch(`${panel.url}api/jobs/${live.id}`)).json()).state).toBe('running')
      await post(`api/jobs/${live.id}/stop`, {})
      expect(await response.text()).toContain('"type":"end"')
    } finally {
      await post(`api/jobs/${live.id}/stop`, {})
    }
  })

  it('内部查询（track: false）不出现在任务列表里', async () => {
    const job = (await (await post('api/jobs', { request: request({ platform: null, resource: 'auth', action: 'list' }), stdin: null, track: false })).json()) as JobSummary
    await events(job.id)
    const ids = ((await (await fetch(`${panel.url}api/jobs`)).json()) as JobSummary[]).map((j) => j.id)
    expect(ids).not.toContain(job.id)
  })

  it('上传的文件存到临时目录，面板关闭时删除', async () => {
    const other = await startPanel({ root: join(import.meta.dirname, '..', 'src', 'ui'), cliEntry: join(dir, 'fake-cli.mjs'), cwd: dir })
    const html = await (await fetch(other.url)).text()
    const token = /content="([a-f0-9]+)"/.exec(html)![1]!
    const files = await Promise.all([1, 2, 3].map(async (index) => {
      const res = await fetch(`${other.url}api/uploads?name=${encodeURIComponent(`../封面 ${index}.png`)}`, {
        method: 'POST', body: 'png-bytes',
        headers: { 'Content-Type': 'application/octet-stream', Origin: new URL(other.url).origin, 'X-Catbus-CSRF': token },
      })
      expect(res.status).toBe(201)
      const file = (await res.json()) as { path: string; name: string; size: number }
      expect(file.name).toBe(`封面_${index}.png`)
      expect(file.size).toBe(9)
      expect(existsSync(file.path)).toBe(true)
      return file
    }))
    expect(new Set(files.map((file) => dirname(file.path))).size).toBe(1)
    await other.close()
    for (const file of files) expect(existsSync(file.path)).toBe(false)
  })
})
