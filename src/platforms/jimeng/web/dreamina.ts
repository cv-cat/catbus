import { spawn } from 'node:child_process'
import { CatbusError } from '../../../core/errors.js'
import type { UserRef } from '../../../core/schemas.js'

/**
 * 即梦官方 CLI dreamina 把登录态存在系统钥匙串里，只有一项（AGENTS 5.6）。
 * catbus 每个账号存一份这一项的内容，切换账号时写回钥匙串。
 */

const SERVICE = 'dreamina'
const KEY = 'byted_cli_user_token'
const PREFIX = 'go-keyring-base64:'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function run(file: string, args: string[], input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') return reject(err)
      reject(new CatbusError('ERROR', `找不到命令 ${file}`, { hint: '先安装即梦官方 CLI（dreamina），确认 dreamina -h 能运行' }))
    })
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end(input)
  })
}

function checkSystem(): void {
  if (process.platform !== 'darwin') {
    throw new CatbusError('UNSUPPORTED', '即梦目前只支持 macOS：dreamina 在其他系统上的凭据存储还没有适配')
  }
}

/** 子进程和钥匙串读写都经过这个对象，测试替换它的方法。 */
export const sys = {
  dreamina: (args: string[]) => run('dreamina', args),

  async readKeyring(): Promise<string | null> {
    checkSystem()
    const r = await run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', KEY, '-w'])
    return r.code === 0 ? r.stdout.trim() || null : null
  },

  async writeKeyring(value: string): Promise<void> {
    checkSystem()
    if (!/^[\w+/=:-]+$/.test(value)) throw new CatbusError('ERROR', '即梦登录态的格式不对，拒绝写入钥匙串')
    // 用 -i 从 stdin 传命令，token 不出现在进程参数里
    const r = await run('/usr/bin/security', ['-i'], `add-generic-password -U -s "${SERVICE}" -a "${KEY}" -w "${value}"\n`)
    if (r.code !== 0) throw new CatbusError('ERROR', `写入钥匙串失败：${r.stderr.trim()}`)
  },
}

/** 钥匙串里那一项属于哪个即梦用户。 */
export function keyringUser(value: string): string | null {
  if (!value.startsWith(PREFIX)) return null
  const json = Buffer.from(value.slice(PREFIX.length), 'base64').toString('utf8')
  return /"user_id"\s*:\s*"?(\d+)/.exec(json)?.[1] ?? null
}

/** 用 user_credit 校验登录态；未登录时 dreamina 输出的不是 JSON。user_id 可能超出安全整数，用正则取。 */
export async function currentUser(): Promise<UserRef | null> {
  const { stdout } = await sys.dreamina(['user_credit'])
  const id = /"user_id"\s*:\s*"?(\d+)/.exec(stdout)?.[1]
  if (!id) return null
  const name = /"user_name"\s*:\s*"([^"]*)"/.exec(stdout)?.[1]
  return { id, name: name || null, url: null }
}

export interface LoginRequest {
  uri: string
  deviceCode: string
  /** 授权链接的过期时间（毫秒时间戳）。 */
  expiresAt: number
}

/** 发起 OAuth 设备码登录。dreamina 会先清掉钥匙串里原来的登录态。 */
export async function requestLogin(): Promise<LoginRequest> {
  const r = await sys.dreamina(['relogin', '--headless'])
  const out = r.stdout + r.stderr
  const field = (name: string) => new RegExp(`^${name}:\\s*(\\S+)`, 'm').exec(out)?.[1]
  const uri = field('verification_uri')
  const deviceCode = field('device_code')
  if (!uri || !deviceCode) throw new CatbusError('UPSTREAM', '发起即梦登录失败', { detail: out.trim().split('\n').at(-1) })
  const expiresAt = Date.parse(field('expires_at') ?? '')
  return { uri, deviceCode, expiresAt: Number.isNaN(expiresAt) ? Date.now() + 600_000 : expiresAt }
}

/** 等用户在浏览器里授权，最多等到授权链接过期。返回 dreamina 的输出。 */
export async function waitLogin(request: LoginRequest): Promise<string> {
  const seconds = Math.max(1, Math.ceil((request.expiresAt - Date.now()) / 1000))
  const r = await sys.dreamina(['login', 'checklogin', `--device_code=${request.deviceCode}`, `--poll=${seconds}`])
  return r.stdout + r.stderr
}
