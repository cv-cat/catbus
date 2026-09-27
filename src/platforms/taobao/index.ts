import { filter } from '../../core/options.js'
import { type CommandDecl, definePlatform, type Handler, type Upstream } from '../../core/registry.js'

type Commands = typeof import('./web/commands.js')

/** 懒加载 web 端的 handler：只有执行到这条命令时才加载实现。 */
const h =
  (name: keyof Commands) =>
  (): Promise<Handler> =>
    import('./web/commands.js').then((m) => m[name] as Handler)

const impl = (upstream: Upstream, name: keyof Commands, extra: Partial<CommandDecl> = {}): CommandDecl => ({ upstream, handler: h(name), ...extra })

export default definePlatform({
  id: 'taobao',
  name: '淘宝',
  aliases: ['tb'],
  item: '商品',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': impl('full', 'authLogin'),
        'auth status': impl('partial', 'authStatus'),

        'user get': impl('partial', 'userGet', { note: 'me 规划中' }),
        'user items': 'none',
        'user collects': 'none',

        'item get': 'none',
        'item search': 'none',
        'item related': 'none',
        'item collect': 'none',
        'item uncollect': 'none',

        'comment list': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

        'live get': 'none',
        'live list': 'none',
        'live search': 'none',
        'live categories': 'none',
        'live listen': 'none',
        'live history': 'none',
        'live send': 'none',
        'live like': 'none',
        'live rank': 'none',
        'live gifts': 'none',
        'live products': 'none',
        'live media': 'none',
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',

        'msg list': 'none',
        'msg history': impl('full', 'msgHistory'),
        'msg send': impl('full', 'msgSend'),
        'msg listen': impl('full', 'msgListen'),
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': impl('full', 'mediaUpload'),

        'history list': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
