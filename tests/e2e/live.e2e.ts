import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, describe, expect, test } from 'vitest'
import { type Command, sortCommands } from '../../src/core/registry.js'
import { PLATFORMS } from '../../src/platforms/index.js'
import { cli } from '../helpers.js'
import { buildArgv, createPool, harvest, type Obj } from './pool.js'
import { shapeOf } from './shapes.js'

/**
 * 在线测试（AGENTS 7.5）：用本机 ~/.catbus 里的登录态，跑每个平台已实现的只读命令。
 * 前面命令返回的对象作为后面命令的参数：先 search / list 拿到 item、用户、直播间、会话，再 get 它们、列评论……
 */

/** 只读的 action。写操作、下载（item download）、长连接（listen）不跑。 */
const READ_ACTIONS = new Set([
  'status', 'get', 'search', 'related', 'list', 'media', 'categories', 'items', 'likes', 'collects', 'reposts',
  'followers', 'following', 'replies', 'history', 'rank', 'gifts', 'products', 'replays', 'suggest', 'hot', 'count',
  'subtitles',
])
const SKIP = new Set(['auth login', 'auth use', 'auth logout'])

/** 这些命令在真实平台上不该返回空列表。 */
const NON_EMPTY = new Set(['item search', 'user search', 'feed list', 'keyword hot', 'keyword suggest', 'live list', 'live search'])
/** 取决于账号关注了谁的列表：可以为空。 */
const MAY_BE_EMPTY = new Set(['tiktok live list'])

/** 命令之间的间隔（毫秒）。小红书对连续请求更敏感：1.5 秒间隔下评论接口触发过 461。 */
const INTERVAL: Record<string, number> = { xhs: 4000 }
const DEFAULT_INTERVAL = 1500

/** 执行顺序：auth status → 不依赖别的对象的命令 → 依赖 item / 用户 / 直播间等的命令 → 依赖评论的命令。 */
function phase(cmd: Command): number {
  if (cmd.key === 'auth status') return 0
  const names = cmd.args.filter((a) => !a.optional).map((a) => a.name)
  if (names.includes('comment')) return 3
  if (names.some((n) => n !== 'keyword' && n !== 'prefix')) return 2
  return 1
}

/** 在所有元素里都没取到值（null 或 []）的字段，用来发现归一化漏取的字段。 */
function alwaysEmpty(data: unknown): string[] {
  const list = (Array.isArray(data) ? data : [data]).filter((x): x is Obj => x != null && typeof x === 'object')
  if (!list.length) return []
  const paths = new Map<string, boolean>()
  const walk = (o: Obj, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const path = prefix + k
      const empty = v == null || (Array.isArray(v) && !v.length)
      paths.set(path, (paths.get(path) ?? true) && empty)
      if (!empty && typeof v === 'object' && !Array.isArray(v)) walk(v, path + '.')
    }
  }
  for (const o of list) walk(o, '')
  // 父对象本身为空时只报父对象，不再列出它的子字段
  const empties = [...paths].filter(([, empty]) => empty).map(([path]) => path)
  return empties.filter((path) => !empties.some((parent) => path.startsWith(parent + '.')))
}

interface Entry {
  command: string
  argv: string[]
  code: number
  error: unknown
  count: number | null
  empty_fields: string[]
  page: unknown
  data: unknown
}

const reports = new Map<string, Entry[]>()

afterAll(() => {
  mkdirSync('.e2e', { recursive: true })
  for (const [p, entries] of reports) if (entries.length) writeFileSync(`.e2e/${p}.json`, JSON.stringify(entries, null, 2))
})

for (const platform of PLATFORMS) {
  const web = platform.endpoints.web
  if (web === 'planned') continue
  const p = platform.id
  if (p === '12306') continue // 12306 为免登录铁路平台，在专门的 12306.e2e.ts 中按铁路业务链路测试
  const commands = sortCommands(web.commands.values())
    .filter((c) => c.status === 'implemented' && !c.stream && !SKIP.has(c.key) && READ_ACTIONS.has(c.action))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => phase(a.c) - phase(b.c) || a.i - b.i)
    .map((x) => x.c)

  describe(p, () => {
    const pool = createPool()
    const entries: Entry[] = []
    reports.set(p, entries)
    let loggedIn = true

    for (const cmd of commands) {
      test(cmd.key, async (ctx) => {
        if (!loggedIn) ctx.skip(`没有登录 ${p}`)
        const argv = buildArgv(p, cmd, pool)
        if (!Array.isArray(argv)) ctx.skip(`前面的命令没有拿到 ${argv.missing}`)
        await sleep(INTERVAL[p] ?? DEFAULT_INTERVAL)
        const r = await cli(p, cmd.resource, cmd.action, ...(argv as string[]), '-q')
        const env = r.env
        expect(env, r.stdout + r.stderr).toBeTruthy()
        const data = env.data
        entries.push({
          command: cmd.key,
          argv: argv as string[],
          code: r.code,
          error: env.error,
          count: Array.isArray(data) ? data.length : null,
          empty_fields: env.ok ? alwaysEmpty(data) : [],
          page: env.page,
          data: Array.isArray(data) ? data.slice(0, 3) : data,
        })

        if (cmd.key === 'auth status') {
          expect(env.ok, JSON.stringify(env.error)).toBe(true)
          if (!data.logged_in) {
            loggedIn = false
            ctx.skip(`没有登录 ${p}`)
          }
        }
        // 主站登录已由 auth status 确认；这里的 AUTH_REQUIRED 是子站点（--scope）没登录，跳过
        if (env.error?.code === 'AUTH_REQUIRED') ctx.skip(env.error.message)
        // 风控（验证码、限流）取决于账号和近期请求，不是代码问题；原始结果已记进报告
        if (env.error?.code === 'RISK_CONTROL') ctx.skip(`平台风控：${env.error.message}`)
        // 默认参数落在注册表 note 里写明「规划中」的取值上（例如快手的 feed list --kind recommend）
        if (env.error?.code === 'NOT_IMPLEMENTED') ctx.skip(env.error.message)
        // 注册表 note 里写明的限制（例如 jd 的 user get 只支持 me），传入的参数不在支持范围
        if (env.error?.code === 'UNSUPPORTED' && cmd.note) ctx.skip(`${env.error.message}（${cmd.note}）`)

        expect(env.ok, `${JSON.stringify(env.error)}`).toBe(true)
        expect(env.platform).toBe(p)
        expect(env.account, '信封的 account 应为账号名').toBeTypeOf('string')
        const parsed = shapeOf(cmd.output).safeParse(data)
        expect(parsed.success, parsed.error ? JSON.stringify(parsed.error.issues.slice(0, 5)) : '').toBe(true)
        if (cmd.paged) {
          expect(env.page).toMatchObject({ has_more: expect.any(Boolean) })
        } else {
          expect(env.page).toBeNull()
        }
        if (NON_EMPTY.has(cmd.key) && !MAY_BE_EMPTY.has(`${p} ${cmd.key}`)) expect(data.length, '真实平台上不该是空列表').toBeGreaterThan(0)
        harvest(pool, cmd, argv as string[], data)
      })
    }
  })
}
