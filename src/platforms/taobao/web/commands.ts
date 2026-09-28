import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Media, Message } from '../../../core/schemas.js'
import { reconnecting } from '../../../core/stream.js'
import { isGuest, paged } from '../../../core/toolkit.js'
import * as api from './api.js'
import { accessToken, Taobao, taobao } from './client.js'
import { createChatFrame, createdCid, FIRST_CURSOR, historyPages, Im, imId, type OutgoingMessage, sendMsgFrame } from './im.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN, IM_DOMAIN } from './profile.js'
import { resolveConversation, resolveItem, resolveSellerItem } from './resolve.js'
import { decrypt } from './sign.js'

type Ctx = HandlerContext

const isAuthError = (err: unknown) => err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')

// ================================================================ auth

/** cookie 登录：导入后换一次私信 token 作为校验（上游没有取当前用户的接口）。 */
export async function authLogin(ctx: Ctx) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const tb = new Taobao({ ...ctx, account: 'login', credential })
  const hint = '复制浏览器里登录后的淘宝 cookie（需要包含 unb、_m_h5_tk、cookie2）'
  if (!tb.myId) throw new CatbusError('USAGE', 'cookie 里没有 unb，不是登录后的淘宝 cookie', { hint })
  try {
    await accessToken(tb)
  } catch (err) {
    if (isAuthError(err)) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint })
    throw err
  }
  return finishLogin(ctx, credential, tb.me())
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const off: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  const tb = taobao(ctx)
  if (isGuest(ctx) || !tb.myId) return off
  try {
    await accessToken(tb)
  } catch (err) {
    if (isAuthError(err)) return off
    throw err
  }
  const expires = ['cookie2', 'sgcookie', 'unb'].map((name) => tb.jar.cookies.find((c) => c.name === name)?.expires).find((e) => e != null)
  return { logged_in: true, user: tb.me(), method: ctx.credential.method, expires_at: n.time(expires) }
}

// ================================================================ user

/** 卖家资料：打开商品页取卖家（上游 get_goods_uid_encrypt_uid）。 */
export async function userGet(ctx: Ctx) {
  if (ctx.args.user === 'me') {
    throw new CatbusError('NOT_IMPLEMENTED', 'taobao 的 user get me 尚未实现', { hint: 'catbus taobao auth status', detail: { upstream: 'none' } })
  }
  const tb = taobao(ctx)
  const page = await api.goodsPage(tb, await resolveSellerItem(tb, ctx.args.user!))
  return norm.seller(api.parseSeller(tb, page), page.html)
}

// ================================================================ msg

/**
 * 消息记录。上游 list_all_conversations 在一条连接上按 nextCursor 一直翻到底；这里也在同一条连接上翻，
 * 翻到 `--limit` 条或（`--all`）没有更多为止，不让 core 每页重新取 token、建连接、注册、等 /s/vulcan。
 * 接口从新到旧给；取最新的那些条，再像上游一样反转成从旧到新。`page.cursor` 接着往更早翻。
 */
export async function msgHistory(ctx: Ctx) {
  const tb = taobao(ctx)
  tb.requireLogin()
  const { cid } = resolveConversation(ctx.args.conversation!, tb.myId)
  const cursor = ctx.cursor ?? FIRST_CURSOR
  if (!/^\d+$/.test(cursor)) throw new CatbusError('USAGE', `--cursor 不对：${cursor}`, { hint: '用上次输出的 page.cursor' })
  const { limit, all } = ctx.options as { limit?: number; all?: boolean }
  // 不带 --limit / --all 时只取一页
  const want = limit ?? (all ? Infinity : 0)
  const im = await Im.open(tb)
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
async function uploadImage(tb: Taobao, input: string): Promise<{ media: Media; message: OutgoingMessage }> {
  const file = await readMedia(tb.http, input)
  if (!file.contentType.startsWith('image/')) throw new CatbusError('UNSUPPORTED', `淘宝私信只支持图片：${input}`)
  const res = await api.uploadMedia(tb, file)
  const media = norm.uploaded(res.object)
  return {
    media,
    message: { type: 'image', file_id: res.object.fileId, image_url: res.object.url, size: res.object.size, width: media.width ?? 0, height: media.height ?? 0 },
  }
}

/**
 * 发私信。`--item`：打开商品页取卖家（get_goods_uid_encrypt_uid），建会话（create_chat），再发（send_msg）；
 * `--conversation`：直接发。文字和图片都有时依次发送，返回最后一条。
 */
export async function msgSend(ctx: Ctx): Promise<Message> {
  const tb = taobao(ctx)
  tb.requireLogin()
  const o = ctx.options as { to?: string; conversation?: string; item?: string; image?: string[]; video?: string }
  if (o.video != null) throw new CatbusError('UNSUPPORTED', '淘宝私信不支持发视频')
  if (o.to != null) {
    throw new CatbusError('UNSUPPORTED', '淘宝私信不能直接按用户发送，需要先有会话', {
      hint: '联系卖家用 --item <商品链接>；回复已有会话用 --conversation <会话 ID>',
    })
  }
  let target: { cid: string | null; peer: string; encryptUid?: string }
  if (o.item != null) {
    const seller = api.parseSeller(tb, await api.goodsPage(tb, await resolveItem(tb, o.item)))
    target = { cid: null, peer: seller.uid, encryptUid: seller.encrypt_uid }
  } else target = resolveConversation(o.conversation!, tb.myId)
  if (target.peer === tb.myId) throw new CatbusError('USAGE', '不能给自己发私信')

  const outgoing: { media: Media[]; message: OutgoingMessage }[] = []
  if (ctx.args.text != null) outgoing.push({ media: [], message: { type: 'text', text: ctx.args.text } })
  for (const input of o.image ?? []) {
    const img = await uploadImage(tb, input)
    outgoing.push({ media: [img.media], message: img.message })
  }

  const im = await Im.open(tb)
  try {
    await im.ready()
    let cid = target.cid
    if (cid == null) {
      cid = createdCid(await im.request(createChatFrame(tb.myId, target.encryptUid!)))
      if (!cid) throw new CatbusError('UPSTREAM', '建立会话失败：响应里没有会话 ID')
    }
    let last!: Message
    for (const { media, message } of outgoing) {
      // 上游直接拼 cookie `_nk_` 的原值；中文昵称的 `_nk_` 是转义过的，这里用解码后的昵称（ASCII 昵称两者相同）
      const frame = sendMsgFrame(tb.myId, imId(cid), target.peer, IM_DOMAIN + tb.nick, message)
      const res = await im.request(frame)
      const b = res.body ?? {}
      last = n.message(
        {
          id: n.id(b.messageId ?? frame.body[0].uuid),
          conversation_id: cid,
          from: tb.me(),
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
export function pushedMessages(tb: Taobao, frame: any): Message[] {
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
      tb.ctx.log.debug(`推送解码失败：${(err as Error).message}`)
      continue
    }
    const message = norm.pushMessage(decoded)
    if (!message) continue
    // 自己发出的消息（上游按 sender_nick 判断）不输出
    const nick = (decoded as any)?.['1']?.['10']?.sender_nick
    if (message.from?.id === tb.myId || (nick != null && (nick === IM_DOMAIN + tb.cookie('_nk_') || nick === IM_DOMAIN + tb.nick))) continue
    out.push(message)
  }
  return out
}

/** 登录态失效时不再重连：由重连循环里的连接交出来，在外面抛出。 */
class Fatal {
  constructor(readonly error: unknown) {}
}

export function msgListen(ctx: Ctx) {
  return (async function* () {
    const tb = taobao(ctx)
    tb.requireLogin()
    const stream = reconnecting<Message | Fatal>(ctx, async function* () {
      let im: Im | null = null
      try {
        im = await Im.open(tb, { heartbeat: true })
        for await (const frame of im.pushFrames()) yield* pushedMessages(tb, frame)
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
  })()
}

// ================================================================ media

export async function mediaUpload(ctx: Ctx): Promise<Media> {
  const tb = taobao(ctx)
  tb.requireLogin()
  const file = await readMedia(tb.http, ctx.args.file!)
  if (!file.contentType.startsWith('image/')) throw new CatbusError('UNSUPPORTED', `淘宝只支持上传图片：${ctx.args.file}`)
  return norm.uploaded((await api.uploadMedia(tb, file)).object)
}
