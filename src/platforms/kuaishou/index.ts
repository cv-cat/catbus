import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'kuaishou',
  name: '快手',
  aliases: ['ks'],
  item: '作品',
  endpoints: {
    web: {
      login: { methods: ['qrcode', 'sms', 'cookie'], default: 'qrcode' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': 'full',
        'user search': 'full',
        'user items': 'full',
        'user likes': 'full',
        'user collects': 'full',
        'user followers': 'full',
        'user following': 'full',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': 'full',
        'item search': 'partial',
        'item related': 'full',
        'item list': 'full',
        'item media': 'full',
        'item download': 'full',
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item publish': 'partial',
        'item delete': 'none',

        'product get': 'none',

        'comment list': { upstream: 'partial', note: '--product 规划中', options: { product: PRODUCT } },
        'comment replies': 'partial',
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': {
          upstream: 'partial',
          note: 'recommend 规划中；hot 部分支持',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        },

        'live get': 'full',
        'live list': 'full',
        'live search': 'none',
        'live categories': 'full',
        'live listen': 'full',
        'live history': 'none',
        'live send': { upstream: 'partial', note: '--gift 规划中' },
        'live like': 'partial',
        'live rank': 'none',
        'live gifts': 'full',
        'live products': 'none',
        'live media': 'none',
        'live replays': 'full',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'full',

        'msg list': 'none',
        'msg history': 'none',
        'msg send': 'none',
        'msg listen': 'none',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': 'full',

        'folder list': 'none',
        'folder items': 'none',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'full',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
