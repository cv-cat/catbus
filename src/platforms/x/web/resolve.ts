import { CatbusError } from '../../../core/errors.js'

/** 参数归一化（AGENTS 4.8），移植自上游 utils/x_util.py。 */

const STATUS_RE = /(?:twitter|x)\.com\/(?:#!\/)?(\w+)\/status(?:es)?\/(\d+)/
const SCREEN_NAME_RE = /(?:twitter|x)\.com\/@?([A-Za-z0-9_]{1,15})\/?(?:\?|$)/

/** 接受完整推文链接或纯数字 id，统一返回数字 id（上游 parse_tweet_id）。 */
export function parseTweetId(input: string): string {
  const text = (input ?? '').trim()
  if (/^\d+$/.test(text)) return text
  const m = STATUS_RE.exec(text)
  if (!m) throw new CatbusError('USAGE', `无法从 ${input} 解析推文 id`, { hint: '传推文 id 或链接 https://x.com/<user>/status/<id>' })
  return m[2]!
}

/** 接受主页链接、@handle 或裸用户名，统一返回小写 screen_name（上游 parse_screen_name）。 */
export function parseScreenName(input: string): string {
  const text = (input ?? '').trim().replace(/\/+$/, '')
  const m = SCREEN_NAME_RE.exec(text)
  if (m) return m[1]!.toLowerCase()
  return text.replace(/^@+/, '').split('/').pop()!.split('?')[0]!.toLowerCase()
}

/**
 * 用户参数里的纯数字按用户 ID（rest_id）处理，这样输出里的 `id` 可以直接作为下一条命令的参数；
 * 全数字的用户名请写成 `@123` 或主页链接。
 */
export function isUserId(input: string): boolean {
  return /^\d+$/.test((input ?? '').trim())
}

/** twid cookie 形如 `u%3D1718802931036622848`，取出数字用户 id。 */
export function userIdFromTwid(twid: string | undefined): string {
  return (twid ?? '').replace('u%3D', '').replace('u=', '').replace(/"/g, '').trim()
}
