import {
  checkAccountName,
  deleteCredential,
  endpointFlag,
  listAccounts,
  readCredential,
  setCurrent,
  toAccount,
} from './auth-store.js'
import { CatbusError } from './errors.js'
import type { HandlerContext } from './registry.js'

/** core 自动注册到每个平台的 `auth list` / `use` / `logout`。 */

export async function list(ctx: HandlerContext) {
  return listAccounts(ctx.platform.id, ctx.endpoint)
}

export async function use(ctx: HandlerContext) {
  const p = ctx.platform.id
  const account = checkAccountName(ctx.args.account!)
  const credential = await readCredential(p, ctx.endpoint, account)
  if (!credential) {
    throw new CatbusError('AUTH_REQUIRED', `账号 ${account} 不存在`, {
      hint: `catbus ${p} auth login -a ${account}${endpointFlag(ctx.endpoint)}`,
    })
  }
  await setCurrent(p, ctx.endpoint, account)
  return toAccount(credential, true)
}

export async function logout(ctx: HandlerContext) {
  const p = ctx.platform.id
  const hint = `catbus ${p} auth list${endpointFlag(ctx.endpoint)}`
  if (ctx.account == null) throw new CatbusError('USAGE', '没有当前账号，请用 -a 指定要登出的账号', { hint })
  const account = checkAccountName(ctx.account)
  const found = (await listAccounts(p, ctx.endpoint)).find((a) => a.account === account)
  if (!found) throw new CatbusError('USAGE', `账号 ${account} 不存在`, { hint })
  await deleteCredential(p, ctx.endpoint, account)
  if (found.current) await setCurrent(p, ctx.endpoint, null)
  return { ...found, current: false }
}
