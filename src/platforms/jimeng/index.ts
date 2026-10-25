import { definePlatform, handlers } from '../../core/registry.js'

/** 即梦只封装官方 CLI dreamina 的登录态（AGENTS 5.6），生成命令直接用 dreamina。 */
const { h, impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'jimeng',
  name: '即梦',
  aliases: ['dreamina'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['oauth'], default: 'oauth' },
      logout: h('serverLogout'),
      use: h('use'),
      commands: {
        'auth login': impl('full', 'authLogin', { supports: [] }),
        'auth status': impl('full', 'authStatus'),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
