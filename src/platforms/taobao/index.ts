import { filter } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'taobao',
  name: '淘宝',
  aliases: ['tb'],
  item: '商品',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': 'full',
        'auth status': 'partial',

        'user get': { upstream: 'partial', note: 'me 规划中' },
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
        'msg history': 'full',
        'msg send': 'full',
        'msg listen': 'full',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': 'full',

        'history list': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
