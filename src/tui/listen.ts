import { CatbusError, toCatbusError } from '../core/errors.js'
import { parseDuration } from '../core/options.js'
import type { Command, Platform } from '../core/registry.js'
import { listenable } from './model.js'
import { createHandlerContext, credentialSnapshot, persistCredential, readFileOptions, resolveIdentity, validate } from '../cli/exec.js'
import { resolveNetwork } from '../core/config.js'
import type { Logger } from '../core/log.js'
import { clock, count } from './text.js'

// 监听（live listen / msg listen）的执行与事件整理（AGENTS 4.13）。不含 React。
// handler 返回 AsyncIterable，界面只保留最近的 MAX_EVENTS 条；要录制请用 -o jsonl。

export const MAX_EVENTS = 500

export interface Line {
  /** 单调递增的序号，做列表的 key。 */
  seq: number
  /** 展示用的类型：弹幕、礼物、关注、进场、点赞、消息、其他。 */
  kind: string
  /** 过滤用的原始类型。 */
  type: string
  time: string
  who: string
  text: string
}

const TYPE_LABEL: Record<string, string> = { chat: '弹幕', gift: '礼物', like: '点赞', enter: '进场', follow: '关注', other: '其他' }

/** 事件的标准类型（Event.type），顺序即过滤键 1-5 的顺序。 */
export const EVENT_TYPES = ['chat', 'gift', 'follow', 'enter', 'like'] as const
export type EventType = (typeof EVENT_TYPES)[number]

const isObj = (v: unknown): v is Record<string, any> => v != null && typeof v === 'object' && !Array.isArray(v)

/** Event 或 Message 变成一行。其他形状也能显示，不抛错。 */
export function toLine(value: unknown, seq: number, receivedAt: Date = new Date()): Line {
  const o = isObj(value) ? value : {}
  const isMessage = 'conversation_id' in o
  const type = isMessage ? 'message' : String(o.type ?? 'other')
  const user = o.user ?? o.from
  const who = isObj(user) ? String(user.name ?? user.id ?? '') : ''
  let text = o.text == null ? '' : String(o.text).replace(/\s+/g, ' ')
  if (type === 'gift' && isObj(o.gift)) text = `${o.gift.name} ×${o.gift.count}`
  if (isMessage && !text && Array.isArray(o.media) && o.media.length) text = `[${o.media[0]?.type ?? '媒体'}]`
  if (!text && type === 'follow') text = '关注了主播'
  if (!text && type === 'enter') text = '进入直播间'
  return {
    seq,
    type,
    kind: isMessage ? '消息' : (TYPE_LABEL[type] ?? '其他'),
    time: clock(o.time ?? o.created_at, receivedAt),
    who,
    text,
  }
}

/** 环形缓冲：超过上限丢最旧的。返回新数组（React 状态不可变）。 */
export function pushLine(lines: Line[], line: Line, max = MAX_EVENTS): Line[] {
  const next = lines.length >= max ? lines.slice(lines.length - max + 1) : lines.slice()
  next.push(line)
  return next
}

/** 过滤：hidden 里的类型不显示。消息（私信）不过滤。 */
export function visible(lines: Line[], hidden: ReadonlySet<string>): Line[] {
  return hidden.size === 0 ? lines : lines.filter((l) => !hidden.has(l.type))
}

/** 每分钟事件数的柱状数据：最近 n 分钟，最旧在前。 */
export function perMinute(stamps: number[], nowMs: number, minutes = 6): number[] {
  const out = Array<number>(minutes).fill(0)
  for (const t of stamps) {
    // 事件的时间戳可能比界面里存的 now 新几十毫秒（now 隔几百毫秒才更新），算成负数会被丢掉，所以按 0 算
    const ago = Math.max(0, Math.floor((nowMs - t) / 60_000))
    if (ago < minutes) out[minutes - 1 - ago]!++
  }
  return out
}

export function formatCount(n: number): string {
  return count(n)
}

// ---- 运行 ----

export interface ListenRequest {
  platform: Platform
  command: Command
  words: string[]
  given: Record<string, unknown>
  log: Logger
}

export interface ListenHandle {
  stop(): void
  /** 流结束（用户停止、到时、出错）后兑现；出错时带 error。 */
  done: Promise<{ error: CatbusError | null }>
  /** 到时的时刻（毫秒时间戳）；没设 --duration 为 null。 */
  endsAt: number | null
}

/**
 * 开始监听：handler 的每个事件交给 onEvent。--duration 到时、stop() 都走同一个 AbortSignal，
 * 与 CLI 的 Ctrl-C 一致（dispatch.runStream）。
 */
export async function startListen(req: ListenRequest, onEvent: (value: unknown) => void): Promise<ListenHandle> {
  const { platform, command, log } = req
  const endpoint = 'web' as const
  const ep = platform.endpoints[endpoint]
  if (ep === 'planned') throw new CatbusError('NOT_IMPLEMENTED', `${platform.id} 的 web 端尚未实现`)
  if (!listenable(command)) throw new CatbusError('USAGE', `${command.key} 不是监听命令`)
  const { args, options } = validate(platform, command, req.words, req.given)
  const identity = await resolveIdentity(platform, endpoint, command, args, {}, log)
  await readFileOptions(options)
  const network = await resolveNetwork(platform.id, undefined)
  const handler = await command.handler!()
  const controller = new AbortController()
  const ctx = createHandlerContext({ platform, endpoint, command, args, options, identity, network, log, raw: false, signal: controller.signal })
  const snapshot = credentialSnapshot(ctx.credential, ep)
  const duration = typeof options.duration === 'string' ? parseDuration(options.duration) : null
  const timer = duration ? setTimeout(() => controller.abort(), duration) : null
  const endsAt = duration ? Date.now() + duration : null

  const aborted = new Promise<null>((resolve) => controller.signal.addEventListener('abort', () => resolve(null), { once: true }))
  const done = (async (): Promise<{ error: CatbusError | null }> => {
    const iterator = (handler(ctx) as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next == null || next.done) return { error: null }
        onEvent(next.value)
      }
    } catch (err) {
      return { error: controller.signal.aborted ? null : toCatbusError(err) }
    } finally {
      if (timer) clearTimeout(timer)
      controller.abort()
      // 生成器可能正卡在 await 上，return() 要等它恢复才会完成；不等它，免得界面挂住（与 CLI 一致）
      void Promise.resolve(iterator.return?.()).catch(() => {})
      await persistCredential(ctx.credential, snapshot).catch(() => {})
    }
  })()
  return { stop: () => controller.abort(), done, endsAt }
}
