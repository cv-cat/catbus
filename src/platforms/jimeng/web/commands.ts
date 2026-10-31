import { endpointFlag, getCurrent, listAccounts, readCredential } from '../../../core/auth-store.js'
import { CatbusError } from '../../../core/errors.js'
import { finishLogin, freshCredential, showLink } from '../../../core/login.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Account, AuthStatus, Credential } from '../../../core/schemas.js'
import { currentUser, keyringUser, requestLogin, sys, waitLogin } from './dreamina.js'

type Ctx = HandlerContext

/** 钥匙串那一项的内容存在 tokens.keyring 里。 */
const keyringOf = (credential: Credential) => credential.scopes.main?.tokens.keyring as string | undefined

function loginHint(ctx: Ctx, account: string | null): string {
  return `catbus ${ctx.platform.id} auth login${account ? ` -a ${account}` : ''}${endpointFlag(ctx.endpoint)}`
}

/**
 * 把钥匙串里的登录态存回它所属的账号：dreamina 刷新 token 后会改写钥匙串，catbus 存的那份就旧了。
 * 返回所属的账号名；不属于任何账号时返回 null。
 */
async function syncBack(ctx: Ctx): Promise<string | null> {
  const value = await sys.readKeyring()
  if (!value) return null
  const uid = keyringUser(value)
  const owner = uid ? (await listAccounts(ctx.platform.id, ctx.endpoint)).find((a) => a.user?.id === uid) : undefined
  if (!owner) {
    ctx.log.warn(`钥匙串里的即梦登录态（用户 ${uid ?? '未知'}）没有保存在 catbus 的账号里，会被覆盖；要保留请用 auth login 登录到一个账号名下`)
    return null
  }
  const credential = owner.account === ctx.account ? ctx.credential : await readCredential(ctx.platform.id, ctx.endpoint, owner.account)
  if (credential && keyringOf(credential) !== value) {
    credential.scopes.main!.tokens.keyring = value
    await ctx.saveCredential(credential)
  }
  return owner.account
}

/** 让钥匙串里是这个账号的登录态。 */
async function activate(ctx: Ctx, credential: Credential): Promise<void> {
  const value = keyringOf(credential)
  if (!value) throw new CatbusError('AUTH_REQUIRED', `账号 ${credential.account} 没有即梦登录态`, { hint: loginHint(ctx, credential.account) })
  if ((await syncBack(ctx)) !== credential.account) await sys.writeKeyring(value)
}

/** 钥匙串里应当始终是当前账号（AGENTS 5.6）。 */
async function activateCurrent(ctx: Ctx): Promise<void> {
  const current = await getCurrent(ctx.platform.id, ctx.endpoint)
  const credential = current && (await readCredential(ctx.platform.id, ctx.endpoint, current))
  if (credential) await activate(ctx, credential)
}

export async function authLogin(ctx: Ctx): Promise<Account> {
  await syncBack(ctx)
  try {
    const request = await requestLogin()
    const hint = `请在浏览器里打开下面的链接，用要登录的即梦账号确认授权（${new Date(request.expiresAt).toLocaleTimeString()} 前有效）`
    // 界面里链接单独显示、可按 o 打开；CLI 里和以前一样打到 stderr
    showLink(request.uri, hint, `${hint}：\n${request.uri}`, '在浏览器里授权登录即梦')
    // 界面里取消登录时 ctx.signal 触发，结束 dreamina 的等待，finally 里把钥匙串切回当前账号
    const output = await waitLogin(request, ctx.signal)
    const user = await currentUser()
    const value = await sys.readKeyring()
    if (!user || !value) {
      throw new CatbusError('AUTH_REQUIRED', '即梦登录没有完成', { hint: loginHint(ctx, ctx.account), detail: output.trim().split('\n').at(-1) })
    }
    if (output.includes('仅限会员')) ctx.log.warn('这个即梦账号不是会员：dreamina 只允许会员调用生成命令')
    const credential = freshCredential(ctx, 'oauth')
    credential.scopes.main!.tokens.keyring = value
    return await finishLogin(ctx, credential, user)
  } finally {
    // 登录会占用钥匙串；当前账号不是刚登录的这个时切回去
    await activateCurrent(ctx)
  }
}

export async function authStatus(ctx: Ctx): Promise<AuthStatus> {
  const off: AuthStatus = { logged_in: false, user: null, method: null, expires_at: null }
  if (!keyringOf(ctx.credential)) return off
  await activate(ctx, ctx.credential)
  try {
    const user = await currentUser()
    await syncBack(ctx)
    return user ? { logged_in: true, user, method: ctx.credential.method, expires_at: null } : off
  } finally {
    await activateCurrent(ctx)
  }
}

/** `auth use` 的钩子：把要切换到的账号写进钥匙串。 */
export async function use(ctx: Ctx): Promise<void> {
  await activate(ctx, ctx.credential)
}

/** `auth logout` 的钩子：钥匙串里正是这个账号时，让 dreamina 也登出。 */
export async function serverLogout(ctx: Ctx): Promise<void> {
  const value = await sys.readKeyring()
  if (value && keyringUser(value) === ctx.credential.user?.id) await sys.dreamina(['logout'])
}
