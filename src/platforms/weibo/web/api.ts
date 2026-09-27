import { CatbusError } from '../../../core/errors.js'
import { parseJson } from '../../../core/http.js'
import { type Pairs, jsonDumps } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import type { Weibo, WeiboJson } from './client.js'
import {
  commonHeaders,
  detailHeaders,
  formHeaders,
  htmlHeaders,
  MOBILE,
  postImageHeaders,
  postVideoHeaders,
  searchHeaders,
  uploadImageHeaders,
  uploadVideoHeaders,
  videoCheckHeaders,
  videoOutputHeaders,
  WEB,
} from './profile.js'
import { APP_SOURCE, sessionId, uploadImageParams, uploadVideoParams } from './sign.js'

/**
 * 上游 apis/*.py 的请求构造，一个函数对应一个上游方法，字段与顺序照抄（对拍测试逐字节比较）。
 * weibo.com 的接口返回整个 JSON（`{ok, data}`），已检查登录墙与业务错误。
 */

// ================================================================ WeiboApis（weibo.com）

export interface SelfInfo {
  uid: string
  nick: string
}

const CONFIG_RE = /try\{window\.\$CONFIG = (.*?);\}catch\(e\)\{window\.\$CONFIG/

/**
 * get_self_info：首页 HTML 里的 window.$CONFIG。与上游一样跟随跳转（登录态可能先经过 SSO 跳转）；
 * 没登录时最后落在访客页 / 登录页，没有 $CONFIG，返回 null。
 */
export async function selfInfo(w: Weibo): Promise<SelfInfo | null> {
  const page = await w.html('com', { url: `${WEB}/`, headers: htmlHeaders(), redirect: 'follow' })
  const raw = CONFIG_RE.exec(page.text)?.[1]
  if (!raw) return null
  let config: any
  try {
    config = JSON.parse(raw)
  } catch {
    return null
  }
  const uid = config?.user?.id
  if (uid == null || uid === '') return null
  return { uid: String(uid), nick: String(config.user.watermark?.nick ?? config.user.screen_name ?? '') }
}

/** getUserInfo：用户资料。 */
export function userInfo(w: Weibo, uid: string) {
  return w.json('com', { url: `${WEB}/ajax/profile/info`, headers: commonHeaders(w.xsrf), query: [['uid', uid]] })
}

/** getUserPosted：用户发布的微博，page 从 1 开始，since_id 取上一页返回的 data.since_id。 */
export function userPosted(w: Weibo, uid: string, page: number | string, sinceId = '') {
  const params: Pairs = [
    ['uid', uid],
    ['page', String(page)],
    ['feature', '0'],
  ]
  if (sinceId) params.push(['since_id', sinceId])
  return w.json('com', { url: `${WEB}/ajax/statuses/mymblog`, headers: commonHeaders(w.xsrf), query: params })
}

/**
 * getWordComments：一级评论。上游只取第一页；翻页时带上一页返回的 max_id（位置与网页一致，在 count 之前）。
 */
export function comments(w: Weibo, uid: string, mid: string, maxId?: string) {
  const params: Pairs = [
    ['is_reload', '1'],
    ['id', mid],
    ['is_show_bulletin', '2'],
    ['is_mix', '0'],
  ]
  if (maxId) params.push(['max_id', maxId])
  params.push(['count', '10'], ['uid', uid], ['fetch_level', '0'], ['locale', 'zh-CN'])
  return w.json('com', { url: `${WEB}/ajax/statuses/buildComments`, headers: commonHeaders(w.xsrf), query: params })
}

// ================================================================ WeiboMobileApis（m.weibo.cn）

const RENDER_RE = /var \$render_data = \[([\s\S]*?)\]\[0\] \|\| \{\};\n {2}var __wb_performance_data=\{v:"v8",m:"mainsite",pwa:1,sw:0\};/

/** getWorkInfo：详情页 HTML 里的 $render_data，返回其中的对象（含 status）。 */
export async function mobileDetail(w: Weibo, id: string): Promise<any> {
  const page = await w.html('cn', { url: `${MOBILE}/detail/${id}`, headers: detailHeaders() })
  const raw = RENDER_RE.exec(page.text)?.[1]
  if (!raw) {
    if (page.status >= 300 && page.status < 400) {
      throw new CatbusError('AUTH_REQUIRED', `m.weibo.cn 要求登录后查看这条微博`, { detail: { status: page.status, location: page.location } })
    }
    throw new CatbusError('UPSTREAM', `微博 ${id} 不存在、已删除或不可见`, { detail: { status: page.status } })
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new CatbusError('UPSTREAM', '无法解析微博详情页', { detail: { status: page.status } })
  }
}

/** searchSome：综合搜索（容器 100103type=1）。 */
export function mobileSearch(w: Weibo, query: string, page: number | string = 1, options: { retry?: boolean } = {}) {
  return w.json(
    'cn',
    {
      url: `${MOBILE}/api/container/getIndex`,
      headers: searchHeaders(),
      query: [
        ['containerid', `100103type=1&q=${query}`],
        ['page_type', 'searchall'],
        ['page', String(page)],
      ],
    },
    options,
  )
}

// ================================================================ WeiboCreaterApis

/** 上传类接口（picupload / fileplatform）的错误：返回 `{error, error_code}`。 */
function checkUpload(body: any, what: string): void {
  const error = body?.error ?? body?.errmsg
  if (!error) return
  if (error === 'user need identity authentication') {
    throw new CatbusError('UPSTREAM', '上传视频需要先在微博完成实名认证', { detail: { error, error_code: body.error_code ?? null } })
  }
  throw new CatbusError('UPSTREAM', `${what}失败：${error}`, { detail: { error, error_code: body.error_code ?? null } })
}

/** video_init：申请上传，返回 upload_id / media_id / auth。 */
export async function videoInit(w: Weibo, file: Uint8Array): Promise<any> {
  const t = String(rand.nowSeconds())
  const size = file.length
  const params: Pairs = [
    ['source', APP_SOURCE],
    ['size', size],
    ['name', 'video.mp4'],
    ['type', 'video'],
    ['client', 'web'],
    ['session_id', sessionId(size, 'video.mp4')],
  ]
  const data =
    `--2067456weiboPro${t}\r\nContent-Disposition: form-data; name="biz_file"\r\n\r\n` +
    '{"mediaprops":"{\\"screenshot\\":1}"}' +
    `\r\n--2067456weiboPro${t}--\r\n`
  const res = await w.request({ method: 'POST', url: 'https://fileplatform.api.weibo.com/2/fileplatform/init.json', headers: formHeaders(t), query: params, body: data })
  const body = await parseJson<any>(res)
  checkUpload(body, '申请上传视频')
  return body
}

/** upload_image_file：上传一张图片，返回 `{pic: {pid, ...}}`。 */
export async function uploadImage(w: Weibo, uid: string, nick: string, file: Uint8Array): Promise<any> {
  const url = `https://picupload.weibo.com/interface/upload.php?${uploadImageParams(uid, nick, file)}`
  const body = await parseJson<any>(await w.request({ method: 'POST', url, headers: uploadImageHeaders(), body: file }))
  checkUpload(body, '上传图片')
  if (!body?.pic?.pid) throw new CatbusError('UPSTREAM', '上传图片失败：没有返回 pid', { detail: { body } })
  return body
}

/** upload_video_file：整个文件作为一个分片上传。cookie 与上游一样发 weibo.com 的整串。 */
export async function uploadVideo(w: Weibo, uploadId: string, mediaId: string, file: Uint8Array, auth: string): Promise<any> {
  const url = `https://up.video.weibocdn.com/2/fileplatform/upload.json?${uploadVideoParams(uploadId, mediaId, file)}`
  const body = await parseJson<any>(await w.request({ method: 'POST', url, headers: uploadVideoHeaders(auth), body: file, cookies: w.webCookies() }))
  checkUpload(body, '上传视频')
  return body
}

/** video_check：通知上传完成。 */
export async function videoCheck(w: Weibo, uploadId: string, mediaId: string, fileSize: number, auth: string): Promise<any> {
  const form: Pairs = [
    ['source', APP_SOURCE],
    ['upload_id', uploadId],
    ['media_id', mediaId],
    ['upload_protocol', 'binary'],
    ['count', '1'],
    ['action', 'finish'],
    ['size', String(fileSize)],
    ['client', 'web'],
    ['status', ''],
  ]
  const res = await w.request({ method: 'POST', url: 'https://fileplatform.api.weibo.com/2/fileplatform/check.json', headers: videoCheckHeaders(auth), form })
  const body = await parseJson<any>(res)
  checkUpload(body, '确认上传视频')
  return body
}

/** video_output：转码结果；data 为空表示还没转完。 */
export async function videoOutput(w: Weibo, mediaId: string): Promise<WeiboJson> {
  return w.json('com', {
    url: `${WEB}/ajax/multimedia/output`,
    headers: videoOutputHeaders(),
    query: [
      ['source', APP_SOURCE],
      ['ids', mediaId],
      ['labels', 'screenshot'],
    ],
  })
}

/** post_weibo 里图文的 statuses/update：pic_id 是 `[{"type": "image/jpeg", "pid": ...}]`。 */
export function postImage(w: Weibo, content: string, visible: string, pids: string[]) {
  const picId = jsonDumps(pids.map((pid) => ({ type: 'image/jpeg', pid })))
  return w.json('com', {
    method: 'POST',
    url: `${WEB}/ajax/statuses/update`,
    headers: postImageHeaders(w.xsrf),
    form: [
      ['content', content],
      ['visible', visible],
      ['vote', ''],
      ['media', ''],
      ['pic_id', picId],
    ],
  })
}

/** post_weibo 里视频的 statuses/update。 */
export function postVideo(w: Weibo, content: string, visible: string, mediaId: string | number) {
  const media = {
    titles: [{ title: '', default: 'true' }],
    covers: [{ url: '' }],
    free_duration: { start: 0, end: 30 },
    type: 'video',
    media_id: mediaId,
    resource: { video_down: 1 },
    homemade: { channel_ids: [''], type: 0 },
    approval_reprint: '1',
  }
  return w.json('com', {
    method: 'POST',
    url: `${WEB}/ajax/statuses/update`,
    headers: postVideoHeaders(),
    form: [
      ['content', content],
      ['visible', visible],
      ['vote', ''],
      ['media', jsonDumps(media)],
    ],
  })
}
