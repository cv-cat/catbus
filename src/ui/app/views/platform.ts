import { ENDPOINT_NAMES, type CommandMeta, type EndpointName, type PlatformMeta } from '../../shared/types.js'
import { commandTitle, endpointLabel } from '../copy.js'
import { append, h, replace, uid } from '../dom.js'
import { withName } from '../format.js'
import { icon } from '../icons.js'
import { PLATFORM_DESCRIPTIONS, RESOURCE_INFO } from '../labels.js'
import { href, type Route } from '../router.js'
import { accountsOf, findPlatform, getAccounts, getSelection, onAccountsChange, type Selection, setSelection } from '../state.js'
import { callout, chip, emptyState, linkButton, pageHeader, platformLogo } from '../ui.js'
import { notFoundView } from './not-found.js'

/**
 * resource 的中文名：item 用平台自己的叫法。
 */
export function resourceLabel(platform: PlatformMeta, resource: string): string {
  if (resource === 'msg' && platform.id === 'discord') return '消息'
  if (resource === 'msg' && platform.id === 'mteam') return '站内信'
  if (resource === 'msg' && ['taobao', 'jd'].includes(platform.id)) return '客服消息'
  return resource === 'item' ? platform.item : (RESOURCE_INFO[resource]?.label ?? resource)
}

/**
 * 端的选择：规划中的端可以看到但不能选，并写明原因。
 */
function endpointSwitch(platform: PlatformMeta, selection: Selection, onChange: (endpoint: EndpointName) => void): HTMLElement {
  const name = uid('ep')
  return h(
    'div',
    { class: 'segmented segmented-sm', role: 'radiogroup', 'aria-label': '平台版本' },
    ENDPOINT_NAMES.map((e) => {
      const planned = platform.endpoints[e].status === 'planned'
      const input = h('input', { type: 'radio', name, value: e, class: 'segmented-input', checked: selection.endpoint === e, disabled: planned })
      input.addEventListener('change', () => onChange(e))
      return h('label', { class: 'segmented-option', title: planned ? `暂不支持通过平台的${endpointLabel(e, platform)}连接` : `通过平台的${endpointLabel(e, platform)}连接` }, input, h('span', null, endpointLabel(e, platform), planned ? h('small', null, ' 暂未开放') : null))
    }),
  )
}

/**
 * 账号选择：当前账号、其他账号，支持游客的端多一个「游客」。
 */
export function accountPicker(platform: PlatformMeta, selection: Selection, onChange: (account: string | null) => void): HTMLElement {
  const ep = platform.endpoints[selection.endpoint]
  const accounts = accountsOf(platform.id, selection.endpoint)
  const current = accounts.find((a) => a.current)
  const id = uid('acct')
  const select = h(
    'select',
    { id, class: 'input select select-sm' },
    h('option', { value: '' }, current ? `当前账号：${current.userName ?? current.account}（${current.account}）` : '当前账号'),
    accounts.filter((a) => !a.current).map((a) => h('option', { value: a.account }, `${a.userName ?? a.account}（${a.account}）`)),
    ep.status === 'available' && ep.guest ? h('option', { value: 'guest' }, '游客（不登录）') : null,
  )
  select.value = selection.account ?? ''
  select.addEventListener('change', () => onChange(select.value || null))
  return h('div', { class: 'inline-field' }, h('label', { for: id, class: 'inline-label' }, '账号'), select)
}

/**
 * 命令卡片：规划中的不可进入，写明原因。
 */
function commandTile(platform: PlatformMeta, endpoint: EndpointName, command: CommandMeta): HTMLElement {
  const badges = [
    command.confirm !== 'never' ? chip('需确认', 'warning', 'alert') : null,
    command.stream ? chip('实时', 'info', 'bolt') : null,
    command.status === 'planned' ? chip('暂未开放', 'neutral') : null,
  ]
  const body = [h('span', { class: 'cmd-title' }, commandTitle(command)), h('span', { class: 'cmd-badges' }, badges)]
  if (command.status === 'planned') return h('div', { class: 'cmd-tile is-planned', 'aria-disabled': 'true', title: '这项功能暂未开放' }, body)
  const target = command.resource === 'auth' && command.action === 'login' ? ['p', platform.id, 'login'] : ['p', platform.id, command.resource, command.action]
  return h('a', { class: 'cmd-tile', href: href(target, { e: endpoint }) }, body)
}

/**
 * 平台页：端与账号、登录提示、按 resource 分组的命令目录，可以按文字查找。
 */
export function platformView(main: HTMLElement, route: Route): (() => void) | void {
  const platform = findPlatform(route.path[1]!)
  if (!platform) return notFoundView(main, route)
  const queryEndpoint = route.query.get('e') as EndpointName | null
  if (queryEndpoint && ENDPOINT_NAMES.includes(queryEndpoint)) setSelection(platform.id, { ...getSelection(platform.id), endpoint: queryEndpoint })
  document.title = `${platform.name} · catbus`

  const headerBox = h('div', null)
  const bannerBox = h('div', null)
  const catalogBox = h('div', null)
  const search = h('input', { type: 'search', class: 'input', id: uid('search'), placeholder: '例如：评论、搜索、下载', autocomplete: 'off' })
  const searchRow = h('div', { class: 'search-row' }, h('label', { for: search.id, class: 'search-label' }, icon('search'), h('span', { class: 'sr-only' }, '查找功能')), search)

  const renderHeader = () => {
    const selection = getSelection(platform.id)
    const ep = platform.endpoints[selection.endpoint]
    replace(
      headerBox,
      pageHeader({
        crumbs: [{ label: '首页', href: '#/' }, { label: platform.name }],
        lead: platformLogo(platform.id, 'lg'),
        title: platform.name,
        subtitle: PLATFORM_DESCRIPTIONS[platform.id] ?? '查看可用功能，选择操作开始使用',
        actions: [
          endpointSwitch(platform, selection, (endpoint) => {
            setSelection(platform.id, { endpoint, account: null })
            renderAll()
          }),
          ep.status === 'available' && ep.login.methods.length ? accountPicker(platform, selection, (account) => setSelection(platform.id, { ...selection, account })) : null,
          ep.status === 'available' && ep.login.methods.length ? linkButton('登录', href(['p', platform.id, 'login'], { e: selection.endpoint }), { variant: 'secondary', icon: 'key', size: 'sm' }) : null,
        ],
      }),
    )
  }

  const renderBanner = () => {
    const selection = getSelection(platform.id)
    const ep = platform.endpoints[selection.endpoint]
    if (ep.status === 'planned') {
      replace(bannerBox, callout('info', `${endpointLabel(selection.endpoint, platform)}暂未开放`, h('p', null, `下方展示目前可用的${endpointLabel(platform.defaultEndpoint, platform)}功能。`)))
      return
    }
    if (!ep.login.methods.length) return replace(bannerBox, callout('success', '不需要登录', h('p', null, '这个平台的能力都可以直接使用。')))
    if (getAccounts() == null || accountsOf(platform.id, selection.endpoint).length) return replace(bannerBox)
    const login = linkButton('去登录', href(['p', platform.id, 'login'], { e: selection.endpoint }), { variant: 'primary', icon: 'key', size: 'sm' })
    replace(bannerBox, ep.guest ? callout('info', withName('还没有登录', platform.name), h('p', null, '可以先浏览部分公开内容，需要使用账号的操作会提示你登录。'), h('div', { class: 'callout-actions' }, login)) : callout('warning', withName('还没有登录', platform.name), h('p', null, '请先登录一个账号，再使用这个平台的功能。'), h('div', { class: 'callout-actions' }, login)))
  }

  const renderCatalog = () => {
    const selection = getSelection(platform.id)
    const endpoint = platform.endpoints[selection.endpoint].status === 'available' ? selection.endpoint : platform.defaultEndpoint
    const ep = platform.endpoints[endpoint]
    if (ep.status !== 'available') return replace(catalogBox, emptyState({ title: '这个平台的功能暂未开放' }))
    const term = search.value.trim().toLowerCase()
    const matches = ep.commands.filter((c) => !term || `${commandTitle(c)} ${c.summary} ${c.resource} ${c.action} ${resourceLabel(platform, c.resource)}`.toLowerCase().includes(term))
    const groups = new Map<string, CommandMeta[]>()
    for (const c of matches) (groups.get(c.resource) ?? groups.set(c.resource, []).get(c.resource)!).push(c)
    if (!groups.size) {
      const clear = linkButton('清除查找', '#', { variant: 'secondary', size: 'sm' })
      clear.addEventListener('click', (e) => {
        e.preventDefault()
        search.value = ''
        renderCatalog()
        search.focus()
      })
      return replace(catalogBox, emptyState({ art: 'bus', title: `没有和「${search.value.trim()}」匹配的功能`, actions: [clear] }))
    }
    replace(
      catalogBox,
      [...groups].map(([resource, commands]) =>
        h(
          'section',
          { class: 'cmd-group', 'aria-labelledby': `group-${resource}` },
          h('h2', { class: 'cmd-group-title', id: `group-${resource}` }, icon(RESOURCE_INFO[resource]?.icon ?? 'tasks'), resourceLabel(platform, resource), h('span', { class: 'cmd-group-count' }, `${commands.length}`)),
          h('div', { class: 'cmd-grid' }, commands.map((c) => commandTile(platform, endpoint, c))),
        ),
      ),
    )
  }

  const renderAll = () => {
    renderHeader()
    renderBanner()
    renderCatalog()
  }
  search.addEventListener('input', renderCatalog)
  append(main, headerBox, bannerBox, searchRow, catalogBox)
  renderAll()
  return onAccountsChange(() => {
    renderHeader()
    renderBanner()
  })
}
