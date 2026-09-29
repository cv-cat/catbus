import { jsonDumps } from '../../../core/py.js'
import { type Frame, impaas } from '../../_shared/impaas.js'
import { accessToken, type Taobao } from './client.js'
import { IM_APP_KEY, IM_DOMAIN, IM_UA, WSS_URL, wsHeaders } from './profile.js'
import { generateMid, generateUuid } from './sign.js'

/**
 * 私信：钉钉 IMPaaS 的 wss 长连（上游 taobao_live.py）。
 * 连接、注册、ack、心跳、翻页与闲鱼共用 _shared/impaas.ts；这里是淘宝的参数和建会话、发消息的帧。
 */

export { FIRST_CURSOR, type ImSocket, mockConnect } from '../../_shared/impaas.js'

const im = impaas<Taobao>({
  url: WSS_URL,
  headers: wsHeaders,
  appKey: IM_APP_KEY,
  ua: IM_UA,
  domain: IM_DOMAIN,
  mid: generateMid,
  token: accessToken,
})

/** `<id>@cntaobao`；plainId 去掉 `@cntaobao` 后缀。 */
export const { imId, plainId, regFrame, ackDiffFrame, heartbeatFrame, listFrame, open: openIm } = im

/** create_chat：用卖家的 encrypt_uid 建单聊会话。 */
export function createChatFrame(myId: string, encryptUid: string): Frame {
  return {
    lwp: '/r/SingleChatConversation/create',
    headers: { mid: generateMid() },
    body: [{ pairFirst: imId(myId), bizType: '11001', ctx: { createConversationCtx: '{"encryptUid":"' + encryptUid + '"}', selfBizDomain: 'taobao' } }],
  }
}

export type OutgoingMessage =
  | { type: 'text'; text: string }
  | { type: 'image'; file_id: unknown; image_url: string; size: unknown; width: number; height: number }

/** send_msg：cid 带 `@cntaobao` 后缀；图片是 base64 的 JSON，放在 custom 里。 */
export function sendMsgFrame(myId: string, cid: string, toId: string, senderNick: string, message: OutgoingMessage): Frame {
  const extension: Frame = { senderBizDomain: 'taobao', receiverBizDomain: 'taobao', sender_nick: senderNick }
  const content: Frame = { contentType: null }
  if (message.type === 'text') {
    content.contentType = 1
    content.text = { extension: { sender_nick: senderNick }, content: message.text }
  } else {
    delete extension.sender_nick
    const data = { fileId: message.file_id, size: message.size, url: message.image_url, width: message.width, height: message.height, isOriginal: 1, suffix: 'png' }
    content.contentType = 101
    content.custom = { type: 7, data: Buffer.from(jsonDumps(data)).toString('base64') }
  }
  return {
    lwp: '/r/MessageSend/sendByReceiverScope',
    headers: { mid: generateMid() },
    body: [
      {
        cid,
        uuid: generateUuid(),
        conversationType: 1,
        redPointPolicy: 0,
        extension,
        content,
        ctx: { senderBizDomain: 'taobao', receiverBizDomain: 'taobao' },
      },
      { actualReceivers: [imId(myId), imId(toId)] },
    ],
  }
}

/** 从 SingleChatConversation/create 的响应里取会话 ID；响应里没有 cid 字段时，在整个 body 里找形如会话 ID 的字符串。 */
export function createdCid(res: Frame): string | null {
  const direct = im.createdCid(res)
  if (direct) return direct
  const m = /"(\d+\.\d+-\d+\.\d+#\d+)(?:@cntaobao)?"/.exec(JSON.stringify(res.body ?? null))
  return m ? m[1]! : null
}
