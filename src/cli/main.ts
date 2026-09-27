#!/usr/bin/env node
// 代理只能显式配置（AGENTS 5.5）：在加载 wreq-js 之前关掉它对 HTTP(S)_PROXY 和系统代理的读取。
process.env.NO_PROXY = process.env.no_proxy = '*,0.0.0.0/0,::/0'

process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0)
  throw err
})

const { run } = await import('./dispatch.js')
const { closeTransports } = await import('../core/http.js')
const code = await run(process.argv.slice(2))
await closeTransports()
// 原生连接（长连接的 WebSocket 等）可能还挂着句柄：输出写完后直接退出
const flush = (stream: NodeJS.WriteStream) => new Promise<void>((resolve) => stream.write('', () => resolve()))
await flush(process.stdout)
await flush(process.stderr)
process.exit(code)
