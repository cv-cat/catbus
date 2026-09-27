import { setTimeout as sleep } from 'node:timers/promises'
import { websocket, type WebSocketOptions } from 'wreq-js'
import { toNetworkError } from './http.js'
import type { HandlerContext } from './registry.js'

/** 长连接（AGENTS 4.9「长连接」）：WebSocket 包装成异步迭代，断线自动重连。 */

export interface Socket {
  send(data: string | Uint8Array): Promise<void>
  close(): void
  messages: AsyncIterable<string | Buffer>
}

/** 打开一个 WebSocket。消息按到达顺序进入 messages；连接关闭或 signal 中止时迭代结束，出错时抛出。 */
export async function openSocket(url: string, options: WebSocketOptions & { signal?: AbortSignal } = {}): Promise<Socket> {
  const { signal, ...wsOptions } = options
  const queue: (string | Buffer)[] = []
  let wake: (() => void) | null = null
  let done = false
  let failure: unknown = null
  const notify = () => {
    const w = wake
    wake = null
    w?.()
  }
  let ws
  try {
    ws = await websocket(url, { browser: 'chrome', os: 'windows', ...wsOptions, binaryType: 'nodebuffer' } as WebSocketOptions)
  } catch (err) {
    throw toNetworkError(err)
  }
  ws.onmessage = (e) => {
    queue.push(e.data as string | Buffer)
    notify()
  }
  ws.onclose = () => {
    done = true
    notify()
  }
  ws.onerror = (e) => {
    failure = new Error(String((e as { message?: string }).message ?? 'WebSocket 出错'))
    done = true
    notify()
  }
  const onAbort = () => {
    ws.close()
    done = true
    notify()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    send: async (data) => {
      await ws.send(data as never)
    },
    close: () => ws.close(),
    messages: {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            while (queue.length) yield queue.shift()!
            if (done) break
            await new Promise<void>((r) => (wake = r))
          }
          if (failure) throw failure
        } finally {
          signal?.removeEventListener('abort', onAbort)
          if (!done) ws.close()
        }
      },
    },
  }
}

/**
 * 断线自动重连：connect 每次返回一段事件流，流结束或出错后按指数退避重连，直到 signal 中止。
 */
export async function* reconnecting<T>(ctx: HandlerContext, connect: (attempt: number) => AsyncIterable<T>, options: { maxDelay?: number } = {}): AsyncIterable<T> {
  let attempt = 0
  while (!ctx.signal.aborted) {
    try {
      for await (const value of connect(attempt)) {
        attempt = 0
        yield value
      }
    } catch (err) {
      if (ctx.signal.aborted) return
      ctx.log.warn(`连接断开：${err instanceof Error ? err.message : String(err)}`)
    }
    if (ctx.signal.aborted) return
    attempt++
    const delay = Math.min(1000 * 2 ** (attempt - 1), options.maxDelay ?? 30_000)
    ctx.log.info(`${Math.round(delay / 1000)} 秒后重连（第 ${attempt} 次）`)
    await sleep(delay, undefined, { signal: ctx.signal }).catch(() => {})
  }
}
