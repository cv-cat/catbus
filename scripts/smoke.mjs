// 冒烟测试：对已经全局安装的 catbus 运行几条命令（AGENTS 7.5）。CI 在全部目标系统上跑。
// 用法：node scripts/smoke.mjs
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'catbus-smoke-'))
let failed = 0

function catbus(...args) {
  const r = spawnSync('catbus', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, CATBUS_HOME: home },
  })
  if (r.error) throw r.error
  let env = null
  try {
    env = JSON.parse(r.stdout)
  } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, env }
}

function check(name, fn) {
  try {
    fn()
    console.log(`ok    ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL  ${name}：${err.message}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

check('version', () => {
  const r = catbus('version')
  assert(r.code === 0 && r.env?.ok, r.stdout + r.stderr)
  assert(r.env.data.node === process.versions.node, `node 版本不一致：${r.env.data.node}`)
  console.log(`      ${JSON.stringify(r.env.data)}`)
})

check('doctor', () => {
  const r = catbus('doctor')
  for (const c of r.env?.data ?? []) console.log(`      ${c.ok ? '✓' : '✗'} ${c.name}：${c.message}`)
  assert(r.code === 0 && r.env?.ok, r.env?.error?.message ?? r.stdout + r.stderr)
})

check('模型包（assets-jd、assets-ocr）', () => {
  const r = catbus('doctor')
  for (const name of ['assets-jd', 'assets-ocr']) {
    const c = (r.env?.data ?? []).find((x) => x.name === name)
    assert(c?.ok, `${name}：${c?.message ?? 'doctor 没有这一项'}`)
  }
})

check('platforms', () => {
  const r = catbus('platforms')
  assert(r.code === 0 && r.env?.data?.length === 10, r.stdout + r.stderr)
})

check('--help', () => {
  const r = catbus('--help')
  assert(r.code === 0 && r.stdout.includes('catbus <platform> <resource> <action>'), r.stdout + r.stderr)
})

check('planned 端 → NOT_IMPLEMENTED（退出码 4）', () => {
  const r = catbus('xianyu', 'item', 'get', 'x', '-e', 'app')
  assert(r.code === 4 && r.env?.error?.code === 'NOT_IMPLEMENTED', r.stdout + r.stderr)
})

check('auth list', () => {
  const r = catbus('auth', 'list')
  assert(r.code === 0 && Array.isArray(r.env?.data), r.stdout + r.stderr)
})

rmSync(home, { recursive: true, force: true })
if (failed) {
  console.log(`${failed} 项失败`)
  process.exit(1)
}
