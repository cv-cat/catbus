import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import { type Pairs, urlencode } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'

/** 上传参数（上游 utils/weibo_creator_utils.py）。 */

export const APP_SOURCE = '339644097'

export function md5Hex(data: string | Uint8Array): string {
  return createHash('md5').update(data).digest('hex')
}

/** generate_params：CRC32（上游手写的查表实现，与标准 CRC32 相同）、MD5、大小。 */
export function fileParams(file: Uint8Array): { cs: number; md5: string; fileSize: number } {
  return { cs: crc32(file), md5: md5Hex(file), fileSize: file.length }
}

/** generate_session_id：md5(`毫秒|大小|文件名|video|秒`)。 */
export function sessionId(fileSize: number, fileName: string): string {
  return md5Hex(`${rand.now()}|${fileSize}|${fileName}|video|${rand.nowSeconds()}`)
}

/** generate_upload_image_media_params，已 urlencode。 */
export function uploadImageParams(uid: string, nick: string, file: Uint8Array): string {
  const p = fileParams(file)
  const params: Pairs = [
    ['file_source', '1'],
    ['cs', String(p.cs)],
    ['ent', 'miniblog'],
    ['appid', APP_SOURCE],
    ['uid', uid],
    ['raw_md5', p.md5],
    ['ori', '1'],
    ['mpos', '1'],
    ['nick', nick],
    ['pri', '0'],
    ['request_id', String(rand.now())],
    ['file_size', String(p.fileSize)],
  ]
  return urlencode(params)
}

/** generate_upload_video_media_params，已 urlencode。整个文件作为一个分片上传。 */
export function uploadVideoParams(uploadId: string, mediaId: string, file: Uint8Array): string {
  const p = fileParams(file)
  const params: Pairs = [
    ['source', APP_SOURCE],
    ['upload_id', uploadId],
    ['media_id', mediaId],
    ['upload_protocol', 'binary'],
    ['type', 'video'],
    ['client', 'web'],
    ['check', p.md5],
    ['index', '0'],
    ['size', String(p.fileSize)],
    ['start_loc', '0'],
    ['count', '1'],
  ]
  return urlencode(params)
}

// ================================================================ mid ↔ mblogid

/** 微博的 62 进制：mid 从右往左每 7 位十进制一组，每组转成 4 位 62 进制（最高组不补零）。 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function groups(s: string, size: number): string[] {
  const out: string[] = []
  for (let end = s.length; end > 0; end -= size) out.unshift(s.slice(Math.max(0, end - size), end))
  return out
}

/** 数字 mid → mblogid（URL 里的 9 位短码，如 OuIv3hbiw）。 */
export function midToBid(mid: string): string {
  return groups(mid, 7)
    .map((g, i) => {
      let n = Number(g)
      let s = ''
      do {
        s = ALPHABET[n % 62] + s
        n = Math.floor(n / 62)
      } while (n > 0)
      return i === 0 ? s : s.padStart(4, '0')
    })
    .join('')
}

/** mblogid → 数字 mid。 */
export function bidToMid(bid: string): string {
  return groups(bid, 4)
    .map((g, i) => {
      const n = [...g].reduce((acc, ch) => acc * 62 + ALPHABET.indexOf(ch), 0)
      return i === 0 ? String(n) : String(n).padStart(7, '0')
    })
    .join('')
    .replace(/^0+(?=\d)/, '')
}
