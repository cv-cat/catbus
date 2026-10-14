import { definePlatform, handlers } from '../../core/registry.js'

const { impl } = handlers(() => import('./web/commands.js'))

export default definePlatform({
  id: 'zhihu',
  name: '知乎',
  aliases: ['zh'],
  item: '内容',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('full', 'authStatus'),
        'user get': impl('partial', 'userGet', { note: '当前只支持 me' }),
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
