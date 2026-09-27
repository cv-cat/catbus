import { filter } from '../../core/options.js'
import { definePlatform } from '../../core/registry.js'

export default definePlatform({
  id: 'x',
  name: 'X',
  aliases: ['twitter'],
  item: '推文',
  endpoints: {
    web: {
      login: { methods: ['password', 'cookie'], default: 'password' },
      commands: {
        'auth login': 'full',
        'auth status': 'full',

        'user get': 'full',
        'user search': 'full',
        'user items': 'full',
        'user likes': 'none',
        'user collects': 'none',
        'user reposts': 'none',
        'user followers': 'none',
        'user following': 'none',
        'user follow': 'full',
        'user unfollow': 'full',

        'item get': 'full',
        'item search': 'full',
        'item media': 'full',
        'item download': 'full',
        'item like': 'full',
        'item unlike': 'full',
        'item collect': 'full',
        'item uncollect': 'full',
        'item repost': 'full',
        'item unrepost': 'full',
        'item publish': 'full',
        'item delete': 'full',

        'comment list': 'full',
        'comment replies': 'none',
        'comment add': 'full',
        'comment delete': 'full',
        'comment like': 'full',
        'comment unlike': 'full',

        'feed list': { upstream: 'partial', note: 'following 规划中', options: { kind: filter.kind('recommend', 'following') } },

        'keyword suggest': 'none',
        'keyword hot': 'none',

        'notice list': 'none',
        'notice count': 'none',

        'msg list': 'full',
        'msg history': 'full',
        'msg send': 'partial',
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
      },
    },
    app: 'planned',
    pc: 'planned',
  },
})
