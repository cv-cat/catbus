import type { PlatformMeta } from '../../shared/types.js'
import { runQuiet } from '../api.js'
import { endpointLabel } from '../copy.js'
import { confirmDialog } from '../dialog.js'
import { append, h, replace } from '../dom.js'
import { formatTime, relativeTime, withName } from '../format.js'
import { field } from '../json.js'
import { METHOD_INFO } from '../labels.js'
import { href, type Route } from '../router.js'
import { type AccountInfo, getAccounts, getAccountsError, getMeta, onAccountsChange, refreshAccounts } from '../state.js'
import { avatar, button, callout, card, chip, emptyState, linkButton, pageHeader, platformLogo, spinner } from '../ui.js'

/**
 * 账号管理（AGENTS 5.2、5.3）：按平台列出账号，在线校验、设为当前、登出（确认后删除本地凭证）。
 */

/**
 * 一个账号的操作行。
 */
function accountRow(account: AccountInfo, platform: PlatformMeta): HTMLElement {
  const statusBox = h('div', { class: 'account-check', 'aria-live': 'polite' })
  const check = button('检查登录', { variant: 'ghost', icon: 'refresh', size: 'sm' })
  const use = account.current ? null : button('设为当前', { variant: 'ghost', icon: 'check', size: 'sm' })
  const logout = button('退出登录', { variant: 'ghost', icon: 'logout', size: 'sm', attrs: { class: 'btn-danger-text' } })
  const base = { platform: account.platform, endpoint: account.endpoint, account: account.account }

  check.addEventListener('click', async () => {
    check.disabled = true
    replace(statusBox, spinner('检查中'), h('span', { class: 'muted' }, '正在检查账号是否仍可使用…'))
    try {
      const env = await runQuiet({ ...base, resource: 'auth', action: 'status' })
      const ok = env.ok && field(env.data, 'logged_in') === true
      replace(statusBox, env.ok ? chip(ok ? '可以继续使用' : '已失效，需要重新登录', ok ? 'success' : 'warning', ok ? 'check' : 'alert') : chip(env.error?.message ?? '检查失败', 'danger', 'alert'))
      if (env.ok && !ok) statusBox.append(linkButton('重新登录', href(['p', account.platform, 'login'], { acct: account.account, e: account.endpoint }), { variant: 'secondary', size: 'sm', icon: 'key' }))
    } catch (err) {
      replace(statusBox, chip(err instanceof Error ? err.message : '检查失败', 'danger'))
    } finally {
      check.disabled = false
    }
  })
  use?.addEventListener('click', async () => {
    use.disabled = true
    const env = await runQuiet({ ...base, account: null, resource: 'auth', action: 'use', args: [account.account] }).catch(() => null)
    if (!env?.ok) {
      use.disabled = false
      replace(statusBox, chip(env?.error?.message ?? '切换失败', 'danger', 'alert'))
      return
    }
    await refreshAccounts()
  })
  logout.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: `${withName('退出', platform.name)} 账号 ${account.userName ?? account.account}？`,
      danger: true,
      confirmLabel: '退出登录',
      body: [h('p', null, `将移除这台电脑上保存的 ${account.userName ?? account.account} 的登录信息，并在平台支持时结束本次登录。`), h('p', { class: 'muted' }, '这不会注销平台账号；之后使用时需要重新登录。')],
    })
    if (!ok) return
    logout.disabled = true
    const env = await runQuiet({ ...base, resource: 'auth', action: 'logout' }).catch(() => null)
    if (!env?.ok) {
      logout.disabled = false
      replace(statusBox, chip(env?.error?.message ?? '退出失败', 'danger', 'alert'))
      return
    }
    await refreshAccounts()
  })

  return h(
    'li',
    { class: 'row account-row' },
    avatar(account.userName ?? account.account),
    h(
      'div',
      { class: 'row-main' },
      h('p', { class: 'row-title' }, account.userName ?? '（未知用户）', account.current ? chip('当前使用', 'success') : null, account.endpoint !== 'web' ? chip(endpointLabel(account.endpoint, platform), 'neutral') : null),
      h('p', { class: 'row-text' }, h('code', null, account.account), ' · ', account.method ? (METHOD_INFO[account.method]?.label ?? account.method) : '—', ' · ', h('time', { datetime: account.updatedAt, title: formatTime(account.updatedAt) }, `更新于 ${relativeTime(account.updatedAt)}`)),
      statusBox,
    ),
    h('div', { class: 'row-actions' }, check, use, logout),
  )
}

/**
 * 账号页。
 */
export function accountsView(main: HTMLElement, _route: Route): () => void {
  document.title = '账号 · catbus'
  const body = h('div', null)
  const refresh = button('刷新', { variant: 'secondary', icon: 'refresh', size: 'sm' })
  refresh.addEventListener('click', async () => {
    refresh.disabled = true
    await refreshAccounts()
    refresh.disabled = false
  })
  append(main, pageHeader({ crumbs: [{ label: '首页', href: '#/' }, { label: '账号' }], title: '账号', subtitle: '管理各平台已登录的账号，检查是否可用，或切换当前使用的账号。', actions: [refresh] }), body)

  const render = () => {
    const accounts = getAccounts()
    const error = getAccountsError()
    if (accounts == null) return replace(body, error ? callout('danger', '读取账号失败', h('p', null, error)) : h('div', { class: 'loading-block' }, spinner(), '正在读取账号…'))
    const meta = getMeta()
    const loggedIn = meta.platforms.filter((p) => accounts.some((a) => a.platform === p.id))
    const notYet = meta.platforms.filter((p) => {
      const endpoint = p.endpoints[p.defaultEndpoint]
      return !accounts.some((a) => a.platform === p.id) && endpoint.status === 'available' && endpoint.login.methods.length
    })
    replace(
      body,
      error ? callout('warning', '刷新失败，显示的是上一次读到的账号', h('p', null, error)) : null,
      loggedIn.length
        ? loggedIn.map((p) =>
            card(
              { class: 'account-group' },
              h('header', { class: 'account-group-head' }, platformLogo(p.id, 'md'), h('h2', { class: 'card-title' }, p.name), linkButton('再登录一个', `#/p/${p.id}/login`, { variant: 'ghost', icon: 'key', size: 'sm' })),
              h('ul', { class: 'rows' }, accounts.filter((a) => a.platform === p.id).map((a) => accountRow(a, p))),
            ),
          )
        : emptyState({ art: 'bus', title: '还没有登录任何平台', text: '选一个平台登录，登录信息保存在这台电脑上。' }),
      notYet.length
        ? h('section', { class: 'section' }, h('h2', { class: 'section-title' }, '还没登录的平台'), h('div', { class: 'login-chips' }, notYet.map((p) => h('a', { class: 'login-chip', href: `#/p/${p.id}/login` }, platformLogo(p.id, 'sm'), p.name))))
        : null,
    )
  }
  render()
  return onAccountsChange(render)
}
