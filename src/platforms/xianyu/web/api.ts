import type { HttpRequest } from '../../../core/http.js'
import type { LocalMedia } from '../../../core/files.js'
import { CatbusError } from '../../../core/errors.js'
import { jsonDumps, type Pairs, pyStr, quote } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { type MtopJson, type Xianyu } from './client.js'
import {
  API_HEADERS,
  APP_KEY,
  H5API,
  IM_APP_KEY,
  LOCATION_HEADERS,
  merge,
  PASSPORT,
  PASSPORT_HEADERS,
  SESSION_HEADERS,
  TOKEN_HEADERS,
  UA,
  UPLOAD_HEADERS,
  UPLOAD_URL,
} from './profile.js'
import { generateSign } from './sign.js'

/**
 * 上游 goofish_apis.py 的请求构造，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）。
 * mtop 方法返回整个 JSON（上游返回 res_json），ret 已经检查过。
 */

interface Spm {
  v?: string
  spmCnt: string
  spmPre: string
  logId: string
  /** refresh_token 的 params 里一开始没有 sign，签名追加在最后。 */
  signLast?: boolean
}

const IM_SPM: Spm = { spmCnt: 'a21ybx.im.0.0', spmPre: 'a21ybx.item.want.1.12523da6waCtUp', logId: '12523da6waCtUp' }

function query(api: string, t: string, sign: string, o: Spm): Pairs {
  const q: Pairs = [
    ['jsv', '2.7.2'],
    ['appKey', APP_KEY],
    ['t', t],
  ]
  if (!o.signLast) q.push(['sign', sign])
  q.push(
    ['v', o.v ?? '1.0'],
    ['type', 'originaljson'],
    ['accountSite', 'xianyu'],
    ['dataType', 'json'],
    ['timeout', '20000'],
    ['api', api],
    ['sessionOption', 'AutoLoginOnly'],
    ['spm_cnt', o.spmCnt],
    ['spm_pre', o.spmPre],
    ['log_id', o.logId],
  )
  if (o.signLast) q.push(['sign', sign])
  return q
}

/** 签名的 mtop POST：`t` 是秒数乘 1000（上游 `str(int(time.time()) * 1000)`），表单只有一个 data 字段。 */
function signed<T = any>(x: Xianyu, api: string, dataVal: string, headers: HttpRequest['headers'], o: Spm): Promise<MtopJson<T>> {
  return x.mtop<T>((token) => {
    const t = String(rand.nowSeconds() * 1000)
    return {
      method: 'POST',
      url: `${H5API}/${api}/${o.v ?? '1.0'}/`,
      query: query(api, t, generateSign(t, token, dataVal), o),
      headers,
      form: [['data', dataVal]],
    }
  })
}

// ================================================================ XianyuApis

/** 私信的 accessToken（上游 get_token）。 */
export function getToken(x: Xianyu) {
  const dataVal = '{"appKey":"' + IM_APP_KEY + '","deviceId":"' + x.deviceId + '"}'
  return signed<{ accessToken?: string }>(x, 'mtop.taobao.idlemessage.pc.login.token', dataVal, TOKEN_HEADERS, {
    spmCnt: 'a21ybx.im.0.0',
    spmPre: 'a21ybx.item.want.1.14ad3da6ALVq3n',
    logId: '14ad3da6ALVq3n',
  })
}

/** 当前登录用户，同时续期 cookie（上游 refresh_token，常驻进程每 10 分钟调一次）。 */
export function refreshToken(x: Xianyu) {
  return signed(x, 'mtop.taobao.idlemessage.pc.loginuser.get', '{}', API_HEADERS, { ...IM_SPM, signLast: true })
}

/**
 * 商品详情（上游 get_item_info）。上游这个请求本身不带请求头，只有 session 上的 User-Agent
 * （扫码登录、游客的 session 来自 build_initial_cookies）。实测游客带上 Origin / Referer / sec-ch-ua
 * 这组浏览器头反而会被风控（RGV587），照上游只发 UA。
 */
export function itemInfo(x: Xianyu, itemId: string) {
  return signed(x, 'mtop.taobao.idle.pc.detail', '{"itemId":"' + itemId + '"}', SESSION_HEADERS, IM_SPM)
}

export interface ImageInfo {
  url: string
  width: number
  height: number
}

function imageInfo(image: ImageInfo) {
  return {
    extraInfo: { isH: 'false', isT: 'false', raw: 'false' },
    isQrCode: false,
    url: image.url,
    heightSize: image.height,
    widthSize: image.width,
    major: true,
    type: 0,
    status: 'done',
  }
}

/** 按标题和图片推荐类目与属性（上游 get_public_channel）。 */
export function publicChannel(x: Xianyu, title: string, images: ImageInfo[]) {
  const data = {
    title,
    lockCpv: false,
    multiSKU: false,
    publishScene: 'mainPublish',
    scene: 'newPublishChoice',
    description: title,
    imageInfos: images.map(imageInfo),
    uniqueCode: '1775905618164677',
  }
  return signed(x, 'mtop.taobao.idle.kgraph.property.recommend', jsonDumps(data, { separators: [',', ':'] }), API_HEADERS, {
    v: '2.0',
    spmCnt: 'a21ybx.publish.0.0',
    spmPre: 'a21ybx.item.sidebar.1.67321598K9Vgx8',
    logId: '67321598K9Vgx8',
  })
}

/** 发布地址：上游写死了一个坐标，取返回的第一个常用地址（上游 get_default_location）。 */
export function defaultLocation(x: Xianyu) {
  return signed(x, 'mtop.taobao.idle.local.poi.get', '{"longitude":118.78248347393424,"latitude":31.91629189813543}', LOCATION_HEADERS, {
    spmCnt: 'a21ybx.publish.0.0',
    spmPre: 'a21ybx.item.sidebar.1.38262218ame5nr',
    logId: '38262218ame5nr',
  })
}

export interface UploadObject {
  url: string
  pix?: string
  fileId?: unknown
  [key: string]: unknown
}

/** 上传图片（上游 upload_media）。content type 上游固定写 image/png。 */
export async function uploadMedia(x: Xianyu, file: LocalMedia): Promise<{ object: UploadObject; [key: string]: unknown }> {
  const res = await x.http.json({
    method: 'POST',
    url: UPLOAD_URL,
    query: [
      ['floderId', '0'],
      ['appkey', 'xy_chat'],
      ['_input_charset', 'utf-8'],
    ],
    headers: UPLOAD_HEADERS,
    multipart: [{ name: 'file', filename: file.filename, contentType: 'image/png', data: file.data }],
  })
  if (!res?.object?.url) throw new CatbusError('UPSTREAM', `上传失败：${res?.message ?? res?.errorMessage ?? '响应里没有 object.url'}`, { detail: res })
  return res
}

/** 发货方式（上游 DeliverySettings.choice 的四个取值）。 */
export type Shipping = 'free' | 'distance' | 'fixed' | 'none'

export interface PublishInput {
  images: LocalMedia[]
  desc: string
  /** 元；null 表示不填价格（上游 price=None → defaultPrice）。 */
  price: { current: number; original: number } | null
  shipping: Shipping
  /** 一口价运费，元。 */
  postage: number
  pickup: boolean
}

/** 发布闲置（上游 public）：先传图，再按标题推荐类目、取默认地址，最后提交。 */
export async function publish(x: Xianyu, input: PublishInput) {
  const data: Record<string, any> = {
    freebies: false,
    itemTypeStr: 'b',
    quantity: '1',
    simpleItem: 'true',
    imageInfoDOList: [],
    itemTextDTO: { desc: input.desc, title: input.desc, titleDescSeparate: false },
    itemLabelExtList: [],
    itemPriceDTO: {},
    userRightsProtocols: [{ enable: false, serviceCode: 'SKILL_PLAY_NO_MIND' }],
    itemPostFeeDTO: { canFreeShipping: false, supportFreight: false, onlyTakeSelf: false },
    itemAddrDTO: {},
    defaultPrice: false,
    itemCatDTO: {},
    uniqueCode: '1775897582791680',
    sourceId: 'pcMainPublish',
    bizcode: 'pcMainPublish',
    publishScene: 'pcMainPublish',
  }
  const images: ImageInfo[] = []
  for (const file of input.images) {
    const obj = (await uploadMedia(x, file)).object
    const [width, height] = String(obj.pix).split('x').map((s) => Math.trunc(Number(s)))
    const image = { url: obj.url, height: height!, width: width! }
    images.push(image)
    data.imageInfoDOList.push(imageInfo(image))
  }
  const fee = data.itemPostFeeDTO
  if (input.shipping === 'free') {
    fee.canFreeShipping = true
    fee.supportFreight = true
  } else if (input.shipping === 'distance') {
    fee.supportFreight = true
    fee.templateId = '-100'
  } else if (input.shipping === 'fixed') {
    fee.supportFreight = true
    fee.postPriceInCent = String(Math.trunc(input.postage * 100))
    fee.templateId = '0'
  } else fee.templateId = '0'
  // 上游写在顶层，不是 itemPostFeeDTO 里（照抄）
  if (input.pickup) data.onlyTakeSelf = true
  if (input.price) {
    if (input.price.current > 0) data.itemPriceDTO.priceInCent = String(Math.trunc(input.price.current * 100))
    if (input.price.original > 0) data.itemPriceDTO.origPriceInCent = String(Math.trunc(input.price.original * 100))
  } else data.defaultPrice = true

  const channel = (await publicChannel(x, input.desc, images)).data
  for (const card of channel.cardList ?? []) {
    const cd = card.cardData
    for (const value of cd.valuesList ?? []) {
      if (!value.isClicked) continue
      data.itemLabelExtList.push({
        channelCateName: value.catName,
        valueId: null,
        channelCateId: value.channelCatId,
        valueName: null,
        tbCatId: value.tbCatId,
        subPropertyId: null,
        labelType: 'common',
        subValueId: null,
        labelId: null,
        propertyName: cd.propertyName,
        isUserClick: '1',
        isUserCancel: null,
        from: 'newPublishChoice',
        propertyId: cd.propertyId,
        labelFrom: 'newPublish',
        text: value.catName,
        properties: `${pyStr(cd.propertyId)}##${pyStr(cd.propertyName)}:${pyStr(value.channelCatId)}##${pyStr(value.catName)}`,
      })
      break
    }
  }
  const cat = channel.categoryPredictResult
  data.itemCatDTO = { catId: pyStr(cat.catId), catName: pyStr(cat.catName), channelCatId: pyStr(cat.channelCatId), tbCatId: pyStr(cat.tbCatId) }

  const loc = (await defaultLocation(x)).data.commonAddresses[0]
  data.itemAddrDTO = {
    area: loc.area,
    city: loc.city,
    divisionId: loc.divisionId,
    gps: `${pyStr(loc.longitude)},${pyStr(loc.latitude)}`,
    poiId: loc.poiId,
    poiName: loc.poi,
    prov: loc.prov,
  }

  return signed(x, 'mtop.idle.pc.idleitem.publish', jsonDumps(data, { separators: [',', ':'] }), API_HEADERS, {
    spmCnt: 'a21ybx.publish.0.0',
    spmPre: 'a21ybx.home.sidebar.1.46413da6EPl7v5',
    logId: '46413da6EPl7v5',
  })
}

// ================================================================ 扫码登录（上游 qrcode_login）

const BIZ_PARAMS = `taobaoBizLoginFrom=web&renderRefer=${quote('https://www.goofish.com/')}`
const MINI_LOGIN = `${PASSPORT}/mini_login.htm`
const passportHeaders = (extra: [string, string][]) => merge(SESSION_HEADERS, merge(PASSPORT_HEADERS, extra))

/** 加载 mini_login 页面，拿 passport 域的 XSRF-TOKEN 等 cookie。 */
export function miniLogin(x: Xianyu) {
  return x.http.request({
    url: MINI_LOGIN,
    query: [
      ['lang', 'zh_cn'],
      ['appName', 'xianyu'],
      ['appEntrance', 'web'],
      ['styleType', 'vertical'],
      ['bizParams', ''],
      ['notLoadSsoView', 'false'],
      ['notKeepLogin', 'false'],
      ['isMobile', 'false'],
      ['qrCodeFirst', 'false'],
      ['stie', '77'],
      ['rnd', '0.6842814084442211'],
    ],
    headers: passportHeaders([
      ['Referer', 'https://www.goofish.com/'],
      ['sec-fetch-site', 'same-site'],
      ['sec-fetch-dest', 'iframe'],
      ['sec-fetch-mode', 'navigate'],
    ]),
  })
}

function loginParams(csrf: string, cookie2: string): Pairs {
  return [
    ['appName', 'xianyu'],
    ['fromSite', '77'],
    ['appEntrance', 'web'],
    ['_csrf_token', csrf],
    ['umidToken', ''],
    ['hsiz', cookie2],
    ['bizParams', BIZ_PARAMS],
    ['mainPage', 'false'],
    ['isMobile', 'false'],
    ['lang', 'zh_CN'],
    ['returnUrl', ''],
    ['umidTag', 'SERVER'],
  ]
}

export interface QrCode {
  codeContent: string
  t: string | number
  ck: string
}

/** 生成二维码。 */
export async function qrGenerate(x: Xianyu, csrf: string, cookie2: string): Promise<QrCode> {
  const res = await x.http.json({
    url: `${PASSPORT}/newlogin/qrcode/generate.do`,
    query: loginParams(csrf, cookie2),
    headers: passportHeaders([['Referer', MINI_LOGIN]]),
  })
  const data = res?.content?.data
  if (!data?.codeContent) throw new CatbusError('UPSTREAM', '生成二维码失败', { detail: res })
  return data
}

const postHeaders = () =>
  passportHeaders([
    ['Content-Type', 'application/x-www-form-urlencoded'],
    ['Origin', PASSPORT],
    ['Referer', MINI_LOGIN],
  ])

/** 查询扫码状态：NEW / SCANNED / CONFIRMED / EXPIRED。 */
export async function qrQuery(x: Xianyu, csrf: string, cookie2: string, cna: string, qr: QrCode): Promise<Record<string, any>> {
  const res = await x.http.json({
    method: 'POST',
    url: `${PASSPORT}/newlogin/qrcode/query.do?appName=xianyu&fromSite=77`,
    form: [
      ...loginParams(csrf, cookie2),
      ['navlanguage', 'en'],
      ['navUserAgent', UA],
      ['navPlatform', 'Win32'],
      ['isIframe', 'true'],
      ['documentReferer', 'https://www.goofish.com/'],
      ['defaultView', 'sms'],
      ['deviceId', cna],
      ['t', pyStr(qr.t)],
      ['ck', qr.ck],
    ],
    headers: postHeaders(),
  })
  return res?.content?.data ?? {}
}

/** 用扫码确认后的 token 完成登录。 */
export function loginByToken(x: Xianyu, token: string, cna: string) {
  return x.http.request({
    method: 'POST',
    url: `${PASSPORT}/login_token/login.do`,
    query: [
      ['token', token],
      ['subFlow', 'DIALOG_CHECK_LOGIN_RPC'],
      ['nextCode', '0018'],
      ['bizScene', 'qrcode'],
      ['confirm', 'true'],
    ],
    form: [['deviceId', cna]],
    headers: postHeaders(),
  })
}
