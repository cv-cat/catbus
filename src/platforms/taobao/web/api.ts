import { CatbusError } from '../../../core/errors.js'
import type { LocalMedia } from '../../../core/files.js'
import { parseJson, parseJsonp } from '../../../core/http.js'
import type { Pairs } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import { authError } from '../../../core/toolkit.js'
import type { Taobao } from './client.js'
import { APP_KEY, DOC_HEADERS, IM_APP_KEY, LOGIN_TOKEN_URL, TOKEN_HEADERS, UA, UPLOAD_HEADERS, UPLOAD_URL } from './profile.js'
import { generateSign } from './sign.js'

/**
 * 上游 taobao_apis.py 的 TaobaoApis：一个函数对应一个上游方法，参数与顺序照抄（对拍测试逐字节比较）。
 */

/** `_m_h5_tk` 过期或缺失时，服务端在响应里下发新的，重试即可。 */
const TOKEN_RETRY = /令牌过期|令牌为空|FAIL_SYS_TOKEN_EXOIRED|FAIL_SYS_TOKEN_EMPTY/
const MAX_TOKEN_RETRY = 3

/**
 * get_token：`mtop.taobao.login.token.get.h5`，换取私信长连的 accessToken。
 * 返回 JSONP 里的整个 JSON。签名用 cookie `_m_h5_tk`；没有这个 cookie（游客、导入的 cookie 不全）
 * 时用空 token 签名，服务端会下发新的 `_m_h5_tk`，与令牌过期一样重试。
 */
export async function getToken(tb: Taobao): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const t = rand.nowSeconds() * 1000
    const data = `{"domain":"cntaobao","deviceId":"${tb.deviceId}","locale":"zh_CN","imAppKey":"${IM_APP_KEY}"}`
    const token = (tb.cookie('_m_h5_tk') ?? '').split('_')[0]!
    const query: Pairs = [
      ['jsv', '2.7.0'],
      ['appKey', APP_KEY],
      ['t', t],
      ['sign', generateSign(t, token, data)],
      ['api', 'mtop.taobao.login.token.get.h5'],
      ['v', '2.0'],
      ['preventFallback', 'true'],
      ['type', 'jsonp'],
      ['dataType', 'jsonp'],
      ['callback', 'mtopjsonp3'],
      ['data', data],
    ]
    const text = await tb.text({ url: LOGIN_TOKEN_URL, query, headers: TOKEN_HEADERS })
    const body = parseJsonp(text)
    if (body == null) throw new CatbusError('UPSTREAM', '淘宝返回的不是 mtop 的 JSONP', { detail: { body: text.slice(0, 300) } })
    if (attempt < MAX_TOKEN_RETRY && TOKEN_RETRY.test(String(body?.ret?.[0] ?? ''))) continue
    return body
  }
}

/** get_goods_uid_encrypt_uid 的第一步：打开商品页。 */
export async function goodsPage(tb: Taobao, goodsUrl: string): Promise<{ url: string; html: string }> {
  const res = await tb.request({ url: goodsUrl, headers: DOC_HEADERS })
  return { url: res.url || goodsUrl, html: await res.text() }
}

export interface Seller {
  uid: string
  encrypt_uid: string
}

/**
 * get_goods_uid_encrypt_uid 的第二步：从商品页 HTML 里取卖家的 `uid` 与 `encrypt_uid`。
 * 取不到时区分登录墙（游客打开商品页会被要求登录）、滑块验证和页面结构变化。
 */
export function parseSeller(tb: Taobao, page: { url: string; html: string }): Seller {
  const uid = /"userId":"(.*?)"/.exec(page.html)?.[1]
  const encrypt = /data-encryptuid="(.*?)"/.exec(page.html)?.[1]
  if (uid != null && encrypt != null) return { uid, encrypt_uid: encrypt }
  if (/login_jump|login\.taobao\.com\/member\/login|login\.m\.taobao\.com/.test(page.html) || /\/\/login\.(m\.)?taobao\.com\//.test(page.url)) {
    throw authError(tb.ctx, '淘宝要求登录后才能打开商品页')
  }
  if (/_____tmd_____|punish|x5sec/i.test(page.html)) {
    throw new CatbusError('RISK_CONTROL', '淘宝要求滑块验证，请稍后再试或在浏览器里打开一次商品页', { detail: { kind: 'captcha' } })
  }
  throw new CatbusError('UPSTREAM', '商品页里没有找到卖家信息', { detail: { url: page.url } })
}

/**
 * upload_media：上传图片，返回响应里的 `object`（fileId、url、size、pix）。
 * 上游不管文件是什么格式，Content-Type 一律写 image/png，这里照做。
 */
export async function uploadMedia(tb: Taobao, file: Pick<LocalMedia, 'data' | 'filename'>): Promise<any> {
  const res = await tb.request({
    method: 'POST',
    url: UPLOAD_URL,
    query: [
      ['appkey', 'ampmedia'],
      ['folderId', '0'],
      ['_input_charset', 'utf-8'],
      ['useGtrSessionFilter', 'false'],
    ],
    headers: UPLOAD_HEADERS,
    multipart: [
      { name: 'name', data: file.filename },
      { name: 'ua', data: UA },
      { name: 'file', data: file.data, filename: file.filename, contentType: 'image/png' },
    ],
  })
  const body = await parseJson<any>(res)
  if (body?.success && body.object) return body
  if (/NOT_LOGIN|SESSION/i.test(String(body?.errorCode ?? ''))) throw authError(tb.ctx, `淘宝登录态无效：${body.message ?? body.errorCode}`)
  throw new CatbusError('UPSTREAM', `上传失败：${body?.message ?? body?.errorCode ?? '未知错误'}`, {
    detail: { code: body?.errorCode ?? null, message: body?.message ?? null },
  })
}
