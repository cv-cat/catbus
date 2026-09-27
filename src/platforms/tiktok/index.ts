import { filter, PRODUCT } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'tiktok',
  name: 'TikTok',
  aliases: ['tt'],
  item: '视频',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': { upstream: 'partial', note: 'me 部分支持' },
        'user search': 'none',
        'user items': 'full',
        'user likes': 'none',
        'user collects': 'full',
        'user reposts': 'full',
        'user followers': 'full',
        'user following': 'full',
        'user follow': 'full',
        'user unfollow': 'full',

        'item get': 'full',
        'item search': 'full',
        'item related': 'full',
        'item list': 'full',
        'item media': 'partial',
        'item download': 'partial',
        'item like': 'full',
        'item unlike': 'full',
        'item collect': 'full',
        'item uncollect': 'full',
        'item repost': 'none',
        'item unrepost': 'none',
        'item publish': 'full',
        'item delete': 'none',

        'product get': 'full',

        'comment list': { upstream: 'full', options: { product: PRODUCT } },
        'comment replies': 'full',
        'comment add': 'full',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': { upstream: 'full', options: { kind: filter.kind('recommend', 'following') } },
        'feed categories': 'partial',

        'live get': 'full',
        'live list': 'full',
        'live search': 'full',
        'live categories': 'full',
        'live listen': 'full',
        'live history': 'partial',
        'live send': { upstream: 'partial', note: '--gift 规划中' },
        'live like': 'full',
        'live rank': 'full',
        'live gifts': 'full',
        'live products': 'none',
        'live media': 'none',
        'live start': 'none',
        'live stop': 'none',

        'keyword suggest': 'full',
        'keyword hot': 'none',

        'notice list': 'full',
        'notice count': 'full',

        'msg list': 'full',
        'msg history': 'full',
        'msg send': 'partial',
        'msg listen': 'full',
        'msg read': 'none',
        'msg revoke': 'none',
        'msg delete': 'none',

        'media upload': 'full',

        'folder list': 'full',
        'folder items': 'full',
        'folder create': 'partial',
        'folder update': 'partial',
        'folder delete': 'partial',

        'series list': 'full',
        'series items': 'full',

        'history list': 'none',
        'topic search': 'none',
        'poi search': 'full',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
