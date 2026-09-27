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

  it('所有平台 web 可用，app / pc 为 planned', () => {
    for (const p of PLATFORMS) {
      expect(p.endpoints.web).not.toBe('planned')
      expect(p.endpoints.app).toBe('planned')
      expect(p.endpoints.pc).toBe('planned')
    }
  })

  /** 已经移植完的平台：上游有的（✓ / ◐）都有实现，○ 的都没有。移植完一个平台就加进来。 */
  const PORTED = ['bilibili', 'taobao', 'weibo']

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
      xhs: [
        'distributor categories', 'distributor fans', 'distributor get', 'distributor items', 'distributor list',
        'kol categories', 'kol fans', 'kol get', 'kol invite', 'kol items', 'kol list',
      ],
      douyin: [],
      tiktok: [],
      bilibili: [
        'article publish', 'danmaku list', 'danmaku send', 'dynamic delete', 'dynamic publish', 'item coin', 'item subtitles', 'item triple',
      ],
      kuaishou: [],
      weibo: [],
      xianyu: [],
      taobao: [],
      jd: ['cart count', 'coupon list', 'order list'],
      x: [],
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
      for (const c of web(p).commands.values()) if (c.confirm) confirm.add(p.id === 'bilibili' && c.extension ? `bilibili ${c.key}` : c.key)
    }
    expect([...confirm].sort()).toEqual([
      'bilibili dynamic delete', 'bilibili item coin', 'bilibili item triple',
      'comment delete', 'folder delete', 'item delete', 'live send', 'msg delete', 'msg revoke',
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
      define({ 'foo bar': { upstream: 'full', summary: 's', args: [], auth: 'optional', output: 'Nope' } }),
    ).toThrow(/Nope/)
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

describe('docs/capabilities.md', () => {
  it('与注册表一致（改了注册表后运行 npm run gen:capabilities）', () => {
    const file = readFileSync(new URL('../docs/capabilities.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(file).toBe(renderCapabilities(PLATFORMS))
  })
})

describe('package.json', () => {
  it('精确钉住 @cv-cat/catbus-assets-jd 的版本（AGENTS 7.2）', () => {
    const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
    const main = read('../package.json')
    const assets = read('../packages/assets-jd/package.json')
    expect(main.dependencies[assets.name]).toBe(assets.version)
  })
})
