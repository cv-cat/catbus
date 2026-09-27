import { quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { openSocket, type Socket } from '../../../core/stream.js'
import type { Jd } from './client.js'
import { CHAT_ORIGIN, WS_HEADERS } from './profile.js'
import { generateWid } from './util.js'

/**
 * 京东咚咚 WebSocket（上游 jd_apis/jd_chat_ws.py 的 JdChatWS）：纯 JSON 帧，信封由 packing() 生成，
 * aid 必须在顶层；建连后先心跳再欢迎语；心跳 30 秒一次且不带 id。
 */

export const MsgType = {
  CHAT_MESSAGE: 'chat_message',
  CHAT_MESSAGE_RESULT: 'chat_message_result',
  CHAT_SESSION_OPEN: 'chat_session_open',
  CLIENT_HEARTBEAT: 'client_heartbeat',
  EVENT_MESSAGE: 'event_message',
  SYS_MSG: 'sys_msg',
  FAILURE: 'failure',
} as const

export const HOSTS = ['ws1-dd.jd.com', 'ws0-dd.jd.com', 'ws3-dd.jd.com']
const CUSTOMER_APP = 'im.customer'
export const WAITER_APP = 'jd.waiter'
const CLIENT_TYPE = 'comet'
const VER = '4.2'
export const HEARTBEAT_INTERVAL = 30_000

/** 本地时间 `YYYY-MM-DD HH:MM:SS`（datetime.now().strftime）。 */
function localDatetime(ms: number): string {
  const d = new Date(ms)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export class ChatClient {
  readonly url: string
  socket: Socket | null = null

  constructor(
    readonly jd: Jd,
    readonly venderId = '1',
    readonly venderApp = WAITER_APP,
    host = HOSTS[0]!,
  ) {
    const chat = jd.chat
    const params: [string, string][] = [
      ['pin', quote(jd.pin ?? '', '')],
      ['appId', chat.app_id || CUSTOMER_APP],
      ['aid', chat.aid ?? ''],
      ['clientType', chat.client_type || CLIENT_TYPE],
      ['_wid_', generateWid()],
    ]
    this.url = `wss://${host}/?${params.map(([k, v]) => `${k}=${v}`).join('&')}`
  }

  /** 信封（packing）。 */
  packing(type: string, body?: Record<string, unknown> | null, to?: Record<string, unknown>, id?: string): Record<string, unknown> {
    const packet: Record<string, unknown> = {
      from: { app: CUSTOMER_APP, pin: this.jd.pin ?? '', clientType: CLIENT_TYPE },
      datetime: localDatetime(rand.now()),
      ver: VER,
      lang: 'zh_CN',
      aid: this.jd.chat.aid ?? '',
      type,
      to: to ?? { app: this.venderApp },
      timestamp: rand.now(),
    }
    if (type !== MsgType.CLIENT_HEARTBEAT) packet.id = id || rand.uuid4().replaceAll('-', '')
    if (body && Object.keys(body).length) packet.body = body
    return packet
  }

  private chatinfo(pid = '', orderId = ''): Record<string, string> {
    const info: Record<string, string> = { venderId: this.venderId, ct: '3', mt: '51' }
    if (pid) info.pid = pid
    if (orderId) info.orderId = orderId
    return info
  }

  textPacket(text: string, pid = '', orderId = ''): Record<string, unknown> {
    return this.packing(MsgType.CHAT_MESSAGE, { content: text, type: 'text', chatinfo: this.chatinfo(pid, orderId) })
  }

  /** 会话首帧（sendHello）：type=config + cfg.welcome。 */
  helloPacket(pid = '', orderId = ''): Record<string, unknown> {
    let content = `顾客${this.jd.pin}发起咨询`
    if (pid) content += `（商品编号：${pid}）`
    if (orderId) content += `（订单编号：${orderId}）`
    return this.packing(MsgType.CHAT_MESSAGE, {
      content,
      type: 'config',
      chatinfo: this.chatinfo(pid, orderId),
      uniformBizInfo: {},
      action: { code: 'cfg.welcome' },
    })
  }

  /** 心跳发给自己这一侧（to.app = im.customer）。 */
  heartbeatPacket(): Record<string, unknown> {
    return this.packing(MsgType.CLIENT_HEARTBEAT, null, { app: CUSTOMER_APP })
  }

  async connect(signal?: AbortSignal): Promise<Socket> {
    this.socket = await openSocket(this.url, {
      headers: { ...WS_HEADERS, Cookie: this.jd.cookieStr, Origin: CHAT_ORIGIN },
      signal,
    })
    return this.socket
  }

  async send(packet: Record<string, unknown>): Promise<void> {
    await this.socket!.send(JSON.stringify(packet))
  }

  close(): void {
    this.socket?.close()
    this.socket = null
  }
}

/** 下行帧：单个对象或数组。 */
export function packets(raw: string | Buffer): any[] {
  try {
    const v = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
    return Array.isArray(v) ? v : [v]
  } catch {
    return []
  }
}
