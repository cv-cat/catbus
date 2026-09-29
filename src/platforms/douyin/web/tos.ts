import { CatbusError } from '../../../core/errors.js'
import { quote } from '../../../core/py.js'
import type { Douyin } from './client.js'
import { crc32Hex } from './crypto.js'
import { CREATOR, PROFILE, WWW } from './profile.js'

/**
 * VOD ApplyUploadInner 之后把字节传到 TOS：小文件直传，大文件 init → 逐片 transfer → finish 合并。
 * 创作者中心（上游 douyin_creator_api 的 upload_video_direct / upload_video_parts）与私信（douyin_im_media 的
 * _upload_source）共用这一份流程；两边上游的差别收在 {@link TosStyle} 里。直传条件「不超过分片大小」
 * 实际就是不超过 3MB（更大的文件分片大小也小于文件本身），与私信的 DIRECT_UPLOAD_LIMIT 相同。
 */

export const MB = 1024 * 1024
/** VOD 网关（ApplyUploadInner / CommitUploadInner）的 Version。 */
export const VOD_VERSION = '2020-11-19'

/** ApplyUploadInner 返回的上传节点（UploadNodes[0] 与它的 StoreInfos[0]）。 */
export interface TosNode {
  store_uri: string
  auth: string
  upload_id: string
  upload_host: string
  session_key: string
  upload_header: Record<string, string>
}

/** 两处上游 TOS 请求的差别：页面来源、content-crc32 头的位置、uploadid 是否编码、成功码、报错前缀。 */
export interface TosStyle {
  /** origin 头；referer 为 `${origin}/`。 */
  origin: string
  /** content-crc32 紧跟 x-storage-u（创作者中心）；为 false 时放在 sec-fetch-site 之后（私信）。 */
  crcEarly: boolean
  /** 分片的 uploadid 按 urllib.parse.quote 编码（私信，`/` 不编码）；创作者中心原样拼进 URL。 */
  quoteUploadId: boolean
  /** 没有 code 的响应也算成功（私信的 _tos_post）；创作者中心只认 2000。 */
  lenient: boolean
  /** 报错信息的前缀。 */
  label: string
}

export const CREATOR_TOS: TosStyle = { origin: CREATOR, crcEarly: true, quoteUploadId: false, lenient: false, label: 'TOS' }
export const IM_TOS: TosStyle = { origin: WWW, crcEarly: false, quoteUploadId: true, lenient: true, label: 'IM TOS' }

/** 分片大小（上游 _slice_size_for，对齐 SDK getFileSliceLength）：≥500MB 用 10MB，≥100MB 用 5MB，否则 3MB。 */
export function sliceSize(size: number): number {
  return size >= 500 * MB ? 10 * MB : size >= 100 * MB ? 5 * MB : 3 * MB
}

/** TOS 上传头，字段与顺序照抄上游 _tos_headers：服务端下发的 UploadHeader 最后并上（同名的覆盖原位置的值）。 */
export function tosHeaders(style: TosStyle, node: TosNode, userId: string, crc?: string): [string, string][] {
  const h: Record<string, string> = { authorization: node.auth, referer: `${style.origin}/`, 'user-agent': PROFILE.ua, 'x-storage-u': quote(userId) }
  if (crc != null && style.crcEarly) h['content-crc32'] = crc
  Object.assign(h, {
    'content-type': 'application/octet-stream',
    accept: '*/*',
    'accept-language': PROFILE.acceptLanguage,
    origin: style.origin,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'cross-site',
  })
  if (crc != null && !style.crcEarly) h['content-crc32'] = crc
  return Object.entries({ ...h, ...node.upload_header })
}

async function tosPost(d: Douyin, style: TosStyle, url: string, h: [string, string][], data?: Uint8Array): Promise<any> {
  const res = await d.plain({ method: 'POST', url, headers: h, body: data, timeout: 300 })
  let body: any
  try {
    body = JSON.parse(await res.text())
  } catch {
    throw new CatbusError('UPSTREAM', `${style.label} 返回的不是 JSON（HTTP ${res.status}）`)
  }
  const ok = style.lenient ? [undefined, null, 2000, '2000'].includes(body.code) : body.code === 2000
  if (!ok) throw new CatbusError('UPSTREAM', `${style.label} 上传失败：${body.message ?? body.code}`, { detail: { code: body.code ?? null } })
  return body
}

/** 把整份字节传到节点上：不超过分片大小时直传，否则分片（片长至少 5MB）。 */
export async function tosUpload(d: Douyin, style: TosStyle, node: TosNode, data: Uint8Array, userId: string): Promise<void> {
  const size = data.length
  const slice = sliceSize(size)
  const base = `https://${node.upload_host}/upload/v1/${node.store_uri}`
  if (size <= slice) {
    await tosPost(d, style, base, tosHeaders(style, node, userId, crc32Hex(data)), data)
    return
  }
  const part = Math.max(slice, 5 * MB)
  let uploadId = node.upload_id
  if (!uploadId) {
    uploadId = (await tosPost(d, style, `${base}?uploadmode=part&phase=init`, tosHeaders(style, node, userId))).data?.uploadid
    if (!uploadId) throw new CatbusError('UPSTREAM', `${style.label} 分片上传初始化失败`)
  }
  const id = style.quoteUploadId ? quote(uploadId) : uploadId
  const crcs: string[] = []
  for (let offset = 0, i = 1; offset < size; offset += part, i++) {
    const chunk = data.subarray(offset, offset + part)
    const crc = crc32Hex(chunk)
    await tosPost(d, style, `${base}?uploadid=${id}&part_number=${i}&phase=transfer&part_offset=${offset}`, tosHeaders(style, node, userId, crc), chunk)
    crcs.push(crc)
    d.ctx.log.info(`分片上传 ${i} 片，${Math.min(offset + part, size)}/${size} 字节`)
  }
  await tosPost(d, style, `${base}?uploadmode=part&phase=finish&uploadid=${id}`, tosHeaders(style, node, userId), Buffer.from(crcs.map((c, k) => `${k + 1}:${c}`).join(',')))
}
