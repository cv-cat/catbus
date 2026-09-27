import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { run } from '../src/cli/dispatch.js'

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
