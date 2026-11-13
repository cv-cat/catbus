import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHandlerContext, validate } from '../src/cli/dispatch.js'
import { newCredential } from '../src/core/auth-store.js'
import { CatbusError } from '../src/core/errors.js'
import type { ExportDoc } from '../src/core/export.js'
import { downloadMedia } from '../src/core/files.js'
import { fakeResponse, mockSender, type PreparedRequest } from '../src/core/http.js'
import { createLogger, type Logger } from '../src/core/log.js'
import * as n from '../src/core/normalize.js'
import { type AvailableEndpoint, type CommandDecl, definePlatform, type Handler, type HandlerContext } from '../src/core/registry.js'
import type { File } from '../src/core/schemas.js'
import { httpClient, paged } from '../src/core/toolkit.js'
import { cli, useTempHome } from './helpers.js'

// item download 的 --meta / --comments / --replies / --no-media（AGENTS 4.9「下载」）。
// 用一个假平台：item get / comment list / comment replies 都向假地址发请求，由 mockSender 回放，
// 检查 core 通过注册表在进程内调用这些 handler、自动翻页、风控截断和缺命令时的处理。

const BASE = 'https://fake.example'
const COMMENTS = 7 // 一级评论总数，每页 2 条
const REPLIES = 5 // 每条一级评论的回复总数，每页 2 条

const handlers: Record<string, Handler> = {
  async itemGet(ctx) {
    const res = await httpClient(ctx).request({ url: `${BASE}/item?id=${ctx.args.item}` })
    const d = (await res.json()) as any
    return n.item({ id: d.id, kind: 'image', title: d.title, text: d.text, author: n.userRef({ id: 'u1', name: '作者' }), stats: { likes: d.likes } as any }, d)
  },
  async itemDownload(ctx) {
    const media = [n.media({ type: 'image', url: `${BASE}/media/1.jpg` })]
    return downloadMedia(ctx, httpClient(ctx), String(ctx.args.item), media, { title: '标题' })
  },
  async commentList(ctx) {
    const res = await httpClient(ctx).request({ url: `${BASE}/comments?item=${ctx.args.item}&cursor=${ctx.cursor ?? 0}` })
    const d = (await res.json()) as any
    if (d.risk) throw new CatbusError('RISK_CONTROL', '需要验证', { detail: { kind: 'captcha' } })
    const data = d.list.map((c: any) => n.comment({ id: c.id, item_id: String(ctx.args.item), text: c.text, stats: { likes: 0, replies: c.replies } }, c))
    return paged(data, d.next, d.more)
  },
  async commentReplies(ctx) {
    const res = await httpClient(ctx).request({ url: `${BASE}/replies?comment=${ctx.args.comment}&cursor=${ctx.cursor ?? 0}` })
    const d = (await res.json()) as any
    if (d.risk) throw new CatbusError('RISK_CONTROL', '需要验证', { detail: { kind: 'captcha' } })
    const data = d.list.map((c: any) => n.comment({ id: c.id, item_id: String(ctx.args.item), parent_id: String(ctx.args.comment), text: c.text }, c))
    return paged(data, d.next, d.more)
  },
}

const impl = (name: string): CommandDecl => ({ upstream: 'full', handler: async () => handlers[name]! })

function fakePlatform(commands: { list?: boolean; replies?: boolean } = {}) {
  return definePlatform({
    id: 'fake',
    name: '假平台',
    aliases: [],
    item: '帖子',
    pageInterval: 0,
    endpoints: {
      web: {
        login: { methods: ['cookie'], default: 'cookie' },
        commands: {
          'item get': impl('itemGet'),
          'item download': impl('itemDownload'),
          ...(commands.list === false ? {} : { 'comment list': impl('commentList') }),
          ...(commands.replies === false ? {} : { 'comment replies': impl('commentReplies') }),
        },
      },
      app: 'planned',
      pc: 'planned',
    },
  })
}

interface Server {
  requests: string[]
  /** 某个路径的第几页（cursor）回风控。 */
  risk?: { path: string; cursor: number; comment?: string }
}

function serve(server: Server): (p: PreparedRequest) => ReturnType<typeof fakeResponse> {
  return (p) => {
    const u = new URL(p.url)
    server.requests.push(`${u.pathname}${u.search}`)
    const cursor = Number(u.searchParams.get('cursor') ?? 0)
    const risky = server.risk && server.risk.path === u.pathname && server.risk.cursor === cursor && (server.risk.comment == null || server.risk.comment === u.searchParams.get('comment'))
    if (risky) return fakeResponse({ risk: true })
    const pageOf = (total: number, make: (i: number) => object) => {
      const list = Array.from({ length: Math.max(0, Math.min(2, total - cursor)) }, (_, k) => make(cursor + k + 1))
      const more = cursor + 2 < total
      return fakeResponse({ list, next: more ? cursor + 2 : null, more })
    }
    switch (u.pathname) {
      case '/item':
        return fakeResponse({ id: u.searchParams.get('id'), title: '标题', text: '正文', likes: 12 })
      case '/media/1.jpg':
        return fakeResponse(new Uint8Array([0xff, 0xd8, 0xff]))
      case '/comments':
        // c2 没有回复：平台给出的回复数为 0，不发请求
        return pageOf(COMMENTS, (i) => ({ id: `c${i}`, text: `评论 ${i}`, replies: i === 2 ? 0 : REPLIES }))
      case '/replies':
        return pageOf(REPLIES, (i) => ({ id: `${u.searchParams.get('comment')}-r${i}`, text: `回复 ${i}` }))
      default:
        return fakeResponse('not found', { status: 404 })
    }
  }
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

interface Run {
  files: File[]
  dir: string
  doc: ExportDoc | null
  requests: string[]
  warnings: string[]
}

async function download(given: Record<string, unknown>, opts: { platform?: ReturnType<typeof fakePlatform>; risk?: Server['risk'] } = {}): Promise<Run> {
  const platform = opts.platform ?? fakePlatform()
  const ep = platform.endpoints.web as AvailableEndpoint
  const command = ep.commands.get('item download')!
  const dir = mkdtempSync(join(tmpdir(), 'catbus-export-'))
  const { args, options } = validate(platform, command, ['n1'], { dir, ...given })
  const server: Server = { requests: [], risk: opts.risk }
  restore = mockSender(serve(server))
  const warnings: string[] = []
  const log = createLogger({ quiet: true })
  const spy: Logger = { ...log, warn: (msg: string) => void warnings.push(msg) }
  const credential = newCredential({ platform: 'fake', endpoint: 'web', account: 'default', method: 'cookie' })
  const ctx: HandlerContext = createHandlerContext({
    platform, endpoint: 'web', command, args, options, identity: { account: 'default', credential },
    network: { proxy: null, timeout: 30 }, log: spy, raw: false, signal: new AbortController().signal,
  })
  const handler = await command.handler!()
  const files = (await handler(ctx)) as File[]
  const data = files.find((f) => f.type === 'data')
  const doc = data ? (JSON.parse(readFileSync(data.path, 'utf8')) as ExportDoc) : null
  return { files, dir, doc, requests: server.requests, warnings }
}

describe('item download --meta / --comments / --replies / --no-media', () => {
  it('只给 --meta：媒体照常下载，旁边写 <platform>_<id>.json，只调 item get', async () => {
    const r = await download({ meta: true })
    expect(r.files.map((f) => [f.type, f.path.slice(r.dir.length + 1), f.url])).toEqual([
      ['image', 'fake_n1_1.jpg', `${BASE}/media/1.jpg`],
      ['data', 'fake_n1.json', null],
    ])
    expect(r.files[1]!.size).toBe(readFileSync(r.files[1]!.path).length)
    expect(r.requests).toEqual(['/media/1.jpg', '/item?id=n1'])
    expect(r.doc).toMatchObject({ schema: 1, platform: 'fake', comments: [], comments_truncated: false })
    expect(r.doc!.exported_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/)
    expect(r.doc!.item).toMatchObject({ id: 'n1', kind: 'image', title: '标题', text: '正文', author: { id: 'u1', name: '作者' }, stats: { likes: 12 } })
    // 原始对象不进 ExportDoc
    expect(Object.keys(r.doc!.item).sort()).toEqual(['author', 'cover', 'created_at', 'id', 'kind', 'media', 'price', 'stats', 'status', 'text', 'title', 'url'])
    // 缩进 2 个空格，权限 0600
    expect(readFileSync(r.files[1]!.path, 'utf8')).toMatch(/^\{\n {2}"schema": 1,/)
    if (process.platform !== 'win32') expect(statSync(r.files[1]!.path).mode & 0o777).toBe(0o600)
  })

  it('不给任何导出选项时和原来一样，只下载媒体', async () => {
    const r = await download({})
    expect(r.files.map((f) => f.type)).toEqual(['image'])
    expect(r.requests).toEqual(['/media/1.jpg'])
  })

  it('--comments 5 --replies 3：自动翻页取满，回复数为 0 的评论不发请求', async () => {
    const r = await download({ comments: '5', replies: '3' })
    const doc = r.doc!
    expect(doc.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(doc.comments.map((c) => c.replies.length)).toEqual([3, 0, 3, 3, 3])
    expect(doc.comments[0]!.replies.map((c) => c.id)).toEqual(['c1-r1', 'c1-r2', 'c1-r3'])
    expect(doc.comments[0]!.replies[0]).toMatchObject({ parent_id: 'c1', text: '回复 1', item_id: 'n1' })
    expect(doc.comments_truncated).toBe(false)
    // 一级评论翻 3 页（2 + 2 + 2 取前 5）；每条有回复的评论翻 2 页
    expect(r.requests.filter((u) => u.startsWith('/comments'))).toEqual(['/comments?item=n1&cursor=0', '/comments?item=n1&cursor=2', '/comments?item=n1&cursor=4'])
    expect(r.requests.filter((u) => u.startsWith('/replies?comment=c1'))).toEqual(['/replies?comment=c1&cursor=0', '/replies?comment=c1&cursor=2'])
    expect(r.requests.some((u) => u.startsWith('/replies?comment=c2'))).toBe(false)
    // --comments 隐含 --meta
    expect(r.files.map((f) => f.type)).toEqual(['image', 'data'])
  })

  it('--comments all：翻到没有更多为止；不给 --replies 时不取回复', async () => {
    const r = await download({ comments: 'all' })
    expect(r.doc!.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(r.doc!.comments.every((c) => Array.isArray(c.replies) && c.replies.length === 0)).toBe(true)
    expect(r.requests.some((u) => u.startsWith('/replies'))).toBe(false)
  })

  it('--replies all：每条评论的回复取全', async () => {
    const r = await download({ comments: '1', replies: 'all' })
    expect(r.doc!.comments[0]!.replies.map((c) => c.id)).toEqual(['c1-r1', 'c1-r2', 'c1-r3', 'c1-r4', 'c1-r5'])
  })

  it('取一级评论中途遇到 RISK_CONTROL：停下，已经取到的照样写出，命令成功', async () => {
    const r = await download({ comments: 'all', replies: '3' }, { risk: { path: '/comments', cursor: 4 } })
    expect(r.doc!.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(r.doc!.comments_truncated).toBe(true)
    // 截断后不再取回复
    expect(r.requests.some((u) => u.startsWith('/replies'))).toBe(false)
    expect(r.warnings.some((w) => w.includes('风控'))).toBe(true)
  })

  it('取回复中途遇到 RISK_CONTROL：这条评论已取到的回复保留，后面的评论不再取', async () => {
    const r = await download({ comments: '4', replies: 'all' }, { risk: { path: '/replies', cursor: 2, comment: 'c3' } })
    expect(r.doc!.comments.map((c) => c.replies.length)).toEqual([5, 0, 2, 0])
    expect(r.doc!.comments_truncated).toBe(true)
    expect(r.requests.some((u) => u.startsWith('/replies?comment=c4'))).toBe(false)
  })

  it('平台没有 comment list：comments 为 []，stderr 提示一行，不报错', async () => {
    const r = await download({ comments: '5' }, { platform: fakePlatform({ list: false, replies: false }) })
    expect(r.doc!.comments).toEqual([])
    expect(r.doc!.comments_truncated).toBe(false)
    expect(r.warnings).toEqual([expect.stringContaining('没有 comment list')])
    expect(r.requests).toEqual(['/media/1.jpg', '/item?id=n1'])
  })

  it('平台没有 comment replies：只取一级评论', async () => {
    const r = await download({ comments: '3', replies: '3' }, { platform: fakePlatform({ replies: false }) })
    expect(r.doc!.comments.map((c) => [c.id, c.replies.length])).toEqual([['c1', 0], ['c2', 0], ['c3', 0]])
    expect(r.warnings).toEqual([expect.stringContaining('没有 comment replies')])
  })

  it('--no-media：不下载媒体，只写 JSON（隐含 --meta）', async () => {
    const r = await download({ noMedia: true })
    expect(r.files.map((f) => [f.type, f.path.slice(r.dir.length + 1)])).toEqual([['data', 'fake_n1.json']])
    expect(r.requests).toEqual(['/item?id=n1'])
    expect(readdirSync(r.dir)).toEqual(['fake_n1.json'])
  })

  it('--no-media 沿用 --subdir 的目录规则', async () => {
    const r = await download({ noMedia: true, subdir: 'title' })
    expect(r.files[0]!.path).toBe(join(r.dir, '标题', 'fake_n1.json'))
  })

  it('JSON 已存在时默认跳过、不发请求；--overwrite 时重新导出', async () => {
    const first = await download({ noMedia: true })
    restore?.()
    const server: Server = { requests: [] }
    restore = mockSender(serve(server))
    const again = await download({ noMedia: true, dir: first.dir })
    expect(again.requests).toEqual([])
    expect(again.files[0]!.path).toBe(first.files[0]!.path)
    const forced = await download({ noMedia: true, dir: first.dir, overwrite: true })
    expect(forced.requests).toEqual(['/item?id=n1'])
  })

  it('单独给 --replies：提示一行并忽略', async () => {
    const r = await download({ meta: true, replies: '3' })
    expect(r.warnings).toEqual([expect.stringContaining('--replies 要和 --comments 一起用')])
    expect(r.requests.some((u) => u.startsWith('/comments') || u.startsWith('/replies'))).toBe(false)
  })
})

describe('item download 导出选项的校验', () => {
  useTempHome()

  it.each([['--comments', 'abc'], ['--comments', '0'], ['--comments', '-3'], ['--replies', '1.5'], ['--comments', 'ALL']])('%s %s 报 USAGE', async (flag, value) => {
    const r = await cli('xhs', 'item', 'download', 'n1', flag, value)
    expect(r.env.error.code).toBe('USAGE')
  })

  it('--dry-run 列出解析后的导出选项', async () => {
    const r = await cli('xhs', 'item', 'download', 'n1', '--comments', 'all', '--replies', '3', '--no-media', '--meta', '--dry-run', '-a', 'nobody')
    // 没有账号时 dry-run 也报 AUTH_REQUIRED（只看本地），说明选项本身通过了校验
    expect(r.env.error.code).toBe('AUTH_REQUIRED')
  })
})
