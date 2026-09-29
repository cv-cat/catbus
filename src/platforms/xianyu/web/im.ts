import { CatbusError } from '../../../core/errors.js'
import { jsonDumps } from '../../../core/py.js'
import { type Frame, impaas } from '../../_shared/impaas.js'
import { getToken } from './api.js'
import type { Xianyu } from './client.js'
import { IM_APP_KEY, IM_DOMAIN, IM_UA, WSS_URL, wsHeaders } from './profile.js'
import { generateMid, generateUuid } from './sign.js'

/**
 * 私信：钉钉 IMPaaS 的 wss 长连（上游 goofish_live.py 的 XianyuLive）。
 * 连接、注册、ack、心跳、翻页与淘宝共用 _shared/impaas.ts；这里是闲鱼的参数和建会话、发消息的帧。
 */

export { FIRST_CURSOR, type ImSocket, mockConnect } from '../../_shared/impaas.js'

/** 私信的 accessToken（上游 init 里取不到就退出）。 */
async function accessToken(x: Xianyu): Promise<string> {
  const res = await getToken(x)
  const token = res.data?.accessToken
  if (!token) throw new CatbusError('UPSTREAM', '获取私信 token 失败', { detail: { ret: res.ret ?? null } })
  return token
}

const im = impaas<Xianyu>({
  url: WSS_URL,
  headers: wsHeaders,
  appKey: IM_APP_KEY,
  ua: IM_UA,
  domain: IM_DOMAIN,
  mid: generateMid,
  token: accessToken,
})

/** plainId 去掉 `@goofish` 后缀。 */
export const { plainId, regFrame, ackDiffFrame, heartbeatFrame, listFrame, createdCid, open: openIm } = im
const { imId } = im

/** create_chat 的 item_id 默认值（上游写死）：只给对方用户、不指定商品时用它建会话。 */
export const DEFAULT_ITEM_ID = '891198795482'

/** create_chat：按商品和对方建单聊会话（已有时返回原会话）。 */
export function createChatFrame(myId: string, toId: string, itemId = DEFAULT_ITEM_ID): Frame {
  return {
    lwp: '/r/SingleChatConversation/create',
    headers: { mid: generateMid() },
    body: [
      {
        pairFirst: imId(toId),
        pairSecond: imId(myId),
        bizType: '1',
        extension: { itemId },
        ctx: { appVersion: '1.0', platform: 'web' },
      },
    ],
  }
}

export type OutgoingMessage = { type: 'text'; text: string } | { type: 'image'; image_url: string; width: number; height: number }

/** send_msg：内容是 base64 的 JSON，放在 custom 里（文字 type 1，图片 type 2）。 */
export function sendMsgFrame(myId: string, cid: string, toId: string, message: OutgoingMessage): Frame {
  const payload =
    message.type === 'text'
      ? { contentType: 1, text: { text: message.text } }
      : { contentType: 2, image: { pics: [{ type: 0, url: message.image_url, width: message.width, height: message.height }] } }
  return {
    lwp: '/r/MessageSend/sendByReceiverScope',
    headers: { mid: generateMid() },
    body: [
      {
        uuid: generateUuid(),
        cid: imId(cid),
        conversationType: 1,
        content: { contentType: 101, custom: { type: payload.contentType, data: Buffer.from(jsonDumps(payload)).toString('base64') } },
        redPointPolicy: 0,
        extension: { extJson: '{}' },
        ctx: { appVersion: '1.0', platform: 'web' },
        mtags: {},
        msgReadStatusSetting: 1,
      },
      { actualReceivers: [imId(toId), imId(myId)] },
    ],
  }
}
