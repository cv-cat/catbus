import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../src/platforms/xhs/web/api.js'
import { Creator, PyFloat, pyJson } from '../src/platforms/xhs/web/creator.js'
import * as capi from '../src/platforms/xhs/web/creator-api.js'
import { CreatorLogin } from '../src/platforms/xhs/web/creator-api.js'
import { Pc, resetXraySeq } from '../src/platforms/xhs/web/client.js'
import * as login from '../src/platforms/xhs/web/login.js'
import * as norm from '../src/platforms/xhs/web/normalize.js'
import { EDITH } from '../src/platforms/xhs/web/profile.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { pyRound } from '../src/core/py.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as push from '../src/platforms/xhs/web/push.js'
import { newCredential, readCredential, setCurrent, writeCredential } from '../src/core/auth-store.js'
import { parseCookieInput } from '../src/core/cookies.js'
import { expectRequests, type GoldenRequest, loadCase, makeCtx, normalize, replay } from './golden.js'
import { cli, useTempHome } from './helpers.js'

/**
 * RWP 长连的替身：设置了 rwpReply 时 openSocket 不联网，按发出的每一帧回复（rwpReply 返回要推回来的帧）。
 * 没设置时用真的 openSocket（测试默认禁止联网，不会被用到）。
 */
const rwpSent: any[] = []
let rwpReply: ((frame: any) => any[]) | null = null
vi.mock('../src/core/stream.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/core/stream.js')>()
  return {
    ...orig,
    openSocket: async (url: string, options: any) => {
      if (!rwpReply) return orig.openSocket(url, options)
      const reply = rwpReply
      const queue: string[] = []
      let wake: (() => void) | null = null
      let closed = false
      const poke = () => {
        const w = wake
        wake = null
        w?.()
      }
      options?.signal?.addEventListener('abort', () => ((closed = true), poke()), { once: true })
      return {
        send: async (d: string) => {
          const f = JSON.parse(String(d))
          rwpSent.push(f)
          queue.push(...reply(f).map((x) => JSON.stringify(x)))
          poke()
        },
        close: () => ((closed = true), poke()),
        messages: {
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (queue.length) yield queue.shift()!
              if (closed) return
              await new Promise<void>((r) => (wake = r))
            }
          },
        },
      }
    },
  }
})

/** 与 scripts/golden/xhs/gen.py 相同的假凭证。 */
const XRAY_SEQ = 1000
const USER_ID = '5f0000000000000000000001'
const OTHER = '5f0000000000000000000002'
const A1 = '19a0c4506c7fakea1fakea1fakea1fakea1fakea150000123456'
const TIGA0 = '0'.repeat(64)
const PC_COOKIES =
  'abRequestId=fake-ab-request-id; ets=1789999990000; webBuild=6.47.2; xsecappid=xhs-pc-web; ' +
  `loadts=1789999990123; a1=${A1}; webId=0123456789abcdef0123456789abcdef; gid=fake-gid-value; ` +
  `websectiga=${TIGA0}; sec_poison_id=00000000-0000-0000-0000-000000000000; web_session=fake-web-session; acw_tc=fake-acw`
const CREATOR_COOKIES =
  `abRequestId=fake-ab-request-id; ets=1789999990000; a1=${A1}; webId=0123456789abcdef0123456789abcdef; ` +
  'gid=fake-gid-value; customer-sso-sid=fake-sso; x-user-id-creator.xiaohongshu.com=5f0000000000000000000001; ' +
  'customerClientId=fake-client; access-token-creator.xiaohongshu.com=fake-creator-token; ' +
  'galaxy_creator_session_id=fake-galaxy; galaxy.creator.beaker.session.id=fake-beaker; web_session=fake-web-session; ' +
  `webBuild=1.26.0; xsecappid=ugc; websectiga=${TIGA0}; sec_poison_id=00000000-0000-0000-0000-000000000000; loadts=1789999990123`
const NOTE_ID = '6a3b5a0b000000002103ee67'
const ROOM = '570443028306756154'
const GROUP_ID = '6612345678901234567'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==', 'base64')
/** 与 gen.py 的 ACK_BODY 相同：ChatACK{mid=mid-1, messageid=msg-9, ts}。 */
const ACK = Buffer.concat([Buffer.from([0x0a, 5]), Buffer.from('mid-1'), Buffer.from([0x12, 5]), Buffer.from('msg-9'), Buffer.from([0x18, 0xc8, 0x81, 0xa4, 0xa3, 0x88, 0x34])])

/** 登录态：cookie 放进指定 scope（创作者中心是 creator）。 */
function ctxWith(cookies: string, scope = 'main') {
  const ctx = makeCtx({ platform: 'xhs' })
  ctx.credential.user = { id: USER_ID, name: '测试用户', url: null }
  ctx.credential.scopes[scope] = { cookies: makeCtx({ platform: 'xhs', cookies, cookieDomain: '.xiaohongshu.com' }).credential.scopes.main!.cookies, tokens: {} }
  return ctx
}

const pc = <T>(fn: (p: Pc) => Promise<T>) => async () => {
  resetXraySeq(XRAY_SEQ)
  return fn(new Pc(ctxWith(PC_COOKIES)))
}
const creator = <T>(fn: (c: Creator) => Promise<T>) => async () => {
  resetXraySeq(XRAY_SEQ)
  return fn(new Creator(ctxWith(CREATOR_COOKIES, 'creator')))
}

async function anonymous(): Promise<Pc> {
  resetXraySeq(XRAY_SEQ)
  const p = new Pc(makeCtx({ platform: 'xhs', account: 'guest' }))
  await login.initAnonymous(p)
  return p
}

/** 用例名 → TS 侧的等价调用。 */
const CASES: Record<string, () => Promise<unknown>> = {
  guest_init: async () => {
    const p = await anonymous()
    await login.webprofile(p)
    return p.shared()
  },
  creator_from_pc: async () => {
    resetXraySeq(XRAY_SEQ)
    const ctx = ctxWith(PC_COOKIES)
    // gen.py 先建了 XHSPcAuth（消耗一次 tab 设备 ID 的 uuid4），再桥接
    new Pc(ctx)
    const c = await capi.creatorFromPc(ctx)
    return c.shared()
  },
  login_qrcode: async () => {
    const p = await anonymous()
    const qr = await login.qrcodeCreate(p)
    await login.qrcodeStatus(p, qr.qrId, qr.code)
    await login.webprofile(p)
    await login.qrcodeFinish(p, qr.qrId, qr.code)
    return login.loginUserMe(p)
  },
  login_sms: async () => {
    const p = await anonymous()
    await login.webprofile(p)
    await login.sendSmsCode(p, '13800000000')
    await login.smsLoginCode(p, '13800000000', '123456')
    return login.loginUserMe(p)
  },

  pc_note_info: pc((p) => api.noteInfo(p, NOTE_ID, 'FAKEtoken=', 'pc_feed')),
  pc_user_me: pc((p) => api.userMe(p)),
  pc_user_info: pc((p) => api.userInfo(p, OTHER)),
  pc_user_notes: pc((p) => api.userNotes(p, OTHER, 'cur1', 'tok', 'pc_feed')),
  pc_user_likes: pc((p) => api.userLikes(p, OTHER, '', 'tok', 'pc_user')),
  pc_user_collects: pc((p) => api.userCollects(p, OTHER, '', '', 'pc_search')),
  pc_homefeed_category: pc((p) => api.homefeedCategories(p)),
  pc_homefeed: pc((p) => api.homefeed(p, 'homefeed_recommend', '', 1, 0)),
  pc_homefeed_p2: pc((p) => api.homefeed(p, 'homefeed.fashion_v3', '1.79e+18', 3, 20)),
  pc_search_notes: pc((p) => api.searchNotes(p, '咖啡 探店', 2, 'time_descending', 1, '2fixedsearchid')),
  pc_search_users: pc((p) => api.searchUsers(p, '咖啡', 2)),
  pc_comments: pc((p) => api.comments(p, NOTE_ID, 'c1', 'FAKEtoken=')),
  pc_sub_comments: pc((p) => api.subComments(p, NOTE_ID, 'cm1', 'c2', 'FAKEtoken=')),
  pc_unread: pc((p) => api.unreadCount(p)),
  pc_mentions: pc((p) => api.youMessages(p, 'mentions', '')),
  pc_likes: pc((p) => api.youMessages(p, 'likes', 'x1')),
  pc_connections: pc((p) => api.youMessages(p, 'connections', '')),
  pc_trending: pc((p) => api.trendingQueries(p)),
  pc_boards: pc((p) => api.userBoards(p, OTHER, 2)),
  pc_note_video: pc((p) => api.noteVideo(p, NOTE_ID)),
  pc_search_keyword: pc((p) => api.searchKeyword(p, '咖啡 拿铁')),
  pc_search_notes_time: pc(async (p) => [
    await api.searchNotes(p, '咖啡', 1, 'time_descending', 2, '2fixedsearchid', 1),
    await api.searchNotes(p, '咖啡', 2, 'general', 0, '2fixedsearchid', 3),
  ]),

  im_categories_edith: pc((p) => api.liveRequest(p, EDITH, '/api/sns/red/live/web/feed/category')),
  live_room_info: pc((p) => api.liveRoomInfo(p, ROOM, USER_ID)),
  live_square: pc((p) => api.liveSquare(p, 'hot')),
  live_gift_panel: pc((p) => api.liveGiftPanel(p, 'host1', ROOM)),
  live_business: pc((p) => api.liveBusiness(p, ROOM, 'host1')),
  live_send_comment: pc((p) => api.liveSendComment(p, ROOM, '主播好', 'host1')),
  im_chats: pc((p) => api.chats(p)),
  im_history: pc((p) => api.messageHistory(p, OTHER, 99)),
  im_celestial: pc((p) => api.celestialLt(p)),
  im_read: pc((p) => api.markRead(p, [{ chat_id: OTHER, read_store_id: 7, unread_count: 1, type: 1, need_rm_offline: true }])),
  im_revoke: pc((p) => api.revokeMessage(p, { chat_user_id: OTHER, message_id: 'm1' })),
  im_delete: pc((p) => api.deleteMessage(p, [['chat_user_id', OTHER]])),
  im_following: pc((p) => api.following(p)),
  im_group_chats: pc((p) => api.groupChats(p)),
  im_group_history: pc((p) => api.groupMessageHistory(p, GROUP_ID, 99)),

  creator_user_info: creator((c) => capi.userInfo(c)),
  creator_posted: creator(async (c) => [await capi.postedNotes(c, 0), await capi.postedNotes(c, 1, 0, true)]),
  creator_topic: creator((c) => capi.searchTopic(c, '旅行')),
  creator_poi: creator((c) => capi.searchPoi(c, '上海')),
  creator_permit: creator((c) => capi.uploadPermit(c, 'image')),
  creator_upload: creator((c) => capi.uploadMedia(c, PNG, 'image')),
  creator_transcode: creator((c) => capi.queryTranscode(c, 'vid1')),
  creator_encryption: creator((c) => capi.fileEncryption(c, 'fid1')),
  creator_post_note: creator(async (c) => {
    const up = await capi.uploadMedia(c, PNG, 'image')
    const data = capi.imageNoteData({ title: '标题', desc: '正文', postTime: null, postLoc: null, privacy: 1 }, [
      { fileId: up.fileId, width: 3, height: 2, size: PNG.length, mimeType: 'image/png' },
    ])
    return capi.postNote(c, data)
  }),
  creator_post_video: creator(async (c) => {
    // 视频是用例的输入；封面是上游用 opencv 截的首帧（第二次上传的内容），catbus 由 --cover 给出
    const golden = loadCase('xhs', 'creator_post_video')
    const video = Buffer.from(golden.input.video, 'base64')
    const cover = Buffer.from((golden.requests[4]!.body as { base64: string }).base64, 'base64')
    const data = await capi.videoNoteData(c, { title: '标题', desc: '正文', postTime: null, postLoc: null, privacy: 1 }, video, cover)
    return capi.postNote(c, data)
  }),
  creator_login: async () => {
    resetXraySeq(XRAY_SEQ)
    const l = new CreatorLogin(new Creator(makeCtx({ platform: 'xhs', account: 'guest' })))
    await l.initCookies()
    await l.bootstrap()
    await l.probeSession()
    await l.completeSecurity()
    await l.qrcode()
    await l.qrcodeStatus('fake-cqr')
    await l.sendCode('13800000000')
    await l.loginByCode('13800000000', '123456')
    return l.userInfo()
  },

}

describe('xhs 对拍：请求构造与签名', () => {
  for (const [name, run] of Object.entries(CASES)) {
    it(name, async () => {
      const c = loadCase('xhs', name)
      const { requests, error } = await replay(c, run)
      if (error) expectRequests(requests, c.requests.slice(0, requests.length))
      if (error) throw error
      expectRequests(requests, c.requests)
    })
  }
})

describe('xhs 对拍：命令流程', () => {
  it('游客 item get：匿名设备初始化（安全程序 → websectiga → 访客会话 → gid）后取笔记详情', async () => {
    const c = loadCase('xhs', 'guest_item_get')
    const { itemGet } = await import('../src/platforms/xhs/web/commands.js')
    const ctx = makeCtx({ platform: 'xhs', account: 'guest', args: { item: c.input.url } })
    resetXraySeq(XRAY_SEQ)
    const { requests, result, error } = await replay(c, () => itemGet(ctx))
    if (error) expectRequests(requests, c.requests.slice(0, requests.length))
    if (error) throw error
    expectRequests(requests, c.requests)
    expect((result as any)[RAW]).toEqual(c.result.data.items[0])
    expect(result).toMatchObject({
      id: NOTE_ID,
      kind: 'image',
      url: `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=FAKEtoken%3D&xsec_source=pc_feed`,
      title: '测试笔记',
      author: { id: '5f0000000000000000000003', name: '作者' },
      stats: { likes: 12000, comments: 34, collects: 56, shares: 7 },
      media: [{ type: 'image', width: 1080, height: 1440 }],
    })
    // 访客会话与签名状态留在游客凭证里，下次直接复用
    const names = ctx.credential.scopes.main!.cookies.map((x) => x.name)
    expect(names).toEqual(expect.arrayContaining(['a1', 'webId', 'websectiga', 'sec_poison_id', 'web_session', 'gid']))
    expect((ctx.credential.device.pc as any).local.webSsk).toBeTruthy()
  })
})

describe('xhs 纯算', () => {
  it('RWP 长连的帧与 IM protobuf', () => {
    const c = loadCase('xhs', 'rwp_frames')
    const r = c.result
    const restore = deterministic({ seed: c.seed, now: c.now })
    try {
      // gen.py 先建了 XHSPcAuth（消耗一次 tab 设备 ID 的 uuid4）
      new Pc(ctxWith(PC_COOKIES))
      const id = { uid: USER_ID, sid: 'fake-sid', deviceId: 'fake-device', fingerprint: '1790000000123' }
      expect(push.handshakeFrame(id)[0]).toBe(r.handshake)
      expect(push.registerFrame('im', 'protobuf')).toBe(r.register)
      expect(push.joinRoomFrame(ROOM)).toBe(r.join)
      expect(push.stateSyncFrame()).toBe(r.state_sync)
      expect(push.heartbeatFrame()).toBe(r.heartbeat)
      expect(push.viewerHeartFrame(ROOM, { nickname: 'n', avatar: 'a', user_id: USER_ID, role: 0 })).toBe(r.viewer_heart)
      const chat = push.encodeChatMessage({ mid: 'mid-1', ts: 1790000000123, sender: USER_ID, receiver: OTHER, content: '你好 hi', contentType: 1 })
      expect(Buffer.from(chat).toString('base64')).toBe(r.chat)
      expect(push.imFrame(chat)).toBe(r.im_frame)
      expect(push.roomTextFrame({ roomId: ROOM, nickname: 'n', avatar: 'a', userId: USER_ID, content: '主播好 hi' })[0]).toBe(r.room_text)
    } finally {
      restore()
    }
    const ack = push.decodeImFrame({ b: { a: { b: Buffer.concat([Buffer.from([0x2a]), Buffer.from([ACK.length]), ACK]).toString('base64') } } })[0]!.ack!
    const want = r.ack.chatACK
    expect({ mid: ack.mid, messageid: ack.messageId, ts: ack.ts, code: ack.code, msg: ack.msg }).toEqual({ mid: want.mid, messageid: want.messageid, ts: want.ts, code: want.code, msg: want.msg })
    const room = push.decodeRoomPush(r.room_frame)
    expect(room).toEqual(r.room.map((e: any) => e.payload))
  })

  it('无水印图片地址', () => {
    const urls = [
      'https://sns-webpic-qc.xhscdn.com/202609/abc/notes_pre_post/1040g2abc!nd_dft_wlteh_webp_3',
      'https://sns-webpic-qc.xhscdn.com/202609/abc/spectrum/1040g0k0abc!nd_dft_wgth_webp_3',
      'https://sns-img-hw.xhscdn.com/a/b/c.jpg?imageView2',
      'https://sns-webpic-qc.xhscdn.com/202609/abc/1040g008xyz!nd_dft',
    ]
    expect(urls.map(api.noWaterImage)).toEqual(loadCase('xhs', 'pc_no_water_img').result)
  })

  it('视频地址：新版 Web 的编码名混淆成 EF4 / EF5，按 h264 → EF4 → h265 → EF5 → 其余的顺序取第一个有地址的流', () => {
    const video = (stream: any) =>
      norm.note({ id: 'n1', note_card: { note_id: 'n1', type: 'video', video: { media: { video_id: 1, stream } } } }).media[0]?.url
    expect(video({ EF5: [{ master_url: 'https://v/h265' }], EF4: [{ master_url: 'https://v/h264' }] })).toBe('https://v/h264')
    expect(video({ h264: [], EF4: [{ master_url: '', backup_urls: ['https://v/backup'] }] })).toBe('https://v/backup')
    expect(video({ EF9: [{ url: 'https://v/other' }] })).toBe('https://v/other')
  })
})

describe('xhs 登录的风控', () => {
  it('扫码确认后 qrcode/status 回 471（响应体仍是 success）：报 RISK_CONTROL（captcha），提示改用 cookie 登录', async () => {
    const c = structuredClone(loadCase('xhs', 'login_qrcode'))
    c.responses[13] = { status: 471, headers: { verifytype: '124', verifyuuid: 'u-1' }, body: { code: 0, success: true, msg: '成功', data: {} } }
    const { error } = await replay(c, CASES.login_qrcode!)
    expect(error).toMatchObject({
      code: 'RISK_CONTROL',
      hint: expect.stringContaining('--method cookie'),
      detail: { kind: 'captcha', status: 471, verify_type: '124', verify_uuid: 'u-1' },
    })
  })

  it('游客初始化的 webprofile 回 461：报 RISK_CONTROL（captcha），不再当成「没换到 gid」', async () => {
    const c = structuredClone(loadCase('xhs', 'guest_init'))
    c.responses[10] = { status: 461, headers: { verifytype: '102' }, body: { code: 0, success: true, data: {} } }
    const { error } = await replay(c, CASES.guest_init!)
    expect(error).toMatchObject({ code: 'RISK_CONTROL', hint: expect.stringContaining('--method cookie'), detail: { kind: 'captcha', status: 461, verify_type: '102' } })
  })

  it('创作者中心登录：service-ticket 回 471、qr-code 轮询回 461 都报 RISK_CONTROL；qr-code 创建回 406 按设备闸门返回 null（重建再试）', async () => {
    const at = (i: number, status: number) => {
      const c = structuredClone(loadCase('xhs', 'creator_login'))
      c.responses[i] = { status, headers: { verifytype: '124', verifyuuid: 'u-1' }, body: { code: 0, success: true, msg: '成功', data: {} } }
      return c
    }
    const ticket = await replay(at(12, 471), CASES.creator_login!)
    expect(ticket.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha', status: 471, verify_type: '124', verify_uuid: 'u-1' } })
    const status = await replay(at(10, 461), CASES.creator_login!)
    expect(status.error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha', status: 461 } })

    const gated = await replay(at(9, 406), async () => {
      resetXraySeq(XRAY_SEQ)
      const l = new CreatorLogin(new Creator(makeCtx({ platform: 'xhs', account: 'guest' })))
      await l.initCookies()
      await l.bootstrap()
      await l.probeSession()
      await l.completeSecurity()
      return l.qrcode()
    })
    if (gated.error) throw gated.error
    expect(gated.result).toBeNull()
  })
})

describe('xhs 归一化（真实响应的结构）', () => {
  it('会话列表：user_id 是自己，对方是 chat_user_id，昵称在 info 里', async () => {
    const { conversationOf } = await import('../src/platforms/xhs/web/commands.js')
    const raw = {
      user_id: USER_ID,
      chat_user_id: OTHER,
      last_msg_time: 1790180200000,
      update_time: 1790296687000,
      last_msg_content: '在吗',
      info: { nickname: '对方', user_name: '对方', avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/x.jpg' },
    }
    expect(conversationOf(raw)).toMatchObject({
      id: OTHER,
      peer: { id: OTHER, name: '对方' },
      last_message: '在吗',
      updated_at: '2026-09-24T00:16:40+08:00',
    })
  })

  it('消息记录：content 是 JSON 字符串，正文与 content_type 都在里面', async () => {
    const { messageOf } = await import('../src/platforms/xhs/web/commands.js')
    const raw = (content_type: number, content: string) => ({
      id: `${OTHER}.${USER_ID}.1eab3fb674f8478`,
      sender_id: USER_ID,
      receiver_id: OTHER,
      created_at: 1790180199513,
      store_id: 9,
      content: JSON.stringify({ content, content_type, front_chain: content }),
    })
    expect(messageOf(raw(1, '在吗'), OTHER, USER_ID)).toMatchObject({
      id: `${OTHER}.${USER_ID}.1eab3fb674f8478`,
      conversation_id: OTHER,
      from: { id: USER_ID },
      type: 'text',
      text: '在吗',
    })
    expect(messageOf(raw(2, '[图片]'), OTHER, USER_ID).type).toBe('image')
  })
})

// ================================================================ 命令的单元测试（假的 HTTP 响应，不比对请求字节）

import * as cmd from '../src/platforms/xhs/web/commands.js'

const DSL = '1789999980000'
const PC_DS_JS = `function getdss() { return '${DSL}'; };\nvar _0x1=[];\n`
const CREATOR_DS_JS =
  `function getdss() { return '${DSL}'; };\nvar __$c='00';\n` +
  'var _dsf = function (k, b) { var o = []; for (var i = 0; i < 16; i++) o.push((b[i] * 31 + b[23 - i] + i) & 255); return o; };\n'
/** 与 gen.py 的 SEC_PROGRAM 相同：执行后回调固定的 websectiga。 */
const SEC_PROGRAM = `function _p(){return function(w,o){w.seccallback(o.v)}}_p()(window,{v:'${'ab'.repeat(32)}'});/*${'x'.repeat(1100)}*/`

type Reply = { status?: number; headers?: [string, string][]; body: unknown } | undefined
const ok = (data: unknown = {}, extra: Record<string, unknown> = {}): NonNullable<Reply> => ({ body: { code: 0, success: true, msg: '成功', data, ...extra } })
const fail = (code: number, msg: string): NonNullable<Reply> => ({ body: { code, success: false, msg, data: {} } })
const jsonBody = (r: GoldenRequest) => (typeof r.body === 'string' ? JSON.parse(r.body) : null)

/** 按 URL 回复（没匹配到的回 success），返回发出的请求。 */
async function serve<T>(route: (req: GoldenRequest) => Reply, run: () => Promise<T>) {
  const requests: GoldenRequest[] = []
  const restore = mockSender((p) => {
    const req = normalize(p)
    requests.push(req)
    const r = route(req) ?? ok()
    return fakeResponse(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers, url: p.url })
  })
  try {
    return { requests, result: await run(), error: undefined as any }
  } catch (error) {
    return { requests, result: undefined, error: error as any }
  } finally {
    restore()
  }
}

/** 主站与创作者中心的签名 / 安全初始化接口（与 gen.py 的 respond 相同）。 */
function security(req: GoldenRequest): Reply {
  const url = req.url
  if (url.includes('/api/sec/v1/ds?appId=xhs-pc-web')) return { body: PC_DS_JS }
  if (url.includes('/api/sec/v1/ds?appId=ugc')) return { body: CREATOR_DS_JS }
  if (url.startsWith('https://creator.xiaohongshu.com/publish/publish')) return { body: '<html></html>' }
  if (url.includes('/api/sec/v1/scripting')) {
    const b = jsonBody(req) ?? {}
    return b.type === 'ds' ? ok({ data: b.appId === 'xhs-pc-web' ? PC_DS_JS : CREATOR_DS_JS }) : ok({ secPoisonId: '11111111-2222-3333-4444-555555555555', data: SEC_PROGRAM })
  }
  if (url.includes('/api/sec/v1/shield/webprofile')) return { headers: [['set-cookie', `gid=${'g'.repeat(72)}; Domain=.xiaohongshu.com; Path=/`]], body: { code: 0, success: true, data: {} } }
  return undefined
}

/** 主站登录态（main scope），args / options 按命令给。 */
function pcCtx(args: Record<string, string | undefined> = {}, options: Record<string, unknown> = {}) {
  const ctx = ctxWith(PC_COOKIES)
  ctx.args = args
  ctx.options = options
  return ctx
}

const hits = (requests: GoldenRequest[], part: string) => requests.filter((r) => r.url.includes(part))

describe('xhs 私信', () => {
  it('msg read：按会话 id（对方的 chat_user_id）找到会话，带上它的 store_id 与未读数', async () => {
    const chat = { user_id: USER_ID, chat_user_id: OTHER, last_store_id: 42, unread_count: 3, info: { nickname: '对方' } }
    const { requests, result, error } = await serve(
      (r) => security(r) ?? (r.url.includes('/api/im/web/v3/chats') ? ok({ chat_list: [chat] }) : undefined),
      () => cmd.msgRead(pcCtx({ conversation: OTHER })),
    )
    if (error) throw error
    expect(result).toEqual({ id: OTHER })
    const read = hits(requests, '/api/im/web/v2/messages/read')
    expect(read).toHaveLength(1)
    expect(jsonBody(read[0]!).chat_list).toEqual([{ chat_id: OTHER, read_store_id: 42, unread_count: 3, type: 1, need_rm_offline: true }])
  })

  it('msg list：单聊与群聊合在一起按时间排，群聊的 id 是 group:<群 id>；群聊列表取不到时只列单聊', async () => {
    const chat = { user_id: USER_ID, chat_user_id: OTHER, last_msg_ts: 1790000000000, last_msg_content: '在吗', info: { nickname: '对方' } }
    const group = { group_id: GROUP_ID, group_name: '咖啡群', last_msg_ts: 1790000100000, last_msg_content: '大家好', unread_count: 2 }
    const route = (groups: Reply) => (r: GoldenRequest) =>
      security(r) ?? (r.url.includes('/api/im/web/v3/chats') ? ok({ chat_list: [chat], has_more: false }) : r.url.includes('/api/im/web/chats/group') ? groups : undefined)
    const both = await serve(route(ok({ group_chat_list: [group], has_more: false })), () => cmd.msgList(pcCtx()))
    if (both.error) throw both.error
    expect(both.result!.data).toMatchObject([
      { id: `group:${GROUP_ID}`, peer: null, unread: 2, last_message: '大家好' },
      { id: OTHER, peer: { id: OTHER, name: '对方' }, last_message: '在吗' },
    ])
    expect(both.result!.page).toEqual({ cursor: null, has_more: false })
    expect(hits(both.requests, '/api/im/web/chats/group?limit=100&complete=true&page=0&source=pc')).toHaveLength(1)

    const onlyChats = await serve(route(fail(500, '服务出错')), () => cmd.msgList(pcCtx()))
    if (onlyChats.error) throw onlyChats.error
    expect(onlyChats.result!.data.map((c: any) => c.id)).toEqual([OTHER])

    // 单聊还有下一页、群聊已取完：下一页只取单聊
    const more = await serve(
      (r) => security(r) ?? (r.url.includes('/api/im/web/v3/chats') ? ok({ chat_list: [chat], has_more: true }) : r.url.includes('/chats/group') ? ok({ group_chat_list: [] }) : undefined),
      () => cmd.msgList(pcCtx()),
    )
    expect(more.result!.page).toEqual({ cursor: '1:-', has_more: true })
    const next = pcCtx()
    next.cursor = '1:-'
    const second = await serve((r) => security(r) ?? (r.url.includes('/api/im/web/v3/chats') ? ok({ chat_list: [] }) : undefined), () => cmd.msgList(next))
    expect(hits(second.requests, '/api/im/web/v3/chats?limit=100&complete=true&page=1')).toHaveLength(1)
    expect(hits(second.requests, '/chats/group')).toHaveLength(0)
  })

  it('msg history：group:<群 id> 走群聊记录接口，游标是最早一条的 store_id', async () => {
    const msg = (store_id: number, sender_id: string, text: string) => ({ store_id, sender_id, created_at: 1790000000000 + store_id, content: JSON.stringify({ content: text, content_type: 1 }) })
    const page = Array.from({ length: 30 }, (_, i) => msg(200 - i, i % 2 ? OTHER : USER_ID, `第 ${i} 条`))
    const conv = `group:${GROUP_ID}`
    const { requests, result, error } = await serve(
      (r) => security(r) ?? (r.url.includes('/api/im/web/red/group/messages/history') ? ok({ out_message_list: page }) : undefined),
      () => cmd.msgHistory(pcCtx({ conversation: conv })),
    )
    if (error) throw error
    expect(hits(requests, `/api/im/web/red/group/messages/history?group_id=${GROUP_ID}&last_id=0&start_id=0&limit=30`)).toHaveLength(1)
    expect(result!.data[0]).toMatchObject({ conversation_id: conv, from: { id: USER_ID }, type: 'text', text: '第 0 条' })
    expect(result!.data[1]).toMatchObject({ from: { id: OTHER } })
    expect(result!.page).toEqual({ cursor: '171', has_more: true })
  })

  it('群聊会话不支持 read / revoke / delete / send：报 UNSUPPORTED，不发请求', async () => {
    const conv = `group:${GROUP_ID}`
    const { requests } = await serve(
      () => undefined,
      async () => {
        await expect(cmd.msgRead(pcCtx({ conversation: conv }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
        await expect(cmd.msgRevoke(pcCtx({ conversation: conv, message: 'm1' }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
        await expect(cmd.msgDelete(pcCtx({ conversation: conv }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
        await expect(cmd.msgSend(pcCtx({ text: '你好' }, { conversation: conv }))).rejects.toMatchObject({ code: 'UNSUPPORTED' })
      },
    )
    expect(requests).toHaveLength(0)
  })
})

describe('xhs 用户、搜索', () => {
  it('user following：只支持自己（me 或自己的 id），别人报 UNSUPPORTED', async () => {
    const route = (r: GoldenRequest) => security(r) ?? (r.url.includes('/api/im/web/users/following/all') ? ok({ follow_user_d_t_o_list: [{ user_id: OTHER, nick_name: '对方' }] }) : undefined)
    for (const user of [undefined, 'me', USER_ID]) {
      const { requests, result, error } = await serve(route, () => cmd.userFollowing(pcCtx({ user })))
      if (error) throw error
      expect(hits(requests, '/api/im/web/users/following/all?page=1&size=200')).toHaveLength(1)
      expect(result!.data).toMatchObject([{ id: OTHER, name: '对方', url: `https://www.xiaohongshu.com/user/profile/${OTHER}` }])
      expect(result!.page).toEqual({ cursor: null, has_more: false })
    }
    const other = await serve(route, () => cmd.userFollowing(pcCtx({ user: OTHER })))
    expect(other.error).toMatchObject({ code: 'UNSUPPORTED', hint: 'catbus xhs user following' })
    expect(hits(other.requests, 'following/all')).toHaveLength(0)
  })

  it('keyword suggest：sug_items 的 text，空的去掉', async () => {
    const { requests, result, error } = await serve(
      (r) => security(r) ?? (r.url.includes('/api/sns/web/v1/search/recommend') ? ok({ sug_items: [{ text: '咖啡拿铁', search_type: 'notes' }, { text: '' }] }) : undefined),
      () => cmd.keywordSuggest(pcCtx({ prefix: '咖啡' })),
    )
    if (error) throw error
    expect(hits(requests, '/api/sns/web/v1/search/recommend?keyword=%E5%92%96%E5%95%A1')).toHaveLength(1)
    expect(result).toEqual([{ text: '咖啡拿铁', heat: null }])
  })

  it('item search --time：day / week / half_year 写进 filters，all 不带 filters', async () => {
    const route = (r: GoldenRequest) => security(r) ?? (r.url.includes('/search/notes') ? ok({ items: [], has_more: false }) : undefined)
    const tags = async (time?: string) => {
      const { requests, error } = await serve(route, () => cmd.itemSearch(pcCtx({ keyword: '咖啡' }, { time, sort: 'latest', type: 'image' })))
      if (error) throw error
      return jsonBody(hits(requests, '/api/sns/web/v2/search/notes')[0]!).filters?.map((f: any) => f.tags[0])
    }
    expect(await tags('day')).toEqual(['time_descending', '普通笔记', '一天内', '不限', '不限'])
    expect(await tags('week')).toEqual(['time_descending', '普通笔记', '一周内', '不限', '不限'])
    expect(await tags('half_year')).toEqual(['time_descending', '普通笔记', '半年内', '不限', '不限'])
    expect(await tags('all')).toBeUndefined()
    expect(await tags()).toBeUndefined()
  })
})

describe('xhs 创作者中心的会话', () => {
  /** 主站和创作者中心都有登录态。 */
  function bothCtx(args: Record<string, string> = {}) {
    const ctx = pcCtx(args)
    ctx.credential.scopes.creator = { cookies: ctxWith(CREATOR_COOKIES, 'creator').credential.scopes.creator!.cookies, tokens: {} }
    return ctx
  }
  const TOPIC = { id: 't1', name: '旅行', link: 'https://www.xiaohongshu.com/page/topics/t1', view_num: 10 }
  /** 第一次话题搜索报登录失效，之后正常。 */
  function topics(userInfo: Reply = ok({ userId: USER_ID, userName: '测试用户' })) {
    let calls = 0
    return (r: GoldenRequest): Reply => {
      if (r.url.includes('/web_api/sns/v1/search/topic')) return calls++ === 0 ? fail(-100, '登录已过期') : ok({ topic_info_dtos: [TOPIC] })
      if (r.url.includes('/api/galaxy/user/info')) return userInfo
      return security(r)
    }
  }

  it('creator scope 失效：用主站登录态重新桥接一次再重试', async () => {
    const ctx = bothCtx({ keyword: '旅行' })
    const { requests, result, error } = await serve(topics(), () => cmd.topicSearch(ctx))
    if (error) throw error
    expect(result!.data).toMatchObject([{ id: 't1', name: '旅行' }])
    const urls = requests.map((r) => r.url)
    const first = urls.findIndex((u) => u.includes('/search/topic'))
    const bridge = urls.findIndex((u) => u.startsWith('https://creator.xiaohongshu.com/publish/publish'))
    const second = urls.findLastIndex((u) => u.includes('/search/topic'))
    expect(hits(requests, '/search/topic')).toHaveLength(2)
    expect(first).toBeLessThan(bridge)
    expect(bridge).toBeLessThan(second)
    // 桥接结果写回凭证：creator scope 换成主站带过去的 cookie，签名状态重新保存
    const names = ctx.credential.scopes.creator!.cookies.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['a1', 'web_session', 'websectiga', 'gid']))
    expect(ctx.credential.scopes.creator!.cookies.find((c) => c.name === 'gid')!.value).toBe('g'.repeat(72))
    expect(ctx.credential.device.creator).toBeTruthy()
  })

  it('主站登录态也失效：桥接的 user/info 验收失败，报 AUTH_EXPIRED，只桥接一次，creator scope 保持原样', async () => {
    const ctx = bothCtx({ keyword: '旅行' })
    const before = ctx.credential.scopes.creator
    const { requests, error } = await serve(topics(fail(-100, '登录已过期')), () => cmd.topicSearch(ctx))
    expect(error).toMatchObject({ code: 'AUTH_EXPIRED', hint: 'catbus xhs auth login -a default' })
    expect(hits(requests, '/search/topic')).toHaveLength(1)
    expect(hits(requests, 'creator.xiaohongshu.com/publish/publish')).toHaveLength(1)
    expect(ctx.credential.scopes.creator).toBe(before)
  })

  it('没有主站登录态：不桥接，照常报错', async () => {
    const ctx = ctxWith(CREATOR_COOKIES, 'creator')
    ctx.args = { keyword: '旅行' }
    const { requests, error } = await serve(topics(), () => cmd.topicSearch(ctx))
    expect(error).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(hits(requests, '/search/topic')).toHaveLength(1)
    expect(hits(requests, 'publish/publish')).toHaveLength(0)
  })

  it('视频发布缺 --cover：发请求前报 USAGE', async () => {
    const { requests, error } = await serve(() => undefined, () => cmd.itemPublish({ ...bothCtx(), options: { video: '/tmp/a.mp4', visibility: 'public' } }))
    expect(error).toMatchObject({ code: 'USAGE', message: expect.stringContaining('--cover') })
    expect(requests).toHaveLength(0)
  })
})

describe('xhs 直播发弹幕', () => {
  const route = (send: Reply) => (r: GoldenRequest): Reply => {
    if (r.url.includes('/room/current_room_info')) return ok({ room_id: ROOM, host_info: { user_id: 'host1', nickname: '主播' } })
    if (r.url.includes('/interaction/send_comment')) return send
    if (r.url.includes('/api/sns/web/v2/user/me')) return ok({ user_id: USER_ID, nickname: '测试用户', images: 'https://x/a.jpg' })
    if (r.url.includes('/api/sns/web/v1/celestial/lt')) return ok({ aLt: 'fake-alt', rLt: 'fake-rlt', expiredTime: 10080 })
    return security(r)
  }
  /** 握手和发弹幕都回 c=0。 */
  const ack = (f: any) => (f.t === 2 && f.b?.d?.s === 0) || (f.t === 3 && f.b?.d?.biz === 'room') ? [{ v: 1, t: 2, m: f.m, b: { a: { c: 0 } } }] : []

  it('HTTP 成功：不连长连', async () => {
    rwpSent.length = 0
    rwpReply = ack
    try {
      const { result, error } = await serve(route(ok()), () => cmd.liveSend(pcCtx({ room: ROOM, text: '主播好' })))
      if (error) throw error
      expect(result).toEqual({ id: ROOM })
      expect(rwpSent).toHaveLength(0)
    } finally {
      rwpReply = null
    }
  })

  it('HTTP 报业务错误：改走直播间长连，发 sendMessage 帧并等到回执', async () => {
    rwpSent.length = 0
    rwpReply = ack
    try {
      const { requests, result, error } = await serve(route(fail(10086, '当前房间状态不支持')), () => cmd.liveSend(pcCtx({ room: ROOM, text: '主播好' })))
      if (error) throw error
      expect(result).toEqual({ id: ROOM })
      expect(hits(requests, '/interaction/send_comment')).toHaveLength(1)
      const room = rwpSent.find((f) => f.t === 3 && f.b?.d?.biz === 'room' && f.b?.d?.c === 'sendMessage')
      const payload = JSON.parse(Buffer.from(room.b.d.b, 'base64').toString('utf8'))
      expect(payload).toMatchObject({ roomId: ROOM, roomType: 'LIVE', command: 1 })
      expect(JSON.parse(payload.customData)).toEqual({ type: 'text', priority: 0, profile: { nickname: '测试用户', avatar: 'https://x/a.jpg', user_id: USER_ID, role: 0 }, desc: '主播好' })
      // 进房间之后才发弹幕
      expect(rwpSent.findIndex((f) => f.b?.d?.s === 8)).toBeLessThan(rwpSent.indexOf(room))
    } finally {
      rwpReply = null
    }
  })

  it('长连回执 c≠0：报 UPSTREAM；登录失效之类的错误不改走长连', async () => {
    rwpSent.length = 0
    rwpReply = (f) => (f.t === 3 && f.b?.d?.biz === 'room' ? [{ v: 1, t: 2, m: f.m, b: { a: { c: 3100001, m: 'Account has not privilege' } } }] : ack(f))
    try {
      const rejected = await serve(route(fail(10086, '当前房间状态不支持')), () => cmd.liveSend(pcCtx({ room: ROOM, text: '主播好' })))
      expect(rejected.error).toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('3100001') })
      rwpSent.length = 0
      const expired = await serve(route(fail(-100, '登录已过期')), () => cmd.liveSend(pcCtx({ room: ROOM, text: '主播好' })))
      expect(expired.error).toMatchObject({ code: 'AUTH_EXPIRED' })
      expect(rwpSent).toHaveLength(0)
    } finally {
      rwpReply = null
    }
  })
})

describe('xhs 视频元数据（替代 opencv）', () => {
  it('帧率、帧数、宽高、时长与上游 opencv 一致（不规则 stts、旋转、round 恰好一半）', () => {
    for (const r of loadCase('xhs', 'video_metadata').result) {
      const meta = capi.videoMetadata(Buffer.from(r.video, 'base64'))
      expect(JSON.parse(pyJson(meta)), r.name).toEqual(r.metadata)
    }
  })

  it('Python 的 float 与 round', () => {
    expect(pyJson({ a: new PyFloat(25), b: new PyFloat(0.4), c: [new PyFloat(1)], d: 0 })).toBe('{"a":25.0,"b":0.4,"c":[1.0],"d":0}')
    expect(JSON.stringify({ a: new PyFloat(25) })).toBe('{"a":25}')
    expect([25.0625, 25.0635, 29.97002997002997, 22.727272727272727, 0.0005].map((x) => pyRound(x, 3))).toEqual([25.062, 25.064, 29.97, 22.727, 0.001])
  })

  it('不是 MP4 / MOV：返回 null（按 0 上报，由平台转码后补全）', () => {
    expect(capi.videoMetadata(new TextEncoder().encode('not a video'))).toBeNull()
  })
})

// ================================================================ 长连发私信：只有没发出去时才走 HTTP

/** 测试里把长连的等待时限调短（真实时间）。 */
function shortPushTimeouts() {
  const saved = { ...push.PUSH_TIMEOUTS }
  beforeEach(() => Object.assign(push.PUSH_TIMEOUTS, { handshake: 80, ack: 80 }))
  afterEach(() => {
    Object.assign(push.PUSH_TIMEOUTS, saved)
    rwpReply = null
  })
}

const varint = (n: number) => {
  const out: number[] = []
  while (n > 0x7f) {
    out.push((n % 128) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const pbBytes = (num: number, b: Buffer | string) => {
  const buf = Buffer.from(b)
  return Buffer.concat([Buffer.from([(num << 3) | 2, ...varint(buf.length)]), buf])
}
const pbInt = (num: number, v: number) => Buffer.from([num << 3, ...varint(v)])

/** 发出去的 im 帧里的 mid（ChatOneMessage field 9 → ChatSendMessage field 1）。 */
function sentMid(f: any): string {
  const d = Buffer.from(f.b.d.b, 'base64')
  let o = 2 // 08 01
  if (d[o++] !== 0x4a) throw new Error('不是 field 9')
  while (d[o++]! & 0x80);
  if (d[o++] !== 0x0a) throw new Error('不是 mid')
  const len = d[o++]!
  return d.subarray(o, o + len).toString('utf8')
}

/** ChatOneMessage{chatACK} 的回执帧（t=2，b.a.b）。 */
const imAck = (m: string, mid: string, code = 0, msg = '') => ({
  v: 1,
  t: 2,
  m,
  b: { a: { c: 0, b: pbBytes(5, Buffer.concat([pbBytes(1, mid), pbBytes(2, 'msg-9'), pbInt(3, 1790000000123), ...(code ? [pbInt(5, code), pbBytes(6, msg)] : [])])).toString('base64') } },
})

const isHandshake = (f: any) => f.t === 2 && f.b?.d?.s === 0
const isIm = (f: any) => f.t === 3 && f.b?.d?.biz === 'im'
const handshakeOk = (f: any) => (isHandshake(f) ? [{ v: 1, t: 2, m: f.m, b: { a: { c: 0 } } }] : [])

describe('xhs 私信发送（长连优先，HTTP 兜底）', () => {
  shortPushTimeouts()
  const route = (r: GoldenRequest): Reply => {
    if (r.url.includes('/api/sns/web/v1/celestial/lt')) return ok({ aLt: 'fake-alt', rLt: 'fake-rlt', expiredTime: 10080 })
    if (r.url.includes('/api/im/web/short_link/send_message')) return ok({ message_id: 'http-1' })
    return security(r)
  }
  const send = () => serve(route, () => cmd.msgSend(pcCtx({ text: '你好' }, { to: OTHER })))

  it('收到回执：返回长连的消息 id，不走 HTTP', async () => {
    rwpSent.length = 0
    rwpReply = (f) => (isIm(f) ? [imAck(f.m, sentMid(f))] : handshakeOk(f))
    const { requests, result, error } = await send()
    if (error) throw error
    expect(result).toMatchObject({ id: 'msg-9', conversation_id: OTHER, from: { id: USER_ID }, type: 'text', text: '你好' })
    expect(rwpSent.filter(isIm)).toHaveLength(1)
    expect(hits(requests, 'short_link')).toHaveLength(0)
  })

  it('帧已发出但没等到回执：报 NETWORK（不确定是否送达），不再走 HTTP 重发', async () => {
    rwpSent.length = 0
    rwpReply = handshakeOk
    const { requests, error } = await send()
    expect(error).toMatchObject({ code: 'NETWORK', detail: { kind: 'timeout', sent: true }, hint: `先用 catbus xhs msg history ${OTHER} 确认，再决定要不要重发` })
    expect(rwpSent.filter(isIm)).toHaveLength(1)
    expect(hits(requests, 'short_link')).toHaveLength(0)
  })

  it('回执 code≠0：报 UPSTREAM，不走 HTTP', async () => {
    rwpReply = (f) => (isIm(f) ? [imAck(f.m, sentMid(f), 3001, '对方拒收')] : handshakeOk(f))
    const { requests, error } = await send()
    expect(error).toMatchObject({ code: 'UPSTREAM', message: '对方拒收', detail: { code: 3001 } })
    expect(hits(requests, 'short_link')).toHaveLength(0)
  })

  it('握手被拒绝或握手超时（私信还没发出去）：改走 HTTP 短链，只发一次', async () => {
    for (const reply of [(f: any) => (isHandshake(f) ? [{ v: 1, t: 2, m: f.m, b: { a: { c: 3100001, m: 'Account has not privilege' } } }] : []), () => []]) {
      rwpSent.length = 0
      rwpReply = reply
      const { requests, result, error } = await send()
      if (error) throw error
      expect(result).toMatchObject({ id: 'http-1', conversation_id: OTHER, text: '你好' })
      expect(rwpSent.filter(isIm)).toHaveLength(0)
      expect(hits(requests, '/api/im/web/short_link/send_message')).toHaveLength(1)
    }
  })
})

describe('xhs 直播发弹幕的长连退路', () => {
  shortPushTimeouts()
  it('长连发出弹幕后没有回执：报 NETWORK，不当成功', async () => {
    rwpReply = handshakeOk
    const route = (r: GoldenRequest): Reply => {
      if (r.url.includes('/room/current_room_info')) return ok({ room_id: ROOM, host_info: { user_id: 'host1' } })
      if (r.url.includes('/interaction/send_comment')) return fail(10086, '当前房间状态不支持')
      if (r.url.includes('/api/sns/web/v2/user/me')) return ok({ user_id: USER_ID, nickname: '测试用户' })
      if (r.url.includes('/api/sns/web/v1/celestial/lt')) return ok({ aLt: 'fake-alt', expiredTime: 10080 })
      return security(r)
    }
    const { error } = await serve(route, () => cmd.liveSend(pcCtx({ room: ROOM, text: '主播好' })))
    expect(error).toMatchObject({ code: 'NETWORK', detail: { kind: 'timeout', sent: true } })
  })
})

// ================================================================ 私信的其余命令

describe('xhs 私信：已读、会话列表游标', () => {
  const chat = (id: string, store: number) => ({ user_id: USER_ID, chat_user_id: id, last_store_id: store, unread_count: 1 })

  it('msg read：第一页没有就往后翻；翻完也找不到报 USAGE，不发已读请求', async () => {
    const pages = [[chat('5f00000000000000000000aa', 1)], [chat(OTHER, 42)]]
    const route = (r: GoldenRequest): Reply => {
      const m = /\/api\/im\/web\/v3\/chats\?.*page=(\d+)/.exec(r.url)
      if (m) return ok({ chat_list: pages[Number(m[1])] ?? [], has_more: Number(m[1]) < pages.length - 1 })
      return security(r)
    }
    const found = await serve(route, () => cmd.msgRead(pcCtx({ conversation: OTHER })))
    if (found.error) throw found.error
    expect(hits(found.requests, '/api/im/web/v3/chats?limit=100&complete=true&page=1&source=pc')).toHaveLength(1)
    expect(jsonBody(hits(found.requests, '/api/im/web/v2/messages/read')[0]!).chat_list[0]).toMatchObject({ chat_id: OTHER, read_store_id: 42 })

    const missing = await serve(route, () => cmd.msgRead(pcCtx({ conversation: '5f00000000000000000000bb' })))
    expect(missing.error).toMatchObject({ code: 'USAGE', hint: 'catbus xhs msg list' })
    expect(hits(missing.requests, '/api/im/web/v3/chats')).toHaveLength(2)
    expect(hits(missing.requests, '/messages/read')).toHaveLength(0)
  })

  it('msg list 的 -:1 游标：单聊已取完，只取群聊第 1 页', async () => {
    const ctx = pcCtx()
    ctx.cursor = '-:1'
    const { requests, result, error } = await serve(
      (r) => security(r) ?? (r.url.includes('/chats/group') ? ok({ group_chat_list: [{ group_id: GROUP_ID, last_msg_ts: 1790000100000 }], has_more: false }) : undefined),
      () => cmd.msgList(ctx),
    )
    if (error) throw error
    expect(hits(requests, '/api/im/web/v3/chats')).toHaveLength(0)
    expect(hits(requests, '/api/im/web/chats/group?limit=100&complete=true&page=1&source=pc')).toHaveLength(1)
    expect(result!.data.map((c: any) => c.id)).toEqual([`group:${GROUP_ID}`])
    expect(result!.page).toEqual({ cursor: null, has_more: false })
  })

  it('群聊列表报「系统异常」这类普通业务错误：仍按 UPSTREAM 降级为只列单聊，不当成风控', async () => {
    const { result, error } = await serve(
      (r) =>
        security(r) ??
        (r.url.includes('/api/im/web/v3/chats') ? ok({ chat_list: [chat(OTHER, 1)] }) : r.url.includes('/chats/group') ? fail(500, '系统异常，请稍后再试') : undefined),
      () => cmd.msgList(pcCtx()),
    )
    if (error) throw error
    expect(result!.data.map((c: any) => c.id)).toEqual([OTHER])
  })
})

describe('xhs 业务码 → 错误码', () => {
  const p = new Pc(ctxWith(PC_COOKIES))
  const err = (body: any) => {
    try {
      p.check(body)
    } catch (e) {
      return e
    }
    return null
  }
  it('登录墙、风控码、明确的风控措辞、普通业务错误', () => {
    expect(err({ code: 0, success: true, data: 1 })).toBeNull()
    expect(err({ code: -100, success: false, msg: '登录已过期' })).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(err({ code: 300013, success: false, msg: '访问频次异常，请勿频繁操作或重启试试' })).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha', code: 300013 } })
    expect(err({ code: 300011, success: false, msg: '当前账号存在异常' })).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked' } })
    expect(err({ code: 461, success: false, msg: '' })).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
    expect(err({ code: 1, success: false, msg: '请完成人机验证' })).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'captcha' } })
    expect(err({ code: 1, success: false, msg: '操作太频繁，请稍后再试' })).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked' } })
    for (const msg of ['服务异常', '系统异常，请稍后再试', '验证码错误', '笔记不存在']) {
      expect(err({ code: 500, success: false, msg }), msg).toMatchObject({ code: 'UPSTREAM', message: msg, detail: { code: 500 } })
    }
  })
})

describe('xhs 归一化：长连推送、直播间事件、关注列表分页', () => {
  it('长连推来的私信：类型按 content_type 取，会话 id 是对方', () => {
    const inbound = (json: any, payload = JSON.stringify(json)) => cmd.inboundMessageOf({ mid: 'm1', messageId: 'id1', ts: 1790000000123, payload, json }, USER_ID)
    expect(inbound({ sender: OTHER, receiver: USER_ID, content: JSON.stringify({ content: '[图片]', content_type: 2 }) })).toMatchObject({
      id: 'id1',
      conversation_id: OTHER,
      from: { id: OTHER },
      type: 'image',
    })
    expect(inbound({ sender: USER_ID, receiver: OTHER, content_type: 4, content: 'v' })).toMatchObject({ conversation_id: OTHER, type: 'video' })
    expect(inbound({ sender: OTHER, content: '在吗' })).toMatchObject({ type: 'text', text: '在吗' })
    // 顶层 type 不是数字（不是 content_type）时不采用
    expect(inbound({ sender: OTHER, type: 'PRIVATE', content: JSON.stringify({ content: 'x', content_type: 3 }) }).type).toBe('card')
    expect(cmd.inboundMessageOf({ mid: 'm2', messageId: '', ts: 0, payload: '纯文本', json: null }, USER_ID)).toMatchObject({ id: 'm2', type: 'text', text: '纯文本' })
  })

  it('直播间事件：弹幕、礼物、点赞、进场、关注；心跳和人数不输出', () => {
    const ev = (customData: any) => cmd.roomEvent({ ts: 1790000000123, customData: { profile: { user_id: OTHER, nickname: '观众' }, ...customData } })
    expect(ev({ type: 'text', desc: '主播好' })).toMatchObject({ type: 'chat', text: '主播好', user: { id: OTHER, name: '观众' }, time: '2026-09-21T22:13:20+08:00' })
    expect(ev({ type: 'gift', gift: { name: '小心心', count: 3 } })).toMatchObject({ type: 'gift', gift: { name: '小心心', count: 3 } })
    expect(ev({ type: 'praise' })).toMatchObject({ type: 'like' })
    expect(ev({ type: 'enter_room' })).toMatchObject({ type: 'enter' })
    expect(ev({ type: 'follow' })).toMatchObject({ type: 'follow' })
    expect(ev({ type: 'viewer_heart' })).toBeNull()
    expect(ev({ type: 'audience_num' })).toBeNull()
    expect(ev({ type: 'shop', desc: '上新' })).toMatchObject({ type: 'other', text: '上新' })
    expect(cmd.roomEvent({ customData: 'x' })).toBeNull()
  })

  it('user following：一页取满 200 个时认为还有下一页', async () => {
    const users = Array.from({ length: 200 }, (_, i) => ({ user_id: `5f${String(i).padStart(22, '0')}`, nick_name: `u${i}` }))
    const { result, error } = await serve((r) => security(r) ?? (r.url.includes('following/all') ? ok({ follow_user_d_t_o_list: users }) : undefined), () => cmd.userFollowing(pcCtx()))
    if (error) throw error
    expect(result!.data).toHaveLength(200)
    expect(result!.page).toEqual({ cursor: '2', has_more: true })
  })
})

// ================================================================ 创作者中心：第一次桥接

describe('xhs 创作者中心：第一次用主站登录态桥接', () => {
  const TOPIC = { id: 't1', name: '旅行', link: 'https://www.xiaohongshu.com/page/topics/t1', view_num: 10 }
  /** 桥接的 user/info 验收按 userInfo 回；话题搜索正常。 */
  const bridge = (userInfo: Reply, publish?: Reply) => (r: GoldenRequest): Reply => {
    if (publish && r.url.startsWith('https://creator.xiaohongshu.com/publish/publish')) return publish
    if (r.url.includes('/api/galaxy/user/info')) return userInfo
    if (r.url.includes('/web_api/sns/v1/search/topic')) return ok({ topic_info_dtos: [TOPIC] })
    return security(r)
  }
  const OK_INFO = ok({ userId: USER_ID, userName: '测试用户' })

  it('桥接中途失败（验收不过 / 发布页打不开）：凭证一点不改，下次还会重新桥接', async () => {
    for (const [route, code] of [
      [bridge(fail(-100, '登录已过期')), 'AUTH_EXPIRED'],
      [bridge(OK_INFO, { status: 500, body: '<html></html>' }), 'UPSTREAM'],
    ] as const) {
      const ctx = pcCtx({ keyword: '旅行' })
      const before = JSON.stringify(ctx.credential)
      const { requests, error } = await serve(route, () => cmd.topicSearch(ctx))
      expect(error).toMatchObject({ code })
      expect(hits(requests, 'creator.xiaohongshu.com/publish/publish')).toHaveLength(1)
      expect(hits(requests, '/search/topic')).toHaveLength(0)
      expect(JSON.stringify(ctx.credential)).toBe(before)
      expect(ctx.credential.scopes.creator).toBeUndefined()

      // 同一份凭证再跑一次：仍是「第一次」，重新桥接并成功
      const again = await serve(bridge(OK_INFO), () => cmd.topicSearch(ctx))
      if (again.error) throw again.error
      expect(again.result!.data).toMatchObject([{ id: 't1' }])
      expect(hits(again.requests, 'creator.xiaohongshu.com/publish/publish')).toHaveLength(1)
      expect(ctx.credential.scopes.creator!.cookies.map((c) => c.name)).toEqual(expect.arrayContaining(['a1', 'web_session', 'webBuild', 'xsecappid', 'gid']))
      expect(ctx.credential.device.creator).toBeTruthy()
    }
  })

  describe('经 CLI 分发（命令失败时 core 也会把凭证落盘）', () => {
    useTempHome()
    async function account() {
      const c = newCredential({ platform: 'xhs', endpoint: 'web', account: 'default', method: 'cookie' })
      c.user = { id: USER_ID, name: '测试用户', url: null }
      c.scopes.main!.cookies = parseCookieInput(PC_COOKIES, '.xiaohongshu.com')
      await writeCredential(c)
      await setCurrent('xhs', 'web', 'default')
    }

    it('第一次桥接失败不落盘半成品；下一次命令重新桥接成功并落盘', async () => {
      await account()
      const failed = await serve(bridge(fail(-100, '登录已过期')), () => cli('xhs', 'topic', 'search', '旅行'))
      expect(failed.result!.env.error).toMatchObject({ code: 'AUTH_EXPIRED' })
      const saved = (await readCredential('xhs', 'web', 'default'))!
      expect(saved.scopes.creator).toBeUndefined()
      expect(saved.device.creator).toBeUndefined()
      expect(saved.extra.creator_ds).toBeUndefined()

      const done = await serve(bridge(OK_INFO), () => cli('xhs', 'topic', 'search', '旅行'))
      expect(done.result!.env).toMatchObject({ ok: true, data: [{ id: 't1', name: '旅行' }] })
      expect(hits(done.requests, 'creator.xiaohongshu.com/publish/publish')).toHaveLength(1)
      const bridged = (await readCredential('xhs', 'web', 'default'))!
      expect(bridged.scopes.creator!.cookies.map((c) => c.name)).toEqual(expect.arrayContaining(['a1', 'web_session', 'gid']))
      expect(bridged.device.creator).toBeTruthy()

      // 第三次直接复用 creator scope，不再桥接
      const reuse = await serve(bridge(OK_INFO), () => cli('xhs', 'topic', 'search', '旅行'))
      expect(reuse.result!.env.ok).toBe(true)
      expect(hits(reuse.requests, 'publish/publish')).toHaveLength(0)
    })
  })
})

describe('xhs 发布与上传', () => {
  function bothCtx(options: Record<string, unknown> = {}, args: Record<string, string> = {}) {
    const ctx = pcCtx(args, options)
    ctx.credential.scopes.creator = { cookies: ctxWith(CREATOR_COOKIES, 'creator').credential.scopes.creator!.cookies, tokens: {} }
    return ctx
  }
  const POIS = [
    { poi_id: 'p1', name: '外滩', full_address: '上海市黄浦区中山东一路', poi_type: 1 },
    { poi_id: 'p2', name: '外滩源', full_address: '上海市黄浦区圆明园路', poi_type: 1 },
  ]

  it('item publish --poi：只认 poi_id 或名称完全相同的地点，否则报 USAGE（不上传、不发布）', async () => {
    const route = (r: GoldenRequest) => security(r) ?? (r.url.includes('/poi/creator/search') ? ok({ poi_list: POIS }) : undefined)
    const { requests, error } = await serve(route, () => cmd.itemPublish(bothCtx({ image: ['/nonexistent.png'], poi: '外滩美术馆', visibility: 'public' })))
    expect(error).toMatchObject({ code: 'USAGE', message: expect.stringContaining('外滩（p1）'), hint: 'catbus xhs poi search 外滩美术馆' })
    expect(hits(requests, '/upload/creator/permit')).toHaveLength(0)
    expect(hits(requests, '/web_api/sns/v2/note')).toHaveLength(0)
  })

  it('item publish --poi：按 id 或名称精确匹配后写进 post_loc', async () => {
    const file = join(tmpdir(), `catbus-xhs-${process.pid}.png`)
    writeFileSync(file, PNG)
    for (const poi of ['p2', '外滩源']) {
      const route = (r: GoldenRequest): Reply => {
        if (r.url.includes('/poi/creator/search')) return ok({ poi_list: POIS })
        if (r.url.includes('/upload/creator/permit')) return ok({ uploadTempPermits: [{ fileIds: ['spectrum/fid1'], token: 't', expireTime: 1790000000000, uploadAddr: 'ros-upload.xiaohongshu.com' }] })
        if (r.method === 'PUT') return { body: '' }
        if (r.url.includes('/web_api/sns/v2/note')) return ok({ id: NOTE_ID })
        return security(r)
      }
      const { requests, error } = await serve(route, () => cmd.itemPublish(bothCtx({ image: [file], poi, visibility: 'public' })))
      if (error) throw error
      expect(jsonBody(hits(requests, '/web_api/sns/v2/note')[0]!).common.post_loc).toEqual({ name: '外滩源', subname: '上海市黄浦区圆明园路', poi_id: 'p2', poi_type: 1 })
    }
  })

  it('media upload：url 是文件 PUT 到的绝对地址', async () => {
    const file = join(tmpdir(), `catbus-xhs-up-${process.pid}.png`)
    writeFileSync(file, PNG)
    const route = (r: GoldenRequest): Reply => {
      if (r.url.includes('/upload/creator/permit')) return ok({ uploadTempPermits: [{ fileIds: ['spectrum/fid1'], token: 't', expireTime: 1790000000000, uploadAddr: 'ros-upload.xiaohongshu.com' }] })
      if (r.method === 'PUT') return { body: '' }
      return security(r)
    }
    const { requests, result, error } = await serve(route, () => cmd.mediaUpload(bothCtx({}, { file })))
    if (error) throw error
    expect(result).toMatchObject({ id: 'fid1', type: 'image', url: 'https://ros-upload.xiaohongshu.com/spectrum/fid1', width: 3, height: 2 })
    expect(requests.find((r) => r.method === 'PUT')!.url).toBe('https://ros-upload.xiaohongshu.com/spectrum/fid1')
  })
})
