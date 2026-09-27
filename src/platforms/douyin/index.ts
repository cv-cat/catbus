import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'douyin',
  name: '抖音',
  aliases: ['dy'],
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
        'item search': 'full',
        'item related': 'none',
        'item list': 'none',
        'item media': 'full',
        'item download': 'full',
        'item like': 'full',
        'item unlike': 'full',
        'item collect': 'full',
        'item uncollect': 'full',
        'item publish': 'full',
        'item delete': 'none',

        'product get': 'partial',

        'comment list': { upstream: 'full', options: { product: PRODUCT } },
        'comment replies': 'full',
        'comment add': 'full',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': {
          upstream: 'partial',
          note: 'hot、following 规划中',
          options: { kind: filter.kind('recommend', 'hot', 'following') },
        },

        'live get': 'full',
        'live list': 'none',
        'live search': 'full',
        'live categories': 'none',
        'live listen': 'full',
        'live history': 'none',
        'live send': { upstream: 'partial', note: '--gift 规划中' },
        'live like': 'full',
        'live rank': 'full',
        'live gifts': 'none',
        'live products': 'full',
        'live media': 'none',
        'live replays': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'full',
        'notice count': 'none',

        'msg list': 'none',
        'msg history': 'none',
        'msg send': 'full',
        'msg listen': 'full',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': 'full',

        'folder list': 'full',
        'folder items': 'full',
        'folder create': 'none',
        'folder update': 'none',
        'folder delete': 'none',

        'series list': 'none',
        'series items': 'none',

        'history list': 'none',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
