import { listAccounts } from '../../core/auth-store.js'
import { ENDPOINTS } from '../../core/registry.js'
import type { Account } from '../../core/schemas.js'
import { PLATFORMS } from '../../platforms/index.js'

/** 全局 `catbus auth list`：所有平台、所有端的账号。 */
export async function allAccounts(): Promise<Account[]> {
  const accounts: Account[] = []
  for (const p of PLATFORMS) for (const e of ENDPOINTS) accounts.push(...(await listAccounts(p.id, e)))
  return accounts
}
