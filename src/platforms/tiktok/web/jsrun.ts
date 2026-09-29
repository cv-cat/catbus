import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { CatbusError } from '../../../core/errors.js'
import { PACKAGE_ROOT, staticFile } from '../../../core/paths.js'
import * as rand from '../../../core/rand.js'

/**
 * 上游的两个签名运行器（AGENTS 7.4 的子进程退路）：
 * - static/tiktok/signing/env/sign.js：WebMssdk 的 frontierSign（直播 / 私信 WebSocket 的 16 位 X-Bogus）；
 * - static/tiktok/shop_bsid/sign.js：TikTok Shop 的 OEC Lucifer BSID。
 *
 * 两者都改写进程级全局（global.window、Function.prototype.toString、隐藏 process 等），放不进 node:vm，
 * 所以和上游一样每次起一个 node 子进程，按包内路径运行原样复制的 JS。
 *
 * 确定性模式（对拍）下预加载 scripts/golden/tiktok/node_determinism.cjs，与上游对拍时用的是同一个文件。
 */

async function runNode(script: string, input: string, env: Record<string, string> = {}): Promise<string> {
  const deterministic = rand.isDeterministic()
  const extra: Record<string, string> = deterministic
    ? {
        NODE_OPTIONS: `--require "${join(PACKAGE_ROOT, 'scripts', 'golden', 'tiktok', 'node_determinism.cjs').replaceAll('\\', '/')}"`,
        CATBUS_GOLDEN_SEED: String(rand.DEFAULT_SEED),
        CATBUS_GOLDEN_NOW: String(rand.now()),
      }
    : { NODE_OPTIONS: '' }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...extra, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill(), 30_000)
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new CatbusError('ERROR', `签名进程启动失败：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out).toString('utf8')
      if (code !== 0 && !stdout.trim()) {
        // 运行器的 stderr 可能带着 cookie，只取最后一行错误类型
        const reason = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).reverse().find((l) => /(Error|error):|is required|failed|length/.test(l)) ?? ''
        reject(new CatbusError('ERROR', `签名进程失败${reason ? `：${reason.slice(0, 200)}` : ''}`))
      } else resolve(stdout)
    })
    child.stdin.end(input)
  })
}

// ---------------------------------------------------------------- frontierSign（builder/signer.py TiktokSigner.frontier_sign）

export interface FrontierInput {
  cookie: string
  userAgent: string
  referer: string
  metrics?: Record<string, unknown>
  /** 私信：序列化 Request 的 32 位小写 MD5。 */
  stub?: string
}

export async function frontierSign(o: FrontierInput): Promise<string> {
  const request: Record<string, unknown> = { mode: 'frontier_sign', url: o.referer, cookie: o.cookie, user_agent: o.userAgent, referer: o.referer, metrics: o.metrics ?? {}, headers: {} }
  if (o.stub != null) {
    if (!/^[0-9a-f]{32}$/.test(o.stub)) throw new CatbusError('ERROR', 'IM X-MS-STUB 必须为 32 位小写 MD5')
    request.stub = o.stub
  }
  const stdout = await runNode(staticFile('tiktok', 'signing/env/sign.js'), JSON.stringify(request) + '\n')
  const replies = stdout.split(/\r?\n/).filter((l) => l.startsWith('{"ok":'))
  let result: any = {}
  try {
    result = replies.length ? JSON.parse(replies[replies.length - 1]!) : {}
  } catch {}
  const marker = result?.result?.values?.['X-Bogus']
  if (!result.ok || typeof marker !== 'string' || marker.length !== 16) {
    throw new CatbusError('ERROR', `本地 frontierSign 未产生长度 16 的 X-Bogus${result.error ? `：${String(result.error).slice(0, 200)}` : ''}`)
  }
  return marker
}

// ---------------------------------------------------------------- Shop BSID（signing/shop_bsid.py ShopBSIDSigner）

export const SHOP_BSID_LENGTH = 382
const BROWSER_MS_TOKEN_LENGTHS = [144, 152]

export interface ShopSigned {
  signed_url: string
  bsid: string
  length: number
  pre_sign_lengths: Record<string, number>
  pre_sign_url_length: number
  pre_sign_order: string[]
  pre_sign_url?: string
}

export async function shopSign(o: {
  url: string
  method: string
  headers: [string, string][]
  body: string | null
  cookie: string
  userAgent: string
  xBogus: (msToken: string) => string
}): Promise<ShopSigned> {
  const oec = /(?:^|;\s*)oec_lucifer=([^;]+)/.exec(o.cookie)?.[1]
  if (!oec || !/^[0-9a-fA-F]{160}$/.test(oec)) {
    throw new CatbusError('AUTH_REQUIRED', '当前 Cookie 缺少浏览器生成的 160 位 oec_lucifer（在 shop.tiktok.com 打开任一商品页后重新导出 Cookie）', {
      hint: 'catbus tiktok auth login --cookie @tiktok-session.json',
    })
  }
  const msToken = [...o.cookie.matchAll(/(?:^|;\s*)msToken=([^;]+)/g)].map((m) => decodeURIComponent(m[1]!)).find((v) => BROWSER_MS_TOKEN_LENGTHS.includes(v.length)) ?? ''
  if (!/^[0-9A-Za-z_-]+={0,2}$/.test(msToken)) {
    throw new CatbusError('AUTH_REQUIRED', '当前 Cookie 缺少 Shop 请求使用的 144/152 位 msToken（在 shop.tiktok.com 打开商品页后重新导出 Cookie）', {
      hint: 'catbus tiktok auth login --cookie @tiktok-session.json',
    })
  }
  if (!o.userAgent) throw new CatbusError('ERROR', 'Shop X-Bogus 纯算需要完整 user-agent')
  const sep = o.url.includes('?') ? '&' : '?'
  // Chrome 的 pre-sign URL 里 base64 的 == 原样保留
  const signingUrl = `${o.url}${sep}msToken=${encodeURIComponent(msToken).replace(/%3D/g, '=')}`
  const payload = {
    url: signingUrl,
    method: o.method.toUpperCase(),
    headers: o.headers,
    body: o.body,
    cookie: o.cookie,
    expected_length: SHOP_BSID_LENGTH,
    expected_ms_token_length: msToken.length,
    x_bogus: o.xBogus(msToken),
  }
  const stdout = await runNode(staticFile('tiktok', 'shop_bsid/sign.js'), JSON.stringify(payload), { TIKTOK_BSID_QUIET: '1' })
  let result: any
  try {
    result = JSON.parse(stdout)
  } catch {
    throw new CatbusError('ERROR', 'Shop BSID 运行器返回了非 JSON 数据')
  }
  const bsid = String(result.bsid ?? '')
  if (bsid.length !== SHOP_BSID_LENGTH || !/^[0-9a-f]+$/.test(bsid) || String(result.length) !== String(SHOP_BSID_LENGTH)) {
    throw new CatbusError('ERROR', 'Shop BSID 输出格式或长度与 Chrome 不一致')
  }
  return {
    signed_url: String(result.signed_url ?? ''),
    bsid,
    length: SHOP_BSID_LENGTH,
    pre_sign_lengths: result.pre_sign_lengths ?? {},
    pre_sign_url_length: Number(result.pre_sign_url_length ?? 0),
    pre_sign_order: result.pre_sign_order ?? [],
    pre_sign_url: String(result.pre_sign_url ?? ''),
  }
}
