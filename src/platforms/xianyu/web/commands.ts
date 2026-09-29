import { GUEST } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, freshCredential, loginContext, poll, showQrcode } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Media, Message } from '../../../core/schemas.js'
import { reconnecting } from '../../../core/stream.js'
import { isGuest, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { unsignedMtop, Xianyu, xianyu } from './client.js'
import { createChatFrame, createdCid, FIRST_CURSOR, historyPages, Im, type OutgoingMessage, sendMsgFrame } from './im.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, itemUrl } from './profile.js'
import { resolveConversation, resolveItem, resolveUser } from './resolve.js'
import { decrypt } from './sign.js'

type Ctx = HandlerContext

const isAuthError = (err: unknown) => err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')

/** 常驻进程续期 cookie 的间隔（上游 user_alive 为 600 秒）。 */
const KEEPALIVE_MS = 600_000

// ================================================================ auth

async function completeLogin(ctx: Ctx, x: Xianyu) {
  if (!x.myId) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 里没有 unb', { hint: `catbus xianyu auth login` })
  return finishLogin(ctx, x.ctx.credential, x.me())
}

/** 扫码登录（上游 qrcode_login）。 */
async function qrcodeLogin(ctx: Ctx) {
  const x = new Xianyu({ ...ctx, account: GUEST, credential: freshCredential(ctx, 'qrcode') })
  await x.buildInitialCookies()
  const cna = x.jar.get('cna', COOKIE_DOMAIN) ?? x.jar.get('cna', '.mmstat.com') ?? ''
  const cookie2 = x.jar.get('cookie2', COOKIE_DOMAIN) ?? ''
  await api.miniLogin(x)
  const csrf = x.jar.get('XSRF-TOKEN', 'passport.goofish.com') ?? ''
  const qr = await api.qrGenerate(x, csrf, cookie2)
  await showQrcode(ctx, qr.codeContent, '请用闲鱼 App 扫码（左上角 → 扫一扫）并确认')
  let last = ''
  const token = await poll(
    async () => {
      const d = await api.qrQuery(x, csrf, cookie2, cna, qr)
      const status = String(d.qrCodeStatus ?? '')
      if (status !== last) ctx.log.debug(`扫码状态：${status || '（空）'}`, { keys: Object.keys(d), titleMsg: d.titleMsg ?? null })
      if (status !== last && status === 'SCANNED') ctx.log.info('已扫码，请在手机上确认')
      last = status
      if (status === 'CONFIRMED') return String(d.token ?? d.lgToken ?? '')
      if (status === 'EXPIRED') throw new CatbusError('AUTH_REQUIRED', '二维码已过期', { hint: '重新执行 catbus xianyu auth login' })
      return undefined
    },
    { interval: 3000, timeout: 120_000, what: '扫码' },
  )
  // CONFIRMED 响应的 Set-Cookie 里一般已经有 unb 等登录态；有 token 时再走一次 login.do
  if (token) await api.loginByToken(x, token, cna)
  else if (!x.myId) throw new CatbusError('AUTH_REQUIRED', '扫码超时，未完成登录', { hint: '重新执行 catbus xianyu auth login' })
  // 登录后 _m_h5_tk 会变，空签名调一次 mtop 刷新
  await x.http.request(unsignedMtop('mtop.idle.web.user.page.nav'))
  return completeLogin(ctx, x)
}

export async function authLogin(ctx: Ctx) {
  if (ctx.options.method === 'cookie') {
    const credential = cookieCredential(ctx, COOKIE_DOMAIN)
    const x = new Xianyu(loginContext(ctx, credential))
    const hint = '复制浏览器里登录后的闲鱼 cookie（需要包含 unb、_m_h5_tk、cookie2）'
    if (!x.myId) throw new CatbusError('USAGE', 'cookie 里没有 unb，不是登录后的闲鱼 cookie', { hint })
    try {
      await api.refreshToken(x)
    } catch (err) {
      if (isAuthError(err)) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint })
      throw err
    }
    return completeLogin(ctx, x)
  }
  return qrcodeLogin(ctx)
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const off: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  const x = new Xianyu(ctx)
  if (isGuest(ctx) || !x.myId) return off
  try {
    await api.refreshToken(x)
  } catch (err) {
    if (isAuthError(err)) return off
    throw err
  }
  const expires = ['cookie2', 'sgcookie', 'unb'].map((name) => x.jar.cookies.find((c) => c.name === name)?.expires).find((e) => e != null)
  return { logged_in: true, user: x.me(), method: ctx.credential.method, expires_at: n.time(expires) }
}

// ================================================================ user

export async function userGet(ctx: Ctx) {
  if (ctx.args.user !== 'me') {
    throw new CatbusError('NOT_IMPLEMENTED', 'xianyu 的 user get 只支持 me，查询他人尚未实现', { detail: { upstream: 'none' } })
  }
  const x = await xianyu(ctx)
  x.requireLogin()
  return norm.me((await api.refreshToken(x)).data, x.me())
}

// ================================================================ item

export async function itemGet(ctx: Ctx) {
  const x = await xianyu(ctx)
  const id = await resolveItem(x, ctx.args.item!)
  return norm.item((await api.itemInfo(x, id)).data, x.myId)
}

type Shipping = api.Shipping

export async function itemPublish(ctx: Ctx) {
  const x = await xianyu(ctx)
  x.requireLogin()
  const o = ctx.options as Record<string, any>
  const desc = (o.text ?? o.title) as string | undefined
  if (!desc) throw new CatbusError('USAGE', '闲鱼发布需要 --text（商品描述，同时用作标题）', { hint: 'catbus xianyu item publish --text <描述> --image <图片> --price <元>' })
  if (o.shipping === 'fixed' && o.postage == null) throw new CatbusError('USAGE', '--shipping fixed 需要 --postage（运费，元）')
  // 上游不填价格时（price=None）不看原价
  if (o.originalPrice != null && o.price == null) throw new CatbusError('USAGE', '--original-price 要和 --price 一起用')
  const images = []
  for (const input of (o.image as string[] | undefined) ?? []) {
    const file = await readMedia(x.http, input)
    if (!file.contentType.startsWith('image/')) throw new CatbusError('UNSUPPORTED', `闲鱼只支持上传图片：${input}`)
    images.push(file)
  }
  const price = o.price != null ? { current: Number(o.price), original: Number(o.originalPrice ?? 0) } : null
  const res = await api.publish(x, {
    images,
    desc,
    price,
    shipping: (o.shipping as Shipping) ?? 'free',
    postage: Number(o.postage ?? 0),
    pickup: Boolean(o.pickup),
  })
  const id = n.id(res.data?.itemId ?? res.data?.item?.itemId)
  return n.item(
    {
      id,
      kind: 'goods',
      url: id ? itemUrl(id) : null,
      title: desc,
      text: desc,
      author: x.me(),
      price: price ? n.price(price.current) : null,
      status: 'on_sale',
    },
    res,
  )
}

// ================================================================ msg

/**
 * 消息记录。上游 list_all_conversations 在一条连接上按 nextCursor 一直翻到底；这里也在同一条连接上翻，
 * 翻到 `--limit` 条或（`--all`）没有更多为止，不让 core 每页重新取 token、建连接、注册。
 * 接口从新到旧给；取最新的那些条，再像上游一样反转成从旧到新。`page.cursor` 接着往更早翻。
 */
export async function msgHistory(ctx: Ctx) {
  const x = await xianyu(ctx)
  x.requireLogin()
  const cid = resolveConversation(ctx.args.conversation!)
  const cursor = ctx.cursor ?? FIRST_CURSOR
  if (!/^\d+$/.test(cursor)) throw new CatbusError('USAGE', `--cursor 不对：${cursor}`, { hint: '用上次输出的 page.cursor' })
  const { limit, all } = ctx.options as { limit?: number; all?: boolean }
  // 不带 --limit / --all 时只取一页
  const want = limit ?? (all ? Infinity : 0)
  const im = await Im.open(x)
  try {
    await im.ready()
    let models: any[] = []
    let next: string | null = null
    let more = false
    for await (const page of historyPages(im, cid, cursor)) {
      models.push(...page.models)
      next = page.nextCursor
      more = page.hasMore
      if (models.length >= want) break
    }
    if (want > 0 && models.length > want) {
      // 截在一页中间：游标是消息的 createAt（往更早翻），从保留下来最早的那条接着翻，被截掉的下次还能取到
      models = models.slice(0, want)
      const at = models.at(-1)?.message?.createAt
      if (at != null) {
        next = String(at)
        more = true
      }
    }
    return paged(models.reverse().map((m) => norm.historyMessage(m, cid)), next, more)
  } finally {
    im.close()
  }
}

/** 上传一张图，返回发图片消息要用的字段（上游 make_image 的参数）。 */
async function uploadImage(x: Xianyu, input: string): Promise<{ media: Media; message: OutgoingMessage }> {
  const file = await readMedia(x.http, input)
  if (!file.contentType.startsWith('image/')) throw new CatbusError('UNSUPPORTED', `闲鱼私信只支持图片：${input}`)
  const media = norm.uploaded((await api.uploadMedia(x, file)).object)
  if (!media.url) throw new CatbusError('UPSTREAM', '图片上传没有返回地址')
  return { media, message: { type: 'image', image_url: media.url, width: media.width ?? 0, height: media.height ?? 0 } }
}

/** 找对方时最多往前翻几页（每页 20 条）。 */
const PEER_PAGES = 10

/**
 * 已有会话的对方：照上游 list_all_conversations 在同一条连接上往更早翻，找不是自己发的消息；
 * 自己发的消息带 `extension.receiver` 时也认。都找不到（对方从没回过）就报错，让用户改用 --to。
 */
async function peerOf(im: Im, x: Xianyu, cid: string): Promise<string> {
  let pages = 0
  let more = false
  for await (const page of historyPages(im, cid, FIRST_CURSOR)) {
    for (const model of page.models) {
      const sender = norm.historyMessage(model, cid).from?.id
      const receiver = (model as any)?.message?.extension?.receiver
      for (const id of [sender, receiver == null ? null : String(receiver)]) if (id && id !== x.myId) return id
    }
    more = page.hasMore
    if (++pages >= PEER_PAGES) break
  }
  const where = more ? `最近 ${pages} 页消息` : '全部消息记录'
  throw new CatbusError('USAGE', `会话 ${cid} 的${where}里只有你自己发的消息，确定不了收信人`, {
    hint: '用 --to <对方用户>（可加 --item <商品>）发送',
  })
}

/** 要新建（或取回已有）会话的对方与商品；null 表示发到 --conversation 指定的会话。 */
async function chatTarget(x: Xianyu, o: { to?: string; item?: string }): Promise<{ peer: string; item?: string } | null> {
  if (o.to != null) {
    // 主动发给指定用户（上游 create_chat 不给 item_id 时用写死的默认商品）；带 --item 时就这件商品联系，卖家可以借此联系买家
    const peer = await resolveUser(x, o.to)
    if (peer === x.myId) throw new CatbusError('USAGE', '不能给自己发私信')
    return { peer, ...(o.item != null ? { item: await resolveItem(x, o.item) } : {}) }
  }
  if (o.item == null) return null
  // 只给商品：取商品详情拿卖家
  const id = await resolveItem(x, o.item)
  const seller = norm.item((await api.itemInfo(x, id)).data).author?.id
  if (!seller) throw new CatbusError('UPSTREAM', '商品详情里没有卖家 ID')
  if (seller === x.myId) throw new CatbusError('USAGE', '这是你自己的商品，不能给自己发私信', { hint: '联系买家用 --to <买家> --item <商品>' })
  return { peer: seller, item: id }
}

/**
 * 发私信：
 * - `--to <user>`：建会话（create_chat，默认商品）再发（send_msg）；加 `--item` 时按这件商品建会话；
 * - `--item`：取商品详情拿卖家，建会话，再发；
 * - `--conversation`：发到已有会话，对方从消息记录里找。
 * 文字和图片都有时依次发送，返回最后一条。
 */
export async function msgSend(ctx: Ctx): Promise<Message> {
  const x = await xianyu(ctx)
  x.requireLogin()
  const o = ctx.options as { to?: string; conversation?: string; item?: string; image?: string[]; video?: string }
  if (o.video != null) throw new CatbusError('UNSUPPORTED', '闲鱼私信不支持发视频')
  const chat = await chatTarget(x, o)

  const outgoing: { media: Media[]; message: OutgoingMessage }[] = []
  if (ctx.args.text != null) outgoing.push({ media: [], message: { type: 'text', text: ctx.args.text } })
  for (const input of o.image ?? []) {
    const img = await uploadImage(x, input)
    outgoing.push({ media: [img.media], message: img.message })
  }

  const im = await Im.open(x)
  try {
    await im.ready()
    let cid: string
    let peer: string
    if (chat) {
      const created = createdCid(await im.request(createChatFrame(x.myId, chat.peer, chat.item)))
      if (!created) throw new CatbusError('UPSTREAM', '建立会话失败：响应里没有会话 ID')
      cid = created
      peer = chat.peer
    } else {
      cid = resolveConversation(o.conversation!)
      peer = await peerOf(im, x, cid)
    }
    let last!: Message
    for (const { media, message } of outgoing) {
      const frame = sendMsgFrame(x.myId, cid, peer, message)
      const res = await im.request(frame)
      const b = res.body ?? {}
      last = n.message(
        {
          id: n.id(b.messageId ?? frame.body[0].uuid),
          conversation_id: cid,
          from: x.me(),
          type: message.type,
          text: message.type === 'text' ? message.text : null,
          media,
          created_at: n.time(b.createAt ?? rand.now()),
        },
        res,
      )
    }
    return last
  } finally {
    im.close()
  }
}

/** 推送帧里的聊天消息：syncPushPackage.data[].data 是 base64 + MessagePack；能直接解析成 JSON 的是状态类推送，跳过。 */
export function pushedMessages(x: Xianyu, frame: any): Message[] {
  const out: Message[] = []
  for (const entry of frame?.body?.syncPushPackage?.data ?? []) {
    const data = entry?.data
    if (typeof data !== 'string') continue
    try {
      JSON.parse(data)
      continue
    } catch {}
    let decoded: unknown
    try {
      decoded = JSON.parse(decrypt(data))
    } catch (err) {
      x.ctx.log.debug(`推送解码失败：${(err as Error).message}`)
      continue
    }
    const message = norm.pushMessage(decoded)
    // 自己发出的消息不输出
    if (message && message.from?.id !== x.myId) out.push(message)
  }
  return out
}

/** 登录态失效时不再重连：由重连循环里的连接交出来，在外面抛出。 */
class Fatal {
  constructor(readonly error: unknown) {}
}

export function msgListen(ctx: Ctx) {
  return (async function* () {
    const x = await xianyu(ctx)
    x.requireLogin()
    // 上游 user_alive：常驻时每 10 分钟调一次 refresh_token 续期 cookie
    const keepalive = setInterval(() => {
      api.refreshToken(x).catch((err) => ctx.log.warn(`续期失败：${(err as Error).message}`))
    }, KEEPALIVE_MS)
    keepalive.unref()
    try {
      const stream = reconnecting<Message | Fatal>(ctx, async function* () {
        let im: Im | null = null
        try {
          im = await Im.open(x, { heartbeat: true })
          for await (const frame of im.pushFrames()) yield* pushedMessages(x, frame)
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
    } finally {
      clearInterval(keepalive)
    }
  })()
}

// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const x = await xianyu(ctx)
  x.requireLogin()
  const file = await readMedia(x.http, ctx.args.file!)
  if (!file.contentType.startsWith('image/')) throw new CatbusError('UNSUPPORTED', `闲鱼只支持上传图片：${ctx.args.file}`)
  return norm.uploaded((await api.uploadMedia(x, file)).object)
}
