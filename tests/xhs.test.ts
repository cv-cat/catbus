import { describe, expect, it } from 'vitest'
import * as api from '../src/platforms/xhs/web/api.js'
import { Creator, PyFloat, pyJson, pyRound3 } from '../src/platforms/xhs/web/creator.js'
import * as capi from '../src/platforms/xhs/web/creator-api.js'
import { CreatorLogin } from '../src/platforms/xhs/web/creator-api.js'
import { Pc, resetXraySeq } from '../src/platforms/xhs/web/client.js'
import * as login from '../src/platforms/xhs/web/login.js'
import * as norm from '../src/platforms/xhs/web/normalize.js'
import { EDITH } from '../src/platforms/xhs/web/profile.js'
import { fakeResponse, mockSender } from '../src/core/http.js'
import { deterministic } from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as push from '../src/platforms/xhs/web/push.js'
import { expectRequests, type GoldenRequest, loadCase, makeCtx, normalize, replay } from './golden.js'

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
    expect([25.0625, 25.0635, 29.97002997002997, 22.727272727272727, 0.0005].map(pyRound3)).toEqual([25.062, 25.064, 29.97, 22.727, 0.001])
  })

  it('不是 MP4 / MOV：返回 null（按 0 上报，由平台转码后补全）', () => {
    expect(capi.videoMetadata(new TextEncoder().encode('not a video'))).toBeNull()
  })
})
