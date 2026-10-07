import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { collectOptionKinds } from '../src/cli/argv.js'
import { renderCapabilities } from '../src/core/capabilities.js'
import { definePlatform, type Platform, type PlatformDecl } from '../src/core/registry.js'
import { VOCAB } from '../src/core/vocab.js'
import { PLATFORMS } from '../src/platforms/index.js'

const GLOBAL_COMMANDS = ['platforms', 'doctor', 'auth', 'config', 'version']

function web(p: Platform) {
  const ep = p.endpoints.web
  if (ep === 'planned') throw new Error('planned')
  return ep
}

describe('注册表', () => {
  it('平台 id 与别名唯一，且不与全局命令重名', () => {
    const names = PLATFORMS.flatMap((p) => [p.id, ...p.aliases])
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(GLOBAL_COMMANDS).not.toContain(n)
  })

  it('所有平台 web 可用，app / pc 为 planned；除 12306 外 web 端不支持游客态且除 auth 外都需要登录', () => {
    for (const p of PLATFORMS) {
      if (p.id === '12306') {
        expect(web(p).guest).toBe(true)
        for (const c of web(p).commands.values()) expect([p.id, c.key, c.auth]).toEqual([p.id, c.key, 'optional'])
      } else {
        expect(web(p).guest).toBe(false)
        for (const c of web(p).commands.values()) if (c.resource !== 'auth') expect([p.id, c.key, c.auth]).toEqual([p.id, c.key, 'required'])
      }
      expect(p.endpoints.web).not.toBe('planned')
      expect(p.endpoints.app).toBe('planned')
      expect(p.endpoints.pc).toBe('planned')
    }
  })

  /** 已经移植完的平台：上游有的（✓ / ◐）都有实现，○ 的都没有。移植完一个平台就加进来。 */
  const PORTED = ['bilibili', 'taobao', 'weibo', 'x', 'kuaishou', 'xianyu', 'tiktok', 'jd', 'douyin', 'xhs', '12306']

  it('已移植的平台：✓ / ◐ 的命令都已实现，○ 的都是 planned', () => {
    for (const p of PLATFORMS.filter((x) => PORTED.includes(x.id))) {
      for (const c of web(p).commands.values()) {
        const expected = c.upstream === 'none' ? 'planned' : 'implemented'
        expect([p.id, c.key, c.status]).toEqual([p.id, c.key, expected])
      }
    }
  })

  it('未移植的平台：除 core 的 auth list / use / logout 外都是 planned', () => {
    for (const p of PLATFORMS.filter((x) => !PORTED.includes(x.id))) {
      for (const c of web(p).commands.values()) {
        const core = ['auth list', 'auth use', 'auth logout'].includes(c.key)
        expect([p.id, c.key, c.status]).toEqual([p.id, c.key, core ? 'implemented' : 'planned'])
      }
    }
  })

  it('扩展命令与 AGENTS 4.7 一致', () => {
    const ext = Object.fromEntries(PLATFORMS.map((p) => [p.id, [...web(p).commands.values()].filter((c) => c.extension).map((c) => c.key).sort()]))
    expect(ext).toEqual({
      xhs: [],
      douyin: [],
      tiktok: ['folder add'],
      bilibili: [
        'article publish', 'danmaku list', 'danmaku send', 'draft delete', 'draft get', 'dynamic delete', 'dynamic publish', 'item coin', 'item subtitles',
        'item triple',
      ],
      kuaishou: [],
      weibo: [],
      xianyu: [],
      taobao: [],
      jd: ['cart count', 'coupon list', 'order list'],
      x: ['article delete', 'article publish'],
      '12306': ['route get', 'station search', 'ticket price', 'ticket search', 'transfer search'],
    })
  })

  it('summary 里的 {item} 都已替换', () => {
    for (const p of PLATFORMS) {
      for (const c of web(p).commands.values()) {
        expect(c.summary).not.toContain('{item}')
        for (const a of c.args) expect(a.summary).not.toContain('{item}')
      }
    }
    expect(web(PLATFORMS[0]!).commands.get('item get')!.summary).toBe('笔记详情')
  })

  it('需要确认的命令（AGENTS 4.11）', () => {
    const confirm = new Set<string>()
    for (const p of PLATFORMS) {
      for (const c of web(p).commands.values()) if (c.confirm) confirm.add(c.extension ? `${p.id} ${c.key}` : c.key)
    }
    expect([...confirm].sort()).toEqual([
      'bilibili draft delete', 'bilibili dynamic delete', 'bilibili item coin', 'bilibili item triple',
      'comment delete', 'folder delete', 'item delete', 'live send', 'msg delete', 'msg revoke', 'x article delete',
    ])
    const send = VOCAB['live send']!.confirm as (o: object) => boolean
    expect([send({}), send({ gift: 'g1' })]).toEqual([false, true])
  })

  it('选项在所有命令里类型一致，不与全局选项重名', () => {
    expect(() => collectOptionKinds(PLATFORMS)).not.toThrow()
  })

  it('发现选项冲突时启动报错', () => {
    const bad = define({ 'item get': { upstream: 'full', options: { limit: z.string().optional() } } })
    expect(() => collectOptionKinds([...PLATFORMS, bad])).toThrow(/--limit/)
    const clash = define({ 'item get': { upstream: 'full', options: { proxy: z.string().optional() } } })
    expect(() => collectOptionKinds([clash])).toThrow(/全局选项/)
  })

  it('声明不合法时 definePlatform 报错', () => {
    expect(() => define({ 'foo bar': { upstream: 'full' } })).toThrow(/缺少 summary/)
    expect(() => define({ 'auth list': 'full' })).toThrow(/core/)
    expect(() => define({ item: 'full' } as any)).toThrow(/resource action/)
    expect(() =>
      define({ 'foo bar': { upstream: 'full', summary: 's', args: [], auth: 'required', output: 'Nope' } }),
    ).toThrow(/Nope/)
    // web 端不支持游客态，不能声明 auth: optional
    expect(() => define({ 'item get': { upstream: 'full', auth: 'optional' } })).toThrow(/游客/)
  })
})

function define(commands: Record<string, any>): Platform {
  const decl: PlatformDecl = {
    id: 'bad',
    name: 'bad',
    aliases: [],
    item: '条目',
    endpoints: { web: { login: { methods: ['cookie'], default: 'cookie' }, commands }, app: 'planned', pc: 'planned' },
  }
  return definePlatform(decl)
}

describe('handler 与命令对应', () => {
  it('每条命令的 handler 名是 <resource><Action>（例如 draft delete → draftDelete），防止接错', () => {
    const wrong: string[] = []
    for (const p of PLATFORMS) {
      for (const e of Object.values(p.endpoints)) {
        if (e === 'planned') continue
        for (const c of e.commands.values()) {
          const name = (c.handler as { handlerName?: string } | null)?.handlerName
          if (name == null) continue
          const want = c.resource + c.action[0]!.toUpperCase() + c.action.slice(1)
          if (name !== want) wrong.push(`${p.id} ${c.key} → ${name}`)
        }
      }
    }
    expect(wrong).toEqual([])
  })

  it('supports：没列出的标准选项从命令里去掉，记在 unsupported；列了不存在的选项报错', () => {
    const decl = (supports: string[]): PlatformDecl => ({
      id: 'demo',
      name: '演示',
      aliases: [],
      item: '条目',
      endpoints: { web: { login: { methods: ['cookie'], default: 'cookie' }, commands: { 'item publish': { upstream: 'full', supports } } }, app: 'planned', pc: 'planned' },
    })
    const web = definePlatform(decl(['text', 'image'])).endpoints.web
    if (web === 'planned') throw new Error('web 端应当可用')
    const publish = web.commands.get('item publish')!
    expect(Object.keys(publish.options)).toEqual(['text', 'image'])
    expect(publish.unsupported).toEqual(['title', 'video', 'cover', 'tag', 'topic', 'mention', 'poi', 'category', 'visibility', 'schedule', 'price'])
    expect(() => definePlatform(decl(['text', 'thread']))).toThrow(/supports 里的 thread 不是这个命令的标准选项/)
  })
})

describe('docs/capabilities.md', () => {
  it('与注册表一致（改了注册表后运行 npm run gen:capabilities）', () => {
    const file = readFileSync(new URL('../docs/capabilities.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(file).toBe(renderCapabilities(PLATFORMS))
  })
})

describe('package.json', () => {
  it('精确钉住两个模型包的版本（AGENTS 7.2）', () => {
    const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
    const main = read('../package.json')
    for (const dir of ['assets-jd', 'assets-ocr']) {
      const assets = read(`../packages/${dir}/package.json`)
      expect(main.dependencies[assets.name], assets.name).toBe(assets.version)
    }
  })
})
