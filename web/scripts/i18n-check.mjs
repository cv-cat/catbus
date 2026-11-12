#!/usr/bin/env node
/**
 * 多语言检查（AGENTS.md 7.9「多语言」）。
 *
 *   npm run i18n:check                          各语言与 zh-CN 对账 + 代码里用到的 key 是否存在
 *   npm run i18n:check -- --locale ja           只对账 ja
 *   npm run i18n:check -- --hardcoded [文件...] 另外列出代码里残留的中文（可只看给出的文件 / 目录）
 *   npm run i18n:check -- --hardcoded --strict  有残留中文也算失败
 *
 * 对账规则：key 集合一致；占位（{n}、{name}）集合一致；译文不为空。复数分支（按 | 分隔）可以和中文不同
 * （中文一支，英语分单复数），但最多三支（零 | 一 | 多）。
 * 残留中文不算：注释、带 `i18n-ignore` 的行、<style>、演示数据（src/api/mock.ts）、表情表（src/data/emoji/）、文案文件本身。
 * 有错误时退出码 1。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = join(ROOT, 'src')
const LOCALES_DIR = join(SRC, 'locales')
const SOURCE = 'zh-CN'
const LOCALES = ['zh-CN', 'en', 'ja', 'ko']

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const onlyLocale = opt('--locale')
const hardcoded = flag('--hardcoded')
const strict = flag('--strict')
const targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--locale')

let errors = 0
const err = (msg) => {
  errors++
  console.log(`  ✗ ${msg}`)
}

/** { 'ns.a.b': '文案' } */
function loadLocale(code) {
  const dir = join(LOCALES_DIR, code)
  const out = new Map()
  if (!existsSync(dir)) return null
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const ns = f.slice(0, -5)
    let data
    try {
      data = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    } catch (e) {
      err(`${code}/${f}: JSON 解析失败：${e.message}`)
      continue
    }
    const walk = (o, prefix) => {
      for (const [k, v] of Object.entries(o)) {
        const key = `${prefix}.${k}`
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key)
        else if (typeof v === 'string') out.set(key, v)
        else err(`${code}/${f}: ${key} 不是字符串`)
      }
    }
    walk(data, ns)
  }
  return out
}

const placeholders = (s) => [...new Set([...s.matchAll(/\{\s*([\w.]+)\s*\}/g)].map((m) => m[1]))].sort().join(",")
const branches = (s) => s.split(/(?<!\\)\|/).length

const source = loadLocale(SOURCE)
if (!source) {
  console.log(`没有源语言目录 ${relative(ROOT, join(LOCALES_DIR, SOURCE))}`)
  process.exit(1)
}

// 1. 各语言与 zh-CN 对账
for (const code of LOCALES.filter((c) => c !== SOURCE && (!onlyLocale || c === onlyLocale))) {
  const msgs = loadLocale(code)
  if (!msgs) {
    console.log(`${code}：还没有文案（src/locales/${code}/ 不存在），跳过`)
    continue
  }
  const before = errors
  console.log(`${code}：`)
  for (const [k, v] of source) {
    if (!msgs.has(k)) {
      err(`缺 key ${k}（中文：${v}）`)
      continue
    }
    const tv = msgs.get(k)
    if (!tv.trim() && v.trim()) err(`译文为空 ${k}`)
    if (placeholders(tv) !== placeholders(v)) err(`占位不一致 ${k}：中文 {${placeholders(v)}}，译文 {${placeholders(tv)}}`)
    if (branches(tv) > 3) err(`复数分支超过三支 ${k}`)
  }
  for (const k of msgs.keys()) if (!source.has(k)) err(`多余的 key ${k}（中文里没有）`)
  if (errors === before) console.log(`  ✓ ${msgs.size} 条，与 zh-CN 一致`)
}

// 2. 代码里字面量用到的 key 必须在 zh-CN 里
function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(vue|ts)$/.test(f)) yield p
  }
}
const KEY_RE = /(?:\$t|\bt|\bte|\btm|\brt)\(\s*(['"])([\w.-]+)\1|\bkeypath=(['"])([\w.-]+)\3/g
const used = new Map()
for (const f of files(SRC)) {
  if (f.startsWith(LOCALES_DIR)) continue
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(KEY_RE)) {
    const key = m[2] ?? m[4]
    if (!key.includes('.')) continue
    if (!used.has(key)) used.set(key, relative(ROOT, f))
  }
}
const before = errors
console.log('代码里用到的 key：')
for (const [k, f] of used) {
  const isLeaf = source.has(k)
  const isBranch = !isLeaf && [...source.keys()].some((s) => s.startsWith(`${k}.`))
  if (!isLeaf && !isBranch) err(`${f}: t('${k}') 在 zh-CN 里不存在`)
}
if (errors === before) console.log(`  ✓ ${used.size} 个字面量 key 都存在`)

// 3. 残留的中文
if (hardcoded) {
  const CJK = /[㐀-鿿豈-﫿]/
  const skip = (f) =>
    f.startsWith(LOCALES_DIR) || f === join(SRC, 'api', 'mock.ts') || f.startsWith(join(SRC, 'data', 'emoji') + sep)
  const scope = targets.map((t) => resolve(process.cwd(), t))
  const inScope = (f) => !scope.length || scope.some((s) => f === s || f.startsWith(s + sep))
  let total = 0
  const byFile = []
  for (const f of files(SRC)) {
    if (skip(f) || !inScope(f)) continue
    const lines = readFileSync(f, 'utf8').split('\n')
    const hits = []
    let inBlock = false
    let inStyle = false
    lines.forEach((raw, i) => {
      let line = raw
      if (/^\s*<style\b/.test(line)) inStyle = true
      if (inStyle) {
        if (/<\/style>/.test(line)) inStyle = false
        return
      }
      if (line.includes('i18n-ignore')) return
      // 去掉块注释、HTML 注释、行注释（// 前面是行首或空白，避开 https://）
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end < 0) return
        line = line.slice(end + 2)
        inBlock = false
      }
      line = line.replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '')
      const open = line.search(/\/\*|<!--/)
      if (open >= 0) {
        inBlock = line.slice(open).startsWith('/*')
        line = line.slice(0, open)
      }
      line = line.replace(/(^|\s)\/\/.*$/, '$1')
      if (CJK.test(line)) hits.push(`${i + 1}: ${raw.trim().slice(0, 120)}`)
    })
    if (hits.length) {
      byFile.push([relative(ROOT, f), hits])
      total += hits.length
    }
  }
  console.log(`残留的中文：${total} 行`)
  for (const [f, hits] of byFile) {
    console.log(`  ${f}（${hits.length}）`)
    for (const h of hits) console.log(`    ${h}`)
  }
  if (strict && total) errors += total
}

if (errors) {
  console.log(`\n${errors} 个问题`)
  process.exit(1)
}
console.log('\n通过')
