import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { run } from '../src/cli/dispatch.js'
import { fakeResponse, type HeaderPairs, type HttpResponse, mockSender, type PreparedRequest } from '../src/core/http.js'

/** 每个测试一个临时的 CATBUS_HOME。 */
export function useTempHome(): { readonly dir: string } {
  const state = { dir: '' }
  let previous: string | undefined
  beforeEach(() => {
    previous = process.env.CATBUS_HOME
    state.dir = mkdtempSync(join(tmpdir(), 'catbus-test-'))
    process.env.CATBUS_HOME = state.dir
  })
  afterEach(() => {
    if (previous === undefined) delete process.env.CATBUS_HOME
    else process.env.CATBUS_HOME = previous
    rmSync(state.dir, { recursive: true, force: true })
  })
  return state
}

export interface CliResult {
  code: number
  stdout: string
  stderr: string
  /** stdout 上的信封（json 格式）。 */
  env: any
}

/** 在进程内执行一次 catbus，捕获 stdout / stderr。 */
export async function cli(...argv: string[]): Promise<CliResult> {
  const out: string[] = []
  const err: string[] = []
  const o = vi.spyOn(process.stdout, 'write').mockImplementation((s) => (out.push(String(s)), true))
  const e = vi.spyOn(process.stderr, 'write').mockImplementation((s) => (err.push(String(s)), true))
  try {
    const code = await run(argv)
    const stdout = out.join('')
    let env: any = null
    try {
      env = JSON.parse(stdout)
    } catch {}
    return { code, stdout, stderr: err.join(''), env }
  } finally {
    o.mockRestore()
    e.mockRestore()
  }
}

// ---- 12306 的录制响应（tests/12306.test.ts 和 tests/tui.test.tsx 共用） ----

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures/12306', name), 'utf8')

export interface CallRecord {
  path: string
  url: string
  query: Record<string, string>
  headers: HeaderPairs
  cookies: [string, string][]
}

export function mockTrain(overrides: Record<string, (p: PreparedRequest, u: URL) => HttpResponse> = {}) {
  const routes: Record<string, (p: PreparedRequest, u: URL) => HttpResponse> = {
    '/otn/leftTicket/init': () =>
      fakeResponse(`<script>var ${fixture('init.html.txt')};</script>`, {
        headers: [
          ['content-type', 'text/html'],
          ['set-cookie', 'JSESSIONID=fake; Path=/otn'],
        ],
      }),
    '/otn/resources/js/framework/station_name.js': () =>
      fakeResponse(fixture('station_name.js'), { headers: [['content-type', 'application/javascript']] }),
    '/otn/leftTicket/queryG': () =>
      fakeResponse(fixture('left_ticket.json'), { headers: [['content-type', 'application/json']] }),
    '/otn/leftTicket/queryTicketPrice': () =>
      fakeResponse(fixture('price.json'), { headers: [['content-type', 'application/json']] }),
    '/otn/czxx/queryByTrainNo': () =>
      fakeResponse(fixture('route.json'), { headers: [['content-type', 'application/json']] }),
    '/lcquery/queryG': () =>
      fakeResponse(fixture('transfer.json'), { headers: [['content-type', 'application/json']] }),
    ...overrides,
  }
  const calls: CallRecord[] = []
  const restore = mockSender((p: PreparedRequest) => {
    const u = new URL(p.url)
    calls.push({
      path: u.pathname,
      url: p.url,
      query: Object.fromEntries(u.searchParams),
      headers: p.headers,
      cookies: p.cookies,
    })
    const route = routes[u.pathname]
    if (!route) throw new Error(`未录制的请求：${u.pathname}`)
    return route(p, u)
  })
  return { calls, restore }
}

