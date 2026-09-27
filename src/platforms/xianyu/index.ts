import { filter } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'xianyu',
  name: '闲鱼',
  aliases: ['goofish', 'xy'],
  item: '闲置商品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': { upstream: 'partial', note: '只支持 me；查询他人规划中' },
        'user items': 'none',
        'user collects': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': 'full',
        'item search': 'none',
        'item related': 'none',
        'item list': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': 'full',
        'item delete': 'none',
        'item categories': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend') } },

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
