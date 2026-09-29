import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakeResponse, type HttpResponse, mockSender } from '../src/core/http.js'
import { pyFloatStr, pyRound } from '../src/core/py.js'
import * as rand from '../src/core/rand.js'
import { RAW } from '../src/core/schemas.js'
import * as api from '../src/platforms/kuaishou/web/api.js'
import { buildTrajectory, formatTrajectory } from '../src/platforms/kuaishou/web/captcha.js'
import { decrypt, encrypt, qsStringify, verifyParam } from '../src/platforms/kuaishou/web/captcha-crypto.js'
import { captchaExtraParamJson, gpuInfoJson } from '../src/platforms/kuaishou/web/captcha-fp.js'
import { bootstrapDeviceFingerprint, credentialCookies, Ks } from '../src/platforms/kuaishou/web/client.js'
import { findGapX } from '../src/platforms/kuaishou/web/gap.js'
import * as gdfp from '../src/platforms/kuaishou/web/gdfp.js'
import { decodeFrame, enterRoomFrame, feedEvents, heartbeatFrame, userExitFrame } from '../src/platforms/kuaishou/web/live.js'
import * as norm from '../src/platforms/kuaishou/web/normalize.js'
import { genFingerprintReport, genKwfv1, genKwscode, genLikeToken } from '../src/platforms/kuaishou/web/oracle.js'
import { CP, LIVE, UA, WWW } from '../src/platforms/kuaishou/web/profile.js'
import { axiosQuery, buildSignInput, HxFalconSigner, Sig3Signer, weaponEncrypt } from '../src/platforms/kuaishou/web/sign.js'
import { expectRequests, type GoldenCase, type GoldenRequest, loadCase, makeCtx, normalize } from './golden.js'

/** 与 scripts/golden/kuaishou/gen.py 相同的假数据。 */
const DID = 'web_' + '0123456789abcdef'.repeat(2)
const KWFV1 = ('PnGU+fake' + 'kwfv1'.repeat(40)).slice(0, 174)
const SECTOKEN = 'FakeSecToken'.repeat(8).slice(0, 88)
const KWSCODE = '0123456789abcdef'.repeat(4)
const CP_PH = 'fake0000-cp00-ph00-0000-000000000000'
const SELF_EID = '3xfakeself00001'
const EID = '3xfakeuser00001'
const PHOTO = '3xfakephoto0001'
const ROOM = '3xfakeroom00001'
const STREAM = 'fakeStream01'
const UPLOAD = 'https://upload.kuaishouzt.com'
const KWS_URL = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kws/kws-13-0.0.1-obfuscated.6b74e9640ff18648.js?x-kcdn-pid=112369'
const KWF_CP = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kwf/kwf-0.1.1.a6d1e5d478c2cafa.js?x-kcdn-pid=112369'
const COOKIES: [string, string][] = [
  ['kpf', 'PC_WEB'],
  ['clientid', '3'],
  ['did', DID],
  ['didv', '1789990000000'],
  ['kwpsecproductname', 'kuaishou-vision'],
  ['kwfv1', KWFV1],
  ['kwssectoken', SECTOKEN],
  ['kwscode', KWSCODE],
  ['kpn', 'KUAISHOU_VISION'],
  ['wid', '12345678901234567'],
  ['userId', '10001'],
  ['kuaishou.server.webday7_st', 'fake-www-st'],
  ['kuaishou.server.webday7_ph', 'fake-www-ph'],
  ['bUserId', '20001'],
  ['kuaishou.web.cp.api_st', 'fake-cp-st'],
  ['kuaishou.web.cp.api_ph', CP_PH],
  ['passToken', 'fake-pass-token'],
  ['ktrace-context', 'fake|trace'],
]
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const VIDEO = Buffer.concat([Buffer.from('\x00\x00\x00\x18ftypmp42', 'latin1'), Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256))])

const KWF_WWW = 'https://h4.static.yximgs.com/kcdn/cdn-kcdn112369/kwf/kwf-0.0.2.2cee19b4b7dec496.js?x-kcdn-pid=112369'
const IFRAME =
  'https://captcha.zt.kuaishou.com/iframe/index.html?captchaSession=Cg1fake%2Bsession%3D%3D&type=1' +
  '&configUrl=https%3A%2F%2Fcaptcha.zt.kuaishou.com%2Frest%2Fzt%2Fcaptcha%2Fsliding%2Fconfig&bizName=ANTICRAWL_COMMON&displayType=1'

function toResponse(r: GoldenCase['responses'][number], url: string): HttpResponse {
  const headers: [string, string][] = []
  for (const [k, v] of Object.entries(r.headers)) for (const x of Array.isArray(v) ? v : [v]) headers.push([k, x])
  const body: any = r.body
  const data = typeof body === 'string' ? body : body && typeof body === 'object' && 'base64' in body ? Buffer.from(body.base64, 'base64') : JSON.stringify(body)
  return fakeResponse(data, { status: r.status, headers, url })
}

/** golden.replay 的变体：响应可以是二进制（滑块的背景图、滑块图记录成 {base64}）。 */
async function replay<T>(c: GoldenCase, run: () => Promise<T>): Promise<{ requests: GoldenRequest[]; result?: T; error?: unknown }> {
  const requests: GoldenRequest[] = []
  const restoreRand = rand.deterministic({ seed: c.seed, now: c.now })
  const restoreSender = mockSender((p) => {
    requests.push(normalize(p))
    const r = c.responses[requests.length - 1]
    if (!r) throw new Error(`TS 实现多发了请求：${p.method} ${p.url}`)
    return toResponse(r, p.url)
  })
  try {
    return { requests, result: await run() }
  } catch (error) {
    return { requests, error }
  } finally {
    restoreSender()
    restoreRand()
  }
}

let tmp = ''
let home: string | undefined
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'catbus-ks-test-'))
  writeFileSync(join(tmp, 'pic.png'), PNG)
  writeFileSync(join(tmp, 'clip.mp4'), VIDEO)
  home = process.env.CATBUS_HOME
  process.env.CATBUS_HOME = join(tmp, 'home')
})
afterAll(() => {
  if (home == null) delete process.env.CATBUS_HOME
  else process.env.CATBUS_HOME = home
})

/** 已物化的登录态：与 gen.py 的 initialize(COOKIES) 相同，不出网。 */
async function logged(site?: string): Promise<Ks> {
  const k = new Ks(makeCtx({ platform: 'kuaishou' }))
  await k.init(COOKIES)
  if (site) k.s.useSite(site)
  return k
}

const obj = (pairs: [string, string][]) => Object.fromEntries(pairs)
const b64 = (u: Uint8Array) => ({ base64: Buffer.from(u).toString('base64') })

/** 用例名 → TS 侧的等价调用（返回值与上游 result 比较时由 compare 决定）。 */
const CASES: Record<string, { run: () => Promise<unknown>; result?: (actual: any, expected: any) => void }> = {
  // ---------------------------------------------------------------- 纯算
  sig4: {
    run: async () => [
      new HxFalconSigner().encode(buildSignInput('/rest/v/search/feed', {}, { keyword: '美食 a&b', page: 'search', webPageArea: '', pcursor: '' }, 'application/json', { omitEmptyBody: true }), 1790000000999, 123456789012345),
      new HxFalconSigner(43469).encode(buildSignInput('/rest/k/live/websocket/info', { liveStreamId: 'x' }, null), 1790000001000, 7),
      new HxFalconSigner().encode(buildSignInput('/rest/c/infra/ks/qr/start', {}, { sid: 'a', channelType: 'UNKNOWN', isWebSig4: 'true' }, 'application/x-www-form-urlencoded'), 1790000001000, 99),
    ],
    result: (a, e) => expect(a).toEqual(e),
  },
  sig3: {
    run: async () =>
      [{ 'kuaishou.web.cp.api_ph': 'x' }, { caption: '中文 #话题', list: [1, 2], n: null }, {}].map((body, i) => {
        const s = new Sig3Signer()
        s.count = 100 + i
        return s.sign({}, body)
      }),
    result: (a, e) => expect(a).toEqual(e),
  },
  axios_query: {
    run: async () => axiosQuery([['__NS_hxfalcon', 'HUDR_a-b.c$HE_01'], ['caver', '2'], ['k', 'a b:c,d[e]f$g/h?i']]),
    result: (a, e) => expect(a).toBe(e),
  },
  weapon_aes: {
    run: async () => weaponEncrypt(`{"productName":"kuaishou-vision","ts":1790000000123,"did":"${DID}"}`),
    result: (a, e) => expect(a).toBe(e),
  },
  live_frames: {
    run: async () => ({
      enter: b64(enterRoomFrame('fake-ws-token', STREAM)),
      enter_reconnect: b64(enterRoomFrame('fake-ws-token', STREAM, 2)),
      heartbeat: b64(heartbeatFrame(1790000000123)),
      exit: b64(userExitFrame(1790000000123)),
    }),
    result: (a, e) => {
      expect(a).toEqual({ enter: e.enter, enter_reconnect: e.enter_reconnect, heartbeat: e.heartbeat, exit: e.exit })
      const frame = decodeFrame(Buffer.from(e.feed.base64, 'base64'))
      expect(frame.type).toBe('SC_FEED_PUSH')
      const events = feedEvents(frame.payload, (id) => (id === '1' ? '棒棒糖' : null))
      expect(events.map((x) => [x.type, x.user?.id, x.text, x.gift])).toEqual([
        ['chat', 'u1', '666', null],
        ['like', 'u2', null, null],
        ['gift', 'u3', null, { name: '棒棒糖', count: 3 }],
      ])
    },
  },
  oracle_kwf: {
    run: async () => genKwfv1({ did: DID, href: 'https://www.kuaishou.com/new-reco' }),
    result: (a, e) => expect(a).toEqual(e),
  },
  oracle_kwf_cp: {
    run: async () => genKwfv1({ did: DID, href: 'https://cp.kuaishou.com/article/publish/video?origin=www.kuaishou.com', kwfcv1: '999', scriptPath: KWF_CP }),
    result: (a, e) => expect(a).toEqual(e),
  },
  oracle_report: {
    run: async () => genFingerprintReport({ did: DID, href: 'https://cp.kuaishou.com/article/publish/video?origin=www.kuaishou.com', cookie: `did=${DID}; kwfv1=${KWFV1}`, kwfcv1: '4', currentKwfv1: KWFV1 }),
    result: (a, e) => expect(a).toBe(e),
  },
  oracle_kws: {
    run: async () => genKwscode({ secToken: SECTOKEN, did: DID, href: 'https://www.kuaishou.com/new-reco', signUrl: KWS_URL, http: (await logged()).http }),
    result: (a, e) => expect(a).toBe(e),
  },
  oracle_like_token: {
    run: async () => genLikeToken(DID, 1790000000123),
    result: (a, e) => expect(a).toBe(e),
  },

  // ---------------------------------------------------------------- 滑块验证码：纯算
  py_float: {
    run: async () => {
      const g = loadCase('kuaishou', 'py_float').result
      const gauss = Array.from({ length: 7 }, () => rand.gauss(0, 0.8))
      return {
        round2: g.xs.map((x: number) => pyFloatStr(pyRound(x, 2))),
        round1: g.xs.map((x: number) => pyFloatStr(pyRound(x, 1))),
        round0: g.xs.map((x: number) => pyFloatStr(pyRound(x, 0))),
        repr: g.reprs.map((x: number) => pyFloatStr(x)),
        gauss,
        gauss_round: gauss.map((v) => pyFloatStr(pyRound(v, 2))),
      }
    },
    result: (a, e) => {
      expect({ ...a, gauss: undefined }).toEqual({ round2: e.round2, round1: e.round1, round0: e.round0, repr: e.repr, gauss_round: e.gauss_round, gauss: undefined })
      // cos / sin / log 在 V8 与 C libm 之间可能差最后一位
      a.gauss.forEach((v: number, i: number) => expect(v).toBeCloseTo(e.gauss[i], 12))
    },
  },
  captcha_crypto: {
    run: async () => {
      const payload: [string, unknown][] = [
        ['captchaSn', 'Cg1fake sn/+='],
        ['bgDisWidth', 686],
        ['relativeX', 131],
        ['trajectory', '1.5|30.12|0,131|29.9|12'],
        ['gpuInfo', gpuInfoJson()],
        ['flag', true],
        ['off', false],
        ['none', null],
        ['zh', "中文！(x)*~'"],
      ]
      return {
        qs: qsStringify(payload),
        param: verifyParam(payload),
        raw: b64(encrypt('中文abc\u{1F600}')).base64,
        roundtrip: decrypt(encrypt('hello, 世界')),
      }
    },
    result: (a, e) => expect(a).toEqual(e),
  },
  captcha_trajectory: {
    run: async () => {
      const first = buildTrajectory(131, true, 30)
      return {
        first: formatTrajectory(first),
        points: first.map((p) => [p.x, p.y, p.t]),
        float: formatTrajectory(buildTrajectory(1, false, 0)),
        short: formatTrajectory(buildTrajectory(7, true, 12)),
      }
    },
    result: (a, e) => expect(a).toEqual(e),
  },
  captcha_fp: {
    run: async () => {
      const overrides = {
        key1: 'web_snapshot',
        key2: 1,
        key18: ['0,1,-1,-1,-1,prepare1'],
        key35: 'f'.repeat(32),
        canvasGraph: '1' + 'e'.repeat(32),
        extraKey: 'x',
      }
      return [
        gpuInfoJson(),
        captchaExtraParamJson({ did: DID }),
        captchaExtraParamJson({ did: DID, nowMs: 1790000000999 }),
        gpuInfoJson({ unmaskVendor: 'Snapshot Vendor', extraKey: 'x' }),
        captchaExtraParamJson({ overrides, did: DID, nowMs: 1790000000999 }),
        captchaExtraParamJson({ overrides, nowMs: 1790000000999, freshSession: false }),
      ]
    },
    result: (a, e) => expect(a).toEqual(e),
  },
  gdfp_payloads: {
    run: async () => {
      const now = rand.now()
      const common = {
        did: DID,
        cookies: [
          ['did', DID],
          ['wid', '12345678901234567'],
          ['kwpsecproductname', 'kuaishou-vision'],
          ['didv', '1789990000000'],
          ['bUserId', '20001'],
          ['kwssectoken', SECTOKEN],
          ['kwscode', KWSCODE],
          ['kwfv1', KWFV1],
        ] as [string, string][],
        parentUrl: 'https://www.kuaishou.com/new-reco',
        iframeUrl: IFRAME,
        ua: UA,
        identity: '11111111-2222-4333-8444-555555555555',
        beginMs: now,
        sessionId: '66666666-7777-4888-9999-000000000000',
        scriptUrls: [KWF_WWW, KWS_URL],
      }
      const core = gdfp.buildCorePayload({ ...common, nowMs: now + 300 })
      const whole = gdfp.buildWholePayload({ ...common, nowMs: now + 1300 })
      return {
        sign: gdfp.signFor(1786887567),
        url: gdfp.buildUrl('/s/u/v', undefined, undefined, '&type=SDK_INIT'),
        init: gdfp.buildInitBody(DID),
        core: gdfp.encodeBody(core),
        whole: gdfp.encodeBody(whole),
        init_config: gdfp.parseInitResponse(JSON.parse(gdfp.MAN_MACHINE_INIT_RESPONSE)),
      }
    },
    result: (a, e) => expect(a).toEqual(e),
  },
  captcha_gap: {
    run: async () => {
      const input = loadCase('kuaishou', 'captcha_gap').input
      const png = (s: string) => Buffer.from(s, 'base64')
      return [await findGapX(png(input.match[0]), png(input.match[1])), await findGapX(png(input.fallback[0]), png(input.fallback[1]))]
    },
    result: (a, e) => expect(a).toEqual(e),
  },

  // ---------------------------------------------------------------- 滑块验证码：业务请求 → 400002 → 过滑块 → 重发
  captcha_comment_list: { run: async () => api.commentList(await logged(), PHOTO, 'cur1'), result: (a, e) => expect(a).toEqual(e) },
  captcha_video_detail: { run: async () => api.videoDetail(await logged(), PHOTO), result: (a, e) => expect(a).toEqual(e) },
  captcha_profile_get: { run: async () => api.profile(await logged()), result: (a, e) => expect(a).toEqual(e) },
  captcha_verify_fail: {
    run: async () => {
      const k = await logged()
      const r = await api.commentList(k, PHOTO, 'cur1')
      // 最后的 RISK_CONTROL 带上服务端对 verify 的回复
      expect(() => k.check(r)).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: expect.objectContaining({ kind: 'captcha', verify: expect.objectContaining({ result: expect.anything() }) }) }))
      return r
    },
    result: (a, e) => expect(a).toEqual(e),
  },

  // ---------------------------------------------------------------- webweapon 引导
  weapon_bootstrap: {
    run: async () => {
      const k = new Ks(makeCtx({ platform: 'kuaishou' }))
      k.s.prepare(COOKIES.filter(([n]) => n !== 'kwssectoken' && n !== 'kwscode'))
      return Object.fromEntries(await k.s.current())
    },
    result: (a, e) => {
      expect(a).toEqual(e)
      expect(Object.keys(a)).toEqual(Object.keys(e))
    },
  },
  device_fingerprint: {
    run: async () => bootstrapDeviceFingerprint(await logged(), true),
    result: (a, e) => expect(a).toEqual({ wid: e.wid, didv: e.didv, reused: e.reused }),
  },

  // ---------------------------------------------------------------- www
  feed_hot: { run: async () => api.feedHot(await logged()) },
  feed_hot_next: { run: async () => api.feedHot(await logged(), '1') },
  video_detail: { run: async () => api.videoDetail(await logged(), PHOTO), result: (a, e) => expect(a).toEqual(e) },
  short_video_reco: { run: async () => api.shortVideoReco(await logged(), PHOTO), result: (a, e) => expect(a).toEqual(e) },
  comment_list: { run: async () => api.commentList(await logged(), PHOTO, 'cur1') },
  comment_list_gql: { run: async () => api.commentListGql(await logged(), PHOTO, 'cur1'), result: (a, e) => expect(a).toEqual(e) },
  sub_comment_list: { run: async () => api.subCommentList(await logged(), '3xgv6ute4cr9szw', '1139746042562', '') },
  profile_get: { run: async () => api.profile(await logged()) },
  profile_feed: { run: async () => api.profileFeed(await logged(), EID, 'cur1') },
  profile_feed_then_liked: {
    run: async () => {
      const k = await logged()
      await api.profileFeed(k, EID)
      return api.likedList(k, '')
    },
  },
  search_feed: { run: async () => api.searchFeed(await logged(), '美食 a&b') },
  search_feed_next: { run: async () => api.searchFeed(await logged(), '美食', '1', 'sess') },
  search_user: { run: async () => api.searchUser(await logged(), '美食') },
  search_user_next: { run: async () => api.searchUser(await logged(), '美食', '2', 'sess') },
  relation_following: {
    run: async () => {
      const k = await logged()
      k.s.selfEid = SELF_EID
      return api.relation(k, 1)
    },
  },
  relation_fans: {
    run: async () => {
      const k = await logged()
      k.s.selfEid = SELF_EID
      return api.relation(k, 2)
    },
  },
  liked_list: { run: async () => api.likedList(await logged(), 'cur1') },
  collect_list: { run: async () => api.collectList(await logged(), EID, 'cur1') },
  playback_list: { run: async () => api.playbackList(await logged(), EID) },
  like_data: { run: async () => api.likeData(await logged()), result: (a, e) => expect(a).toEqual(e) },
  profile_reduced: { run: async () => api.profileReduced(await logged(), EID), result: (a, e) => expect(a).toEqual(e) },
  user_info: { run: async () => api.userInfo(await logged()), result: (a, e) => expect(a).toEqual(e) },

  // ---------------------------------------------------------------- 登录
  qr_start: { run: async () => api.qrStart(await logged(), api.SID_WWW, 'UNKNOWN') },
  qr_scan_result: { run: async () => api.qrScanResult(await logged(), 'fake-qr-token', 'fake-qr-sig', 'UNKNOWN') },
  qr_accept_result: { run: async () => api.qrAcceptResult(await logged(), 'fake-qr-token', 'fake-qr-sig', api.SID_WWW, 'UNKNOWN') },
  qr_callback: {
    run: async () => {
      const [data, cookies] = await api.qrCallback(await logged(), 'fake-qr-accepted', api.SID_WWW, 'UNKNOWN')
      return [data, obj(cookies)]
    },
    result: (a, e) => expect(a).toEqual(e),
  },
  request_mobile_code: { run: async () => api.requestMobileCode(await logged(), '13800000000') },
  mobile_code_login: {
    run: async () => obj((await api.mobileCodeLogin(await logged(), '13800000000', '123456'))[1]),
    result: (a, e) => expect(a).toEqual(e),
  },
  sts_www: { run: async () => obj(await api.stsLogin(await logged(), api.SID_WWW)), result: (a, e) => expect(a).toEqual(e) },
  sts_cp: { run: async () => obj(await api.stsLogin(await logged(), api.SID_CP)), result: (a, e) => expect(a).toEqual(e) },
  document_www: { run: async () => obj(await api.bootstrapDocument(await logged(), WWW, '/new-reco')), result: (a, e) => expect(a).toEqual(e) },
  document_cp: { run: async () => obj(await api.bootstrapDocument(await logged(), CP, '/article/publish/video?origin=www.kuaishou.com')), result: (a, e) => expect(a).toEqual(e) },
  pass_token_login: { run: async () => obj((await api.passTokenLogin(await logged(LIVE)))[1]), result: (a, e) => expect(a).toEqual(e) },
  refresh_live_session: { run: async () => api.refreshLiveSession(await logged(LIVE)), result: (a, e) => expect(a).toBe(e) },

  // ---------------------------------------------------------------- 直播
  home_list: { run: async () => api.homeList(await logged(LIVE)) },
  category_classify: { run: async () => api.categoryClassify(await logged(LIVE)) },
  gift_list: { run: async () => api.giftList(await logged(LIVE), STREAM, ROOM) },
  gift_list_more: { run: async () => api.giftList(await logged(LIVE), STREAM, ROOM, 0), result: (a, e) => expect(a).toEqual(e) },
  emoji_all_gifts: {
    run: async () => api.emojiAllGifts(await logged(LIVE), ROOM),
    result: (a, e) => {
      expect(a).toEqual(e)
      expect(norm.giftNames(a.data)).toEqual([
        ['1', '棒棒糖'],
        ['9', '粉丝团灯牌'],
      ])
    },
  },
  live_logout: {
    run: async () => {
      const k = await logged(LIVE)
      k.s.update([
        ['kpn', 'GAME_ZONE'],
        ['client_key', '65890b29'],
        ['kuaishou.live.bfb1s', 'fake-bfb1s'],
        ['kuaishou.live.web_st', 'fake-live-st'],
        ['kuaishou.live.web_ph', 'fake-live-ph'],
      ])
      const result = await api.liveLogout(k)
      return { result, cookies: Object.fromEntries(k.s.cookies) }
    },
    result: (a, e) => {
      expect(a.result).toEqual(e.result)
      expect(Object.keys(a.cookies)).toEqual(Object.keys(e.cookies))
      expect(a.cookies).toEqual(e.cookies)
    },
  },
  websocket_info: { run: async () => api.websocketInfo(await logged(LIVE), STREAM, ROOM) },

  // ---------------------------------------------------------------- 创作者中心
  authority_account_current: { run: async () => api.authorityAccountCurrent(await logged(CP)) },
  notification_unread_count: { run: async () => api.notificationUnreadCount(await logged(CP)) },
  video_photo_list: {
    run: async () => api.videoPhotoList(await logged(CP), { queryType: '0', cursor: 1790000000123, startTime: 0, endTime: 1790000000123, limit: 20, timeRangeType: 5, keyword: '' }),
  },
  atlas_upload_pre: { run: async () => api.atlasUploadPre(await logged(CP), 'image/png') },
  atlas_upload_pre_next: { run: async () => api.atlasUploadPre(await logged(CP), 'image/png', 777, 666) },
  atlas_single_finish: { run: async () => api.atlasUploadSingleFinish(await logged(CP), 666, 777, 'blob-1') },
  atlas_snapshot_save: { run: async () => api.atlasSnapshotSave(await logged(CP), 666, 777) },
  atlas_upload_finish: { run: async () => api.atlasUploadFinish(await logged(CP), 666, 777, ['blob-1', 'blob-2']) },
  publish_atlas: { run: async () => api.publishAtlas(await logged(CP), { caption: '图文#话题', fileId: 666, atlasId: 777, photoStatus: 2, publishTime: 0 }) },
  video_upload_pre: { run: async () => api.videoUploadPre(await logged(CP)) },
  uploader: {
    run: async () => {
      const k = await logged()
      return [await api.uploadResume(k, UPLOAD, 'fake-upload-token'), await api.uploadFragment(k, UPLOAD, 'fake-upload-token', 0, PNG, 0, PNG.length), await api.uploadComplete(k, UPLOAD, 'fake-upload-token', 1)]
    },
    result: (a, e) => expect(a).toEqual(e),
  },
}

/** 上游在 report / submit 上显式带了 connection、content-length、host（传输层字段），catbus 交给 HTTP 库生成。 */
const TRANSPORT = new Set(['connection', 'content-length', 'host'])
function withoutTransport(requests: GoldenRequest[]): GoldenRequest[] {
  return requests.map((r) => ({ ...r, headers: r.headers.filter(([k]) => !TRANSPORT.has(k.toLowerCase())) }))
}

describe('kuaishou 对拍：签名、预言机与请求构造', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, async () => {
      const g: GoldenCase = loadCase('kuaishou', name)
      const { requests, result, error } = await replay(g, c.run)
      if (error) throw error
      expectRequests(requests, g.requests)
      c.result?.(result, g.result)
    })
  }
})

/** 命令级 handler 的上下文：游客或登录态，写凭证的目录在临时目录。 */
function commandCtx(options: Record<string, unknown>, account: string | null = 'guest') {
  return makeCtx({ platform: 'kuaishou', account, options })
}

describe('kuaishou 对拍：命令流程', () => {
  it('游客第一次 feed list（默认 recommend，即 new-reco 推荐流）：设备身份 → webweapon 引导 → 指纹上报换 wid → 签名请求', async () => {
    const g = loadCase('kuaishou', 'guest_feed_hot')
    const { feedList } = await import('../src/platforms/kuaishou/web/commands.js')
    const ctx = commandCtx({ kind: 'recommend' })
    const { requests, result, error } = await replay(g, () => feedList(ctx) as Promise<any>)
    if (error) throw error
    expectRequests(requests, g.requests)
    const { data, page } = result as any
    expect(data[0][RAW]).toEqual(g.result.feeds[0])
    expect(data[0]).toMatchObject({
      id: PHOTO,
      kind: 'video',
      url: `https://www.kuaishou.com/short-video/${PHOTO}`,
      text: '测试作品 #话题',
      author: { id: EID, name: '作者' },
      cover: 'https://p1.a.yximgs.com/cover.jpg',
      media: [{ type: 'video', url: 'https://v1.kwaicdn.com/high.mp4', width: 720, height: 1280, duration: 16 }],
      stats: { views: 821000, likes: 12345, comments: 7 },
    })
    expect(page).toEqual({ cursor: null, has_more: false })
    // 设备身份与 wid 留在游客凭证里；6 分钟票据不落盘
    const names = ctx.credential.scopes.main!.cookies.map((x) => x.name)
    expect(names).toEqual(expect.arrayContaining(['did', 'didv', 'wid', 'kwfv1', 'kpf', 'clientid', 'kpn']))
    expect(names).not.toContain('kwscode')
    expect(names).not.toContain('kwssectoken')
    expect(ctx.credential.device.kwfcv1).toBeTruthy()
  })

  it('扫码登录：www 扫码 + STS + 文档 → CP STS + 文档 → 设备指纹 → 直播站换票 → userInfo 校验', async () => {
    const g = loadCase('kuaishou', 'qrcode_login_flow')
    const { authLogin } = await import('../src/platforms/kuaishou/web/commands.js')
    const ctx = commandCtx({ method: 'qrcode' }, null)
    const { requests, result, error } = await replay(g, () => authLogin(ctx) as Promise<any>)
    if (error) throw error
    expectRequests(requests, g.requests)
    expect(result).toMatchObject({ platform: 'kuaishou', account: 'default', user: { id: SELF_EID, name: '测试' }, method: 'qrcode' })
    // 子站点分区：www / 设备在 main，创作者中心在 cp，直播在 live
    const { readCredential } = await import('../src/core/auth-store.js')
    const saved = (await readCredential('kuaishou', 'web', 'default'))!
    expect(saved.scopes.cp!.cookies.map((c) => c.name)).toEqual(['kuaishou.web.cp.api_st', 'kuaishou.web.cp.api_ph'])
    expect(saved.scopes.live!.cookies.map((c) => c.name)).toEqual(expect.arrayContaining(['kuaishou.live.web_st', 'kuaishou.live.web_ph', 'kuaishou.live.web.at']))
    const expected = { ...g.result.cookies, kwpsecproductname: 'kuaishou-vision' }
    delete expected.kwscode
    delete expected.kwssectoken
    expect(obj(credentialCookies(saved))).toEqual(expected)
    expect(saved.device.kwfcv1).toBe(g.result.kwfcv1)
  })

  it('图文发布：权限预检 → 编辑器预请求 → upload/pre → 分片上传 → single finish → 草稿 → finish → submit', async () => {
    const g = loadCase('kuaishou', 'publish_atlas_flow')
    const { itemPublish } = await import('../src/platforms/kuaishou/web/commands.js')
    const ctx = makeCtx({ platform: 'kuaishou', options: { image: [join(tmp, 'pic.png')], text: '我的图文 #话题', visibility: 'public' } })
    ctx.credential.scopes.main!.cookies = COOKIES.map(([name, value]) => ({ name, value, domain: '.kuaishou.com', path: '/', expires: null }))
    const { requests, result, error } = await replay(g, async () => {
      // 命令会丢掉凭证里的 6 分钟票据重新引导；这里与 gen.py 的已物化会话对齐，直接从同一组 cookie 起步
      const cmd = await import('../src/platforms/kuaishou/web/client.js')
      const init = cmd.Ks.prototype.init
      cmd.Ks.prototype.init = function (this: Ks) {
        return init.call(this, COOKIES)
      }
      try {
        return (await itemPublish(ctx)) as any
      } finally {
        cmd.Ks.prototype.init = init
      }
    })
    if (error) throw error
    expectRequests(requests, g.requests)
    expect(result).toMatchObject({ id: '777', kind: 'image', text: '我的图文 #话题', status: 'reviewing', media: [{ type: 'image', url: 'https://p1.a.yximgs.com/atlas-1.png' }] })
  })

  it('视频发布：权限预检 → CP 0.1.1 webweapon（kwfcv1=999）→ upload/pre → 分片上传 → finish → 封面上报 → submit(sig4) → 发布后管理页 photo/list → publish/refresh', async () => {
    const g = loadCase('kuaishou', 'publish_video_flow')
    const { itemPublish } = await import('../src/platforms/kuaishou/web/commands.js')
    const ctx = makeCtx({ platform: 'kuaishou', options: { video: join(tmp, 'clip.mp4'), visibility: 'private' } })
    const { requests, result, error } = await replay(g, async () => {
      const cmd = await import('../src/platforms/kuaishou/web/client.js')
      const init = cmd.Ks.prototype.init
      cmd.Ks.prototype.init = function (this: Ks) {
        return init.call(this, COOKIES)
      }
      try {
        return (await itemPublish(ctx)) as any
      } finally {
        cmd.Ks.prototype.init = init
      }
    })
    if (error) throw error
    expectRequests(requests, withoutTransport(g.requests))
    // 作品 id 来自 publish/refresh（发布完成后才有 workId），作者来自管理页的这一行
    expect(result).toMatchObject({
      id: '3xfakework0002',
      kind: 'video',
      url: 'https://www.kuaishou.com/short-video/3xfakework0002',
      author: { id: SELF_EID, name: '测试' },
      status: 'private',
    })
    // 改 text / status 时不能丢掉 --raw 用的原始对象
    expect(result[RAW]).toMatchObject({ publishId: 424242, workId: '3xfakework0002' })
  })

  it('live gifts：直播首页找房间 → 首屏礼物 → “更多礼物”（sortType=0）', async () => {
    const g = loadCase('kuaishou', 'live_gifts_flow')
    const { liveGifts } = await import('../src/platforms/kuaishou/web/commands.js')
    const ctx = makeCtx({ platform: 'kuaishou', args: { room: ROOM } })
    const { requests, result, error } = await replay(g, async () => {
      const init = Ks.prototype.init
      Ks.prototype.init = function (this: Ks) {
        return init.call(this, COOKIES)
      }
      try {
        return (await liveGifts(ctx)) as any
      } finally {
        Ks.prototype.init = init
      }
    })
    if (error) throw error
    expectRequests(requests, g.requests)
    expect(result.map((x: any) => [x.id, x.name, x.price?.amount])).toEqual([
      ['1', '棒棒糖', 1],
      ['2', '小心心', 0],
      ['3', '火箭', 5000],
    ])
  })
})

describe('kuaishou 归一化', () => {
  it('作品详情：manifest 取最高画质，计数转整数', () => {
    const d = loadCase('kuaishou', 'video_detail').result
    const item = norm.detail(d)
    expect(item).toMatchObject({ id: PHOTO, kind: 'video', author: { id: EID, name: '作者', url: `https://www.kuaishou.com/profile/${EID}` }, stats: { views: 821000, likes: 12345, comments: 7 } })
    expect(item.created_at).toBe('2026-09-21T19:26:40+08:00')
    expect(norm.photoMedia(d.photo)[0]).toMatchObject({ url: 'https://v1.kwaicdn.com/high.mp4', duration: 16 })
  })

  it('评论、用户、直播间', () => {
    const c = loadCase('kuaishou', 'comment_list_gql').result.rootCommentsV2[0]
    expect(norm.comment(c, PHOTO)).toMatchObject({ id: '111', item_id: PHOTO, author: { id: EID, name: '甲' }, text: '好看', stats: { likes: 12, replies: null } })
    expect(norm.reducedUser(loadCase('kuaishou', 'profile_reduced').result)).toMatchObject({ id: EID, name: '作者', bio: '简介' })
    const room = loadCase('kuaishou', 'home_list').result.data.list[0].gameLiveInfo[0].liveInfo[0]
    expect(norm.liveRoom(room)).toMatchObject({ id: ROOM, url: `https://live.kuaishou.com/u/${ROOM}`, status: 'live', host: { id: ROOM, name: '主播' }, stats: { viewers: 15000 } })
  })
})

describe('kuaishou 归一化（真实响应的结构）', () => {
  it('作品管理的列表：showAtlasIcon 判图集，作者取 userIdStr / userName', async () => {
    const norm = await import('../src/platforms/kuaishou/web/normalize.js')
    const row = { workId: '3xfakework0001', title: '', userIdStr: '3xfakeuser0001', userName: '测试用户', uploadTime: 1788067637186, publishStatus: 4, showAtlasIcon: true, playCount: 1 }
    expect(norm.work(row)).toMatchObject({
      id: '3xfakework0001',
      kind: 'image',
      author: { id: '3xfakeuser0001', name: '测试用户', url: 'https://www.kuaishou.com/profile/3xfakeuser0001' },
      text: null,
    })
    expect(norm.work({ ...row, showAtlasIcon: false }).kind).toBe('video')
  })
})

describe('kuaishou 滑块缺口：背景图是 JPEG', () => {
  it('真实下发的背景图是 JPEG：解码要等 loadImage，得到与 PNG 相同的缺口位置（同步解码会画成全黑）', async () => {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas')
    const input = loadCase('kuaishou', 'captcha_gap').input
    const bgPng = Buffer.from(input.match[0], 'base64')
    const cut = Buffer.from(input.match[1], 'base64')
    const im = await loadImage(bgPng)
    const c = createCanvas(im.width, im.height)
    c.getContext('2d').drawImage(im, 0, 0)
    const bgJpeg = c.toBuffer('image/jpeg', 95)
    const expected = await findGapX(bgPng, cut)
    expect(Math.abs((await findGapX(bgJpeg, cut)) - expected)).toBeLessThanOrEqual(2)
  })
})

describe('kuaishou 业务码映射', () => {
  it('result=109 是需要登录；result=2 按风控处理（实测登录态正常时也会返回）', () => {
    const k = new Ks(makeCtx({ platform: 'kuaishou', account: 'default' }))
    expect(() => k.check({ result: 109 }, '搜索')).toThrow(expect.objectContaining({ code: 'AUTH_EXPIRED' }))
    expect(() => k.check({ result: 2 }, '搜索')).toThrow(expect.objectContaining({ code: 'RISK_CONTROL', detail: { kind: 'blocked', result: 2 } }))
  })
})

// ================================================================ 命令级测试（catbus 自己的逻辑，没有上游对拍）

interface SentRequest {
  method: string
  url: URL
  body: any
}
type Reply = unknown | Error | { status: number; headers: [string, string][]; body: unknown }

/** 响应：普通值按 JSON 回复；Error 当作网络层抛出；带 status 与 headers 的按原样回复。 */
function reply(r: Reply, url: string): HttpResponse {
  if (r instanceof Error) throw r
  if (r && typeof r === 'object' && 'status' in r && 'headers' in r && 'body' in r) {
    const x = r as { status: number; headers: [string, string][]; body: unknown }
    return fakeResponse(typeof x.body === 'string' ? x.body : JSON.stringify(x.body), { status: x.status, headers: x.headers, url })
  }
  return fakeResponse(JSON.stringify(r ?? {}), { status: 200, headers: [['content-type', 'application/json']], url })
}

/**
 * 命令级会话：随机数与时钟固定，Ks 从已物化的 COOKIES（加上 extra）起步、init 不出网，请求交给 respond 回复。
 */
async function session<T>(respond: (req: SentRequest) => Reply, run: () => Promise<T>, extra: [string, string][] = []) {
  const requests: SentRequest[] = []
  const restoreRand = rand.deterministic()
  const init = Ks.prototype.init
  Ks.prototype.init = function (this: Ks) {
    return init.call(this, [...COOKIES, ...extra])
  }
  const restoreSender = mockSender((p) => {
    const text = p.body == null ? null : typeof p.body === 'string' ? p.body : Buffer.from(p.body).toString('utf8')
    let body: any = text
    try {
      body = text ? JSON.parse(text) : text
    } catch {}
    const req = { method: p.method, url: new URL(p.url), body }
    requests.push(req)
    return reply(respond(req), p.url)
  })
  try {
    return { requests, result: (await run()) as T, error: undefined as any }
  } catch (error) {
    return { requests, result: undefined as T | undefined, error: error as any }
  } finally {
    restoreSender()
    Ks.prototype.init = init
    restoreRand()
  }
}

const FEED = loadCase('kuaishou', 'feed_hot').responses[0]!.body as any
const feedOf = (id: string) => ({ ...FEED.feeds[0], photo: { ...FEED.feeds[0].photo, id } })
const paths = (requests: SentRequest[]) => requests.map((r) => r.url.pathname)

describe('kuaishou feed list（推荐流翻页）', () => {
  it('每页都回 pcursor="1"：游标带上已取的页数，--limit 能翻过两页；翻页请求仍按 pcursor="1" 发 {}', async () => {
    const { newCredential, setCurrent, writeCredential } = await import('../src/core/auth-store.js')
    const { cli } = await import('./helpers.js')
    await writeCredential(newCredential({ platform: 'kuaishou', endpoint: 'web', account: 'feed', method: 'cookie' }))
    await setCurrent('kuaishou', 'web', 'feed')
    let n = 0
    const { requests, result } = await session(
      (req) => (req.url.pathname === '/rest/v/feed/hot' ? { result: 1, pcursor: '1', feeds: [feedOf(`p${++n}`), feedOf(`p${++n}`)] } : { result: 1 }),
      () => cli('kuaishou', 'feed', 'list', '--limit', '5'),
    )
    const hot = requests.filter((r) => r.url.pathname === '/rest/v/feed/hot')
    expect(hot.map((r) => r.body)).toEqual([null, {}, {}])
    expect(result!.env.data.map((x: any) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    // 截在第三页中间：游标指回第三页（已取两页），续翻时跳过已经输出的一条
    expect(result!.env.page).toEqual({ cursor: '1:2#skip=1', has_more: true })
    await setCurrent('kuaishou', 'web', null)
  })

  it('游标解析：页数递增；某页没有作品或 pcursor 表示没有更多时停止；游标不合法报 USAGE', async () => {
    const { feedList } = await import('../src/platforms/kuaishou/web/commands.js')
    const page = async (cursor: string | null, body: unknown) => {
      const { requests, result, error } = await session(() => body, () => feedList(makeCtx({ platform: 'kuaishou', options: { kind: 'recommend' }, cursor })) as Promise<any>)
      if (error) throw error
      return { body: requests[0]!.body, page: result.page }
    }
    expect(await page(null, { result: 1, pcursor: '1', feeds: [FEED.feeds[0]] })).toEqual({ body: null, page: { cursor: '1:1', has_more: true } })
    expect(await page('1:7', { result: 1, pcursor: '1', feeds: [FEED.feeds[0]] })).toEqual({ body: {}, page: { cursor: '1:8', has_more: true } })
    // 旧版本输出的 '1' 按已取一页处理
    expect((await page('1', { result: 1, pcursor: '1', feeds: [FEED.feeds[0]] })).page.cursor).toBe('1:2')
    expect((await page('1:3', { result: 1, pcursor: '1', feeds: [] })).page).toEqual({ cursor: null, has_more: false })
    expect((await page('1:3', { result: 1, pcursor: 'no_more', feeds: [FEED.feeds[0]] })).page).toEqual({ cursor: null, has_more: false })
    await expect(page('1:x', {})).rejects.toMatchObject({ code: 'USAGE' })
  })
})

describe('kuaishou item list（作品管理，按年窗口）', () => {
  const YEAR = 365 * 86_400_000
  const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ workId: `3xw${i}`, publishStatus: 1, uploadTime: 1789000000000 - i }))
  async function list(cursor: string | null, body: unknown) {
    const { itemList } = await import('../src/platforms/kuaishou/web/commands.js')
    const { requests, result, error } = await session(() => body, () => itemList(makeCtx({ platform: 'kuaishou', cursor })) as Promise<any>)
    const sent = requests.find((r) => r.url.pathname === '/rest/cp/works/v2/video/pc/photo/list')?.body
    return { sent, result, error, count: requests.length }
  }
  const now = rand.DEFAULT_NOW

  it('第一页：窗口是最近一年；一页满 20 条就在窗口里按 nextCursor 接着翻', async () => {
    const { sent, result } = await list(null, { result: 1, data: { list: rows(20), nextCursor: 1788000000000 } })
    expect(sent).toMatchObject({ queryType: '0', cursor: now, startTime: now - YEAR, endTime: now, limit: 20, timeRangeType: 5, keyword: '' })
    expect(result.data).toHaveLength(20)
    expect(result.page).toEqual({ cursor: `1788000000000:${now}`, has_more: true })
  })

  it('窗口翻完（一页不满 20 条、或者没有 nextCursor）：窗口前移一年', async () => {
    const end = now - 1000
    const { sent, result } = await list(`1788000000000:${end}`, { result: 1, data: { list: rows(3), nextCursor: 1787000000000 } })
    expect(sent).toMatchObject({ cursor: 1788000000000, startTime: end - YEAR, endTime: end })
    expect(result.page).toEqual({ cursor: `${end - YEAR - 1}:${end - YEAR - 1}`, has_more: true })
    // 窗口里上一页恰好满 20 条、这一页是空的：窗口有作品，照样前移
    expect((await list(`1788000000000:${end}`, { result: 1, data: { list: [] } })).result.page.has_more).toBe(true)
    expect((await list(null, { result: 1, data: { list: rows(20) } })).result.page).toEqual({ cursor: `${now - YEAR - 1}:${now - YEAR - 1}`, has_more: true })
  })

  it('一整个窗口没有作品、或者窗口早于快手上线时停止；旧版本的纯数字游标按窗口终点为现在处理', async () => {
    const end = now - YEAR - 1
    expect((await list(`${end}:${end}`, { result: 1, data: { list: [] } })).result.page).toEqual({ cursor: null, has_more: false })
    expect((await list(null, { result: 1, data: { list: [] } })).result.page).toEqual({ cursor: null, has_more: false })
    const old = Date.parse('2011-06-01T00:00:00+08:00')
    expect((await list(`${old}:${old}`, { result: 1, data: { list: rows(1) } })).result.page).toEqual({ cursor: null, has_more: false })
    const legacy = await list('1788000000000', { result: 1, data: { list: rows(20), nextCursor: 1787000000000 } })
    expect(legacy.sent).toMatchObject({ cursor: 1788000000000, startTime: now - YEAR, endTime: now })
    expect(legacy.result.page.cursor).toBe(`1787000000000:${now}`)
    expect((await list('abc', {})).error).toMatchObject({ code: 'USAGE' })
  })

  it('前移过的窗口服务端不认：当作没有更早的作品；第一个窗口出错照常报错，登录墙不吞', async () => {
    const end = now - YEAR - 1
    expect((await list(`${end}:${end}`, { result: 500, message: '时间范围不能大于1年' })).result.page).toEqual({ cursor: null, has_more: false })
    expect((await list(null, { result: 500, message: '时间范围不能大于1年' })).error).toMatchObject({ code: 'UPSTREAM', message: '时间范围不能大于1年' })
    expect((await list(`${end}:${end}`, { result: 109 })).error).toMatchObject({ code: 'AUTH_EXPIRED' })
  })
})

describe('kuaishou user get / 参数归一化', () => {
  async function userGet(profile: unknown) {
    const { userGet } = await import('../src/platforms/kuaishou/web/commands.js')
    return session(() => ({ data: { visionProfileReduced: profile } }), () => userGet(makeCtx({ platform: 'kuaishou', args: { user: EID } })) as Promise<any>)
  }

  it('visionProfileReduced 的 result 与其他接口一样映射：109 需要登录、2 风控；result=1 没有 userProfile 是用户不存在', async () => {
    expect((await userGet({ result: 109 })).error).toMatchObject({ code: 'AUTH_EXPIRED' })
    expect((await userGet({ result: 2 })).error).toMatchObject({ code: 'RISK_CONTROL', detail: { kind: 'blocked', result: 2 } })
    expect((await userGet({ result: 1 })).error).toMatchObject({ code: 'UPSTREAM', detail: { result: 1, user: EID } })
    expect((await userGet(loadCase('kuaishou', 'profile_reduced').result)).result).toMatchObject({ id: EID, name: '作者' })
  })

  it('直播间链接不是用户主页：直接报 USAGE，不发请求', async () => {
    const { resolveUser } = await import('../src/platforms/kuaishou/web/resolve.js')
    const { requests, error } = await session(() => ({}), () => resolveUser(new Ks(makeCtx({ platform: 'kuaishou' })), `https://live.kuaishou.com/u/${ROOM}`))
    expect(error).toMatchObject({ code: 'USAGE' })
    expect(requests).toEqual([])
  })
})

describe('kuaishou 发布后取状态（afterVideoPublish 的退路）', () => {
  const COVER = 'fake-cover-key'
  const row = { publishId: 424242, workId: null, publishStatus: 2, unPublishCoverKey: COVER, userIdStr: SELF_EID, userName: '测试', uploadTime: 1790000000000 }
  async function after(list: unknown, refresh: unknown = { result: 1, data: { list: [] } }) {
    const { afterVideoPublish } = await import('../src/platforms/kuaishou/web/commands.js')
    const k = await logged(CP)
    const out = await session((req) => (req.url.pathname.endsWith('/photo/list') ? list : refresh), () => afterVideoPublish(k, COVER))
    return { ...out, paths: paths(out.requests) }
  }

  it('photo/list 的 result≠1：返回 null（发布命令退回提交时的数据），不轮询', async () => {
    const r = await after({ result: 500 })
    expect(r.result).toBeNull()
    expect(r.paths).toEqual(['/rest/cp/works/v2/video/pc/photo/list'])
  })

  it('这一行不能拿去轮询（publishId 不是正整数 / 封面不是这次的）：只有唯一一行且封面对得上时用列表数据，否则 null', async () => {
    const own = await after({ result: 1, data: { list: [{ ...row, publishId: 0 }] } })
    expect(own.paths).toEqual(['/rest/cp/works/v2/video/pc/photo/list'])
    expect(own.result).toMatchObject({ author: { id: SELF_EID }, status: 'reviewing' })
    expect((await after({ result: 1, data: { list: [{ ...row, publishId: 0, unPublishCoverKey: 'other' }] } })).result).toBeNull()
    expect((await after({ result: 1, data: { list: [row, row] } })).result).toBeNull()
  })

  it('publish/refresh 失败：用列表这一行', async () => {
    const r = await after({ result: 1, data: { list: [row] } }, { result: 500 })
    expect(r.paths).toEqual(['/rest/cp/works/v2/video/pc/photo/list', '/rest/cp/works/v2/video/pc/publish/refresh'])
    expect(r.result).toMatchObject({ author: { id: SELF_EID } })
  })
})

describe('kuaishou live gifts：“更多礼物”失败时退回首屏', () => {
  it('sortType=0 撞上风控：不让整条命令失败，列出首屏礼物', async () => {
    const g = loadCase('kuaishou', 'live_gifts_flow')
    const bodies = g.responses.map((r) => r.body)
    const { liveGifts } = await import('../src/platforms/kuaishou/web/commands.js')
    let i = 0
    const { result, error, requests } = await session(
      () => (++i === 3 ? { data: { result: 2 } } : bodies[i - 1]),
      () => liveGifts(makeCtx({ platform: 'kuaishou', args: { room: ROOM } })) as Promise<any>,
    )
    if (error) throw error
    expect(requests).toHaveLength(3)
    expect(result.map((x: any) => [x.id, x.name])).toEqual([['1', '棒棒糖']])
  })
})

describe('kuaishou 服务端登出', () => {
  const PASSPORT_OK = {
    status: 200,
    headers: [
      ['content-type', 'application/json;charset=UTF-8'],
      ['set-cookie', 'userId=; Path=/; Max-Age=0'],
      ['set-cookie', 'userId=; Path=/; Domain=kuaishou.com; Max-Age=0'],
      ['set-cookie', 'passToken=; Path=/; Max-Age=0'],
    ] as [string, string][],
    body: '{"result":1}',
  }
  const LIVE_OK = {
    status: 200,
    headers: [
      ['content-type', 'application/json; charset=utf-8'],
      ['set-cookie', 'kuaishou.live.web_st=; Path=/'],
      ['set-cookie', 'kuaishou.live.web_ph=; Path=/'],
      ['set-cookie', 'userId=; Path=/'],
    ] as [string, string][],
    body: '{"data":{"result":1}}',
  }
  const TICKETS: [string, string][] = [
    ['kuaishou.live.web_st', 'fake-live-st'],
    ['kuaishou.live.web_ph', 'fake-live-ph'],
  ]

  it('直播站票据不全：先用 passToken 补一次，补上后按浏览器的方式登出', async () => {
    const { serverLogout } = await import('../src/platforms/kuaishou/web/commands.js')
    const { requests, error } = await session(
      (req) => {
        const p = req.url.pathname
        if (p === '/pass/kuaishou/login/passToken') return { result: 1, 'kuaishou.live.web.at': 'fake-live-at' }
        if (p === '/live_api/baseuser/userLogin') return { status: 200, headers: [['set-cookie', 'kuaishou.live.web_st=st2; Path=/'], ['set-cookie', 'kuaishou.live.web_ph=ph2; Path=/']], body: { data: { result: 1 } } }
        return p === '/pass/kuaishou/login/logout' ? PASSPORT_OK : LIVE_OK
      },
      () => serverLogout(makeCtx({ platform: 'kuaishou' })),
      [TICKETS[0]!],
    )
    if (error) throw error
    expect(paths(requests)).toEqual(['/pass/kuaishou/getCdns', '/pass/kuaishou/login/passToken', '/live_api/baseuser/userLogin', '/pass/kuaishou/login/logout', '/live_api/baseuser/userLogout'])
  })

  it('补票据没有成功：票据仍然不全，报错且不发登出请求', async () => {
    const { serverLogout } = await import('../src/platforms/kuaishou/web/commands.js')
    const { requests, error } = await session(() => ({ result: 400 }), () => serverLogout(makeCtx({ platform: 'kuaishou' })), [TICKETS[0]!])
    expect(error).toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('票据不全') })
    expect(paths(requests)).toEqual(['/pass/kuaishou/getCdns', '/pass/kuaishou/login/passToken'])
  })

  it('passport 登出的 Cookie 线缺字段（_assert_passport_logout_cookie）：不发登出请求', async () => {
    const k = await logged(LIVE)
    k.s.update(TICKETS)
    k.s.cookies.delete('bUserId')
    const { requests, error } = await session(() => ({}), () => api.liveLogout(k))
    expect(error).toMatchObject({ code: 'UPSTREAM', message: expect.stringContaining('Cookie 字段或顺序') })
    expect(requests).toEqual([])
  })
})

describe('kuaishou 扫码登录的轮询（core poll）', () => {
  it('长轮询读超时接着轮、偶发的网络错误容忍、等扫码时二维码过期换一张；已扫码后在手机上取消报 AUTH_REQUIRED', async () => {
    const g = loadCase('kuaishou', 'qrcode_login_flow')
    const { RequestError } = await import('wreq-js')
    const { authLogin } = await import('../src/platforms/kuaishou/web/commands.js')
    const scan: Reply[] = [new RequestError('Request timed out'), new RequestError('connection reset by peer'), { result: 0 }, { result: 707 }, { result: 1 }]
    const accept: Reply[] = [new RequestError('Request timed out'), { result: 711 }]
    const restoreRand = rand.deterministic({ seed: g.seed, now: g.now })
    const sent: string[] = []
    const restoreSender = mockSender((p) => {
      const path = new URL(p.url).pathname
      sent.push(path)
      if (path === '/s/w/c') return toResponse(g.responses[sent.length - 1]!, p.url)
      if (path.endsWith('/qr/start')) return toResponse(g.responses[2]!, p.url)
      return reply(path.endsWith('/qr/scanResult') ? scan.shift() : accept.shift(), p.url)
    })
    try {
      await expect(authLogin(commandCtx({ method: 'qrcode' }, null))).rejects.toMatchObject({ code: 'AUTH_REQUIRED', message: '已在手机上取消登录' })
    } finally {
      restoreSender()
      restoreRand()
    }
    const qr = sent.filter((p) => p.startsWith('/rest/c/infra/ks/qr/')).map((p) => p.split('/').pop())
    expect(qr).toEqual(['start', 'scanResult', 'scanResult', 'scanResult', 'scanResult', 'start', 'scanResult', 'acceptResult', 'acceptResult'])
  })
})
