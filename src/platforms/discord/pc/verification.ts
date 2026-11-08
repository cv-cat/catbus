import type { CatbusError } from '../../../core/errors.js'

/** 在等待人工操作期间把退出信号转为可清理的中止。 */
export async function withVerification<T>(parent: AbortSignal, timeout: number, error: (timeout: boolean) => CatbusError,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const stop = () => controller.abort(error(false))
  const timer = setTimeout(() => controller.abort(error(true)), timeout)
  parent.addEventListener('abort', stop, { once: true })
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  if (parent.aborted) stop()
  try {
    controller.signal.throwIfAborted()
    return await run(controller.signal)
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', stop)
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}

export async function untilAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  try {
    return await Promise.race([operation, stopped])
  } finally {
    signal.removeEventListener('abort', abort!)
  }
}
