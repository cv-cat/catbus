import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Platform } from '../src/core/registry.js'
import { PLATFORMS } from '../src/platforms/index.js'

// .claude/skills/catbus 是给 AI Agent 的使用说明（AGENTS 7.7）。平台文件里「能做 / 做不到」是手写的摘要，
// 这里对照注册表，防止注册表改了而技能没跟上。
const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '../.claude/skills/catbus')
const read = (rel: string) => readFileSync(join(SKILL, rel), 'utf8').replace(/\r\n/g, '\n')
const skill = read('SKILL.md')
// 技能文档单独维护：检查已收录的平台，新增 CLI 平台不要求同时发布 Agent 指令。
const documentedIds = [...skill.matchAll(/^\|[^\n]*?\| `([a-z0-9]+)` \|/gm)].map((m) => m[1]!)
const documentedPlatforms = PLATFORMS.filter((p) => documentedIds.includes(p.id))

const RESOURCES = new Set(
  PLATFORMS.flatMap((p) => [...primary(p).commands.values()].map((c) => c.resource)),
)

function primary(p: Platform) {
  const ep = p.endpoints[p.defaultEndpoint]
  if (ep === 'planned') throw new Error(`${p.id} 的默认端是 planned`)
  return ep
}

/**
 * 从一段文字里取出提到的命令：`item search` 设定当前 resource，后面的 `get` 这类单词接在它后面。
 * `coupon list <item>` 这样带占位参数的也算；带选项的（`feed list --kind hot`）只是提到某个取值，不算。
 */
function mentioned(text: string): Set<string> {
  const out = new Set<string>()
  let resource: string | null = null
  for (const [, token] of text.matchAll(/`([^`]+)`/g)) {
    const parts = token!.trim().split(/\s+/)
    const placeholders = parts.slice(2).every((s) => /^[<[]/.test(s))
    if (parts.length >= 2 && placeholders && RESOURCES.has(parts[0]!) && /^[a-z]+$/.test(parts[1]!)) {
      resource = parts[0]!
      out.add(`${parts[0]} ${parts[1]}`)
    } else if (parts.length === 1 && /^[a-z]+$/.test(parts[0]!) && resource) {
      out.add(`${resource} ${parts[0]}`)
    }
  }
  return out
}

function section(md: string, title: string): string {
  const m = md.match(new RegExp(`\\n## ${title}\\n([\\s\\S]*?)(?=\\n## )`))
  if (!m) throw new Error(`缺少「## ${title}」`)
  return m[1]!
}

describe('Agent 技能 .claude/skills/catbus', () => {
  it('SKILL.md 收录的平台均已注册，并列出正确的别名和平台文件', () => {
    expect(documentedIds.length).toBeGreaterThan(0)
    expect(documentedPlatforms.map((p) => p.id).sort()).toEqual([...documentedIds].sort())
    for (const p of documentedPlatforms) {
      const row = skill.split('\n').find((l) => l.startsWith('| ') && l.includes(`| \`${p.id}\` |`))
      expect(row, p.id).toBeDefined()
      for (const alias of p.aliases) expect(row, `${p.id} 的别名 ${alias}`).toContain(`\`${alias}\``)
      expect(row).toContain(`platforms/${p.id}.md`)
    }
  })

  it('description 提到了已收录的每个平台', () => {
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? ''
    for (const p of documentedPlatforms) expect(description, p.id).toContain(p.name)
  })

  it('平台文件与技能目录一一对应', () => {
    const files = readdirSync(join(SKILL, 'platforms')).map((f) => f.replace(/\.md$/, ''))
    expect(files.sort()).toEqual([...documentedIds].sort())
  })

  for (const p of documentedPlatforms) {
    it(`platforms/${p.id}.md：「能做」恰好是已实现的命令，「做不到」里没有已实现的`, () => {
      const md = read(`platforms/${p.id}.md`)
      const implemented = new Set(
        [...primary(p).commands.values()]
          .filter((c) => c.status === 'implemented' && c.resource !== 'auth')
          .map((c) => `${c.resource} ${c.action}`),
      )
      const can = mentioned(section(md, '能做'))
      expect([...can].filter((c) => !implemented.has(c)), '写进「能做」但没实现').toEqual([])
      expect([...implemented].filter((c) => !can.has(c)), '已实现但「能做」里漏了').toEqual([])
      const cannot = mentioned(section(md, '做不到'))
      expect([...cannot].filter((c) => implemented.has(c)), '写进「做不到」但已实现').toEqual([])
    })
  }

  it('技能里的相对链接都能打开', () => {
    const broken: string[] = []
    const walk = (dir: string): string[] =>
      readdirSync(join(SKILL, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [],
      )
    for (const file of walk('.')) {
      for (const [, target] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        if (/^https?:/.test(target!)) continue
        if (!existsSync(join(SKILL, dirname(file), target!))) broken.push(`${file} → ${target}`)
      }
    }
    expect(broken).toEqual([])
  })
})
