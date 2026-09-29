import { CatbusError } from '../../../core/errors.js'
import { readMedia } from '../../../core/files.js'
import { cookieCredential, finishLogin, loginContext } from '../../../core/login.js'
import * as n from '../../../core/normalize.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus, Media, Message } from '../../../core/schemas.js'
import { history, listen, pushedPayloads } from '../../_shared/impaas.js'
import * as api from './api.js'
import { accessToken, Taobao, taobao } from './client.js'
import { createChatFrame, createdCid, FIRST_CURSOR, imId, openIm, type OutgoingMessage, sendMsgFrame } from './im.js'
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
  const tb = new Taobao(loginContext(ctx, credential))
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
  // 没登录时是一份空凭证，没有 unb
  if (!tb.myId) return off
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

/** 消息记录：在一条连接上往更早翻，输出从旧到新；游标见 _shared/impaas.ts 的 history。 */
export async function msgHistory(ctx: Ctx) {
  const tb = taobao(ctx)
  tb.requireLogin()
  const { cid } = resolveConversation(ctx.args.conversation!, tb.myId)
  return history(ctx, () => openIm(tb), cid, (m) => norm.historyMessage(m, cid))
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

  const im = await openIm(tb)
  try {
    await im.ready()
    let cid = target.cid
    if (cid == null) {
      cid = createdCid(await im.request(createChatFrame(tb.myId, target.encryptUid!)))
      if (!cid) throw new CatbusError('UPSTREAM', '建立会话失败：响应里没有会话 ID')
    }
    let last!: Message
    for (const { media, message } of outgoing) {
      // 照上游（taobao_live.py 的 f"cntaobao{self.nk}"）拼 cookie `_nk_` 的原值，中文昵称也不解码
      const frame = sendMsgFrame(tb.myId, imId(cid), target.peer, IM_DOMAIN + tb.rawNick, message)
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

/** 推送帧里别人发来的聊天消息。 */
function pushedMessages(tb: Taobao, frame: unknown): Message[] {
  const out: Message[] = []
  for (const decoded of pushedPayloads(frame, decrypt, tb.ctx)) {
    const message = norm.pushMessage(decoded)
    if (!message) continue
    // 自己发出的消息（上游按 sender_nick 判断）不输出
    const nick = (decoded as any)?.['1']?.['10']?.sender_nick
    if (message.from?.id === tb.myId || (nick != null && (nick === IM_DOMAIN + tb.rawNick || nick === IM_DOMAIN + tb.nick))) continue
    out.push(message)
  }
  return out
}

export function msgListen(ctx: Ctx) {
  return (async function* () {
    const tb = taobao(ctx)
    tb.requireLogin()
    yield* listen(
      ctx,
      () => openIm(tb, { heartbeat: true }),
      (frame) => pushedMessages(tb, frame),
    )
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
