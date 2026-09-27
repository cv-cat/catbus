import { readdir, rm } from 'node:fs/promises'
import { CatbusError } from './errors.js'
import { isoNow, readTextIfExists, writeFileAtomic } from './fsutil.js'
import { authDir } from './paths.js'
import type { Endpoint } from './registry.js'
import { type Account, type Credential, CredentialSchema, type UserRef } from './schemas.js'

/** 凭证只由 core 读写（AGENTS 5）。目录：auth/<platform>/<endpoint>/<account>.json、guest.json、_current。 */

export const GUEST = 'guest'
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

export function checkAccountName(name: string, options: { allowGuest?: boolean } = {}): string {
  if (!ACCOUNT_RE.test(name)) {
    throw new CatbusError('USAGE', `账号名不合法：${name}`, {
      hint: '账号名只能用小写字母、数字、_ 和 -，以字母或数字开头，最长 32 位',
    })
  }
  if (name === GUEST && !options.allowGuest) throw new CatbusError('USAGE', 'guest 是保留名，表示游客身份')
  return name
}

/** 给用户看的命令后缀：非 web 端时带上 -e。 */
export function endpointFlag(endpoint: Endpoint): string {
  return endpoint === 'web' ? '' : ` -e ${endpoint}`
}

function credentialFile(platform: string, endpoint: Endpoint, account: string): string {
  return authDir(platform, endpoint, `${account}.json`)
}

export async function readCredential(platform: string, endpoint: Endpoint, account: string): Promise<Credential | null> {
  const file = credentialFile(platform, endpoint, account)
  const text = await readTextIfExists(file)
  if (text == null) return null
  let parsed
  try {
    parsed = CredentialSchema.safeParse(JSON.parse(text))
  } catch {
    parsed = null
  }
  if (!parsed?.success) {
    throw new CatbusError('ERROR', `凭证文件已损坏：${file}`, {
      hint: account === GUEST ? `删除该文件后重试` : `catbus ${platform} auth logout -a ${account}${endpointFlag(endpoint)}`,
    })
  }
  return parsed.data
}

export async function writeCredential(credential: Credential): Promise<void> {
  const { platform, endpoint, account } = credential
  checkAccountName(account, { allowGuest: true })
  credential.updated_at = isoNow()
  await writeFileAtomic(credentialFile(platform, endpoint, account), JSON.stringify(credential, null, 2) + '\n')
}

export async function deleteCredential(platform: string, endpoint: Endpoint, account: string): Promise<void> {
  await rm(credentialFile(platform, endpoint, account), { force: true })
}

export function newCredential(init: {
  platform: string
  endpoint: Endpoint
  account: string
  method: Credential['method']
  user?: UserRef | null
}): Credential {
  const now = isoNow()
  return {
    schema: 1,
    platform: init.platform,
    endpoint: init.endpoint,
    account: init.account,
    user: init.user ?? null,
    method: init.method,
    created_at: now,
    updated_at: now,
    scopes: { main: { cookies: [], tokens: {} } },
    device: {},
    extra: {},
  }
}

/** 当前账号；`_current` 不存在、不合法或指向已删除的账号时为 null。 */
export async function getCurrent(platform: string, endpoint: Endpoint): Promise<string | null> {
  const name = (await readTextIfExists(authDir(platform, endpoint, '_current')))?.trim()
  if (!name || name === GUEST || !ACCOUNT_RE.test(name)) return null
  const exists = await readTextIfExists(credentialFile(platform, endpoint, name))
  return exists == null ? null : name
}

export async function setCurrent(platform: string, endpoint: Endpoint, account: string | null): Promise<void> {
  const file = authDir(platform, endpoint, '_current')
  if (account == null) await rm(file, { force: true })
  else await writeFileAtomic(file, account + '\n')
}

export function toAccount(credential: Credential, current: boolean): Account {
  return {
    platform: credential.platform,
    endpoint: credential.endpoint,
    account: credential.account,
    current,
    user: credential.user,
    method: credential.method,
    updated_at: credential.updated_at,
  }
}

/** 某平台某端的账号，按名字排序。损坏的凭证文件也列出来，user / method 为 null。 */
export async function listAccounts(platform: string, endpoint: Endpoint): Promise<Account[]> {
  let files: string[]
  try {
    files = await readdir(authDir(platform, endpoint))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const current = await getCurrent(platform, endpoint)
  const accounts: Account[] = []
  for (const file of files.sort()) {
    const name = file.replace(/\.json$/, '')
    if (name === file || name === GUEST || !ACCOUNT_RE.test(name)) continue
    const credential = await readCredential(platform, endpoint, name).catch(() => null)
    accounts.push(
      credential
        ? toAccount(credential, name === current)
        : { platform, endpoint, account: name, current: name === current, user: null, method: null, updated_at: null },
    )
  }
  return accounts
}
