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

// 平台清单的精确断言在 tests/cli.test.ts；冒烟只确认装好的包能列出平台，所以加平台时不用改这里。
// 失败信息只写摘要：platforms 的完整输出有好几万字符，整段打进日志既难读，也可能被 CI 截断。
check('platforms', () => {
  const r = catbus('platforms')
  const list = r.env?.data
  assert(r.code === 0 && Array.isArray(list), `退出码 ${r.code}；${r.stderr.slice(0, 300) || r.stdout.slice(0, 300)}`)
  const ids = list.map((p) => p.id)
  for (const id of ['xhs', 'douyin', 'bilibili']) assert(ids.includes(id), `缺少平台 ${id}；实际：${ids.join(' ')}`)
  const broken = list.filter((p) => !p.name || !p.endpoints?.web || !Array.isArray(p.commands) || p.commands.length === 0)
  assert(broken.length === 0, `这些平台的信息不完整：${broken.map((p) => p.id).join(' ')}`)
  console.log(`      ${ids.length} 个平台：${ids.join(' ')}`)
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
  // 不用 process.exit(1)：stdout 是管道时，它会把还没写完的输出直接丢掉，日志里就看不到后面的检查结果
  process.exitCode = 1
}
