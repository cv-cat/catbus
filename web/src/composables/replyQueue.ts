/**
 * 默认展开的第一条回复（AGENTS.md 7.9 详情卡片）：评论滚进视野时预取，
 * 同一时间只发一个请求，请求之间留间隔；遇到风控就停止自动预取，只剩手动展开。
 */
const GAP: Record<string, number> = { xhs: 3000 }
const DEFAULT_GAP = 1200

let chain: Promise<unknown> = Promise.resolve()
let gen = 0
let stopped = false
/** 这一张卡片的预取共用的取消器：换卡片、关卡片时中止正在跑的那一个 */
let ctl = new AbortController()

/** 打开新的详情卡片（或关掉卡片）时调用：丢弃上一张卡片排队中的预取，取消正在跑的 */
export function resetReplyQueue() {
  gen++
  stopped = false
  chain = Promise.resolve()
  ctl.abort()
  ctl = new AbortController()
}

/** 停止自动预取（平台风控） */
export function stopReplyQueue() {
  stopped = true
}

const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === 'AbortError'

/** 排队执行；卡片已关闭、换了、已停止或被取消时返回 null */
export function enqueueReply<T>(platform: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const my = gen
  const signal = ctl.signal
  const run = chain.then(async () => {
    if (my !== gen || stopped || signal.aborted) return null
    try {
      return await task(signal)
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    } finally {
      // 被取消的不用再等间隔（新卡片的队列是新的 chain，这里只是不拖住旧的）
      if (!signal.aborted) await new Promise((r) => setTimeout(r, GAP[platform] ?? DEFAULT_GAP))
    }
  })
  chain = run.catch(() => {})
  return run
}
