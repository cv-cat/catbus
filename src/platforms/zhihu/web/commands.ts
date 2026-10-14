import { CatbusError } from '../../../core/errors.js'
import { cookieCredential, finishLogin, loginContext } from '../../../core/login.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { AuthStatus } from '../../../core/schemas.js'
import { authError } from '../../../core/toolkit.js'
import * as api from './api.js'
import { Zhihu } from './client.js'
import * as norm from './normalize.js'
import { COOKIE_DOMAIN } from './profile.js'

/** 知乎上游只支持 cookie；d_c0 用于 x-zse-96，z_c0 表示已登录会话。 */
export async function authLogin(ctx: HandlerContext) {
  const credential = cookieCredential(ctx, COOKIE_DOMAIN)
  const names = new Set(credential.scopes.main!.cookies.map((cookie) => cookie.name))
  if (!names.has('d_c0') || !names.has('z_c0')) {
    throw new CatbusError('USAGE', '知乎的 cookie 需要包含 d_c0 和 z_c0', {
      hint: '在已登录的 www.zhihu.com 页面复制完整的 Cookie 请求头',
    })
  }
  const me = await api.me(new Zhihu(loginContext(ctx, credential)))
  const user = norm.userRef(me)
  if (!user) throw new CatbusError('AUTH_REQUIRED', '登录没有成功：cookie 无效或已过期', { hint: '重新在浏览器登录知乎后复制 cookie' })
  return finishLogin(ctx, credential, user)
}

export async function authStatus(ctx: HandlerContext): Promise<AuthStatus> {
  const zhihu = new Zhihu(ctx)
  const me = zhihu.isLoggedIn ? await api.me(zhihu) : null
  const user = norm.userRef(me)
  return {
    logged_in: Boolean(user),
    user,
    method: user ? ctx.credential.method : null,
    expires_at: null,
  }
}

export async function userGet(ctx: HandlerContext) {
  if (ctx.args.user !== 'me') {
    throw new CatbusError('UNSUPPORTED', '知乎的 user get 当前只支持 me', { hint: '使用 catbus zhihu user get me' })
  }
  const zhihu = new Zhihu(ctx)
  if (!zhihu.isLoggedIn) throw authError(ctx, '当前账号缺少 d_c0 或 z_c0，请重新登录')
  const me = await api.me(zhihu)
  if (!me) throw authError(ctx)
  return norm.user(me)
}
