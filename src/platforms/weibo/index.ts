import { filter } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'weibo',
  name: '微博',
  aliases: ['wb'],
  item: '微博',
  endpoints: {
    web: {
      login: { methods: ['cookie'], default: 'cookie' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': 'full',
        'user search': 'none',
        'user items': 'full',
        'user likes': 'none',
        'user collects': 'none',
        'user reposts': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'none',
        'user unfollow': 'none',

        'item get': 'full',
        'item search': 'full',
        'item list': 'none',
        'item media': 'none',
        'item download': 'none',
        'item like': 'none',
        'item unlike': 'none',
        'item collect': 'none',
        'item uncollect': 'none',
        'item repost': 'none',
        'item unrepost': 'none',
        'item publish': 'full',
        'item delete': 'none',

        'comment list': 'partial',
        'comment replies': 'none',
        'comment add': 'none',
        'comment delete': 'none',
        'comment like': 'none',
        'comment unlike': 'none',

        'feed list': { upstream: 'none', options: { kind: filter.kind('recommend', 'hot', 'following') } },

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
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'none',

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

        'history list': 'none',
        'topic search': 'none',
        'poi search': 'none',
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
