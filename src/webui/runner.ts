import { execFile, type ChildProcess } from 'node:child_process'
import { resolveCli } from './cli.js'

/**
 * `/api/catbus` 的子进程调度（AGENTS.md 7.9「bridge 的边界」）：并发上限、排队、客户端断开时取消。
 *
 * - 同时运行的 catbus 子进程最多 MAX_RUNNING 个，其余按到达顺序排队。每个子进程是一个完整的 Node
 *   （启动、加载平台模块、签名 vm 各占一份内存和 CPU），而且都会打到平台接口：聚合模式换一次筛选
 *   就会同时来 8～11 个请求，不限的话本机卡顿、对平台也是一阵突发流量（风控风险）。4 个既够聚合模式
 *   的几个渠道和详情卡片并行，又把突发压在平台能接受的范围里。
 * - 轻量的探测命令（`version`、`platforms`、`auth list`）不访问平台、很快结束，走单独的通道
 *   （MAX_LIGHT 个），不会排在长请求后面：页面启动时的探测不被搜索饿住。
 * - 排队中的请求被取消时直接出队，不启动子进程；运行中的被取消时先 SIGTERM，KILL_GRACE_MS 后
 *   还没退出就 SIGKILL。名额等子进程真正退出后才释放，所以上限约束的是实际存在的进程数。
 */
export const MAX_RUNNING = 4
export const MAX_LIGHT = 2
/** 单条命令的超时（与原来 execFile 的 timeout 相同） */
const TIMEOUT_MS = 90_000
/** SIGTERM 之后等这么久还没退出就 SIGKILL */
const KILL_GRACE_MS = 3_000

export class AbortedError extends Error {
  override name = 'AbortError'
  constructor() {
    super('请求已取消')
  }
}

class Pool {
  running = 0
  private queue: Array<() => void> = []
  constructor(private readonly limit: number) {}

  get queued() {
    return this.queue.length
  }

  /** 拿到一个名额；排队期间 signal 中止时出队并 reject */
  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AbortedError())
    if (this.running < this.limit) {
      this.running++
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener('abort', onAbort)
        this.running++
        resolve()
      }
      const onAbort = () => {
        const i = this.queue.indexOf(wake)
        if (i >= 0) this.queue.splice(i, 1)
        reject(new AbortedError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(wake)
    })
  }

  release() {
    this.running--
    this.queue.shift()?.()
  }
}

const main = new Pool(MAX_RUNNING)
const light = new Pool(MAX_LIGHT)

const isLight = (argv: string[]) =>
  (argv.length === 1 && (argv[0] === 'version' || argv[0] === 'platforms')) || (argv.length === 2 && argv[0] === 'auth' && argv[1] === 'list')

/** 测试与调试用：当前在跑、在排队的数量 */
export function runnerStats() {
  return { running: main.running, queued: main.queued, lightRunning: light.running, lightQueued: light.queued }
}

/** 结束子进程：SIGTERM，宽限期后仍在就 SIGKILL */
function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

function spawnCli(argv: string[], signal?: AbortSignal): Promise<string> {
  const { file, prefix } = resolveCli()
  // 全局选项放在最前面，避免落到 `--` 之后被当成关键词
  const full = [...prefix, '-o', 'json', '-q', ...argv]
  return new Promise((resolve, reject) => {
    let aborted = false
    // 回调在子进程退出、输出流关闭之后才调用，名额在这之后才释放
    const child = execFile(file, full, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (aborted) return reject(new AbortedError())
      // catbus 出错时退出码非 0，但 stdout 仍然是一个信封
      if (stdout.trim()) return resolve(stdout)
      reject(err ?? new Error('catbus 没有输出'))
    })
    const timer = setTimeout(() => terminate(child), TIMEOUT_MS)
    const onAbort = () => {
      aborted = true
      terminate(child)
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 排队运行一条 catbus 命令，返回 stdout 上的信封；signal 中止时 reject AbortedError */
export async function runCatbus(argv: string[], signal?: AbortSignal): Promise<string> {
  const pool = isLight(argv) ? light : main
  await pool.acquire(signal)
  try {
    return await spawnCli(argv, signal)
  } finally {
    pool.release()
  }
}
