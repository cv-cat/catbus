import { CatbusError } from '../../core/errors.js'
import type { HeaderPairs } from '../../core/http.js'
import { jsonDumps } from '../../core/py.js'
import * as rand from '../../core/rand.js'
import type { HandlerContext, Page } from '../../core/registry.js'
import { openSocket, reconnecting } from '../../core/stream.js'
import { authError, paged } from '../../core/toolkit.js'

/**
 * 私信：钉钉 IMPaaS 的 wss 长连，闲鱼（上游 goofish_live.py 的 XianyuLive）和淘宝（taobao_live.py）共用。
 *
 * 两个上游的注册、ack、心跳、消息记录翻页逐行相同，只有地址、握手头、app-key、/reg 帧里的 ua、ID 后缀
 * 和生成 mid 的脚本不同，由 {@link ImpaasProfile} 给出；建会话、发消息的帧两边不同，留在各平台的 web/im.ts。
 *
 * 帧是 JSON，用 Python `json.dumps` 的默认格式序列化（上游如此，对拍逐字节比较）。
 * 请求帧带 `headers.mid`，响应回同一个 mid；服务端推送的每一帧都要回 ack。
 */

export type Frame = Record<string, any>

/** 平台会话里长连要用的部分（闲鱼的 Xianyu、淘宝的 Taobao）。 */
export interface ImpaasClient {
  readonly ctx: HandlerContext
  /** /reg 帧的 did。 */
  readonly deviceId: string
  /** 握手头里的 Cookie（上游 get_session_cookies_str）。 */
  cookieString(): string
}

/** 平台差异。 */
export interface ImpaasProfile<C extends ImpaasClient = ImpaasClient> {
  /** wss 地址。 */
  url: string
  /** 握手头：名字、大小写、顺序照抄上游。Host、Connection 由 WebSocket 库自己管，真正连接时去掉。 */
  headers(cookie: string): HeaderPairs
  /** /reg 帧的 app-key。 */
  appKey: string
  /** /reg 帧里的 ua。 */
  ua: string
  /** 用户 ID、会话 ID 的后缀：`<id>@<domain>`。 */
  domain: string
  /** 帧的 mid（各自上游 JS 的 generate_mid）。 */
  mid(): string
  /** 私信的 accessToken（上游 init 里的 get_token，取不到就退出；这里报错）。 */
  token(client: C): Promise<string>
}

/** listUserMessages 的起始游标（JS 的 Number.MAX_SAFE_INTEGER）。 */
export const FIRST_CURSOR = '9007199254740991'
/** 心跳间隔（上游 heart_beat 为 15 秒）。 */
const HEARTBEAT_MS = 15_000
/** 注册后等服务端的 /s/vulcan 推送，超时后照样继续。 */
const READY_MS = 10_000

// ================================================================ 帧（一个函数对应上游的一处构造）

const imId = (p: ImpaasProfile, id: string) => `${id}@${p.domain}`
const plainId = (p: ImpaasProfile, id: unknown) => String(id ?? '').replace(new RegExp(`@${p.domain}$`), '')

/** init 的第一帧：/reg。 */
function regFrame(p: ImpaasProfile, token: string, deviceId: string): Frame {
  return {
    lwp: '/reg',
    headers: {
      'cache-header': 'app-key token ua wv',
      'app-key': p.appKey,
      token,
      ua: p.ua,
      dt: 'j',
      wv: 'im:3,au:3,sy:6',
      sync: '0,0;0;0;',
      did: deviceId,
      mid: p.mid(),
    },
  }
}

/** init 的第二帧：同步位点。 */
function ackDiffFrame(p: ImpaasProfile): Frame {
  const now = rand.now()
  return {
    lwp: '/r/SyncStatus/ackDiff',
    headers: { mid: p.mid() },
    body: [{ pipeline: 'sync', tooLong2Tag: 'PNM,1', channel: 'sync', topic: 'sync', highPts: 0, pts: now * 1000, seq: 0, timestamp: now }],
  }
}

/** heart_beat。 */
function heartbeatFrame(p: ImpaasProfile): Frame {
  return { lwp: '/!', headers: { mid: p.mid() } }
}

/** 收到任何带 headers 的帧都回的 ack（上游 main / list_all_conversations 的循环体）。 */
function ackFrame(p: ImpaasProfile, h: Record<string, unknown>): Frame {
  const ack: Frame = { code: 200, headers: { mid: 'mid' in h ? h.mid : p.mid(), sid: 'sid' in h ? h.sid : '' } }
  for (const key of ['app-key', 'ua', 'dt']) if (key in h) ack.headers[key] = h[key]
  return ack
}

/** list_all_conversations 的请求：一页 20 条，游标从大往小翻。 */
function listFrame(p: ImpaasProfile, cid: string, cursor: string): Frame {
  return { lwp: '/r/MessageManager/listUserMessages', headers: { mid: p.mid() }, body: [imId(p, cid), false, BigInt(cursor), 20, false] }
}

/** 从 SingleChatConversation/create 的响应里取会话 ID（去掉后缀）。 */
function createdCid(p: ImpaasProfile, res: Frame): string | null {
  const direct = res.body?.singleChatConversation?.cid ?? res.body?.cid
  return typeof direct === 'string' && direct ? plainId(p, direct) : null
}

/** 一个平台的 IMPaaS：绑定了平台差异的帧构造与建连。 */
export function impaas<C extends ImpaasClient>(p: ImpaasProfile<C>) {
  return {
    /** 加上后缀：`<id>@<domain>`。 */
    imId: (id: string) => imId(p, id),
    /** 去掉后缀。 */
    plainId: (id: unknown) => plainId(p, id),
    regFrame: (token: string, deviceId: string) => regFrame(p, token, deviceId),
    ackDiffFrame: () => ackDiffFrame(p),
    heartbeatFrame: () => heartbeatFrame(p),
    listFrame: (cid: string, cursor: string) => listFrame(p, cid, cursor),
    createdCid: (res: Frame) => createdCid(p, res),
    /** 连接并注册，见 {@link Im.open}。 */
    open: (client: C, options?: { heartbeat?: boolean }) => Im.open(p, client, options),
  }
}

// ================================================================ 连接

export interface ImSocket {
  send(data: string): Promise<void>
  close(): void
  messages: AsyncIterable<string | Uint8Array>
}

type Connect = (url: string, headers: HeaderPairs, ctx: HandlerContext) => Promise<ImSocket>

const realConnect: Connect = (url, headers, ctx) =>
  openSocket(url, {
    // Host、Connection 由 WebSocket 库自己生成
    headers: headers.filter(([k]) => !/^(host|connection)$/i.test(k)),
    ...(ctx.config.proxy ? { proxy: ctx.config.proxy } : {}),
    signal: ctx.signal,
  })

let connector: Connect = realConnect

/** 替换建立长连的函数，返回恢复函数。只给测试用。 */
export function mockConnect(fn: Connect): () => void {
  const prev = connector
  connector = fn
  return () => {
    connector = prev
  }
}

interface Waiter {
  resolve(frame: Frame): void
  reject(err: unknown): void
}

/** listUserMessages 的一页：消息从新到旧。 */
interface HistoryPage {
  models: unknown[]
  nextCursor: string | null
  hasMore: boolean
}

/** 一条私信长连：注册、ack、按 mid 配对请求与响应、收集推送。 */
export class Im {
  private socket!: ImSocket
  private readonly pending = new Map<string, Waiter>()
  private readonly pushes: Frame[] = []
  private wake: (() => void) | null = null
  private failure: unknown = null
  private closed = false
  private regMid = ''
  private heartbeat: NodeJS.Timeout | null = null
  private readyResolve!: () => void
  private readyReject!: (err: unknown) => void
  private readonly readyPromise = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })

  private constructor(
    private readonly p: ImpaasProfile,
    readonly ctx: HandlerContext,
  ) {
    this.readyPromise.catch(() => {})
  }

  /**
   * 连接并注册（上游 init：先 get_token，再发 /reg 与 ackDiff）。listen 时再发一次心跳，之后每 15 秒一次。
   * 上游先连接再取 token；这里先取 token，登录态无效时不必建连接。
   */
  static async open<C extends ImpaasClient>(p: ImpaasProfile<C>, client: C, options: { heartbeat?: boolean } = {}): Promise<Im> {
    const token = await p.token(client)
    const im = new Im(p, client.ctx)
    im.socket = await connector(p.url, p.headers(client.cookieString()), client.ctx)
    try {
      const reg = regFrame(p, token, client.deviceId)
      im.regMid = reg.headers.mid
      await im.send(reg)
      await im.send(ackDiffFrame(p))
      if (options.heartbeat) {
        await im.send(heartbeatFrame(p))
        im.heartbeat = setInterval(() => void im.send(heartbeatFrame(p)).catch(() => {}), HEARTBEAT_MS)
        im.heartbeat.unref()
      }
    } catch (err) {
      im.close()
      throw err
    }
    void im.read()
    return im
  }

  send(frame: Frame): Promise<void> {
    return this.socket.send(jsonDumps(frame))
  }

  /** 等服务端的 /s/vulcan（上游 list_all_conversations 收到它才发请求）；注册失败时报错。 */
  async ready(): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, READY_MS)))
    try {
      await Promise.race([this.readyPromise, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /** 发请求帧，等同一 mid 的响应；code 不是 200 时报错。 */
  async request(frame: Frame): Promise<Frame> {
    if (this.failure) throw this.failure
    const mid = String(frame.headers.mid)
    const response = new Promise<Frame>((resolve, reject) => this.pending.set(mid, { resolve, reject }))
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(mid)
        reject(new CatbusError('NETWORK', `私信请求超时：${frame.lwp}`, { detail: { kind: 'timeout' } }))
      }, this.ctx.config.timeout * 1000)
    })
    try {
      await this.send(frame)
      const res = await Promise.race([response, timeout])
      if (res.code !== 200) throw this.responseError(frame.lwp, res)
      return res
    } finally {
      clearTimeout(timer)
    }
  }

  /** 取一页消息记录（上游 list_all_conversations 循环里的一次请求）。游标没往前走时按没有更多处理，免得原地打转。 */
  async historyPage(cid: string, cursor: string): Promise<HistoryPage> {
    const body = (await this.request(listFrame(this.p, cid, cursor))).body ?? {}
    const nextCursor = body.nextCursor == null ? null : String(body.nextCursor)
    const hasMore = Number(body.hasMore) === 1 && nextCursor != null && nextCursor !== cursor
    return { models: (body.userMessageModels as unknown[]) ?? [], nextCursor, hasMore }
  }

  /**
   * 在同一条连接上按 nextCursor 往更早翻（上游 list_all_conversations：收到一页就接着发下一页的请求），
   * 直到没有更多；调用方不再需要时提前结束迭代即可。翻页间隔用平台默认值（AGENTS 4.9）。
   */
  async *historyPages(cid: string, cursor: string): AsyncGenerator<HistoryPage> {
    for (;;) {
      const page = await this.historyPage(cid, cursor)
      yield page
      if (!page.hasMore) return
      cursor = page.nextCursor!
      await rand.sleep(this.ctx.platform.pageInterval, this.ctx.signal)
    }
  }

  /** 服务端推送（带 syncPushPackage 的帧），直到连接关闭；连接出错时抛出。 */
  async *pushFrames(): AsyncIterable<Frame> {
    for (;;) {
      while (this.pushes.length) yield this.pushes.shift()!
      if (this.failure) throw this.failure
      if (this.closed) return
      await new Promise<void>((r) => (this.wake = r))
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket?.close()
    this.finish(null)
  }

  private async read(): Promise<void> {
    try {
      for await (const raw of this.socket.messages) {
        let msg: Frame
        try {
          msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'))
        } catch {
          continue
        }
        const h = msg?.headers
        if (h && typeof h === 'object') await this.send(ackFrame(this.p, h)).catch(() => {})
        this.dispatch(msg)
      }
      this.finish(this.closed ? null : new CatbusError('NETWORK', '私信长连接已断开', { detail: { kind: 'connect' } }))
    } catch (err) {
      this.finish(this.closed ? null : err)
    }
  }

  private dispatch(msg: Frame): void {
    if (msg.lwp === '/s/vulcan') this.readyResolve()
    const mid = msg.headers?.mid
    if (mid != null && 'code' in msg) {
      if (mid === this.regMid && msg.code !== 200) {
        // 注册失败（token 无效等）：等待中的请求和推送都以它结束
        const err = this.responseError('/reg', msg)
        this.failure ??= err
        this.readyReject(err)
        this.notify()
        return
      }
      const waiter = this.pending.get(String(mid))
      if (waiter) {
        this.pending.delete(String(mid))
        waiter.resolve(msg)
        return
      }
    }
    if (msg.body?.syncPushPackage) {
      this.pushes.push(msg)
      this.notify()
    }
  }

  private responseError(lwp: string, res: Frame): CatbusError {
    const reason = String(res.body?.reason ?? res.body?.message ?? res.body?.msg ?? '')
    if (res.code === 401) return authError(this.ctx, `私信登录失败：${reason || res.code}`)
    return new CatbusError('UPSTREAM', `私信请求 ${lwp} 失败：${reason || res.code}`, { detail: { code: res.code, body: res.body ?? null } })
  }

  /** 连接结束（主动关闭或断线）：停心跳，等待中的请求和推送都以错误结束。 */
  private finish(err: unknown): void {
    if (err && !this.failure) this.failure = err
    this.closed = true
    // 断线时 read() 先走到这里，之后的 close() 会直接返回，心跳必须在这里停
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    const e = this.failure ?? new CatbusError('NETWORK', '私信长连接已关闭', { detail: { kind: 'connect' } })
    for (const w of this.pending.values()) w.reject(e)
    this.pending.clear()
    this.readyReject(e)
    this.notify()
  }

  private notify(): void {
    const w = this.wake
    this.wake = null
    w?.()
  }
}

// ================================================================ 命令里的共同流程

/**
 * msg history 截在一页中间时的游标：`<这一页的起始游标>+<N>`，续翻时重取这一页、跳过已经输出的 N 条。
 * 与 core 的 `<游标>#skip=N` 同义（cli/dispatch 的 runPaged）；写法不同，是因为 core 见到 `#skip=N` 会自己从结果的
 * 前面丢掉 N 条，而这里的结果是反转过的（从旧到新），要丢的是这一页最新的 N 条，只能由 handler 自己跳过。
 */
const RESUME_RE = /^(\d+)\+(\d+)$/

/**
 * msg history：上游 list_all_conversations 在一条连接上按 nextCursor 一直翻到底；这里也在同一条连接上翻，
 * 翻到 `--limit` 条或（`--all`）没有更多为止，不带时只取一页，不让 core 每页重新取 token、建连接、注册、等 /s/vulcan。
 * 接口从新到旧给；取最新的那些条，再像上游一样反转成从旧到新。`page.cursor` 接着往更早翻。
 */
export async function history<T>(ctx: HandlerContext, open: () => Promise<Im>, cid: string, toMessage: (model: any) => T): Promise<{ data: T[]; page: Page }> {
  const resume = RESUME_RE.exec(ctx.cursor ?? '')
  const cursor = resume ? resume[1]! : (ctx.cursor ?? FIRST_CURSOR)
  if (!/^\d+$/.test(cursor)) throw new CatbusError('USAGE', `--cursor 不对：${ctx.cursor}`, { hint: '用上次输出的 page.cursor' })
  let skip = resume ? Number(resume[2]) : 0
  const { limit, all } = ctx.options as { limit?: number; all?: boolean }
  // 不带 --limit / --all 时只取一页
  const want = limit ?? (all ? Infinity : 0)
  const im = await open()
  try {
    await im.ready()
    const models: unknown[] = []
    const done = (next: string | null | undefined, more: boolean) => paged(models.reverse().map(toMessage), next, more)
    let start = cursor
    let last: HistoryPage | null = null
    for await (const page of im.historyPages(cid, cursor)) {
      const fresh = page.models.slice(skip)
      if (want > 0 && models.length + fresh.length > want) {
        // --limit 截在这一页中间：留下最新的，游标指回这一页的起始，续翻时跳过已经输出的
        const take = want - models.length
        models.push(...fresh.slice(0, take))
        return done(`${start}+${skip + take}`, true)
      }
      models.push(...fresh)
      skip = 0
      last = page
      if (models.length >= want) break
      start = page.nextCursor!
    }
    return done(last?.nextCursor, last?.hasMore ?? false)
  } finally {
    im.close()
  }
}

/** base64 解开后就是 JSON 文本（以 `{` 开头）：会话唤起（contentType 8）等状态推送，不是 MessagePack。 */
function isBase64Json(data: string): boolean {
  const head = Buffer.from(data.slice(0, 8), 'base64')
  return head[0] === 0x7b
}

/**
 * 推送帧里的聊天消息：syncPushPackage.data[].data 是 base64 + MessagePack，用平台的上游 JS 解码成 JSON；
 * 能直接解析成 JSON 的是状态类推送，跳过（上游 handle_message）。base64 里直接是 JSON 的也是状态推送
 * （真机 2026-09-29：建连后会收到一批会话唤起），同样跳过，不当成解码失败。
 */
export function* pushedPayloads(frame: any, decrypt: (data: string) => string, ctx: HandlerContext): Generator<unknown> {
  for (const entry of frame?.body?.syncPushPackage?.data ?? []) {
    const data = entry?.data
    if (typeof data !== 'string') continue
    try {
      JSON.parse(data)
      continue
    } catch {}
    if (isBase64Json(data)) continue
    let decoded: unknown
    try {
      decoded = JSON.parse(decrypt(data))
    } catch (err) {
      ctx.log.debug(`推送解码失败：${(err as Error).message}`)
      continue
    }
    yield decoded
  }
}

const isAuthError = (err: unknown) => err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')

/** 登录态失效时不再重连：由重连循环里的连接交出来，在外面抛出。 */
class Fatal {
  constructor(readonly error: unknown) {}
}

/**
 * msg listen：带心跳的长连（上游 main），断线自动重连；登录态失效时直接抛出，不再重连。
 * messages 从一帧推送里取要输出的消息。
 */
export async function* listen<T>(ctx: HandlerContext, open: () => Promise<Im>, messages: (frame: Frame) => Iterable<T>): AsyncGenerator<T> {
  const stream = reconnecting<T | Fatal>(ctx, async function* () {
    let im: Im | null = null
    try {
      im = await open()
      for await (const frame of im.pushFrames()) yield* messages(frame)
    } catch (err) {
      if (!isAuthError(err)) throw err
      yield new Fatal(err)
    } finally {
      im?.close()
    }
  })
  for await (const item of stream) {
    if (item instanceof Fatal) throw item.error
    yield item
  }
}
