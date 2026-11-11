/**
 * 默认展开的第一条回复（AGENTS.md 7.9 详情卡片）：评论滚进视野时预取，
 * 同一时间只发一个请求，请求之间留间隔；遇到风控就停止自动预取，只剩手动展开。
 */
const GAP: Record<string, number> = { xhs: 3000 }
const DEFAULT_GAP = 1200

let chain: Promise<unknown> = Promise.resolve()
let gen = 0
let stopped = false

/** 打开新的详情卡片时调用：丢弃上一张卡片排队中的预取 */
export function resetReplyQueue() {
  gen++
  stopped = false
  chain = Promise.resolve()
}

/** 停止自动预取（平台风控） */
export function stopReplyQueue() {
  stopped = true
}

/** 排队执行；卡片已关闭、换了或已停止时返回 null */
export function enqueueReply<T>(platform: string, task: () => Promise<T>): Promise<T | null> {
  const my = gen
  const run = chain.then(async () => {
    if (my !== gen || stopped) return null
    try {
      return await task()
    } finally {
      await new Promise((r) => setTimeout(r, GAP[platform] ?? DEFAULT_GAP))
    }
  })
  chain = run.catch(() => {})
  return run
}
