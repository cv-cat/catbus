import { CatbusError } from '../../../core/errors.js'
import { parseJson } from '../../../core/http.js'
import { jsonDumps, type Pairs, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { HandlerContext } from '../../../core/registry.js'
import { b3TraceId, checkStatus, Session, type XhsJson } from './client.js'
import { checkSign, signFull } from './js.js'
import { PGY, UA } from './profile.js'
import { PcState } from './state.js'

/**
 * 蒲公英（上游 apis/xhs_pugongying_apis.py + xhs_pugongying_util.py）与千帆（apis/xhs_qianfan_apis.py + xhs_qianfan_util.py）。
 *
 * 都在 pgy.xiaohongshu.com，上游用 requests 直接带整串主站 cookie（`cookies=`），所以用主站凭证（main scope）。
 * 蒲公英的业务接口只带 X-s / X-t（PC 签名，没有 X-S-Common）；千帆的接口不签名。
 */

/** 上游 `json.dumps(data, separators=(',', ':'))`：紧凑，非 ASCII 转义。 */
const dumps = (v: unknown) => jsonDumps(v, { separators: [',', ':'] })

/**
 * 蒲公英 / 千帆拒绝当前账号（HTTP 401，或业务码"无登录信息"）：主站登录是好的，缺的是这两个站的权限，
 * 所以报 AUTH_REQUIRED 而不是 AUTH_EXPIRED（重新登录主站没用）。
 */
function noAccess(message?: string): CatbusError {
  return new CatbusError('AUTH_REQUIRED', `蒲公英 / 千帆拒绝了当前账号${message ? `（${message}）` : ''}`, {
    hint: '需要开通蒲公英（品牌 / 机构）或千帆的账号，并在浏览器里登录过 https://pgy.xiaohongshu.com',
  })
}

const PGY_UA_122 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const PGY_TIERS = { '0101': [205], '0201': [208], '0301': [200] } as Record<string, number[]>

export class Pgy extends Session {
  /** 上游 PuGongYingAPI.profile：第一次签名时用 cookie 建 PcDeviceProfile，之后复用（seq 递增）。 */
  private profile: PcState | null = null

  constructor(ctx: HandlerContext) {
    super(ctx, 'main')
  }

  /** 上游 requests 的 `cookies=` 会把整串 cookie 发往 pgy。 */
  cookies(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const c of this.jar.cookies) if (!(c.name in out)) out[c.name] = c.value
    return out
  }

  requireLogin(): void {
    const c = this.cookies()
    if (!c.a1 || !c.web_session) throw new CatbusError('AUTH_REQUIRED', '蒲公英 / 千帆需要登录小红书账号', { hint: 'catbus xhs auth login' })
  }

  /** 上游 generate_pugongying_headers：generate_xs（X-s / X-t）+ 固定的 Edge 122 头模板。 */
  signedHeaders(api: string, data = ''): [string, string][] {
    const cookies = this.cookies()
    if (!this.profile) this.profile = new PcState(cookies)
    else this.profile.updateCookies(cookies)
    const ctx = this.profile.nextSignContext(api)
    const input: Record<string, unknown> = { api, data, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '), a1: cookies.a1, b1: '', dslPair: '', tier: ctx.tier }
    for (const k of ['now', 'version', 'loadts', 'seq', 'envConst', 'envFpTail', 'webBuild', 'signVersion', 'appId', 'platform', 'deviceTag', 'webSsk']) if (k in ctx) input[k] = ctx[k]
    const r = checkSign(signFull(input), ctx.tier, PGY_TIERS[ctx.tier]!)
    const b3 = b3TraceId()
    return [
      ['authority', 'pgy.xiaohongshu.com'],
      ['accept', 'application/json, text/plain, */*'],
      ['accept-language', 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'],
      ['authorization', ''],
      ['cache-control', 'no-cache'],
      ['content-type', 'application/json;charset=UTF-8'],
      ['origin', PGY],
      ['pragma', 'no-cache'],
      ['referer', `${PGY}/solar/pre-trade/kol`],
      ['sec-ch-ua', '"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Windows"'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'same-origin'],
      ['user-agent', `${PGY_UA_122} Edg/122.0.0.0`],
      ['x-b3-traceid', b3],
      ['x-s', r.xs],
      ['x-t', String(r.xt)],
    ]
  }

  private async do(method: 'GET' | 'POST', url: string, headers: [string, string][], body?: string): Promise<XhsJson> {
    const cookie = Object.entries(this.cookies()).map(([k, v]) => `${k}=${v}`).join('; ')
    const all: [string, string][] = [...headers, ...(cookie ? ([['Cookie', cookie]] as [string, string][]) : [])]
    // 上游用 requests：头里没有 content-type 时不补（core/http 按 curl_cffi 的行为会补 application/octet-stream）
    const bare = body !== undefined && !headers.some(([k]) => k.toLowerCase() === 'content-type')
    const res = await this.send({ method, url, headers: all, ...(body !== undefined ? { body } : {}) }, [], bare)
    if (res.status === 401 || res.status === 403) throw noAccess(`HTTP ${res.status}`)
    checkStatus(res)
    return parseJson<XhsJson>(res)
  }

  override check<T>(body: XhsJson<T>): T {
    try {
      return super.check(body)
    } catch (err) {
      if (err instanceof CatbusError && (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_EXPIRED')) throw noAccess(err.message)
      throw err
    }
  }

  // ---------------------------------------------------------------- 蒲公英

  /** get_self_info：不签名的引导请求。 */
  selfInfo() {
    return this.do('GET', `${PGY}/api/solar/user/info`, [
      ['x-b3-traceid', b3TraceId()],
      ['referer', `${PGY}/role-introduce?needLogout=needLogout`],
      ['user-agent', UA],
      ['accept', 'application/json, text/plain, */*'],
    ])
  }

  pgyGet(api: string, params: Pairs) {
    const headers = this.signedHeaders(api)
    return this.do('GET', `${PGY}${api}?${urlencode(params)}`, headers)
  }

  pgyPost(api: string, data: unknown, signData = true) {
    const body = dumps(data)
    return this.do('POST', PGY + api, this.signedHeaders(api, signData ? body : ''), body)
  }

  /** get_all_categories。 */
  tagTree() {
    return this.do('GET', `${PGY}/api/solar/cooperator/content/tag_tree`, this.signedHeaders('/api/solar/cooperator/content/tag_tree'))
  }

  /** get_user_by_page：先取品牌 userId，再 track 拿 trackId，最后查列表。 */
  async kols(page: number, contentTag: string[] | null) {
    const self = this.check(await this.selfInfo())
    const data: Record<string, unknown> = {
      searchType: 1,
      column: 'comprehensiverank',
      sort: 'desc',
      pageNum: page,
      pageSize: 20,
      brandUserId: self?.userId,
      personalTags: [],
      featureTags: [],
      estimatePicReadPrice: [],
      estimateVideoReadPrice: [],
      fansNumberLower: null,
      fansNumberUpper: null,
      noteType: 0,
      gender: null,
      location: null,
      tradeType: '不限',
      fansAge: 0,
      fansGender: 0,
      fansNumUp: 0,
      cpc: false,
      excludeLowActive: false,
      newHighQuality: 0,
      efficiencyValid: 0,
      clothingIndustry: 0,
      firstIndustry: '',
      secondIndustry: '',
      activityCodes: [],
    }
    if (contentTag != null) data.contentTag = contentTag
    const track = this.check(await this.pgyPost('/api/solar/cooperator/blogger/track', data))
    data.trackId = track?.trackId
    return this.pgyPost('/api/solar/cooperator/blogger/v2', data)
  }

  /** get_user_detail / get_user_fans_detail / get_user_fans_history / get_user_notes_detail。 */
  kolSummary(userId: string) {
    return this.pgyGet('/api/solar/kol/dataV3/dataSummary', [['userId', userId], ['business', '0']])
  }
  kolFans(userId: string) {
    return this.pgyGet('/api/solar/kol/dataV3/fansSummary', [['userId', userId]])
  }
  kolFansHistory(userId: string) {
    return this.pgyGet(`/api/solar/kol/data/${userId}/fans_overall_new_history`, [['dateType', '1'], ['increaseType', '1']])
  }
  kolNotes(userId: string) {
    return this.pgyGet('/api/solar/kol/dataV3/notesRate', [['userId', userId], ['business', '0'], ['noteType', '3'], ['dateType', '1'], ['advertiseSwitch', '1']])
  }

  /** send_invite：注意上游签名时不带 body（`_signed_headers(cookies, api)`）。 */
  async invite(userId: string, o: { productName: string; start: string; end: string; content: string; contact: string }) {
    const self = this.check(await this.selfInfo())
    return this.pgyPost(
      '/api/solar/invite/initiate_invite',
      {
        kolId: userId,
        cooperateBrandId: self?.userId,
        cooperateBrandName: self?.nickName,
        inviteType: 1,
        productName: o.productName,
        expectedPublishTimeStart: o.start,
        expectedPublishTimeEnd: o.end,
        inviteContent: o.content,
        contactInfo: o.contact,
        contactType: 1,
        brandUserId: self?.userId,
      },
      false,
    )
  }

  // ---------------------------------------------------------------- 千帆

  private qfHeaders(): [string, string][] {
    return [
      ['authority', 'pgy.xiaohongshu.com'],
      ['accept', 'application/json, text/plain, */*'],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['cache-control', 'no-cache'],
      ['pragma', 'no-cache'],
      ['referer', `${PGY}/microapp/distribution/live-broadcast/kol`],
      ['sec-ch-ua', '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Windows"'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'same-origin'],
      ['user-agent', PGY_UA_122],
      ['x-b3-traceid', b3TraceId()],
    ]
  }

  private qfDetailHeaders(userId: string): [string, string][] {
    return [
      ['authority', 'pgy.xiaohongshu.com'],
      ['accept', 'application/json, text/plain, */*'],
      ['accept-language', 'zh-CN,zh;q=0.9'],
      ['cache-control', 'no-cache'],
      ['content-type', 'application/json;charset=UTF-8'],
      ['origin', PGY],
      ['pragma', 'no-cache'],
      ['referer', `${PGY}/microapp/distribution/live-blogger-info/${userId}`],
      ['sec-ch-ua', '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Windows"'],
      ['sec-fetch-dest', 'empty'],
      ['sec-fetch-mode', 'cors'],
      ['sec-fetch-site', 'same-origin'],
      ['user-agent', PGY_UA_122],
      ['x-b3-traceid', b3TraceId()],
    ]
  }

  /** get_all_categories（千帆）。 */
  qfTags() {
    return this.do('GET', `${PGY}/api/draco/distributor-square/distributors-tags?${urlencode([['types', 'content_category,distribution_category,user_design_tag,content_tag']])}`, this.qfHeaders())
  }

  /**
   * get_user_by_page（千帆）。上游 generate_qianfan_data 按交互输入的序号挑类目；这里直接收一级 / 二级类目名。
   * 上游的头模板没有 content-type，requests 发 data=str 时也不补，照抄。
   */
  qfList(page: number, first: string[] | null, second: string[]) {
    const headers = this.qfHeaders()
    const data: Record<string, unknown> = first ? { buyer_activity: [], live_plan_range: [], live_first_category: first, live_second_category: second } : { buyer_activity: [], live_plan_range: [] }
    data.seed = rand.randint(1000, 9999)
    data.page = page
    data.limit = 20
    return this.do('POST', `${PGY}/api/draco/distributor-square/distributors`, headers, dumps(data))
  }

  private qfDetail(path: string, body: unknown, userId: string) {
    return this.do('POST', `${PGY}/api/draco/distributor-square/distributor/${path}`, this.qfDetailHeaders(userId), dumps(body))
  }

  /** get_user_detail（千帆）。 */
  qfOverview(userId: string) {
    return this.qfDetail('detail/overview/v2', { buyer_id: userId, date_type: 2 }, userId)
  }

  private cooperative(kind: string, userId: string) {
    return this.qfDetail(`cooperative/${kind}/v2`, { buyer_id: userId, first_live_category: '', second_live_category: '', date_type: 2, page: 1, size: 10 }, userId)
  }
  /** get_user_cooperation / get_user_shop / get_user_item。 */
  qfCooperation(userId: string) {
    return this.cooperative('category', userId)
  }
  qfShop(userId: string) {
    return this.cooperative('shop', userId)
  }
  qfItems(userId: string) {
    return this.cooperative('item', userId)
  }

  /** get_user_fans（千帆，路径里的 distribuitor 是上游原样）。 */
  qfFans(userId: string) {
    return this.do('GET', `${PGY}/api/draco/distributor-square/distribuitor/detail/fans?${urlencode([['distributor_id', userId], ['date_type', '2']])}`, this.qfDetailHeaders(userId))
  }
}
