import { CatbusError } from '../../../core/errors.js'
import { jsonLoads } from '../../../core/py.js'
import type { Socket } from '../../../core/stream.js'
import { type Json, object } from './client.js'

export function packet(raw: string | Buffer): Json {
  try {
    return object(jsonLoads(typeof raw === 'string' ? raw : raw.toString('utf8')))
  } catch {
    throw new CatbusError('UPSTREAM', 'Discord 网关返回了无效 JSON')
  }
}

/** 监测上一条心跳的 ACK。调用方关闭连接后会停止定时器。 */
export function heartbeat(socket: Socket, interval: unknown, firstDelay: number, send: () => Promise<void>, alreadySent = false) {
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0 || interval > 2 ** 31 - 1) {
    throw new CatbusError('UPSTREAM', 'Discord 网关未提供有效的心跳间隔')
  }
  let timer: NodeJS.Timeout
  let awaiting = alreadySent
  let stopped = false
  let failed = false
  const beat = async () => {
    if (stopped) return
    if (awaiting) {
      failed = true
      socket.close()
      return
    }
    awaiting = true
    try {
      await send()
    } catch {
      if (!stopped) {
        failed = true
        socket.close()
      }
      return
    }
    if (!stopped) timer = setTimeout(() => void beat(), interval)
  }
  timer = setTimeout(() => void beat(), firstDelay)
  return {
    ack() { awaiting = false },
    stop() { stopped = true; clearTimeout(timer) },
    get failed() { return failed },
  }
}
