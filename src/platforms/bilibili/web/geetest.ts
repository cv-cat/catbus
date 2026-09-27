import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt } from 'node:crypto'
import { CatbusError } from '../../../core/errors.js'
import { jsonDumps } from '../../../core/py.js'
import * as rand from '../../../core/rand.js'
import * as api from './api.js'
import type { Bili } from './client.js'
import { headers, PROFILE } from './profile.js'

/**
 * 极验 v3（上游 utils/geetest_w.py、tools/geetest_solve.py）。
 * 移植了 `w` 的加密原语和 fullpage 无感通道；服务端降级到点选题时报 RISK_CONTROL。
 */

const AES_IV = Buffer.from('0000000000000000')
const RSA_N_HEX =
  '00C1E3934D1614465B33053E7F48EE4EC87B14B95EF88947713D25EECBFF7E74' +
  'C7977D02DC1D9451F79DD5D1C10C29ACB6A9B4D6FB7D0A0279B6719E1772565F' +
  '09AF627715919221AEF91899CAE08C0D686D748B20A3603BE2318CA6BC2B5970' +
  '6592A9219D0BF05C9F65023A21D2330807252AE0066D59CEEFA5F2748EA80BAB81'
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789()'
const B64_MASKS = [0x6f0000, 0x90b400, 0x004b14, 0x0000eb]
export const GEETEST_VERSION = '9.2.0-guwyxh'

export function genAesKey(length = 16): string {
  return rand.string(length, '0123456789abcdef')
}

export function aesEncrypt(plaintext: string, key: string): Buffer {
  const c = createCipheriv('aes-128-cbc', Buffer.from(key), AES_IV)
  return Buffer.concat([c.update(plaintext, 'utf8'), c.final()])
}

function gatherBits(value: number, mask: number): number {
  let n = 0
  for (let r = 23; r >= 0; r--) if ((mask >> r) & 1) n = (n << 1) + ((value >> r) & 1)
  return n
}

/** 极验自定义 base64：按掩码做位挑选，尾部用 '.' 填充。 */
export function customB64(data: Uint8Array): string {
  let res = ''
  let end = ''
  const size = data.length
  for (let a = 0; a < size; a += 3) {
    let v: number
    let take: number
    if (a + 2 < size) {
      v = (data[a]! << 16) + (data[a + 1]! << 8) + data[a + 2]!
      take = 4
    } else if (size % 3 === 2) {
      v = (data[a]! << 16) + (data[a + 1]! << 8)
      take = 3
      end = '.'
    } else {
      v = data[a]! << 16
      take = 2
      end = '..'
    }
    for (const m of B64_MASKS.slice(0, take)) res += B64_ALPHABET[gatherBits(v, m)]
  }
  return res + end
}

const RSA_KEY = createPublicKey({
  key: { kty: 'RSA', n: Buffer.from(RSA_N_HEX, 'hex').subarray(1).toString('base64url'), e: 'AQAB' },
  format: 'jwk',
})

/** 用极验公钥加密 AES 密钥（PKCS#1 v1.5），十六进制。 */
export function rsaEncryptKey(key: string): string {
  return publicEncrypt({ key: RSA_KEY, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(key)).toString('hex')
}

/** `tt` 字段的插入式混淆；取模用原始 track 的长度。 */
export function csCipher(track: string, c: number[] | null | undefined, s: string): string {
  if (!c?.length || !s) return track
  const [s0, , a, , tail] = c as [number, number, number, number, number]
  let result = track
  const base = track.length
  for (let offset = 0; offset < s.length - 1; offset += 2) {
    const ch = parseInt(s.slice(offset, offset + 2), 16)
    const pos = (s0 * ch * ch + a * ch + tail) % base
    result = result.slice(0, pos) + String.fromCharCode(ch) + result.slice(pos)
  }
  return result
}

const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex')

const EMPTY_TRACK = 'M(*((1((M(('
const EMPTY_HDL_TRACK = 'tEQOYESJYERVYEQ.'
const EMPTY_BUF_MAGIC = '-1magic data'.repeat(73) + '-1'
const EMPTY_BUF_BANG = '-1!!'.repeat(73) + '-1'
const EMPTY_HDL_N = 'dGFdxFsdzEBYxHgZ'.repeat(73) + 'dGE.'

export function defaultEp(nowMs = rand.now()): Record<string, unknown> {
  const tm: Record<string, number> = {}
  ;[...'abcdefghijklmnopqrstu'].forEach((k, i) => (tm[k] = 'afghijlmnopqr'.includes(k) ? nowMs + i : 0))
  return {
    v: GEETEST_VERSION,
    te: false,
    $_BBn: false,
    ven: PROFILE.webglVendor,
    ren: PROFILE.webglRenderer,
    fp: null,
    lp: null,
    em: { ph: 0, cp: 0, ek: '11', wd: 1, nt: 0, si: 0, sc: 0 },
    tm,
    dnf: 'dnf',
    by: 2,
  }
}

/** 极验手工拼的 JSON：`"key":value`，值用 Python json.dumps 的默认分隔符。 */
function stringify(fields: [string, unknown][]): string {
  return '{' + fields.map(([k, v]) => `${jsonDumps(k)}:${jsonDumps(v, { ensureAscii: false })}`).join(',') + '}'
}

export function buildPayload(gt: string, challenge: string, passtime: number, c?: number[] | null, s = '', ep = defaultEp()): string {
  return stringify([
    ['lang', 'zh-cn'],
    ['type', 'fullpage'],
    ['tt', c?.length && s ? csCipher(EMPTY_TRACK, c, s) : EMPTY_TRACK],
    ['light', -1],
    ['s', md5(EMPTY_HDL_TRACK)],
    ['h', md5(EMPTY_HDL_N)],
    ['hh', md5(EMPTY_BUF_MAGIC)],
    ['hi', md5(EMPTY_BUF_BANG)],
    ['vip_order', -1],
    ['ct', -1],
    ['ep', ep],
    ['passtime', passtime],
    ['rp', md5(`${gt}${challenge}${passtime}`)],
  ])
}

export function buildInitPayload(gt: string, challenge: string): string {
  return jsonDumps(
    {
      gt,
      challenge,
      offline: false,
      new_captcha: true,
      product: 'bind',
      https: true,
      lang: 'zh-cn',
      type: 'fullpage',
      protocol: 'https://',
      width: '300px',
      cc: 20,
      ww: true,
      i: EMPTY_BUF_BANG,
    },
    { separators: [',', ':'], ensureAscii: false },
  )
}

export function buildW(payload: string, key = genAesKey(), withRsa = true): string {
  const body = customB64(aesEncrypt(payload, key))
  return withRsa ? body + rsaEncryptKey(key) : body
}

// ---------------------------------------------------------------- 链路

const GEETEST = 'https://api.geetest.com'
const REFERER = 'https://passport.bilibili.com/'

function jsonp(text: string): any {
  const m = /^[^(]*\(([\s\S]*)\)\s*$/.exec(text.trim())
  return JSON.parse(m ? m[1]! : text)
}

async function call(b: Bili, path: string, query: [string, string | number][]): Promise<any> {
  // JSONP 由 <script> 加载：跨站、no-cors、dest=script，不带 origin
  const h = headers('GET', { accept: '*/*' }).remove('origin').set('sec-fetch-site', 'cross-site').set('sec-fetch-mode', 'no-cors').set('sec-fetch-dest', 'script')
  h.referer(REFERER)
  const res = await b.http.request({ url: `${GEETEST}${path}`, headers: h.get(), query: [...query, ['callback', `geetest_${rand.now()}`]] })
  return jsonp(await res.text())
}

/**
 * 走一遍极验：申请 B 站 captcha → fullpage 无感判定。通过时返回 validate；
 * 降级到点选题时报 RISK_CONTROL（点选识别尚未移植）。
 */
export async function solve(b: Bili): Promise<api.Geetest> {
  const captcha = await api.captcha(b)
  if (captcha.code !== 0) throw new CatbusError('UPSTREAM', `申请人机验证失败：${captcha.message ?? captcha.code}`, { detail: { code: captcha.code } })
  const { token, geetest } = captcha.data
  const { gt, challenge } = geetest
  await call(b, '/gettype.php', [['gt', gt]])

  const key = genAesKey()
  const common: [string, string | number][] = [
    ['gt', gt],
    ['challenge', challenge],
    ['lang', 'zh-cn'],
    ['pt', 0],
    ['client_type', 'web'],
  ]
  const init = await call(b, '/get.php', [...common, ['w', buildW(buildInitPayload(gt, challenge), key, true)]])
  if (init.status !== 'success') throw new CatbusError('RISK_CONTROL', '人机验证初始化被拒绝', { detail: { kind: 'captcha', response: init } })
  const { c, s } = init.data ?? {}
  await rand.sleep(800)
  const decision = await call(b, '/ajax.php', [...common, ['w', buildW(buildPayload(gt, challenge, 800, c, s ?? ''), key, false)]])
  const validate = decision.data?.validate
  if (decision.data?.result !== 'click' && validate) {
    return { token, challenge, validate, seccode: `${validate}|jordan` }
  }
  throw new CatbusError('RISK_CONTROL', '需要完成极验点选验证，catbus 暂时无法自动完成', {
    hint: '改用扫码登录：catbus bilibili auth login --method qrcode',
    detail: { kind: 'captcha', result: decision.data?.result ?? null },
  })
}
