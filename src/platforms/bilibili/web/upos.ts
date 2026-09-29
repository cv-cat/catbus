import { CatbusError } from '../../../core/errors.js'
import type { LocalMedia } from '../../../core/files.js'
import { type HttpRequest, parseJson } from '../../../core/http.js'
import { PROFILE } from './profile.js'
import type { Bili } from './client.js'

/**
 * upos 分片上传（上游 utils/upos.py）：preupload → 初始化分片 → 逐片 PUT → 合并。
 * 上游四段都走 http_util.request：带风控退避重试，cookie 是整份 B 站 cookie，发往 upos 节点（bilivideo.com）时也带。
 */

const PREUPLOAD = 'https://member.bilibili.com/preupload'
const PROFILE_NAME = 'ugcfx/bup'

function uposHeaders(auth = ''): [string, string][] {
  const h: [string, string][] = [
    ['user-agent', PROFILE.ua],
    ['origin', 'https://member.bilibili.com'],
    ['referer', 'https://member.bilibili.com/'],
  ]
  if (auth) h.push(['x-upos-auth', auth])
  return h
}

/** 请求并解析 JSON，`OK` 不是 1 时报 UPSTREAM（上游 raise RuntimeError）。不是 JSON 时 parseJson 报 UPSTREAM。 */
async function uposJson(b: Bili, stage: string, req: HttpRequest): Promise<any> {
  const res = await b.request(req)
  const body = await parseJson<any>(res)
  if (body?.OK !== 1) throw new CatbusError('UPSTREAM', `${stage}失败（HTTP ${res.status}）`, { detail: { status: res.status, body } })
  return body
}

export interface UploadedVideo {
  filename: string
  biz_id: unknown
  key: string
}

export async function uploadVideo(b: Bili, file: LocalMedia): Promise<UploadedVideo> {
  const size = file.data.length
  const cookies = Object.fromEntries(b.http.prepare({ url: PREUPLOAD }).cookies)
  const pre = await uposJson(b, 'preupload', {
    url: PREUPLOAD,
    headers: uposHeaders(),
    cookies,
    query: [
      ['name', file.filename],
      ['size', size],
      ['r', 'upos'],
      ['profile', PROFILE_NAME],
      ['ssl', 0],
      ['version', '2.14.0'],
      ['build', 2140000],
      ['webVersion', '2.14.0'],
    ],
    timeout: 30,
  })
  const endpoint = String(pre.endpoint).startsWith('//') ? 'https:' + pre.endpoint : pre.endpoint
  const key = String(pre.upos_uri).replace('upos://', '')
  const url = `${endpoint}/${key}`
  const chunkSize = Number(pre.chunk_size || 10 * 1024 * 1024)
  const chunks = Math.max(1, Math.ceil(size / chunkSize))

  // 这四个 query 字段来自投稿页 JS 的 uploadsQuery，少任何一个都会被 upos 以 InvalidArgument 拒绝
  const init = await uposJson(b, '初始化分片', {
    method: 'POST',
    url: `${url}?uploads&output=json`,
    headers: uposHeaders(pre.auth),
    cookies,
    query: [
      ['profile', PROFILE_NAME],
      ['filesize', size],
      ['partsize', chunkSize],
      ['biz_id', pre.biz_id],
    ],
    timeout: 60,
  })

  const parts: { partNumber: number; eTag: string }[] = []
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize
    const data = file.data.subarray(start, start + chunkSize)
    const end = start + data.length
    const res = await b.request({
      method: 'PUT',
      url: `${url}?partNumber=${i + 1}&uploadId=${init.upload_id}&chunk=${i}&chunks=${chunks}&size=${data.length}&start=${start}&end=${end}&total=${size}&output=json`,
      headers: uposHeaders(pre.auth),
      cookies,
      body: data,
      timeout: 300,
    })
    if (res.status !== 200) {
      throw new CatbusError('UPSTREAM', `分片 ${i + 1}/${chunks} 上传失败：HTTP ${res.status}`, { detail: { status: res.status, body: (await res.text()).slice(0, 200) } })
    }
    parts.push({ partNumber: i + 1, eTag: 'etag' })
    b.ctx.log.info(`上传 ${i + 1}/${chunks}`)
  }

  await uposJson(b, '分片合并', {
    method: 'POST',
    url,
    headers: uposHeaders(pre.auth),
    cookies,
    query: [
      ['output', 'json'],
      ['name', file.filename],
      ['profile', PROFILE_NAME],
      ['uploadId', init.upload_id],
      ['biz_id', pre.biz_id],
    ],
    json: { parts },
    timeout: 120,
  })
  const base = key.slice(key.lastIndexOf('/') + 1)
  return { filename: base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base, biz_id: pre.biz_id, key }
}
