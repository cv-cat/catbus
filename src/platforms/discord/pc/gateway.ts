import { CatbusError } from '../../../core/errors.js'
import { redact } from '../../../core/log.js'
import { now, random, sleep } from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { openSocket } from '../../../core/stream.js'
import { BROWSER, identity, installationId, type Json, object, ORIGIN, properties, requireToken, snowflake } from './client.js'
import { message } from './normalize.js'
import { heartbeat, packet } from './socket.js'

const GATEWAY = 'wss://gateway.discord.gg/'
const BACKOFF = [1500, 3000, 7000, 15000, 30000]

interface Session {
  id: string | null
  sequence: number | null
  resumeUrl: string | null
}

interface Dispatch {
  event: string
  data: Json
}

function gatewayUrl(base: string | null): string {
  let url: URL
  try {
    url = new URL(base ?? GATEWAY)
  } catch {
    throw new CatbusError('UPSTREAM', 'Discord 网关给出了无效的恢复地址')
  }
  if (url.protocol !== 'wss:' || !/^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname) || url.username || url.password || url.port) {
    throw new CatbusError('UPSTREAM', 'Discord 网关给出了无效的恢复地址')
  }
  url.pathname = '/'
  url.search = '?encoding=json&v=9'
  url.hash = ''
  return url.toString()
}

function gatewayError(code: number | undefined): CatbusError | undefined {
  if (code === 4004) return new CatbusError('AUTH_EXPIRED', 'Discord 网关拒绝了登录态', { hint: '重新执行 catbus discord auth login' })
  if (code != null && [4010, 4011, 4012, 4013, 4014].includes(code)) {
    return new CatbusError('UPSTREAM', 'Discord 网关拒绝了连接参数', { detail: { code } })
  }
}

async function* sessionEvents(ctx: HandlerContext, session: Session, token: string, id: ReturnType<typeof identity>): AsyncIterable<Dispatch> {
  ctx.log.info('正在连接 Discord，等待登录验证…')
  const socket = await openSocket(gatewayUrl(session.resumeUrl), {
    browser: BROWSER, os: 'macos', proxy: ctx.config.proxy ?? undefined, headers: { Origin: ORIGIN }, signal: ctx.signal,
    maxMessageSize: 16 * 1024 * 1024,
  })
  let timer: ReturnType<typeof heartbeat> | undefined
  let lastAck: number | null = null
  const send = (op: number, d: unknown) => socket.send(JSON.stringify({ op, d }))
  const bot = token.startsWith('Bot ')
  const gatewayToken = bot ? token.slice(4) : token
  const installation = installationId(ctx)
  const identify = () => send(2, bot
    ? { token: gatewayToken, intents: ctx.options.intents ?? 0, properties: { os: id.os, browser: 'catbus', device: 'catbus' } }
    : { token: gatewayToken, capabilities: 1734653,
      properties: { ...properties(id), client_app_state: 'focused', is_fast_connect: false, gateway_connect_reasons: ['window-start', 'client-ready'],
        ...(installation ? { installation_id: installation } : {}) },
      presence: { status: 'online', since: 0, activities: [], afk: false }, compress: false, client_state: { guild_versions: {} } })
  const resume = () => send(6, { token: gatewayToken, session_id: session.id, seq: session.sequence })
  const beat = () => send(1, session.sequence)
  // 独立的 HELLO 等待上限使用 Catbus 单请求配置。整个流另由 --duration 或 Ctrl-C 管理。
  const helloDeadline = setTimeout(() => socket.close(), ctx.config.timeout * 1000)
  try {
    for await (const raw of socket.messages) {
      if (ctx.signal.aborted) return
      const event = packet(raw)
      const data = object(event.d)
      if (!timer && event.op !== 10) throw new CatbusError('UPSTREAM', 'Discord 网关首条消息不是 HELLO')
      if (typeof event.s === 'number' && Number.isSafeInteger(event.s) && event.s >= 0) session.sequence = event.s
      switch (event.op) {
        case 10: {
          if (timer) throw new CatbusError('UPSTREAM', 'Discord 网关重复发送了 HELLO')
          clearTimeout(helloDeadline)
          const interval = data.heartbeat_interval
          timer = heartbeat(socket, interval, Number(interval), beat, true)
          await beat()
          if (session.id && session.sequence != null) await resume()
          else await identify()
          break
        }
        case 11: timer?.ack(); lastAck = now(); break
        case 1: await beat(); break
        case 7: return
        case 9:
          if (event.d === true && session.id && session.sequence != null && (lastAck == null || now() - lastAck <= 180_000)) {
            await resume()
          } else {
            session.id = session.resumeUrl = null
            session.sequence = 0
            await identify()
          }
          break
        case 0:
          if (event.t === 'READY') {
            session.id = typeof data.session_id === 'string' ? data.session_id : null
            session.resumeUrl = typeof data.resume_gateway_url === 'string' ? data.resume_gateway_url : null
            ctx.log.info('Discord 连接已就绪，正在接收实时消息。')
          }
          if (event.t === 'RESUMED') ctx.log.info('Discord 连接已恢复，继续接收实时消息。')
          if (typeof event.t === 'string') yield { event: event.t, data }
          break
      }
    }
    if (ctx.signal.aborted) return
    const fatal = gatewayError(socket.closeCode)
    if (fatal) throw fatal
    if (socket.closeCode != null && [4006, 4007, 4009].includes(socket.closeCode)) {
      session.id = session.resumeUrl = null
      session.sequence = null
    }
    if (!timer || timer.failed) throw new CatbusError('NETWORK', timer ? 'Discord 网关心跳超时' : 'Discord 网关未返回 HELLO')
  } finally {
    clearTimeout(helloDeadline)
    timer?.stop()
    socket.close()
  }
}

async function* events(ctx: HandlerContext): AsyncIterable<Dispatch> {
  const token = requireToken(ctx)
  if (ctx.options.intents != null && !token.startsWith('Bot ')) throw new CatbusError('USAGE', '--intents 仅适用于 Bot 凭证')
  const id = identity()
  const session: Session = { id: null, sequence: null, resumeUrl: null }
  const attempts = Number(ctx.options.reconnects ?? 5)
  for (let attempt = 0; !ctx.signal.aborted; attempt++) {
    try {
      yield* sessionEvents(ctx, session, token, id)
    } catch (error) {
      if (ctx.signal.aborted) return
      if (error instanceof CatbusError && error.code !== 'NETWORK') throw error
    }
    if (ctx.signal.aborted) return
    if (attempt >= attempts) throw new CatbusError('NETWORK', 'Discord 网关已达到重连上限')
    ctx.log.info(`Discord 连接中断，正在等待重连（${attempt + 1}/${attempts}）…`)
    await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]! + random() * 250, ctx.signal)
  }
}

export async function* gatewayListen(ctx: HandlerContext) {
  const filter = new Set(String(ctx.options.events ?? '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))
  let remaining = Number(ctx.options.limit ?? Infinity)
  for await (const entry of events(ctx)) {
    if (filter.size && !filter.has(entry.event)) continue
    const { session_id: _session, resume_gateway_url: _resume, ...safe } = entry.data
    yield { event: entry.event, data: redact(safe) }
    if (--remaining === 0) return
  }
}

export async function* msgListen(ctx: HandlerContext) {
  const channel = ctx.options.conversation === undefined ? undefined : snowflake(ctx.options.conversation, '频道 ID')
  let remaining = Number(ctx.options.limit ?? Infinity)
  for await (const entry of events(ctx)) {
    if (entry.event !== 'MESSAGE_CREATE' || (channel && entry.data.channel_id !== channel)) continue
    yield message(entry.data, channel)
    if (--remaining === 0) return
  }
}
