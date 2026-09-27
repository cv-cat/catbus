#!/usr/bin/env node
// 代理只能显式配置（AGENTS 5.5）：在加载 wreq-js 之前关掉它对 HTTP(S)_PROXY 和系统代理的读取。
process.env.NO_PROXY = process.env.no_proxy = '*,0.0.0.0/0,::/0'

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

const { run } = await import('./dispatch.js')
process.exitCode = await run(process.argv.slice(2))
