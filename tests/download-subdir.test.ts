import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { folderName, itemDir } from '../src/core/files.js'
import type { HandlerContext } from '../src/core/registry.js'
import { findPlatform } from '../src/platforms/index.js'
import { cli, useTempHome } from './helpers.js'

/** itemDir 只用到平台和 --dir / --subdir */
const ctxOf = (options: Record<string, unknown>) => ({ platform: findPlatform('xhs')!, options }) as unknown as HandlerContext

describe('folderName：三大系统都能用的目录名（AGENTS 4.9「下载」）', () => {
  it.each([
    ['🔥老外说 "money is money"是什么意思？', '老外说 money is money 是什么意思？'],
    ['孙燕姿理财失败😢', '孙燕姿理财失败'],
    ['来看看美丽的背影[色色R]#宋轶[话题]# #好美[话题]#', '来看看美丽的背影'],
    ['a/b\\c:d*e?f|g<h>"i', 'a b c d e f g h i'],
    ['tab\there\nnew\u0000line', 'tab here new line'],
    ['...  hidden. ', 'hidden'],
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['com1', '_com1'],
    ['console', 'console'],
    ['👨‍👩‍👧‍👦🇨🇳❤️', null],
    ['#话题[话题]#', null],
    ['', null],
    [null, null],
  ])('%j → %j', (input, expected) => {
    expect(folderName(input)).toBe(expected)
  })

  it('最长 60 个字符，按码点截，不截断汉字或代理对', () => {
    expect(folderName('字'.repeat(100))).toBe('字'.repeat(60))
    expect(folderName('𠀀'.repeat(70))).toBe('𠀀'.repeat(60))
    expect(folderName(`${'a'.repeat(59)}. b`)).toBe('a'.repeat(59))
  })
})

describe('itemDir：--subdir', () => {
  const base = () => mkdtempSync(join(tmpdir(), 'catbus-subdir-'))

  it('默认 none：直接用 --dir', async () => {
    const dir = base()
    expect(await itemDir(ctxOf({ dir }), 'n1', '标题')).toBe(dir)
  })

  it('id：用 item ID', async () => {
    const dir = base()
    expect(await itemDir(ctxOf({ dir, subdir: 'id' }), '6ad86763', '标题')).toBe(join(dir, '6ad86763'))
  })

  it('title：用清洗后的标题；没有标题或清洗后为空时用 ID', async () => {
    const dir = base()
    const ctx = ctxOf({ dir, subdir: 'title' })
    expect(await itemDir(ctx, 'n1', '好看😊的笔记')).toBe(join(dir, '好看 的笔记'))
    expect(await itemDir(ctx, 'n2', null)).toBe(join(dir, 'n2'))
    expect(await itemDir(ctx, 'n3', '🎉')).toBe(join(dir, 'n3'))
  })

  it('title：同名目录里已有别的 item 的文件时加 ID 后 6 位；自己的文件不算冲突', async () => {
    const dir = base()
    const ctx = ctxOf({ dir, subdir: 'title' })
    mkdirSync(join(dir, '同名'))
    writeFileSync(join(dir, '同名', 'xhs_aaa111_1.jpg'), '')
    expect(await itemDir(ctx, 'aaa111', '同名')).toBe(join(dir, '同名'))
    expect(await itemDir(ctx, 'bbb222333444', '同名')).toBe(join(dir, '同名 (333444)'))
    // 别的文件（不是 catbus 下的）不算冲突
    mkdirSync(join(dir, '手动'))
    writeFileSync(join(dir, '手动', 'notes.txt'), '')
    expect(await itemDir(ctx, 'ccc', '手动')).toBe(join(dir, '手动'))
  })
})

describe('item download --subdir', () => {
  useTempHome()

  it('取值不在 none / id / title 里时报 USAGE', async () => {
    const r = await cli('xhs', 'item', 'download', 'n1', '--subdir', 'name')
    expect(r.env.error.code).toBe('USAGE')
  })

})
