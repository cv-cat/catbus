import { CatbusError } from '../../../core/errors.js'
import type { LocalMedia } from '../../../core/files.js'
import { PROFILE } from './profile.js'
import type { Bili } from './client.js'

/** upos 分片上传（上游 utils/upos.py）：preupload → 初始化分片 → 逐片 PUT → 合并。 */

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

export interface UploadedVideo {
  filename: string
  biz_id: unknown
  key: string
}

export async function uploadVideo(b: Bili, file: LocalMedia): Promise<UploadedVideo> {
  const size = file.data.length
  const pre = await (
    await b.http.request({
      url: PREUPLOAD,
      headers: uposHeaders(),
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
    })
  ).json<any>()
  if (pre.OK !== 1) throw new CatbusError('UPSTREAM', `preupload 失败`, { detail: pre })
  const endpoint = String(pre.endpoint).startsWith('//') ? 'https:' + pre.endpoint : pre.endpoint
  const key = String(pre.upos_uri).replace('upos://', '')
  const url = `${endpoint}/${key}`
  const chunkSize = Number(pre.chunk_size || 10 * 1024 * 1024)
  const chunks = Math.max(1, Math.ceil(size / chunkSize))

  const init = await (
    await b.http.request({
      method: 'POST',
      url: `${url}?uploads&output=json`,
      headers: uposHeaders(pre.auth),
      query: [
        ['profile', PROFILE_NAME],
        ['filesize', size],
        ['partsize', chunkSize],
        ['biz_id', pre.biz_id],
      ],
    })
  ).json<any>()
  if (init.OK !== 1) throw new CatbusError('UPSTREAM', '初始化分片失败', { detail: init })

  const parts: { partNumber: number; eTag: string }[] = []
  for (let i = 0; i < chunks; i++) {
    const start = i * chunkSize
    const data = file.data.subarray(start, start + chunkSize)
    const end = start + data.length
    const res = await b.http.request({
      method: 'PUT',
      url: `${url}?partNumber=${i + 1}&uploadId=${init.upload_id}&chunk=${i}&chunks=${chunks}&size=${data.length}&start=${start}&end=${end}&total=${size}&output=json`,
      headers: uposHeaders(pre.auth),
      body: data,
      timeout: 300,
    })
    if (res.status !== 200) throw new CatbusError('UPSTREAM', `分片 ${i + 1}/${chunks} 上传失败：HTTP ${res.status}`)
    parts.push({ partNumber: i + 1, eTag: 'etag' })
    b.ctx.log.info(`上传 ${i + 1}/${chunks}`)
  }

  const done = await (
    await b.http.request({
      method: 'POST',
      url,
      headers: uposHeaders(pre.auth),
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
  ).json<any>()
  if (done.OK !== 1) throw new CatbusError('UPSTREAM', '分片合并失败', { detail: done })
  const base = key.slice(key.lastIndexOf('/') + 1)
  return { filename: base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base, biz_id: pre.biz_id, key }
}
